package dev.craftyplayz.minepanel;

import dev.craftyplayz.minepanel.telemetry.GameplayHistory;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.time.Instant;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.logging.Level;
import java.util.logging.Logger;

/** Appends every finished gameplay event to one JSON-lines file per session, off the client thread. */
final class HistoryArchive {
    private static final Logger LOGGER = Logger.getLogger("MinePanel");
    private static final DateTimeFormatter FILE_NAME =
            DateTimeFormatter.ofPattern("yyyy-MM-dd_HH-mm-ss").withZone(ZoneId.systemDefault());
    private final Path directory;
    private final ExecutorService writer = Executors.newSingleThreadExecutor(runnable -> {
        Thread thread = new Thread(runnable, "MinePanel-history-writer");
        thread.setDaemon(true);
        return thread;
    });
    private Path current;
    private boolean failureReported;

    HistoryArchive(Path directory) {
        this.directory = directory;
    }

    /** Client thread: later events go to a new file named after the session start. */
    void newSession(long timestamp) {
        current = directory.resolve(FILE_NAME.format(Instant.ofEpochMilli(timestamp)) + ".jsonl");
    }

    /** Client thread. */
    void append(GameplayHistory.Event event) {
        if (current == null) newSession(event.timestamp());
        Path target = current;
        String line = event.toJson() + "\n";
        writer.execute(() -> {
            try {
                Files.createDirectories(directory);
                Files.writeString(target, line, StandardCharsets.UTF_8,
                        StandardOpenOption.CREATE, StandardOpenOption.APPEND);
            } catch (IOException failure) {
                if (!failureReported) {
                    failureReported = true;
                    LOGGER.log(Level.WARNING, "MinePanel could not write the gameplay history log.", failure);
                }
            }
        });
    }

    Path directory() {
        return directory;
    }

    void close() {
        writer.shutdown();
    }
}
