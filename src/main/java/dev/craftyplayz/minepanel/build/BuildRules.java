package dev.craftyplayz.minepanel.build;

import java.util.function.BooleanSupplier;

/**
 * The per-position comparison of Litematica's {@code SchematicVerifier.checkBlockStates}, with the adapter supplying
 * each block test. Litematica's "different block" and wrong-state mismatches are both {@link Result#WRONG}; an ignored
 * mismatch is accepted, so it counts as placed (or as nothing for schematic air).
 */
public final class BuildRules {
    public enum Result { NONE, PLACED, MISSING, WRONG, EXTRA }

    private BuildRules() {
    }

    /**
     * @param identical       the world state is the schematic state, or both are air
     * @param equalIgnoringAge Litematica's {@code ignoreCropAge} is on and the states differ only by age
     * @param ignored          the pair is one of the placement verifier's ignored mismatches
     * @param ignorableExtra   the world block may stand where the schematic has air: an existing fluid with
     *                         {@code ignoreExistingFluids} on, or a block in Litematica's ignore list
     */
    public static Result classify(boolean expectedAir, boolean actualAir, boolean identical,
                                  BooleanSupplier equalIgnoringAge, BooleanSupplier ignored,
                                  BooleanSupplier ignorableExtra) {
        if (identical || expectedAir && actualAir || equalIgnoringAge.getAsBoolean() || ignored.getAsBoolean()) {
            return expectedAir ? Result.NONE : Result.PLACED;
        }
        if (!expectedAir) return actualAir ? Result.MISSING : Result.WRONG;
        return ignorableExtra.getAsBoolean() ? Result.NONE : Result.EXTRA;
    }
}
