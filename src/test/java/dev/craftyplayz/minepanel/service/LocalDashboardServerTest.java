package dev.craftyplayz.minepanel.service;

import dev.craftyplayz.minepanel.telemetry.PlayerSnapshot;
import dev.craftyplayz.minepanel.telemetry.TelemetryStore;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public final class LocalDashboardServerTest {
    private static final HttpClient CLIENT = HttpClient.newHttpClient();

    public static void main(String[] args) throws Exception {
        testTelemetrySnapshots();
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
            Matcher token = Pattern.compile("\"token\":\"([a-f0-9]{64})\"").matcher(session.body());
            check(session.statusCode() == 200 && token.find(), "same-origin browser receives an unguessable token");

            HttpRequest authorizedRequest = HttpRequest.newBuilder(base.resolve("api/state"))
                    .header("Authorization", "Bearer " + token.group(1))
                    .GET()
                    .build();
            HttpResponse<String> state = CLIENT.send(authorizedRequest, HttpResponse.BodyHandlers.ofString());
            check(state.statusCode() == 200 && state.body().contains("\"schemaVersion\":1")
                            && state.body().contains("\"modVersion\"")
                            && state.body().contains("\"player\":{\"schemaVersion\":1")
                            && state.body().contains("\"available\":false"),
                    "authorized client receives a versioned initial status");

            try (LocalDashboardServer secondServer = new LocalDashboardServer()) {
                secondServer.start();
                HttpRequest crossSession = HttpRequest.newBuilder(URI.create(secondServer.getUrl()).resolve("api/state"))
                        .header("Authorization", "Bearer " + token.group(1))
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
                    .header("Authorization", "Bearer " + token.group(1))
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

    private static HttpResponse<String> get(URI uri) throws Exception {
        return CLIENT.send(HttpRequest.newBuilder(uri).GET().build(), HttpResponse.BodyHandlers.ofString());
    }

    private static void check(boolean condition, String message) {
        if (!condition) {
            throw new AssertionError(message);
        }
    }
}
