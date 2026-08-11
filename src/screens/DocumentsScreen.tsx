/**
 * Documents library screen — import PDF/TXT, list, delete.
 * Pattern mirrors HelpScreen / SettingsScreen (Header + ScrollView rows).
 * Extraction reuses requestPdfText (PDF) and FileSystem read (TXT).
 *
 * Delete ownership + in-flight latch live in AppShell (survives this screen's
 * unmount). Pure storage helpers live in documentStorage.ts.
 */

import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import { FileText, Plus, Trash2 } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  estimateTokensForDoc,
  type ExtractionStatus,
  type LibraryDoc,
  type LibraryState,
} from "../documents/DocumentLibrary";
import {
  MAX_DOCUMENT_BYTES,
  MAX_TEXT_BYTES,
  copyToOwnedStorage,
  deleteOwnedFile,
  resolveAssetSizeBytes,
  sizeWithinLimits,
} from "../documents/documentStorage";
import { isDocumentOpInFlight } from "../documents/documentChatTool";
import {
  isPdfTextExtractionBusy,
  requestPdfText,
} from "../pdf/pdfTextService";
import { htmlToText } from "../util/htmlToText";
import { formatBytes } from "../engine/ModelRegistry";
import { useLocale } from "../i18n";
import { GlassPanel2, Header } from "../theme/components";
import { spacing } from "../theme/tokens";
import { useTypography, fontFamilies } from "../theme/typography";
import { useLabTheme } from "../ui/labTheme";

// Re-export pure helpers so existing harness imports / external callers keep working.
export {
  MAX_DOCUMENT_BYTES,
  MAX_TEXT_BYTES,
  normalizeUriPath,
  isOwnedDocumentUri,
  sizeWithinLimits,
} from "../documents/documentStorage";

type Props = {
  /** Current library snapshot from AppShell (display only — never merge). */
  library: LibraryState;
  /**
   * AppShell-owned add/import commit. Applies against current library state
   * (ref + functional updater). Returns false when refused (delete latch).
   * Screens must not call DocumentLibrary.addDoc with a captured snapshot.
   */
  onAddDocument: (entry: LibraryDoc) => boolean;
  /**
   * AppShell-owned delete. Survives screen unmount; applies against current
   * library state (functional updater). Returns false when refused (busy latch).
   */
  onDeleteDocument: (id: string) => Promise<boolean>;
  /**
   * AppShell-owned delete latch (survives unmount). Import/extract must refuse
   * while a delete is in flight.
   */
  isDocumentDeleteInFlight: () => boolean;
  /** Back closes the overlay (returns to chat / previous). */
  onBack: () => void;
};

function nextDocId(): string {
  return `doc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function DocumentsScreen({
  library,
  onAddDocument,
  onDeleteDocument,
  isDocumentDeleteInFlight,
  onBack,
}: Props) {
  const { colors } = useLabTheme<any>();
  const typography = useTypography();
  const insets = useSafeAreaInsets();
  const { t } = useLocale();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const handleBack = useCallback(() => {
    if (busy) return;
    onBack();
  }, [busy, onBack]);

  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (busy) return true;
      handleBack();
      return true;
    });
    return () => sub.remove();
  }, [busy, handleBack]);

  const addPdf = useCallback(async () => {
    if (busy) return;
    if (isDocumentDeleteInFlight()) {
      Alert.alert(t("documents.title"), t("documents.busy"));
      return;
    }
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: "application/pdf",
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (picked.canceled || !picked.assets?.length) return;
      const asset = picked.assets[0];
      const uri = asset.uri;
      const name = asset.name ?? "document.pdf";

      // Fail closed: resolve actual size via FS; never trust optional asset.size alone.
      const resolvedSize = await resolveAssetSizeBytes(uri);
      const sizeCheck = sizeWithinLimits(resolvedSize, "pdf");
      if (!sizeCheck.ok) {
        Alert.alert(
          t("documents.title"),
          sizeCheck.reason === "too_large"
            ? t("documents.tooLarge", { max: formatBytes(MAX_DOCUMENT_BYTES) })
            : t("documents.cannotRead"),
        );
        return;
      }
      const sizeBytes = sizeCheck.sizeBytes;

      // Re-check delete latch after async size resolve (delete may have started).
      if (isDocumentDeleteInFlight()) {
        Alert.alert(t("documents.title"), t("documents.busy"));
        return;
      }

      setBusy(true);
      setStatus(t("documents.extracting"));
      const id = nextDocId();
      const sourceId = id;
      // Own a durable copy before extract so library entries survive cache eviction.
      let ownedUri: string;
      try {
        ownedUri = await copyToOwnedStorage(uri, id, "pdf");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        Alert.alert(
          t("documents.title"),
          msg === "NO_DOCUMENT_DIRECTORY"
            ? t("documents.storageUnavailable")
            : t("documents.readFailed"),
        );
        return;
      }
      let docCount = 0;
      let pageCount: number | undefined;
      let estimatedTokens: number | undefined;
      // FIX 5: explicit status — never conflate timeout/error with "no text layer".
      let extractionStatus: ExtractionStatus = "ok";

      try {
        const extracted = await requestPdfText(ownedUri, {
          sourceId,
          title: name,
        });
        const docs = Array.isArray(extracted?.docs) ? extracted.docs : [];
        docCount = docs.filter(
          (d) => d && typeof d.text === "string" && d.text.trim().length > 0,
        ).length;
        if (
          typeof extracted?.documentPageCount === "number" &&
          extracted.documentPageCount > 0
        ) {
          pageCount = extracted.documentPageCount;
        } else if (docs.length > 0) {
          pageCount = docs.length + (extracted?.skippedPages?.length ?? 0);
        }
        const fullText = docs.map((d) => d.text ?? "").join("\n\n");
        estimatedTokens = estimateTokensForDoc(fullText);
        // Successful extract with zero text → scanned / empty text layer.
        extractionStatus = docCount === 0 ? "no_text_layer" : "ok";
      } catch (err) {
        const code =
          err && typeof err === "object" && "code" in err
            ? String((err as { code?: unknown }).code ?? "")
            : "";
        if (code === "busy") {
          await deleteOwnedFile(ownedUri);
          Alert.alert(t("documents.title"), t("documents.extractBusy"));
          return;
        }
        // Still add the entry so the user can see it, but mark the failure so
        // document_chat does NOT route to vision_fallback (FIX 5).
        docCount = 0;
        if (code === "timeout" || code === "page_timeout") {
          extractionStatus = "timeout";
        } else if (code === "renderer_gone") {
          extractionStatus = "renderer_error";
        } else if (code === "no_host" || code === "unmounted" || code === "failed") {
          extractionStatus = "renderer_error";
        } else {
          // FS / unknown — treat as filesystem-class failure.
          extractionStatus = "fs_error";
        }
      }

      // Final latch check before committing the import (delete may have finished
      // mid-extract; refuse to race a still-in-flight delete).
      if (isDocumentDeleteInFlight()) {
        await deleteOwnedFile(ownedUri);
        Alert.alert(t("documents.title"), t("documents.busy"));
        return;
      }

      const entry: LibraryDoc = {
        id,
        name,
        sourceId,
        kind: "pdf",
        addedAt: Date.now(),
        sizeBytes,
        docCount,
        fileUri: ownedUri,
        extractionStatus,
        ...(pageCount != null ? { pageCount } : {}),
        ...(estimatedTokens != null ? { estimatedTokens } : {}),
      };
      // Commit via AppShell against current state — never merge a captured snapshot.
      if (!onAddDocument(entry)) {
        await deleteOwnedFile(ownedUri);
        Alert.alert(t("documents.title"), t("documents.busy"));
        return;
      }
      setStatus(null);
    } catch {
      // picker cancelled
    } finally {
      setBusy(false);
      setStatus(null);
    }
  }, [busy, onAddDocument, isDocumentDeleteInFlight, t]);

  const addTxt = useCallback(async () => {
    if (busy) return;
    if (isDocumentDeleteInFlight()) {
      Alert.alert(t("documents.title"), t("documents.busy"));
      return;
    }
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: ["text/plain", "text/html", "text/*"],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (picked.canceled || !picked.assets?.length) return;
      const asset = picked.assets[0];
      const uri = asset.uri;
      const name = asset.name ?? "document.txt";

      // Fail closed: resolve actual size via FS; never trust optional asset.size alone.
      const resolvedSize = await resolveAssetSizeBytes(uri);
      const sizeCheck = sizeWithinLimits(resolvedSize, "txt");
      if (!sizeCheck.ok) {
        Alert.alert(
          t("documents.title"),
          sizeCheck.reason === "too_large"
            ? t("documents.tooLarge", { max: formatBytes(MAX_TEXT_BYTES) })
            : t("documents.cannotRead"),
        );
        return;
      }
      const sizeBytes = sizeCheck.sizeBytes;

      // Re-check delete latch after async size resolve (delete may have started).
      if (isDocumentDeleteInFlight()) {
        Alert.alert(t("documents.title"), t("documents.busy"));
        return;
      }

      setBusy(true);
      setStatus(t("documents.extracting"));
      const id = nextDocId();
      let ownedUri: string;
      try {
        ownedUri = await copyToOwnedStorage(uri, id, "txt");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        Alert.alert(
          t("documents.title"),
          msg === "NO_DOCUMENT_DIRECTORY"
            ? t("documents.storageUnavailable")
            : t("documents.readFailed"),
        );
        return;
      }
      let text = "";
      try {
        text = await FileSystem.readAsStringAsync(ownedUri);
      } catch {
        await deleteOwnedFile(ownedUri);
        Alert.alert(t("documents.title"), t("documents.readFailed"));
        return;
      }
      // HTML-ish → strip tags; plain text passes through.
      const looksHtml = /<\/?[a-z][\s\S]*>/i.test(text.slice(0, 2000));
      const plain = looksHtml ? htmlToText(text).text : text;
      const trimmed = (plain ?? "").trim();

      if (isDocumentDeleteInFlight()) {
        await deleteOwnedFile(ownedUri);
        Alert.alert(t("documents.title"), t("documents.busy"));
        return;
      }

      const entry: LibraryDoc = {
        id,
        name,
        sourceId: id,
        kind: "txt",
        addedAt: Date.now(),
        sizeBytes,
        docCount: trimmed.length > 0 ? 1 : 0,
        fileUri: ownedUri,
        estimatedTokens: estimateTokensForDoc(trimmed),
        extractionStatus: trimmed.length > 0 ? "ok" : "no_text_layer",
      };
      // Commit via AppShell against current state — never merge a captured snapshot.
      if (!onAddDocument(entry)) {
        await deleteOwnedFile(ownedUri);
        Alert.alert(t("documents.title"), t("documents.busy"));
        return;
      }
    } catch {
      // picker cancelled
    } finally {
      setBusy(false);
      setStatus(null);
    }
  }, [busy, onAddDocument, isDocumentDeleteInFlight, t]);

  const confirmDelete = useCallback(
    (doc: LibraryDoc) => {
      if (busy) return;
      if (isDocumentDeleteInFlight()) {
        Alert.alert(t("documents.title"), t("documents.busy"));
        return;
      }
      // Refuse delete while PDF extract or document_chat host read is in flight
      // so we never race deleteAsync against an open read of the same file.
      if (isPdfTextExtractionBusy() || isDocumentOpInFlight()) {
        Alert.alert(t("documents.title"), t("documents.busy"));
        return;
      }
      Alert.alert(
        t("documents.delete"),
        t("documents.deleteConfirm", { name: doc.name }),
        [
          { text: t("common.cancel"), style: "cancel" },
          {
            text: t("documents.delete"),
            style: "destructive",
            onPress: () => {
              // Re-check at confirm time (user may have waited on the dialog).
              if (isDocumentDeleteInFlight()) {
                Alert.alert(t("documents.title"), t("documents.busy"));
                return;
              }
              if (isPdfTextExtractionBusy() || isDocumentOpInFlight()) {
                Alert.alert(t("documents.title"), t("documents.busy"));
                return;
              }
              // AppShell owns the latch + FS delete + functional state update.
              // Unmount of this screen no longer clears the in-flight guard.
              void onDeleteDocument(doc.id).then((accepted) => {
                if (!accepted) {
                  Alert.alert(t("documents.title"), t("documents.busy"));
                }
              });
            },
          },
        ],
      );
    },
    [busy, isDocumentDeleteInFlight, onDeleteDocument, t],
  );

  const docs = library.docs ?? [];

  return (
    <View
      style={{
        position: "absolute",
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        backgroundColor: colors.shell,
        zIndex: 50,
      }}
    >
      <Header
        title={t("documents.title")}
        onBack={handleBack}
        backAccessibilityLabel={t("common.back")}
      />
      <ScrollView
        contentContainerStyle={{
          padding: spacing.lg,
          paddingBottom: insets.bottom + spacing.lg,
          gap: spacing.md,
        }}
      >
        <GlassPanel2 rounded="lg" style={{ padding: spacing.lg, gap: spacing.sm }}>
          <Text style={[typography.bodyXs, { color: colors.muted }]}>
            {t("documents.intro")}
          </Text>
          <View style={{ flexDirection: "row", gap: spacing.sm, marginTop: spacing.xs }}>
            <Pressable
              onPress={() => void addPdf()}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel={t("documents.addPdf")}
              style={{
                flex: 1,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
                paddingVertical: spacing.sm,
                borderRadius: 12,
                backgroundColor: colors.accentSoft ?? colors.panelSolid,
                opacity: busy ? 0.5 : 1,
              }}
            >
              <Plus size={16} color={colors.accent} />
              <Text
                style={[
                  typography.bodySm,
                  { color: colors.ink, fontFamily: fontFamilies.bodySemi },
                ]}
              >
                {t("documents.addPdf")}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => void addTxt()}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel={t("documents.addTxt")}
              style={{
                flex: 1,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
                paddingVertical: spacing.sm,
                borderRadius: 12,
                backgroundColor: colors.computeSoft ?? colors.panelSolid,
                opacity: busy ? 0.5 : 1,
              }}
            >
              <Plus size={16} color={colors.compute ?? colors.accent} />
              <Text
                style={[
                  typography.bodySm,
                  { color: colors.ink, fontFamily: fontFamilies.bodySemi },
                ]}
              >
                {t("documents.addTxt")}
              </Text>
            </Pressable>
          </View>
          {busy || status ? (
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: spacing.sm,
                marginTop: spacing.xs,
              }}
            >
              <ActivityIndicator size="small" color={colors.accent} />
              <Text style={[typography.bodyXs, { color: colors.muted }]}>
                {status ?? t("documents.extracting")}
              </Text>
            </View>
          ) : null}
        </GlassPanel2>

        {docs.length === 0 ? (
          <GlassPanel2 rounded="lg" style={{ padding: spacing.lg }}>
            <Text style={[typography.bodySm, { color: colors.muted }]}>
              {t("documents.empty")}
            </Text>
          </GlassPanel2>
        ) : (
          docs.map((doc) => (
            <GlassPanel2
              key={doc.id}
              rounded="lg"
              style={{
                padding: spacing.lg,
                flexDirection: "row",
                alignItems: "center",
                gap: spacing.sm,
              }}
            >
              <FileText size={18} color={colors.accent} />
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
                <Text style={[typography.bodyXs, { color: colors.muted, marginTop: 2 }]}>
                  {[
                    doc.kind.toUpperCase(),
                    formatBytes(doc.sizeBytes),
                    doc.pageCount != null
                      ? t("documents.pageCount", { count: doc.pageCount })
                      : null,
                    doc.docCount === 0
                      ? doc.extractionStatus === "timeout" ||
                        doc.extractionStatus === "renderer_error" ||
                        doc.extractionStatus === "fs_error"
                        ? t("documents.readFailed")
                        : t("documents.noTextLayer")
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </Text>
              </View>
              <Pressable
                onPress={() => confirmDelete(doc)}
                disabled={busy}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={t("documents.delete")}
                style={{ opacity: busy ? 0.4 : 1, padding: 4 }}
              >
                <Trash2 size={18} color={colors.muted} />
              </Pressable>
            </GlassPanel2>
          ))
        )}
      </ScrollView>
    </View>
  );
}
