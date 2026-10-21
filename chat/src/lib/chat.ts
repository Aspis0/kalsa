import { SAMPLING_KNOBS } from "./knobs/sampling";
import { parseContextSize } from "./contextSize";
import { parseModalities, NO_MODALITIES } from "./modalities";
import type { Modalities } from "./modalities";
import { logUiEvent } from "./uiLog";
import type { Sampling } from "./sampling";
import type { ToolDefinition } from "./tools/definitions";
import type { ToolRun } from "./types";
import type { Miniapp } from "./miniapp/types";
import type { Mail } from "./mail/types";

/**
 * Minimal OpenAI-compatible client: what a request is, and what the server
 * says about itself. Fetch + SSE only, no dependencies — the streaming and the
 * tool rounds are in `streamRound.ts` and `toolLoop.ts`, which build on this.
 *
 * Honesty rules: every failure carries the URL that was actually called;
 * a stream that ends without [DONE] is reported (truncated vs empty), never
 * announced as complete; a reply that is not a stream is read as a plain
 * JSON completion before giving up.
 */

export type ChatErrorKind =
  | "network"
  | "unauthorized"
  | "http"
  | "bad-response"
  | "truncated"
  | "timeout"
  | "oversize"
  | "aborted";

export class ChatRequestError extends Error {
  kind: ChatErrorKind;
  status?: number;
  url?: string;

  constructor(kind: ChatErrorKind, message: string, status?: number, url?: string) {
    super(message);
    this.name = "ChatRequestError";
    this.kind = kind;
    this.status = status;
    this.url = url;
  }
}

/**
 * One content part of a multipart message: a user turn with pictures goes as
 * text parts and image parts, the OpenAI-compatible shape the engine's
 * multimodal path reads. Only `data:` URIs ride in `url` — the engine reads
 * nothing but the bytes in the request. Audio joins as another part kind
 * later, without rework.
 */
export type WireContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export interface WireMessage {
  role: string;
  /** A plain string for every turn without media — byte-identical to what
      the app has always sent; parts only where pictures ride along. */
  content: string | WireContentPart[];
  /** Present on the assistant message that asked for tools. */
  tool_calls?: WireToolCall[];
  /** Present on a `tool` message: the call whose result this carries. */
  tool_call_id?: string;
}

/** The shape every server sends tool calls in, over the wire and in deltas. */
export interface WireToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface StreamOptions {
  endpoint: string;
  token: string;
  model: string;
  messages: WireMessage[];
  sampling: Record<string, number>;
  signal: AbortSignal;
  onToken: (text: string) => void;
  /** Reasoning tokens. A separate buffer, never concatenated with content. */
  onReasoning: (text: string) => void;
  /** The tools to offer. Empty (the default) means no tool round ever runs. */
  tools?: ToolDefinition[];
  /** Runs one call and answers with the text the model reads, and whether it
      worked. Injected so this module owns no door to the desktop; the signal
      is passed on so the call can be stopped where it is running, and the
      conversation so the web_fetch provenance rule reads what the model
      reads. */
  runTool?: (
    name: string,
    args: Record<string, unknown>,
    signal: AbortSignal,
    conversation: WireMessage[],
  ) => Promise<ToolOutcome>;
  /** Called when a call starts and again when it answers, so the thread can
      say what is happening while it happens. */
  onToolRun?: (run: ToolRun) => void;
  /** Takes the reasoning of a refused round out of the row before it is asked
      again without tools. The refused answer text is never shown. */
  onWithdraw?: (reasoning: string) => void;
  /** This wire cannot take reasoning back, so the first round's is held and
      sent only once that round stands, reasoning before its answer. For the
      phone, whose frames are one way; a chat that can withdraw it says nothing
      and keeps streaming. */
  holdReasoning?: boolean;
  /** This request is a paired phone's turn, run by this window on the phone's
      behalf. It changes what the log may say about the round — the tools a
      phone calls are the desktop's, so without this a phone's mail call and
      the owner's own are one undifferentiated line. */
  phone?: boolean;
  /** This turn is a browser turn: the person armed the "Browse for me" control
      and the request was built with the browser's tools and nothing else. It
      changes one sentence — the one a call to a tool this request never
      offered is answered with — and nothing else. */
  browse?: boolean;
  /** The reader's thinking choice for this model: `false` asks the model's own
      template not to think. `undefined` leaves it to the template. */
  thinking?: boolean;
  /** The window's own room, when it is known: the token budget the wire may
      spend and the estimator that measures it (`attachments.ts` → `wireSize`
      in the app). The tool loop re-checks its growing conversation against
      both before each follow-up round; `null` or absent means unknown, and
      nothing is pruned. Injected, not imported, because the estimator lives
      beside the attachment code the tool loop has no business pulling in —
      the same reason `runTool` is a parameter.
      *
      * **The check is not free, and the cost is here rather than implied.**
      * The arithmetic is constant; the estimate is not: it reads the whole
      * wire — every message, every character — once per round. The cost of a
      * round's check is therefore the size of the conversation, not the size
      * of the window, and the rounds are bounded by the call budget. Nothing
      * is fetched and nothing is measured to get the number: it is this
      * app's own estimate of the wire it is about to send.
      *
      * `definitions` is what the tool definitions of this request weigh, in
      * tokens. They travel with every request and the engine counts them
      * into the prompt, so a fit that leaves them out sends a request the
      * engine refuses (a 400) before there is any measurement to go by. The
      * caller that fitted the first wire is the one that knows the number;
      * absent, the tool loop weighs the definitions it sends itself. */
  contextFit?: {
    budget: number;
    size: (messages: WireMessage[]) => number;
    definitions?: number;
  } | null;
  /** The turn was closed for space: the next request would not have fit the
      window, so the turn answered from what it had and stopped reading. The
      caller says so on the turn, in a line of its own language — the person
      has to know the answer is what the turn found before it stopped, and
      not a complete search. Absent means the caller has no line to show. */
  onClosedForSpace?: () => void;
  /** The sentences a tool round can end in, in the owner's language. They are
      shown on the call's card and sent back as its answer, except that an
      unreadable argument list is answered to the model in English. Absent
      means English. */
  toolPhrases?: ToolPhrases;
}

/** The tool round's own words, threaded from the caller's language table. */
export interface ToolPhrases {
  noRoundLeft: string;
  turnEnded: string;
  nameNeverArrived: string;
  stopped: string;
  argumentsTooLong: string;
  argumentsNotValid: string;
  /** The answer a call gets when this request never offered its tool. */
  notOffered: string;
  /** The answer a call gets when this request never offered its tool **and the
      turn is a browser turn**: the person armed the browser for this message,
      and the model is told so in as many words. */
  notOfferedBrowser: string;
}

/** What a tool answered, and whether that answer is a result or a refusal.
    `resultCode` is the Rust refusal's code for the screen; `text` stays the
    English the model reads. `miniapp` is a locally built envelope the thread
    renders — it rides the transcript, never the wire. */
/**
 * A picture a tool brought back.
 *
 * **The bytes never go inside `text`.** They ride the tool message as their
 * own part, and the record keeps a line in words instead: a picture inside a
 * sentence is a picture in every later turn's replay and in the storage
 * behind it.
 */
export interface ToolImage {
  /** The bytes, base64, with no prefix. */
  data: string;
  /** The media type of those bytes. */
  mediaType: string;
  /** The text that goes beside the picture on the wire. */
  text: string;
}

export interface ToolOutcome {
  text: string;
  ok: boolean;
  resultCode?: string;
  /** The sidecar's stage, when the call was refused and it named one: **where
   *  the call stopped.** It is internal — it decides whether a retry is worth
   *  anything, and it is neither the code the page reads nor the sentence the
   *  model reads. */
  stage?: string;
  miniapp?: Miniapp;
  /** Cards or a draft this call drew. The wire only ever carries `text`. */
  mail?: Mail;
  /** Pages this call read on the model's behalf — a search's own results, the
      ones the model was asked about but did not ask to open. For the screen;
      the wire carries them inside `text`. */
  pagesRead?: number;
  /** A picture this call brought. **Its bytes are never inside `text`**: the
      model reads them as their own part, and the record keeps the line. */
  image?: ToolImage;
}

/** No new words for this long means the server is gone, not slow. */
export const IDLE_TIMEOUT_MS = 60_000;

/**
 * The silence allowed BEFORE the server has said anything at all — before its
 * response head.
 *
 * A request that reaches a sleeping engine (`--sleep-idle-seconds`) waits
 * through a whole model load first, and the door relays nothing during it: no
 * head, no prefill, no byte. Measured on this Mac, that load has taken 1.6 s
 * to 32.3 s (kalsa-engine.log), and a bigger model or a slower disk takes
 * longer. The ordinary bound counted that silence as "gone" and ended the
 * turn at 60 s, throwing away a complete answer the door had already delivered
 * in full (incident of 2026-10-17: a 10.09 s load, a 72,880-byte answer, and
 * the phone told its owner the computer was not answering).
 *
 * Loading is not silence that means gone: the engine is provably working on
 * the request. So the wait for the FIRST byte gets its own, larger bound —
 * about 3.7x the worst load measured here (32.3 s), and spent only until the
 * head arrives. From the head on this is the ordinary bound again
 * (`streamRound.ts`), so a server that accepts a request, opens the stream and
 * then stalls is still given up on promptly.
 */
export const LOADING_TIMEOUT_MS = 120_000;

declare global {
  interface Window {
    /** A test's own bounds for the two waits, so a case about a slow engine
        does not have to sit through a real one. Set before the page loads.
        Read ONLY in a development build — see `roundTimings`. */
    __kalsaTimings__?: { idleMs?: number; loadingMs?: number };
  }
}

/** The narrowest and widest bound a test may ask for. A shorter one lets a
    case run in seconds; a longer one must never buy a day-long timer. */
const TIMING_FLOOR_MS = 250;
const TIMING_CEILING_MS = 600_000;

/**
 * The two waits, as this page runs them.
 *
 * The override exists so a case can exercise a slow engine without waiting
 * for one, so it is read ONLY when this is a development build: a shipped
 * bundle folds `import.meta.env.DEV` to `false`, so no page script can reach
 * a turn's timeouts in a Kalsa anyone is running. Even where it is read, the
 * value is clamped and anything unusable falls back to the real constant, so a
 * mistyped override degrades to production behaviour rather than to a dead or
 * unbounded timer.
 */
export function roundTimings(): { idleMs: number; loadingMs: number } {
  if (!import.meta.env.DEV) {
    return { idleMs: IDLE_TIMEOUT_MS, loadingMs: LOADING_TIMEOUT_MS };
  }
  const over = typeof window === "undefined" ? undefined : window.__kalsaTimings__;
  return {
    idleMs: clamp(over?.idleMs, IDLE_TIMEOUT_MS),
    loadingMs: clamp(over?.loadingMs, LOADING_TIMEOUT_MS),
  };
}

function clamp(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(TIMING_CEILING_MS, Math.max(TIMING_FLOOR_MS, value));
}

/** Before any batch of a prompt has been timed there is nothing to derive a
    gap from, so the first one gets this many times the ordinary bound. */
const PREFILL_FIRST_GAP_FACTOR = 5;

/** A batch is expected to take about as long as the last one; this many times
    that is where it has stopped instead of being slow. */
const PREFILL_SAFETY = 3;

/**
 * The ceiling on ONE gap between prefill reports, however slow the batch
 * behind it was. Without it a single 12-hour batch would hand the next wait a
 * 36-hour timer, and a turn that would have ended in minutes would sit for
 * days. Five minutes is far above the slowest batch measured on this Mac — the
 * largest prompt this door has timed was 1,281 tokens at 1,517 ms, and the
 * longest single `time_ms` gap in the engine's own reports is seconds — while
 * still bounding a report that never comes again to something a person waits
 * out rather than walks away from.
 */
export const PREFILL_GAP_CAP_MS = 300_000;

/**
 * Follows one request's prefill reports (`prompt_progress`: `total` tokens in
 * the prompt, `processed` so far, `time_ms` since it began) and says how long
 * the next report may take. The pace is the engine's own: a few times the
 * last batch's duration, the difference of two `time_ms`, so a slow machine
 * with a large batch gets the minutes its batch needs and a fast one keeps the
 * ordinary bound, whatever the batch size the owner chose. Never below the
 * ordinary bound. The first report has no batch behind it and gets a generous
 * guess; a fully read prompt, or a report that cannot be read, is back to the
 * ordinary bound.
 *
 * The ordinary bound is read from `roundTimings`, the same place the reader's
 * own timers come from: a prefill wait derived from a different number would
 * quietly disagree with the timer it is feeding.
 */
export function createPrefillWatch(): { report: (progress: unknown) => number } {
  const { idleMs } = roundTimings();
  let lastTimeMs: number | null = null;
  return {
    report(progress) {
      if (typeof progress !== "object" || progress === null) return idleMs;
      const { total, processed, time_ms: timeMs } = progress as Record<string, unknown>;
      if (!isFiniteNumber(total) || !isFiniteNumber(processed) || !isFiniteNumber(timeMs)) {
        return idleMs;
      }
      const previous = lastTimeMs;
      lastTimeMs = timeMs;
      if (processed >= total) return idleMs;
      const firstGap = Math.min(PREFILL_GAP_CAP_MS, idleMs * PREFILL_FIRST_GAP_FACTOR);
      const gap = previous === null ? 0 : timeMs - previous;
      if (!(gap > 0)) return firstGap;
      const allowed = gap * PREFILL_SAFETY;
      if (!Number.isFinite(allowed)) return firstGap;
      return Math.min(PREFILL_GAP_CAP_MS, Math.max(idleMs, allowed));
    },
  };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * The server root behind any endpoint shape: full chat URLs and /v1 bases
 * collapse back to the host root, where companion routes (like /props)
 * live. Unknown paths pass through untouched.
 */
export function serverBase(endpoint: string): string {
  const base = endpoint.trim().replace(/\/+$/, "");
  return base
    .replace(/\/v1\/chat\/completions$/, "")
    .replace(/\/chat\/completions$/, "")
    .replace(/\/v1$/, "");
}

/**
 * Ask the server for its real context size: a GET `/props`, and the reply
 * parsed by `parseContextSize` (`contextSize.ts`) — the ONE path
 * `default_generation_settings.n_ctx`, with the four decoys named there.
 * Anything missing, non-numeric or unreachable means UNKNOWN —
 * never an invented limit.
 *
 * The token is required: /props is a request like any other at the door, and
 * an unauthenticated one gets the 401 the door gives strangers. An empty
 * string sends no Authorization header at all.
 */
export async function fetchContextSize(
  base: string,
  timeoutMs = 8000,
  token = "",
): Promise<number | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const cleanToken = token.trim();
    const response = await fetch(`${base}/props`, {
      signal: controller.signal,
      ...(cleanToken ? { headers: { Authorization: `Bearer ${cleanToken}` } } : {}),
    });
    if (!response.ok) return null;
    const data: unknown = await response.json();
    return parseContextSize(data);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * What the door answered about a chat's slot. Three answers, and the app must
 * not flatten them into two:
 * - `ok` — the slot took the chat (204);
 * - `no-tier` — this door was built without the disk tier (501), and it says
 *   which half is missing. The chat opens exactly as it did before the tier;
 *   a pinned development model has no catalog identity, and that is a
 *   configuration the app serves, not a fault;
 * - `refused` — the door refused, or nothing answered, and `message` is the
 *   door's own sentence, shown as it arrived. It distinguishes what must stay
 *   distinguished: a slot the door only refuses to fill, one it repaired, and
 *   one whose state is **unknown**. Unknown is never "empty".
 */
export type SlotAnswer =
  | { kind: "ok" }
  | { kind: "no-tier"; message: string }
  // `silent` marks the refusal whose message is this module's own DOOR_SILENT
  // rather than a sentence the door wrote, so the shell can say it in the
  // owner's language instead of quoting it.
  | { kind: "refused"; message: string; silent?: boolean };

/**
 * The one sentence the app owns. It exists for the case the door sent none:
 * a fetch that never reached it, or an answer with no body. Nothing at all is
 * known about the slot then, so the sentence says unknown — the door's own
 * word — and never empty.
 */
export const DOOR_SILENT =
  "The door did not answer, so the state of this device's slot is unknown.";

/**
 * One of the door's two slot routes, on the door's own port, with the
 * credential this window holds as a device of that door.
 *
 * The body carries the conversation's id and nothing else: the door builds the
 * file name, because the device and the model identity are its own, and a name
 * from here would put a client's bytes in the slot's path. No timer either:
 * the door closes a connection on its own 300 s lifetime
 * (`crates/kalsa-door/src/lib.rs:93`), and a restore that follows a model
 * unload has to outlive any client patience a UI would pick.
 */
async function slotRoute(
  endpoint: string,
  token: string,
  route: "activate" | "erase",
  id: string,
): Promise<SlotAnswer> {
  const cleanToken = token.trim();
  try {
    const response = await fetch(`${serverBase(endpoint)}/kalsa/chat/${route}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(cleanToken ? { Authorization: `Bearer ${cleanToken}` } : {}),
      },
      body: JSON.stringify({ id }),
    });
    if (response.status === 204) return { kind: "ok" };
    const body = (await response.text()).trim();
    // A coded body is this door's own refusal: the code marks it as
    // app-owned, so the shell says it in the owner's language. The plain
    // text road is a legacy door or a proxy — shown as it arrived.
    if (response.status === 501) {
      logUiEvent(`chat.${route}.no_tier`);
      return { kind: "no-tier", message: body || DOOR_SILENT };
    }
    try {
      const parsed = JSON.parse(body) as { code?: unknown };
      if (parsed && typeof parsed.code === "string") {
        // The door's own code, carried through — never its sentence, which
        // is shown on screen but never handed to the log.
        logUiEvent(`chat.${route}.${doorCode(parsed.code)}`);
        return {
          kind: "refused",
          message: typeof (parsed as { text?: unknown }).text === "string"
            ? (parsed as { text: string }).text
            : DOOR_SILENT,
          silent: true,
        };
      }
    } catch {
      // Not JSON: the legacy plain-text road below.
    }
    if (!body) {
      logUiEvent(`chat.${route}.silent`);
      return { kind: "refused", message: DOOR_SILENT, silent: true };
    }
    logUiEvent(`chat.${route}.refused`);
    return { kind: "refused", message: body };
  } catch {
    // The door never answered. The chat's own requests say the server is
    // unreachable; this one says what that leaves behind for the slot.
    logUiEvent(`chat.${route}.unreachable`);
    return { kind: "refused", message: DOOR_SILENT, silent: true };
  }
}

/** A door code as one log token: the door's own dotted code is kept whole
    when it has the shape the log writes, and a body that is not a code gets
    the local word instead — a prose body never becomes a log line. */
function doorCode(code: string): string {
  return /^[a-z0-9_.]{1,64}$/.test(code) ? code : "refused";
}

/** Opens a chat on the disk tier: the door saves what is in this device's slot
    and restores the file of the chat asked for. */
export function activateChat(endpoint: string, token: string, id: string): Promise<SlotAnswer> {
  return slotRoute(endpoint, token, "activate", id);
}

/** Removes one chat: its file on disk, and the state in the slot when that slot
    holds it. */
export function eraseChat(endpoint: string, token: string, id: string): Promise<SlotAnswer> {
  return slotRoute(endpoint, token, "erase", id);
}

/** Read only the sampler defaults this build actually reports through /props. */
export type SamplingDefaultsStatus = "reported" | "unavailable" | "refused" | "invalid";

export interface SamplingDefaultsResult {
  values: Sampling;
  status: SamplingDefaultsStatus;
  /** The model's own chat template, as `/props` reports it — empty if absent.
      It says which switches the model can read (see `thinking.ts`). */
  chatTemplate: string;
  /** What the served model can receive, from the same `/props` body — all
      false unless the engine said so (see `modalities.ts`). */
  modalities: Modalities;
  /** The window the same body reports, through the ONE parse
      (`contextSize.ts` → `parseContextSize`): the chat's send-time fit reads
      this so a text-only chat knows the size without an attach ever asking.
      Anything missing or unreadable is `null` — unknown, never an invented
      limit. */
  nctx: number | null;
}

function blankSampling(): Sampling {
  return Object.fromEntries(SAMPLING_KNOBS.map(({ wire }) => [wire, null]));
}

export async function fetchSamplingDefaultsWithStatus(
  base: string,
  timeoutMs = 8000,
  token = "",
): Promise<SamplingDefaultsResult> {
  const defaults = blankSampling();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const cleanToken = token.trim();
    const response = await fetch(`${base}/props`, {
      signal: controller.signal,
      ...(cleanToken ? { headers: { Authorization: `Bearer ${cleanToken}` } } : {}),
    });
    if (!response.ok) return { values: defaults, status: "refused", chatTemplate: "", modalities: NO_MODALITIES, nctx: null };
    const data: unknown = await response.json();
    if (typeof data !== "object" || data === null) {
      return { values: defaults, status: "invalid", chatTemplate: "", modalities: NO_MODALITIES, nctx: null };
    }
    const nctx = parseContextSize(data);
    const modalities = parseModalities(data);
    const template = (data as { chat_template?: unknown }).chat_template;
    const chatTemplate = typeof template === "string" ? template : "";
    const settings = (data as { default_generation_settings?: unknown }).default_generation_settings;
    if (typeof settings !== "object" || settings === null) {
      return { values: defaults, status: "invalid", chatTemplate, modalities, nctx };
    }
    const params = (settings as { params?: unknown }).params;
    if (typeof params !== "object" || params === null) {
      return { values: defaults, status: "invalid", chatTemplate, modalities, nctx };
    }
    const values = params as Record<string, unknown>;
    for (const { wire } of SAMPLING_KNOBS) {
      const value = values[wire];
      defaults[wire] = typeof value === "number" && Number.isFinite(value) ? value : null;
    }
    return { values: defaults, status: "reported", chatTemplate, modalities, nctx };
  } catch {
    return { values: defaults, status: "unavailable", chatTemplate: "", modalities: NO_MODALITIES, nctx: null };
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchSamplingDefaults(base: string, timeoutMs = 8000, token = ""): Promise<Sampling> {
  return (await fetchSamplingDefaultsWithStatus(base, timeoutMs, token)).values;
}

/**
 * Accepts a base URL (with or without /v1), or a full /chat/completions URL.
 * Never doubles /v1: https://api.openai.com/v1 -> .../v1/chat/completions.
 */
export function completionsUrl(endpoint: string): string {
  const base = endpoint.trim().replace(/\/+$/, "");
  if (/\/chat\/completions$/.test(base)) return base;
  if (/\/v1$/.test(base)) return `${base}/chat/completions`;
  return `${base}/v1/chat/completions`;
}

/**
 * The request body. `tools` is empty for every chat that cannot run a tool
 * (and for the harnesses, which have no Rust door), and empty means the body
 * is byte for byte what it was before tools existed.
 *
 * `toolChoice` is how a tool round is closed: by the round cap a model that
 * keeps calling tools is asked to answer in words instead.
 */
export function completionBody(
  model: string,
  messages: WireMessage[],
  sampling: Record<string, number>,
  tools: ToolDefinition[] = [],
  toolChoice: "auto" | "none" = "auto",
  thinking: boolean | null = null,
): Record<string, unknown> {
  // The model's own switch, and only that one. `thinking === false` is the
  // reader having turned it off; `true` and `null` send nothing, so the
  // template keeps its default. A template that cannot read `enable_thinking`
  // is never offered the control (see `thinking.ts`), so this cannot be a field
  // the model ignores.
  const kwargs = thinking === false ? { chat_template_kwargs: { enable_thinking: false } } : {};
  // `return_progress` makes the engine report the prompt's prefill as it goes
  // (chunks with an empty delta and a `prompt_progress` object), so a long
  // prompt on a slow machine is a stream that is alive, not a silence.
  const progress = { return_progress: true };
  if (tools.length === 0) {
    return { ...sampling, model, messages, stream: true, ...progress, ...kwargs };
  }
  return {
    ...sampling,
    model,
    messages,
    stream: true,
    ...progress,
    tools,
    tool_choice: toolChoice,
    ...kwargs,
  };
}
