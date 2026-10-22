package dev.craftyplayz.minepanel;

//? if >=26.1 {
import com.mojang.blaze3d.ProjectionType;
import com.mojang.blaze3d.buffers.GpuBuffer;
import com.mojang.blaze3d.systems.CommandEncoder;
import com.mojang.blaze3d.systems.GpuDevice;
import com.mojang.blaze3d.textures.GpuTexture;
import com.mojang.blaze3d.textures.GpuTextureView;
import com.mojang.blaze3d.textures.TextureFormat;
import net.minecraft.client.renderer.Projection;
import net.minecraft.client.renderer.ProjectionMatrixBuffer;
import net.minecraft.client.renderer.item.TrackingItemStackRenderState;
//?} else {
/*import com.mojang.blaze3d.pipeline.TextureTarget;
import com.mojang.blaze3d.platform.GlStateManager;
import com.mojang.blaze3d.platform.NativeImage;
import com.mojang.blaze3d.vertex.VertexSorting;
import org.joml.Matrix4f;
import org.lwjgl.opengl.GL11;
import org.lwjgl.opengl.GL30;
*///?}
import com.mojang.blaze3d.platform.Lighting;
import com.mojang.blaze3d.systems.RenderSystem;
import com.mojang.blaze3d.vertex.PoseStack;
import dev.craftyplayz.minepanel.service.IconSource;
import dev.craftyplayz.minepanel.service.PngEncoder;
import net.minecraft.client.Minecraft;
import net.minecraft.client.renderer.texture.OverlayTexture;
import net.minecraft.core.component.DataComponents;
import net.minecraft.resources.Identifier;
import net.minecraft.world.item.ItemDisplayContext;
import net.minecraft.world.item.ItemStack;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayDeque;
import java.util.HexFormat;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentLinkedQueue;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.logging.Level;
import java.util.logging.Logger;

/**
 * Renders inventory items exactly as the GUI does (same model resolution, lighting and resource packs) into an
 * off-screen texture and reads them back as PNGs. Rendering happens on the render thread; HTTP threads only wait
 * on the resulting futures. The enchantment glint is left out of the image.
 */
final class IconRenderer implements IconSource {
    static final int SIZE = 64;
    private static final Logger LOGGER = Logger.getLogger("MinePanel");
    private static final int MAX_ICONS = 4096;
    private static final int RENDERS_PER_TICK = 16;
    private static final long WAIT_MILLIS = 3_000;
    private static final int MAX_TEXTURES = 512;

    private final Map<String, CompletableFuture<byte[]>> icons = new ConcurrentHashMap<>();
    // Registry entries the pickers list: rendered only when the dashboard first asks for one (any thread).
    private final Map<String, ItemStack> deferred = new ConcurrentHashMap<>();
    private final ConcurrentLinkedQueue<String> wanted = new ConcurrentLinkedQueue<>();
    private final ArrayDeque<Pending> pending = new ArrayDeque<>();
    private final Map<String, byte[]> effectIcons = new ConcurrentHashMap<>();
    // Skin and armor textures by key: PNG bytes, or a resource-pack texture read when the dashboard first asks.
    private final Map<String, Object> textures = new ConcurrentHashMap<>();
    private final PoseStack poseStack = new PoseStack();
    private volatile int epoch;
    //? if >=26.1 {
    private final Projection projection = new Projection();
    private GpuTexture colorTexture;
    private GpuTextureView colorView;
    private GpuTexture depthTexture;
    private GpuTextureView depthView;
    private ProjectionMatrixBuffer projectionBuffer;
    //?} else {
    /*private TextureTarget target;
    *///?}

    private record Pending(String key, ItemStack stack, CompletableFuture<byte[]> result) {
    }

    /** Changes whenever icon keys change (resource reload or a full icon cache). */
    int epoch() {
        return epoch;
    }

    /** Icon identity: item and components (not count), scoped to the current resource-pack epoch. */
    String keyFor(ItemStack stack) {
        return "e" + epoch + "-" + Integer.toHexString(ItemStack.hashItemAndComponents(stack));
    }

    /** Client thread: queue a render for a key the dashboard may request. */
    void request(String key, ItemStack stack) {
        if (icons.containsKey(key)) return;
        if (icons.size() >= MAX_ICONS) {
            reset();
            return;
        }
        CompletableFuture<byte[]> future = new CompletableFuture<>();
        icons.put(key, future);
        ItemStack copy = stack.copyWithCount(1);
        copy.set(DataComponents.ENCHANTMENT_GLINT_OVERRIDE, false);
        pending.addLast(new Pending(key, copy, future));
    }

    /**
     * Client thread: a key for an icon that is rendered only if the dashboard asks for it (registry lists hold
     * thousands of items, most of which are never shown).
     */
    String deferredKey(ItemStack stack) {
        String key = keyFor(stack);
        if (!icons.containsKey(key)) deferred.putIfAbsent(key, stack.copyWithCount(1));
        return key;
    }

    /** Resource packs changed: every icon must be rendered again under new keys. */
    void reset() {
        epoch++;
        icons.values().forEach(future -> future.complete(null));
        icons.clear();
        pending.clear();
        deferred.clear();
        wanted.clear();
        effectIcons.clear();
        textures.clear();
    }

    @Override
    public byte[] icon(String key) throws InterruptedException {
        CompletableFuture<byte[]> future = icons.get(key);
        if (future == null && deferred.containsKey(key)) {
            // Rendered on the client thread; this thread waits for it like for any pending icon.
            future = icons.computeIfAbsent(key, ignored -> new CompletableFuture<>());
            wanted.add(key);
        }
        if (future == null) return null;
        try {
            return future.get(WAIT_MILLIS, TimeUnit.MILLISECONDS);
        } catch (ExecutionException | TimeoutException unavailable) {
            return null;
        }
    }

    /**
     * Client thread: a key for a texture in the active resource packs (armor layers, default skins), read only when
     * the dashboard asks for it. Null once {@value #MAX_TEXTURES} textures are known (until the next reload).
     */
    String resourceTexture(Identifier path) {
        return addTexture("r", path.toString().getBytes(StandardCharsets.UTF_8), path);
    }

    /** Client thread: a key for a texture the game already holds as pixels (a downloaded skin), as PNG bytes. */
    String imageTexture(byte[] png) {
        return addTexture("p", png, png);
    }

    private String addTexture(String kind, byte[] identity, Object value) {
        String key;
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(identity);
            key = kind + epoch + "-" + HexFormat.of().formatHex(digest, 0, 10);
        } catch (NoSuchAlgorithmException unavailable) {
            return null;
        }
        if (textures.containsKey(key)) return key;
        if (textures.size() >= MAX_TEXTURES) return null;
        textures.put(key, value);
        return key;
    }

    @Override
    public byte[] texture(String key) {
        Object value = textures.get(key);
        if (value instanceof byte[] png) return png.length == 0 ? null : png;
        if (!(value instanceof Identifier path)) return null;
        byte[] bytes = new byte[0];
        var resource = Minecraft.getInstance().getResourceManager().getResource(path);
        if (resource.isPresent()) {
            try (InputStream input = resource.get().open()) {
                bytes = input.readNBytes(4 * 1024 * 1024);
            } catch (IOException | RuntimeException unreadable) {
                bytes = new byte[0];
            }
        }
        textures.replace(key, value, bytes);
        return bytes.length == 0 ? null : bytes;
    }

    /** Effect icons are plain textures, so they are read from the active resource packs rather than rendered. */
    @Override
    public byte[] effectIcon(String effectId) {
        Identifier id = Identifier.tryParse(effectId);
        if (id == null) return null;
        byte[] cached = effectIcons.get(effectId);
        if (cached != null) return cached.length == 0 ? null : cached;
        var resource = Minecraft.getInstance().getResourceManager()
                .getResource(id.withPath(path -> "textures/mob_effect/" + path + ".png"));
        byte[] bytes = new byte[0];
        if (resource.isPresent()) {
            try (InputStream input = resource.get().open()) {
                bytes = input.readNBytes(1024 * 1024);
            } catch (IOException | RuntimeException unreadable) {
                bytes = new byte[0];
            }
        }
        if (effectIcons.size() < 512) effectIcons.put(effectId, bytes);
        return bytes.length == 0 ? null : bytes;
    }

    /** Render thread, between frames. */
    void renderPending(Minecraft minecraft) {
        for (String key; (key = wanted.poll()) != null; ) {
            ItemStack stack = deferred.remove(key);
            CompletableFuture<byte[]> future = icons.get(key);
            if (stack == null || future == null || future.isDone()) continue;
            ItemStack copy = stack.copy();
            copy.set(DataComponents.ENCHANTMENT_GLINT_OVERRIDE, false);
            pending.addLast(new Pending(key, copy, future));
        }
        if (pending.isEmpty()) return;
        //? if >=26.1 {
        ensureTargets();
        GpuDevice device = RenderSystem.getDevice();
        CommandEncoder encoder = device.createCommandEncoder();
        var gameRenderer = minecraft.gameRenderer;
        var bufferSource = minecraft.renderBuffers().bufferSource();
        RenderSystem.backupProjectionMatrix();
        try {
            for (int index = 0; index < RENDERS_PER_TICK && !pending.isEmpty(); index++) {
                Pending item = pending.removeFirst();
                if (icons.get(item.key) != item.result) continue;
                poseStack.pushPose();
                try {
                    TrackingItemStackRenderState state = new TrackingItemStackRenderState();
                    minecraft.getItemModelResolver().updateForTopItem(state, item.stack, ItemDisplayContext.GUI,
                            minecraft.level, minecraft.player, 0);
                    encoder.clearColorAndDepthTextures(colorTexture, 0, depthTexture, 1.0);
                    poseStack.translate(SIZE / 2.0F, SIZE / 2.0F, 0.0F);
                    poseStack.scale(SIZE, -SIZE, SIZE);
                    RenderSystem.outputColorTextureOverride = colorView;
                    RenderSystem.outputDepthTextureOverride = depthView;
                    projection.setupOrtho(-1000.0F, 1000.0F, SIZE, SIZE, true);
                    RenderSystem.setProjectionMatrix(projectionBuffer.getBuffer(projection), ProjectionType.ORTHOGRAPHIC);
                    gameRenderer.getLighting().setupFor(state.usesBlockLight()
                            ? Lighting.Entry.ITEMS_3D : Lighting.Entry.ITEMS_FLAT);
                    state.submit(poseStack, gameRenderer.getSubmitNodeStorage(), 15728880, OverlayTexture.NO_OVERLAY, 0);
                    gameRenderer.getFeatureRenderDispatcher().renderAllFeatures();
                    bufferSource.endBatch();
                } catch (RuntimeException failure) {
                    item.result.complete(null);
                    LOGGER.log(Level.FINE, "MinePanel could not render an item icon.", failure);
                    continue;
                } finally {
                    RenderSystem.outputColorTextureOverride = null;
                    RenderSystem.outputDepthTextureOverride = null;
                    poseStack.popPose();
                }
                readBack(device, encoder, item.result);
            }
        } finally {
            RenderSystem.restoreProjectionMatrix();
        }
        //?} else {
        /*// As GuiGraphics.renderItem, into an off-screen target instead of the screen.
        if (target == null) {
            target = new TextureTarget(SIZE, SIZE, true, Minecraft.ON_OSX);
            target.setClearColor(0, 0, 0, 0);
        }
        var bufferSource = minecraft.renderBuffers().bufferSource();
        var modelView = RenderSystem.getModelViewStack();
        // At tick time the last frame's blit left the screen bound, its viewport set and the depth test off; GUI item
        // rendering (and custom item renderers that draw directly, e.g. NeoForge BEWLRs) runs with the depth test on.
        int framebuffer = GlStateManager.getBoundFramebuffer();
        int[] viewport = {GlStateManager.Viewport.x(), GlStateManager.Viewport.y(), GlStateManager.Viewport.width(),
                GlStateManager.Viewport.height()};
        boolean depthTest = GL11.glIsEnabled(GL11.GL_DEPTH_TEST);
        RenderSystem.enableDepthTest();
        RenderSystem.backupProjectionMatrix();
        modelView.pushMatrix();
        modelView.identity();
        RenderSystem.applyModelViewMatrix();
        RenderSystem.setProjectionMatrix(new Matrix4f().setOrtho(0, SIZE, SIZE, 0, -1000, 1000),
                VertexSorting.ORTHOGRAPHIC_Z);
        try {
            for (int index = 0; index < RENDERS_PER_TICK && !pending.isEmpty(); index++) {
                Pending item = pending.removeFirst();
                if (icons.get(item.key) != item.result) continue;
                poseStack.pushPose();
                try {
                    var model = minecraft.getItemRenderer().getModel(item.stack, minecraft.level, minecraft.player, 0);
                    target.clear(Minecraft.ON_OSX);
                    target.bindWrite(true);
                    poseStack.translate(SIZE / 2.0F, SIZE / 2.0F, 0.0F);
                    poseStack.scale(SIZE, -SIZE, SIZE);
                    if (model.usesBlockLight()) Lighting.setupFor3DItems();
                    else Lighting.setupForFlatItems();
                    minecraft.getItemRenderer().render(item.stack, ItemDisplayContext.GUI, false, poseStack, bufferSource,
                            15728880, OverlayTexture.NO_OVERLAY, model);
                    bufferSource.endBatch();
                    item.result.complete(png(readTarget()));
                } catch (RuntimeException failure) {
                    item.result.complete(null);
                    LOGGER.log(Level.FINE, "MinePanel could not render an item icon.", failure);
                } finally {
                    poseStack.popPose();
                }
            }
        } finally {
            modelView.popMatrix();
            RenderSystem.applyModelViewMatrix();
            RenderSystem.restoreProjectionMatrix();
            Lighting.setupFor3DItems();
            if (!depthTest) RenderSystem.disableDepthTest();
            GlStateManager._glBindFramebuffer(GL30.GL_FRAMEBUFFER, framebuffer);
            RenderSystem.viewport(viewport[0], viewport[1], viewport[2], viewport[3]);
        }
        *///?}
    }

    /** RGBA pixels as the GPU returns them (rows bottom-up, colour premultiplied by alpha) as a PNG. */
    private static byte[] png(byte[] gpu) {
        byte[] rgba = new byte[SIZE * SIZE * 4];
        for (int y = 0; y < SIZE; y++) {
            // GPU rows are bottom-up; PNG rows are top-down.
            int source = (SIZE - 1 - y) * SIZE * 4;
            for (int x = 0; x < SIZE * 4; x += 4) {
                int target = y * SIZE * 4 + x;
                int alpha = gpu[source + x + 3] & 0xff;
                for (int channel = 0; channel < 3; channel++) {
                    int value = gpu[source + x + channel] & 0xff;
                    // Translucent blending onto a transparent clear premultiplies colour by alpha.
                    rgba[target + channel] = (byte) (alpha == 0 ? 0 : Math.min(255, value * 255 / alpha));
                }
                rgba[target + 3] = (byte) alpha;
            }
        }
        return PngEncoder.encode(SIZE, SIZE, rgba);
    }

    //? if >=26.1 {
    private void readBack(GpuDevice device, CommandEncoder encoder, CompletableFuture<byte[]> result) {
        GpuBuffer buffer = device.createBuffer(() -> "MinePanel icon readback",
                GpuBuffer.USAGE_MAP_READ | GpuBuffer.USAGE_COPY_DST, (long) SIZE * SIZE * 4);
        encoder.copyTextureToBuffer(colorTexture, buffer, 0L, () -> {
            try (GpuBuffer.MappedView view = encoder.mapBuffer(buffer, true, false)) {
                byte[] gpu = new byte[SIZE * SIZE * 4];
                view.data().get(0, gpu);
                result.complete(png(gpu));
            } catch (RuntimeException failure) {
                result.complete(null);
            } finally {
                buffer.close();
            }
        }, 0);
    }

    private void ensureTargets() {
        if (colorTexture != null) return;
        GpuDevice device = RenderSystem.getDevice();
        colorTexture = device.createTexture("MinePanel icon", GpuTexture.USAGE_COPY_DST | GpuTexture.USAGE_COPY_SRC
                | GpuTexture.USAGE_TEXTURE_BINDING | GpuTexture.USAGE_RENDER_ATTACHMENT, TextureFormat.RGBA8, SIZE, SIZE, 1, 1);
        colorView = device.createTextureView(colorTexture);
        depthTexture = device.createTexture("MinePanel icon depth",
                GpuTexture.USAGE_COPY_DST | GpuTexture.USAGE_RENDER_ATTACHMENT, TextureFormat.DEPTH32, SIZE, SIZE, 1, 1);
        depthView = device.createTextureView(depthTexture);
        projectionBuffer = new ProjectionMatrixBuffer("MinePanel icons");
    }
    //?} else {
    /*// Synchronous glGetTexImage: at most RENDERS_PER_TICK small reads per tick, only while icons are missing.
    private byte[] readTarget() {
        byte[] gpu = new byte[SIZE * SIZE * 4];
        RenderSystem.bindTexture(target.getColorTextureId());
        try (NativeImage image = new NativeImage(SIZE, SIZE, false)) {
            image.downloadTexture(0, false);
            for (int y = 0; y < SIZE; y++) {
                for (int x = 0; x < SIZE; x++) {
                    int abgr = image.getPixelRGBA(x, y);
                    int index = (y * SIZE + x) * 4;
                    gpu[index] = (byte) abgr;
                    gpu[index + 1] = (byte) (abgr >> 8);
                    gpu[index + 2] = (byte) (abgr >> 16);
                    gpu[index + 3] = (byte) (abgr >>> 24);
                }
            }
        }
        return gpu;
    }
    *///?}
}
