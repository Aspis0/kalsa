/**
 * The message action sheet — the controller's modal at
 * `AiChatPage.tsx:4385-4496`, as a presentational leaf: it draws the rows the
 * HOST decides it may show, and an action that cannot run is ABSENT from that
 * list, never present and inert (translate, edit and read-aloud are absent
 * because their systems are deferred; see `src/host/messageMenuRows.ts`).
 *
 * Shape parity with the controller: a translucent backdrop that dismisses
 * (`:4390-4395`), a caption line above the rows that turns into `common.copied`
 * during the flash (`:4412`), rows with an icon + label (`AttachSheetRow`,
 * `:4416-4486`), cancel last, Android back closes (`onRequestClose`). The
 * inner sheet is a swallow-pressable exactly like the controller's
 * `onPress={() => undefined}` (`:4401`) so taps on dead space inside the sheet
 * do not dismiss it.
 *
 * Every row is a real `MIN_TOUCH_TARGET`-tall box with a testID and an
 * accessible name — never `hitSlop`. The icons are this file's own mapping
 * from the row id, so the host ships data, not JSX.
 */
import React, { useMemo } from "react";
import { Modal, Pressable, Text, View } from "react-native";
import { ClipboardList, Copy, RefreshCw, X } from "lucide-react-native";

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
export type MessageMenuRowId = "copy" | "notes" | "regenerate" | "cancel";

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
  /** Safe-area bottom: the sheet clears the gesture bar like the controller's
   *  `paddingBottom: insets.bottom + spacing.md` (`Chat:4490`). */
  bottomInset: number;
  onRowPress: (id: MessageMenuRowId) => void;
  /** Android back = cancel, the controller's `onRequestClose` (`:4388`). */
  onRequestClose: () => void;
};

function iconFor(id: MessageMenuRowId, color: string): React.ReactNode {
  switch (id) {
    case "copy":
      return <Copy size={18} color={color} />;
    case "notes":
      return <ClipboardList size={18} color={color} />;
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
          menu (controller `Chat:4390-4395`). Real box, named node. */}
      <Pressable
        testID="shell.messageMenu.backdrop"
        accessibilityRole="button"
        accessibilityLabel={t("common.close")}
        onPress={onRequestClose}
        style={styles.backdrop}
      >
        {/* The swallow: without this the backdrop would close on taps landing
            on dead space INSIDE the sheet (controller `Chat:4401-4404`). */}
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
