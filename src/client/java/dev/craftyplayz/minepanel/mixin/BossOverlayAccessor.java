package dev.craftyplayz.minepanel.mixin;

import net.minecraft.client.gui.components.BossHealthOverlay;
import net.minecraft.client.gui.components.LerpingBossEvent;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.gen.Accessor;

import java.util.Map;
import java.util.UUID;

/** Read-only access to the boss bars on screen, for the "Boss bar visible" and "Raid active" rule conditions. */
@Mixin(BossHealthOverlay.class)
public interface BossOverlayAccessor {
    @Accessor("events")
    Map<UUID, LerpingBossEvent> minepanel$events();
}
