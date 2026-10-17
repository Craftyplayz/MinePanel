package dev.craftyplayz.minepanel.mixin;

import net.minecraft.client.renderer.item.ItemStackRenderState;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.gen.Accessor;

/** Read-only access to a resolved item's model layers, for the 3D render panel's held items. */
@Mixin(ItemStackRenderState.class)
public interface ItemRenderStateAccessor {
    @Accessor("activeLayerCount")
    int minepanel$activeLayerCount();

    @Accessor("layers")
    ItemStackRenderState.LayerRenderState[] minepanel$layers();
}
