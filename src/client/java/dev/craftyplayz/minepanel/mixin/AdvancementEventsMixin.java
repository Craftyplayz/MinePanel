package dev.craftyplayz.minepanel.mixin;

import dev.craftyplayz.minepanel.ClientActivity;
import net.minecraft.client.multiplayer.ClientAdvancements;
import net.minecraft.network.protocol.game.ClientboundUpdateAdvancementsPacket;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Mixin(ClientAdvancements.class)
abstract class AdvancementEventsMixin {
    /** Mirrors vanilla's toast rule: progress that is done in a non-reset packet is a newly made advancement. */
    @Inject(method = "update", at = @At("RETURN"))
    private void minepanel$advancementMade(ClientboundUpdateAdvancementsPacket packet, CallbackInfo callback) {
        var activity = ClientActivity.get();
        if (activity == null || packet.shouldReset()) return;
        var tree = ((ClientAdvancements) (Object) this).getTree();
        for (var entry : packet.getProgress().entrySet()) {
            var node = tree.get(entry.getKey());
            if (node == null || !entry.getValue().isDone()) continue;
            node.advancement().display().ifPresent(display ->
                    activity.advancement(display.getType(), display.getTitle(), display.getDescription()));
        }
    }
}
