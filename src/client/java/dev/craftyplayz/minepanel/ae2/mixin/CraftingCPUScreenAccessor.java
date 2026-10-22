package dev.craftyplayz.minepanel.ae2.mixin;

//? if neoforge {
/*import appeng.client.gui.me.crafting.CraftingCPUScreen;
import appeng.menu.me.crafting.CraftingStatus;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.gen.Accessor;

// The selected CPU's job as AE2's crafting screen last merged it from the server's updates.
@Mixin(value = CraftingCPUScreen.class, remap = false)
public interface CraftingCPUScreenAccessor {
    @Accessor("status")
    CraftingStatus minepanel$status();
}
*///?}
