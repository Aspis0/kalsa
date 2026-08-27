import React from "react";
import { Text, View } from "react-native";
import { useLabTheme } from "./labTheme";

export function MonoBadge({ children }: { children: React.ReactNode }) {
  const { styles } = useLabTheme();
  return (
    <View style={styles.monoBadge}>
      <Text style={styles.monoBadgeText}>{children}</Text>
    </View>
  );
}
