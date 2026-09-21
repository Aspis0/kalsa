/**
 * The shell's stylesheet, out of `Shell.tsx` so the component stays readable and
 * under the file-size rule. It is a MOVE, not a redesign: every value here is
 * the one the component carried when this file was split out, and the arithmetic
 * behind the numbers still lives in `shellGeometry.ts`.
 */
import { StyleSheet } from "react-native";

import {
  elevation,
  families,
  measure,
  radius,
  spacing,
  type,
  type DesignColors,
} from "../../theme/design";
import {
  COMPOSER_FIELD_HEIGHT,
  COMPOSER_SIDE_PADDING,
  MIN_TOUCH_TARGET,
  SHELL_NOTICE_HEIGHT,
  STRIP_GAP,
  STRIP_MARK_SIZE,
  STRIP_SIDE_PADDING,
} from "./shellGeometry";

export function createShellStyles(colors: DesignColors) {
  return StyleSheet.create({
    root: {
      backgroundColor: colors.page,
      flex: 1,
    },
    strip: {
      alignItems: "center",
      flexDirection: "row",
      gap: STRIP_GAP,
      paddingHorizontal: STRIP_SIDE_PADDING,
    },
    iconButton: {
      alignItems: "center",
      backgroundColor: colors.surface,
      borderRadius: MIN_TOUCH_TARGET / 2,
      height: MIN_TOUCH_TARGET,
      justifyContent: "center",
      width: MIN_TOUCH_TARGET,
      ...elevation.raised,
    },
    pill: {
      alignItems: "center",
      backgroundColor: colors.surface,
      borderRadius: radius.pill,
      flex: 1,
      flexDirection: "row",
      gap: spacing.sm,
      height: MIN_TOUCH_TARGET,
      minWidth: 0,
      paddingHorizontal: spacing.sm,
      ...elevation.raised,
    },
    mark: {
      // The mock's `.pick .mark`: a 28 dp circular clip with the raster filling
      // it (`object-fit: cover`). `icon.png` is the full-bleed plate — unlike
      // the composer's JPEGs it carries no sage margin — so cover needs no
      // scale. The ground only shows while the image decodes.
      backgroundColor: colors.surfaceMuted,
      borderRadius: STRIP_MARK_SIZE / 2,
      height: STRIP_MARK_SIZE,
      overflow: "hidden",
      width: STRIP_MARK_SIZE,
    },
    markImage: {
      height: STRIP_MARK_SIZE,
      width: STRIP_MARK_SIZE,
    },
    pillText: {
      flex: 1,
      minWidth: 0,
    },
    modelName: {
      color: colors.ink,
      fontFamily: families.sansSemi,
      fontSize: type.label.fontSize,
      letterSpacing: -0.1,
      lineHeight: type.label.lineHeight,
    },
    whereRow: {
      alignItems: "center",
      flexDirection: "row",
      gap: spacing.xxs,
    },
    whereDot: {
      backgroundColor: colors.accent,
      borderRadius: 3,
      height: 6,
      width: 6,
    },
    where: {
      color: colors.silence,
      fontFamily: families.sansMedium,
      fontSize: type.meta.fontSize,
      lineHeight: type.meta.lineHeight,
    },
    notice: {
      // Full width, one line, between the strip and the transcript. The height
      // is the geometry's, not the text's: the row cannot grow past one line
      // even if the string is long, because the band was computed from it.
      height: SHELL_NOTICE_HEIGHT,
      justifyContent: "center",
      overflow: "hidden",
      paddingHorizontal: measure.gutterCompact,
    },
    noticeLabel: {
      color: colors.silence,
      fontFamily: families.sansMedium,
      fontSize: type.meta.fontSize,
      lineHeight: type.meta.lineHeight,
    },
    transcript: {
      overflow: "hidden",
      paddingHorizontal: measure.gutterCompact,
    },
    composerBand: {
      justifyContent: "flex-start",
      paddingBottom: spacing.md,
      paddingHorizontal: COMPOSER_SIDE_PADDING,
      paddingTop: spacing.sm,
    },
    field: {
      alignItems: "center",
      backgroundColor: colors.surface,
      borderRadius: radius.xl,
      flexDirection: "row",
      gap: spacing.sm,
      height: COMPOSER_FIELD_HEIGHT,
      paddingHorizontal: spacing.sm,
      ...elevation.dock,
    },
    fieldIcon: {
      alignItems: "center",
      borderRadius: MIN_TOUCH_TARGET / 2,
      height: MIN_TOUCH_TARGET,
      justifyContent: "center",
      width: MIN_TOUCH_TARGET,
    },
    input: {
      color: colors.ink,
      flex: 1,
      fontFamily: families.reading,
      fontSize: type.body.fontSize,
      lineHeight: type.body.lineHeight,
      minWidth: 0,
      padding: 0,
      textAlignVertical: "center",
    },
    send: {
      alignItems: "center",
      backgroundColor: colors.accent,
      borderRadius: MIN_TOUCH_TARGET / 2,
      height: MIN_TOUCH_TARGET,
      justifyContent: "center",
      width: MIN_TOUCH_TARGET,
    },
  });
}
