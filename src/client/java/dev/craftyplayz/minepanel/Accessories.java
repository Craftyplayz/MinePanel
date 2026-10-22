package dev.craftyplayz.minepanel;

import net.minecraft.world.entity.player.Player;
import net.minecraft.world.item.ItemStack;

import java.util.List;
import java.util.logging.Level;
import java.util.logging.Logger;

/**
 * Optional accessory-slot support: items worn in extra slots (a backpack on the back, rings, belts), shown in the
 * Inventory panel. Client thread only. On NeoForge with Curios installed this delegates to
 * {@code dev.craftyplayz.minepanel.curios}, the only package that touches that mod; otherwise it returns nothing.
 * Any failure turns it off for the session with one warning, without affecting sampling.
 */
final class Accessories {
    private static final Logger LOGGER = Logger.getLogger("MinePanel");
    private static boolean connected;
    private static boolean available;

    private Accessories() {
    }

    /** The non-empty stacks in the player's accessory slots, in slot order; empty without a supported mod. */
    static List<ItemStack> worn(Player player) {
        if (!connected) {
            connected = true;
            //? if neoforge {
            /*available = net.neoforged.fml.ModList.get().isLoaded("curios");
            *///?}
        }
        if (!available) return List.of();
        try {
            //? if neoforge {
            /*return dev.craftyplayz.minepanel.curios.CuriosSlots.worn(player);
            *///?} else {
            return List.of();
            //?}
        } catch (LinkageError | RuntimeException failure) {
            available = false;
            LOGGER.log(Level.WARNING, "Accessory slot support failed; accessories are off for this session.", failure);
            return List.of();
        }
    }
}
