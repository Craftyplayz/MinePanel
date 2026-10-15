package dev.craftyplayz.minepanel;

import dev.craftyplayz.minepanel.service.LayoutStore;
import dev.craftyplayz.minepanel.service.LocalDashboardServer;
import dev.craftyplayz.minepanel.service.WorldStore;
import dev.craftyplayz.minepanel.telemetry.PickupTracker;
import dev.craftyplayz.minepanel.telemetry.PlayerDetails;
import dev.craftyplayz.minepanel.telemetry.PortalTracker;
import dev.craftyplayz.minepanel.telemetry.XpTracker;
import dev.craftyplayz.minepanel.telemetry.TelemetryStore;
import dev.craftyplayz.minepanel.telemetry.StatisticsTracker;
import dev.craftyplayz.minepanel.telemetry.GameplayTracker;
import dev.craftyplayz.minepanel.telemetry.GameplayHistory;
import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientChunkEvents;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientLifecycleEvents;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.fabricmc.fabric.api.client.networking.v1.ClientPlayConnectionEvents;
import net.fabricmc.fabric.api.client.screen.v1.ScreenEvents;
import net.fabricmc.fabric.api.event.client.player.ClientPlayerBlockBreakEvents;
import net.fabricmc.fabric.api.event.player.AttackEntityCallback;
import net.fabricmc.fabric.api.event.player.UseEntityCallback;
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
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.world.InteractionResult;
import net.minecraft.world.item.ItemStack;
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
    private static final int MILLIS_PER_TICK = 50;
    private static final long STATS_INTERVAL_NANOS = 3_000_000_000L;
    private final TelemetryStore telemetry = new TelemetryStore();
    private final StatisticsTracker statistics = new StatisticsTracker();
    private final IconRenderer icons = new IconRenderer();
    private final EffectsCollector effects = new EffectsCollector();
    private final HistoryArchive archive = new HistoryArchive(
            FabricLoader.getInstance().getGameDir().resolve("minepanel").resolve("history"));
    private final GameplayTracker history = new GameplayTracker(archive::append);
    private final PortalTracker portals = new PortalTracker();
    private final XpTracker experience = new XpTracker();
    private final PickupTracker pickups = new PickupTracker();
    private final MotionCollector motion = new MotionCollector();
    private final AdvancementsCollector advancements = new AdvancementsCollector();
    private final WorldStore worldStore = new WorldStore(
            FabricLoader.getInstance().getConfigDir().resolve("minepanel").resolve("worlds"));
    private final WorldDataCollector worldData = new WorldDataCollector(worldStore);
    private final LayoutStore layouts = new LayoutStore(
            FabricLoader.getInstance().getConfigDir().resolve("minepanel").resolve("layout.json"));
    private final ClientActivity activity = new ClientActivity(history, portals, this::pickedUp);
    private final BuildProgressCollector build = new BuildProgressCollector();
    private static final int SAVE_INTERVAL_TICKS = 100;
    private int saveTicks;
    private int portalScans;
    private volatile LocalDashboardServer dashboard;
    private volatile String dashboardUrl;
    private volatile boolean fixedPortUnavailable;
    private long sessionStartedNanos;
    private int ticksSinceSample;
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
                (ResourceManagerReloadListener) manager -> {
                    icons.reset();
                    MinecraftStatisticsCollector.clearNames();
                });
        MinecraftStatisticsCollector.onKills(activity::killStatistics);
        ClientPlayConnectionEvents.INIT.register((listener, client) -> {
            initializedConnection = listener;
            MinecraftStatisticsCollector.reset(listener);
            statistics.reset();
            activity.reset();
            effects.reset();
            resetSession();
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
            String worldKey = WorldCollector.worldKey(client);
            lifecycleExecutor.execute(() -> {
                worldStore.save();
                worldStore.open(worldKey);
            });
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
                effects.reset();
                resetSession();
                lifecycleExecutor.execute(worldStore::save);
                sessionStartedNanos = 0;
                history.disconnect(System.currentTimeMillis());
                telemetry.markUnavailable(System.currentTimeMillis(), history.snapshot());
            });
        });
        ClientChunkEvents.CHUNK_LOAD.register((level, chunk) -> build.chunkLoaded(chunk.getPos().x(), chunk.getPos().z()));
        ClientPlayerBlockBreakEvents.AFTER.register((level, player, pos, state) -> activity.blockMined(pos, state));
        AttackEntityCallback.EVENT.register((player, level, hand, entity, hit) -> {
            if (level.isClientSide() && player == Minecraft.getInstance().player) activity.attackedEntity(entity);
            return InteractionResult.PASS;
        });
        UseEntityCallback.EVENT.register((player, level, hand, entity, hit) -> {
            if (level.isClientSide() && player == Minecraft.getInstance().player) worldData.interacted(entity);
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
                worldStore.save();
                stopDashboard();
                lifecycleExecutor.shutdown();
            });
        });
    }

    /** Per-connection state; the world store itself is switched on join and saved on disconnect. */
    private void resetSession() {
        portals.reset();
        experience.reset();
        pickups.reset();
        motion.reset();
        advancements.reset();
        worldData.reset();
        build.reset();
    }

    /** Client thread: items were added to (positive count) or removed from (negative count) the inventory. */
    private void pickedUp(String source, ItemStack stack, int count) {
        var minecraft = Minecraft.getInstance();
        try {
            ItemStack single = stack.copyWithCount(1);
            String key = BuiltInRegistries.ITEM.getKey(single.getItem()) + "#"
                    + Integer.toHexString(ItemStack.hashItemAndComponents(single));
            pickups.add(System.currentTimeMillis(), key, source, MinecraftInventoryCollector.item(minecraft, single, icons),
                    count);
        } catch (RuntimeException invalid) {
            LOGGER.log(Level.FINE, "Skipped a pickup with unsupported item metadata.", invalid);
        }
    }

    private void tick(Minecraft client) {
        icons.renderPending(client);
        long now = System.nanoTime();
        boolean inWorld = playConnection != null && playConnection == client.getConnection()
                && client.player != null && client.level != null;
        if (inWorld) {
            long millis = System.currentTimeMillis();
            String dimension = client.level.dimension().identifier().toString();
            activity.tick(client);
            history.observe(millis, dimension,
                    client.player.isDeadOrDying(), (double) client.player.getHealth(),
                    client.player.getAttributeValue(Attributes.MAX_HEALTH));
            var feet = client.player.blockPosition();
            portals.observe(millis, dimension, feet.getX(), feet.getY(), feet.getZ(),
                    WorldCollector.inNetherPortal(client.level, client.player));
            motion.tick(client.player);
            worldData.tick(client, client.level);
            build.tick();
            if (++saveTicks % SAVE_INTERVAL_TICKS == 0) lifecycleExecutor.execute(worldStore::save);
        }
        // Counted in ticks, not nanoseconds: tick spacing jitters around 50 ms, so a 50 ms clock check would skip ticks.
        if (++ticksSinceSample < Math.max(1, layouts.updateIntervalMillis() / MILLIS_PER_TICK)) {
            return;
        }
        ticksSinceSample = 0;

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
        var level = client.level;
        try {
            long millis = System.currentTimeMillis();
            var snapshot = MinecraftInventoryCollector.collect(client, player, icons);
            var counters = statistics.sample(millis, MinecraftStatisticsCollector.collect(client));
            var food = player.getFoodData();
            var world = WorldCollector.collect(client, level, player);
            var feet = player.blockPosition();
            history.observeWorld(millis, world.biome(), world.biomeName(), world.weather(), world.day(),
                    feet.getX(), feet.getY(), feet.getZ());
            String dimension = level.dimension().identifier().toString();
            var crossing = portals.crossing();
            if (crossing != null && crossing.toDimension().equals(dimension) && ++portalScans % 4 == 0) {
                portals.lit(WorldCollector.findPortal(level, player, crossing.target()));
            }
            var details = new PlayerDetails(world, motion.collect(client, player, icons),
                    experience.observe(millis, player.experienceLevel, player.experienceProgress), portals.state(),
                    pickups.pickups(), advancements.collect(client.getConnection(), icons),
                    worldData.villagers(client, level, icons), worldData.enderChest(client, level, icons),
                    build.snapshot(client, snapshot, icons));
            telemetry.updatePlayer(
                    millis,
                    (now - sessionStartedNanos) / 1_000_000_000L,
                    dimension,
                    player.getX(), player.getY(), player.getZ(),
                    (double) player.getHealth(), player.getAttributeValue(Attributes.MAX_HEALTH),
                    (double) player.getAbsorptionAmount(), snapshot, counters, history.snapshot(),
                    Math.clamp(food.getFoodLevel(), 0, 20), (double) Math.clamp(food.getSaturationLevel(), 0F, 20F),
                    effects.collect(player, millis), details);
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
        layouts.load(); // picks up the saved update interval before any browser connects
        try {
            LocalDashboardServer server;
            try {
                server = new LocalDashboardServer(telemetry, LocalDashboardServer.DEFAULT_PORT, icons, layouts, worldStore);
            } catch (BindException busy) {
                fixedPortUnavailable = true;
                LOGGER.warning("Port " + LocalDashboardServer.DEFAULT_PORT + " is in use; MinePanel is using a random port.");
                server = new LocalDashboardServer(telemetry, 0, icons, layouts, worldStore);
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
