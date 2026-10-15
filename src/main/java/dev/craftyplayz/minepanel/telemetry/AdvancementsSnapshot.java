package dev.craftyplayz.minepanel.telemetry;

import java.util.List;
import java.util.regex.Pattern;

/**
 * The advancements the server has shared with this client, grouped by tab. Servers only send advancements the
 * player can see, so a hidden advancement appears here once it is done or revealed; until then it is unknown.
 */
public record AdvancementsSnapshot(List<Tab> tabs, List<Entry> entries) {
    public static final int MAX_ENTRIES = 2048;
    public static final int MAX_CRITERIA = 256;
    public static final List<String> FRAMES = List.of("task", "goal", "challenge");
    private static final Pattern IDENTIFIER = Pattern.compile("[a-z0-9_.-]+:[a-z0-9/._-]+");
    private static final Pattern ICON = Pattern.compile("[a-z0-9-]{1,64}");

    public record Tab(String id, String title, String icon, boolean foil, int done, int total) {
        public Tab {
            validate(id, title, icon);
            if (done < 0 || total < done) throw new IllegalArgumentException("Invalid advancement tab");
        }

        String toJson() {
            return "{\"id\":" + PlayerSnapshot.string(id) + ",\"title\":" + PlayerSnapshot.string(title)
                    + ",\"icon\":" + PlayerSnapshot.string(icon) + ",\"foil\":" + foil
                    + ",\"done\":" + done + ",\"total\":" + total + "}";
        }
    }

    /** {@code remaining} names the criteria still missing, e.g. the biomes left for Adventuring Time. */
    public record Entry(String id, String tab, String title, String description, String frame, String icon,
                        boolean foil, boolean hidden, boolean done, Long doneAt, int criteriaDone,
                        int criteriaTotal, List<String> remaining) {
        public Entry {
            validate(id, title, icon);
            remaining = List.copyOf(remaining);
            if (tab == null || !IDENTIFIER.matcher(tab).matches() || description == null
                    || description.length() > 1024 || !FRAMES.contains(frame) || criteriaDone < 0
                    || criteriaTotal < criteriaDone || criteriaTotal > MAX_CRITERIA || remaining.size() > MAX_CRITERIA
                    || doneAt != null && doneAt < 0
                    || remaining.stream().anyMatch(name -> name == null || name.isEmpty() || name.length() > 256)) {
                throw new IllegalArgumentException("Invalid advancement");
            }
        }

        String toJson() {
            StringBuilder json = new StringBuilder("{\"id\":").append(PlayerSnapshot.string(id))
                    .append(",\"tab\":").append(PlayerSnapshot.string(tab))
                    .append(",\"title\":").append(PlayerSnapshot.string(title))
                    .append(",\"description\":").append(PlayerSnapshot.string(description))
                    .append(",\"frame\":").append(PlayerSnapshot.string(frame))
                    .append(",\"icon\":").append(PlayerSnapshot.string(icon))
                    .append(",\"foil\":").append(foil).append(",\"hidden\":").append(hidden)
                    .append(",\"done\":").append(done).append(",\"doneAt\":").append(doneAt)
                    .append(",\"criteriaDone\":").append(criteriaDone)
                    .append(",\"criteriaTotal\":").append(criteriaTotal).append(",\"remaining\":[");
            for (int index = 0; index < remaining.size(); index++) {
                if (index > 0) json.append(',');
                json.append(PlayerSnapshot.string(remaining.get(index)));
            }
            return json.append("]}").toString();
        }
    }

    public AdvancementsSnapshot {
        tabs = List.copyOf(tabs);
        entries = List.copyOf(entries);
        if (tabs.size() > MAX_ENTRIES || entries.size() > MAX_ENTRIES) {
            throw new IllegalArgumentException("Too many advancements");
        }
    }

    private static void validate(String id, String title, String icon) {
        if (id == null || id.length() > 256 || !IDENTIFIER.matcher(id).matches() || title == null
                || title.isEmpty() || title.length() > 256 || icon != null && !ICON.matcher(icon).matches()) {
            throw new IllegalArgumentException("Invalid advancement");
        }
    }

    public String toJson() {
        StringBuilder json = new StringBuilder("{\"tabs\":[");
        for (int index = 0; index < tabs.size(); index++) {
            if (index > 0) json.append(',');
            json.append(tabs.get(index).toJson());
        }
        json.append("],\"entries\":[");
        for (int index = 0; index < entries.size(); index++) {
            if (index > 0) json.append(',');
            json.append(entries.get(index).toJson());
        }
        return json.append("]}").toString();
    }
}
