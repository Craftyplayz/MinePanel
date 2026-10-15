package dev.craftyplayz.minepanel.service;

import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.util.zip.CRC32;
import java.util.zip.Deflater;

/** Minimal RGBA PNG writer, so icon export does not depend on AWT/ImageIO inside the game client. */
public final class PngEncoder {
    private static final byte[] SIGNATURE = {(byte) 0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n'};

    private PngEncoder() {
    }

    /** @param rgba row-major pixels, top row first, four bytes per pixel in R, G, B, A order */
    public static byte[] encode(int width, int height, byte[] rgba) {
        if (width <= 0 || height <= 0 || rgba.length != width * height * 4) {
            throw new IllegalArgumentException("pixel data does not match image size");
        }
        byte[] raw = new byte[height * (width * 4 + 1)];
        for (int y = 0; y < height; y++) {
            int row = y * (width * 4 + 1);
            raw[row] = 0;
            System.arraycopy(rgba, y * width * 4, raw, row + 1, width * 4);
        }
        Deflater deflater = new Deflater(Deflater.BEST_COMPRESSION);
        deflater.setInput(raw);
        deflater.finish();
        ByteArrayOutputStream compressed = new ByteArrayOutputStream();
        byte[] buffer = new byte[8192];
        while (!deflater.finished()) {
            compressed.write(buffer, 0, deflater.deflate(buffer));
        }
        deflater.end();

        ByteArrayOutputStream png = new ByteArrayOutputStream();
        png.writeBytes(SIGNATURE);
        ByteBuffer header = ByteBuffer.allocate(13).putInt(width).putInt(height)
                .put((byte) 8).put((byte) 6).put((byte) 0).put((byte) 0).put((byte) 0);
        chunk(png, "IHDR", header.array());
        chunk(png, "IDAT", compressed.toByteArray());
        chunk(png, "IEND", new byte[0]);
        return png.toByteArray();
    }

    private static void chunk(ByteArrayOutputStream output, String type, byte[] data) {
        byte[] name = type.getBytes(StandardCharsets.US_ASCII);
        CRC32 crc = new CRC32();
        crc.update(name);
        crc.update(data);
        output.writeBytes(ByteBuffer.allocate(4).putInt(data.length).array());
        output.writeBytes(name);
        output.writeBytes(data);
        output.writeBytes(ByteBuffer.allocate(4).putInt((int) crc.getValue()).array());
    }
}
