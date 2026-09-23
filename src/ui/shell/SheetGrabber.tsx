import { View } from "react-native";
import { radius, spacing, type DesignColors } from "../../theme/design";

export function SheetGrabber({
  colors,
  marginBottom = spacing.sm,
}: {
  colors: DesignColors;
  marginBottom?: number;
}) {
  return (
    <View
      testID="shell.attach.grabber"
      style={{
        width: 36,
        height: 4,
        borderRadius: radius.pill,
        alignSelf: "center",
        marginTop: 8,
        marginBottom,
        backgroundColor: colors.line2,
      }}
    />
  );
}
