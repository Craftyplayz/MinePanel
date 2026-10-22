package dev.craftyplayz.minepanel.curios;

//? if neoforge {
/*import dev.craftyplayz.minepanel.telemetry.InventorySnapshot;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.item.ItemStack;
import top.theillusivec4.curios.api.CuriosApi;

import java.util.ArrayList;
import java.util.List;

// Curios (checked against 9.5.1) keeps worn accessories in a capability on the player that the server syncs to the
// owning client, so reading it here is a plain client-side read: nothing is requested from or sent to the server.
public final class CuriosSlots {
    private CuriosSlots() {
    }

    // Client thread. Non-empty stacks across every slot type (back, ring, belt, ...), in Curios' slot order.
    public static List<ItemStack> worn(Player player) {
        List<ItemStack> worn = new ArrayList<>();
        CuriosApi.getCuriosInventory(player).ifPresent(inventory -> inventory.getCurios().values().forEach(handler -> {
            var stacks = handler.getStacks();
            for (int slot = 0; slot < stacks.getSlots(); slot++) {
                ItemStack stack = stacks.getStackInSlot(slot);
                if (!stack.isEmpty() && worn.size() < InventorySnapshot.MAX_ACCESSORIES) worn.add(stack);
            }
        }));
        return worn;
    }
}
*///?}
