package dev.craftyplayz.minepanel;

import dev.craftyplayz.minepanel.service.LocalDashboardServer;
import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientLifecycleEvents;

import java.io.IOException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.logging.Level;
import java.util.logging.Logger;

public final class MinePanelClient implements ClientModInitializer {
    private static final Logger LOGGER = Logger.getLogger("MinePanel");
    private LocalDashboardServer dashboard;
    private final ExecutorService lifecycleExecutor = Executors.newSingleThreadExecutor(runnable -> {
        Thread thread = new Thread(runnable, "MinePanel-lifecycle");
        thread.setDaemon(true);
        return thread;
    });

    @Override
    public void onInitializeClient() {
        lifecycleExecutor.execute(() -> startDashboard());

        ClientLifecycleEvents.CLIENT_STOPPING.register(client -> {
            lifecycleExecutor.execute(this::stopDashboard);
            lifecycleExecutor.shutdown();
        });
    }

    private void startDashboard() {
        try {
            dashboard = new LocalDashboardServer();
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
