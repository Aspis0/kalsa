/**
 * The attach sheet's three answers, as ports-in decisions-out (D1 row 43):
 * photo library / camera (`AiChatPage.tsx:1663-1711`), PDF-or-Word
 * (`:1713-1768`), and the PDF conversion's completion (`:1778-1810`). The
 * controller interleaved these branches with `setAttachSheetOpen`,
 * `showVoiceNote` and refs; here each branch RETURNS what the hook must do
 * (add, notice, close the sheet, start a conversion), so every refusal —
 * cancel, cap, legacy Word, invalid type, no pages — is testable in node
 * without expo-image-picker or the WebView.
 *
 * The hook (`useAttachments.ts`) owns the busy flag and the state writes;
 * every picker error the controller swallowed with `catch {}` comes back as
 * `ignored`, never as a throw.
 */
import type { TranslationKey } from "../i18n";
import {
  pickKind,
  shouldSniffPickedKind,
  sniffDocxOrLegacy,
} from "../documents/documentKinds";
import {
  MAX_ATTACHMENT_ITEMS,
  PDF_CAP_NOTICE,
  routePickedKind,
  visionInputPresent,
} from "./attachments";
import type { LocalAttachment } from "./hostMessage";

export type ImageSource = "library" | "camera";

export interface ImageAsset {
  uri: string;
  fileName?: string | null;
}

export interface PickedDocument {
  uri: string;
  name?: string | null;
  mimeType?: string | null;
}

export interface PickerPorts {
  /** `ImagePicker.launchImageLibraryAsync` / `launchCameraAsync`, cancelled
   *  and empty results collapsed to `null`. */
  launchImage: (source: ImageSource) => Promise<ImageAsset | null>;
  /** `ImageManipulator.manipulateAsync` — JPEG, width 1280, quality .85 —
   *  reduced to the resized URI it produced. */
  resizeImage: (uri: string) => Promise<string>;
  /** `DocumentPicker.getDocumentAsync` over `CHAT_DOCUMENT_PICKER_TYPES`. */
  pickDocument: () => Promise<PickedDocument | null>;
  /** The first bytes of the pick, for the ambiguous-kind sniff. */
  peekHead: (uri: string) => Promise<Uint8Array | null>;
  /** The live row count the cap decides on. */
  count: () => number;
  /** The host's module-counter id (`hostMessage.nextMsgId`). */
  nextId: (prefix: string) => string;
}

export type ImagePickOutcome =
  | { action: "ignored" }
  | { action: "capped"; notice: TranslationKey; closeSheet: true }
  | {
      action: "added";
      item: LocalAttachment;
      /** `chat.visionUnsupportedNotice` when the model cannot see images —
       *  skipped exactly on the cap path, as the controller did. */
      notice: TranslationKey | null;
      closeSheet: true;
    };

/** Controller `Chat:1663-1711`: launch → resize → cap → add → vision notice.
 *  `now` seeds the fallback filename so the test can pin it. */
export async function runImagePick(
  ports: PickerPorts,
  input: { source: ImageSource; visionCapable: boolean; now: number },
): Promise<ImagePickOutcome> {
  let asset: ImageAsset | null;
  try {
    asset = await ports.launchImage(input.source);
  } catch {
    return { action: "ignored" };
  }
  if (!asset) return { action: "ignored" };
  let uri: string;
  try {
    uri = await ports.resizeImage(asset.uri);
  } catch {
    return { action: "ignored" };
  }
  if (ports.count() >= MAX_ATTACHMENT_ITEMS) {
    return { action: "capped", notice: "errors.attachmentLimitReachedGeneric", closeSheet: true };
  }
  const item: LocalAttachment = {
    id: ports.nextId("img"),
    kind: "image",
    name: asset.fileName ?? `photo-${input.now}.jpg`,
    uri,
  };
  return {
    action: "added",
    item,
    notice: input.visionCapable ? null : "chat.visionUnsupportedNotice",
    closeSheet: true,
  };
}

export type DocumentPickOutcome =
  | { action: "ignored" }
  | { action: "capped"; notice: TranslationKey; closeSheet: false }
  | { action: "legacy"; notice: TranslationKey; closeSheet: false }
  | { action: "invalid"; notice: TranslationKey; closeSheet: false }
  | { action: "docx"; uri: string; name: string; closeSheet: true }
  | { action: "convert"; uri: string; name: string; closeSheet: true };

/**
 * Controller `Chat:1713-1768`: cap before the picker opens (the PDF-worded
 * line — the controller's own key at every cap inside this path), sniff the
 * ambiguous kind from the first 8 bytes, then route legacy → refusal,
 * docx → import, pdf → conversion, anything else → invalid type. The caller
 * owns the busy flag: a second press while one is open never reaches here.
 */
export async function runDocumentPick(ports: PickerPorts): Promise<DocumentPickOutcome> {
  if (ports.count() >= MAX_ATTACHMENT_ITEMS) {
    return { action: "capped", notice: PDF_CAP_NOTICE, closeSheet: false };
  }
  let picked: PickedDocument | null;
  try {
    picked = await ports.pickDocument();
  } catch {
    return { action: "ignored" };
  }
  if (!picked) return { action: "ignored" };
  const name = (picked.name ?? "").trim();
  let kind = pickKind(picked.mimeType ?? undefined, name);
  if (shouldSniffPickedKind(kind, name)) {
    try {
      const head = await ports.peekHead(picked.uri);
      const sniffed = head ? sniffDocxOrLegacy(head) : null;
      if (sniffed) kind = sniffed;
    } catch {
      return { action: "ignored" };
    }
  }
  const routing = routePickedKind(kind);
  if (routing.action === "legacy") {
    return { action: "legacy", notice: "documents.errorLegacyWord", closeSheet: false };
  }
  if (routing.action === "invalid") {
    return { action: "invalid", notice: "errors.attachmentInvalidType", closeSheet: false };
  }
  // docx and pdf both re-check the cap after the await (a share-in attach can
  // land while the picker is open) — the controller's own second checks.
  if (ports.count() >= MAX_ATTACHMENT_ITEMS) {
    return { action: "capped", notice: PDF_CAP_NOTICE, closeSheet: false };
  }
  if (routing.action === "docx") {
    return { action: "docx", uri: picked.uri, name: name || "document.docx", closeSheet: true };
  }
  return { action: "convert", uri: picked.uri, name: name || "document.pdf", closeSheet: true };
}

export type PdfDoneOutcome =
  | { action: "ignored" }
  | { action: "noPages"; notice: TranslationKey }
  | { action: "capped"; notice: TranslationKey; dropPages: string[] }
  | { action: "added"; item: LocalAttachment; notice: TranslationKey | null };

/** Controller `handlePdfDone` (`Chat:1778-1810`): no pages says so; the cap
 *  refuses AND hands back the rendered JPEGs to delete; otherwise the PDF row
 *  lands with its pages and the vision notice fires when the model cannot
 *  see them. `itemCount` is the live row count (pages are content, rows are
 *  what the five-row cap counts). */
export function pdfConversionDone(
  meta: { uri: string; name: string } | null,
  pages: readonly string[],
  itemCount: number,
  visionCapable: boolean,
  nextId: (prefix: string) => string,
): PdfDoneOutcome {
  if (!meta) return { action: "ignored" };
  if (pages.length === 0) return { action: "noPages", notice: "errors.pdfNoPages" };
  if (itemCount >= MAX_ATTACHMENT_ITEMS) {
    return { action: "capped", notice: PDF_CAP_NOTICE, dropPages: [...pages] };
  }
  const item: LocalAttachment = {
    id: nextId("pdf"),
    kind: "pdf",
    name: meta.name,
    uri: meta.uri,
    pages: [...pages],
    pageCount: pages.length,
  };
  return {
    action: "added",
    item,
    notice: visionInputPresent([item]) && !visionCapable ? "chat.visionUnsupportedNotice" : null,
  };
}
