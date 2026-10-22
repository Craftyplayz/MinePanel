package dev.craftyplayz.minepanel;

//? if >=26.1 {
import com.google.gson.JsonParser;
import com.mojang.serialization.JsonOps;
import dev.craftyplayz.minepanel.mixin.ItemLayerRenderStateAccessor;
import dev.craftyplayz.minepanel.mixin.ItemRenderStateAccessor;
import net.minecraft.client.renderer.item.ItemStackRenderState;
import net.minecraft.client.renderer.texture.DynamicTexture;
import net.minecraft.client.resources.model.EquipmentAssetManager;
import net.minecraft.client.resources.model.EquipmentClientInfo;
import net.minecraft.client.resources.model.cuboid.ItemTransform;
import net.minecraft.core.ClientAsset;
import net.minecraft.core.component.DataComponents;
import net.minecraft.resources.ResourceKey;
import net.minecraft.world.entity.player.PlayerModelType;
import net.minecraft.world.entity.player.PlayerSkin;
import net.minecraft.world.item.equipment.EquipmentAsset;
import java.io.IOException;
import java.io.Reader;
//?} else {
/*import com.mojang.blaze3d.platform.GlStateManager;
import com.mojang.blaze3d.platform.NativeImage;
import com.mojang.blaze3d.systems.RenderSystem;
import net.minecraft.client.renderer.block.model.ItemTransform;
import net.minecraft.client.resources.PlayerSkin;
import net.minecraft.tags.ItemTags;
import net.minecraft.world.entity.player.PlayerModelPart;
import net.minecraft.world.item.ArmorItem;
import net.minecraft.world.item.ArmorMaterial;
import net.minecraft.world.item.Items;
import org.lwjgl.opengl.GL11;
*///?}
import dev.craftyplayz.minepanel.service.PngEncoder;
import dev.craftyplayz.minepanel.telemetry.Appearance;
import net.minecraft.client.Minecraft;
import net.minecraft.client.player.AbstractClientPlayer;
import net.minecraft.resources.Identifier;
import net.minecraft.world.entity.EquipmentSlot;
import net.minecraft.world.entity.HumanoidArm;
import net.minecraft.world.item.ItemDisplayContext;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.component.DyedItemColor;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.logging.Level;
import java.util.logging.Logger;

/**
 * What the 3D render panel draws, read on the client thread at sampling time: the skin (downloaded skins are copied
 * out of the texture the game already holds; default skins are read from the resource packs), the armor layers the
 * worn items' equipment assets name (as {@code EquipmentLayerRenderer} picks them, without trims or glint) and the
 * items in each hand with their models' third-person transforms. Results are cached until the resource packs change,
 * so an unchanged player costs a few map lookups per sample.
 */
final class AppearanceCollector {
    private static final Logger LOGGER = Logger.getLogger("MinePanel");
    private static final int MAX_CACHED = 256;
    private static final int MAX_TEXTURE_SIZE = 1024;
    private static final EquipmentSlot[] ARMOR_SLOTS = {EquipmentSlot.HEAD, EquipmentSlot.CHEST, EquipmentSlot.LEGS,
            EquipmentSlot.FEET};

    private record HeldKey(String icon, boolean left) {
    }

    private final Map<Identifier, String> textures = new HashMap<>();
    //? if >=26.1 {
    private final Map<Identifier, EquipmentClientInfo> equipment = new HashMap<>();
    //?} else {
    /*private final Map<Identifier, Object> equipment = new HashMap<>(); // armor materials are code, not assets, here
    private static final Identifier WINGS = Identifier.withDefaultNamespace("textures/entity/elytra.png");
    *///?}
    private final Map<HeldKey, Appearance.Held> held = new HashMap<>();
    private int epoch = -1;
    private boolean failureReported;

    void reset() {
        textures.clear();
        equipment.clear();
        held.clear();
    }

    Appearance collect(Minecraft minecraft, AbstractClientPlayer player, IconRenderer icons) {
        try {
            if (epoch != icons.epoch() || textures.size() + equipment.size() + held.size() > MAX_CACHED) {
                reset();
                epoch = icons.epoch();
            }
            PlayerSkin skin = player.getSkin();
            List<Appearance.ArmorLayer> armor = new ArrayList<>();
            for (EquipmentSlot slot : ARMOR_SLOTS) addArmor(minecraft, player, skin, slot, armor, icons);
            boolean rightHanded = player.getMainArm() == HumanoidArm.RIGHT;
            ItemStack right = rightHanded ? player.getMainHandItem() : player.getOffhandItem();
            ItemStack left = rightHanded ? player.getOffhandItem() : player.getMainHandItem();
            //? if >=26.1 {
            return new Appearance(texture(minecraft, skin.body(), icons), skin.model() == PlayerModelType.SLIM, armor,
            //?} else {
            /*return new Appearance(texture(minecraft, skin.texture(), icons), skin.model() == PlayerSkin.Model.SLIM, armor,
            *///?}
                    held(minecraft, player, right, false, icons), held(minecraft, player, left, true, icons));
        } catch (RuntimeException | LinkageError failure) {
            // Only the 3D render panel needs this; the rest of the sample carries on without it.
            if (!failureReported) {
                failureReported = true;
                LOGGER.log(Level.WARNING, "MinePanel could not read the player's appearance for the 3D render.", failure);
            }
            return Appearance.EMPTY;
        }
    }

    //? if >=26.1 {
    /** The key of a skin, cape or elytra texture, or null while it can't be read. */
    private String texture(Minecraft minecraft, ClientAsset.Texture asset, IconRenderer icons) {
        if (asset == null) return null;
        Identifier path = asset.texturePath();
        String cached = textures.get(path);
        if (cached != null) return cached;
        String key;
        if (asset instanceof ClientAsset.DownloadedTexture) {
            // Downloaded textures exist only in the texture manager, already converted from legacy 64×32 skins.
            if (!(minecraft.getTextureManager().getTexture(path) instanceof DynamicTexture dynamic)
                    || dynamic.getPixels() == null) {
                return null;
            }
            var image = dynamic.getPixels();
            int width = image.getWidth();
            int height = image.getHeight();
            if (width <= 0 || height <= 0 || width > MAX_TEXTURE_SIZE || height > MAX_TEXTURE_SIZE) return null;
            byte[] rgba = new byte[width * height * 4];
            for (int y = 0; y < height; y++) {
                for (int x = 0; x < width; x++) {
                    int argb = image.getPixel(x, y);
                    int index = (y * width + x) * 4;
                    rgba[index] = (byte) (argb >> 16);
                    rgba[index + 1] = (byte) (argb >> 8);
                    rgba[index + 2] = (byte) argb;
                    rgba[index + 3] = (byte) (argb >>> 24);
                }
            }
            key = icons.imageTexture(PngEncoder.encode(width, height, rgba));
        } else {
            key = icons.resourceTexture(path);
        }
        if (key != null) textures.put(path, key);
        return key;
    }
    //?} else {
    /*// The key of a skin, cape or elytra texture, or null while it can't be read. Resource-pack textures are read from
    // the packs; downloaded ones exist only on the GPU (HttpTexture keeps no pixels), so they are read back once.
    private String texture(Minecraft minecraft, Identifier path, IconRenderer icons) {
        if (path == null) return null;
        String cached = textures.get(path);
        if (cached != null) return cached;
        String key;
        if (minecraft.getResourceManager().getResource(path).isPresent()) {
            key = icons.resourceTexture(path);
        } else {
            var texture = minecraft.getTextureManager().getTexture(path, null);
            if (texture == null) return null;
            RenderSystem.bindTexture(texture.getId());
            int width = GlStateManager._getTexLevelParameter(GL11.GL_TEXTURE_2D, 0, GL11.GL_TEXTURE_WIDTH);
            int height = GlStateManager._getTexLevelParameter(GL11.GL_TEXTURE_2D, 0, GL11.GL_TEXTURE_HEIGHT);
            // Zero until the download finishes and the texture is uploaded; try again next sample.
            if (width <= 0 || height <= 0 || width > MAX_TEXTURE_SIZE || height > MAX_TEXTURE_SIZE) return null;
            byte[] rgba = new byte[width * height * 4];
            try (NativeImage image = new NativeImage(width, height, false)) {
                image.downloadTexture(0, false);
                for (int y = 0; y < height; y++) {
                    for (int x = 0; x < width; x++) {
                        int abgr = image.getPixelRGBA(x, y);
                        int index = (y * width + x) * 4;
                        rgba[index] = (byte) abgr;
                        rgba[index + 1] = (byte) (abgr >> 8);
                        rgba[index + 2] = (byte) (abgr >> 16);
                        rgba[index + 3] = (byte) (abgr >>> 24);
                    }
                }
            }
            key = icons.imageTexture(PngEncoder.encode(width, height, rgba));
        }
        if (key != null) textures.put(path, key);
        return key;
    }
    *///?}

    //? if >=26.1 {
    private void addArmor(Minecraft minecraft, AbstractClientPlayer player, PlayerSkin skin, EquipmentSlot slot,
                          List<Appearance.ArmorLayer> armor, IconRenderer icons) {
        ItemStack stack = player.getItemBySlot(slot);
        var equippable = stack.get(DataComponents.EQUIPPABLE);
        if (equippable == null || equippable.slot() != slot || equippable.assetId().isEmpty()) return;
        EquipmentClientInfo info = equipment(minecraft, equippable.assetId().get());
        List<EquipmentClientInfo.LayerType> types = switch (slot) {
            case LEGS -> List.of(EquipmentClientInfo.LayerType.HUMANOID_LEGGINGS);
            case CHEST -> List.of(EquipmentClientInfo.LayerType.HUMANOID, EquipmentClientInfo.LayerType.WINGS);
            default -> List.of(EquipmentClientInfo.LayerType.HUMANOID);
        };
        int dye = DyedItemColor.getOrDefault(stack, 0);
        for (var type : types) {
            for (var layer : info.getLayers(type)) {
                // As EquipmentLayerRenderer.getColorForLayer: undyed dyeable layers without a default are skipped.
                int color = layer.dyeable().isEmpty() ? -1 : dye != 0 ? dye
                        : layer.dyeable().get().colorWhenUndyed().map(value -> value | 0xFF000000).orElse(0);
                if (color == 0 || armor.size() == Appearance.MAX_LAYERS) continue;
                String texture = null;
                if (layer.usePlayerTexture()) {
                    texture = texture(minecraft, skin.elytra() != null ? skin.elytra() : skin.cape(), icons);
                }
                if (texture == null) texture = icons.resourceTexture(layer.getTextureLocation(type));
                if (texture == null) continue;
                armor.add(new Appearance.ArmorLayer(slot.getName(), type.getSerializedName(), texture,
                        color == -1 ? null : String.format("#%06x", color & 0xFFFFFF)));
            }
        }
    }

    /** The equipment asset's layers, read from {@code assets/<namespace>/equipment/<path>.json} as the game does. */
    private EquipmentClientInfo equipment(Minecraft minecraft, ResourceKey<EquipmentAsset> asset) {
        return equipment.computeIfAbsent(asset.identifier(), id -> {
            var resource = minecraft.getResourceManager().getResource(id.withPath(path -> "equipment/" + path + ".json"));
            if (resource.isEmpty()) return EquipmentAssetManager.MISSING;
            try (Reader reader = resource.get().openAsReader()) {
                return EquipmentClientInfo.CODEC.parse(JsonOps.INSTANCE, JsonParser.parseReader(reader)).result()
                        .orElse(EquipmentAssetManager.MISSING);
            } catch (IOException | RuntimeException unreadable) {
                return EquipmentAssetManager.MISSING;
            }
        });
    }
    //?} else {
    /*// As HumanoidArmorLayer and ElytraLayer pick them: the material's layers (inner model for leggings), without
    // trims or glint, and the elytra drawn with the player's elytra or cape texture when they have one.
    private void addArmor(Minecraft minecraft, AbstractClientPlayer player, PlayerSkin skin, EquipmentSlot slot,
                          List<Appearance.ArmorLayer> armor, IconRenderer icons) {
        ItemStack stack = player.getItemBySlot(slot);
        if (slot == EquipmentSlot.CHEST && stack.is(Items.ELYTRA)) {
            String texture = null;
            if (skin.elytraTexture() != null) {
                texture = texture(minecraft, skin.elytraTexture(), icons);
            } else if (skin.capeTexture() != null && player.isModelPartShown(PlayerModelPart.CAPE)) {
                texture = texture(minecraft, skin.capeTexture(), icons);
            }
            if (texture == null) texture = icons.resourceTexture(WINGS);
            if (texture != null) armor.add(new Appearance.ArmorLayer(slot.getName(), "wings", texture, null));
            return;
        }
        if (!(stack.getItem() instanceof ArmorItem item) || item.getEquipmentSlot() != slot) return;
        boolean inner = slot == EquipmentSlot.LEGS;
        //? if neoforge {
        /^// As NeoForge's HumanoidArmorLayer: per-item textures and tints; custom 3D armor models can't be drawn here.
        var extensions = net.neoforged.neoforge.client.extensions.common.IClientItemExtensions.of(stack);
        var original = armorModel(minecraft, inner);
        if (extensions.getGenericArmorModel(player, stack, slot, original) != original) return;
        int fallback = extensions.getDefaultDyeColor(stack);
        var layers = item.getMaterial().value().layers();
        for (int index = 0; index < layers.size() && armor.size() < Appearance.MAX_LAYERS; index++) {
            ArmorMaterial.Layer layer = layers.get(index);
            int tint = extensions.getArmorLayerTintColor(stack, player, layer, index, fallback);
            if (tint == 0) continue;
            String texture = icons.resourceTexture(
                    net.neoforged.neoforge.client.ClientHooks.getArmorTexture(player, stack, layer, inner, slot));
            if (texture == null) continue;
            armor.add(new Appearance.ArmorLayer(slot.getName(), inner ? "humanoid_leggings" : "humanoid", texture,
                    tint == -1 ? null : String.format("#%06x", tint & 0xFFFFFF)));
        }
        ^///?} else {
        int dye = stack.is(ItemTags.DYEABLE) ? DyedItemColor.getOrDefault(stack, -6265536) : -1;
        for (ArmorMaterial.Layer layer : item.getMaterial().value().layers()) {
            if (armor.size() == Appearance.MAX_LAYERS) break;
            String texture = icons.resourceTexture(layer.texture(inner));
            if (texture == null) continue;
            armor.add(new Appearance.ArmorLayer(slot.getName(), inner ? "humanoid_leggings" : "humanoid", texture,
                    layer.dyeable() && dye != -1 ? String.format("#%06x", dye & 0xFFFFFF) : null));
        }
        //?}
    }
    //? if neoforge {
    /^// Stand-ins for the player's armor models, so a mod's replacement model can be told apart from the default.
    private final net.minecraft.client.model.HumanoidModel<?>[] armorModels = new net.minecraft.client.model.HumanoidModel<?>[2];

    private net.minecraft.client.model.HumanoidModel<?> armorModel(Minecraft minecraft, boolean inner) {
        int index = inner ? 0 : 1;
        if (armorModels[index] == null) {
            armorModels[index] = new net.minecraft.client.model.HumanoidModel<>(minecraft.getEntityModels().bakeLayer(inner
                    ? net.minecraft.client.model.geom.ModelLayers.PLAYER_INNER_ARMOR
                    : net.minecraft.client.model.geom.ModelLayers.PLAYER_OUTER_ARMOR));
        }
        return armorModels[index];
    }
    ^///?}
    *///?}

    private Appearance.Held held(Minecraft minecraft, AbstractClientPlayer player, ItemStack stack, boolean left,
                                 IconRenderer icons) {
        if (stack.isEmpty()) return null;
        String icon = icons.keyFor(stack);
        icons.request(icon, stack);
        return held.computeIfAbsent(new HeldKey(icon, left), ignored -> {
            //? if >=26.1 {
            var state = new ItemStackRenderState();
            minecraft.getItemModelResolver().updateForTopItem(state, stack, left
                    ? ItemDisplayContext.THIRD_PERSON_LEFT_HAND : ItemDisplayContext.THIRD_PERSON_RIGHT_HAND,
                    minecraft.level, player, 0);
            ItemTransform transform = null;
            var layers = (ItemRenderStateAccessor) state;
            if (layers.minepanel$activeLayerCount() > 0) {
                transform = ((ItemLayerRenderStateAccessor) layers.minepanel$layers()[0]).minepanel$itemTransform();
            }
            if (transform == null) transform = ItemTransform.NO_TRANSFORM;
            var rotation = transform.rotation();
            var translation = transform.translation();
            var scale = transform.scale();
            boolean blockLight = state.usesBlockLight();
            // ItemTransform.apply mirrors a left-hand transform this way.
            double mirror = left ? -1 : 1;
            //?} else {
            /*var model = minecraft.getItemRenderer().getModel(stack, minecraft.level, player, 0);
            ItemDisplayContext context = left
                    ? ItemDisplayContext.THIRD_PERSON_LEFT_HAND : ItemDisplayContext.THIRD_PERSON_RIGHT_HAND;
            //? if neoforge {
            /^// NeoForge models may pick their own transform (or model) per context, as ItemRenderer.render applies it;
            // read it back from the matrix it builds, which is already mirrored for the left hand.
            var pose = new com.mojang.blaze3d.vertex.PoseStack();
            model = model.applyTransform(context, pose, left);
            org.joml.Vector3f[] parts = decompose(pose.last().pose());
            var rotation = parts[0];
            var translation = parts[1];
            var scale = parts[2];
            double mirror = 1;
            ^///?} else {
            ItemTransform transform = model.getTransforms().getTransform(context);
            var rotation = transform.rotation;
            var translation = transform.translation;
            var scale = transform.scale;
            // ItemTransform.apply mirrors a left-hand transform this way.
            double mirror = left ? -1 : 1;
            //?}
            boolean blockLight = model.usesBlockLight();
            *///?}
            // Translation is stored in blocks.
            return Appearance.Held.rounded(icon, !blockLight,
                    new double[] {rotation.x(), mirror * rotation.y(), mirror * rotation.z()},
                    new double[] {mirror * translation.x() * 16, translation.y() * 16, translation.z() * 16},
                    new double[] {scale.x(), scale.y(), scale.z()});
        });
    }
    //? if neoforge {
    /*// A pose as translation · rotationXYZ (degrees) · scale, the form ItemTransform.apply builds. NeoForge's extra
    // right rotation folds into the rotation exactly for uniform scales (nearly so otherwise).
    static org.joml.Vector3f[] decompose(org.joml.Matrix4f matrix) {
        var translation = matrix.getTranslation(new org.joml.Vector3f());
        var scale = matrix.getScale(new org.joml.Vector3f());
        if (matrix.determinant3x3() < 0) scale.x = -scale.x;
        var rotation = new org.joml.Vector3f();
        if (Math.abs(scale.x) > 1e-6F && Math.abs(scale.y) > 1e-6F && Math.abs(scale.z) > 1e-6F) {
            var linear = new org.joml.Matrix3f(matrix).scale(1 / scale.x, 1 / scale.y, 1 / scale.z);
            // Angles for R = Rx·Ry·Rz; joml 1.10.5 getEulerAnglesXYZ breaks at ±90° Y, which tool models use.
            float sinY = Math.clamp(linear.m20, -1F, 1F);
            rotation.y = (float) Math.asin(sinY);
            if (Math.abs(sinY) < 0.9999F) {
                rotation.x = (float) Math.atan2(-linear.m21, linear.m22);
                rotation.z = (float) Math.atan2(-linear.m10, linear.m00);
            } else {
                rotation.x = (float) Math.atan2(linear.m12, linear.m11);
            }
            rotation.mul((float) Math.toDegrees(1));
        }
        return new org.joml.Vector3f[] {rotation, translation, scale};
    }
    *///?}
}
