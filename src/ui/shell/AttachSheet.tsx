/**
 * The attach sheet CALLED by the host: one modal over row data, used for
 * BOTH of the controller's sheets — the three-answer action list
 * (`AiChatPage.tsx:4588-4620`) and the nested library-document picker
 * (`:4627-4663`). This file only draws: real 48 dp rows (never `hitSlop`),
 * a testID and an accessible name on every pressable, backdrop and Android
 * back both cancel through the caller's `onClose`.
 *
 * Icons arrive as KEYS, not nodes, so the row data is plain data and the
 * host can build and test it without React.
 */
import type { ReactNode } from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import { Camera, FileText, Image as ImageIcon, X, BookOpen } from "lucide-react-native";
import { radius, spacing, type, type DesignColors } from "../../theme/design";

export type AttachSheetIcon = "library" | "camera" | "file" | "book" | "close";

export interface AttachSheetRowData {
  testID: string;
  icon: AttachSheetIcon;
  label: string;
  onPress: () => void;
}

export interface AttachSheetProps {
  rows: readonly AttachSheetRowData[];
  colors: DesignColors;
  onClose: () => void;
  /** The document list may scroll (`maxHeight` clips); the action list never does. */
  scroll?: boolean;
}

const ICONS: Record<AttachSheetIcon, (color: string) => ReactNode> = {
  library: (color) => <ImageIcon size={18} color={color} />,
  camera: (color) => <Camera size={18} color={color} />,
  file: (color) => <FileText size={18} color={color} />,
  book: (color) => <BookOpen size={18} color={color} />,
  close: (color) => <X size={18} color={color} />,
};

function SheetRow({ row, colors }: { row: AttachSheetRowData; colors: DesignColors }) {
  return (
    <Pressable
      testID={row.testID}
      onPress={row.onPress}
      accessible
      accessibilityRole="button"
      accessibilityLabel={row.label}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.sm,
        paddingHorizontal: spacing.md,
        minHeight: 48,
        backgroundColor: pressed ? `${colors.accent}22` : "transparent",
      })}
    >
      <View style={{ width: 20, alignItems: "center" }}>{ICONS[row.icon](colors.ink)}</View>
      <Text numberOfLines={1} style={[type.meta, { color: colors.ink, flexShrink: 1 }]}>
        {row.label}
      </Text>
    </Pressable>
  );
}

export function AttachSheet({ rows, colors, onClose, scroll = false }: AttachSheetProps) {
  const body = rows.map((row) => <SheetRow key={row.testID} row={row} colors={colors} />);
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable
        testID="shell.attach.backdrop"
        style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.42)", justifyContent: "flex-end" }}
        onPress={onClose}
        importantForAccessibility="no"
      >
        <Pressable
          style={{ padding: spacing.md, paddingBottom: 32 }}
          onPress={() => undefined}
          accessibilityElementsHidden={false}
        >
          <View
            style={{
              backgroundColor: colors.page,
              borderRadius: radius.xl ?? 24,
              overflow: "hidden",
              ...(scroll ? { maxHeight: 360 } : null),
            }}
          >
            {scroll ? <ScrollView>{body}</ScrollView> : body}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
