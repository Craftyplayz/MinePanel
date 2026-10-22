package dev.craftyplayz.minepanel.telemetry;

import java.util.List;
import java.util.Objects;

/**
 * Applied Energistics 2 autocrafting as the client sees it. {@code jobs} are the player's own crafting jobs from AE2's
 * started/finished/cancelled notices (it sends nothing in between), most recently changed first. {@code cpus} is the
 * crafting CPU list from AE2's Crafting Status screen: live while that screen is open, as last seen after, and null
 * until it has been opened this session. Amounts are AE2's own text ("1,024", "16 B") so fluids read right.
 */
public record Ae2Snapshot(List<Job> jobs, Cpus cpus) {
    public static final int MAX_JOBS = 16;
    public static final int MAX_CPUS = 64;
    public static final int MAX_ENTRIES = 64;
    private static final List<String> STATES = List.of("running", "finished", "cancelled");

    public Ae2Snapshot {
        jobs = List.copyOf(jobs);
        if (jobs.size() > MAX_JOBS) throw new IllegalArgumentException("too many crafting jobs");
    }

    /** {@code startedAt} is null for a job that started before MinePanel saw it; {@code endedAt} null while running. */
    public record Job(String id, ItemSnapshot item, String amount, String state, Long startedAt, Long endedAt) {
        public Job {
            Objects.requireNonNull(item, "item");
            if (id.isEmpty() || id.length() > 64 || !validAmount(amount) || !STATES.contains(state)
                    || "running".equals(state) != (endedAt == null)) {
                throw new IllegalArgumentException("invalid crafting job");
            }
        }

        String toJson() {
            return "{\"id\":" + PlayerSnapshot.string(id) + ",\"item\":" + item.toJson() + ",\"amount\":"
                    + PlayerSnapshot.string(amount) + ",\"state\":" + PlayerSnapshot.string(state) + ",\"startedAt\":"
                    + startedAt + ",\"endedAt\":" + endedAt + "}";
        }
    }

    /**
     * The CPU list as of {@code seenAt}; {@code open} while the screen is open now. {@code selected} is the serial of
     * the CPU the screen shows (-1 for none) and {@code detail} that CPU's job, or null when it is idle or unseen.
     */
    public record Cpus(long seenAt, boolean open, int selected, List<Cpu> list, Detail detail) {
        public Cpus {
            list = List.copyOf(list);
            if (seenAt < 0 || list.size() > MAX_CPUS) throw new IllegalArgumentException("invalid crafting CPUs");
        }

        String toJson() {
            return "{\"seenAt\":" + seenAt + ",\"open\":" + open + ",\"selected\":" + selected + ",\"list\":["
                    + String.join(",", list.stream().map(Cpu::toJson).toList()) + "],\"detail\":"
                    + (detail == null ? "null" : detail.toJson()) + "}";
        }
    }

    /** One crafting CPU; {@code job} and {@code amount} are null while it is idle. {@code progress} is 0 to 1. */
    public record Cpu(int serial, String name, long storage, int coProcessors, ItemSnapshot job, String amount,
                      double progress, long elapsedMillis) {
        public Cpu {
            if (name.length() > 256 || storage < 0 || coProcessors < 0 || (job == null) != (amount == null)
                    || amount != null && !validAmount(amount) || !(progress >= 0 && progress <= 1) || elapsedMillis < 0) {
                throw new IllegalArgumentException("invalid crafting CPU");
            }
        }

        String toJson() {
            return "{\"serial\":" + serial + ",\"name\":" + PlayerSnapshot.string(name) + ",\"storage\":" + storage
                    + ",\"coProcessors\":" + coProcessors + ",\"job\":" + (job == null ? "null" : job.toJson())
                    + ",\"amount\":" + PlayerSnapshot.string(amount) + ",\"progress\":" + progress
                    + ",\"elapsedMillis\":" + elapsedMillis + "}";
        }
    }

    /** The selected CPU's job: item counts left and at the start, and what it is doing per item. */
    public record Detail(long elapsedMillis, long remaining, long total, boolean suspended, List<Entry> entries) {
        public Detail {
            entries = List.copyOf(entries);
            if (elapsedMillis < 0 || remaining < 0 || total < remaining || entries.size() > MAX_ENTRIES) {
                throw new IllegalArgumentException("invalid crafting detail");
            }
        }

        String toJson() {
            return "{\"elapsedMillis\":" + elapsedMillis + ",\"remaining\":" + remaining + ",\"total\":" + total
                    + ",\"suspended\":" + suspended + ",\"entries\":["
                    + String.join(",", entries.stream().map(Entry::toJson).toList()) + "]}";
        }
    }

    /** One item in a job: how many are in the CPU's storage, being crafted now, and still scheduled ("" for none). */
    public record Entry(ItemSnapshot item, String stored, String active, String pending) {
        public Entry {
            Objects.requireNonNull(item, "item");
            if (!validAmount(stored) || !validAmount(active) || !validAmount(pending)) {
                throw new IllegalArgumentException("invalid crafting entry");
            }
        }

        String toJson() {
            return "{\"item\":" + item.toJson() + ",\"stored\":" + PlayerSnapshot.string(stored) + ",\"active\":"
                    + PlayerSnapshot.string(active) + ",\"pending\":" + PlayerSnapshot.string(pending) + "}";
        }
    }

    private static boolean validAmount(String text) {
        return text != null && text.length() <= 32;
    }

    public String toJson() {
        return "{\"jobs\":[" + String.join(",", jobs.stream().map(Job::toJson).toList()) + "],\"cpus\":"
                + (cpus == null ? "null" : cpus.toJson()) + "}";
    }
}
