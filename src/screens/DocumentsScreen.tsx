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
import { requestPdfText } from "../pdf/pdfTextService";
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

/** Durable library storage under documentDirectory (survives cache eviction). */
function documentsDir(): string {
  const base = FileSystem.documentDirectory ?? FileSystem.cacheDirectory ?? "";
  return `${base}kalsa-documents/`;
}

async function ensureDocumentsDir(): Promise<string> {
  const dir = documentsDir();
  if (!dir) throw new Error("no document directory");
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

async function deleteOwnedFile(fileUri: string | undefined): Promise<void> {
  if (!fileUri || typeof fileUri !== "string") return;
  // Only delete files we own under kalsa-documents/.
  if (!fileUri.includes("kalsa-documents/")) return;
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
      const sizeBytes =
        typeof asset.size === "number" && Number.isFinite(asset.size)
          ? Math.max(0, Math.floor(asset.size))
          : 0;

      if (sizeBytes > MAX_DOCUMENT_BYTES) {
        Alert.alert(
          t("documents.title"),
          t("documents.tooLarge", { max: formatBytes(MAX_DOCUMENT_BYTES) }),
        );
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
      } catch {
        Alert.alert(t("documents.title"), t("documents.readFailed"));
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
      const sizeBytes =
        typeof asset.size === "number" && Number.isFinite(asset.size)
          ? Math.max(0, Math.floor(asset.size))
          : 0;

      if (sizeBytes > MAX_TEXT_BYTES) {
        Alert.alert(
          t("documents.title"),
          t("documents.tooLarge", { max: formatBytes(MAX_TEXT_BYTES) }),
        );
        return;
      }

      setBusy(true);
      setStatus(t("documents.extracting"));
      const id = nextDocId();
      let ownedUri: string;
      try {
        ownedUri = await copyToOwnedStorage(uri, id, "txt");
      } catch {
        Alert.alert(t("documents.title"), t("documents.readFailed"));
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
      Alert.alert(
        t("documents.delete"),
        t("documents.deleteConfirm", { name: doc.name }),
        [
          { text: t("common.cancel"), style: "cancel" },
          {
            text: t("documents.delete"),
            style: "destructive",
            onPress: () => {
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
