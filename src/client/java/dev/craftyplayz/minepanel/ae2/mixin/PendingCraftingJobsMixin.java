package dev.craftyplayz.minepanel.ae2.mixin;

//? if neoforge {
/*import appeng.api.stacks.AEKey;
import appeng.client.gui.me.common.PendingCraftingJobs;
import appeng.core.network.clientbound.CraftingJobStatusPacket;
import dev.craftyplayz.minepanel.ae2.AppliedEnergistics;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

import java.util.UUID;

// AE2's client handler for "your crafting job started / finished / was cancelled"; only observed, never changed.
@Mixin(value = PendingCraftingJobs.class, remap = false)
public abstract class PendingCraftingJobsMixin {
    @Inject(method = "jobStatus", at = @At("HEAD"))
    private static void minepanel$jobStatus(UUID id, AEKey what, long requested, long remaining,
                                            CraftingJobStatusPacket.Status status, CallbackInfo info) {
        AppliedEnergistics.jobStatus(id, what, requested, status);
    }
}
*///?}
