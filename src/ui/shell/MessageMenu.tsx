/**
 * The message action sheet, as a presentational leaf: it draws the rows the
 * HOST decides it may show, and an action that cannot run is ABSENT from that
 * list, never present and inert (the builder's gates live in
 * `src/host/messageMenuRows.ts`; read-aloud has no sheet row — its chip rides
 * under an answer).
 *
 * Shape parity with the controller: a translucent backdrop that dismisses, a
 * caption that turns into `common.copied` during the flash, rows with icon +
 * label, cancel last, Android back closes, and the inner sheet is a
 * swallow-pressable (`onPress={() => undefined}`) so taps on dead space inside
 * it do not dismiss the menu.
 *
 * Every row is a real `MIN_TOUCH_TARGET`-tall box with a testID and an
 * accessible name — never `hitSlop`. The icons are this file's own mapping
 * from the row id, so the host ships data, not JSX.
 */
import { useMemo, type ReactNode } from "react";
import { Modal, Pressable, Text, View } from "react-native";
import { ClipboardList, Copy, Languages, RefreshCw, SquarePen, X } from "lucide-react-native";

import { useLocale } from "../../i18n";
import {
  elevation,
  modes,
  radius,
  spacing,
  type,
  type ThemeMode,
} from "../../theme/design";
import { MIN_TOUCH_TARGET } from "./shellGeometry";

/** The rows this sheet can ever draw. The host's pure builder decides which
 *  of them a given message gets (`messageMenuRows.ts`). */
export type MessageMenuRowId = "copy" | "notes" | "translate" | "edit" | "regenerate" | "cancel";

export type MessageMenuRow = {
  id: MessageMenuRowId;
  /** Already translated, flash included — the host owns the flash state. */
  label: string;
  testID: string;
};

export type MessageMenuProps = {
  mode: ThemeMode;
  visible: boolean;
  /** The caption above the rows: the long-press line, or `common.copied`. */
  caption: string;
  rows: readonly MessageMenuRow[];
  /** Safe-area bottom: the sheet clears the gesture bar. */
  bottomInset: number;
  onRowPress: (id: MessageMenuRowId) => void;
  /** Android back = cancel. */
  onRequestClose: () => void;
};

function iconFor(id: MessageMenuRowId, color: string): ReactNode {
  switch (id) {
    case "copy":
      return <Copy size={18} color={color} />;
    case "notes":
      return <ClipboardList size={18} color={color} />;
    case "translate":
      return <Languages size={18} color={color} />;
    case "edit":
      return <SquarePen size={18} color={color} />;
    case "regenerate":
      return <RefreshCw size={18} color={color} />;
    case "cancel":
      return <X size={18} color={color} />;
  }
}

export function MessageMenu({
  mode,
  visible,
  caption,
  rows,
  bottomInset,
  onRowPress,
  onRequestClose,
}: MessageMenuProps) {
  const { t } = useLocale();
  const colors = modes[mode];
  const styles = useMemo(
    () => ({
      backdrop: {
        flex: 1,
        backgroundColor: "rgba(0,0,0,0.42)",
        justifyContent: "flex-end" as const,
      },
      sheet: {
        backgroundColor: colors.surface,
        ...elevation.raised,
        borderRadius: radius.xl,
        overflow: "hidden" as const,
        marginBottom: bottomInset + spacing.md,
        marginHorizontal: spacing.sm,
      },
      caption: {
        color: colors.silence,
        fontFamily: type.meta.fontFamily,
        fontSize: type.meta.fontSize,
        lineHeight: type.meta.lineHeight,
        paddingHorizontal: spacing.md,
        paddingTop: spacing.md,
        paddingBottom: spacing.xs,
      },
      row: {
        alignItems: "center" as const,
        flexDirection: "row" as const,
        gap: spacing.sm,
        minHeight: MIN_TOUCH_TARGET,
        paddingHorizontal: spacing.md,
      },
      rowLabel: {
        color: colors.ink,
        fontFamily: type.label.fontFamily,
        fontSize: type.label.fontSize,
        lineHeight: type.label.lineHeight,
      },
      rowLabelMuted: {
        color: colors.silence,
      },
    }),
    [bottomInset, colors],
  );

  if (!visible) return null;
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onRequestClose}>
      {/* The backdrop is the cancel gesture: a tap outside the sheet closes the
          menu. Real box, named node. */}
      <Pressable
        testID="shell.messageMenu.backdrop"
        accessibilityRole="button"
        accessibilityLabel={t("common.close")}
        onPress={onRequestClose}
        style={styles.backdrop}
      >
        {/* The swallow: without this the backdrop would close on taps landing
            on dead space INSIDE the sheet. */}
        <Pressable
          testID="shell.messageMenu.sheet"
          accessibilityRole="menu"
          accessibilityLabel={caption}
          onPress={() => undefined}
          style={styles.sheet}
        >
          <Text testID="shell.messageMenu.caption" style={styles.caption}>
            {caption}
          </Text>
          <View>
            {rows.map((row) => (
              <Pressable
                key={row.id}
                testID={row.testID}
                accessibilityRole="button"
                accessibilityLabel={row.label}
                onPress={() => onRowPress(row.id)}
                style={({ pressed }) => [styles.row, { opacity: pressed ? 0.7 : 1 }]}
              >
                {iconFor(
                  row.id,
                  row.id === "cancel" ? colors.silence : colors.ink,
                )}
                <Text
                  style={[
                    styles.rowLabel,
                    row.id === "cancel" ? styles.rowLabelMuted : null,
                  ]}
                >
                  {row.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
