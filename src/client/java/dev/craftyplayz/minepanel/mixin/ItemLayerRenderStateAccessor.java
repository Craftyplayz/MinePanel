package dev.craftyplayz.minepanel.mixin;

import net.minecraft.client.renderer.item.ItemStackRenderState;
import net.minecraft.client.resources.model.cuboid.ItemTransform;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.gen.Accessor;

/** Read-only access to the display transform (how an item sits in a hand) of one resolved item model layer. */
@Mixin(ItemStackRenderState.LayerRenderState.class)
public interface ItemLayerRenderStateAccessor {
    @Accessor("itemTransform")
    ItemTransform minepanel$itemTransform();
}
