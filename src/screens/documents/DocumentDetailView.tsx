/**
 * In-screen document detail (not an AppShell overlay). Cover or TXT snippet,
 * friendly meta (pages + size + added bucket), single destructive Delete.
 */

import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { FileText } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  formatAddedBucket,
  formatAddedDate,
  formatBytesLocalized,
  type LibraryDoc,
} from "../../documents/DocumentLibrary";
import { readPreviewSnippet } from "../../documents/documentStorage";
import { useLocale } from "../../i18n";
import { GlassPanel2, Header } from "../../theme/components";
import { spacing } from "../../theme/tokens";
import { useTypography, fontFamilies } from "../../theme/typography";
import { useLabTheme } from "../../ui/labTheme";

type Props = {
  doc: LibraryDoc;
  onBack: () => void;
  onDelete: (doc: LibraryDoc) => void;
  /** When true, disable delete (import / other op busy). */
  busy?: boolean;
};

function isUnreadable(doc: LibraryDoc): boolean {
  if (doc.docCount > 0) return false;
  const s = doc.extractionStatus;
  return s === "timeout" || s === "renderer_error" || s === "fs_error";
}

export function DocumentDetailView({ doc, onBack, onDelete, busy }: Props) {
  const { colors } = useLabTheme<any>();
  const typography = useTypography();
  const insets = useSafeAreaInsets();
  const { t, locale } = useLocale();
  const [coverFailed, setCoverFailed] = useState(false);
  const [snippet, setSnippet] = useState<string | null>(null);
  const [snippetLoading, setSnippetLoading] = useState(doc.kind === "txt");

  useEffect(() => {
    let cancelled = false;
    if (doc.kind !== "txt") {
      setSnippet(null);
      setSnippetLoading(false);
      return;
    }
    setSnippetLoading(true);
    void readPreviewSnippet(doc).then((s) => {
      if (cancelled) return;
      setSnippet(s);
      setSnippetLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [doc.id, doc.kind, doc.fileUri]);

  const sizeLabel = formatBytesLocalized(doc.sizeBytes, locale);
  const pagesLabel =
    typeof doc.pageCount === "number" && doc.pageCount > 0
      ? doc.pageCount === 1
        ? t("documents.pageCountOne")
        : t("documents.pageCount", { count: doc.pageCount })
      : null;

  const bucket = formatAddedBucket(doc.addedAt);
  const addedLabel =
    bucket === "today"
      ? t("documents.addedToday")
      : bucket === "yesterday"
        ? t("documents.addedYesterday")
        : t("documents.addedOn", {
            date: formatAddedDate(doc.addedAt, locale),
          });

  const metaParts = [
    pagesLabel,
    sizeLabel,
    addedLabel,
  ].filter(Boolean) as string[];
  const metaLine = metaParts.join(" · ");

  const showCover =
    doc.kind === "pdf" &&
    typeof doc.previewUri === "string" &&
    doc.previewUri.length > 0 &&
    !coverFailed;

  return (
    <View style={{ flex: 1, backgroundColor: colors.shell }}>
      <Header
        title={t("documents.detailBack")}
        onBack={onBack}
        backAccessibilityLabel={t("common.back")}
      />
      <ScrollView
        contentContainerStyle={{
          padding: spacing.lg,
          paddingBottom: insets.bottom + spacing.lg,
          gap: spacing.md,
        }}
      >
        <GlassPanel2
          rounded="lg"
          style={{
            overflow: "hidden",
            minHeight: 180,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: colors.panelSolid,
          }}
        >
          {showCover ? (
            <Image
              source={{ uri: doc.previewUri }}
              style={{ width: "100%", height: 280 }}
              resizeMode="contain"
              onError={() => setCoverFailed(true)}
              accessibilityLabel={t("documents.detailA11yCover", {
                name: doc.name,
              })}
            />
          ) : doc.kind === "txt" ? (
            <View style={{ width: "100%", padding: spacing.lg, gap: spacing.sm }}>
              {snippetLoading ? (
                <ActivityIndicator size="small" color={colors.accent} />
              ) : (
                <Text
                  style={[
                    typography.monoSm ?? typography.bodySm,
                    {
                      color: colors.ink,
                      fontFamily: fontFamilies.mono,
                      lineHeight: 20,
                    },
                  ]}
                  numberOfLines={6}
                >
                  {snippet && snippet.length > 0
                    ? snippet
                    : t("documents.detailFallback")}
                </Text>
              )}
            </View>
          ) : (
            <View
              style={{
                width: "100%",
                height: 200,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: colors.accentSoft ?? colors.panelSolid,
              }}
            >
              <FileText size={48} color={colors.accent} style={{ opacity: 0.7 }} />
            </View>
          )}
        </GlassPanel2>

        <View style={{ gap: 4 }}>
          <Text
            style={[
              typography.bodyMd ?? typography.bodySm,
              {
                color: colors.ink,
                fontFamily: fontFamilies.bodySemi,
                fontSize: 18,
              },
            ]}
            accessibilityRole="header"
          >
            {doc.name}
          </Text>
          <Text style={[typography.bodyXs, { color: colors.muted }]}>
            {metaLine}
          </Text>
          {isUnreadable(doc) ? (
            <Text
              style={[
                typography.bodySm,
                { color: colors.muted, marginTop: spacing.xs },
              ]}
            >
              {t("documents.errorPdf")}
            </Text>
          ) : null}
        </View>

        <Pressable
          onPress={() => onDelete(doc)}
          disabled={!!busy}
          accessibilityRole="button"
          accessibilityLabel={t("documents.delete")}
          accessibilityHint={t("documents.deleteHint")}
          style={{
            marginTop: spacing.md,
            paddingVertical: spacing.md,
            borderRadius: 14,
            backgroundColor: "rgba(179, 38, 30, 0.12)",
            alignItems: "center",
            opacity: busy ? 0.5 : 1,
          }}
        >
          <Text
            style={[
              typography.bodySm,
              {
                color: colors.danger ?? "#B3261E",
                fontFamily: fontFamilies.bodySemi,
              },
            ]}
          >
            {t("documents.delete")}
          </Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}
