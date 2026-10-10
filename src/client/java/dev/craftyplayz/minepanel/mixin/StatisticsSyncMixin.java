package dev.craftyplayz.minepanel.mixin;

import dev.craftyplayz.minepanel.MinecraftStatisticsCollector;
import net.minecraft.client.multiplayer.ClientPacketListener;
import net.minecraft.network.protocol.game.ClientboundAwardStatsPacket;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Mixin(ClientPacketListener.class)
abstract class StatisticsSyncMixin {
    @Inject(method = "handleAwardStats", at = @At("RETURN"))
    private void minepanel$statisticsReceived(ClientboundAwardStatsPacket packet, CallbackInfo callback) {
        MinecraftStatisticsCollector.received((ClientPacketListener) (Object) this, packet);
    }
}
