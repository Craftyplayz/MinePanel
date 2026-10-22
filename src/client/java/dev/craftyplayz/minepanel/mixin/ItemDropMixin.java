package dev.craftyplayz.minepanel.mixin;

import dev.craftyplayz.minepanel.ClientActivity;
import net.minecraft.client.player.LocalPlayer;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

@Mixin(LocalPlayer.class)
abstract class ItemDropMixin {
    /** Read the held stack before the drop removes it. */
    @Inject(method = "drop", at = @At("HEAD"))
    private void minepanel$dropped(boolean all, CallbackInfoReturnable<Boolean> callback) {
        var activity = ClientActivity.get();
        if (activity == null) return;
        //? if >=26.1 {
        var stack = ((LocalPlayer) (Object) this).getInventory().getSelectedItem();
        //?} else {
        /*var stack = ((LocalPlayer) (Object) this).getInventory().getSelected();
        *///?}
        activity.itemDropped(stack, all ? stack.getCount() : Math.min(1, stack.getCount()));
    }
}
