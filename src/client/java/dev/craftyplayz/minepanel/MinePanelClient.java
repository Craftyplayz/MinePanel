package dev.craftyplayz.minepanel;

import dev.craftyplayz.minepanel.service.LocalDashboardServer;
import dev.craftyplayz.minepanel.telemetry.TelemetryStore;
import dev.craftyplayz.minepanel.telemetry.StatisticsTracker;
import dev.craftyplayz.minepanel.telemetry.GameplayTracker;
import dev.craftyplayz.minepanel.telemetry.GameplayHistory;
import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientLifecycleEvents;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.fabricmc.fabric.api.client.networking.v1.ClientPlayConnectionEvents;
import net.minecraft.world.entity.ai.attributes.Attributes;
import net.minecraft.client.multiplayer.ClientPacketListener;

import java.io.IOException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.logging.Level;
import java.util.logging.Logger;

public final class MinePanelClient implements ClientModInitializer {
    private static final Logger LOGGER = Logger.getLogger("MinePanel");
    private static final long SAMPLE_INTERVAL_NANOS = 250_000_000L;
    private final TelemetryStore telemetry = new TelemetryStore();
    private final StatisticsTracker statistics = new StatisticsTracker();
    private final GameplayTracker history = new GameplayTracker();
    private LocalDashboardServer dashboard;
    private long sessionStartedNanos;
    private long lastSampleNanos;
    private long lastStatsRequestNanos;
    private ClientPacketListener playConnection;
    private boolean samplingFailureReported;
    private final ExecutorService lifecycleExecutor = Executors.newSingleThreadExecutor(runnable -> {
        Thread thread = new Thread(runnable, "MinePanel-lifecycle");
        thread.setDaemon(true);
        return thread;
    });

    @Override
    public void onInitializeClient() {
        lifecycleExecutor.execute(this::startDashboard);
        ClientPlayConnectionEvents.INIT.register((listener, client) -> {
            MinecraftStatisticsCollector.reset(listener);
            statistics.reset();
            sessionStartedNanos = 0;
            samplingFailureReported = false;
        });
        ClientPlayConnectionEvents.JOIN.register((listener, sender, client) -> {
            playConnection = listener;
            sessionStartedNanos = System.nanoTime();
            lastStatsRequestNanos = sessionStartedNanos;
            history.start(System.currentTimeMillis());
            MinecraftStatisticsCollector.request(listener);
        });
        ClientPlayConnectionEvents.DISCONNECT.register((listener, client) -> {
            client.execute(() -> {
                if (playConnection != listener) return;
                playConnection = null;
                MinecraftStatisticsCollector.reset(null);
                statistics.reset();
                sessionStartedNanos = 0;
                history.disconnect(System.currentTimeMillis());
                telemetry.markUnavailable(System.currentTimeMillis(), history.snapshot());
            });
        });
        ClientTickEvents.END_CLIENT_TICK.register(client -> {
            long now = System.nanoTime();
            if (playConnection != null && playConnection == client.getConnection()
                    && client.player != null && client.level != null) {
                history.observe(System.currentTimeMillis(), client.level.dimension().identifier().toString(),
                        client.player.isDeadOrDying());
            }
            if (now - lastSampleNanos < SAMPLE_INTERVAL_NANOS) {
                return;
            }
            lastSampleNanos = now;

            if (playConnection == null || playConnection != client.getConnection()
                    || client.player == null || client.level == null) {
                var events = history.snapshot();
                telemetry.markUnavailable(System.currentTimeMillis(),
                        new GameplayHistory(events.sessionId(), false, events.events()));
                return;
            }

            if (sessionStartedNanos == 0) {
                sessionStartedNanos = now;
            }
            if (now - lastStatsRequestNanos >= 10_000_000_000L && client.getConnection() != null) {
                lastStatsRequestNanos = now;
                MinecraftStatisticsCollector.request(client.getConnection());
            }

            var player = client.player;
            try {
                var snapshot = MinecraftInventoryCollector.collect(player);
                var receivedStats = MinecraftStatisticsCollector.collect(client);
                var counters = statistics.sample(receivedStats);
                history.observeKills(System.currentTimeMillis(), receivedStats);
                telemetry.updatePlayer(
                        System.currentTimeMillis(),
                        (now - sessionStartedNanos) / 1_000_000_000L,
                        client.level.dimension().identifier().toString(),
                        player.getX(), player.getY(), player.getZ(),
                        (double) player.getHealth(), player.getAttributeValue(Attributes.MAX_HEALTH),
                        (double) player.getAbsorptionAmount(), snapshot, counters, history.snapshot());
            } catch (RuntimeException exception) {
                var events = history.snapshot();
                telemetry.markUnavailable(System.currentTimeMillis(),
                        new GameplayHistory(events.sessionId(), false, events.events()));
                if (!samplingFailureReported) {
                    samplingFailureReported = true;
                    LOGGER.warning("Player telemetry unavailable: unsupported or invalid item metadata.");
                }
            }
        });

        ClientLifecycleEvents.CLIENT_STOPPING.register(client -> {
            lifecycleExecutor.execute(() -> {
                stopDashboard();
                lifecycleExecutor.shutdown();
            });
        });
    }

    private void startDashboard() {
        try {
            dashboard = new LocalDashboardServer(telemetry);
            dashboard.start();
            LOGGER.info(() -> "Dashboard available at " + dashboard.getUrl());
        } catch (IOException | RuntimeException exception) {
            LOGGER.log(Level.WARNING, "MinePanel dashboard could not start; gameplay will continue.", exception);
        }
    }

    private void stopDashboard() {
        if (dashboard != null) {
            dashboard.close();
            dashboard = null;
        }
    }
}
