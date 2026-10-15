package dev.craftyplayz.minepanel;

import dev.craftyplayz.minepanel.telemetry.StatusEffect;
import net.minecraft.world.effect.MobEffectInstance;
import net.minecraft.world.entity.player.Player;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Converts active effects into wall-clock end times and detects beacon effects. Beacons (and conduits) apply their
 * effects as "ambient" and re-apply them every few seconds, so an effect counts as a beacon effect if it is ambient
 * or its remaining duration has been topped up repeatedly. Client thread only.
 */
final class EffectsCollector {
    private static final long TICK_MILLIS = 50;
    /** End-time jitter below this is ignored so a steadily ticking effect does not resend every sample. */
    private static final long JITTER_MILLIS = 1_500;
    private static final int REFRESHES_FOR_BEACON = 2;

    private record Tracked(Long endsAt, int duration, int refreshes) {
    }

    private final Map<String, Tracked> tracked = new HashMap<>();

    void reset() {
        tracked.clear();
    }

    List<StatusEffect> collect(Player player, long now) {
        List<StatusEffect> result = new ArrayList<>();
        Map<String, Tracked> seen = new HashMap<>();
        for (MobEffectInstance instance : player.getActiveEffects()) {
            var key = instance.getEffect().unwrapKey();
            if (key.isEmpty() || result.size() == StatusEffect.MAX_EFFECTS) continue;
            String id = key.get().identifier().toString();
            Tracked previous = tracked.get(id);
            int duration = instance.getDuration();
            Long endsAt = instance.isInfiniteDuration() ? null : now + duration * TICK_MILLIS;
            int refreshes = previous == null ? 0 : previous.refreshes;
            if (previous != null && !instance.isInfiniteDuration() && duration > previous.duration + 20) refreshes++;
            if (endsAt != null && previous != null && previous.endsAt != null
                    && Math.abs(endsAt - previous.endsAt) < JITTER_MILLIS) {
                endsAt = previous.endsAt;
            }
            Tracked current = new Tracked(endsAt, duration, refreshes);
            seen.put(id, current);
            String name = instance.getEffect().value().getDisplayName().getString();
            result.add(new StatusEffect(id, name.isBlank() ? id : name.length() > 256 ? name.substring(0, 256) : name,
                    Math.min(255, Math.max(0, instance.getAmplifier())), endsAt,
                    instance.isAmbient() || refreshes >= REFRESHES_FOR_BEACON));
        }
        tracked.clear();
        tracked.putAll(seen);
        result.sort(Comparator.comparing(StatusEffect::id));
        return result;
    }
}
