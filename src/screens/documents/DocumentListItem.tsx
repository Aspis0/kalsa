import { useState } from "react";
import { Image, Pressable, Text, View } from "react-native";
import { FileText, GripVertical } from "lucide-react-native";

import {
  formatBytesLocalized,
  type LibraryDoc,
} from "../../documents/DocumentLibrary";
import { useLocale } from "../../i18n";
import { e1, modes, radius, space, type, type ThemeMode } from "../../theme/design";
import { useLabTheme } from "../../ui/labTheme";

const COVER_W = 36;
const COVER_H = 48;
type Props = {
  doc: LibraryDoc;
  drag?: () => void;
  isActive?: boolean;
  onOpen: (doc: LibraryDoc) => void;
};
type ThemeContext = { mode: ThemeMode };

function isUnreadable(doc: LibraryDoc): boolean {
  if (doc.docCount > 0) return false;
  return (
    doc.extractionStatus === "timeout" ||
    doc.extractionStatus === "renderer_error" ||
    doc.extractionStatus === "fs_error"
  );
}

/** One pressable document row, including its current cover and drag affordance. */
export function DocumentListItem({ doc, drag, isActive, onOpen }: Props) {
  const { mode } = useLabTheme<ThemeContext>();
  const colors = modes[mode];
  const { t, locale } = useLocale();
  const [coverFailed, setCoverFailed] = useState(false);
  const sizeLabel = formatBytesLocalized(doc.sizeBytes, locale);
  let meta: string;

  if (isUnreadable(doc)) {
    meta = t("documents.unreadable");
  } else if (doc.kind === "pdf" && typeof doc.pageCount === "number" && doc.pageCount > 0) {
    const pages = doc.pageCount === 1
      ? t("documents.pageCountOne")
      : t("documents.pageCount", { count: doc.pageCount });
    meta = doc.truncated &&
      typeof doc.processedPageCount === "number" &&
      doc.processedPageCount < doc.pageCount
      ? `${pages} (${doc.processedPageCount}/${doc.pageCount})`
      : pages;
  } else {
    meta = t("documents.sizeOnly", { size: sizeLabel });
  }

  const showCover = doc.kind === "pdf" && !!doc.previewUri && !coverFailed;
  const rowLabel = t("documents.detailA11yRow", { name: doc.name, meta });

  return (
    <Pressable
      onPress={() => onOpen(doc)}
      disabled={isActive}
      accessibilityRole="button"
      accessibilityLabel={rowLabel}
      style={({ pressed }) => ({
        minHeight: 64,
        flexDirection: "row",
        alignItems: "center",
        gap: space.sm,
        paddingLeft: space.md,
        paddingRight: space.xs,
        borderRadius: radius.card,
        backgroundColor: pressed || isActive ? colors.tint : colors.surface,
        opacity: isActive ? 0.8 : 1,
        ...e1,
      })}
    >
      <View
        style={{
          width: COVER_W,
          height: COVER_H,
          borderRadius: radius.row,
          overflow: "hidden",
          backgroundColor: colors.tint,
          alignItems: "center",
          justifyContent: "center",
        }}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {showCover ? (
          <Image
            source={{ uri: doc.previewUri }}
            style={{ width: COVER_W, height: COVER_H }}
            resizeMode="cover"
            onError={() => setCoverFailed(true)}
            accessibilityLabel={t("documents.detailA11yCover", { name: doc.name })}
          />
        ) : (
          <FileText size={22} color={colors.accent} strokeWidth={1.75} />
        )}
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text numberOfLines={1} style={[type.bodyStrong, { color: colors.ink }]}>
          {doc.name}
        </Text>
        <Text numberOfLines={1} style={[type.secondary, { color: colors.ink2 }]}>
          {meta}
        </Text>
      </View>
      {drag ? (
        <Pressable
          onLongPress={drag}
          delayLongPress={120}
          accessibilityRole="button"
          accessibilityLabel={t("documents.detailA11yDrag")}
          accessibilityHint={t("documents.dragHint")}
          style={{ width: 48, height: 48, alignItems: "center", justifyContent: "center" }}
        >
          <GripVertical size={20} color={colors.ink3} strokeWidth={1.75} />
        </Pressable>
      ) : null}
    </Pressable>
  );
}
