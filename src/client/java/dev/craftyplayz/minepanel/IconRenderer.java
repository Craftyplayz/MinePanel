package dev.craftyplayz.minepanel;

import com.mojang.blaze3d.ProjectionType;
import com.mojang.blaze3d.buffers.GpuBuffer;
import com.mojang.blaze3d.platform.Lighting;
import com.mojang.blaze3d.systems.CommandEncoder;
import com.mojang.blaze3d.systems.GpuDevice;
import com.mojang.blaze3d.systems.RenderSystem;
import com.mojang.blaze3d.textures.GpuTexture;
import com.mojang.blaze3d.textures.GpuTextureView;
import com.mojang.blaze3d.textures.TextureFormat;
import com.mojang.blaze3d.vertex.PoseStack;
import dev.craftyplayz.minepanel.service.IconSource;
import dev.craftyplayz.minepanel.service.PngEncoder;
import net.minecraft.client.Minecraft;
import net.minecraft.client.renderer.Projection;
import net.minecraft.client.renderer.ProjectionMatrixBuffer;
import net.minecraft.client.renderer.item.TrackingItemStackRenderState;
import net.minecraft.client.renderer.texture.OverlayTexture;
import net.minecraft.core.component.DataComponents;
import net.minecraft.resources.Identifier;
import net.minecraft.world.item.ItemDisplayContext;
import net.minecraft.world.item.ItemStack;

import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayDeque;
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

    private final Map<String, CompletableFuture<byte[]>> icons = new ConcurrentHashMap<>();
    // Registry entries the pickers list: rendered only when the dashboard first asks for one (any thread).
    private final Map<String, ItemStack> deferred = new ConcurrentHashMap<>();
    private final ConcurrentLinkedQueue<String> wanted = new ConcurrentLinkedQueue<>();
    private final ArrayDeque<Pending> pending = new ArrayDeque<>();
    private final Map<String, byte[]> effectIcons = new ConcurrentHashMap<>();
    private final PoseStack poseStack = new PoseStack();
    private final Projection projection = new Projection();
    private volatile int epoch;
    private GpuTexture colorTexture;
    private GpuTextureView colorView;
    private GpuTexture depthTexture;
    private GpuTextureView depthView;
    private ProjectionMatrixBuffer projectionBuffer;

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
    }

    private void readBack(GpuDevice device, CommandEncoder encoder, CompletableFuture<byte[]> result) {
        GpuBuffer buffer = device.createBuffer(() -> "MinePanel icon readback",
                GpuBuffer.USAGE_MAP_READ | GpuBuffer.USAGE_COPY_DST, (long) SIZE * SIZE * 4);
        encoder.copyTextureToBuffer(colorTexture, buffer, 0L, () -> {
            try (GpuBuffer.MappedView view = encoder.mapBuffer(buffer, true, false)) {
                byte[] rgba = new byte[SIZE * SIZE * 4];
                var data = view.data();
                for (int y = 0; y < SIZE; y++) {
                    // GPU rows are bottom-up; PNG rows are top-down.
                    int source = (SIZE - 1 - y) * SIZE * 4;
                    for (int x = 0; x < SIZE * 4; x += 4) {
                        int target = y * SIZE * 4 + x;
                        int alpha = data.get(source + x + 3) & 0xff;
                        for (int channel = 0; channel < 3; channel++) {
                            int value = data.get(source + x + channel) & 0xff;
                            // Translucent blending onto a transparent clear premultiplies colour by alpha.
                            rgba[target + channel] = (byte) (alpha == 0 ? 0 : Math.min(255, value * 255 / alpha));
                        }
                        rgba[target + 3] = (byte) alpha;
                    }
                }
                result.complete(PngEncoder.encode(SIZE, SIZE, rgba));
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
}
