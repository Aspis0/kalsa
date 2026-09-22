/**
 * The notice toast: single slot, 4 s, absolute bottom 96 — lifted from
 * `AppShell.tsx:7062-7077` with `showNotice`'s timer in the root
 * (`AppShell.tsx:3547-3552`). Last-write-wins by construction: one state
 * slot and one timer, never a queue (D2 row 17).
 */
import { Text, View } from "react-native";
import { spacing } from "../theme/tokens";
import { useTypography } from "../theme/typography";
import { useLabTheme } from "../ui/labTheme";

export function HostNotice({ text }: { text: string | null }) {
  const { colors } = useLabTheme<{ colors: { panelSolid: string; line: string; ink: string } }>();
  const typography = useTypography();
  if (text === null) return null;
  return (
    <View
      style={{
        position: "absolute",
        left: spacing.lg,
        right: spacing.lg,
        bottom: 96,
        backgroundColor: colors.panelSolid,
        borderRadius: 12,
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.sm,
        borderWidth: 1,
        borderColor: colors.line,
      }}
      testID="host.notice"
      accessibilityRole="text"
      accessibilityLabel={text}
    >
      <Text style={[typography.bodyXs, { color: colors.ink }]}>{text}</Text>
    </View>
  );
}
