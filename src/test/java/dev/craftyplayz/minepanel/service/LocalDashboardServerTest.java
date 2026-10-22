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
        dev.craftyplayz.minepanel.telemetry.WorldFeaturesTest.main(args);
        dev.craftyplayz.minepanel.build.BuildProgressTest.main(args);
        testTelemetrySnapshots();
        testWebSocketPush();
        testShutdown();
        testPngEncoder();
        testLayoutAndIcons();
        testProfilesRulesAndWorlds();
        LayoutStoreTest.main(args);
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
            check(state.statusCode() == 200 && state.body().contains("\"schemaVersion\":5")
                            && state.body().contains("\"modVersion\"")
                            && state.body().contains("\"player\":{\"schemaVersion\":5")
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

    private static void testPngEncoder() {
        byte[] png = PngEncoder.encode(2, 1, new byte[] {(byte) 255, 0, 0, (byte) 255, 0, 0, 0, 0});
        check(png[0] == (byte) 0x89 && new String(png, 1, 3, StandardCharsets.US_ASCII).equals("PNG")
                        && new String(png, 12, 4, StandardCharsets.US_ASCII).equals("IHDR")
                        && png[24] == 8 && png[25] == 6,
                "PNG has a signature and an 8-bit RGBA header");
        try {
            PngEncoder.encode(2, 2, new byte[4]);
            throw new AssertionError("mismatched pixel data must be rejected");
        } catch (IllegalArgumentException expected) {
        }
    }

    private static void testLayoutAndIcons() throws Exception {
        java.nio.file.Path directory = java.nio.file.Files.createTempDirectory("minepanel-layout");
        java.nio.file.Path file = directory.resolve("minepanel").resolve("layout.json");
        byte[] icon = PngEncoder.encode(1, 1, new byte[4]);
        IconSource icons = new IconSource() {
            public byte[] icon(String key) {
                return key.equals("e0-abc") ? icon : null;
            }

            public byte[] texture(String key) {
                return key.equals("p0-skin") ? icon : null;
            }

            public byte[] effectIcon(String id) {
                return id.equals("minecraft:speed") ? icon : null;
            }
        };
        try (LocalDashboardServer server = new LocalDashboardServer(new TelemetryStore(), 0, icons,
                new LayoutStore(file))) {
            server.start();
            URI base = URI.create(server.getUrl());
            String origin = base.toString().substring(0, base.toString().length() - 1);
            for (String asset : new String[] {"protocol.js", "layout.js", "model.js", "styles.css"}) {
                check(get(base.resolve(asset)).statusCode() == 200, asset + " is served");
            }
            HttpResponse<byte[]> iconResponse = CLIENT.send(HttpRequest.newBuilder(base.resolve("icon/e0-abc.png")).GET().build(),
                    HttpResponse.BodyHandlers.ofByteArray());
            check(iconResponse.statusCode() == 200
                            && iconResponse.headers().firstValue("content-type").orElse("").equals("image/png")
                            && iconResponse.headers().firstValue("cache-control").orElse("").contains("immutable")
                            && java.util.Arrays.equals(iconResponse.body(), icon),
                    "rendered icons are served as cacheable PNGs");
            check(get(base.resolve("icon/e0-missing.png")).statusCode() == 404, "unknown icons are not found");
            check(get(base.resolve("icon/..%2Fsecret.png")).statusCode() == 404, "icon keys cannot escape");
            check(get(base.resolve("effect/minecraft/speed.png")).statusCode() == 200, "effect icons are served");
            check(get(base.resolve("effect/minecraft/flight.png")).statusCode() == 404, "unknown effect icons are not found");
            check(get(base.resolve("effect/Minecraft/../speed.png")).statusCode() == 404, "effect paths are strict");
            HttpResponse<byte[]> skin = CLIENT.send(HttpRequest.newBuilder(base.resolve("texture/p0-skin.png")).GET().build(),
                    HttpResponse.BodyHandlers.ofByteArray());
            check(skin.statusCode() == 200 && skin.headers().firstValue("content-type").orElse("").equals("image/png")
                            && java.util.Arrays.equals(skin.body(), icon), "skin and armor textures are served as PNGs");
            check(get(base.resolve("texture/r0-missing.png")).statusCode() == 404, "unknown textures are not found");
            check(get(base.resolve("texture/P0-skin.png")).statusCode() == 404, "texture keys are strict");
            String csp = get(base).headers().firstValue("content-security-policy").orElse("");
            check(csp.contains("frame-src http://127.0.0.1:* http://localhost:*")
                            && csp.contains("connect-src 'self' ws://127.0.0.1:") && !csp.contains("https:"),
                    "only local map servers may be embedded or probed");

            check(get(base.resolve("api/layout")).statusCode() == 401, "layout requires the session cookie");
            HttpResponse<String> session = CLIENT.send(HttpRequest.newBuilder(base.resolve("api/session"))
                    .header("Sec-Fetch-Site", "same-origin").GET().build(), HttpResponse.BodyHandlers.ofString());
            String cookie = session.headers().firstValue("set-cookie").orElseThrow().split(";", 2)[0];
            HttpResponse<String> empty = CLIENT.send(HttpRequest.newBuilder(base.resolve("api/layout"))
                    .header("Cookie", cookie).GET().build(), HttpResponse.BodyHandlers.ofString());
            check(empty.statusCode() == 200 && empty.body().equals("{\"layout\":null}"), "no layout saved yet");

            String layout = "{\"version\":2,\"extra\":true,\"tiles\":[{\"id\":\"player\",\"enabled\":true,"
                    + "\"x\":2,\"y\":0,\"w\":4,\"h\":5,\"note\":\"dropped\"}]}";
            check(put(base, cookie, origin, "application/json", layout).statusCode() == 200, "layout saved");
            String saved = java.nio.file.Files.readString(file);
            check(saved.equals("{\"version\":2,\"tiles\":[{\"id\":\"player\",\"enabled\":true,\"x\":2,\"y\":0,\"w\":4,\"h\":5}]}"),
                    "layout file keeps only validated fields");
            HttpResponse<String> loaded = CLIENT.send(HttpRequest.newBuilder(base.resolve("api/layout"))
                    .header("Cookie", cookie).GET().build(), HttpResponse.BodyHandlers.ofString());
            check(loaded.body().equals("{\"layout\":" + saved + "}"), "saved layout is returned");

            check(put(base, "MinePanelSession=" + "0".repeat(64), origin, "application/json", layout).statusCode() == 403,
                    "layout writes require the session cookie");
            check(put(base, cookie, null, "application/json", layout).statusCode() == 403,
                    "layout writes require a browser origin");
            check(put(base, cookie, "http://evil.example", "application/json", layout).statusCode() == 403,
                    "layout writes reject foreign origins");
            check(put(base, cookie, origin, "text/plain", layout).statusCode() == 415, "layout writes must be JSON");
            for (String invalid : new String[] {"nope", "{}", "{\"version\":3,\"tiles\":[]}",
                    "{\"version\":1,\"tiles\":[]}", // version 1 is only read, never saved
                    "{\"version\":2,\"tiles\":[{\"id\":\"chat\",\"enabled\":true,\"x\":0,\"y\":0,\"w\":1,\"h\":1}]}",
                    "{\"version\":2,\"tiles\":[{\"id\":\"player\",\"enabled\":true,\"x\":10,\"y\":0,\"w\":4,\"h\":1}]}",
                    "{\"version\":2,\"tiles\":[{\"id\":\"player\",\"enabled\":\"yes\",\"x\":0,\"y\":0,\"w\":4,\"h\":1}]}",
                    "{\"version\":2,\"tiles\":[{\"id\":\"player\",\"enabled\":true,\"x\":0.5,\"y\":0,\"w\":4,\"h\":1}]}"}) {
                check(put(base, cookie, origin, "application/json", invalid).statusCode() == 400,
                        "invalid layout rejected: " + invalid);
            }
            String withSettings = "{\"version\":2,\"tiles\":[],\"settings\":{\"inventory\":{\"showArmor\":false,\"x\":1},"
                    + "\"statistics\":{\"shown\":[\"minecraft:custom/minecraft:jump\",\"minecraft:custom/minecraft:jump\"],"
                    + "\"recentExcluded\":[\"minecraft:custom/minecraft:play_time\"]},\"map\":{\"url\":\"http://127.0.0.1:8080/\"},"
                    + "\"other\":true}}";
            check(put(base, cookie, origin, "application/json", withSettings).statusCode() == 200, "settings saved");
            check(java.nio.file.Files.readString(file).equals("{\"version\":2,\"tiles\":[],\"settings\":{"
                            + "\"inventory\":{\"showArmor\":false},\"statistics\":{\"shown\":[\"minecraft:custom/minecraft:jump\"],"
                            + "\"recentExcluded\":[\"minecraft:custom/minecraft:play_time\"]},"
                            + "\"map\":{\"url\":\"http://127.0.0.1:8080/\"}}}"),
                    "settings keep known, validated keys with duplicate ids removed");
            for (String invalid : new String[] {
                    "{\"version\":2,\"tiles\":[],\"settings\":{\"map\":{\"url\":\"https://example.com/\"}}}",
                    "{\"version\":2,\"tiles\":[],\"settings\":{\"map\":{\"url\":\"http://127.0.0.1.evil.example/\"}}}",
                    "{\"version\":2,\"tiles\":[],\"settings\":{\"inventory\":{\"showArmor\":\"no\"}}}",
                    "{\"version\":2,\"tiles\":[],\"settings\":{\"statistics\":{\"shown\":[\"jump\"]}}}",
                    "{\"version\":2,\"tiles\":[],\"settings\":[]}"}) {
                check(put(base, cookie, origin, "application/json", invalid).statusCode() == 400,
                        "invalid settings rejected: " + invalid);
            }
            check(put(base, cookie, origin, "application/json", layout).statusCode() == 200, "layout saved again");
            check(put(base, cookie, origin, "application/json", "x".repeat(LayoutStore.MAX_BYTES + 1)).statusCode() == 413,
                    "oversized layout rejected");
            check(java.nio.file.Files.readString(file).equals(saved), "rejected writes leave the saved layout intact");
        }
    }

    private static void testProfilesRulesAndWorlds() throws Exception {
        String full = "{\"version\":1,\"tiles\":[{\"id\":\"movement\",\"enabled\":true,\"x\":0,\"y\":0,\"w\":4,"
                + "\"h\":4,\"rulesOnly\":true}],\"settings\":{\"statistics\":{\"recentLifetime\":0,\"recentRows\":4},"
                + "\"movement\":{\"showVertical\":false,\"showGlider\":true},"
                + "\"xp\":{\"window\":300,\"goals\":[30,50]},\"performance\":{\"window\":600},\"pickups\":{\"lifetime\":0,"
                + "\"maxRows\":5,\"showSource\":false,\"ignored\":[\"minecraft:dirt\"]},\"advancements\":{\"popupSeconds\":10}},"
                + "\"profiles\":[{\"id\":\"nether\",\"name\":\"Nether\",\"tiles\":[],\"settings\":{}}],"
                + "\"rules\":[{\"id\":\"rule-1\",\"name\":\"Nether flight\",\"enabled\":true,\"groups\":[[{\"type\":"
                + "\"dimension\",\"values\":[\"nether\"]}],[{\"type\":\"elytra\",\"not\":true},{\"type\":\"health\","
                + "\"min\":2,\"max\":10}]],\"profile\":\"nether\",\"tiles\":{\"movement\":\"show\"},"
                + "\"settings\":{\"inventory\":{\"showArmor\":false}}}],"
                + "\"pinned\":[{\"source\":\"inventory\",\"slot\":12,\"x\":40,\"y\":90},"
                + "{\"source\":\"accessory\",\"slot\":0,\"x\":60,\"y\":90}],"
                + "\"updates\":{\"intervalMillis\":100}}";
        String normalized = LayoutStore.normalize(full);
        check(normalized.equals(full.replace("\"min\":2,\"max\":10", "\"min\":2.0,\"max\":10.0")),
                "profiles, rules, pinned windows and new tile settings round-trip: " + normalized);
        for (String invalid : new String[] {
                full.replace("\"profile\":\"nether\"", "\"profile\":\"missing\""),
                full.replace("\"type\":\"elytra\"", "\"type\":\"weather\""),
                full.replace("\"window\":300", "\"window\":45"),
                full.replace("\"window\":600", "\"window\":300"),
                full.replace("[30,50]", "[0]"),
                full.replace("[30,50]", "[10001]"),
                full.replace("[30,50]", "[1.5]"),
                full.replace("[30,50]", "[1,2,3,4,5,6,7,8,9]"),
                full.replace("\"movement\":\"show\"", "\"movement\":\"toggle\""),
                full.replace("\"source\":\"inventory\"", "\"source\":\"chest\""),
                full.replace("\"intervalMillis\":100", "\"intervalMillis\":16"),
                full.replace("\"id\":\"nether\"", "\"id\":\"default\""),
                full.replace("[{\"type\":\"dimension\",\"values\":[\"nether\"]}]", "[]")}) {
            try {
                LayoutStore.normalize(invalid);
                throw new AssertionError("invalid layout accepted: " + invalid);
            } catch (IllegalArgumentException expected) {
                // rejected as it should be
            }
        }

        java.nio.file.Path layoutFile = java.nio.file.Files.createTempDirectory("minepanel-layout").resolve("layout.json");
        LayoutStore rates = new LayoutStore(layoutFile);
        check(rates.updateIntervalMillis() == LayoutStore.DEFAULT_UPDATE_INTERVAL, "update rate defaults to 4/s");
        String saveable = "{\"version\":2,\"tiles\":[],\"updates\":{\"intervalMillis\":100}}";
        rates.save(saveable);
        check(rates.updateIntervalMillis() == 100, "saving a layout changes the update rate immediately");
        LayoutStore reloaded = new LayoutStore(layoutFile);
        reloaded.load();
        check(reloaded.updateIntervalMillis() == 100, "the saved update rate is restored on startup");
        rates.save(saveable.replace(",\"updates\":{\"intervalMillis\":100}", ""));
        check(rates.updateIntervalMillis() == LayoutStore.DEFAULT_UPDATE_INTERVAL, "a layout without a rate resets it");

        java.nio.file.Path directory = java.nio.file.Files.createTempDirectory("minepanel-worlds");
        var item = com.google.gson.JsonParser.parseString("{\"id\":\"minecraft:emerald\",\"count\":3}");
        String uuid = "123e4567-e89b-12d3-a456-426614174000";
        WorldStore worlds = new WorldStore(directory);
        worlds.open("server:play.example.net");
        long before = worlds.revision();
        worlds.putVillager(new WorldStore.Villager(uuid, "minecraft:librarian", 2, "Bob", "minecraft:overworld",
                1, 64, 2, 10, 10, java.util.List.of(new WorldStore.Trade(item, null, item, 0, 12))));
        java.util.List<com.google.gson.JsonElement> chest = new java.util.ArrayList<>();
        for (int slot = 0; slot < 27; slot++) chest.add(slot == 4 ? item : com.google.gson.JsonNull.INSTANCE);
        worlds.enderChest(new WorldStore.EnderChest(20, chest));
        worlds.putBackpack(new WorldStore.Backpack(uuid, 30, java.util.List.of(item, item)));
        check(worlds.revision() > before, "changes bump the revision");
        long unchanged = worlds.revision();
        worlds.putBackpack(new WorldStore.Backpack(uuid, 40, java.util.List.of(item, item)));
        check(worlds.revision() == unchanged && worlds.backpack(uuid).seenAt() == 30,
                "seeing the same backpack contents again changes nothing");
        for (int extra = 0; extra < WorldStore.MAX_BACKPACKS; extra++) {
            worlds.putBackpack(new WorldStore.Backpack(String.format("00000000-0000-0000-0000-%012d", extra), extra,
                    java.util.List.of()));
        }
        check(worlds.backpack(uuid) == null && worlds.backpack("00000000-0000-0000-0000-000000000000") != null,
                "the backpack seen longest ago is forgotten beyond the limit");
        worlds.putBackpack(new WorldStore.Backpack(uuid, 50, java.util.List.of(item)));
        invalid(() -> new WorldStore.Backpack("not-a-uuid", 1, java.util.List.of()));
        invalid(() -> new WorldStore.Backpack(uuid, 1, java.util.List.of(com.google.gson.JsonNull.INSTANCE)));
        invalid(() -> new WorldStore.Backpack(uuid, 1, java.util.Collections.nCopies(ItemSnapshot.MAX_CONTENTS + 1, item)));
        worlds.save();
        WorldStore reloadedWorlds = new WorldStore(directory);
        reloadedWorlds.open("server:play.example.net");
        check(reloadedWorlds.villagers().equals(worlds.villagers()) && reloadedWorlds.enderChest().equals(worlds.enderChest())
                        && reloadedWorlds.backpack(uuid).equals(worlds.backpack(uuid)),
                "villagers, the ender chest and backpacks survive a restart");
        reloadedWorlds.open("singleplayer:Other World");
        check(reloadedWorlds.villagers().isEmpty() && reloadedWorlds.enderChest() == null
                && reloadedWorlds.backpack(uuid) == null, "each world has its own data");

        try (LocalDashboardServer server = new LocalDashboardServer(new TelemetryStore(), 0, null, null, worlds)) {
            server.start();
            URI base = URI.create(server.getUrl());
            String origin = base.toString().substring(0, base.toString().length() - 1);
            String cookie = CLIENT.send(HttpRequest.newBuilder(base.resolve("api/session"))
                    .header("Sec-Fetch-Site", "same-origin").GET().build(), HttpResponse.BodyHandlers.ofString())
                    .headers().firstValue("set-cookie").orElseThrow().split(";", 2)[0];
            URI villager = base.resolve("api/villagers/" + uuid);
            check(delete(villager, null, origin).statusCode() == 403, "forgetting needs the session cookie");
            check(delete(villager, cookie, null).statusCode() == 403, "forgetting needs a browser origin");
            check(delete(villager, cookie, "http://evil.example").statusCode() == 403, "foreign origins are rejected");
            check(delete(base.resolve("api/villagers/not-a-uuid"), cookie, origin).statusCode() == 405,
                    "only well-formed villager ids are accepted");
            check(delete(villager, cookie, origin).statusCode() == 200 && worlds.villagers().isEmpty(),
                    "a villager is forgotten");
            check(delete(villager, cookie, origin).statusCode() == 404, "forgetting twice reports not found");
            for (String asset : new String[] {"rules.js", "player-links.js", "features.js", "features.css"}) {
                check(get(base.resolve(asset)).statusCode() == 200, asset + " is served");
            }
        }
    }

    private static HttpResponse<String> delete(URI uri, String cookie, String origin) throws Exception {
        HttpRequest.Builder request = HttpRequest.newBuilder(uri).DELETE();
        if (cookie != null) request.header("Cookie", cookie);
        if (origin != null) request.header("Origin", origin);
        return CLIENT.send(request.build(), HttpResponse.BodyHandlers.ofString());
    }

    private static HttpResponse<String> put(URI base, String cookie, String origin, String contentType, String body)
            throws Exception {
        HttpRequest.Builder request = HttpRequest.newBuilder(base.resolve("api/layout"))
                .header("Cookie", cookie).header("Content-Type", contentType)
                .PUT(HttpRequest.BodyPublishers.ofString(body));
        if (origin != null) request.header("Origin", origin);
        return CLIENT.send(request.build(), HttpResponse.BodyHandlers.ofString());
    }

    private static HttpResponse<String> get(URI uri) throws Exception {
        return CLIENT.send(HttpRequest.newBuilder(uri).GET().build(), HttpResponse.BodyHandlers.ofString());
    }

    private static void check(boolean condition, String message) {
        if (!condition) {
            throw new AssertionError(message);
        }
    }

    private static void invalid(Runnable action) {
        try { action.run(); } catch (IllegalArgumentException expected) { return; }
        throw new AssertionError("Expected invalid value rejection");
    }
}
