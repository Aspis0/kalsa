import React from "react";
import { Text } from "react-native";

/**
 * Thin accent caret for in-flight assistant text.
 * A full block glyph (U+258B ▋) sat at body size and read as a missing font.
 */
export function StreamCaret({
  color,
  lineHeight,
}: {
  color: string;
  lineHeight?: number;
}) {
  return (
    <Text
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        color,
        fontSize: 13,
        lineHeight,
        fontWeight: "400",
        opacity: 0.72,
      }}
    >
      {"\u200A\u2502"}
    </Text>
  );
}
