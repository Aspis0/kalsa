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
import {
  BookOpen,
  Camera,
  FileText,
  Image as ImageIcon,
  Search,
  Share2,
  Sparkles,
  StickyNote,
  Trash2,
  X,
} from "lucide-react-native";
import { e3, radius, spacing, type, type DesignColors } from "../../theme/design";
import { SheetGrabber } from "./SheetGrabber";
import { singleLineSheetTitle } from "./sheetTitleProps";

export type AttachSheetIcon =
  | "library"
  | "camera"
  | "file"
  | "book"
  | "close"
  | "templates"
  | "research"
  | "notes"
  | "share"
  | "trash";

export interface AttachSheetRowData {
  testID: string;
  icon?: AttachSheetIcon;
  label: string;
  accessibilityLabel?: string;
  onPress: () => void;
  role?: "button" | "switch" | "radio";
  selected?: boolean;
  tone?: "danger";
  disabled?: boolean;
}

export interface AttachSheetProps {
  rows: readonly AttachSheetRowData[];
  colors: DesignColors;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  primaryActionLabel?: string;
  onPrimaryAction?: () => void;
  /** The document list may scroll (`maxHeight` clips); the action list never does. */
  scroll?: boolean;
}

const ICONS: Record<AttachSheetIcon, (color: string) => ReactNode> = {
  library: (color) => <ImageIcon size={20} color={color} strokeWidth={1.75} />,
  camera: (color) => <Camera size={20} color={color} strokeWidth={1.75} />,
  file: (color) => <FileText size={20} color={color} strokeWidth={1.75} />,
  book: (color) => <BookOpen size={20} color={color} strokeWidth={1.75} />,
  close: (color) => <X size={20} color={color} strokeWidth={1.75} />,
  templates: (color) => <Sparkles size={20} color={color} strokeWidth={1.75} />,
  research: (color) => <Search size={20} color={color} strokeWidth={1.75} />,
  notes: (color) => <StickyNote size={20} color={color} strokeWidth={1.75} />,
  share: (color) => <Share2 size={20} color={color} strokeWidth={1.75} />,
  trash: (color) => <Trash2 size={20} color={color} strokeWidth={1.75} />,
};

function SheetRow({ row, colors }: { row: AttachSheetRowData; colors: DesignColors }) {
  const iconColor = row.tone === "danger" ? colors.danger : row.selected ? colors.accent : colors.ink3;
  const textColor = row.tone === "danger" ? colors.danger : row.selected ? colors.accent : colors.ink;
  return (
    <Pressable
      testID={row.testID}
      onPress={row.onPress}
      disabled={row.disabled}
      accessible
      accessibilityRole={row.role ?? "button"}
      accessibilityLabel={row.accessibilityLabel ?? row.label}
      accessibilityState={{ disabled: row.disabled, ...(row.selected === undefined ? {} : { checked: row.selected }) }}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.sm,
        paddingHorizontal: spacing.md,
        minHeight: 48,
        opacity: row.disabled ? 0.45 : 1,
        backgroundColor: pressed || row.selected ? colors.tint : "transparent",
      })}
    >
      {row.icon ? <View style={{ width: 20, alignItems: "center" }}>{ICONS[row.icon](iconColor)}</View> : null}
      <Text numberOfLines={1} style={[type.meta, { color: textColor, flexShrink: 1 }]}>
        {row.label}
      </Text>
      {row.role === "switch" ? (
        <View
          style={{
            width: 48,
            height: 28,
            padding: 2,
            borderRadius: 14,
            backgroundColor: row.selected ? colors.brand : colors.line2,
            flexDirection: "row",
            justifyContent: row.selected ? "flex-end" : "flex-start",
            alignItems: "center",
          }}
        >
          <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: "#ffffff" }} />
        </View>
      ) : null}
    </Pressable>
  );
}

export function AttachSheet({
  rows,
  colors,
  onClose,
  title,
  subtitle,
  primaryActionLabel,
  onPrimaryAction,
  scroll = false,
}: AttachSheetProps) {
  const body = rows.map((row) => <SheetRow key={row.testID} row={row} colors={colors} />);
  const heading = title ? singleLineSheetTitle(title) : null;
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
              backgroundColor: colors.surface,
              borderRadius: radius.sheet,
              overflow: "hidden",
              ...e3,
              ...(scroll ? { maxHeight: 360 } : null),
            }}
          >
            <SheetGrabber colors={colors} testID="shell.attach.grabber" />
            {heading ? (
              <Text
                accessibilityRole="header"
                numberOfLines={heading.numberOfLines}
                style={[type.title, { color: colors.ink, paddingHorizontal: spacing.md, paddingTop: spacing.md, paddingBottom: spacing.xs }]}
              >
                {heading.title}
              </Text>
            ) : null}
            {subtitle ? (
              <Text style={[type.secondary, { color: colors.ink2, paddingHorizontal: spacing.md, paddingBottom: spacing.sm }]}>
                {subtitle}
              </Text>
            ) : null}
            {scroll ? <ScrollView>{body}</ScrollView> : body}
            {primaryActionLabel && onPrimaryAction ? (
              <View style={{ padding: spacing.md, paddingTop: spacing.sm }}>
                <Pressable
                  testID="shell.attach.primary"
                  onPress={onPrimaryAction}
                  accessibilityRole="button"
                  accessibilityLabel={primaryActionLabel}
                  style={({ pressed }) => ({
                    minHeight: 52,
                    alignItems: "center",
                    justifyContent: "center",
                    borderRadius: radius.button,
                    backgroundColor: pressed ? colors.brandDeep : colors.brand,
                  })}
                >
                  <Text style={[type.bodyStrong, { color: colors.onBrand }]}>{primaryActionLabel}</Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
