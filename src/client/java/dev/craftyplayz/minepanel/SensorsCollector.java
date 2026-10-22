package dev.craftyplayz.minepanel;

import dev.craftyplayz.minepanel.mixin.BossOverlayAccessor;
import dev.craftyplayz.minepanel.telemetry.SensorNeeds;
import dev.craftyplayz.minepanel.telemetry.Sensors;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.gui.screens.inventory.AbstractContainerScreen;
import net.minecraft.client.gui.screens.inventory.CreativeModeInventoryScreen;
import net.minecraft.client.gui.screens.inventory.InventoryScreen;
import net.minecraft.client.multiplayer.ClientLevel;
import net.minecraft.core.BlockPos;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.network.chat.contents.TranslatableContents;
//? if >=26.1
import net.minecraft.world.attribute.EnvironmentAttributes;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.LivingEntity;
import net.minecraft.world.entity.monster.Enemy;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.entity.projectile.ProjectileUtil;
import net.minecraft.world.inventory.AbstractFurnaceMenu;
import net.minecraft.world.inventory.AnvilMenu;
import net.minecraft.world.inventory.BeaconMenu;
import net.minecraft.world.inventory.BrewingStandMenu;
import net.minecraft.world.inventory.CartographyTableMenu;
import net.minecraft.world.inventory.ChestMenu;
import net.minecraft.world.inventory.CraftingMenu;
import net.minecraft.world.inventory.DispenserMenu;
import net.minecraft.world.inventory.EnchantmentMenu;
import net.minecraft.world.inventory.GrindstoneMenu;
import net.minecraft.world.inventory.HopperMenu;
import net.minecraft.world.inventory.LoomMenu;
import net.minecraft.world.inventory.MerchantMenu;
import net.minecraft.world.inventory.ShulkerBoxMenu;
import net.minecraft.world.inventory.SmithingMenu;
import net.minecraft.world.inventory.StonecutterMenu;
import net.minecraft.world.level.LightLayer;
import net.minecraft.world.phys.AABB;
import net.minecraft.world.phys.BlockHitResult;
import net.minecraft.world.phys.HitResult;
import net.minecraft.world.phys.Vec3;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.logging.Level;
import java.util.logging.Logger;

/**
 * Reads what rule conditions need beyond the other snapshot fields (docs/RULES_V2.md, phase 4). Light, the look
 * target, the entity scan and the screen are read only while an enabled rule uses them, and the entity scan at most
 * twice a second, no further than the render distance. Client thread only.
 */
final class SensorsCollector {
    private static final long SCAN_INTERVAL_MILLIS = 500;
    private static final Logger LOGGER = Logger.getLogger("MinePanel");
    private Sensors.Nearby nearby;
    private long scannedAt;
    private boolean failureReported;

    void reset() {
        nearby = null;
        scannedAt = 0;
    }

    /** The sensors, or {@link Sensors#EMPTY} (with one logged warning) if the game can't be read as expected. */
    Sensors collect(Minecraft minecraft, ClientLevel level, Player player, SensorNeeds needs, long now) {
        try {
            return read(minecraft, level, player, needs, now);
        } catch (RuntimeException failure) {
            if (!failureReported) {
                failureReported = true;
                LOGGER.log(Level.WARNING, "MinePanel could not read the rule sensors; conditions that use them won't work.",
                        failure);
            }
            return Sensors.EMPTY;
        }
    }

    private Sensors read(Minecraft minecraft, ClientLevel level, Player player, SensorNeeds needs, long now) {
        //? if >=26.1 {
        int moonPhase = level.environmentAttributes().getDimensionValue(EnvironmentAttributes.MOON_PHASE).index();
        var spawn = level.getRespawnData();
        Integer spawnDistance = spawn.dimension().equals(level.dimension())
                ? (int) Math.round(Math.hypot(player.getX() - (spawn.pos().getX() + 0.5),
                        player.getZ() - (spawn.pos().getZ() + 0.5)))
                : null;
        //?} else {
        /*int moonPhase = level.getMoonPhase();
        // The client only knows the world spawn, which is in the Overworld.
        BlockPos spawn = level.getSharedSpawnPos();
        Integer spawnDistance = level.dimension() == net.minecraft.world.level.Level.OVERWORLD
                ? (int) Math.round(Math.hypot(player.getX() - (spawn.getX() + 0.5), player.getZ() - (spawn.getZ() + 0.5)))
                : null;
        *///?}
        BlockPos feet = player.blockPosition();
        // As Entity.isInRain (not public): rain reaches the feet or the top of the player.
        boolean inRain = level.isRainingAt(feet)
                || level.isRainingAt(BlockPos.containing(player.getX(), player.getBoundingBox().maxY, player.getZ()));
        Entity vehicle = player.getVehicle();
        boolean bossBar = false;
        boolean raid = false;
        for (var event : ((BossOverlayAccessor) minecraft.gui.getBossOverlay()).minepanel$events().values()) {
            if (event.getName().getContents() instanceof TranslatableContents name
                    && name.getKey().startsWith("event.minecraft.raid")) {
                raid = true;
            } else {
                bossBar = true;
            }
        }
        Sensors.Light light = needs.light() ? new Sensors.Light(level.getBrightness(LightLayer.BLOCK, feet),
                level.getBrightness(LightLayer.SKY, feet), level.getMaxLocalRawBrightness(feet)) : null;
        Sensors.Look look = needs.lookDistance() > 0 ? look(level, player, needs.lookDistance()) : null;
        if (needs.entityRadius() == 0) {
            nearby = null;
        } else {
            int radius = Math.min(needs.entityRadius(), minecraft.options.getEffectiveRenderDistance() * 16);
            if (nearby == null || nearby.radius() != radius || now - scannedAt >= SCAN_INTERVAL_MILLIS) {
                nearby = scan(level, player, radius);
                scannedAt = now;
            }
        }
        return new Sensors(moonPhase, spawnDistance, player.getAirSupply(), player.getMaxAirSupply(),
                player.getArmorValue(), player.isOnFire(), player.isInWater(), player.isInLava(), inRain,
                player.isShiftKeyDown(), player.isSprinting(), player.isSleeping(),
                vehicle == null ? null : BuiltInRegistries.ENTITY_TYPE.getKey(vehicle.getType()).toString(),
                using(player), bossBar, raid, light, look, needs.entityRadius() == 0 ? null : nearby,
                needs.screen() ? screen(minecraft.screen) : null);
    }

    /** What the player is doing with an item, or null. */
    private static String using(Player player) {
        if (player.fishing != null) return "fishing";
        if (!player.isUsingItem()) return null;
        return switch (player.getUseItem().getUseAnimation()) {
            case EAT -> "eating";
            case DRINK -> "drinking";
            case BLOCK -> "blocking";
            case BOW -> "bow";
            case CROSSBOW -> "crossbow";
            //? if >=26.1 {
            case TRIDENT -> "trident";
            case SPEAR -> "spear";
            case BUNDLE -> "bundle";
            //?} else {
            /*case SPEAR -> "trident"; // tridents used the spear animation before spears existed
            *///?}
            case SPYGLASS -> "spyglass";
            case TOOT_HORN -> "horn";
            case BRUSH -> "brush";
            default -> null;
        };
    }

    /** The nearest block or entity along the player's view, up to {@code distance} blocks. */
    private static Sensors.Look look(ClientLevel level, Player player, int distance) {
        Vec3 eye = player.getEyePosition();
        Vec3 view = player.getViewVector(1.0F);
        HitResult block = player.pick(distance, 1.0F, false);
        double reach = block.getType() == HitResult.Type.MISS ? distance : eye.distanceTo(block.getLocation());
        AABB area = player.getBoundingBox().expandTowards(view.scale(reach)).inflate(1.0);
        var entity = ProjectileUtil.getEntityHitResult(player, eye, eye.add(view.scale(reach)), area,
                target -> !target.isSpectator() && target.isPickable(), reach * reach);
        if (entity != null) {
            return new Sensors.Look("entity", BuiltInRegistries.ENTITY_TYPE.getKey(entity.getEntity().getType()).toString(),
                    Sensors.tenths(eye.distanceTo(entity.getLocation())));
        }
        if (block instanceof BlockHitResult hit && block.getType() == HitResult.Type.BLOCK) {
            return new Sensors.Look("block",
                    BuiltInRegistries.BLOCK.getKey(level.getBlockState(hit.getBlockPos()).getBlock()).toString(),
                    Sensors.tenths(reach));
        }
        return new Sensors.Look("none", null, null);
    }

    /** Living entities (other players too) within {@code radius} blocks, nearest first. */
    private static Sensors.Nearby scan(ClientLevel level, Player player, int radius) {
        List<Sensors.Entity> found = new ArrayList<>();
        for (LivingEntity entity : level.getEntitiesOfClass(LivingEntity.class, player.getBoundingBox().inflate(radius),
                entity -> entity != player && entity.isAlive() && !entity.isSpectator())) {
            double distance = entity.distanceTo(player);
            if (distance > radius) continue;
            found.add(new Sensors.Entity(BuiltInRegistries.ENTITY_TYPE.getKey(entity.getType()).toString(),
                    entity instanceof Enemy, Sensors.tenths(distance)));
        }
        found.sort(Comparator.comparingDouble(Sensors.Entity::distance));
        return new Sensors.Nearby(radius, found.size() > Sensors.MAX_NEARBY ? found.subList(0, Sensors.MAX_NEARBY) : found);
    }

    /** The kind of screen that is open (see {@link Sensors#SCREENS}). */
    static String screen(Screen screen) {
        if (screen == null) return "none";
        if (screen instanceof InventoryScreen || screen instanceof CreativeModeInventoryScreen) return "inventory";
        if (!(screen instanceof AbstractContainerScreen<?> container)) return "other";
        var menu = container.getMenu();
        if (menu instanceof ChestMenu) {
            return screen.getTitle().getContents() instanceof TranslatableContents title
                    && "container.enderchest".equals(title.getKey()) ? "enderChest" : "chest";
        }
        if (menu instanceof ShulkerBoxMenu || menu instanceof DispenserMenu || menu instanceof HopperMenu) return "chest";
        if (menu instanceof AbstractFurnaceMenu) return "furnace";
        if (menu instanceof CraftingMenu) return "crafting";
        if (menu instanceof AnvilMenu) return "anvil";
        if (menu instanceof EnchantmentMenu) return "enchanting";
        if (menu instanceof BrewingStandMenu) return "brewing";
        if (menu instanceof MerchantMenu) return "trading";
        if (menu instanceof SmithingMenu) return "smithing";
        if (menu instanceof GrindstoneMenu) return "grindstone";
        if (menu instanceof StonecutterMenu) return "stonecutter";
        if (menu instanceof LoomMenu) return "loom";
        if (menu instanceof CartographyTableMenu) return "cartography";
        if (menu instanceof BeaconMenu) return "beacon";
        return "other";
    }
}
