import { SAMPLING_KNOBS } from "./knobs/sampling";
import { parseContextSize } from "./contextSize";
import type { Sampling } from "./sampling";
import type { ToolDefinition } from "./tools/definitions";
import type { ToolRun } from "./types";

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

export interface WireMessage {
  role: string;
  content: string;
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
      is passed on so the call can be stopped where it is running. */
  runTool?: (
    name: string,
    args: Record<string, unknown>,
    signal: AbortSignal,
  ) => Promise<ToolOutcome>;
  /** Called when a call starts and again when it answers, so the thread can
      say what is happening while it happens. */
  onToolRun?: (run: ToolRun) => void;
  /** The reader's thinking choice for this model: `false` asks the model's own
      template not to think. `undefined` leaves it to the template. */
  thinking?: boolean;
}

/** What a tool answered, and whether that answer is a result or a refusal. */
export interface ToolOutcome {
  text: string;
  ok: boolean;
}

/** No new words for this long means the server is gone, not slow. */
export const IDLE_TIMEOUT_MS = 60_000;

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
  | { kind: "refused"; message: string };

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
    const message = (await response.text()).trim();
    if (response.status === 501) return { kind: "no-tier", message: message || DOOR_SILENT };
    return { kind: "refused", message: message || DOOR_SILENT };
  } catch {
    // The door never answered. The chat's own requests say the server is
    // unreachable; this one says what that leaves behind for the slot.
    return { kind: "refused", message: DOOR_SILENT };
  }
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
    if (!response.ok) return { values: defaults, status: "refused", chatTemplate: "" };
    const data: unknown = await response.json();
    if (typeof data !== "object" || data === null) return { values: defaults, status: "invalid", chatTemplate: "" };
    const template = (data as { chat_template?: unknown }).chat_template;
    const chatTemplate = typeof template === "string" ? template : "";
    const settings = (data as { default_generation_settings?: unknown }).default_generation_settings;
    if (typeof settings !== "object" || settings === null) {
      return { values: defaults, status: "invalid", chatTemplate };
    }
    const params = (settings as { params?: unknown }).params;
    if (typeof params !== "object" || params === null) {
      return { values: defaults, status: "invalid", chatTemplate };
    }
    const values = params as Record<string, unknown>;
    for (const { wire } of SAMPLING_KNOBS) {
      const value = values[wire];
      defaults[wire] = typeof value === "number" && Number.isFinite(value) ? value : null;
    }
    return { values: defaults, status: "reported", chatTemplate };
  } catch {
    return { values: defaults, status: "unavailable", chatTemplate: "" };
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
  if (tools.length === 0) return { ...sampling, model, messages, stream: true, ...kwargs };
  return { ...sampling, model, messages, stream: true, tools, tool_choice: toolChoice, ...kwargs };
}
