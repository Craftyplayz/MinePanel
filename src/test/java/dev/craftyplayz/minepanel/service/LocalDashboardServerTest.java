package dev.craftyplayz.minepanel.service;

import dev.craftyplayz.minepanel.telemetry.PlayerSnapshot;
import dev.craftyplayz.minepanel.telemetry.TelemetryStore;
import dev.craftyplayz.minepanel.telemetry.InventorySnapshot;
import dev.craftyplayz.minepanel.telemetry.InventorySnapshotTest;
import dev.craftyplayz.minepanel.telemetry.ItemSnapshot;
import dev.craftyplayz.minepanel.telemetry.StatisticsAndHistoryTest;
import dev.craftyplayz.minepanel.telemetry.ItemExtractorTest;

import java.net.URI;
import java.net.Socket;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.io.BufferedInputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

public final class LocalDashboardServerTest {
    private static final HttpClient CLIENT = HttpClient.newHttpClient();

    public static void main(String[] args) throws Exception {
        InventorySnapshotTest.main(args);
        ItemExtractorTest.main(args);
        StatisticsAndHistoryTest.main(args);
        testTelemetrySnapshots();
        testWebSocketPush();
        testShutdown();
        try (LocalDashboardServer server = new LocalDashboardServer()) {
            server.start();
            URI base = URI.create(server.getUrl());
            check("127.0.0.1".equals(base.getHost()), "server binds to IPv4 loopback");
            check(get(base).statusCode() == 200, "dashboard is served");
            check(get(base.resolve("app.js")).statusCode() == 200, "frontend script is served");

            HttpResponse<String> unauthorized = get(base.resolve("api/state"));
            check(unauthorized.statusCode() == 401, "state requires a token");
            HttpRequest invalidTokenRequest = HttpRequest.newBuilder(base.resolve("api/state"))
                    .header("Authorization", "******")
                    .GET()
                    .build();
            check(CLIENT.send(invalidTokenRequest, HttpResponse.BodyHandlers.ofString()).statusCode() == 401,
                    "state rejects an invalid token");

            HttpResponse<String> noBrowserContext = get(base.resolve("api/session"));
            check(noBrowserContext.statusCode() == 403, "token endpoint rejects non-browser requests");

            HttpRequest crossOrigin = HttpRequest.newBuilder(base.resolve("api/session"))
                    .header("Sec-Fetch-Site", "same-origin")
                    .header("Origin", "https://attacker.example")
                    .GET()
                    .build();
            check(CLIENT.send(crossOrigin, HttpResponse.BodyHandlers.ofString()).statusCode() == 403,
                    "token endpoint rejects an untrusted origin");

            HttpRequest sessionRequest = HttpRequest.newBuilder(base.resolve("api/session"))
                    .header("Sec-Fetch-Site", "same-origin")
                    .GET()
                    .build();
            HttpResponse<String> session = CLIENT.send(sessionRequest, HttpResponse.BodyHandlers.ofString());
            String sessionCookie = session.headers().firstValue("set-cookie").orElseThrow().split(";", 2)[0];
            Matcher token = Pattern.compile("MinePanelSession=([a-f0-9]{64})").matcher(sessionCookie);
            check(session.statusCode() == 200 && token.find()
                            && session.body().contains("\"websocketPort\":"),
                    "same-origin browser receives an HttpOnly session cookie and WebSocket endpoint");
            String sessionToken = token.group(1);

            HttpRequest authorizedRequest = HttpRequest.newBuilder(base.resolve("api/state"))
                    .header("Authorization", "Bearer " + sessionToken)
                    .GET()
                    .build();
            HttpResponse<String> state = CLIENT.send(authorizedRequest, HttpResponse.BodyHandlers.ofString());
            check(state.statusCode() == 200 && state.body().contains("\"schemaVersion\":2")
                            && state.body().contains("\"modVersion\"")
                            && state.body().contains("\"player\":{\"schemaVersion\":2")
                            && state.body().contains("\"available\":false"),
                    "authorized client receives a versioned initial status");

            try (LocalDashboardServer secondServer = new LocalDashboardServer()) {
                secondServer.start();
                HttpRequest crossSession = HttpRequest.newBuilder(URI.create(secondServer.getUrl()).resolve("api/state"))
                        .header("Authorization", "Bearer " + sessionToken)
                        .GET()
                        .build();
                check(CLIENT.send(crossSession, HttpResponse.BodyHandlers.ofString()).statusCode() == 401,
                        "session token is not shared between server instances");
            }

            HttpRequest unsupported = HttpRequest.newBuilder(base.resolve("api/command"))
                    .header("Sec-Fetch-Site", "same-origin")
                    .GET()
                    .build();
            check(CLIENT.send(unsupported, HttpResponse.BodyHandlers.ofString()).statusCode() == 404,
                    "unsupported operation is rejected");

            HttpRequest malformedMethod = HttpRequest.newBuilder(base.resolve("api/state"))
                    .header("Authorization", "Bearer " + sessionToken)
                    .POST(HttpRequest.BodyPublishers.ofString("ignored"))
                    .build();
            check(CLIENT.send(malformedMethod, HttpResponse.BodyHandlers.ofString()).statusCode() == 405,
                    "non-GET operation is rejected");
        }
        System.out.println("MinePanel local dashboard service tests passed.");
    }

    private static void testTelemetrySnapshots() {
        TelemetryStore store = new TelemetryStore();
        PlayerSnapshot unavailable = store.player();
        check(!unavailable.available(), "initial player state is explicitly unavailable");
        check(unavailable.toJson().contains("\"position\":{\"x\":null,\"y\":null,\"z\":null}"),
                "unavailable values serialize as null instead of fabricated values");

        check(store.updatePlayer(1000, 0L, "minecraft:overworld", 1.25, 64.0, -2.5,
                18.0, 20.0, 2.0), "first player sample is published");
        PlayerSnapshot initial = store.player();
        check(initial.revision() == 1 && initial.available(), "first sample advances the state revision");
        check(initial.toJson().contains("\"health\":18.0")
                        && initial.toJson().contains("\"dimension\":\"minecraft:overworld\""),
                "snapshot serializes telemetry and dimension");

        check(!store.updatePlayer(1250, 0L, "minecraft:overworld", 1.25, 64.0, -2.5,
                        18.0, 20.0, 2.0),
                "identical state does not create a redundant update");
        check(store.updatePlayer(1500, 1L, "minecraft:the_nether", 1.25, 64.0, -2.5,
                        18.0, 20.0, 2.0),
                "world and session changes publish a new sample");
        check(store.player().revision() == 2, "changed snapshot advances revision once");
        check(store.player().toDeltaJson(initial).contains("\"dimension\":\"minecraft:the_nether\"")
                        && !store.player().toDeltaJson(initial).contains("\"health\""),
                "updates serialize only changed snapshot fields");
        check(store.markUnavailable(2000), "disconnect marks player state unavailable");
        check(!store.player().available() && store.player().revision() == 3,
                "unavailable transition advances revision");
        check(!store.markUnavailable(2250), "repeated unavailable state is not republished");

        PlayerSnapshot escaped = new PlayerSnapshot(1, 0, true, 1L, "custom:\"world",
                0.0, 0.0, 0.0, 1.0, 1.0, 0.0);
        check(escaped.toJson().contains("custom:\\\"world"), "strings are JSON escaped");
        expectInvalid(() -> new PlayerSnapshot(0, 0, true, 0L, "dimension",
                Double.NaN, 0.0, 0.0, 1.0, 1.0, 0.0));
        expectInvalid(() -> new PlayerSnapshot(0, 0, false, 0L, "dimension",
                null, null, null, null, null, null));
    }

    private static void expectInvalid(Runnable constructor) {
        try {
            constructor.run();
            throw new AssertionError("invalid snapshot should be rejected");
        } catch (IllegalArgumentException | NullPointerException expected) {
            // Invalid values are rejected at the immutable data boundary.
        }
    }

    private static void testWebSocketPush() throws Exception {
        TelemetryStore telemetry = new TelemetryStore();
        telemetry.updatePlayer(1000, 0L, "minecraft:overworld", 1.0, 64.0, 2.0,
                20.0, 20.0, 0.0);
        try (LocalDashboardServer server = new LocalDashboardServer(telemetry)) {
            server.start();
            URI base = URI.create(server.getUrl());
            HttpRequest sessionRequest = HttpRequest.newBuilder(base.resolve("api/session"))
                    .header("Sec-Fetch-Site", "same-origin")
                    .GET()
                    .build();
            HttpResponse<String> session = CLIENT.send(sessionRequest, HttpResponse.BodyHandlers.ofString());
            Matcher portMatch = Pattern.compile("\"websocketPort\":(\\d+)").matcher(session.body());
            check(session.statusCode() == 200 && portMatch.find(), "browser session returns the assigned WebSocket port");
            int port = Integer.parseInt(portMatch.group(1));
            String cookie = session.headers().firstValue("set-cookie").orElseThrow().split(";", 2)[0];

            String rejected = websocketHandshake(port, "https://attacker.example", cookie);
            check(rejected.startsWith("HTTP/1.1 403"), "WebSocket rejects cross-origin connections");
            String unauthenticated = websocketHandshake(port,
                    "http://127.0.0.1:" + base.getPort(), null);
            check(unauthenticated.startsWith("HTTP/1.1 403"), "WebSocket rejects missing session cookies");

            try (Socket socket = new Socket("127.0.0.1", port)) {
                socket.setSoTimeout(5000);
                BufferedInputStream input = new BufferedInputStream(socket.getInputStream());
                OutputStream output = socket.getOutputStream();
                String request = "GET /ws HTTP/1.1\r\n"
                        + "Host: 127.0.0.1:" + port + "\r\n"
                        + "Origin: http://127.0.0.1:" + base.getPort() + "\r\n"
                        + "Upgrade: websocket\r\n"
                        + "Connection: keep-alive, Upgrade\r\n"
                        + "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n"
                        + "Sec-WebSocket-Version: 13\r\n"
                        + "Cookie: " + cookie + "\r\n\r\n";
                output.write(request.getBytes(StandardCharsets.ISO_8859_1));
                output.flush();
                check(readLine(input).startsWith("HTTP/1.1 101"), "valid browser session upgrades to WebSocket");
                String line;
                while (!(line = readLine(input)).isEmpty()) {
                    // Consume upgrade response headers before reading the first data frame.
                }
                String initial = readWebSocketText(input);
                check(initial.contains("\"type\":\"initial\"") && initial.contains("\"inventory\":{\"slots\":[")
                                && !initial.contains("baseRevision"),
                        "WebSocket sends an initial versioned state");
                HttpRequest stateRequest = HttpRequest.newBuilder(base.resolve("api/state"))
                        .header("Authorization", "Bearer " + cookie.substring(cookie.indexOf('=') + 1))
                        .GET().build();
                HttpResponse<String> state = CLIENT.send(stateRequest, HttpResponse.BodyHandlers.ofString());
                check(state.statusCode() == 200 && state.body().contains("\"inventory\":{\"slots\":[")
                                && state.body().contains("\"selectedHotbarSlot\":0")
                                && state.body().contains("\"equipment\":{\"head\":"),
                        "authenticated HTTP state exposes the same additive inventory snapshot");

                telemetry.updatePlayer(3000, 1L, "minecraft:overworld", 1.0, 65.0, 2.0,
                        19.0, 20.0, 0.0);
                String update = readWebSocketText(input);
                check(update.contains("\"type\":\"update\"")
                                && update.contains("\"health\":19.0")
                                && update.contains("\"baseRevision\":1")
                                && !update.contains("\"maxHealth\""),
                        "changed snapshots are pushed without a client request");
                var slots = InventorySnapshotTest.emptySlots();
                slots.set(0, InventorySnapshotTest.item(4));
                InventorySnapshot inventory = InventorySnapshot.collect(slots::get, 0,
                        key -> ItemSnapshot.emptyItem());
                telemetry.updatePlayer(3100, 1L, "minecraft:overworld", 1.0, 65.0, 2.0,
                        19.0, 20.0, 0.0, inventory);
                String inventoryUpdate = readWebSocketText(input);
                check(inventoryUpdate.contains("\"baseRevision\":2")
                               && inventoryUpdate.contains("\"index\":0,\"item\":")
                               && inventoryUpdate.contains("\"equipment\":{\"mainhand\":")
                               && !inventoryUpdate.contains("\"index\":1")
                               && !inventoryUpdate.contains("\"health\""),
                        "real WebSocket sends sparse inventory-only changes");
                telemetry.markUnavailable(3200);
                String disconnect = readWebSocketText(input);
                check(disconnect.contains("\"baseRevision\":3") && disconnect.contains("\"available\":false")
                               && disconnect.contains("\"inventory\":null"), "disconnect clears inventory over WebSocket");
                telemetry.updatePlayer(3300, 1L, "minecraft:overworld", 1.0, 65.0, 2.0,
                        19.0, 20.0, 0.0, inventory);
                String restored = readWebSocketText(input);
                check(restored.contains("\"baseRevision\":4") && restored.contains("\"available\":true")
                               && restored.contains("\"inventory\":{\"slots\":[{\"empty\":false"),
                        "player reconnect sends a complete inventory with baseline");
            }

            try (Socket reconnect = new Socket("127.0.0.1", port)) {
                reconnect.setSoTimeout(5000);
                BufferedInputStream input = new BufferedInputStream(reconnect.getInputStream());
                OutputStream output = reconnect.getOutputStream();
                String request = "GET /ws HTTP/1.1\r\n"
                        + "Host: 127.0.0.1:" + port + "\r\n"
                        + "Origin: http://127.0.0.1:" + base.getPort() + "\r\n"
                        + "Upgrade: websocket\r\n"
                        + "Connection: Upgrade\r\n"
                        + "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n"
                        + "Sec-WebSocket-Version: 13\r\n"
                        + "Cookie: " + cookie + "\r\n\r\n";
                output.write(request.getBytes(StandardCharsets.ISO_8859_1));
                output.flush();
                check(readLine(input).startsWith("HTTP/1.1 101"), "browser can reconnect after a disconnect");
                String line;
                while (!(line = readLine(input)).isEmpty()) {
                    // Consume upgrade response headers before reading the reconnect snapshot.
                }
                String initial = readWebSocketText(input);
                check(initial.contains("\"type\":\"initial\"")
                               && initial.contains("\"health\":19.0")
                               && initial.contains("\"inventory\":{\"slots\":[{\"empty\":false")
                               && !initial.contains("baseRevision"),
                        "reconnected browser receives the latest full snapshot");
                var enchantments = java.util.Collections.nCopies(64,
                        new ItemSnapshot.Enchantment("minecraft:unbreaking", "E".repeat(256), 255));
                ItemSnapshot largeItem = new ItemSnapshot(false, "minecraft:stone", "S".repeat(256),
                        64, 64, null, null, enchantments);
                InventorySnapshot largeInventory = InventorySnapshot.collect(index -> largeItem, 0, key -> largeItem);
                telemetry.updatePlayer(3400, 1L, "minecraft:overworld", 1.0, 65.0, 2.0,
                        19.0, 20.0, 0.0, largeInventory);
                String largeUpdate = readWebSocketText(input);
                check(largeUpdate.getBytes(StandardCharsets.UTF_8).length > 65535
                               && largeUpdate.contains("\"index\":35")
                               && largeUpdate.endsWith("}}}"),
                        "bounded large inventory deltas use complete 64-bit outgoing frames");
            }
        }
    }

    private static void testShutdown() throws Exception {
        LocalDashboardServer server = new LocalDashboardServer();
        server.start();
        URI http = URI.create(server.getUrl());
        int webSocketPort = server.getWebSocketPort();
        server.close();
        try {
            get(http);
            throw new AssertionError("HTTP listener should stop with the client");
        } catch (java.io.IOException expected) {
            check(true, "HTTP listener closes cleanly");
        }
        try {
            new Socket("127.0.0.1", webSocketPort).close();
            throw new AssertionError("WebSocket listener should stop with the client");
        } catch (java.io.IOException expected) {
            check(true, "WebSocket listener closes cleanly");
        }
    }

    private static String websocketHandshake(int port, String origin, String cookie) throws Exception {
        try (Socket socket = new Socket("127.0.0.1", port)) {
            socket.setSoTimeout(5000);
            OutputStream output = socket.getOutputStream();
            String request = "GET /ws HTTP/1.1\r\n"
                    + "Host: 127.0.0.1:" + port + "\r\n"
                    + "Origin: " + origin + "\r\n"
                    + "Upgrade: websocket\r\n"
                    + "Connection: Upgrade\r\n"
                    + "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n"
                    + "Sec-WebSocket-Version: 13\r\n"
                    + (cookie == null ? "" : "Cookie: " + cookie + "\r\n")
                    + "\r\n";
            output.write(request.getBytes(StandardCharsets.ISO_8859_1));
            output.flush();
            return readLine(new BufferedInputStream(socket.getInputStream()));
        }
    }

    private static String readWebSocketText(BufferedInputStream input) throws Exception {
        int first = input.read();
        int second = input.read();
        check(first >= 0 && second >= 0 && (first & 0x0f) == 0x1, "server sends a text WebSocket frame");
        check((first & 0x80) != 0 && (second & 0x80) == 0, "server frames are final and unmasked");
        long length = second & 0x7f;
        if (length == 126) {
            length = (input.read() << 8) | input.read();
        } else if (length == 127) {
            length = 0;
            for (int index = 0; index < 8; index++) {
                int next = input.read();
                check(next >= 0, "64-bit frame length is complete");
                length = (length << 8) | next;
            }
            check(length > 65535, "64-bit frame encoding used only for large payloads");
        }
        check(length >= 0 && length < 2 * 1024 * 1024, "WebSocket metadata stays bounded");
        byte[] payload = input.readNBytes((int) length);
        check(payload.length == length, "complete WebSocket payload received");
        return new String(payload, StandardCharsets.UTF_8);
    }

    private static String readLine(BufferedInputStream input) throws Exception {
        StringBuilder value = new StringBuilder();
        int previous = -1;
        while (true) {
            int current = input.read();
            if (current < 0) {
                throw new AssertionError("connection ended before a complete HTTP line");
            }
            if (previous == '\r' && current == '\n') {
                value.setLength(value.length() - 1);
                return value.toString();
            }
            value.append((char) current);
            previous = current;
        }
    }

    private static HttpResponse<String> get(URI uri) throws Exception {
        return CLIENT.send(HttpRequest.newBuilder(uri).GET().build(), HttpResponse.BodyHandlers.ofString());
    }

    private static void check(boolean condition, String message) {
        if (!condition) {
            throw new AssertionError(message);
        }
    }
}
