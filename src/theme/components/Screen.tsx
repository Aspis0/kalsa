import React from "react";
import {
  ScrollView,
  StyleProp,
  View,
  ViewStyle,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLabTheme } from "../../ui/labTheme";
import { spacing } from "../tokens";

type Props = {
  children: React.ReactNode;
  contentStyle?: StyleProp<ViewStyle>;
  scroll?: boolean;
  safe?: boolean;
  style?: StyleProp<ViewStyle>;
};

export function Screen({
  children,
  contentStyle,
  scroll = false,
  safe = true,
  style,
}: Props) {
  const { colors } = useLabTheme<any>();
  const Root = safe ? SafeAreaView : View;
  const rootStyle: ViewStyle = {
    backgroundColor: colors.bg,
    flex: 1,
  };
  const contentBase: ViewStyle = {
    gap: spacing.md,
    padding: spacing.md,
  };

  return (
    <Root style={[rootStyle, style]}>
      {scroll ? (
        <ScrollView
          contentContainerStyle={[contentBase, contentStyle]}
          keyboardShouldPersistTaps="handled"
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[{ flex: 1 }, contentBase, contentStyle]}>{children}</View>
      )}
    </Root>
  );
}
