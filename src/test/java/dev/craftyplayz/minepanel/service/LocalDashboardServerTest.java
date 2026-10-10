package dev.craftyplayz.minepanel.service;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public final class LocalDashboardServerTest {
    private static final HttpClient CLIENT = HttpClient.newHttpClient();

    public static void main(String[] args) throws Exception {
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
                            && state.body().contains("\"modVersion\""),
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

    private static HttpResponse<String> get(URI uri) throws Exception {
        return CLIENT.send(HttpRequest.newBuilder(uri).GET().build(), HttpResponse.BodyHandlers.ofString());
    }

    private static void check(boolean condition, String message) {
        if (!condition) {
            throw new AssertionError(message);
        }
    }
}
