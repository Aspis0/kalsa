/**
 * The composer's attachment state and the picker wiring (D1 row 43, the
 * attach half): the five-row list the send snapshots, the live PDF
 * conversion, and the three answers of the attach sheet — each a port-wired
 * call into the pure modules (`attachments.ts`, `attachFlow.ts`,
 * `docxAttach.ts`), lifted out of the controller's `AiChatPage.tsx:1249-1293,
 * 1661-1833, 3687-3721` so every branch is node-tested before this file
 * translates it into expo calls.
 *
 * This is the ONE file that imports the pickers; everything above it deals
 * in outcomes. Two deviations from the controller, both reported:
 *
 * - a conversation change bumps `pickSessionRef`, so a picker result that
 *   resolves after the switch is dropped instead of landing in the next
 *   conversation's rows (the controller only guarded unmount — its late
 *   result raced the switch);
 * - notices ride the host's one-slot notice (this build has no voice-note
 *   toast), with the controller's keys and params unchanged.
 *
 * Lifecycle: `clear()` is the conversation-change reset the controller did
 * at `Chat:1887-1892` (rows, conversion, pages); `isMounted()` carries its
 * `mountedRef` guards across every await. Each `begin*` returns whether the
 * sheet must close — the controller's per-branch `setAttachSheetOpen(false)`.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import * as DocumentPicker from "expo-document-picker";
import * as ImageManipulator from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system/legacy";
import { PdfExtractError } from "../components/PdfToImages";
import { CHAT_DOCUMENT_PICKER_TYPES } from "../documents/documentKinds";
import {
  MAX_DOCUMENT_BYTES,
  MAX_TEXT_BYTES,
  deleteOwnedFile,
  peekFileHead,
  resolveAssetSizeBytes,
  sizeWithinLimits,
  writeOwnedText,
} from "../documents/documentStorage";
import {
  estimateTokensForDoc,
  formatBytesLocalized,
  type LibraryDoc,
} from "../documents/DocumentLibrary";
import { extractDocxTextFromFile } from "../documents/docxToText";
import type { Locale, TranslateFn, TranslationKey } from "../i18n";
import {
  MAX_ATTACHMENT_ITEMS,
  addAttachment,
  addLibraryDocument,
  pdfErrorNotice,
  removeAttachment,
} from "./attachments";
import {
  pdfConversionDone,
  runDocumentPick,
  runImagePick,
  type ImageSource,
  type PickerPorts,
} from "./attachFlow";
import { importAndAttachDocx, type DocxAttachPorts } from "./docxAttach";
import { nextMsgId, type LocalAttachment } from "./hostMessage";

export interface AttachmentsParams {
  t: TranslateFn;
  locale: Locale;
  /** The host's text-slot notice (every line this flow serves, params in). */
  showNotice: (text: string) => void;
  /** The library's `addDocument` — a .docx lands in Documents AND attaches. */
  addDocument: (entry: LibraryDoc) => boolean;
  /** `Boolean(currentModel.mmproj)`, read live at each notice. */
  visionCapable: () => boolean;
}

export interface AttachmentsHost {
  items: readonly LocalAttachment[];
  /** The send reads the rows through this ref (the controller's
   *  `attachedItemsRef`), so a render snapshot can never desync a send. */
  itemsRef: { current: LocalAttachment[] };
  /** The PDF still being read — the composer's `converting` phase. */
  converting: { uri: string; name: string } | null;
  /** False = the sheet stays open (cancel, refusal), as in the controller. */
  beginImagePick: (source: ImageSource) => Promise<boolean>;
  beginDocumentPick: () => Promise<boolean>;
  /** Shared by the sheet's library list and share-in (`shareImport.ts`). */
  addLibraryDocumentRow: (doc: { id: string; name: string }) => boolean;
  removeIndex: (index: number) => void;
  clear: () => void;
  /** The three `PdfToImages` callbacks — stable identities, refs inside
   *  (the WebView captured them at mount; the controller's own shape).
   *  Declared structurally: `PdfToImages`' `Props` type is not exported and
   *  the service is called, never edited. */
  pdf: {
    onPage: (index: number, imageUri: string) => void;
    onDone: () => void;
    onError: (error: Error) => void;
  };
}

/** The controller's `nextLibraryDocId` (`AiChatPage.tsx:564-566`), copied
 *  because the controller's copy lives in a file this host never imports at
 *  runtime. */
function nextLibraryDocId(): string {
  return `doc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function useAttachments(params: AttachmentsParams): AttachmentsHost {
  const { t, locale, showNotice, addDocument, visionCapable } = params;
  const [items, setItems] = useState<LocalAttachment[]>([]);
  const itemsRef = useRef<LocalAttachment[]>(items);
  itemsRef.current = items;
  const [converting, setConvertingState] = useState<{ uri: string; name: string } | null>(null);
  const convertingRef = useRef<{ uri: string; name: string } | null>(converting);
  convertingRef.current = converting;
  const pagesRef = useRef<string[]>([]);
  const pickingRef = useRef(false);
  const mountedRef = useRef(true);
  const pickSessionRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const notice = useCallback(
    (key: TranslationKey, opts?: Record<string, string | number>) => showNotice(t(key, opts)),
    [showNotice, t],
  );

  const commitItems = useCallback((next: LocalAttachment[]) => {
    itemsRef.current = next;
    setItems(next);
  }, []);

  const clear = useCallback(() => {
    pickSessionRef.current += 1;
    pagesRef.current = [];
    convertingRef.current = null;
    setConvertingState(null);
    itemsRef.current = [];
    setItems([]);
  }, []);

  const removeIndex = useCallback(
    (index: number) => commitItems(removeAttachment(itemsRef.current, index)),
    [commitItems],
  );

  const addLibraryDocumentRow = useCallback(
    (doc: { id: string; name: string }): boolean => {
      const outcome = addLibraryDocument(itemsRef.current, doc);
      if (outcome.outcome === "added") {
        commitItems(outcome.next);
        return true;
      }
      // Duplicate: already attached — the controller's silent keep.
      if (outcome.outcome === "duplicate") return true;
      notice(outcome.notice, { max: MAX_ATTACHMENT_ITEMS });
      return false;
    },
    [commitItems, notice],
  );

  const pickerPorts: PickerPorts = {
    launchImage: async (source) => {
      const result =
        source === "camera"
          ? await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.9 })
          : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.9 });
      if (result.canceled || !result.assets?.length) return null;
      const asset = result.assets[0];
      return { uri: asset.uri, fileName: asset.fileName };
    },
    resizeImage: async (uri) => {
      const manipulated = await ImageManipulator.manipulateAsync(
        uri,
        [{ resize: { width: 1280 } }],
        { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG },
      );
      return manipulated.uri;
    },
    pickDocument: async () => {
      const picked = await DocumentPicker.getDocumentAsync({
        type: CHAT_DOCUMENT_PICKER_TYPES,
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (picked.canceled || !picked.assets?.length) return null;
      const asset = picked.assets[0];
      return { uri: asset.uri, name: asset.name, mimeType: asset.mimeType };
    },
    peekHead: (uri) => peekFileHead(uri, 8),
    count: () => itemsRef.current.length,
    nextId: (prefix) => nextMsgId(prefix),
  };

  const docxPorts = useCallback(
    (): DocxAttachPorts => ({
      count: () => itemsRef.current.length,
      notice: (key, opts) => notice(key, opts),
      resolveSizeBytes: (uri) => resolveAssetSizeBytes(uri),
      withinLimits: (bytes, kind) => sizeWithinLimits(bytes, kind),
      extractText: (uri) => extractDocxTextFromFile(uri),
      containerCapLabel: formatBytesLocalized(MAX_DOCUMENT_BYTES, locale),
      textCapLabel: formatBytesLocalized(MAX_TEXT_BYTES, locale),
      byteLength: (text) => new TextEncoder().encode(text).length,
      nextDocId: () => nextLibraryDocId(),
      writeOwnedText: (id, text) => writeOwnedText(id, text),
      deleteOwnedFile: (uri) => deleteOwnedFile(uri),
      addDocument: (entry) => addDocument(entry),
      // The final cap was checked by the caller; a duplicate keeps one copy —
      // the outcome is the row hook's business, not the import's.
      attachDocument: (doc) => {
        addLibraryDocumentRow(doc);
      },
      now: () => Date.now(),
      estimateTokens: (text) => estimateTokensForDoc(text),
      isMounted: () => mountedRef.current,
    }),
    [addDocument, locale, notice],
  );

  const beginImagePick = useCallback(
    async (source: ImageSource): Promise<boolean> => {
      const session = pickSessionRef.current;
      const outcome = await runImagePick(pickerPorts, {
        source,
        visionCapable: visionCapable(),
        now: Date.now(),
      });
      if (!mountedRef.current || session !== pickSessionRef.current) return false;
      if (outcome.action === "capped") {
        notice(outcome.notice, { max: MAX_ATTACHMENT_ITEMS });
        return true;
      }
      if (outcome.action === "ignored") return false;
      const added = addAttachment(itemsRef.current, outcome.item);
      if (added.ok) commitItems(added.next);
      if (outcome.notice) notice(outcome.notice);
      return true;
    },
    // The ports object closes over refs and module functions only — no state
    // reads — so rebuilding `notice`/`visionCapable` is the whole dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [notice, visionCapable, commitItems],
  );

  const beginDocumentPick = useCallback(
    async (): Promise<boolean> => {
      // The controller's re-entry guard (`pickingPdfRef || pdfToRenderRef`,
      // `Chat:1714`): one picker open, never a second while a PDF converts.
      if (pickingRef.current || convertingRef.current) return false;
      pickingRef.current = true;
      const session = pickSessionRef.current;
      try {
        const outcome = await runDocumentPick(pickerPorts);
        if (!mountedRef.current || session !== pickSessionRef.current) return false;
        if (
          outcome.action === "capped" ||
          outcome.action === "legacy" ||
          outcome.action === "invalid"
        ) {
          notice(outcome.notice, { max: MAX_ATTACHMENT_ITEMS });
          return false;
        }
        if (outcome.action === "docx") {
          await importAndAttachDocx(outcome.uri, outcome.name, docxPorts());
          return true;
        }
        if (outcome.action === "convert") {
          const next = { uri: outcome.uri, name: outcome.name };
          pagesRef.current = [];
          convertingRef.current = next;
          setConvertingState(next);
          return true;
        }
        return false;
      } finally {
        pickingRef.current = false;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [notice, docxPorts],
  );

  const onPage = useCallback((_index: number, imageUri: string) => {
    pagesRef.current.push(imageUri);
  }, []);

  const onDone = useCallback(() => {
    if (!mountedRef.current) return;
    const meta = convertingRef.current;
    const pages = pagesRef.current.slice();
    pagesRef.current = [];
    convertingRef.current = null;
    setConvertingState(null);
    const outcome = pdfConversionDone(
      meta,
      pages,
      itemsRef.current.length,
      visionCapable(),
      nextMsgId,
    );
    if (outcome.action === "capped") {
      for (const uri of outcome.dropPages) {
        void FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => undefined);
      }
      notice(outcome.notice, { max: MAX_ATTACHMENT_ITEMS });
      return;
    }
    if (outcome.action === "noPages") {
      notice(outcome.notice);
      return;
    }
    if (outcome.action !== "added") return;
    const added = addAttachment(itemsRef.current, outcome.item);
    if (added.ok) commitItems(added.next);
    if (outcome.notice) notice(outcome.notice);
  }, [commitItems, notice, visionCapable]);

  const onError = useCallback(
    (error: Error) => {
      if (!mountedRef.current) return;
      pagesRef.current = [];
      convertingRef.current = null;
      setConvertingState(null);
      notice(pdfErrorNotice(error instanceof PdfExtractError ? error.code : null));
    },
    [notice],
  );

  return {
    items,
    itemsRef,
    converting,
    beginImagePick,
    beginDocumentPick,
    addLibraryDocumentRow,
    removeIndex,
    clear,
    pdf: { onPage, onDone, onError },
  };
}
