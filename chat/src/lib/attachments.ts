import * as pdfjsLib from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { strFromU8, unzipSync } from "fflate";
import type { ChatMessage } from "./types";
import type { WireMessage } from "./chat";

export type AttachmentKind = "txt" | "md" | "pdf" | "docx" | "pptx";

export interface Attachment {
  id: string;
  name: string;
  kind: AttachmentKind;
  /** PDF pages / slides. Absent for flow text, which has no pages. */
  pages?: number;
  chars: number;
  /** Measured estimate (chars/4), labeled ≈ wherever shown. */
  tokens: number;
  /** Extracted raw text. Never rendered as HTML or markdown, anywhere. */
  text: string;
  attachedAt: number;
  /** False = history: detached but re-attachable with one click. */
  active: boolean;
}

/** Browser-side read cap: beyond this a tab risks more than it gains. */
export const MAX_FILE_BYTES = 32 * 1024 * 1024;
/** Completion headroom kept free whenever the context size is known. */
export const CONTEXT_RESERVE_TOKENS = 512;

export type AttachmentFailure = "unsupported" | "too-big" | "unreadable" | "empty";

export class AttachmentError extends Error {
  failure: AttachmentFailure;

  constructor(failure: AttachmentFailure, message: string) {
    super(message);
    this.name = "AttachmentError";
    this.failure = failure;
  }
}

export function estTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

export function messageTokens(message: ChatMessage): number {
  const toolTokens = (message.toolRuns ?? []).reduce(
    (sum, run) => sum + estTokens(run.arguments) + estTokens(run.result),
    0,
  );
  return estTokens(message.content) + estTokens(message.reasoning ?? "") + toolTokens;
}

/** Same formula the pinning uses: one place where history is weighed. */
export function historyTokens(messages: ChatMessage[]): number {
  return messages.reduce((sum, m) => sum + messageTokens(m), 0);
}

export function kindFor(name: string): AttachmentKind | null {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "txt") return "txt";
  if (ext === "md") return "md";
  if (ext === "pdf") return "pdf";
  if (ext === "docx") return "docx";
  if (ext === "pptx") return "pptx";
  return null;
}

function aid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `att-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
}

function cleanText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

let workerSet = false;

async function extractPdf(file: File): Promise<{ text: string; pages: number }> {
  if (!workerSet) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;
    workerSet = true;
  }
  const data = await file.arrayBuffer();
  const doc = await pdfjsLib.getDocument({ data }).promise;
  const out: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    try {
      const content = await page.getTextContent();
      let line = "";
      const lines: string[] = [];
      for (const raw of content.items) {
        const item = raw as { str?: unknown; hasEOL?: unknown };
        if (typeof item.str !== "string") continue;
        if (item.hasEOL === true) {
          lines.push(line + item.str);
          line = "";
        } else {
          line += line ? ` ${item.str}` : item.str;
        }
      }
      if (line.trim()) lines.push(line);
      out.push(lines.join("\n"));
    } finally {
      page.cleanup();
    }
  }
  return { text: out.join("\n\n"), pages: doc.numPages };
}

const WORD_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const DRAW_NS = "http://schemas.openxmlformats.org/drawingml/2006/main";

function unzipXml(data: Uint8Array, path: string): Document {
  const files = unzipSync(data);
  const bytes = files[path];
  if (!bytes) throw new Error(`missing ${path}`);
  const doc = new DOMParser().parseFromString(strFromU8(bytes), "text/xml");
  if (doc.querySelector("parsererror")) throw new Error(`bad xml ${path}`);
  return doc;
}

function paragraphsOf(xml: Document, ns: string, para: string, tab: string | null): string[] {
  const out: string[] = [];
  const nodes = Array.from(xml.getElementsByTagNameNS(ns, para)).filter((node) => {
    // Text boxes nest paragraphs; read each once, at its outermost level.
    let ancestor = node.parentElement;
    while (ancestor) {
      if (ancestor.namespaceURI === ns && ancestor.localName === para) return false;
      ancestor = ancestor.parentElement;
    }
    return true;
  });
  for (const node of nodes) {
    // Skip nested paragraphs (table cells nest them; each still reads once).
    let piece = "";
    const walker = xml.createTreeWalker(node, NodeFilter.SHOW_ELEMENT);
    let el: Element | null = walker.currentNode as Element;
    while (el) {
      if (el.namespaceURI === ns && el.localName === "t") piece += el.textContent ?? "";
      else if (tab && el.namespaceURI === ns && el.localName === tab) piece += "\t";
      el = walker.nextNode() as Element | null;
    }
    if (piece.trim()) out.push(piece);
  }
  return out;
}

async function extractDocx(file: File): Promise<{ text: string; pages?: undefined }> {
  const data = new Uint8Array(await file.arrayBuffer());
  const xml = unzipXml(data, "word/document.xml");
  return { text: paragraphsOf(xml, WORD_NS, "p", "tab").join("\n\n") };
}

async function extractPptx(file: File): Promise<{ text: string; pages: number }> {
  const data = new Uint8Array(await file.arrayBuffer());
  const files = unzipSync(data);
  const names = Object.keys(files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => parseInt(a.match(/\d+/)?.[0] ?? "0", 10) - parseInt(b.match(/\d+/)?.[0] ?? "0", 10));
  if (names.length === 0) throw new Error("no slides");
  const slides: string[] = [];
  names.forEach((name, i) => {
    const xml = new DOMParser().parseFromString(strFromU8(files[name]), "text/xml");
    if (xml.querySelector("parsererror")) throw new Error(`bad xml ${name}`);
    slides.push(`--- Slide ${i + 1} ---\n${paragraphsOf(xml, DRAW_NS, "p", null).join("\n")}`);
  });
  return { text: slides.join("\n\n"), pages: names.length };
}

export async function extractAttachment(file: File): Promise<Attachment> {
  const kind = kindFor(file.name);
  if (!kind) {
    throw new AttachmentError(
      "unsupported",
      `“${file.name}” is not a readable kind. Text, markdown, PDF, Word and PowerPoint files work.`,
    );
  }
  if (file.size > MAX_FILE_BYTES) {
    throw new AttachmentError(
      "too-big",
      `“${file.name}” is too large to read in the browser (${Math.round(file.size / 1048576)} MB).`,
    );
  }
  let text: string;
  let pages: number | undefined;
  try {
    switch (kind) {
      case "txt":
      case "md":
        text = await file.text();
        break;
      case "pdf": {
        const pdf = await extractPdf(file);
        text = pdf.text;
        pages = pdf.pages;
        break;
      }
      case "docx":
        text = (await extractDocx(file)).text;
        break;
      case "pptx": {
        const ppt = await extractPptx(file);
        text = ppt.text;
        pages = ppt.pages;
        break;
      }
    }
  } catch {
    throw new AttachmentError("unreadable", `“${file.name}” could not be read. The file may be damaged or protected.`);
  }
  text = cleanText(text);
  if (!text) {
    throw new AttachmentError("unreadable", `“${file.name}” holds no readable text (a scan without a text layer reads as blank).`);
  }
  return {
    id: aid(),
    name: file.name,
    kind,
    ...(pages !== undefined ? { pages } : {}),
    chars: text.length,
    tokens: estTokens(text),
    text,
    attachedAt: Date.now(),
    active: true,
  };
}

function docBlockFor(docs: Attachment[]): WireMessage {
  const parts = docs.map(
    (d) =>
      `--- ${d.name} (${d.kind}${d.pages !== undefined ? `, ${d.pages} pages` : ""}, ≈${d.tokens} tokens) ---\n${d.text}`,
  );
  return {
    role: "system",
    content: `Attached documents (pinned — they stay even as older turns are dropped):\n\n${parts.join("\n\n")}`,
  };
}

/**
 * One stored message as the wire sees it. A message that used tools becomes the
 * ordinary three-part turn — the assistant asking, the tool answering, the
 * assistant's own words — because that is the shape the model was trained on
 * and the shape it expects to see again. The transcript itself holds no `tool`
 * role: this is the only place the roles are invented.
 */
function wireFor(message: ChatMessage): WireMessage[] {
  // A refused run never happened as far as the server is concerned: it was
  // never sent back as a call, and an unnamed one would be a malformed request.
  // It stays in the transcript for the reader and out of the wire.
  const runs = (message.toolRuns ?? []).filter((run) => run.state !== "refused");
  if (message.role !== "assistant" || runs.length === 0) {
    return [{ role: message.role, content: message.content }];
  }
  const asked: WireMessage = {
    role: "assistant",
    content: "",
    tool_calls: runs.map((run) => ({
      id: run.id,
      type: "function" as const,
      function: { name: run.name, arguments: run.arguments },
    })),
  };
  const answered: WireMessage[] = runs.map((run) => ({
    role: "tool",
    content: run.result,
    tool_call_id: run.id,
  }));
  const said: WireMessage[] = message.content
    ? [{ role: "assistant", content: message.content }]
    : [];
  return [asked, ...answered, ...said];
}

export type PinnedContext =
  | { status: "ok"; wire: WireMessage[]; dropped: number; docTokens: number; historyTokens: number }
  | { status: "refused"; need: number; have: number; docTokens: number; historyTokens: number };

/**
 * Assemble what is actually sent: the pinned documents first (they are never
 * pruned), then turns newest-kept — oldest turns drop first when the known
 * context fills. With unknown size nothing is pruned or refused.
 */
export function buildPinnedContext(
  messages: ChatMessage[],
  docs: Attachment[],
  nctx: number | null,
): PinnedContext {
  const actives = docs.filter((d) => d.active);
  const docTokens = actives.reduce((sum, d) => sum + d.tokens, 0);
  const turns = [...messages];
  let histTokens = historyTokens(turns);
  let dropped = 0;
  if (nctx !== null) {
    while (docTokens + histTokens + CONTEXT_RESERVE_TOKENS > nctx && turns.length > 1) {
      const shed = turns.shift();
      if (shed) {
        histTokens -= messageTokens(shed);
        dropped++;
      }
    }
    const need = docTokens + histTokens + CONTEXT_RESERVE_TOKENS;
    if (need > nctx) {
      return { status: "refused", need, have: nctx, docTokens, historyTokens: histTokens };
    }
  }
  const wire = turns.flatMap(wireFor);
  if (actives.length > 0) wire.unshift(docBlockFor(actives));
  return { status: "ok", wire, dropped, docTokens, historyTokens: histTokens };
}
