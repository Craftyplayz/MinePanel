package dev.craftyplayz.minepanel;

import dev.craftyplayz.minepanel.service.LayoutStore;
import dev.craftyplayz.minepanel.service.LocalDashboardServer;
import dev.craftyplayz.minepanel.telemetry.TelemetryStore;
import dev.craftyplayz.minepanel.telemetry.StatisticsTracker;
import dev.craftyplayz.minepanel.telemetry.GameplayTracker;
import dev.craftyplayz.minepanel.telemetry.GameplayHistory;
import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientLifecycleEvents;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.fabricmc.fabric.api.client.networking.v1.ClientPlayConnectionEvents;
import net.fabricmc.fabric.api.client.screen.v1.ScreenEvents;
import net.fabricmc.fabric.api.event.client.player.ClientPlayerBlockBreakEvents;
import net.fabricmc.fabric.api.event.player.AttackEntityCallback;
import net.fabricmc.fabric.api.resource.v1.ResourceLoader;
import net.fabricmc.loader.api.FabricLoader;
import net.minecraft.ChatFormatting;
import net.minecraft.client.Minecraft;
import net.minecraft.network.chat.ClickEvent;
import net.minecraft.network.chat.Component;
import net.minecraft.network.chat.HoverEvent;
import net.minecraft.resources.Identifier;
import net.minecraft.server.packs.PackType;
import net.minecraft.server.packs.resources.ResourceManagerReloadListener;
import net.minecraft.world.InteractionResult;
import net.minecraft.world.entity.ai.attributes.Attributes;
import net.minecraft.client.multiplayer.ClientPacketListener;

import java.io.IOException;
import java.net.BindException;
import java.net.URI;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.logging.Level;
import java.util.logging.Logger;

public final class MinePanelClient implements ClientModInitializer {
    private static final Logger LOGGER = Logger.getLogger("MinePanel");
    private static final long SAMPLE_INTERVAL_NANOS = 250_000_000L;
    private static final long STATS_INTERVAL_NANOS = 3_000_000_000L;
    private final TelemetryStore telemetry = new TelemetryStore();
    private final StatisticsTracker statistics = new StatisticsTracker();
    private final IconRenderer icons = new IconRenderer();
    private final HistoryArchive archive = new HistoryArchive(
            FabricLoader.getInstance().getGameDir().resolve("minepanel").resolve("history"));
    private final GameplayTracker history = new GameplayTracker(archive::append);
    private final ClientActivity activity = new ClientActivity(history);
    private volatile LocalDashboardServer dashboard;
    private volatile String dashboardUrl;
    private volatile boolean fixedPortUnavailable;
    private long sessionStartedNanos;
    private long lastSampleNanos;
    private long lastStatsRequestNanos;
    private ClientPacketListener playConnection;
    private ClientPacketListener initializedConnection;
    private boolean samplingFailureReported;
    private final ExecutorService lifecycleExecutor = Executors.newSingleThreadExecutor(runnable -> {
        Thread thread = new Thread(runnable, "MinePanel-lifecycle");
        thread.setDaemon(true);
        return thread;
    });

    @Override
    public void onInitializeClient() {
        lifecycleExecutor.execute(this::startDashboard);
        ResourceLoader.get(PackType.CLIENT_RESOURCES).registerReloadListener(
                Identifier.fromNamespaceAndPath("minepanel", "item_icons"),
                (ResourceManagerReloadListener) manager -> icons.reset());
        MinecraftStatisticsCollector.onKills(activity::killStatistics);
        ClientPlayConnectionEvents.INIT.register((listener, client) -> {
            initializedConnection = listener;
            MinecraftStatisticsCollector.reset(listener);
            statistics.reset();
            activity.reset();
            sessionStartedNanos = 0;
            samplingFailureReported = false;
        });
        ClientPlayConnectionEvents.JOIN.register((listener, sender, client) -> {
            playConnection = listener;
            sessionStartedNanos = System.nanoTime();
            lastStatsRequestNanos = sessionStartedNanos;
            long now = System.currentTimeMillis();
            history.start(now);
            archive.newSession(now);
            MinecraftStatisticsCollector.request(listener);
            client.execute(() -> announceDashboard(client));
        });
        ClientPlayConnectionEvents.DISCONNECT.register((listener, client) -> {
            client.execute(() -> {
                if (initializedConnection != listener) return;
                initializedConnection = null;
                playConnection = null;
                MinecraftStatisticsCollector.reset(null);
                statistics.reset();
                activity.reset();
                sessionStartedNanos = 0;
                history.disconnect(System.currentTimeMillis());
                telemetry.markUnavailable(System.currentTimeMillis(), history.snapshot());
            });
        });
        ClientPlayerBlockBreakEvents.AFTER.register((level, player, pos, state) -> activity.blockMined(pos, state));
        AttackEntityCallback.EVENT.register((player, level, hand, entity, hit) -> {
            if (level.isClientSide() && player == Minecraft.getInstance().player) activity.attackedEntity(entity);
            return InteractionResult.PASS;
        });
        ScreenEvents.AFTER_INIT.register((client, screen, width, height) -> {
            activity.screenOpened(client, screen);
            ScreenEvents.remove(screen).register(activity::screenClosed);
        });
        ClientTickEvents.END_CLIENT_TICK.register(this::tick);

        ClientLifecycleEvents.CLIENT_STOPPING.register(client -> {
            history.disconnect(System.currentTimeMillis());
            archive.close();
            lifecycleExecutor.execute(() -> {
                stopDashboard();
                lifecycleExecutor.shutdown();
            });
        });
    }

    private void tick(Minecraft client) {
        icons.renderPending(client);
        long now = System.nanoTime();
        boolean inWorld = playConnection != null && playConnection == client.getConnection()
                && client.player != null && client.level != null;
        if (inWorld) {
            activity.tick(client);
            history.observe(System.currentTimeMillis(), client.level.dimension().identifier().toString(),
                    client.player.isDeadOrDying(), (double) client.player.getHealth(),
                    client.player.getAttributeValue(Attributes.MAX_HEALTH));
        }
        if (now - lastSampleNanos < SAMPLE_INTERVAL_NANOS) {
            return;
        }
        lastSampleNanos = now;

        if (!inWorld) {
            var events = history.snapshot();
            telemetry.markUnavailable(System.currentTimeMillis(),
                    new GameplayHistory(events.sessionId(), false, events.events()));
            return;
        }

        if (sessionStartedNanos == 0) {
            sessionStartedNanos = now;
        }
        if (now - lastStatsRequestNanos >= STATS_INTERVAL_NANOS && client.getConnection() != null) {
            lastStatsRequestNanos = now;
            MinecraftStatisticsCollector.request(client.getConnection());
        }

        var player = client.player;
        try {
            var snapshot = MinecraftInventoryCollector.collect(client, player, icons);
            var receivedStats = MinecraftStatisticsCollector.collect(client);
            var counters = statistics.sample(receivedStats);
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
                LOGGER.log(Level.WARNING, "Player telemetry unavailable: unsupported or invalid item metadata.",
                        exception);
            }
        }
    }

    private void announceDashboard(Minecraft client) {
        String url = dashboardUrl;
        Component message;
        if (url == null) {
            message = Component.literal("[MinePanel] Dashboard is not running; see the game log.")
                    .withStyle(ChatFormatting.RED);
        } else {
            message = Component.literal("[MinePanel] ").withStyle(ChatFormatting.GREEN)
                    .append(Component.literal("Dashboard: ").withStyle(ChatFormatting.GRAY))
                    .append(Component.literal(url).withStyle(style -> style
                            .withColor(ChatFormatting.AQUA)
                            .withUnderlined(true)
                            .withClickEvent(new ClickEvent.OpenUrl(URI.create(url)))
                            .withHoverEvent(new HoverEvent.ShowText(Component.literal("Open MinePanel in your browser")))));
            if (fixedPortUnavailable) {
                message = message.copy().append(Component.literal(" (port " + LocalDashboardServer.DEFAULT_PORT
                        + " was busy)").withStyle(ChatFormatting.YELLOW));
            }
        }
        client.gui.getChat().addClientSystemMessage(message);
    }

    private void startDashboard() {
        var layouts = new LayoutStore(FabricLoader.getInstance().getConfigDir().resolve("minepanel").resolve("layout.json"));
        try {
            LocalDashboardServer server;
            try {
                server = new LocalDashboardServer(telemetry, LocalDashboardServer.DEFAULT_PORT, icons, layouts);
            } catch (BindException busy) {
                fixedPortUnavailable = true;
                LOGGER.warning("Port " + LocalDashboardServer.DEFAULT_PORT + " is in use; MinePanel is using a random port.");
                server = new LocalDashboardServer(telemetry, 0, icons, layouts);
            }
            server.start();
            dashboard = server;
            dashboardUrl = server.getUrl();
            LOGGER.info(() -> "Dashboard available at " + dashboardUrl);
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
