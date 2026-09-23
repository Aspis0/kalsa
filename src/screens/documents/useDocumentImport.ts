import { useCallback, useState } from "react";
import { Alert } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";

import {
  estimateTokensForDoc,
  formatBytesLocalized,
  type ExtractionStatus,
  type LibraryDoc,
} from "../../documents/DocumentLibrary";
import {
  MAX_DOCUMENT_BYTES,
  MAX_TEXT_BYTES,
  copyToOwnedStorage,
  deleteOwnedFile,
  peekFileHead,
  resolveAssetSizeBytes,
  sizeWithinLimits,
  writeOwnedText,
} from "../../documents/documentStorage";
import {
  DOCUMENTS_PICKER_TYPES,
  pickKind,
  shouldSniffPickedKind,
  sniffDocxOrLegacy,
} from "../../documents/documentKinds";
import { DocxExtractError, extractDocxTextFromFile } from "../../documents/docxToText";
import { generateCoverForDoc } from "../../documents/documentCover";
import { isDocumentOpInFlight } from "../../documents/documentChatTool";
import { isPdfTextExtractionBusy, requestPdfText } from "../../pdf/pdfTextService";
import { useLocale } from "../../i18n";
import { summarizePdfExtraction } from "../../documents/extractionScope";
import { htmlToText } from "../../util/htmlToText";
import { hasNulInPrefix, nextDocId } from "./documentImportUtils";

type Props = {
  onAddDocument: (entry: LibraryDoc) => boolean;
  isDocumentDeleteInFlight: () => boolean;
};

export function useDocumentImport({ onAddDocument, isDocumentDeleteInFlight }: Props) {
  const { t, locale } = useLocale();
  const [importing, setImporting] = useState(false);
  const [importName, setImportName] = useState<string | null>(null);
  const busyGuards = useCallback((): boolean => {
    if (importing) return true;
    if (isDocumentDeleteInFlight()) return true;
    if (isPdfTextExtractionBusy() || isDocumentOpInFlight()) return true;
    return false;
  }, [importing, isDocumentDeleteInFlight]);

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
      let processedPageCount: number | undefined;
      let truncated = false;
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
          const scope = summarizePdfExtraction(extracted);
          docCount = scope.docCount;
          pageCount = scope.pageCount;
          processedPageCount = scope.processedPageCount;
          truncated = scope.truncated;
          estimatedTokens = estimateTokensForDoc(scope.fullText);
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
        ...(processedPageCount != null ? { processedPageCount } : {}),
        ...(truncated ? { truncated: true } : {}),
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


  return { importing, importName, importDocument, busyGuards };
}
