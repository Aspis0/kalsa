/**
 * Library list row: cover (or tinted FileText tile) + title + friendly meta +
 * drag handle. No jargon — pages OR size, never tokens / kind / status.
 */

import React, { useState } from "react";
import { Image, Pressable, Text, View } from "react-native";
import { FileText, GripVertical } from "lucide-react-native";

import {
  formatBytesLocalized,
  type LibraryDoc,
} from "../../documents/DocumentLibrary";
import { useLocale } from "../../i18n";
import { spacing } from "../../theme/tokens";
import { useTypography, fontFamilies } from "../../theme/typography";
import { useLabTheme } from "../../ui/labTheme";

const COVER_W = 56;
const COVER_H = 72;
const COVER_RADIUS = 12;

type Props = {
  doc: LibraryDoc;
  /** Optional drag handle props from react-native-draggable-flatlist. */
  drag?: () => void;
  isActive?: boolean;
  onOpen: (doc: LibraryDoc) => void;
};

function isUnreadable(doc: LibraryDoc): boolean {
  if (doc.docCount > 0) return false;
  const s = doc.extractionStatus;
  return s === "timeout" || s === "renderer_error" || s === "fs_error";
}

export function DocumentListItem({ doc, drag, isActive, onOpen }: Props) {
  const { colors } = useLabTheme<any>();
  const typography = useTypography();
  const { t, locale } = useLocale();
  const [coverFailed, setCoverFailed] = useState(false);

  const sizeLabel = formatBytesLocalized(doc.sizeBytes, locale);
  let meta: string;
  if (isUnreadable(doc)) {
    meta = t("documents.unreadable");
  } else if (doc.kind === "pdf" && typeof doc.pageCount === "number" && doc.pageCount > 0) {
    meta =
      doc.pageCount === 1
        ? t("documents.pageCountOne")
        : t("documents.pageCount", { count: doc.pageCount });
  } else {
    meta = t("documents.sizeOnly", { size: sizeLabel });
  }

  const a11y = t("documents.detailA11yRow", { name: doc.name, meta });
  const showCover =
    doc.kind === "pdf" &&
    typeof doc.previewUri === "string" &&
    doc.previewUri.length > 0 &&
    !coverFailed;

  return (
    <Pressable
      onPress={() => onOpen(doc)}
      disabled={isActive}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.sm,
        paddingVertical: spacing.sm,
        paddingHorizontal: spacing.md,
        opacity: isActive ? 0.92 : 1,
        backgroundColor: isActive
          ? colors.panelSolid ?? colors.shell
          : "transparent",
        borderRadius: COVER_RADIUS,
      }}
    >
      <View
        style={{
          width: COVER_W,
          height: COVER_H,
          borderRadius: COVER_RADIUS,
          overflow: "hidden",
          backgroundColor: colors.accentSoft ?? colors.panelSolid,
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
            accessibilityLabel={t("documents.detailA11yCover", {
              name: doc.name,
            })}
          />
        ) : (
          <FileText
            size={28}
            color={colors.accent}
            style={{ opacity: 0.85 }}
          />
        )}
      </View>

      <View style={{ flex: 1, minWidth: 0 }}>
        <Text
          style={[
            typography.bodySm,
            { color: colors.ink, fontFamily: fontFamilies.bodySemi },
          ]}
          numberOfLines={1}
        >
          {doc.name}
        </Text>
        <Text
          style={[typography.bodyXs, { color: colors.muted, marginTop: 2 }]}
          numberOfLines={1}
        >
          {meta}
        </Text>
      </View>

      {drag ? (
        <Pressable
          onLongPress={drag}
          delayLongPress={180}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={t("documents.detailA11yDrag")}
          accessibilityHint={t("documents.dragHint")}
          style={{ padding: 6 }}
        >
          <GripVertical size={20} color={colors.muted} />
        </Pressable>
      ) : null}
    </Pressable>
  );
}
