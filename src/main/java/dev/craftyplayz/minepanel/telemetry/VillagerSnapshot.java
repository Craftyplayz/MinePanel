package dev.craftyplayz.minepanel.telemetry;

import java.util.List;
import java.util.Objects;
import java.util.regex.Pattern;

/**
 * A villager the player has traded with: its trades as last seen in the trading screen, and where it was last seen.
 * {@code costA} already includes discounts (curing, Hero of the Village) and demand, as the trading screen shows it.
 */
public record VillagerSnapshot(String uuid, String profession, String professionName, int level, String name,
                               String dimension, double x, double y, double z, long seenAt, long tradedAt,
                               List<Trade> trades) {
    public static final int MAX_VILLAGERS = 512;
    public static final int MAX_TRADES = 32;
    public static final Pattern UUID = Pattern.compile("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}");
    private static final Pattern IDENTIFIER = Pattern.compile("[a-z0-9_.-]+:[a-z0-9/._-]+");

    public record Trade(ItemSnapshot costA, ItemSnapshot costB, ItemSnapshot result, int uses, int maxUses) {
        public Trade {
            Objects.requireNonNull(costA, "costA");
            Objects.requireNonNull(result, "result");
            if (costA.empty() || result.empty() || costB != null && costB.empty() || uses < 0 || maxUses < 0) {
                throw new IllegalArgumentException("Invalid trade");
            }
        }

        String toJson() {
            return "{\"costA\":" + costA.toJson() + ",\"costB\":" + (costB == null ? "null" : costB.toJson())
                    + ",\"result\":" + result.toJson() + ",\"uses\":" + uses + ",\"maxUses\":" + maxUses + "}";
        }
    }

    public VillagerSnapshot {
        trades = List.copyOf(trades);
        if (uuid == null || !UUID.matcher(uuid).matches() || profession == null
                || !IDENTIFIER.matcher(profession).matches() || professionName == null || professionName.isEmpty()
                || professionName.length() > 256 || level < 1 || level > 5 || name != null && name.length() > 256
                || dimension == null || !IDENTIFIER.matcher(dimension).matches()
                || !Double.isFinite(x) || !Double.isFinite(y) || !Double.isFinite(z)
                || seenAt < 0 || tradedAt < 0 || trades.size() > MAX_TRADES) {
            throw new IllegalArgumentException("Invalid villager");
        }
    }

    public String toJson() {
        StringBuilder json = new StringBuilder("{\"uuid\":").append(PlayerSnapshot.string(uuid))
                .append(",\"profession\":").append(PlayerSnapshot.string(profession))
                .append(",\"professionName\":").append(PlayerSnapshot.string(professionName))
                .append(",\"level\":").append(level).append(",\"name\":").append(PlayerSnapshot.string(name))
                .append(",\"dimension\":").append(PlayerSnapshot.string(dimension))
                .append(",\"x\":").append(x).append(",\"y\":").append(y).append(",\"z\":").append(z)
                .append(",\"seenAt\":").append(seenAt).append(",\"tradedAt\":").append(tradedAt)
                .append(",\"trades\":[");
        for (int index = 0; index < trades.size(); index++) {
            if (index > 0) json.append(',');
            json.append(trades.get(index).toJson());
        }
        return json.append("]}").toString();
    }
}
