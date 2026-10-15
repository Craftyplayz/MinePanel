package dev.craftyplayz.minepanel.mixin;

import dev.craftyplayz.minepanel.ClientActivity;
import net.minecraft.client.Minecraft;
import net.minecraft.world.InteractionResult;
import net.minecraft.world.item.BlockItem;
import net.minecraft.world.item.context.BlockPlaceContext;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

@Mixin(BlockItem.class)
abstract class BlockPlaceMixin {
    /** The client predicts every placement by the local player through this method. */
    @Inject(method = "place", at = @At("RETURN"))
    private void minepanel$placed(BlockPlaceContext context, CallbackInfoReturnable<InteractionResult> callback) {
        var activity = ClientActivity.get();
        if (activity != null && context.getLevel().isClientSide()
                && context.getPlayer() == Minecraft.getInstance().player
                && callback.getReturnValue() instanceof InteractionResult.Success) {
            activity.blockPlaced(((BlockItem) (Object) this).getBlock(), context.getClickedPos());
        }
    }
}
