import * as pdfjsLib from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { strFromU8, unzipSync } from "fflate";
import { TOOL_STOPPED } from "./types";
import type { ChatMessage, ToolRun } from "./types";
import { miniappStateLines } from "./miniapp/stateText";
import { sentLine } from "./sentDate";
import { isMalformedArguments, NOT_VALID_FOR_MODEL, storedAsCut, wireArguments } from "./toolCalls";
import { guideNotValidJson } from "./guideRetry";
import { TOOL_DEFINITIONS } from "./tools/definitions";
import type { ToolDefinition } from "./tools/definitions";
import { definitionsTokens } from "./density";
import type { WireContentPart, WireMessage } from "./chat";

export type AttachmentKind = "txt" | "md" | "csv" | "pdf" | "docx" | "pptx";

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
  /** True rides the system message on every turn until removed; false rides
      only the user message it was sent with. Absent reads as true — the
      behaviour attachments stored before pinning existed must keep. */
  pinned?: boolean;
}

/** Browser-side read cap: beyond this a tab risks more than it gains. */
export const MAX_FILE_BYTES = 32 * 1024 * 1024;
/**
 * The room the answer has to write in, kept free whenever the context size is
 * known.
 *
 * **Measured on 21 October 2026, on the turn that closed for space.** The
 * thread had grown to 64650 tokens of a 65536 window, so the answer had 886
 * tokens to write in — and it wrote 886 of them and was cut at
 * `n_tokens = 65535, truncated = 1`: a table with its header and no rows. A
 * reserve of 512 is not a room for an answer, and the turn that has to answer
 * needs one that is bigger than the answer it has to write.
 *
 * **It is the answer's own term, and it is paid before the answer is asked
 * for.** The wire may spend the window less this, so the room is already free
 * when the last round of a turn goes out: the round that would not leave it
 * stops the turn instead of asking for an answer that cannot be written.
 */
export const ANSWER_RESERVE_TOKENS = 1536;
/** What one attached picture costs the window, whatever its pixels — the
    engine is launched with `--image-max-tokens` 560, its ceiling. */
export const IMAGE_TOKENS = 560;

/** The one sentence where the pictures would have been, when the turn goes
    to a model that cannot see them. */
export const IMAGE_PLACEHOLDER = "[an image the current AI cannot see]";

/** The short line that tells a seeing model what the stills beside it are:
    a video, how many frames of it, how long it runs. */
export function videoMarker(durationMs: number, frames: number): string {
  const total = Math.max(0, Math.round(durationMs / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `[video, ${frames} frames, ${minutes}:${seconds.toString().padStart(2, "0")}]`;
}

export type AttachmentFailure = "unsupported" | "too-big" | "unreadable" | "empty" | "no-text";

/** The one part a refusal sentence still names: the app an old format
 *  names. The file's own name no longer appears in the words. */
export interface AttachmentRefusal {
  app?: string;
}

export class AttachmentError extends Error {
  failure: AttachmentFailure;
  refusal: AttachmentRefusal;
  /** The stable token the log gets, never a name or a message. */
  reason: string;

  constructor(
    failure: AttachmentFailure,
    message: string,
    refusal: AttachmentRefusal = {},
    reason?: string,
  ) {
    super(message);
    this.name = "AttachmentError";
    this.failure = failure;
    this.refusal = refusal;
    this.reason = (reason ?? failure).replace(/-/g, "_");
  }
}

/** The log's reason for a failed read: the format and the reader's own error
    name, lowercased — never the file's name or a message. */
function readReason(kind: AttachmentKind, error: unknown): string {
  const raw = error instanceof Error ? error.name : "";
  const name = raw.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return name ? `${kind}_${name}` : `${kind}_read`;
}

export function estTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

export function messageTokens(message: ChatMessage): number {
  const toolTokens = (message.toolRuns ?? []).reduce(
    (sum, run) =>
      sum + estTokens(run.arguments) + estTokens(wireResult(run.result)),
    0,
  );
  // A video rides the window as its FRAMES: each still costs what a picture
  // costs, whether it rides or not — the same rule the fit answers by.
  const frameTokens = (message.videos ?? []).reduce(
    (sum, video) => sum + video.frames.length * IMAGE_TOKENS,
    0,
  );
  const imageTokens = (message.images?.length ?? 0) * IMAGE_TOKENS;
  return (
    estTokens(message.content) +
    estTokens(message.reasoning ?? "") +
    toolTokens +
    imageTokens +
    frameTokens +
    // The documents bound to this turn weigh what their rendered block
    // weighs — history, like the words they ride with.
    (message.docTokens ?? 0) +
    (message.mailNote ? estTokens(message.mailNote) : 0) +
    (message.browserNote ? estTokens(message.browserNote) : 0) +
    (message.sentOn ? estTokens(sentLine(message.sentOn)) : 0)
  );
}

/** Same formula the pinning uses: one place where history is weighed. */
export function historyTokens(messages: ChatMessage[]): number {
  return messages.reduce((sum, m) => sum + messageTokens(m), 0);
}

/** The pre-2007 binary Office formats, by extension: not worth a parser,
 *  but worth a sentence that names the way out. Same detection idea as the
 *  phone app's documentKinds (`src/documents/documentKinds.ts`). */
const LEGACY_OFFICE: Record<string, { app: string; modern: string }> = {
  doc: { app: "Word", modern: "docx" },
  dot: { app: "Word", modern: "docx" },
  ppt: { app: "PowerPoint", modern: "pptx" },
  pps: { app: "PowerPoint", modern: "pptx" },
};

export function kindFor(name: string): AttachmentKind | null {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "txt" || ext === "log") return "txt";
  if (ext === "md" || ext === "markdown") return "md";
  if (ext === "csv") return "csv";
  if (ext === "json") return "txt";
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

/** WKWebView on macOS 26 ships ReadableStream without Symbol.asyncIterator
 *  (WebKit adds it in Safari 27), and pdf.js consumes the text stream with
 *  `for await`, which then throws TypeError. Upstream closed this as not
 *  planned and points at a polyfill (mozilla/pdf.js#20973), so the one piece
 *  of the iterator pdf.js uses is supplied here. */
function ensureStreamAsyncIterator(): void {
  const proto = globalThis.ReadableStream?.prototype as
    | (ReadableStream<unknown> & { [Symbol.asyncIterator]?: unknown })
    | undefined;
  if (!proto || typeof proto[Symbol.asyncIterator] === "function") return;
  proto[Symbol.asyncIterator] = function (this: ReadableStream<unknown>) {
    const reader = this.getReader();
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      reader.releaseLock();
    };
    return {
      next: () => {
        if (released) return Promise.resolve({ done: true, value: undefined });
        return reader.read().then(({ done, value }) => {
          if (done) release();
          return { done, value };
        });
      },
      return: async (value?: unknown) => {
        if (!released) {
          try {
            await reader.cancel();
          } finally {
            release();
          }
        }
        return { done: true, value };
      },
      throw: async (error?: unknown) => {
        if (!released) {
          try {
            await reader.cancel(error);
          } catch {
            // The consumer's own error is the one to see; a cancel that
            // fails (the stream is already closed) must not replace it.
          } finally {
            release();
          }
        }
        throw error;
      },
      [Symbol.asyncIterator]() {
        return this;
      },
    };
  };
}

async function extractPdf(file: File): Promise<{ text: string; pages: number }> {
  ensureStreamAsyncIterator();
  if (!workerSet) {
    // pdf.js mints a blob: worker when the page's URL has an opaque origin —
    // every tauri:// page does, so it wraps the real worker and the CSP
    // refuses the blob. A Worker handed over as the port skips that decision.
    try {
      pdfjsLib.GlobalWorkerOptions.workerPort = new Worker(workerUrl, { type: "module" });
    } catch {
      throw new AttachmentError(
        "unreadable",
        `“${file.name}” could not be read. The file may be damaged or protected.`,
        {},
        "pdf_worker",
      );
    }
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
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    const legacy = LEGACY_OFFICE[ext];
    if (legacy) {
      // The honest refusal: name the era and the way out, rather than
      // letting it fall into "not a readable kind", which says nothing
      // the owner can act on.
      throw new AttachmentError(
        "unsupported",
        `“${file.name}” is in ${legacy.app}’s older format (before 2007). Saving it as .${legacy.modern} and attaching that copy works.`,
        { app: legacy.app },
      );
    }
    throw new AttachmentError(
      "unsupported",
      `“${file.name}” is not a readable kind. Text, markdown, CSV, PDF, Word and PowerPoint files work.`,
    );
  }
  if (file.size > MAX_FILE_BYTES) {
    throw new AttachmentError(
      "too-big",
      `“${file.name}” is too large to read in the browser (${Math.round(file.size / 1048576)} MB).`,
    );
  }
  // Before the parsers: pdf.js calls a zero-byte PDF an invalid one and the
  // zip readers find no entry, but no bytes is no bytes, whatever the type.
  if (file.size === 0) {
    throw new AttachmentError("empty", `“${file.name}” is empty.`);
  }
  let text: string;
  let pages: number | undefined;
  try {
    switch (kind) {
      case "txt":
      case "md":
      case "csv":
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
  } catch (error) {
    // A nested AttachmentError already names its own reason (pdf_worker, for
    // one): re-deriving it from its class name would log pdf_attachmenterror.
    if (error instanceof AttachmentError) throw error;
    throw new AttachmentError(
      "unreadable",
      `“${file.name}” could not be read. The file may be damaged or protected.`,
      {},
      readReason(kind, error),
    );
  }
  text = cleanText(text);
  if (!text) {
    throw new AttachmentError(
      "no-text",
      `“${file.name}” holds no readable text (a scan without a text layer).`,
    );
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
    // The way in is per-turn: the document rides the message it was sent
    // with, and the owner's pin is what makes it ride every message.
    pinned: false,
  };
}

/**
 * The fixed prompt that heads every request's one system message. Fixed on
 * purpose: the engine caches the prompt's prefix, so a byte that moves between
 * turns (a date, a model name, a count) would re-prefill the conversation. It
 * answers the questions a model left to guess gets wrong — what it can
 * receive, what it may claim, and what the app around it offers — and it is
 * the same words in every language: the wire language is English whatever the
 * interface speaks. Fixed PER MODEL on two axes: the vision sentence follows
 * `/props`, and the Think sentence follows the chat template's own switch (the
 * sentence is sent only where the button is drawn). A model's capabilities
 * change only when the model does, which restarts the engine and its cache.
 *
 * A phone's turn is the third axis, and the only one that is per surface: the
 * phone is offered no mini app and draws none, so the two sentences about
 * them would name a tool the model cannot call. Every other turn sends the
 * bytes below unchanged.
 *
 * **The browse sentence is not an axis.** Whether the turn is armed for the
 * browser or not is the tool list's business, and the prompt says the same
 * thing in both: a prompt that changed with the turn would move the whole
 * prefix of the conversation and throw the engine's cache away for the sake of
 * a word the model can read once.
 */
/**
 * The control's name, in the two words the people who use it know it by.
 *
 * **Both are literals, and both are written here.** The prompt's bytes must
 * not move between turns — the engine caches the prefix, so a byte that
 * changed would prefill the whole conversation again — and the Italian alias
 * is therefore a constant and not a lookup of the interface's language: the
 * model is told both names in every language, and it names the chip the way
 * the person sees it on their own screen.
 */
const BROWSE_NAME_EN = "Browse for me";
const BROWSE_NAME_IT = "Naviga per me";
/** How the prompt says the control: the English name, the Italian one beside it. */
const BROWSE_NAME = `${BROWSE_NAME_EN} (${BROWSE_NAME_IT})`;

function promptBytes(vision: boolean, think: boolean, phone: boolean): string {
  return (
    "You are Kalsa, a private assistant running on this computer. " +
    "You can write, explain, translate, summarise and answer from your own knowledge; that needs no tool. " +
    (vision
      ? "Images the user attaches reach you as images. You cannot see audio or video. "
      : "You cannot see images, audio or video. ") +
    "Attached files reach you as plain text in a message; if no text is there, " +
    "no file reached you. " +
    "Use a tool only when a task needs one, and only the tools you are given. " +
    "A greeting, a thank-you or a short acknowledgement such as \"ok\" is answered in words, with no tool. " +
    (phone
      ? ""
      : "Use create_miniapp only when the person asks for a comparison table, calculator, quiz or checklist. ") +
    "Reply in the language the user writes in. " +
    "The app around you: " +
    (think
      ? "A Think button sits in the message box: when it is off you answer at once, without reasoning first; when it is on, any reasoning you do is folded above your answer for the person to open. "
      : "") +
    "A paperclip in the message box attaches files. " +
    (phone ? "" : "Miniapps (a table, calculator, quiz or checklist) open inline in the chat. ") +
    // **The browse control, said once and the same way in every turn.** The
    // sentence is constant on purpose: the engine caches the prompt's prefix,
    // and a byte that moved between an armed turn and an ordinary one would
    // prefill the whole conversation again. It says what the control is, what
    // an armed turn means, what to do when a task needs the browser and the
    // browser's tools are not there, and that a search is not a page.
    //
    // **The control is named twice, in both of the names it goes by**: the
    // English one and the Italian alias beside it, so no part of the prompt
    // calls it by one language only. Both are the constants above — literal
    // bytes, not a per-language choice — so the sentence is still one fixed
    // string for every turn, armed or not, and it is left out of the phone's
    // prompt whole.
    (phone
      ? ""
      : `A ${BROWSE_NAME} control sits in the message box: when the person turns it on, that turn is a browser turn and the browser tools drive the real browser for them. If a task needs the browser and you are given no browser tools, say so and ask the person to turn on ${BROWSE_NAME}. A web search is not the same as opening the page the person asked for. `) +
    "Phones paired to this computer can get answers from you too. " +
    "The Room is a group chat on this computer where people call you by writing @Kalsa or with the button in the message box that asks you. " +
    "You cannot press these buttons yourself; tell the person which one to use."
  );
}

/** The prompt for the model now being served. */
export function systemPrompt(vision: boolean, think: boolean, phone = false): WireMessage {
  return { role: "system", content: promptBytes(vision, think, phone) };
}

/** What the wire spends on a conversation: the stored messages plus the fixed
    system prompt — the whole of it that is not documents. */
export function wireTokens(messages: ChatMessage[], vision = false, think = false, phone = false): number {
  return historyTokens(messages) + estTokens(promptBytes(vision, think, phone));
}

/**
 * What a built wire spends, for the tool loop's own fit check between rounds.
 * The same estimator as the stored shapes (`estTokens`), read back at the
 * shapes `buildPinnedContext` produced: a picture part costs IMAGE_TOKENS
 * whatever its data URI's length, and a tool call's arguments count where they
 * ride.
 *
 * **The cost of the estimate, said plainly.** The arithmetic is constant per
 * message — a length, a division, a sum. The estimate is not: it reads the
 * whole wire, every message and every character of it, each time it is asked.
 * So one fit check costs the size of the conversation, not the size of the
 * window, and it is asked once per round. That is the price of knowing the
 * wire's size without asking the engine for it.
 */
export function wireSize(messages: WireMessage[]): number {
  return messages.reduce((sum, message) => sum + wireMessageTokens(message), 0);
}

function wireMessageTokens(message: WireMessage): number {
  let tokens = 0;
  if (typeof message.content === "string") {
    tokens += estTokens(message.content);
  } else {
    for (const part of message.content) {
      tokens += part.type === "image_url" ? IMAGE_TOKENS : estTokens(part.text);
    }
  }
  for (const call of message.tool_calls ?? []) tokens += estTokens(call.function.arguments);
  return tokens;
}

/** One document's section, the same line wherever a document rides: name,
    kind, pages, measured weight, then the text itself. */
function docSection(d: Attachment): string {
  return `--- ${d.name} (${d.kind}${d.pages !== undefined ? `, ${d.pages} pages` : ""}, ≈${d.tokens} tokens) ---\n${d.text}`;
}

/** The line the pinned documents' block begins with inside the system
    message, exported so a reader can take the documents' text alone, never
    the fixed prompt above it. */
export const PINNED_DOCS_MARK = "Attached documents (pinned — they stay even as older turns are dropped):";

/** The pinned-documents text, for the tail of the one system message: the
    block, then one section per document. */
function docBlockText(docs: Attachment[]): string {
  return `${PINNED_DOCS_MARK}\n\n${docs.map(docSection).join("\n\n")}`;
}

/** The documents a user turn bound to itself, as the block that rides before
    that turn's words. Empty string for none — the message renders as it
    always has. */
export function turnDocBlock(docs: Attachment[]): string {
  if (docs.length === 0) return "";
  return `Attached documents:\n\n${docs.map(docSection).join("\n\n")}`;
}

/**
 * The wire's ONE system message: the fixed prompt, and — when documents are
 * pinned — their block appended to the same content after a blank line. One
 * message, not two: several chat templates render a system message only at
 * index 0 (the Gemma family notably), so a second one can be dropped or
 * misplaced. The prompt's bytes are the content's prefix, which is the prefix
 * the engine's cache holds onto; the documents' own weight is the fit's
 * `docTokens`, so nothing is counted twice.
 */
function systemMessage(docs: Attachment[], vision: boolean, think: boolean, phone: boolean): WireMessage {
  const prompt = systemPrompt(vision, think, phone);
  if (docs.length === 0) return prompt;
  return { role: "system", content: `${prompt.content}\n\n${docBlockText(docs)}` };
}

/**
 * One stored message as the wire sees it. A message that used tools becomes the
 * ordinary three-part turn — the assistant asking, the tool answering, the
 * assistant's own words — because that is the shape the model was trained on
 * and the shape it expects to see again. The transcript itself holds no `tool`
 * role: this is the only place the roles are invented.
 */
/** What the wire carries for a stored run's result: the stopped code becomes
    the English sentence the model reads, anything else goes as it is. */
function wireResult(result: string): string {
  return result === TOOL_STOPPED ? "Stopped before this finished." : result;
}

/** The replayed result of a mini app run gains its current state as plain
    lines, so the next turn reads where the person left the widgets — the
    ticks, the picked answer, the edited values. No state, no lines: the
    short result text goes alone, as it always has. */
function wireResultFor(run: ToolRun): string {
  const lines = run.miniapp ? miniappStateLines(run.miniapp) : [];
  // The card keeps the owner's sentence for an unreadable argument list; the
  // model was answered with the English guide when the call ran, and the
  // replay sends that same guide — for a tool this build no longer knows,
  // the generic English sentence stands in.
  const unreadable = run.state === "failed" && isMalformedArguments(run.arguments, storedAsCut(run.arguments));
  const text = unreadable ? notValidGuide(run.name) : wireResult(run.result);
  return lines.length > 0 ? `${text}\n${lines.join("\n")}` : text;
}

/** The guide for a stored call whose arguments never parsed: the tool's own
    when its definition is still known, else the one sentence every tool shares. */
function notValidGuide(name: string): string {
  const tool = TOOL_DEFINITIONS.find((t) => t.function.name === name);
  return tool ? guideNotValidJson(tool) : NOT_VALID_FOR_MODEL;
}

/**
 * How the model now being served sees this turn: `vision` says whether it can
 * look at all, and `url` hands back the data URI of a stored image — null
 * when its bytes are gone. Absent (harnesses, attach trials) is the same as
 * a model without eyes. `think` says whether the chat template offers the
 * Think switch, which is what the prompt may describe; absent is no switch.
 * `phone` says the turn is a paired phone's, which is the one app around the
 * model that draws no mini app; absent is this computer.
 */
export interface MediaView {
  vision: boolean;
  think?: boolean;
  phone?: boolean;
  url: (id: string) => string | null;
}

/** A user turn's content on the wire, its bound documents' block first. 
    Pictures ride as parts, text first after the block; a video rides as its
    MARKER line and its frames' image parts — the engine never gets video,
    and a seeing model reads a video exactly as the stills plus one honest
    line saying what they are. For a model that cannot see, media of either
    kind become one sentence in the text: the engine errors on image parts
    without a projector. A picture the wire budget demoted, or whose bytes
    are gone, becomes that same sentence per picture; a demoted FRAME simply
    does not ride — the marker already told the model the video has more of
    them than this. */
function userWireContent(
  message: ChatMessage,
  media: MediaView | undefined,
  docs: Attachment[],
): string | WireContentPart[] {
  const images = message.role === "user" ? (message.images ?? []) : [];
  const videos = message.role === "user" ? (message.videos ?? []) : [];
  // The block sits before the words: the model reads what was attached, then
  // what was asked about it.
  // The model's own note for this turn rides first, and only on the wire.
  const note =
    message.role === "user"
      ? [message.mailNote, message.browserNote].filter(Boolean).join("\n")
      : "";
  const block = note && docs.length > 0 ? `${note}\n\n${turnDocBlock(docs)}` : note ? note : turnDocBlock(docs);
  // The date a turn was sent rides after its words, as it was stored.
  const said =
    message.role === "user" && message.sentOn
      ? [message.content, sentLine(message.sentOn)].filter(Boolean).join("\n\n")
      : message.content;
  const words = block ? `${block}\n\n${said}` : said;
  if (images.length === 0 && videos.length === 0) return words;
  if (!media?.vision) {
    return words ? `${words}\n${IMAGE_PLACEHOLDER}` : IMAGE_PLACEHOLDER;
  }
  const parts: WireContentPart[] = [];
  const lines: string[] = [];
  const dropped: string[] = [];
  for (const image of images) {
    const url = media.url(image.id);
    if (url !== null) parts.push({ type: "image_url", image_url: { url } });
    else dropped.push(IMAGE_PLACEHOLDER);
  }
  for (const video of videos) {
    lines.push(videoMarker(video.durationMs, video.frames.length));
    for (const frame of video.frames) {
      const url = media.url(frame.id);
      if (url !== null) parts.push({ type: "image_url", image_url: { url } });
    }
  }
  const text = [words, ...dropped, ...lines].filter(Boolean).join("\n");
  if (parts.length === 0) return text;
  return [...(text ? [{ type: "text", text } as const] : []), ...parts];
}

function wireFor(
  message: ChatMessage,
  media: MediaView | undefined,
  docsById: Map<string, Attachment>,
): WireMessage[] {
  // A refused run never happened as far as the server is concerned: it was
  // never sent back as a call, and an unnamed one would be a malformed request.
  // It stays in the transcript for the reader and out of the wire.
  const runs = (message.toolRuns ?? []).filter((run) => run.state !== "refused");
  if (message.role !== "assistant" || runs.length === 0) {
    // The ids a user turn bound resolve here, not at render time elsewhere:
    // a document the store no longer holds rides as nothing rather than as
    // a name with no text behind it.
    const docs = (message.docs ?? [])
      .map((id) => docsById.get(id))
      .filter((d): d is Attachment => d !== undefined);
    return [{ role: message.role, content: userWireContent(message, media, docs) }];
  }
  const asked: WireMessage = {
    role: "assistant",
    content: "",
    tool_calls: runs.map((run) => ({
      id: run.id,
      type: "function" as const,
      function: { name: run.name, arguments: wireArguments(run.arguments, storedAsCut(run.arguments)) },
    })),
  };
  const answered: WireMessage[] = runs.map((run) => ({
    role: "tool",
    // The wire language is English whatever the interface speaks: the code
    // is for storage and the screen, the model gets the sentence.
    content: wireResultFor(run),
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
 * Assemble what is actually sent: the one system message first — the fixed
 * prompt with the pinned documents appended to it when any are active — then
 * whole turns newest-kept, oldest turns dropping first when the known context
 * fills. The cut never leaves an assistant at the front of the kept history:
 * an assistant whose user was dropped is refused by templates that require
 * user/assistant alternation (see the walk below). With unknown size nothing
 * is pruned or refused. `media` decides how stored pictures ride (parts under
 * a seeing model, the placeholder sentence otherwise); `pendingImageTokens` is
 * the weight of pictures attached but not yet sent — the fit answers for them
 * before the send does.
 *
 * **The tool definitions travel with the request, so the fit weighs them.**
 * They are the offer this request makes — the exact definitions
 * `offeredTools(...)` returned, not an estimate of them — and the engine
 * counts them into the prompt it reads. A fit that leaves them out sends a
 * request the engine refuses: the body goes out over the context and comes
 * back a 400, before there is any measurement of the engine's own to go by.
 * The five browser tools alone are 2755 characters of JSON: about 689 tokens
 * by the house rule, 1566 by the engine's count.
 *
 * **The answer's reserve stays its own term.** `ANSWER_RESERVE_TOKENS` is
 * the room the answer has to write in; it is not a share of the wire's room
 * and it is not what the definitions borrow. The wire gets what is left, and
 * the definitions are weighed inside that.
 */
export function buildPinnedContext(
  messages: ChatMessage[],
  docs: Attachment[],
  nctx: number | null,
  media?: MediaView,
  pendingImageTokens = 0,
  pendingDocTokens = 0,
  /** The definitions this request will offer. The exact offer, so the fit
      weighs the same bytes the server will read. Absent means the request
      offers no tools and carries no definitions. */
  tools: ToolDefinition[] = [],
): PinnedContext {
  // The system message carries the pinned alone; a per-turn document rides
  // its own message (`wireFor` below) and weighs as history. `docs` is the
  // conversation's whole store of attachments — active and history both —
  // because the ids a message bound resolve against it.
  const pinned = docs.filter((d) => d.active && (d.pinned ?? true));
  const byId = new Map(docs.map((d) => [d.id, d]));
  const docTokens = pinned.reduce((sum, d) => sum + d.tokens, 0);
  // What the offer weighs beside the conversation, counted the pessimistic
  // way: the definitions are prose in a JSON envelope, and the engine counts
  // them denser than the prose of a conversation.
  const toolTokens = definitionsTokens(tools);
  const turns = [...messages];
  let histTokens = wireTokens(turns, media?.vision ?? false, media?.think ?? false, media?.phone ?? false);
  let dropped = 0;
  const shedOne = (): void => {
    const shed = turns.shift();
    if (shed) {
      histTokens -= messageTokens(shed);
      dropped++;
    }
  };
  if (nctx !== null) {
    while (
      docTokens + pendingDocTokens + pendingImageTokens + histTokens + toolTokens + ANSWER_RESERVE_TOKENS > nctx &&
      turns.length > 1
    ) {
      shedOne();
      // Whole turns, not single messages: the kept history must start at a
      // `user` message. An assistant left at the front has lost the user it
      // answers, and a template that requires user/assistant alternation
      // (Gemma's family: "Conversation roles must alternate") refuses that
      // wire with its own 400 — the one this fit exists to prevent.
      while (turns.length > 1 && turns[0]?.role !== "user") shedOne();
    }
    const need =
      docTokens + pendingDocTokens + pendingImageTokens + histTokens + toolTokens + ANSWER_RESERVE_TOKENS;
    if (need > nctx) {
      return { status: "refused", need, have: nctx, docTokens, historyTokens: histTokens };
    }
  }
  const wire = turns.flatMap((message) => wireFor(message, media, byId));
  wire.unshift(systemMessage(pinned, media?.vision ?? false, media?.think ?? false, media?.phone ?? false));
  return { status: "ok", wire, dropped, docTokens, historyTokens: histTokens };
}
