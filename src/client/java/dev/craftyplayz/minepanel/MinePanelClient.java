package dev.craftyplayz.minepanel;

import dev.craftyplayz.minepanel.service.LocalDashboardServer;
import dev.craftyplayz.minepanel.telemetry.TelemetryStore;
import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientLifecycleEvents;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;

import java.io.IOException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.logging.Level;
import java.util.logging.Logger;

public final class MinePanelClient implements ClientModInitializer {
    private static final Logger LOGGER = Logger.getLogger("MinePanel");
    private static final long SAMPLE_INTERVAL_NANOS = 250_000_000L;
    private final TelemetryStore telemetry = new TelemetryStore();
    private LocalDashboardServer dashboard;
    private long sessionStartedNanos;
    private long lastSampleNanos;
    private final ExecutorService lifecycleExecutor = Executors.newSingleThreadExecutor(runnable -> {
        Thread thread = new Thread(runnable, "MinePanel-lifecycle");
        thread.setDaemon(true);
        return thread;
    });

    @Override
    public void onInitializeClient() {
        lifecycleExecutor.execute(this::startDashboard);
        ClientTickEvents.END_CLIENT_TICK.register(client -> {
            long now = System.nanoTime();
            if (now - lastSampleNanos < SAMPLE_INTERVAL_NANOS) {
                return;
            }
            lastSampleNanos = now;

            if (client.player == null || client.level == null) {
                sessionStartedNanos = 0;
                telemetry.markUnavailable(System.currentTimeMillis());
                return;
            }

            if (sessionStartedNanos == 0) {
                sessionStartedNanos = now;
            }

            var player = client.player;
            telemetry.updatePlayer(
                    System.currentTimeMillis(),
                    (now - sessionStartedNanos) / 1_000_000_000L,
                    client.level.dimension().location().toString(),
                    player.getX(), player.getY(), player.getZ(),
                    (double) player.getHealth(), (double) player.getMaxHealth(),
                    (double) player.getAbsorptionAmount());
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
        } catch (IOException exception) {
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
