package dev.craftyplayz.minepanel.mixin;

import dev.craftyplayz.minepanel.FrameCollector;
import net.minecraft.client.Minecraft;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Mixin(Minecraft.class)
abstract class FrameTimingMixin {
    /** One {@code runTick} renders one frame; every return counts, so an early exit is not missed. */
    @Inject(method = "runTick", at = @At("RETURN"))
    private void minepanel$frameRendered(CallbackInfo callback) {
        FrameCollector.frame();
    }
}
