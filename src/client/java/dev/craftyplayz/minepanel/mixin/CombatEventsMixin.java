package dev.craftyplayz.minepanel.mixin;

import dev.craftyplayz.minepanel.ClientActivity;
import net.minecraft.client.Minecraft;
import net.minecraft.client.multiplayer.ClientPacketListener;
import net.minecraft.network.protocol.game.ClientboundDamageEventPacket;
import net.minecraft.network.protocol.game.ClientboundPlayerCombatKillPacket;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/** Packet handlers return normally only on the client thread, so RETURN injections never run off-thread. */
@Mixin(ClientPacketListener.class)
abstract class CombatEventsMixin {
    @Inject(method = "handlePlayerCombatKill", at = @At("RETURN"))
    private void minepanel$deathMessage(ClientboundPlayerCombatKillPacket packet, CallbackInfo callback) {
        var player = Minecraft.getInstance().player;
        var activity = ClientActivity.get();
        if (activity != null && player != null && packet.playerId() == player.getId()) {
            activity.deathMessage(packet.message());
        }
    }

    @Inject(method = "handleDamageEvent", at = @At("RETURN"))
    private void minepanel$damaged(ClientboundDamageEventPacket packet, CallbackInfo callback) {
        var minecraft = Minecraft.getInstance();
        var activity = ClientActivity.get();
        if (activity != null && minecraft.player != null && minecraft.level != null
                && packet.entityId() == minecraft.player.getId()) {
            activity.damaged(packet.getSource(minecraft.level));
        }
    }
}
