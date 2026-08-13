/**
 * Documents library screen — friendly list, detail, single picker, cover gen.
 * Pattern mirrors HelpScreen / SettingsScreen (Header + list). Extraction
 * reuses requestPdfText (PDF), FileSystem read (TXT), and docxToText (.docx).
 *
 * Delete ownership + in-flight latch live in AppShell (survives this screen's
 * unmount). Pure storage helpers live in documentStorage.ts.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  BackHandler,
  Pressable,
  Text,
  View,
} from "react-native";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import { Plus, X } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import DraggableFlatList, {
  type RenderItemParams,
  ScaleDecorator,
} from "react-native-draggable-flatlist";

import {
  estimateTokensForDoc,
  formatBytesLocalized,
  type ExtractionStatus,
  type LibraryDoc,
  type LibraryState,
} from "../documents/DocumentLibrary";
import {
  MAX_DOCUMENT_BYTES,
  MAX_TEXT_BYTES,
  copyToOwnedStorage,
  deleteOwnedFile,
  peekFileHead,
  resolveAssetSizeBytes,
  sizeWithinLimits,
  writeOwnedText,
} from "../documents/documentStorage";
import {
  DOCUMENTS_PICKER_TYPES,
  pickKind,
  shouldSniffPickedKind,
  sniffDocxOrLegacy,
} from "../documents/documentKinds";
import {
  DocxExtractError,
  extractDocxTextFromFile,
} from "../documents/docxToText";
import { generateCoverForDoc } from "../documents/documentCover";
import { isDocumentOpInFlight } from "../documents/documentChatTool";
import {
  isPdfTextExtractionBusy,
  requestPdfText,
} from "../pdf/pdfTextService";
import { MAX_PDF_PAGES } from "../util/pdfBridgeProtocol";
import { htmlToText } from "../util/htmlToText";
import { useLocale } from "../i18n";
import { Header } from "../theme/components";
import { spacing } from "../theme/tokens";
import { useTypography, fontFamilies } from "../theme/typography";
import { useLabTheme } from "../ui/labTheme";

import { DocumentListItem } from "./documents/DocumentListItem";
import { DocumentDetailView } from "./documents/DocumentDetailView";
import { DocumentsEmptyState } from "./documents/DocumentsEmptyState";
import { DocumentImportOverlay } from "./documents/DocumentImportOverlay";

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
  /** AppShell-owned reorder (strict permutation via reorderDocs). */
  onReorderDocuments: (orderedIds: string[]) => void;
  /** AppShell-owned cover commit; refuses if doc is gone. */
  onUpdateDocumentPreview: (id: string, previewUri: string) => void;
  /**
   * AppShell-owned delete latch (survives unmount). Import/extract must refuse
   * while a delete is in flight.
   */
  isDocumentDeleteInFlight: () => boolean;
  /** Back closes the overlay (returns to chat / previous). */
  onBack: () => void;
};

type ScreenMode = "list" | { detailId: string };

function nextDocId(): string {
  return `doc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Reject binary mislabel: NUL in first 8 KB of a supposed text file. */
async function hasNulInPrefix(uri: string): Promise<boolean> {
  try {
    const raw = await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.UTF8,
    });
    if (typeof raw !== "string") return true;
    const prefix = raw.slice(0, 8192);
    return prefix.includes("\u0000");
  } catch {
    return false;
  }
}

export function DocumentsScreen({
  library,
  onAddDocument,
  onDeleteDocument,
  onReorderDocuments,
  onUpdateDocumentPreview: _onUpdateDocumentPreview,
  isDocumentDeleteInFlight,
  onBack,
}: Props) {
  // Cover is committed pre-add (importDocument); AppShell still accepts late
  // onUpdateDocumentPreview for future paths — keep the prop in the public API.
  void _onUpdateDocumentPreview;
  const { colors } = useLabTheme<any>();
  const typography = useTypography();
  const insets = useSafeAreaInsets();
  const { t, locale } = useLocale();

  const [screenMode, setScreenMode] = useState<ScreenMode>("list");
  const [importing, setImporting] = useState(false);
  const [importName, setImportName] = useState<string | null>(null);
  const [reorderHintVisible, setReorderHintVisible] = useState(true);

  const docs = library.docs ?? [];
  const detailDoc =
    typeof screenMode === "object"
      ? docs.find((d) => d.id === screenMode.detailId) ?? null
      : null;

  // If the open detail was deleted elsewhere, pop back to list.
  useEffect(() => {
    if (typeof screenMode === "object" && !detailDoc) {
      setScreenMode("list");
    }
  }, [screenMode, detailDoc]);

  const handleBack = useCallback(() => {
    if (importing) return true;
    if (typeof screenMode === "object") {
      setScreenMode("list");
      return true;
    }
    onBack();
    return true;
  }, [importing, screenMode, onBack]);

  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      return handleBack();
    });
    return () => sub.remove();
  }, [handleBack]);

  const busyGuards = useCallback((): boolean => {
    if (importing) return true;
    if (isDocumentDeleteInFlight()) return true;
    if (isPdfTextExtractionBusy() || isDocumentOpInFlight()) return true;
    return false;
  }, [importing, isDocumentDeleteInFlight]);

  const confirmDelete = useCallback(
    (doc: LibraryDoc) => {
      if (busyGuards()) {
        Alert.alert(t("documents.title"), t("documents.errorBusy"));
        return;
      }
      Alert.alert(
        t("documents.delete"),
        t("documents.deleteConfirm", { name: doc.name }),
        [
          { text: t("documents.deleteCancel"), style: "cancel" },
          {
            text: t("documents.delete"),
            style: "destructive",
            onPress: () => {
              if (busyGuards()) {
                Alert.alert(t("documents.title"), t("documents.errorBusy"));
                return;
              }
              void onDeleteDocument(doc.id).then((accepted) => {
                if (!accepted) {
                  Alert.alert(t("documents.title"), t("documents.errorBusy"));
                  return;
                }
                setScreenMode("list");
              });
            },
          },
        ],
      );
    },
    [busyGuards, onDeleteDocument, t],
  );

  const importDocument = useCallback(async () => {
    if (busyGuards()) {
      Alert.alert(t("documents.title"), t("documents.errorBusy"));
      return;
    }
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: DOCUMENTS_PICKER_TYPES,
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (picked.canceled || !picked.assets?.length) return;
      const asset = picked.assets[0];
      const uri = asset.uri;
      const name = (asset.name ?? "document").trim();
      let kind = pickKind(asset.mimeType, name);
      if (shouldSniffPickedKind(kind, name)) {
        const head = await peekFileHead(uri, 8);
        if (head) {
          const sniffed = sniffDocxOrLegacy(head);
          if (sniffed) kind = sniffed;
        }
      }
      if (kind === "doc_legacy") {
        Alert.alert(t("documents.title"), t("documents.errorLegacyWord"));
        return;
      }
      if (!kind) {
        Alert.alert(t("documents.title"), t("documents.errorBinary"));
        return;
      }

      const resolvedSize = await resolveAssetSizeBytes(uri);
      // Images inside the zip are skipped; the 50 MiB cap is the container, the 10 MiB cap is inflated text.
      const sizeCheck = sizeWithinLimits(resolvedSize, kind);
      if (!sizeCheck.ok) {
        if (sizeCheck.reason === "empty") {
          Alert.alert(t("documents.title"), t("documents.errorEmpty"));
        } else if (sizeCheck.reason === "too_large") {
          const max =
            kind === "txt"
              ? formatBytesLocalized(MAX_TEXT_BYTES, locale)
              : formatBytesLocalized(MAX_DOCUMENT_BYTES, locale);
          Alert.alert(
            t("documents.title"),
            t("documents.errorTooLarge", { max }),
          );
        } else {
          Alert.alert(
            t("documents.title"),
            kind === "docx" ? t("documents.errorDocx") : t("documents.errorTxt"),
          );
        }
        return;
      }
      const sizeBytes = sizeCheck.sizeBytes;

      if (isDocumentDeleteInFlight()) {
        Alert.alert(t("documents.title"), t("documents.errorBusy"));
        return;
      }

      // Content validation for text: NUL bytes → binary mislabel.
      if (kind === "txt") {
        const hasNul = await hasNulInPrefix(uri);
        if (hasNul) {
          Alert.alert(t("documents.title"), t("documents.errorBinary"));
          return;
        }
      }

      setImporting(true);
      setImportName(name);
      const id = nextDocId();
      const sourceId = id;

      let ownedUri: string;
      let libraryKind: "pdf" | "txt" = kind === "pdf" ? "pdf" : "txt";
      let storedSizeBytes = sizeBytes;
      let docCount = 0;
      let pageCount: number | undefined;
      let estimatedTokens: number | undefined;
      let extractionStatus: ExtractionStatus = "ok";

      if (kind === "docx") {
        let text = "";
        try {
          text = await extractDocxTextFromFile(uri);
        } catch (error) {
          if (error instanceof DocxExtractError) {
            if (error.code === "DOCX_EMPTY") {
              Alert.alert(t("documents.title"), t("documents.errorEmpty"));
            } else if (error.code === "DOCX_TOO_LARGE") {
              Alert.alert(
                t("documents.title"),
                t("documents.errorTooLarge", {
                  max: formatBytesLocalized(MAX_TEXT_BYTES, locale),
                }),
              );
            } else {
              Alert.alert(t("documents.title"), t("documents.errorDocx"));
            }
          } else {
            Alert.alert(t("documents.title"), t("documents.errorDocx"));
          }
          return;
        }
        if (new TextEncoder().encode(text).length > MAX_TEXT_BYTES) {
          Alert.alert(
            t("documents.title"),
            t("documents.errorTooLarge", {
              max: formatBytesLocalized(MAX_TEXT_BYTES, locale),
            }),
          );
          return;
        }
        if (isDocumentDeleteInFlight()) {
          Alert.alert(t("documents.title"), t("documents.errorBusy"));
          return;
        }
        try {
          ownedUri = await writeOwnedText(id, text);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          Alert.alert(
            t("documents.title"),
            msg === "NO_DOCUMENT_DIRECTORY"
              ? t("documents.errorStorage")
              : t("documents.errorDocx"),
          );
          return;
        }
        libraryKind = "txt";
        storedSizeBytes = new TextEncoder().encode(text).length;
        docCount = 1;
        estimatedTokens = estimateTokensForDoc(text);
        extractionStatus = "ok";
      } else {
      try {
        ownedUri = await copyToOwnedStorage(uri, id, kind);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        Alert.alert(
          t("documents.title"),
          msg === "NO_DOCUMENT_DIRECTORY"
            ? t("documents.errorStorage")
            : t("documents.errorTxt"),
        );
        return;
      }

      if (kind === "pdf") {
        try {
          const extracted = await requestPdfText(ownedUri, {
            sourceId,
            title: name,
          });
          const extractedDocs = Array.isArray(extracted?.docs)
            ? extracted.docs
            : [];
          docCount = extractedDocs.filter(
            (d) => d && typeof d.text === "string" && d.text.trim().length > 0,
          ).length;
          // Store the extracted cap, not pdf.js numPages — we only read
          // MAX_PDF_PAGES, so claiming the full document length is dishonest.
          const extractedPages =
            extractedDocs.length + (extracted?.skippedPages?.length ?? 0);
          if (extractedPages > 0) {
            pageCount = extractedPages;
          } else if (
            typeof extracted?.documentPageCount === "number" &&
            extracted.documentPageCount > 0
          ) {
            pageCount = Math.min(
              Math.floor(extracted.documentPageCount),
              MAX_PDF_PAGES,
            );
          }
          const fullText = extractedDocs.map((d) => d.text ?? "").join("\n\n");
          estimatedTokens = estimateTokensForDoc(fullText);
          extractionStatus = docCount === 0 ? "no_text_layer" : "ok";
        } catch (err) {
          const code =
            err && typeof err === "object" && "code" in err
              ? String((err as { code?: unknown }).code ?? "")
              : "";
          if (code === "busy") {
            await deleteOwnedFile(ownedUri);
            Alert.alert(t("documents.title"), t("documents.errorBusy"));
            return;
          }
          docCount = 0;
          if (code === "timeout" || code === "page_timeout") {
            extractionStatus = "timeout";
          } else if (
            code === "renderer_gone" ||
            code === "no_host" ||
            code === "unmounted" ||
            code === "failed"
          ) {
            extractionStatus = "renderer_error";
          } else {
            extractionStatus = "fs_error";
          }
        }
      } else {
        // TXT / Markdown
        let text = "";
        try {
          text = await FileSystem.readAsStringAsync(ownedUri);
        } catch {
          await deleteOwnedFile(ownedUri);
          Alert.alert(t("documents.title"), t("documents.errorTxt"));
          return;
        }
        if (text.includes("\u0000")) {
          await deleteOwnedFile(ownedUri);
          Alert.alert(t("documents.title"), t("documents.errorBinary"));
          return;
        }
        const looksHtml = /<\/?[a-z][\s\S]*>/i.test(text.slice(0, 2000));
        const plain = looksHtml ? htmlToText(text).text : text;
        const trimmed = (plain ?? "").trim();
        if (!trimmed) {
          await deleteOwnedFile(ownedUri);
          Alert.alert(t("documents.title"), t("documents.errorEmpty"));
          return;
        }
        docCount = 1;
        estimatedTokens = estimateTokensForDoc(trimmed);
        extractionStatus = "ok";
      }
      }

      if (isDocumentDeleteInFlight()) {
        await deleteOwnedFile(ownedUri);
        Alert.alert(t("documents.title"), t("documents.errorBusy"));
        return;
      }

      const entry: LibraryDoc = {
        id,
        name,
        sourceId,
        kind: libraryKind,
        addedAt: Date.now(),
        sizeBytes: storedSizeBytes,
        docCount,
        fileUri: ownedUri,
        extractionStatus,
        ...(pageCount != null ? { pageCount } : {}),
        ...(estimatedTokens != null ? { estimatedTokens } : {}),
      };

      // MED-3 (Jelly): generate the page-1 cover BEFORE addDocument so the
      // background embed job cannot hold docOpGate READ and make cover return
      // null (import used to call cover after add → race with scheduleBackgroundEmbed).
      let entryWithCover = entry;
      if (kind === "pdf") {
        try {
          const uri = await generateCoverForDoc(entry, {
            // Not yet in the library — membership is the new id itself until
            // commit; delete cannot race because we have not published yet.
            libraryHas: (id) => id === entry.id,
          });
          if (uri) {
            entryWithCover = { ...entry, previewUri: uri };
          }
        } catch {
          /* silent degrade to placeholder */
        }
      }

      if (!onAddDocument(entryWithCover)) {
        await deleteOwnedFile(ownedUri);
        if (entryWithCover.previewUri) {
          await deleteOwnedFile(entryWithCover.previewUri).catch(() => undefined);
        }
        Alert.alert(t("documents.title"), t("documents.errorBusy"));
        return;
      }

      // Soft-fail PDFs still listed — surface friendly alert once.
      if (
        kind === "pdf" &&
        (extractionStatus === "timeout" ||
          extractionStatus === "renderer_error" ||
          extractionStatus === "fs_error")
      ) {
        Alert.alert(t("documents.title"), t("documents.errorPdf"));
      }

      // Cover already attempted above. If it failed (null), leave placeholder;
      // a later open of the detail view will still show the FileText tile.
    } catch {
      // picker cancelled / unexpected
    } finally {
      setImporting(false);
      setImportName(null);
    }
  }, [
    busyGuards,
    isDocumentDeleteInFlight,
    locale,
    onAddDocument,
    t,
  ]);

  const onDragEnd = useCallback(
    ({ data }: { data: LibraryDoc[] }) => {
      const orderedIds = data.map((d) => d.id);
      onReorderDocuments(orderedIds);
    },
    [onReorderDocuments],
  );

  const renderItem = useCallback(
    ({ item, drag, isActive }: RenderItemParams<LibraryDoc>) => (
      <ScaleDecorator>
        <DocumentListItem
          doc={item}
          drag={drag}
          isActive={isActive}
          onOpen={(d) => {
            if (importing) return;
            setScreenMode({ detailId: d.id });
          }}
        />
      </ScaleDecorator>
    ),
    [importing],
  );

  const keyExtractor = useCallback((item: LibraryDoc) => item.id, []);

  const listData = useMemo(() => docs.slice(), [docs]);

  // Detail mode — in-screen push (not AppShell overlay).
  if (detailDoc) {
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
        <DocumentDetailView
          doc={detailDoc}
          onBack={() => setScreenMode("list")}
          onDelete={confirmDelete}
          busy={importing || isDocumentDeleteInFlight()}
        />
        {importing ? <DocumentImportOverlay fileName={importName} /> : null}
      </View>
    );
  }

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
        onBack={() => {
          if (!importing) onBack();
        }}
        backAccessibilityLabel={t("common.back")}
        trailing={
          docs.length > 0 ? (
            <Pressable
              onPress={() => void importDocument()}
              disabled={importing}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={t("documents.add")}
              style={{ padding: 6, opacity: importing ? 0.4 : 1 }}
            >
              <Plus size={22} color={colors.accent} />
            </Pressable>
          ) : null
        }
      />

      {docs.length === 0 ? (
        <DocumentsEmptyState
          onAdd={() => void importDocument()}
          disabled={importing}
        />
      ) : (
        <View style={{ flex: 1 }}>
          <DraggableFlatList
            data={listData}
            keyExtractor={keyExtractor}
            onDragEnd={onDragEnd}
            renderItem={renderItem}
            containerStyle={{ flex: 1 }}
            contentContainerStyle={{
              paddingVertical: spacing.sm,
              paddingBottom: insets.bottom + spacing.lg,
            }}
            // MED-2: lower activation so a single hold-swipe on 480px works
            // (was 12 + delayLongPress 180 — adb single-swipe often no-op).
            activationDistance={6}
          />
          {reorderHintVisible ? (
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: spacing.sm,
                paddingHorizontal: spacing.lg,
                paddingVertical: spacing.sm,
                paddingBottom: insets.bottom + spacing.sm,
              }}
            >
              <Text
                style={[
                  typography.bodyXs,
                  { color: colors.muted, flex: 1 },
                ]}
              >
                {t("documents.reorderHint")}
              </Text>
              <Pressable
                onPress={() => setReorderHintVisible(false)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={t("documents.reorderHintDismiss")}
                style={{ padding: 4 }}
              >
                <X size={16} color={colors.muted} />
              </Pressable>
            </View>
          ) : null}
        </View>
      )}

      {importing ? <DocumentImportOverlay fileName={importName} /> : null}
    </View>
  );
}
