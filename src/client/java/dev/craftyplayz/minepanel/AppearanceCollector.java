package dev.craftyplayz.minepanel;

import com.google.gson.JsonParser;
import com.mojang.serialization.JsonOps;
import dev.craftyplayz.minepanel.mixin.ItemLayerRenderStateAccessor;
import dev.craftyplayz.minepanel.mixin.ItemRenderStateAccessor;
import dev.craftyplayz.minepanel.service.PngEncoder;
import dev.craftyplayz.minepanel.telemetry.Appearance;
import net.minecraft.client.Minecraft;
import net.minecraft.client.player.AbstractClientPlayer;
import net.minecraft.client.renderer.item.ItemStackRenderState;
import net.minecraft.client.renderer.texture.DynamicTexture;
import net.minecraft.client.resources.model.EquipmentAssetManager;
import net.minecraft.client.resources.model.EquipmentClientInfo;
import net.minecraft.client.resources.model.cuboid.ItemTransform;
import net.minecraft.core.ClientAsset;
import net.minecraft.core.component.DataComponents;
import net.minecraft.resources.Identifier;
import net.minecraft.resources.ResourceKey;
import net.minecraft.world.entity.EquipmentSlot;
import net.minecraft.world.entity.HumanoidArm;
import net.minecraft.world.entity.player.PlayerModelType;
import net.minecraft.world.entity.player.PlayerSkin;
import net.minecraft.world.item.ItemDisplayContext;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.component.DyedItemColor;
import net.minecraft.world.item.equipment.EquipmentAsset;

import java.io.IOException;
import java.io.Reader;
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
    private final Map<Identifier, EquipmentClientInfo> equipment = new HashMap<>();
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
            return new Appearance(texture(minecraft, skin.body(), icons), skin.model() == PlayerModelType.SLIM, armor,
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

    private Appearance.Held held(Minecraft minecraft, AbstractClientPlayer player, ItemStack stack, boolean left,
                                 IconRenderer icons) {
        if (stack.isEmpty()) return null;
        String icon = icons.keyFor(stack);
        icons.request(icon, stack);
        return held.computeIfAbsent(new HeldKey(icon, left), ignored -> {
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
            // ItemTransform.apply mirrors a left-hand transform this way; translation is stored in blocks.
            double mirror = left ? -1 : 1;
            var rotation = transform.rotation();
            var translation = transform.translation();
            var scale = transform.scale();
            return Appearance.Held.rounded(icon, !state.usesBlockLight(),
                    new double[] {rotation.x(), mirror * rotation.y(), mirror * rotation.z()},
                    new double[] {mirror * translation.x() * 16, translation.y() * 16, translation.z() * 16},
                    new double[] {scale.x(), scale.y(), scale.z()});
        });
    }
}
