/**
 * In-screen document detail (not an AppShell overlay). Cover or TXT snippet,
 * friendly meta (pages + size + added bucket), single destructive Delete.
 */

import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
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
  isDocumentUnreadable,
  type LibraryDoc,
} from "../../documents/DocumentLibrary";
import { readPreviewSnippet } from "../../documents/documentStorage";
import { useLocale } from "../../i18n";
import { e1, modes, radius, space, type, type ThemeMode } from "../../theme/design";
import { useLabTheme } from "../../ui/labTheme";
import { SettingsHeader } from "../SettingsHeader";

export type RebuildSemanticIndexResult =
  | true
  | {
      ok: false;
      reason: "busy" | "in_progress" | "no_embedder" | "unavailable";
    };

type Props = {
  doc: LibraryDoc;
  onBack: () => void;
  onDelete: (doc: LibraryDoc) => void;
  onRebuildSemanticIndex: (id: string) => Promise<RebuildSemanticIndexResult>;
  /** When true, disable delete (import / other op busy). */
  busy?: boolean;
};

export function DocumentDetailView({
  doc,
  onBack,
  onDelete,
  onRebuildSemanticIndex,
  busy,
}: Props) {
  const { mode } = useLabTheme<{ mode: ThemeMode }>();
  const colors = modes[mode];
  const insets = useSafeAreaInsets();
  const { t, locale } = useLocale();
  const [coverFailed, setCoverFailed] = useState(false);
  const [snippet, setSnippet] = useState<string | null>(null);
  const [snippetLoading, setSnippetLoading] = useState(doc.kind === "txt");
  const [rebuilding, setRebuilding] = useState(false);

  const handleRebuild = async () => {
    if (busy || rebuilding) return;
    setRebuilding(true);
    try {
      const accepted = await onRebuildSemanticIndex(doc.id);
      if (accepted === true) {
        Alert.alert(t("documents.title"), t("documents.rebuildIndexStarted"));
        return;
      }
      const messageKey =
        accepted.reason === "no_embedder"
          ? "documents.rebuildIndexNoEmbedder"
          : accepted.reason === "in_progress"
            ? "documents.rebuildIndexInProgress"
            : accepted.reason === "busy"
              ? "documents.errorBusy"
              : "documents.rebuildIndexUnavailable";
      Alert.alert(t("documents.title"), t(messageKey));
    } finally {
      setRebuilding(false);
    }
  };

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
  const visiblePagesLabel =
    pagesLabel &&
    doc.truncated &&
    typeof doc.processedPageCount === "number" &&
    doc.processedPageCount < (doc.pageCount ?? 0)
      ? `${pagesLabel} (${doc.processedPageCount}/${doc.pageCount})`
      : pagesLabel;

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
    visiblePagesLabel,
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
    <View style={{ flex: 1, backgroundColor: colors.page }}>
      <SettingsHeader title={t("documents.detailBack")} onBack={onBack} backLabel={t("common.back")} />
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: space.md,
          paddingTop: space.xs,
          paddingBottom: insets.bottom + space.lg,
          gap: space.md,
          flexGrow: 1,
        }}
      >
        <View
          style={{
            flexShrink: 0,
            overflow: "hidden",
            minHeight: 180,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: colors.surface,
            borderRadius: radius.card,
            ...e1,
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
            <View style={{ width: "100%", padding: space.lg, gap: space.sm }}>
              {snippetLoading ? (
                <ActivityIndicator size="small" color={colors.accent} />
              ) : (
                <Text
                  style={[type.mono, { color: colors.ink, lineHeight: 20 }]}
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
                backgroundColor: colors.tint,
              }}
            >
              <FileText size={24} color={colors.accent} strokeWidth={1.75} />
            </View>
          )}
        </View>

        <View style={{ flexShrink: 0, gap: space.xs }}>
          <Text
            style={[type.headline, { color: colors.ink }]}
            accessibilityRole="header"
          >
            {doc.name}
          </Text>
          <Text style={[type.secondary, { color: colors.ink2 }]}>
            {metaLine}
          </Text>
          {isDocumentUnreadable(doc) ? (
            <Text
              style={[type.body, { color: colors.ink2, marginTop: space.xs }]}
            >
              {t("documents.errorPdf")}
            </Text>
          ) : null}
        </View>

        {!isDocumentUnreadable(doc) ? (
          <Pressable
            onPress={() => void handleRebuild()}
            disabled={!!busy || rebuilding}
            accessibilityRole="button"
            accessibilityLabel={t("documents.rebuildIndex")}
            accessibilityHint={t("documents.rebuildIndexHint")}
            style={({ pressed }) => ({
              minHeight: 48,
              alignItems: "center",
              justifyContent: "center",
              borderRadius: radius.button,
              backgroundColor: pressed ? colors.tint : colors.surface,
              opacity: busy || rebuilding ? 0.5 : 1,
            })}
          >
            <Text
              style={[type.bodyStrong, { color: colors.accent }]}
            >
              {t("documents.rebuildIndex")}
            </Text>
          </Pressable>
        ) : null}

        <Pressable
          onPress={() => onDelete(doc)}
          disabled={!!busy}
          accessibilityRole="button"
          accessibilityLabel={t("documents.delete")}
          accessibilityHint={t("documents.deleteHint")}
          style={({ pressed }) => ({
            minHeight: 52,
            alignItems: "center",
            justifyContent: "center",
            borderRadius: radius.button,
            borderWidth: 1,
            borderColor: colors.danger,
            backgroundColor: pressed ? colors.tint : colors.surface,
            opacity: busy ? 0.5 : 1,
          })}
        >
          <Text
            style={[type.bodyStrong, { color: colors.danger }]}
          >
            {t("documents.delete")}
          </Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}
