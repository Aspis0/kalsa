/**
 * The shell's stylesheet, out of `Shell.tsx` so the component stays readable
 * and under the file-size rule. A MOVE, not a redesign: every value is the one
 * the component carried when this file split out; the arithmetic behind the
 * numbers lives in `shellGeometry.ts`.
 */
import { StyleSheet } from "react-native";

import {
  e2,
  families,
  measure,
  radius,
  space,
  type,
  type DesignColors,
} from "../../theme/design";
import {
  COMPOSER_FIELD_HEIGHT,
  COMPOSER_SIDE_PADDING,
  MIN_TOUCH_TARGET,
  SHELL_NOTICE_HEIGHT,
} from "./shellGeometry";

export function createShellStyles(colors: DesignColors) {
  return StyleSheet.create({
    root: {
      backgroundColor: colors.page,
      flex: 1,
    },
    holdLine: {
      height: SHELL_NOTICE_HEIGHT,
      justifyContent: "center",
      overflow: "hidden",
      paddingHorizontal: measure.gutter,
    },
    holdLabel: {
      color: colors.ink2,
      fontFamily: type.secondary.fontFamily,
      fontSize: type.secondary.fontSize,
      lineHeight: type.secondary.lineHeight,
    },
    transcript: {
      overflow: "hidden",
      paddingHorizontal: measure.gutterCompact,
    },
    composerBand: {
      justifyContent: "flex-start",
      paddingBottom: 14,
      paddingHorizontal: COMPOSER_SIDE_PADDING,
      paddingTop: space.xs,
    },
    field: {
      alignItems: "center",
      backgroundColor: colors.surface,
      borderColor: colors.line,
      borderRadius: radius.pill,
      borderWidth: 1,
      flexDirection: "row",
      gap: space.xxs,
      height: COMPOSER_FIELD_HEIGHT,
      paddingHorizontal: space.xxs,
      ...e2,
    },
    fieldIcon: {
      alignItems: "center",
      borderRadius: 14,
      height: MIN_TOUCH_TARGET,
      justifyContent: "center",
      width: MIN_TOUCH_TARGET,
    },
    input: {
      color: colors.ink,
      flex: 1,
      fontFamily: families.sans,
      fontSize: 15.5,
      lineHeight: 21,
      minWidth: 0,
      padding: 0,
      textAlignVertical: "center",
    },
    send: {
      alignItems: "center",
      justifyContent: "center",
      width: MIN_TOUCH_TARGET,
    },
    sendCircle: {
      alignItems: "center",
      borderRadius: 20,
      height: 40,
      justifyContent: "center",
      width: 40,
    },
  });
}
