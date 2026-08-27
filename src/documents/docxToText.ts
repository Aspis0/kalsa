/**
 * Pure .docx → plain-text extractor. No React Native at module scope so a
 * Node harness can import extractDocxTextFromBytes.
 */

import { unzipSync, type Unzipped } from "fflate";

export type DocxExtractCode =
  | "DOCX_NOT_ZIP"
  | "DOCX_NO_DOCUMENT"
  | "DOCX_EMPTY"
  | "DOCX_TOO_LARGE";

/** Per-part inflate cap for word/document.xml and headers/footers. */
export const MAX_DOCX_PART_BYTES = 2 * 1024 * 1024;
const MAX_HEADER_FOOTER_PARTS = 4;

export class DocxExtractError extends Error {
  readonly code: DocxExtractCode;
  constructor(code: DocxExtractCode) {
    super(code);
    this.name = "DocxExtractError";
    this.code = code;
  }
}

const ENTITY_RE = /&amp;|&lt;|&gt;|&quot;|&apos;/g;
const ENTITY_MAP: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
};

function decodeXmlEntities(s: string): string {
  return s.replace(ENTITY_RE, (m) => ENTITY_MAP[m] ?? m);
}

function normalizeZipPath(name: string): string {
  return name.replace(/\\/g, "/").replace(/^\/+/, "").toLowerCase();
}

function isWordHeaderOrFooter(path: string): boolean {
  return /^word\/(header|footer)[^/]*\.xml$/.test(path);
}

function localName(tag: string): string {
  const i = tag.indexOf(":");
  return (i >= 0 ? tag.slice(i + 1) : tag).toLowerCase();
}

function collapseNewlines(s: string): string {
  return s
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\n{3,}/g, "\n\n");
}

/**
 * WordprocessingML: text lives in w:t. w:p / w:br / w:cr → newline, w:tab → tab.
 * Newline is emitted on paragraph close so adjacent paras stay single-spaced.
 */
function walkWordXml(xml: string): string {
  const out: string[] = [];
  const re = /<\/?([A-Za-z_][\w:.-]*)\b[^>]*\/?>/g;
  let last = 0;
  let inT = false;
  let skip = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    if (inT && skip === 0 && m.index > last) {
      out.push(xml.slice(last, m.index));
    }
    const raw = m[0];
    const name = localName(m[1]);
    const closing = raw.startsWith("</");
    const selfClose = raw.endsWith("/>");
    if (name === "fallback") {
      if (!selfClose) {
        if (closing) {
          if (skip > 0) skip--;
        } else {
          skip++;
        }
      }
    }
    if (name === "t") {
      inT = !closing && !selfClose;
    } else if (skip === 0) {
      if (name === "p") {
        if (closing || selfClose) out.push("\n");
      } else if (name === "br" || name === "cr") {
        out.push("\n");
      } else if (name === "tab") {
        out.push("\t");
      }
    }
    last = m.index + raw.length;
  }
  if (inT && skip === 0 && last < xml.length) out.push(xml.slice(last));
  return decodeXmlEntities(out.join(""));
}

function xmlBytesToWordText(bytes: Uint8Array): string {
  return walkWordXml(new TextDecoder("utf-8").decode(bytes));
}

export function extractDocxTextFromBytes(bytes: Uint8Array): string {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 4) {
    throw new DocxExtractError("DOCX_NOT_ZIP");
  }
  let documentOversize = false;
  let headerFooterCount = 0;
  let unzipped: Unzipped;
  try {
    unzipped = unzipSync(bytes, {
      // Skip media / footnotes — only the document body plus cheap headers/footers.
      filter: (file) => {
        const n = normalizeZipPath(file.name);
        const isDoc = n === "word/document.xml";
        const isHf = isWordHeaderOrFooter(n);
        if (!isDoc && !isHf) return false;
        if (
          typeof file.originalSize === "number" &&
          file.originalSize > MAX_DOCX_PART_BYTES
        ) {
          if (isDoc) documentOversize = true;
          return false;
        }
        if (isHf) {
          if (headerFooterCount >= MAX_HEADER_FOOTER_PARTS) return false;
          headerFooterCount += 1;
        }
        return true;
      },
    });
  } catch {
    throw new DocxExtractError("DOCX_NOT_ZIP");
  }
  const byPath = new Map<string, Uint8Array>();
  for (const [key, value] of Object.entries(unzipped)) {
    if (value) byPath.set(normalizeZipPath(key), value);
  }
  const documentXml = byPath.get("word/document.xml");
  if (!documentXml) {
    throw new DocxExtractError(
      documentOversize ? "DOCX_TOO_LARGE" : "DOCX_NO_DOCUMENT",
    );
  }
  for (const part of byPath.values()) {
    if (part.byteLength > MAX_DOCX_PART_BYTES) {
      throw new DocxExtractError("DOCX_TOO_LARGE");
    }
  }
  const bodyText = xmlBytesToWordText(documentXml);
  if (!collapseNewlines(bodyText).trim()) {
    throw new DocxExtractError("DOCX_EMPTY");
  }
  const extras = [...byPath.keys()]
    .filter((k) => k !== "word/document.xml")
    .sort();
  const parts: string[] = [bodyText];
  for (const key of extras) {
    const u8 = byPath.get(key);
    if (u8) parts.push(xmlBytesToWordText(u8));
  }
  return collapseNewlines(parts.join("\n")).trim();
}

export async function extractDocxTextFromFile(uri: string): Promise<string> {
  // Lazy so Node can import the pure extractor without expo-file-system.
  const FileSystem = await import("expo-file-system/legacy");
  const { Buffer } = await import("buffer");
  const b64 = await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  const buf = Buffer.from(b64, "base64");
  return extractDocxTextFromBytes(new Uint8Array(buf));
}
