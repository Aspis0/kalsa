/**
 * `Message → TranscriptMessage`: the bridge from the persisted chat model to
 * the transcript band's local shape. It did not exist before this mount —
 * the only `Transcript` consumer until now was the preview fixture.
 *
 * Pure by construction: no storage, no locale lookup inside, the engine's
 * thinking status arrives as an already-translated string. Two parity rules
 * ride here (D1 rows 22–24):
 *
 * - sources map across to the chips;
 * - `statusLabel` / `statusHistory` are never carried — they are volatile by
 *   decision (AiChatPage:709-713) and the cloud replaces them while the turn
 *   is live;
 * - `caret` carries §2.11's streaming predicate (`caretVisible`, the old
 *   `showCursor` rule of AiChatPage:5484) and `stop` carries §2.8's outcome
 *   line, decided here through the design's own `stopOutcome` so an
 *   interrupted or failed turn can never draw as a finished one;
 * - `tools` are NOT read from the message: the volatile tool rows are fed
 *   from the host's capture map (`toolNameFromActionsPayload`), because the
 *   engine's tool trace deliberately does not survive a reopen.
 */
import type { MessageSource } from "./hostMessage";
import type { Message } from "./hostMessage";
import { stopOutcome } from "../ui/shell/composerState";
import { caretVisible } from "../ui/shell/caretSpec";
import type {
  TranscriptMessage,
  TranscriptSource,
  TranscriptStop,
  TranscriptThinking,
} from "../ui/shell/transcriptTypes";

export type MapperOptions = {
  /** `t("chat.thinkingStatus")`, captured by the host: the engine's own
   *  pre-answer phase label. Matched against `message.statusLabel`. */
  thinkingStatus: string;
  /** Volatile tool rows captured this session, keyed by assistant message id. */
  toolsById?: ReadonlyMap<string, readonly { name: string }[]>;
};

/** One persisted source → the chip's `{url, title}` pair. An older record may
 *  lack the URL; the chip's policy then prints the title instead. */
function mapSource(source: MessageSource): TranscriptSource {
  return source.url ? { url: source.url, title: source.title } : { url: "", title: source.title };
}

/**
 * The cloud's state for one assistant message.
 *
 * The engine owns the phases: it emits `thinkingStatus` until the first
 * VISIBLE content token and flips to writing after it (LlamaService's round
 * loop), and status callbacks are volatile. Three rules, all pure:
 *
 * - the cloud exists when reasoning exists, or while the live turn is still
 *   in the thinking phase (a prefill with no tokens yet still needs the card);
 * - `working` is true only in that thinking phase — the trail's pace belongs
 *   to arriving reasoning, and a tool round is not reasoning arriving;
 * - a restored message never reports `working` (status is volatile: no
 *   orphan "thinking" after a reopen).
 */
function mapThinking(message: Message, opts: MapperOptions): TranscriptThinking | undefined {
  if (message.role !== "assistant") return undefined;
  const reasoning = message.thinkingText ?? "";
  const live = message.streaming === true;
  const thinkingPhase = message.statusLabel === opts.thinkingStatus;
  if (live && thinkingPhase) {
    return { reasoning, working: true, answered: false };
  }
  if (reasoning.trim().length === 0) return undefined;
  // Settled cloud: a restored message is never "working" (status is volatile),
  // and a live turn that left the thinking phase has not answered yet while
  // its text is still empty (a tool round between thinking and writing).
  return { reasoning, working: false, answered: !live || message.text.trim().length > 0 };
}

/**
 * §2.8's outcome for a turn that ended early, as the band draws it — routed
 * through the design's own tested `stopOutcome` (`composerState.ts`), so the
 * transcript and the composer cannot disagree about what a stop means:
 *
 * - failed → the engine's own reason in `danger` (or the reasonless honest
 *   line when the engine gave none — §2.8 forbids a generic apology);
 * - the device's thermal refusal → §2.8's `thermal` row in `attention`;
 * - interrupted → the user's stop line over the kept partial. The tokens
 *   count is the message's own text: sanitize restores an interrupted mark
 *   only with non-empty text, so this reads `stoppedByUser`; an empty marked
 *   message (no reachable send path produces one) reads `stoppedEmpty`;
 * - a finished turn → nothing: silence is the honest row for completion.
 */
function mapStop(message: Message): TranscriptStop | undefined {
  if (message.failed === true) {
    const view = stopOutcome(
      message.failureThermal === true
        ? { cause: "thermal" }
        : { cause: "error", reason: message.failureReason ?? "" },
    );
    return { key: view.line.key, params: view.line.params, tone: view.tone };
  }
  if (message.interrupted === true) {
    const view = stopOutcome({ cause: "user", tokens: message.text.trim().length });
    return { key: view.line.key, params: view.line.params, tone: view.tone };
  }
  return undefined;
}

export function toTranscriptMessage(message: Message, opts: MapperOptions): TranscriptMessage {
  const tools = message.role === "assistant" ? opts.toolsById?.get(message.id) : undefined;
  const mapped: TranscriptMessage = {
    id: message.id,
    role: message.role,
    text: message.text,
    createdAt: message.createdAt,
  };
  const thinking = mapThinking(message, opts);
  if (thinking) mapped.thinking = thinking;
  if (message.role === "assistant") {
    if (caretVisible(message.streaming, message.text)) mapped.caret = true;
    const stop = mapStop(message);
    if (stop) mapped.stop = stop;
  }
  if (tools && tools.length > 0) mapped.tools = tools;
  if (message.sources && message.sources.length > 0) {
    mapped.sources = message.sources.map(mapSource);
  }
  return mapped;
}

export function toTranscriptMessages(
  messages: readonly Message[],
  opts: MapperOptions,
): TranscriptMessage[] {
  return messages.map((message) => toTranscriptMessage(message, opts));
}

/**
 * The tool-name capture: the branch the old consumer never had.
 *
 * `engineCallbackBridge.ts:65` forwards an engine `onTool` as
 * `{ kind: "tool", tool }` on `onActions`; AiChatPage:2628 read only
 * `payload.proposed_actions` — `undefined` for a tool payload — so the name
 * died at the UI boundary. This is that branch, in the host, and the ONLY
 * thing it does is keep the engine's own wire name. A malformed payload
 * yields null and is ignored: never a guessed name.
 */
export function toolNameFromActionsPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as { kind?: unknown; tool?: unknown };
  if (record.kind !== "tool") return null;
  const tool = record.tool;
  if (!tool || typeof tool !== "object") return null;
  const name = (tool as { name?: unknown }).name;
  return typeof name === "string" && name.length > 0 ? name : null;
}
