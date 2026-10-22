package dev.craftyplayz.minepanel;

import dev.craftyplayz.minepanel.telemetry.Ae2Snapshot;
import dev.craftyplayz.minepanel.telemetry.ItemSnapshot;
import net.minecraft.client.Minecraft;
import net.minecraft.world.item.ItemStack;

import java.util.function.Function;
import java.util.logging.Level;
import java.util.logging.Logger;

/**
 * Optional Applied Energistics 2 support: the player's crafting jobs and crafting CPUs, for the AE2 crafting panel.
 * Client thread only. On NeoForge with AE2 installed this delegates to {@code dev.craftyplayz.minepanel.ae2}, the only
 * package that touches that mod; otherwise it does nothing. Any failure turns it off for the session with one warning.
 */
public final class Ae2 {
    private static final Logger LOGGER = Logger.getLogger("MinePanel");
    private static Source source;
    private static boolean connected;

    private Ae2() {
    }

    /** An AE2 integration. Every method runs on the client thread. */
    public interface Source {
        /** What is known now; {@code item} turns a stack into its dashboard value. Called once per sample. */
        Ae2Snapshot collect(Minecraft minecraft, Function<ItemStack, ItemSnapshot> item, long now);

        /** Leaving a world. */
        void reset();
    }

    /** The AE2 crafting panel's data, or null without AE2. */
    static Ae2Snapshot collect(Minecraft minecraft, IconRenderer icons, long now) {
        if (!connected) {
            connected = true;
            connect();
        }
        if (source == null) return null;
        try {
            return source.collect(minecraft, stack -> MinecraftInventoryCollector.item(minecraft, stack, icons), now);
        } catch (LinkageError | RuntimeException failure) {
            fail(failure);
            return null;
        }
    }

    static void reset() {
        if (source == null) return;
        try {
            source.reset();
        } catch (LinkageError | RuntimeException failure) {
            fail(failure);
        }
    }

    private static void connect() {
        //? if neoforge {
        /*if (!net.neoforged.fml.ModList.get().isLoaded("ae2")) return;
        try {
            source = new dev.craftyplayz.minepanel.ae2.AppliedEnergistics();
        } catch (LinkageError | RuntimeException failure) {
            fail(failure);
        }
        *///?}
    }

    private static void fail(Throwable failure) {
        source = null;
        LOGGER.log(Level.WARNING, "AE2 support failed; AE2 crafting is off for this session.", failure);
    }
}
