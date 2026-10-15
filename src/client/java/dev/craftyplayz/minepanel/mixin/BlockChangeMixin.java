package dev.craftyplayz.minepanel.mixin;

import dev.craftyplayz.minepanel.BuildProgressCollector;
import net.minecraft.client.Minecraft;
import net.minecraft.client.multiplayer.ClientLevel;
import net.minecraft.core.BlockPos;
import net.minecraft.world.level.block.state.BlockState;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Mixin(ClientLevel.class)
abstract class BlockChangeMixin {
    /** Every server block update passes through here (the hook Litematica's verifier uses), on the client thread. */
    @Inject(method = "setServerVerifiedBlockState", at = @At("HEAD"))
    private void minepanel$blockChanged(BlockPos pos, BlockState state, int flags, CallbackInfo callback) {
        var build = BuildProgressCollector.get();
        if (build != null && (Object) this == Minecraft.getInstance().level) build.blockChanged(pos.getX(), pos.getZ());
    }
}
