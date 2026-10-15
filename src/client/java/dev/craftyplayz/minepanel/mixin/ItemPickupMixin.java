package dev.craftyplayz.minepanel.mixin;

import dev.craftyplayz.minepanel.ClientActivity;
import net.minecraft.client.Minecraft;
import net.minecraft.client.multiplayer.ClientPacketListener;
import net.minecraft.network.protocol.game.ClientboundTakeItemEntityPacket;
import net.minecraft.world.entity.item.ItemEntity;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Mixin(ClientPacketListener.class)
abstract class ItemPickupMixin {
    /**
     * Reads the collected stack before vanilla shrinks or removes the item entity. The handler is first called on
     * the network thread (where vanilla only reschedules it), so only the client-thread call is used.
     */
    @Inject(method = "handleTakeItemEntity", at = @At("HEAD"))
    private void minepanel$pickedUp(ClientboundTakeItemEntityPacket packet, CallbackInfo callback) {
        var minecraft = Minecraft.getInstance();
        var activity = ClientActivity.get();
        if (activity == null || !minecraft.isSameThread() || minecraft.player == null || minecraft.level == null
                || packet.getPlayerId() != minecraft.player.getId()) {
            return;
        }
        if (minecraft.level.getEntity(packet.getItemId()) instanceof ItemEntity item) {
            activity.pickedUp(item.getItem().copy(), packet.getAmount());
        }
    }
}
