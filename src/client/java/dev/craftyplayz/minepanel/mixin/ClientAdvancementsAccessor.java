package dev.craftyplayz.minepanel.mixin;

import net.minecraft.advancements.AdvancementHolder;
import net.minecraft.advancements.AdvancementProgress;
import net.minecraft.client.multiplayer.ClientAdvancements;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.gen.Accessor;

import java.util.Map;

/** Read-only access to the progress the server has sent, which vanilla only exposes to its advancements screen. */
@Mixin(ClientAdvancements.class)
public interface ClientAdvancementsAccessor {
    @Accessor("progress")
    Map<AdvancementHolder, AdvancementProgress> minepanel$progress();
}
