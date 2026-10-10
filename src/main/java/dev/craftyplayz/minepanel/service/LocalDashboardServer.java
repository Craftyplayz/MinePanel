package dev.craftyplayz.minepanel.service;

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
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.logging.Logger;

public final class LocalDashboardServer implements AutoCloseable {
    private static final Logger LOGGER = Logger.getLogger("MinePanel");
    private static final int MAX_RESPONSE_BYTES = 1024 * 1024;
    private final HttpServer server;
    private final ExecutorService executor;
    private final String token;

    public LocalDashboardServer() throws IOException {
        byte[] tokenBytes = new byte[32];
        new SecureRandom().nextBytes(tokenBytes);
        token = HexFormat.of().formatHex(tokenBytes);
        server = HttpServer.create(new InetSocketAddress(InetAddress.getByName("127.0.0.1"), 0), 16);
        executor = new ThreadPoolExecutor(2, 2, 0L, TimeUnit.MILLISECONDS, new ArrayBlockingQueue<>(32), runnable -> {
            Thread thread = new Thread(runnable, "MinePanel-http");
            thread.setDaemon(true);
            return thread;
        }, new ThreadPoolExecutor.CallerRunsPolicy());
        server.setExecutor(executor);
        server.createContext("/", this::handle);
    }

    public void start() {
        server.start();
    }

    public String getUrl() {
        return "http://127.0.0.1:" + server.getAddress().getPort() + "/";
    }

    @Override
    public void close() {
        server.stop(0);
        executor.shutdownNow();
    }

    private void handle(HttpExchange exchange) throws IOException {
        try (exchange) {
            if (!validHost(exchange) || !validOrigin(exchange)) {
                respond(exchange, 403, "text/plain; charset=utf-8", "Forbidden");
                return;
            }
            if (!"GET".equals(exchange.getRequestMethod())) {
                exchange.getResponseHeaders().set("Allow", "GET");
                respond(exchange, 405, "text/plain; charset=utf-8", "Method not allowed");
                return;
            }

            String path = exchange.getRequestURI().getPath();
            switch (path) {
                case "/" -> serveAsset(exchange, "web/index.html", "text/html; charset=utf-8");
                case "/app.js" -> serveAsset(exchange, "web/app.js", "text/javascript; charset=utf-8");
                case "/styles.css" -> serveAsset(exchange, "web/styles.css", "text/css; charset=utf-8");
                case "/api/session" -> {
                    if (!isSameOriginBrowserRequest(exchange)) {
                        respond(exchange, 403, "text/plain; charset=utf-8", "Forbidden");
                    } else {
                        exchange.getResponseHeaders().set("Cache-Control", "no-store");
                        respond(exchange, 200, "application/json; charset=utf-8", "{\"token\":\"" + token + "\"}");
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
                default -> respond(exchange, 404, "text/plain; charset=utf-8", "Not found");
            }
        } catch (IllegalArgumentException exception) {
            LOGGER.fine("Rejected malformed local dashboard request.");
        }
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
        if (authorization == null || !authorization.startsWith("Bearer ")) {
            return false;
        }
        return MessageDigest.isEqual(token.getBytes(StandardCharsets.US_ASCII),
                authorization.substring(7).getBytes(StandardCharsets.US_ASCII));
    }

    private String statusJson() {
        String version = LocalDashboardServer.class.getPackage().getImplementationVersion();
        if (version == null) {
            version = "development";
        }
        return "{\"schemaVersion\":1,\"service\":\"connected\",\"game\":\"unavailable\","
                + "\"modVersion\":\"" + version + "\","
                + "\"message\":\"Live Minecraft telemetry is not implemented yet.\"}";
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
                "default-src 'self'; connect-src 'self'; style-src 'self'; script-src 'self'; "
                        + "frame-src 'none'; frame-ancestors 'none'; object-src 'none'; form-action 'none'; base-uri 'none'");
        exchange.sendResponseHeaders(status, body.length);
        try (OutputStream output = exchange.getResponseBody()) {
            output.write(body);
        }
    }
}
