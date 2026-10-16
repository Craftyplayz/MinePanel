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
 * or it keeps being re-applied. It stops counting once no re-application has arrived for a while, since a beacon that
 * is out of range or switched off leaves the effect ticking down normally. Boosted beacons remove and re-give their
 * effect in quick succession, so an effect that briefly vanishes is remembered, and a beacon effect stays displayed
 * through the gap, instead of coming back as a brand-new non-beacon effect. Client thread only.
 */
final class EffectsCollector {
    private static final long TICK_MILLIS = 50;
    /** End-time jitter below this is ignored so a steadily ticking effect does not resend every sample. */
    private static final long JITTER_MILLIS = 1_500;
    private static final int REFRESHES_FOR_BEACON = 2;
    /** Beacons re-apply every 4 seconds; a longer gap means the beacon no longer reaches the player. */
    private static final long BEACON_TIMEOUT_MILLIS = 6_000;
    /** How long a beacon effect that was removed keeps showing while its beacon is expected to give it back. */
    private static final long ABSENCE_GRACE_MILLIS = 2_000;

    private record Tracked(MobEffectInstance instance, StatusEffect effect, int duration, int refreshes,
                           long refreshedAt, long seenAt) {
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
            long refreshedAt = previous == null ? now : previous.refreshedAt;
            // The client swaps in a new instance whenever the server re-applies an effect, including after removing it.
            if (previous != null && (instance != previous.instance
                    || !instance.isInfiniteDuration() && duration > previous.duration + 20)) {
                refreshes = now - refreshedAt <= BEACON_TIMEOUT_MILLIS ? refreshes + 1 : 1;
                refreshedAt = now;
            }
            if (endsAt != null && previous != null && previous.effect.endsAt() != null
                    && Math.abs(endsAt - previous.effect.endsAt()) < JITTER_MILLIS) {
                endsAt = previous.effect.endsAt();
            }
            String name = instance.getEffect().value().getDisplayName().getString();
            StatusEffect effect = new StatusEffect(id,
                    name.isBlank() ? id : name.length() > 256 ? name.substring(0, 256) : name,
                    Math.min(255, Math.max(0, instance.getAmplifier())), endsAt,
                    (instance.isAmbient() || refreshes >= REFRESHES_FOR_BEACON)
                            && now - refreshedAt <= BEACON_TIMEOUT_MILLIS);
            seen.put(id, new Tracked(instance, effect, duration, refreshes, refreshedAt, now));
            result.add(effect);
        }
        tracked.forEach((id, lost) -> {
            if (seen.containsKey(id) || now - lost.seenAt > BEACON_TIMEOUT_MILLIS) return;
            seen.put(id, lost);
            if (lost.effect.beacon() && now - lost.seenAt <= ABSENCE_GRACE_MILLIS
                    && result.size() < StatusEffect.MAX_EFFECTS) {
                result.add(lost.effect);
            }
        });
        tracked.clear();
        tracked.putAll(seen);
        result.sort(Comparator.comparing(StatusEffect::id));
        return result;
    }
}
