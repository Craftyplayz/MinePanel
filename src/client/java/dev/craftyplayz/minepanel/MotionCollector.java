package dev.craftyplayz.minepanel;

import dev.craftyplayz.minepanel.telemetry.ItemSnapshot;
import dev.craftyplayz.minepanel.telemetry.Motion;
import net.minecraft.client.Minecraft;
import net.minecraft.world.entity.EquipmentSlot;
import net.minecraft.world.entity.LivingEntity;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;
import net.minecraft.world.phys.Vec3;

import java.util.ArrayDeque;

/**
 * Measures movement from the player's actual position each tick (so riding, knockback and elytra boosts all count)
 * and picks the item that represents how they are moving. Client thread only.
 */
final class MotionCollector {
    /** Speed is averaged over this many ticks (half a second) so it reads steadily. */
    private static final int WINDOW_TICKS = 10;

    private final ArrayDeque<Vec3> positions = new ArrayDeque<>();

    void reset() {
        positions.clear();
    }

    void tick(Player player) {
        Vec3 position = player.position();
        // A jump of more than 100 blocks in one tick is a teleport or dimension change, not movement.
        if (!positions.isEmpty() && positions.peekLast().distanceToSqr(position) > 100 * 100) positions.clear();
        positions.addLast(position);
        while (positions.size() > WINDOW_TICKS + 1) positions.removeFirst();
    }

    Motion collect(Minecraft minecraft, Player player, IconRenderer icons) {
        double speed = 0;
        double horizontal = 0;
        double vertical = 0;
        if (positions.size() > 1) {
            Vec3 first = positions.peekFirst();
            Vec3 last = positions.peekLast();
            double seconds = (positions.size() - 1) / 20.0;
            Vec3 delta = last.subtract(first);
            speed = delta.length() / seconds;
            horizontal = Math.sqrt(delta.x * delta.x + delta.z * delta.z) / seconds;
            vertical = delta.y / seconds;
        }
        String mode;
        ItemStack icon;
        if (player.isFallFlying()) {
            mode = "elytra";
            ItemStack glider = glider(player);
            icon = glider.isEmpty() ? new ItemStack(Items.ELYTRA) : glider;
        } else if (player.getVehicle() != null) {
            mode = "riding";
            // A horse (or any ridden animal) wearing armor shows that armor, enchantments and all.
            ItemStack armor = player.getVehicle() instanceof LivingEntity mount
                    ? mount.getItemBySlot(EquipmentSlot.BODY) : ItemStack.EMPTY;
            icon = armor.isEmpty() ? new ItemStack(Items.SADDLE) : armor;
        } else if (player.isSwimming() || player.isInWater() && !player.onGround()) {
            mode = "swimming";
            icon = new ItemStack(Items.TURTLE_HELMET);
        } else if (player.getAbilities().flying) {
            mode = "flying";
            icon = new ItemStack(Items.NETHERITE_BOOTS);
        } else if (!player.onGround() && vertical < -1) {
            mode = "falling";
            icon = new ItemStack(Items.NETHERITE_BOOTS);
        } else {
            mode = "ground";
            icon = new ItemStack(Items.NETHERITE_BOOTS);
        }
        ItemStack glider = glider(player);
        return Motion.rounded(mode, speed, horizontal, vertical, player.getYRot(), player.getXRot(),
                withoutContents(MinecraftInventoryCollector.item(minecraft, icon, icons)),
                glider.isEmpty() ? null : withoutContents(MinecraftInventoryCollector.item(minecraft, glider, icons)));
    }

    /** The equipped item that lets the player glide (normally an elytra in the chest slot). */
    private static ItemStack glider(Player player) {
        for (EquipmentSlot slot : EquipmentSlot.values()) {
            ItemStack stack = player.getItemBySlot(slot);
            if (LivingEntity.canGlideUsing(stack, slot)) return stack;
        }
        return ItemStack.EMPTY;
    }

    private static ItemSnapshot withoutContents(ItemSnapshot item) {
        if (item.contents() == null) return item;
        return new ItemSnapshot(false, item.itemId(), item.name(), item.count(), item.maxCount(), item.damage(),
                item.maxDamage(), item.enchantments(), item.icon(), item.foil(), item.tooltip());
    }
}
