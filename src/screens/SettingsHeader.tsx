import { Pressable, Text, View } from "react-native";
import { ChevronLeft } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { modes, space, type ThemeMode } from "../theme/design";
import { useLabTheme } from "../ui/labTheme";

type Props = {
  title: string;
  onBack: () => void;
  backLabel: string;
};

export function SettingsHeader({ title, onBack, backLabel }: Props) {
  const insets = useSafeAreaInsets();
  const { mode } = useLabTheme<{ mode: ThemeMode }>();
  const colors = modes[mode];

  return (
    <View
      style={{
        minHeight: 56 + insets.top,
        paddingTop: insets.top + space.xs,
        paddingBottom: space.xs,
        paddingHorizontal: space.md,
        justifyContent: "center",
      }}
    >
      <Pressable
        testID="settings.back"
        onPress={onBack}
        accessibilityRole="button"
        accessibilityLabel={backLabel}
        style={{ width: 40, height: 40, alignItems: "center", justifyContent: "center" }}
      >
        <ChevronLeft size={20} color={colors.ink3} strokeWidth={1.75} />
      </Pressable>
      <Text
        numberOfLines={1}
        style={{
          position: "absolute",
          left: 56,
          right: 56,
          bottom: space.xs,
          color: colors.ink,
          fontFamily: "Inter_700Bold",
          fontSize: 26,
          lineHeight: 32,
          letterSpacing: -0.52,
          textAlign: "center",
        }}
      >
        {title}
      </Text>
    </View>
  );
}
