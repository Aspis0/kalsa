import { View } from "react-native";
import { radius, spacing, type DesignColors } from "../../theme/design";

export function SheetGrabber({
  colors,
  testID,
  marginBottom = spacing.sm,
}: {
  colors: DesignColors;
  testID: string;
  marginBottom?: number;
}) {
  return (
    <View
      testID={testID}
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
