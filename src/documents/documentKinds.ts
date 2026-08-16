/**
 * Shared picker-kind classification for Documents import and chat attach.
 * Pure — no React Native. Missing names are empty, never "document.pdf".
 */

export type PickedDocKind = "pdf" | "txt" | "docx";

export const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export const DOTX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.template";
export const MSWORD_MIME = "application/msword";

/** Documents tab picker: pdf / text / Word (msword so Android lists .doc). */
export const DOCUMENTS_PICKER_TYPES: string[] = [
  "application/pdf",
  "text/plain",
  "text/markdown",
  DOCX_MIME,
  DOTX_MIME,
  MSWORD_MIME,
];

/** Chat attach row: pdf + Word only (legacy .doc is rejected after pick). */
export const CHAT_DOCUMENT_PICKER_TYPES: string[] = [
  "application/pdf",
  DOCX_MIME,
  DOTX_MIME,
  MSWORD_MIME,
];

const KNOWN_DOC_EXTENSIONS = [
  ".pdf",
  ".txt",
  ".md",
  ".docx",
  ".dotx",
  ".doc",
  ".dot",
] as const;

export function pickKind(
  mime: string | undefined,
  name: string | undefined,
): PickedDocKind | "doc_legacy" | null {
  const lower = (name ?? "").toLowerCase();
  const mimeLower = (mime ?? "").split(";")[0].trim().toLowerCase();
  if (mimeLower === "application/pdf" || lower.endsWith(".pdf")) return "pdf";
  if (
    mimeLower === "text/plain" ||
    mimeLower === "text/markdown" ||
    mimeLower === "text/x-markdown" ||
    lower.endsWith(".txt") ||
    lower.endsWith(".md") ||
    lower.endsWith(".markdown")
  ) {
    return "txt";
  }
  if (
    mimeLower === DOCX_MIME ||
    mimeLower === DOTX_MIME ||
    lower.endsWith(".docx") ||
    lower.endsWith(".dotx")
  ) {
    return "docx";
  }
  if (
    mimeLower === MSWORD_MIME ||
    lower.endsWith(".doc") ||
    lower.endsWith(".dot")
  ) {
    return "doc_legacy";
  }
  return null;
}

/** Sniff only when pickKind is ambiguous (legacy/null) and the name has no known ext. */
export function shouldSniffPickedKind(
  kind: PickedDocKind | "doc_legacy" | null,
  name: string | undefined,
): boolean {
  if (kind !== "doc_legacy" && kind !== null) return false;
  const n = (name ?? "").trim();
  if (!n) return true;
  const lower = n.toLowerCase();
  return !KNOWN_DOC_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export function sniffDocxOrLegacy(
  bytes: Uint8Array,
): "docx" | "doc_legacy" | null {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 4) return null;
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    const a = bytes[2];
    const b = bytes[3];
    if (
      (a === 0x03 && b === 0x04) ||
      (a === 0x05 && b === 0x06) ||
      (a === 0x07 && b === 0x08)
    ) {
      return "docx";
    }
  }
  if (
    bytes[0] === 0xd0 &&
    bytes[1] === 0xcf &&
    bytes[2] === 0x11 &&
    bytes[3] === 0xe0
  ) {
    return "doc_legacy";
  }
  return null;
}
