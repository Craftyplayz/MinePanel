package dev.craftyplayz.minepanel.service;

import dev.craftyplayz.minepanel.telemetry.TelemetryStore;

import java.io.BufferedInputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.SocketException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Base64;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.SynchronousQueue;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.logging.Logger;

final class LocalWebSocketServer implements AutoCloseable {
    private static final Logger LOGGER = Logger.getLogger("MinePanel");
    private static final String WEBSOCKET_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
    private static final int MAX_HANDSHAKE_BYTES = 16 * 1024;
    private static final int MAX_CLIENT_FRAME_BYTES = 1024;

    private final ServerSocket listener;
    private final TelemetryStore telemetry;
    private final String token;
    private final int httpPort;
    private final Set<Socket> clients = ConcurrentHashMap.newKeySet();
    private final ThreadPoolExecutor handlers;
    private volatile boolean running;
    private Thread acceptThread;

    LocalWebSocketServer(TelemetryStore telemetry, String token, int httpPort) throws IOException {
        this.telemetry = telemetry;
        this.token = token;
        this.httpPort = httpPort;
        listener = new ServerSocket(0, 16, InetAddress.getByName("127.0.0.1"));
        ThreadFactory factory = runnable -> {
            Thread thread = new Thread(runnable, "MinePanel-websocket-client");
            thread.setDaemon(true);
            return thread;
        };
        handlers = new ThreadPoolExecutor(0, 8, 30, TimeUnit.SECONDS,
                new SynchronousQueue<>(), factory, new ThreadPoolExecutor.AbortPolicy());
    }

    int getPort() {
        return listener.getLocalPort();
    }

    void start() {
        running = true;
        acceptThread = new Thread(this::acceptLoop, "MinePanel-websocket-accept");
        acceptThread.setDaemon(true);
        acceptThread.start();
    }

    @Override
    public void close() {
        running = false;
        try {
            listener.close();
        } catch (IOException ignored) {
        }
        clients.forEach(LocalWebSocketServer::closeQuietly);
        handlers.shutdownNow();
        if (acceptThread != null) {
            acceptThread.interrupt();
        }
    }

    private void acceptLoop() {
        while (running) {
            try {
                Socket socket = listener.accept();
                socket.setSoTimeout(5000);
                clients.add(socket);
                try {
                    handlers.execute(() -> handle(socket));
                } catch (RuntimeException rejected) {
                    clients.remove(socket);
                    closeQuietly(socket);
                }
            } catch (SocketException closed) {
                if (running) {
                    LOGGER.fine("Local WebSocket listener stopped unexpectedly.");
                }
                return;
            } catch (IOException failure) {
                if (running) {
                    LOGGER.fine("Local WebSocket connection was rejected.");
                }
            }
        }
    }

    private void handle(Socket socket) {
        try (socket) {
            BufferedInputStream input = new BufferedInputStream(socket.getInputStream());
            OutputStream output = socket.getOutputStream();
            Map<String, String> headers = readHandshake(input);
            if (!validHandshake(headers)) {
                writeHttpError(output, 403, "Forbidden");
                return;
            }

            String key = headers.get("sec-websocket-key");
            String accept = Base64.getEncoder().encodeToString(
                    MessageDigest.getInstance("SHA-1")
                            .digest((key + WEBSOCKET_GUID).getBytes(StandardCharsets.ISO_8859_1)));
            String response = "HTTP/1.1 101 Switching Protocols\r\n"
                    + "Upgrade: websocket\r\n"
                    + "Connection: Upgrade\r\n"
                    + "Sec-WebSocket-Accept: " + accept + "\r\n\r\n";
            output.write(response.getBytes(StandardCharsets.ISO_8859_1));
            output.flush();

            socket.setSoTimeout(100);
            long lastRevision = -1;
            dev.craftyplayz.minepanel.telemetry.PlayerSnapshot lastSnapshot = null;
            while (running && !socket.isClosed()) {
                var snapshot = telemetry.player();
                if (snapshot.revision() != lastRevision) {
                    String type = lastRevision < 0 ? "initial" : "update";
                    String version = LocalWebSocketServer.class.getPackage().getImplementationVersion();
                    if (version == null) {
                        version = "development";
                    }
                    String json = "{\"schemaVersion\":1,\"type\":\"" + type + "\",\"modVersion\":\""
                            + version + "\",\"state\":"
                            + (lastSnapshot == null ? snapshot.toJson() : snapshot.toDeltaJson(lastSnapshot)) + "}";
                    writeFrame(output, 0x1, json.getBytes(StandardCharsets.UTF_8));
                    lastRevision = snapshot.revision();
                    lastSnapshot = snapshot;
                }
                readClientFrame(socket, input, output);
            }
        } catch (java.net.SocketTimeoutException ignored) {
        } catch (Exception failure) {
            LOGGER.fine("Local WebSocket client disconnected.");
        } finally {
            clients.remove(socket);
            closeQuietly(socket);
        }
    }

    private Map<String, String> readHandshake(BufferedInputStream input) throws IOException {
        int[] consumed = {0};
        String request = readLine(input, consumed);
        if (!"GET /ws HTTP/1.1".equals(request)) {
            return Map.of();
        }
        Map<String, String> headers = new HashMap<>();
        while (true) {
            String line = readLine(input, consumed);
            if (line.isEmpty()) {
                return headers;
            }
            int separator = line.indexOf(':');
            if (separator <= 0) {
                return Map.of();
            }
            String name = line.substring(0, separator).trim().toLowerCase(Locale.ROOT);
            String value = line.substring(separator + 1).trim();
            if (headers.putIfAbsent(name, value) != null) {
                return Map.of();
            }
        }
    }

    private String readLine(BufferedInputStream input, int[] consumed) throws IOException {
        StringBuilder line = new StringBuilder();
        int previous = -1;
        while (true) {
            int value = input.read();
            if (value < 0) {
                throw new IOException("Unexpected end of WebSocket handshake");
            }
            if (++consumed[0] > MAX_HANDSHAKE_BYTES) {
                throw new IOException("WebSocket handshake too large");
            }
            if (previous == '\r' && value == '\n') {
                line.setLength(line.length() - 1);
                return line.toString();
            }
            line.append((char) value);
            previous = value;
        }
    }

    private boolean validHandshake(Map<String, String> headers) {
        String host = headers.get("host");
        int port = listener.getLocalPort();
        boolean validHost = ("127.0.0.1:" + port).equalsIgnoreCase(host)
                || ("localhost:" + port).equalsIgnoreCase(host);
        String origin = headers.get("origin");
        boolean validOrigin = ("http://127.0.0.1:" + httpPort).equals(origin)
                || ("http://localhost:" + httpPort).equals(origin);
        String connection = headers.getOrDefault("connection", "");
        String cookie = headers.getOrDefault("cookie", "");
        boolean hasSessionCookie = false;
        for (String pair : cookie.split(";")) {
            String trimmed = pair.trim();
            int separator = trimmed.indexOf('=');
            if (separator > 0 && trimmed.substring(0, separator).equalsIgnoreCase("MinePanelSession")) {
                hasSessionCookie = MessageDigest.isEqual(
                        token.getBytes(StandardCharsets.US_ASCII),
                        trimmed.substring(separator + 1).getBytes(StandardCharsets.US_ASCII));
            }
        }
        String key = headers.get("sec-websocket-key");
        boolean validKey = false;
        if (key != null) {
            try {
                validKey = Base64.getDecoder().decode(key).length == 16;
            } catch (IllegalArgumentException ignored) {
            }
        }
        return validHost && validOrigin && hasSessionCookie
                && "websocket".equalsIgnoreCase(headers.get("upgrade"))
                && containsToken(connection, "upgrade")
                && "13".equals(headers.get("sec-websocket-version")) && validKey;
    }

    private boolean containsToken(String value, String wanted) {
        for (String token : value.split(",")) {
            if (token.trim().equalsIgnoreCase(wanted)) {
                return true;
            }
        }
        return false;
    }

    private void readClientFrame(Socket socket, BufferedInputStream input, OutputStream output) throws IOException {
        int first;
        try {
            first = input.read();
        } catch (java.net.SocketTimeoutException idle) {
            return;
        }
        if (first < 0) {
            throw new IOException("WebSocket client closed");
        }
        socket.setSoTimeout(5000);
        try {
            int second = input.read();
            if (second < 0) {
                throw new IOException("Incomplete WebSocket frame");
            }
            int opcode = first & 0x0f;
            boolean masked = (second & 0x80) != 0;
            long length = second & 0x7f;
            if (length == 126) {
                length = readUnsignedShort(input);
            } else if (length == 127) {
                throw new IOException("Large client frames are not supported");
            }
            if (!masked || (first & 0x70) != 0 || length > MAX_CLIENT_FRAME_BYTES
                    || (opcode >= 0x8 && (length > 125 || (first & 0x80) == 0))) {
                throw new IOException("Invalid client WebSocket frame");
            }
            byte[] mask = input.readNBytes(4);
            byte[] payload = input.readNBytes((int) length);
            if (mask.length != 4 || payload.length != length) {
                throw new IOException("Incomplete client WebSocket payload");
            }
            for (int index = 0; index < payload.length; index++) {
                payload[index] ^= mask[index & 3];
            }
            if (opcode == 0x8) {
                writeFrame(output, 0x8, payload);
                throw new IOException("WebSocket client closed");
            }
            if (opcode == 0x9) {
                writeFrame(output, 0xA, payload);
            } else if (opcode != 0xA) {
                throw new IOException("Unsupported WebSocket operation");
            }
        } finally {
            if (!socket.isClosed()) {
                socket.setSoTimeout(100);
            }
        }
    }

    private int readUnsignedShort(BufferedInputStream input) throws IOException {
        int high = input.read();
        int low = input.read();
        if (high < 0 || low < 0) {
            throw new IOException("Incomplete WebSocket frame length");
        }
        return (high << 8) | low;
    }

    private void writeFrame(OutputStream output, int opcode, byte[] payload) throws IOException {
        if (payload.length > 65535) {
            throw new IOException("Server WebSocket message too large");
        }
        output.write(0x80 | opcode);
        if (payload.length < 126) {
            output.write(payload.length);
        } else {
            output.write(126);
            output.write((payload.length >>> 8) & 0xff);
            output.write(payload.length & 0xff);
        }
        output.write(payload);
        output.flush();
    }

    private void writeHttpError(OutputStream output, int status, String message) throws IOException {
        byte[] body = message.getBytes(StandardCharsets.UTF_8);
        output.write(("HTTP/1.1 " + status + " " + message + "\r\n"
                + "Connection: close\r\nContent-Length: " + body.length + "\r\n\r\n")
                .getBytes(StandardCharsets.ISO_8859_1));
        output.write(body);
        output.flush();
    }

    private static void closeQuietly(Socket socket) {
        try {
            socket.close();
        } catch (IOException ignored) {
        }
    }
}
