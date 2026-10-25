/**
 * The composer's attachment rules as pure decisions (D1 row 43, the attach
 * half): the cap, the add/remove transitions, the picked-document routing and
 * the PDF error → notice mapping. The controller kept these interleaved with
 * state and toasts inside `AiChatPage.tsx:1661-1833`; here every branch a
 * test can ask "what happens if…" about is a function, and the hook
 * (`useAttachments.ts`) only wires pickers and notices to them.
 *
 * Leaf rules: no React, no expo, no `src/engine` — ports and data in, keys
 * and next-states out.
 */
import type { TranslationKey } from "../i18n";
import { nextMsgId, type LocalAttachment } from "./hostMessage";

/** The controller's `MAX_IMAGE_ATTACHMENTS` (`AiChatPage.tsx:1661`): images,
 *  PDFs and library documents share ONE cap of five rows. */
export const MAX_ATTACHMENT_ITEMS = 5;

export function atAttachmentCap(items: readonly LocalAttachment[]): boolean {
  return items.length >= MAX_ATTACHMENT_ITEMS;
}

/** Generic cap refusal — the notice the controller's `attachmentLimitReachedGeneric`
 *  serves when the row count is already full. `max` interpolates the cap. */
export const ATTACHMENT_CAP_NOTICE: TranslationKey = "errors.attachmentLimitReachedGeneric";

/** The PDF-path cap refusal: the controller's `attachmentLimitReached`, whose
 *  copy names the PDF pages that will NOT be attached. */
export const PDF_CAP_NOTICE: TranslationKey = "errors.attachmentLimitReached";

export type AddOutcome =
  | { ok: true; next: LocalAttachment[] }
  | { ok: false; notice: TranslationKey };

/** Append within the cap; refuse with the caller's cap notice when full. */
export function addAttachment(
  items: readonly LocalAttachment[],
  item: LocalAttachment,
  capNotice: TranslationKey = ATTACHMENT_CAP_NOTICE,
): AddOutcome {
  if (atAttachmentCap(items)) return { ok: false, notice: capNotice };
  return { ok: true, next: [...items, item] };
}

export type LibraryAddOutcome =
  | { outcome: "added"; next: LocalAttachment[] }
  /** The same library doc is already attached — silently keep one copy, as
   *  the controller did (`prev` returned unchanged, `Chat:3690-3696`). */
  | { outcome: "duplicate" }
  | { outcome: "capped"; notice: TranslationKey };

/** A library document attaches as a retrieval source: deduplicated by
 *  `libraryDocId`, then the same five-row cap (controller
 *  `addLibraryDocumentAttachment`, `Chat:3689-3715`). */
export function addLibraryDocument(
  items: readonly LocalAttachment[],
  doc: { id: string; name: string },
): LibraryAddOutcome {
  if (items.some((item) => item.kind === "document" && item.libraryDocId === doc.id)) {
    return { outcome: "duplicate" };
  }
  if (atAttachmentCap(items)) return { outcome: "capped", notice: ATTACHMENT_CAP_NOTICE };
  return {
    outcome: "added",
    next: [
      ...items,
      // The controller's id scheme (`nextMsgId("doc")`, `Chat:3701`); the
      // dedupe above is what keeps one library doc from stacking twice.
      { id: nextMsgId("doc"), kind: "document", name: doc.name, uri: "", libraryDocId: doc.id },
    ],
  };
}

export function removeAttachment(
  items: readonly LocalAttachment[],
  index: number,
): LocalAttachment[] {
  return items.filter((_, i) => i !== index);
}

/** The engine's own per-turn picture cap (`LlamaService` MAX_IMAGES_PER_TURN) —
 *  a turn never puts more than this many pictures on a wire. */
export const MAX_IMAGES_PER_TURN = 5;

/** Whether the snapshot carries VISION input (the controller's
 *  `hasVisionInput`, `Chat:2441-2446`): images and rendered PDF pages — a
 *  library document is a retrieval source, never vision. */
export function visionInputPresent(items: readonly LocalAttachment[]): boolean {
  return items.some(
    (item) => item.kind === "image" || (item.kind === "pdf" && (item.pages?.length ?? 0) > 0),
  );
}

/** The stored URIs a turn's staged rows put on a wire: direct pictures and
 *  rendered PDF pages, in row order, capped like the live turn. URIs only —
 *  base64 never enters a history message. */
export function attachmentImageUris(
  items: readonly LocalAttachment[] | undefined,
): string[] {
  if (!items?.length) return [];
  const uris: string[] = [];
  for (const item of items) {
    if (uris.length >= MAX_IMAGES_PER_TURN) break;
    if (item.kind === "image" && item.uri) {
      uris.push(item.uri);
    } else if (item.kind === "pdf") {
      for (const page of item.pages ?? []) uris.push(page);
    }
  }
  return uris.slice(0, MAX_IMAGES_PER_TURN);
}

/** The same rule narrowed to what a REMOTE wire may carry: pictures chosen as
 *  pictures. A PDF's rendered pages were produced by a document row, and
 *  document content never crosses to the desk — a pick or conversion still in
 *  flight when the phone connected must not leak them. */
export function remoteAttachmentImageUris(
  items: readonly LocalAttachment[] | undefined,
): string[] {
  return attachmentImageUris(items?.filter((item) => item.kind === "image"));
}

/**
 * The pictures a REMOTE prompt prices: this turn's staged rows plus the ones
 * inside the messages the image-turn window keeps. Anything older is demoted
 * before it reaches a prompt, and pricing the whole history starved the text
 * budget for pictures nobody would see; what actually rides is capped again,
 * in bytes, by the wire budget at send.
 */
export function remotePictureCount(
  items: readonly LocalAttachment[] | undefined,
  history: readonly { images?: string[] }[],
  windowMessages: number,
): number {
  const window = windowMessages > 0 ? history.slice(-windowMessages) : [];
  const inWindow = window.reduce(
    (sum, message) => sum + (message.images?.length ?? 0),
    0,
  );
  return attachmentImageUris(items).length + inWindow;
}

/** The model-facing annotation for library documents (controller
 *  `Chat:2450-2455`), so `document_chat` can select the right entry. */
export function documentHints(items: readonly LocalAttachment[]): string {
  return items
    .filter((item) => item.kind === "document" && item.libraryDocId)
    .map((item) => `[document:${item.libraryDocId} name="${item.name}"]`)
    .join(" ");
}

/** What the chat document picker produced, decided from the controller's own
 *  kind (`AiChatPage.tsx:1731-1763`): PDF renders, docx imports, legacy Word
 *  and anything else are refusals with their catalogue lines. */
export type PickedRouting =
  | { action: "pdf" }
  | { action: "docx" }
  | { action: "legacy" }
  | { action: "invalid" };

export function routePickedKind(
  kind: "pdf" | "txt" | "docx" | "doc_legacy" | null,
): PickedRouting {
  if (kind === "doc_legacy") return { action: "legacy" };
  if (kind === "docx") return { action: "docx" };
  if (kind !== "pdf") return { action: "invalid" };
  return { action: "pdf" };
}

/**
 * `PdfExtractError.code` → the controller's notice (`Chat:1817-1829`).
 * `null` is any non-Pdf error: the generic extraction-failed line, never a
 * fabricated reason.
 */
export function pdfErrorNotice(code: string | null): TranslationKey {
  switch (code) {
    case "timeout":
      return "errors.pdfExtractTimeout";
    case "page_timeout":
      return "errors.pdfTimeout";
    case "renderer_gone":
      return "errors.pdfRendererGone";
    case "cap":
      return "errors.pdfTooLarge";
    default:
      return "errors.pdfExtractFailed";
  }
}
