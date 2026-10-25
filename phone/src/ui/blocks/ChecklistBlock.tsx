import React from "react";
import { Pressable, Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";

import { checklistItems, isItemTicked, toggleChecklistItem } from "../../domain/miniappState";
import type { TranslateFn } from "../../i18n";

type Props = {
  block: Record<string, unknown>;
  color: string;
  onStateChange: (state: Record<string, unknown>) => void;
  state: Record<string, unknown>;
  styles: Record<string, any>;
  t: TranslateFn;
};

/** How many items draw before the block stops growing; the builder caps at 12
 *  and a hand-written block is bounded by the 64 KiB envelope guard. */
const MAX_ITEMS = 50;

/**
 * A `checklist` block: one real checkbox per item, ticked means struck
 * through, no "Step N". The ticks live in the envelope's `state`, keyed by
 * the item id, so they survive a reload; `onStateChange` writes the next
 * state through to the stored message.
 */
export function ChecklistBlockView({ block, color, onStateChange, state, styles, t }: Props) {
  const items = checklistItems(block).slice(0, MAX_ITEMS);
  const title = typeof block.title === "string" && block.title.trim() ? block.title : "";
  return (
    <View style={styles.miniappPlannerTimeline}>
      <Text style={styles.miniappBlockTitle}>{title || t("miniapp.checklistTitle")}</Text>
      {items.length ? (
        items.map((item) => {
          const ticked = isItemTicked(state, item.id);
          return (
            <Pressable
              accessibilityLabel={item.title}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: ticked }}
              key={item.id}
              onPress={() => onStateChange(toggleChecklistItem(state, item.id, !ticked))}
              style={{ alignItems: "center", flexDirection: "row", gap: 8, paddingVertical: 4 }}
            >
              <Ionicons
                color={color}
                name={ticked ? "checkbox" : "square-outline"}
                size={18}
              />
              <Text
                numberOfLines={2}
                style={[
                  styles.miniappFallbackText,
                  ticked ? { opacity: 0.6, textDecorationLine: "line-through" } : null,
                ]}
              >
                {item.title}
              </Text>
            </Pressable>
          );
        })
      ) : (
        <Text style={styles.miniappFallbackText}>{t("miniapp.checklistEmpty")}</Text>
      )}
    </View>
  );
}
