package dev.craftyplayz.minepanel.ae2;

//? if neoforge {
/*import appeng.api.stacks.AEKey;
import appeng.api.stacks.AmountFormat;
import appeng.client.gui.me.crafting.CraftingCPUScreen;
import appeng.core.network.clientbound.CraftingJobStatusPacket;
import appeng.menu.me.crafting.CraftingCPUMenu;
import appeng.menu.me.crafting.CraftingStatus;
import appeng.menu.me.crafting.CraftingStatusEntry;
import appeng.menu.me.crafting.CraftingStatusMenu;
import dev.craftyplayz.minepanel.Ae2;
import dev.craftyplayz.minepanel.ae2.mixin.CraftingCPUScreenAccessor;
import dev.craftyplayz.minepanel.telemetry.Ae2Snapshot;
import dev.craftyplayz.minepanel.telemetry.ItemSnapshot;
import net.minecraft.client.Minecraft;
import net.minecraft.world.item.ItemStack;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Queue;
import java.util.UUID;
import java.util.concurrent.ConcurrentLinkedQueue;
import java.util.function.Function;

// AE2 (checked against 19.2.17) keeps crafting jobs on the server. The client gets two things, both read here without
// sending anything: a notice when one of the player's own jobs starts, finishes or is cancelled (caught by
// PendingCraftingJobsMixin), and, only while the Crafting Status screen is open, the CPU list and the selected CPU's job.
public final class AppliedEnergistics implements Ae2.Source {
    private static final int MAX_EVENTS = 256;
    private static final Queue<Event> EVENTS = new ConcurrentLinkedQueue<>();
    private static final Comparator<CraftingStatusEntry> BUSIEST = Comparator
            .comparingLong(CraftingStatusEntry::getActiveAmount)
            .thenComparingLong(CraftingStatusEntry::getPendingAmount).reversed();

    private record Event(UUID id, AEKey what, long requested, CraftingJobStatusPacket.Status status, long at) {
    }

    private record Job(AEKey what, long requested, String state, Long startedAt, Long endedAt) {
    }

    // Insertion order is the order of the last change; the dashboard sorts.
    private final Map<UUID, Job> jobs = new LinkedHashMap<>();
    private List<CraftingStatusMenu.CraftingCpuListEntry> cpus;
    private int selected = -1;
    private CraftingStatus status;
    private long seenAt;

    // Called by PendingCraftingJobsMixin when AE2 handles a job notice (client thread, but queued to be safe).
    public static void jobStatus(UUID id, AEKey what, long requested, CraftingJobStatusPacket.Status status) {
        if (EVENTS.size() < MAX_EVENTS) EVENTS.add(new Event(id, what, requested, status, System.currentTimeMillis()));
    }

    @Override
    public Ae2Snapshot collect(Minecraft minecraft, Function<ItemStack, ItemSnapshot> item, long now) {
        for (Event event; (event = EVENTS.poll()) != null; ) record(event);
        boolean open = capture(minecraft, now);
        List<Ae2Snapshot.Job> list = new ArrayList<>();
        jobs.forEach((id, job) -> list.add(0, new Ae2Snapshot.Job(id.toString(), item.apply(display(job.what())),
                format(job.what(), job.requested()), job.state(), job.startedAt(), job.endedAt())));
        return new Ae2Snapshot(list, cpus == null ? null : new Ae2Snapshot.Cpus(seenAt, open, selected,
                cpus.stream().limit(Ae2Snapshot.MAX_CPUS).map(cpu -> cpu(cpu, item)).toList(), detail(item)));
    }

    @Override
    public void reset() {
        EVENTS.clear();
        jobs.clear();
        cpus = null;
        selected = -1;
        status = null;
    }

    private void record(Event event) {
        if (event.status() == CraftingJobStatusPacket.Status.STARTED) {
            jobs.putIfAbsent(event.id(), new Job(event.what(), event.requested(), "running", event.at(), null));
        } else {
            Job started = jobs.remove(event.id());
            jobs.put(event.id(), new Job(event.what(), event.requested(),
                    event.status() == CraftingJobStatusPacket.Status.FINISHED ? "finished" : "cancelled",
                    started == null ? null : started.startedAt(), event.at()));
        }
        // Drop the oldest ended job first; running ones only if there are that many.
        Iterator<Job> oldest = jobs.values().iterator();
        while (jobs.size() > Ae2Snapshot.MAX_JOBS && oldest.hasNext()) {
            if (oldest.next().endedAt() != null) oldest.remove();
        }
        oldest = jobs.values().iterator();
        while (jobs.size() > Ae2Snapshot.MAX_JOBS) {
            oldest.next();
            oldest.remove();
        }
    }

    // Copies what the open crafting screen shows; true while one is open.
    private boolean capture(Minecraft minecraft, long now) {
        if (minecraft.player == null || !(minecraft.player.containerMenu instanceof CraftingCPUMenu menu)) return false;
        if (menu instanceof CraftingStatusMenu statusMenu) {
            if (statusMenu.cpuList == null) return false;
            cpus = statusMenu.cpuList.cpus();
            selected = statusMenu.getSelectedCpuSerial();
        } else {
            // A crafting CPU opened directly: its job, without the list.
            if (cpus == null) cpus = List.of();
            selected = -1;
        }
        status = minecraft.screen instanceof CraftingCPUScreen<?> screen
                ? ((CraftingCPUScreenAccessor) screen).minepanel$status() : null;
        seenAt = now;
        return true;
    }

    private static Ae2Snapshot.Cpu cpu(CraftingStatusMenu.CraftingCpuListEntry cpu,
                                       Function<ItemStack, ItemSnapshot> item) {
        var job = cpu.currentJob();
        float progress = cpu.progress();
        return new Ae2Snapshot.Cpu(cpu.serial(), cpu.name() == null ? "" : clip(cpu.name().getString()),
                Math.max(0, cpu.storage()), Math.max(0, cpu.coProcessors()),
                job == null ? null : item.apply(display(job.what())), job == null ? null : format(job.what(), job.amount()),
                Float.isFinite(progress) ? Math.clamp(Math.round(progress * 1000) / 1000.0, 0, 1) : 0,
                Math.max(0, cpu.elapsedTimeNanos() / 1_000_000));
    }

    private Ae2Snapshot.Detail detail(Function<ItemStack, ItemSnapshot> item) {
        if (status == null || status.getStartItemCount() <= 0) return null;
        List<Ae2Snapshot.Entry> entries = status.getEntries().stream()
                .filter(entry -> entry.getWhat() != null && !entry.isDeleted())
                .sorted(BUSIEST).limit(Ae2Snapshot.MAX_ENTRIES)
                .map(entry -> new Ae2Snapshot.Entry(item.apply(display(entry.getWhat())),
                        format(entry.getWhat(), entry.getStoredAmount()), format(entry.getWhat(), entry.getActiveAmount()),
                        format(entry.getWhat(), entry.getPendingAmount())))
                .toList();
        long total = status.getStartItemCount();
        return new Ae2Snapshot.Detail(Math.max(0, status.getElapsedTime() / 1_000_000),
                Math.clamp(status.getRemainingItemCount(), 0, total), total, status.isSuspended(), entries);
    }

    // Fluids and other non-item keys show as AE2's display item for them.
    private static ItemStack display(AEKey what) {
        return what.wrapForDisplayOrFilter();
    }

    private static String format(AEKey what, long amount) {
        return amount <= 0 ? "" : clip(what.formatAmount(amount, AmountFormat.FULL));
    }

    private static String clip(String text) {
        return text.length() <= 32 ? text : text.substring(0, 32);
    }
}
*///?}
