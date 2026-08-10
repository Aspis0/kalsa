/**
 * Documents library screen — import PDF/TXT, list, delete.
 * Pattern mirrors HelpScreen / SettingsScreen (Header + ScrollView rows).
 * Extraction reuses requestPdfText (PDF) and FileSystem read (TXT).
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
  addDoc,
  estimateTokensForDoc,
  removeDoc,
  type LibraryDoc,
  type LibraryState,
} from "../documents/DocumentLibrary";
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

/**
 * Hard size caps before extraction / full-text read.
 * PDF 50 MiB: upper bound for on-device page extract without OOMing mid-tier phones.
 * TXT 10 MiB: whole-file JS string; larger inputs belong in retrieve-from-PDF path.
 */
export const MAX_DOCUMENT_BYTES = 50 * 1024 * 1024;
export const MAX_TEXT_BYTES = 10 * 1024 * 1024;

/**
 * Pure ownership predicate: fileUri must START WITH the canonical library prefix
 * (documentDirectory + "kalsa-documents/"). Substring matches elsewhere are rejected.
 * Exported for harness coverage.
 */
export function isOwnedDocumentUri(
  fileUri: string,
  baseDir: string,
): boolean {
  if (!fileUri || typeof fileUri !== "string") return false;
  if (!baseDir || typeof baseDir !== "string") return false;
  // Normalize so both sides end with a single trailing slash for startsWith.
  const prefix = baseDir.endsWith("/") ? baseDir : `${baseDir}/`;
  return fileUri.startsWith(prefix);
}

/**
 * Pure size-limit check against resolved byte length.
 * null/undefined/non-finite → rejected (fail closed on unknown size).
 * Exported for harness coverage.
 */
export function sizeWithinLimits(
  sizeBytes: number | null | undefined,
  kind: "pdf" | "txt",
): { ok: true; sizeBytes: number } | { ok: false; reason: "unknown" | "too_large" } {
  if (
    sizeBytes == null ||
    typeof sizeBytes !== "number" ||
    !Number.isFinite(sizeBytes) ||
    sizeBytes < 0
  ) {
    return { ok: false, reason: "unknown" };
  }
  const max = kind === "pdf" ? MAX_DOCUMENT_BYTES : MAX_TEXT_BYTES;
  const n = Math.floor(sizeBytes);
  if (n > max) return { ok: false, reason: "too_large" };
  return { ok: true, sizeBytes: n };
}

/**
 * Durable library storage under documentDirectory only.
 * NEVER falls back to cacheDirectory (cache is evictable).
 * Throws when documentDirectory is unavailable so import aborts cleanly.
 */
function documentsDir(): string {
  const base = FileSystem.documentDirectory;
  if (!base) {
    throw new Error("NO_DOCUMENT_DIRECTORY");
  }
  return `${base}kalsa-documents/`;
}

async function ensureDocumentsDir(): Promise<string> {
  const dir = documentsDir();
  try {
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  } catch {
    /* exists */
  }
  return dir;
}

async function copyToOwnedStorage(
  sourceUri: string,
  id: string,
  kind: "pdf" | "txt",
): Promise<string> {
  const dir = await ensureDocumentsDir();
  const ext = kind === "pdf" ? "pdf" : "txt";
  const dest = `${dir}${id}.${ext}`;
  await FileSystem.copyAsync({ from: sourceUri, to: dest });
  return dest;
}

/**
 * Resolve actual size via getInfoAsync. Fail closed when size cannot be established.
 * Returns null when exists is false or size is missing/non-finite.
 */
async function resolveAssetSizeBytes(uri: string): Promise<number | null> {
  try {
    const info = await FileSystem.getInfoAsync(uri);
    if (!info.exists || info.isDirectory) return null;
    const size = (info as { size?: number }).size;
    if (typeof size !== "number" || !Number.isFinite(size) || size < 0) {
      return null;
    }
    return Math.floor(size);
  } catch {
    return null;
  }
}

async function deleteOwnedFile(fileUri: string | undefined): Promise<void> {
  if (!fileUri || typeof fileUri !== "string") return;
  // Canonical ownership: only delete under documentDirectory/kalsa-documents/.
  // Legacy / non-owned URIs (cache, content://, paths with "kalsa-documents/"
  // only as a substring elsewhere) are NEVER deleted — metadata-only removal.
  let base: string;
  try {
    base = documentsDir();
  } catch {
    // No durable dir available — refuse filesystem delete (metadata-only).
    return;
  }
  if (!isOwnedDocumentUri(fileUri, base)) return;
  try {
    await FileSystem.deleteAsync(fileUri, { idempotent: true });
  } catch {
    /* best-effort */
  }
}

type Props = {
  /** Current library snapshot from AppShell. */
  library: LibraryState;
  /** Apply a pure state update (AppShell persists). */
  onLibraryChange: (next: LibraryState) => void;
  /** Back closes the overlay (returns to chat / previous). */
  onBack: () => void;
};

function nextDocId(): string {
  return `doc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function DocumentsScreen({ library, onLibraryChange, onBack }: Props) {
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
        // Still add the entry with docCount 0 so vision fallback can apply later.
        docCount = 0;
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
        ...(pageCount != null ? { pageCount } : {}),
        ...(estimatedTokens != null ? { estimatedTokens } : {}),
      };
      onLibraryChange(addDoc(library, entry));
      setStatus(null);
    } catch {
      // picker cancelled
    } finally {
      setBusy(false);
      setStatus(null);
    }
  }, [busy, library, onLibraryChange, t]);

  const addTxt = useCallback(async () => {
    if (busy) return;
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
      };
      onLibraryChange(addDoc(library, entry));
    } catch {
      // picker cancelled
    } finally {
      setBusy(false);
      setStatus(null);
    }
  }, [busy, library, onLibraryChange, t]);

  const confirmDelete = useCallback(
    (doc: LibraryDoc) => {
      if (busy) return;
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
              if (isPdfTextExtractionBusy() || isDocumentOpInFlight()) {
                Alert.alert(t("documents.title"), t("documents.busy"));
                return;
              }
              void deleteOwnedFile(doc.fileUri);
              onLibraryChange(removeDoc(library, doc.id));
            },
          },
        ],
      );
    },
    [busy, library, onLibraryChange, t],
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
                    doc.docCount === 0 ? t("documents.noTextLayer") : null,
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
