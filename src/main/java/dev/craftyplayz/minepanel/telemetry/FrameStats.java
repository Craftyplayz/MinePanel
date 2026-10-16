package dev.craftyplayz.minepanel.telemetry;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

/**
 * Rolling client frame-rate statistics: frames rendered in each of the last ten minutes' seconds, plus the average
 * and 1% low frame rate over each dashboard window. Frame times are counted in log-spaced buckets 2% wide, so a
 * window's 1% low (the frame rate at its 99th-percentile frame time) is read from a merged histogram instead of
 * keeping every frame. A frame belongs to the second it ended in; a stall leaves seconds with zero frames.
 * Render thread only; {@link #frame} allocates nothing.
 */
public final class FrameStats {
    /** The windows the dashboard can choose between, in seconds. */
    public static final List<Integer> WINDOWS = List.of(10, 30, 60, 600);
    public static final int HISTORY_SECONDS = 600;
    private static final long SECOND = 1_000_000_000L;
    private static final double MIN_NANOS = 100_000; // 0.1 ms, i.e. 10 000 fps
    private static final double MAX_NANOS = 10 * SECOND;
    private static final double RATIO = 1.02;
    static final int BUCKETS = (int) Math.ceil(Math.log(MAX_NANOS / MIN_NANOS) / Math.log(RATIO)) + 1;

    /** Frame rates over one window; {@code seconds} is how much of the window has data yet. */
    public record Window(int seconds, int average, int low) {
        public Window {
            if (seconds < 1 || average < 0 || low < 0 || low > average) throw new IllegalArgumentException("Invalid window");
        }

        String toJson() {
            return "{\"seconds\":" + seconds + ",\"average\":" + average + ",\"low\":" + low + "}";
        }
    }

    /** Frames per second, oldest first and newest last; each window is null until a second has been measured. */
    public record Performance(List<Integer> fps, Map<Integer, Window> windows) {
        public static final Performance EMPTY = new Performance(List.of(), emptyWindows());

        public Performance {
            fps = List.copyOf(fps);
            Objects.requireNonNull(windows, "windows");
            if (fps.size() > HISTORY_SECONDS || !windows.keySet().equals(java.util.Set.copyOf(WINDOWS))) {
                throw new IllegalArgumentException("Invalid performance");
            }
            for (int value : fps) {
                if (value < 0) throw new IllegalArgumentException("Invalid performance");
            }
            windows = Collections.unmodifiableMap(new LinkedHashMap<>(windows));
        }

        public String toJson() {
            StringBuilder json = new StringBuilder("{\"fps\":[");
            for (int index = 0; index < fps.size(); index++) {
                if (index > 0) json.append(',');
                json.append(fps.get(index));
            }
            json.append("],\"windows\":{");
            boolean separator = false;
            for (int window : WINDOWS) {
                if (separator) json.append(',');
                separator = true;
                Window value = windows.get(window);
                json.append('"').append(window).append("\":").append(value == null ? "null" : value.toJson());
            }
            return json.append("}}").toString();
        }

        private static Map<Integer, Window> emptyWindows() {
            Map<Integer, Window> windows = new LinkedHashMap<>();
            for (int window : WINDOWS) windows.put(window, null);
            return windows;
        }
    }

    /** One closed second: its frame count, their total duration, and its non-empty histogram buckets. */
    private record Second(int frames, long nanos, int[] buckets, int[] counts) {
    }

    /** A running merge of the last {@code length} closed seconds. */
    private static final class Span {
        final int length;
        final int[] histogram = new int[BUCKETS];
        long frames;
        long nanos;
        int seconds;

        Span(int length) {
            this.length = length;
        }

        void add(Second second, int sign) {
            frames += sign * (long) second.frames;
            nanos += sign * second.nanos;
            seconds += sign;
            for (int index = 0; index < second.buckets.length; index++) {
                histogram[second.buckets[index]] += sign * second.counts[index];
            }
        }

        Window window() {
            if (seconds == 0) return null;
            if (frames == 0) return new Window(seconds, 0, 0);
            int average = (int) Math.round(frames * (double) SECOND / nanos);
            long rank = Math.max(1, (frames + 99) / 100);
            long slowest = 0;
            for (int bucket = BUCKETS - 1; bucket >= 0; bucket--) {
                slowest += histogram[bucket];
                if (slowest >= rank) {
                    int low = (int) Math.round(SECOND / (MIN_NANOS * Math.pow(RATIO, bucket + 0.5)));
                    // A bucket's midpoint can sit slightly above a steady frame rate's average.
                    return new Window(seconds, average, Math.min(low, average));
                }
            }
            throw new IllegalStateException("Histogram does not match frame count");
        }
    }

    private final Second[] history = new Second[HISTORY_SECONDS];
    private final List<Span> spans = WINDOWS.stream().map(Span::new).toList();
    private final int[] current = new int[BUCKETS];
    private final int[] touched = new int[BUCKETS];
    private int touchedCount;
    private int currentFrames;
    private long currentNanos;
    private long closed;
    private long secondStart;
    private long lastFrame;
    private long snapshotAt = -1;
    private Performance snapshot = Performance.EMPTY;

    /** Records a frame that ended at {@code now} ({@link System#nanoTime()}). */
    public void frame(long now) {
        if (lastFrame == 0) {
            lastFrame = now;
            secondStart = now;
            return;
        }
        long duration = Math.max(0, now - lastFrame);
        lastFrame = now;
        long elapsed = (now - secondStart) / SECOND;
        if (elapsed > 0) {
            // After a long stall, closing a full history of empty seconds already clears everything.
            for (long index = 0; index < Math.min(elapsed, HISTORY_SECONDS + 1L); index++) closeSecond();
            secondStart += elapsed * SECOND;
        }
        int bucket = bucket(duration);
        if (current[bucket]++ == 0) touched[touchedCount++] = bucket;
        currentFrames++;
        currentNanos += duration;
    }

    /** The statistics as of the last closed second; the same instance until another second closes. */
    public Performance snapshot() {
        if (snapshotAt == closed) return snapshot;
        int count = (int) Math.min(closed, HISTORY_SECONDS);
        List<Integer> fps = new ArrayList<>(count);
        for (long sequence = closed - count; sequence < closed; sequence++) fps.add(second(sequence).frames);
        Map<Integer, Window> windows = new LinkedHashMap<>();
        for (Span span : spans) windows.put(span.length, span.window());
        snapshotAt = closed;
        snapshot = new Performance(fps, windows);
        return snapshot;
    }

    private void closeSecond() {
        int[] buckets = new int[touchedCount];
        int[] counts = new int[touchedCount];
        for (int index = 0; index < touchedCount; index++) {
            buckets[index] = touched[index];
            counts[index] = current[touched[index]];
            current[touched[index]] = 0;
        }
        Second second = new Second(currentFrames, currentNanos, buckets, counts);
        touchedCount = 0;
        currentFrames = 0;
        currentNanos = 0;
        // Read the seconds leaving each window before the ring slot is overwritten (the 600 s window's is that slot).
        for (Span span : spans) {
            if (closed >= span.length) span.add(second(closed - span.length), -1);
            span.add(second, 1);
        }
        history[(int) (closed % HISTORY_SECONDS)] = second;
        closed++;
    }

    private Second second(long sequence) {
        return history[(int) (sequence % HISTORY_SECONDS)];
    }

    static int bucket(long nanos) {
        if (nanos <= MIN_NANOS) return 0;
        return (int) Math.min(BUCKETS - 1, Math.floor(Math.log(nanos / MIN_NANOS) / Math.log(RATIO)));
    }
}
