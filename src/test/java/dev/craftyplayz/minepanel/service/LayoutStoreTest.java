package dev.craftyplayz.minepanel.service;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

/**
 * Layout version 2 validation and storage. The shared cases in src/test/fixtures/layouts-v2.json are also checked
 * against layout.js by the dashboard tests, so both validators accept and reject the same layouts.
 * Run from the repository root.
 */
public final class LayoutStoreTest {
    private static final Path FIXTURES = Path.of("src", "test", "fixtures", "layouts-v2.json");
    private static final String V1 = "{\"version\":1,\"tiles\":[],\"rules\":[{\"id\":\"r\",\"name\":\"R\",\"enabled\":true,"
            + "\"groups\":[[{\"type\":\"dimension\",\"values\":[\"nether\"]}]],\"tiles\":{\"movement\":\"show\"}}]}";
    private static final String V2 = "{\"version\":2,\"tiles\":[],\"toggles\":[{\"id\":\"afk\",\"name\":\"AFK\",\"on\":true}],"
            + "\"rules\":[{\"id\":\"r\",\"name\":\"R\",\"enabled\":true,\"when\":[{\"type\":\"health\",\"compare\":\"between\","
            + "\"value\":2.5,\"value2\":10},{\"type\":\"toggle\",\"join\":\"or\",\"toggle\":\"afk\"}],"
            + "\"then\":[{\"do\":\"show\",\"panel\":\"movement\"}]}],\"updates\":{\"intervalMillis\":100}}";

    private LayoutStoreTest() {
    }

    public static void main(String[] args) throws Exception {
        testSharedCases();
        testNormalizedOutput();
        testVersion1IsReadAndBackedUp();
        testInvalidStoredLayoutIsKept();
        System.out.println("LayoutStoreTest passed");
    }

    private static void testSharedCases() throws Exception {
        JsonObject cases = JsonParser.parseString(Files.readString(FIXTURES, StandardCharsets.UTF_8)).getAsJsonObject();
        check(cases.getAsJsonArray("valid").size() >= 10 && cases.getAsJsonArray("invalid").size() >= 90, "shared cases load");
        for (JsonElement entry : cases.getAsJsonArray("valid")) {
            String name = entry.getAsJsonObject().get("name").getAsString();
            String layout = entry.getAsJsonObject().get("layout").toString();
            String normalized;
            try {
                normalized = LayoutStore.normalize(layout);
            } catch (IllegalArgumentException rejected) {
                throw new AssertionError("valid layout rejected: " + name + ": " + rejected.getMessage(), rejected);
            }
            check(LayoutStore.normalize(normalized).equals(normalized), "normalizing is idempotent: " + name);
            check(LayoutStore.version(normalized) == 2, "stays version 2: " + name);
        }
        for (JsonElement entry : cases.getAsJsonArray("invalid")) {
            String name = entry.getAsJsonObject().get("name").getAsString();
            try {
                LayoutStore.normalize(entry.getAsJsonObject().get("layout").toString());
                throw new AssertionError("invalid layout accepted: " + name);
            } catch (IllegalArgumentException expected) {
                // rejected as it should be
            }
        }
    }

    private static void testNormalizedOutput() {
        String normalized = LayoutStore.normalize(V2.replace("\"type\":\"health\"", "\"extra\":1,\"type\":\"health\""));
        check(normalized.equals(V2), "only known fields are kept and numbers stay as written: " + normalized);
        String first = LayoutStore.normalize(V2.replace("{\"type\":\"health\"", "{\"join\":\"bogus\",\"type\":\"health\""));
        check(first.equals(V2), "the first row's join is ignored");
        try {
            LayoutStore.normalize(V2.replace("\"toggle\":\"afk\"}]", "\"toggle\":\"away\"}]"));
            throw new AssertionError("unknown toggle accepted");
        } catch (IllegalArgumentException expected) {
            check(expected.getMessage().equals("Rule \"R\": condition 2: unknown toggle"),
                    "errors name the rule and condition: " + expected.getMessage());
        }
    }

    private static void testVersion1IsReadAndBackedUp() throws Exception {
        Path file = Files.createTempDirectory("minepanel-layout-v1").resolve("layout.json");
        Files.writeString(file, V1, StandardCharsets.UTF_8);
        LayoutStore store = new LayoutStore(file);
        String loaded = store.load();
        check(loaded != null && LayoutStore.version(loaded) == 1, "a stored version 1 layout is still read");
        try {
            store.save(V1);
            throw new AssertionError("version 1 saved");
        } catch (IllegalArgumentException expected) {
            check(Files.readString(file).equals(V1), "a rejected save leaves the file alone");
        }
        Path backup = file.resolveSibling("layout.v1-backup.json");
        check(!Files.exists(backup), "no backup before converting");
        store.save(V2);
        check(Files.readString(backup).equals(V1), "the version 1 file is kept when the converted layout is saved");
        check(Files.readString(file).equals(V2) && store.updateIntervalMillis() == 100, "the converted layout is saved");
        store.save(V2.replace("\"on\":true", "\"on\":false"));
        check(Files.readString(backup).equals(V1), "later saves keep the backup");
        check(new LayoutStore(file).load().equals(Files.readString(file)), "the saved layout loads");
    }

    private static void testInvalidStoredLayoutIsKept() throws Exception {
        Path file = Files.createTempDirectory("minepanel-layout-bad").resolve("layout.json");
        String invalid = V2.replace("\"panel\":\"movement\"", "\"panel\":\"chat\"");
        Files.writeString(file, invalid, StandardCharsets.UTF_8);
        LayoutStore store = new LayoutStore(file);
        check(store.load() == null, "an invalid stored layout loads as nothing");
        Path rejected = file.resolveSibling("layout.rejected.json");
        check(Files.readString(rejected).equals(invalid), "and a copy is kept before anything can overwrite it");
        store.save(V2);
        check(Files.readString(rejected).equals(invalid) && !Files.exists(file.resolveSibling("layout.v1-backup.json")),
                "saving afterwards leaves the copy");
        check(new LayoutStore(file.resolveSibling("missing.json")).load() == null
                        && !Files.exists(file.resolveSibling("missing.rejected.json")), "no file is not an invalid file");
    }

    private static void check(boolean condition, String message) {
        if (!condition) throw new AssertionError(message);
    }
}
