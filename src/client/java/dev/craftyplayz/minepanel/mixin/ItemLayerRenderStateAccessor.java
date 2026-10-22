package dev.craftyplayz.minepanel.mixin;

// 26.1 only: older versions read the transform from the BakedModel, and build.gradle leaves this out of the mixin config.
//? if >=26.1 {
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
//?}
