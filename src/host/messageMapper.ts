/**
 * `Message → TranscriptMessage`: the bridge from the persisted chat model to
 * the transcript band's local shape. Pure by construction: no storage, no
 * locale lookup inside, the engine's thinking status arrives already
 * translated. The parity rules that ride here (D1 rows 22–24):
 *
 * - sources map across to the chips;
 * - `statusLabel` / `statusHistory` are never carried — volatile by decision,
 *   and the cloud replaces them while the turn is live;
 * - `caret` carries §2.11's streaming predicate (`caretVisible`) and `stop`
 *   carries §2.8's outcome line, decided here through `stopOutcome`, so an
 *   interrupted or failed turn can never draw as a finished one;
 * - `tools` are NOT read from the message: the volatile tool rows are fed
 *   from the host's capture map (`toolNameFromActionsPayload`), because the
 *   engine's tool trace deliberately does not survive a reopen;
 * - `miniapp` crosses whole on an answer (D1 rows 4/28): persisted by the
 *   history path, drawn by the card, handed unchanged to the sheet;
 * - `edited` crosses on a user bubble (D1 row 17): the badge the edit modal's
 *   save stamps, which the history path already round-trips;
 * - `ctas` cross as label + kind + id only (D1 row 26): the outputs-system
 *   fields are dropped here because no renderer reads them.
 */
import type { MessageSource } from "./hostMessage";
import type { Message } from "./hostMessage";
import { stopOutcome } from "../ui/shell/composerState";
import { caretVisible } from "../ui/shell/caretSpec";
import type {
  TranscriptCta,
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
 * The cloud's state for one assistant message. The engine owns the phases:
 * it emits `thinkingStatus` until the first VISIBLE content token and flips
 * to writing after it; status callbacks are volatile. Three rules, all pure:
 *
 * - the cloud exists when reasoning exists, or while the live turn is still
 *   in the thinking phase (a prefill with no tokens still needs the card);
 * - `working` is true only in that thinking phase — a tool round is not
 *   reasoning arriving;
 * - a restored message never reports `working` (no orphan "thinking" after
 *   a reopen).
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
 * §2.8's outcome for a turn that ended early — routed through the tested
 * `stopOutcome` (`composerState.ts`) so transcript and composer cannot
 * disagree about what a stop means. Failed → the engine's own reason in
 * `danger` (or the reasonless honest line); thermal → the `attention` row;
 * interrupted → the user's stop line over the kept partial, tokens counted
 * from the message's own text (sanitize restores an interrupted mark only
 * with non-empty text, so this reads `stoppedByUser`; an empty marked message
 * — no reachable send path produces one — reads `stoppedEmpty`); finished →
 * nothing: silence is the honest row for completion.
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
    // The mini-app definition crosses whole (D1 row 4/28): the card reads
    // kind + title, the sheet reads the rest — nothing is projected away
    // here, because the sheet opens from THIS object.
    if (message.miniapp) mapped.miniapp = message.miniapp;
  } else if (message.edited === true) {
    // The edit badge lives on the user bubble it belongs to (the controller
    // drew it under the capsule, `Chat:5437-5445`); answers never carry it.
    mapped.edited = true;
  }
  if (tools && tools.length > 0) mapped.tools = tools;
  if (message.sources && message.sources.length > 0) {
    mapped.sources = message.sources.map(mapSource);
  }
  if (message.ctas && message.ctas.length > 0) {
    mapped.ctas = message.ctas.map((cta): TranscriptCta => ({
      label: cta.label,
      kind: cta.kind,
      ...(cta.id ? { id: cta.id } : {}),
    }));
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
 * The tool-name capture: the branch the old consumer never had. The bridge
 * forwards an engine `onTool` as `{ kind: "tool", tool }` on `onActions`; the
 * old UI read only `payload.proposed_actions` — `undefined` for a tool
 * payload — so the name died at the UI boundary. This branch lives in the
 * host and does ONE thing: keep the engine's own wire name. A malformed
 * payload yields null and is ignored: never a guessed name.
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
