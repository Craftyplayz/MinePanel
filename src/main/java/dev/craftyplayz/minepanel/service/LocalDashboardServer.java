package dev.craftyplayz.minepanel.service;

import dev.craftyplayz.minepanel.telemetry.TelemetryStore;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;

import java.io.IOException;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.HexFormat;
import java.util.Map;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.logging.Level;
import java.util.logging.Logger;
import java.util.regex.Pattern;

public final class LocalDashboardServer implements AutoCloseable {
    public static final int DEFAULT_PORT = 57262;
    private static final Logger LOGGER = Logger.getLogger("MinePanel");
    private static final int MAX_RESPONSE_BYTES = 1024 * 1024;
    private static final Pattern ICON_PATH = Pattern.compile("/icon/([a-z0-9-]{1,64})\\.png");
    private static final Pattern EFFECT_PATH = Pattern.compile("/effect/([a-z0-9_.-]{1,64})/([a-z0-9_.-]{1,128})\\.png");
    private static final Map<String, String[]> ASSETS = Map.of(
            "/", new String[] {"web/index.html", "text/html; charset=utf-8"},
            "/app.js", new String[] {"web/app.js", "text/javascript; charset=utf-8"},
            "/protocol.js", new String[] {"web/protocol.js", "text/javascript; charset=utf-8"},
            "/layout.js", new String[] {"web/layout.js", "text/javascript; charset=utf-8"},
            "/rules.js", new String[] {"web/rules.js", "text/javascript; charset=utf-8"},
            "/features.js", new String[] {"web/features.js", "text/javascript; charset=utf-8"},
            "/features.css", new String[] {"web/features.css", "text/css; charset=utf-8"},
            "/styles.css", new String[] {"web/styles.css", "text/css; charset=utf-8"});
    private static final Pattern VILLAGER_PATH = Pattern.compile(
            "/api/villagers/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})");
    private final HttpServer server;
    private final ExecutorService executor;
    private final String token;
    private final TelemetryStore telemetry;
    private final IconSource icons;
    private final LayoutStore layouts;
    private final WorldStore worlds;
    private final LocalWebSocketServer webSocketServer;

    public LocalDashboardServer() throws IOException {
        this(new TelemetryStore());
    }

    public LocalDashboardServer(TelemetryStore telemetry) throws IOException {
        this(telemetry, 0, null, null);
    }

    /** @param port the loopback HTTP port, or 0 for an ephemeral port */
    public LocalDashboardServer(TelemetryStore telemetry, int port, IconSource icons, LayoutStore layouts)
            throws IOException {
        this(telemetry, port, icons, layouts, null);
    }

    /** @param worlds per-world saved data the dashboard may edit (forgetting villagers), or null */
    public LocalDashboardServer(TelemetryStore telemetry, int port, IconSource icons, LayoutStore layouts,
                                WorldStore worlds) throws IOException {
        this.telemetry = telemetry;
        this.icons = icons;
        this.layouts = layouts;
        this.worlds = worlds;
        byte[] tokenBytes = new byte[32];
        new SecureRandom().nextBytes(tokenBytes);
        token = HexFormat.of().formatHex(tokenBytes);
        server = HttpServer.create(new InetSocketAddress(InetAddress.getByName("127.0.0.1"), port), 16);
        try {
            webSocketServer = new LocalWebSocketServer(telemetry, token, server.getAddress().getPort());
        } catch (IOException failure) {
            server.stop(0);
            throw failure;
        }
        executor = new ThreadPoolExecutor(8, 8, 0L, TimeUnit.MILLISECONDS, new ArrayBlockingQueue<>(64), runnable -> {
            Thread thread = new Thread(runnable, "MinePanel-http");
            thread.setDaemon(true);
            return thread;
        }, new ThreadPoolExecutor.CallerRunsPolicy());
        server.setExecutor(executor);
        server.createContext("/", this::handle);
    }

    public void start() {
        webSocketServer.start();
        server.start();
    }

    public String getUrl() {
        return "http://127.0.0.1:" + server.getAddress().getPort() + "/";
    }

    public int getPort() {
        return server.getAddress().getPort();
    }

    int getWebSocketPort() {
        return webSocketServer.getPort();
    }

    @Override
    public void close() {
        server.stop(0);
        webSocketServer.close();
        executor.shutdownNow();
    }

    private void handle(HttpExchange exchange) throws IOException {
        try (exchange) {
            if (!validHost(exchange) || !validOrigin(exchange)) {
                respond(exchange, 403, "text/plain; charset=utf-8", "Forbidden");
                return;
            }
            String path = exchange.getRequestURI().getPath();
            String method = exchange.getRequestMethod();
            if ("/api/layout".equals(path) && "PUT".equals(method)) {
                saveLayout(exchange);
                return;
            }
            var villager = VILLAGER_PATH.matcher(path);
            if (villager.matches() && "DELETE".equals(method)) {
                forgetVillager(exchange, villager.group(1));
                return;
            }
            if (!"GET".equals(method)) {
                exchange.getResponseHeaders().set("Allow", "/api/layout".equals(path) ? "GET, PUT" : "GET");
                respond(exchange, 405, "text/plain; charset=utf-8", "Method not allowed");
                return;
            }

            String[] asset = ASSETS.get(path);
            if (asset != null) {
                serveAsset(exchange, asset[0], asset[1]);
                return;
            }
            var icon = ICON_PATH.matcher(path);
            if (icon.matches()) {
                serveIcon(exchange, icon.group(1));
                return;
            }
            var effect = EFFECT_PATH.matcher(path);
            if (effect.matches()) {
                byte[] png = icons == null ? null : icons.effectIcon(effect.group(1) + ":" + effect.group(2));
                if (png == null) {
                    respond(exchange, 404, "text/plain; charset=utf-8", "Effect icon unavailable");
                } else {
                    exchange.getResponseHeaders().set("Cache-Control", "private, max-age=3600");
                    send(exchange, 200, "image/png", png);
                }
                return;
            }
            switch (path) {
                case "/glint.png" -> serveGlint(exchange);
                case "/api/session" -> {
                    if (!isSameOriginBrowserRequest(exchange)) {
                        respond(exchange, 403, "text/plain; charset=utf-8", "Forbidden");
                    } else {
                        exchange.getResponseHeaders().set("Cache-Control", "no-store");
                        exchange.getResponseHeaders().add("Set-Cookie",
                                "MinePanelSession=" + token + "; HttpOnly; SameSite=Strict; Path=/");
                        respond(exchange, 200, "application/json; charset=utf-8",
                                "{\"websocketPort\":" + getWebSocketPort() + "}");
                    }
                }
                case "/api/state" -> {
                    if (!authorized(exchange)) {
                        respond(exchange, 401, "application/json; charset=utf-8", "{\"error\":\"unauthorized\"}");
                    } else {
                        exchange.getResponseHeaders().set("Cache-Control", "no-store");
                        respond(exchange, 200, "application/json; charset=utf-8", statusJson());
                    }
                }
                case "/api/layout" -> {
                    if (!cookieAuthorized(exchange)) {
                        respond(exchange, 401, "application/json; charset=utf-8", "{\"error\":\"unauthorized\"}");
                    } else {
                        String stored = layouts == null ? null : layouts.load();
                        exchange.getResponseHeaders().set("Cache-Control", "no-store");
                        respond(exchange, 200, "application/json; charset=utf-8",
                                "{\"layout\":" + (stored == null ? "null" : stored) + "}");
                    }
                }
                default -> respond(exchange, 404, "text/plain; charset=utf-8", "Not found");
            }
        } catch (IllegalArgumentException exception) {
            LOGGER.fine("Rejected malformed local dashboard request.");
        }
    }

    private void saveLayout(HttpExchange exchange) throws IOException {
        String contentType = exchange.getRequestHeaders().getFirst("Content-Type");
        if (!cookieAuthorized(exchange) || exchange.getRequestHeaders().getFirst("Origin") == null) {
            respond(exchange, 403, "application/json; charset=utf-8", "{\"error\":\"forbidden\"}");
            return;
        }
        if (contentType == null || !contentType.toLowerCase().startsWith("application/json")) {
            respond(exchange, 415, "application/json; charset=utf-8", "{\"error\":\"json required\"}");
            return;
        }
        if (layouts == null) {
            respond(exchange, 503, "application/json; charset=utf-8", "{\"error\":\"layout storage unavailable\"}");
            return;
        }
        byte[] body = exchange.getRequestBody().readNBytes(LayoutStore.MAX_BYTES + 1);
        if (body.length > LayoutStore.MAX_BYTES) {
            respond(exchange, 413, "application/json; charset=utf-8", "{\"error\":\"layout too large\"}");
            return;
        }
        try {
            layouts.save(new String(body, StandardCharsets.UTF_8));
        } catch (IllegalArgumentException invalid) {
            respond(exchange, 400, "application/json; charset=utf-8", "{\"error\":\"invalid layout\"}");
            return;
        } catch (IOException failure) {
            LOGGER.log(Level.WARNING, "MinePanel could not save the dashboard layout.", failure);
            respond(exchange, 500, "application/json; charset=utf-8", "{\"error\":\"layout not saved\"}");
            return;
        }
        exchange.getResponseHeaders().set("Cache-Control", "no-store");
        respond(exchange, 200, "application/json; charset=utf-8", "{\"saved\":true}");
    }

    /** Removes a remembered villager; same protections as saving the layout (session cookie, same-origin request). */
    private void forgetVillager(HttpExchange exchange, String uuid) throws IOException {
        if (!cookieAuthorized(exchange) || exchange.getRequestHeaders().getFirst("Origin") == null) {
            respond(exchange, 403, "application/json; charset=utf-8", "{\"error\":\"forbidden\"}");
            return;
        }
        if (worlds == null) {
            respond(exchange, 503, "application/json; charset=utf-8", "{\"error\":\"world data unavailable\"}");
            return;
        }
        boolean removed = worlds.forgetVillager(uuid);
        exchange.getResponseHeaders().set("Cache-Control", "no-store");
        respond(exchange, removed ? 200 : 404, "application/json; charset=utf-8", "{\"removed\":" + removed + "}");
    }

    private void serveIcon(HttpExchange exchange, String key) throws IOException {
        byte[] png;
        try {
            png = icons == null ? null : icons.icon(key);
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            png = null;
        }
        if (png == null) {
            respond(exchange, 404, "text/plain; charset=utf-8", "Icon unavailable");
            return;
        }
        // Keys change whenever the item or resource packs change, so a cached icon never goes stale.
        exchange.getResponseHeaders().set("Cache-Control", "private, max-age=31536000, immutable");
        send(exchange, 200, "image/png", png);
    }

    private void serveGlint(HttpExchange exchange) throws IOException {
        byte[] png = icons == null ? null : icons.glint();
        if (png == null) {
            respond(exchange, 404, "text/plain; charset=utf-8", "Glint unavailable");
            return;
        }
        exchange.getResponseHeaders().set("Cache-Control", "private, max-age=3600");
        send(exchange, 200, "image/png", png);
    }

    private boolean validHost(HttpExchange exchange) {
        String host = exchange.getRequestHeaders().getFirst("Host");
        int port = server.getAddress().getPort();
        return ("127.0.0.1:" + port).equalsIgnoreCase(host)
                || ("localhost:" + port).equalsIgnoreCase(host);
    }

    private boolean validOrigin(HttpExchange exchange) {
        String origin = exchange.getRequestHeaders().getFirst("Origin");
        return origin == null || origin.equals("http://127.0.0.1:" + server.getAddress().getPort())
                || origin.equals("http://localhost:" + server.getAddress().getPort());
    }

    private boolean isSameOriginBrowserRequest(HttpExchange exchange) {
        String fetchSite = exchange.getRequestHeaders().getFirst("Sec-Fetch-Site");
        return "same-origin".equals(fetchSite) || "same-site".equals(fetchSite);
    }

    private boolean authorized(HttpExchange exchange) {
        String authorization = exchange.getRequestHeaders().getFirst("Authorization");
        if (authorization == null || authorization.length() != 71 || !authorization.startsWith("Bearer ")) {
            return false;
        }
        return MessageDigest.isEqual(token.getBytes(StandardCharsets.US_ASCII),
                authorization.substring(7).getBytes(StandardCharsets.US_ASCII));
    }

    private boolean cookieAuthorized(HttpExchange exchange) {
        for (String header : exchange.getRequestHeaders().getOrDefault("Cookie", java.util.List.of())) {
            for (String pair : header.split(";")) {
                String trimmed = pair.trim();
                int separator = trimmed.indexOf('=');
                if (separator > 0 && trimmed.substring(0, separator).equals("MinePanelSession")
                        && MessageDigest.isEqual(token.getBytes(StandardCharsets.US_ASCII),
                        trimmed.substring(separator + 1).getBytes(StandardCharsets.US_ASCII))) {
                    return true;
                }
            }
        }
        return false;
    }

    private String statusJson() {
        var player = telemetry.player();
        String version = LocalDashboardServer.class.getPackage().getImplementationVersion();
        if (version == null) {
            version = "development";
        }
        return "{\"schemaVersion\":" + dev.craftyplayz.minepanel.telemetry.PlayerSnapshot.SCHEMA_VERSION + ",\"service\":\"connected\",\"game\":"
                + (player.available() ? "\"connected\"" : "\"unavailable\"")
                + ",\"modVersion\":\"" + version + "\","
                + "\"message\":\"Player state is read-only and session scoped.\","
                + "\"player\":" + player.toJson() + "}";
    }

    private void serveAsset(HttpExchange exchange, String resource, String contentType) throws IOException {
        try (var input = LocalDashboardServer.class.getClassLoader().getResourceAsStream(resource)) {
            if (input == null) {
                respond(exchange, 404, "text/plain; charset=utf-8", "Dashboard asset unavailable");
                return;
            }
            byte[] body = input.readNBytes(MAX_RESPONSE_BYTES + 1);
            if (body.length > MAX_RESPONSE_BYTES) {
                respond(exchange, 500, "text/plain; charset=utf-8", "Dashboard asset too large");
                return;
            }
            exchange.getResponseHeaders().set("Cache-Control", "no-cache");
            send(exchange, 200, contentType, body);
        }
    }

    private void respond(HttpExchange exchange, int status, String contentType, String body) throws IOException {
        send(exchange, status, contentType, body.getBytes(StandardCharsets.UTF_8));
    }

    private void send(HttpExchange exchange, int status, String contentType, byte[] body) throws IOException {
        exchange.getResponseHeaders().set("Content-Type", contentType);
        exchange.getResponseHeaders().set("X-Content-Type-Options", "nosniff");
        exchange.getResponseHeaders().set("Referrer-Policy", "no-referrer");
        exchange.getResponseHeaders().set("Content-Security-Policy",
                // Local map servers (JourneyMap's web map) may be embedded and probed; nothing off this PC is allowed.
                "default-src 'self'; connect-src 'self' ws://127.0.0.1:" + getWebSocketPort()
                        + " http://127.0.0.1:* http://localhost:*; img-src 'self'; style-src 'self'; script-src 'self'; "
                        + "frame-src http://127.0.0.1:* http://localhost:*; frame-ancestors 'none'; object-src 'none'; "
                        + "form-action 'none'; base-uri 'none'");
        exchange.sendResponseHeaders(status, body.length);
        try (OutputStream output = exchange.getResponseBody()) {
            output.write(body);
        }
    }
}
