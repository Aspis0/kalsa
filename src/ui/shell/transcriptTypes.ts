/**
 * The transcript's public shapes.
 *
 * They live in their own file so the band and its parts can both import them
 * without a cycle. The message shape stays LOCAL on purpose: the real model
 * belongs to another layer, and guessing at it here would bind this file to a
 * decision it does not own.
 */
import type { ThemeMode } from "../../theme/design";
import type { Insets } from "./shellGeometry";

export type TranscriptRole = "user" | "assistant";

/**
 * What makes the cloud appear: reasoning that is still arriving, and whether the
 * answer itself has started. The cloud owns the gesture; these two flags are all
 * it needs to know when to rise and when to settle.
 */
export type TranscriptThinking = {
  reasoning: string;
  /** Reasoning tokens are still arriving. */
  working: boolean;
  /** Answer text has started arriving. */
  answered: boolean;
  /** Measured reasoning time, for the collapsed label once it is done. */
  reasoningMs?: number;
  /** The latest reasoning line, tracked upstream; the cloud falls back to the
   *  last line of `reasoning` when it is absent. */
  tail?: string;
};

export type TranscriptMessage = {
  id: string;
  role: TranscriptRole;
  text: string;
  createdAt: number;
  thinking?: TranscriptThinking;
  /**
   * The tool calls this answer stands on, drawn as one quiet row each above the
   * answer (§2.4).
   *
   * VOLATILE BY DECISION: the rows are live activity and are never persisted, so
   * this field is absent on a message that came back from a reopen — the durable
   * evidence of what an answer stands on is `sources`, which the history path
   * already saves. Nothing in this band reads or writes storage, which is why
   * the rule is expressible as a shape rather than as a policy the UI remembers
   * to apply.
   */
  tools?: readonly TranscriptToolCall[];
  /** What the answer stands on, drawn as chips below it (§2.5). Persisted by
   *  the history path, unlike `tools`. */
  sources?: readonly TranscriptSource[];
};

/**
 * One tool call, as the row above an answer draws it.
 *
 * Only the name is carried. The rows are collapsed to one line with no
 * expandable payload in this step, so `arguments` — which the engine also emits
 * — is deliberately not modelled here; modelling it while nothing reads it is
 * how dead weight arrives.
 */
export type TranscriptToolCall = {
  /** The engine's own wire name, verbatim (`web_search`, `web_fetch`, …). An
   *  unknown name is kept and drawn, never dropped; see `toolLabels.ts`. */
  name: string;
};

/**
 * One source behind an answer.
 *
 * The chip prints the citation index — the 1-based position in this array, the
 * same number the answer's own `[N]` markers use (`MarkdownText` reads
 * `sources[N - 1]`) — and the host, derived from `url` by the pure policy in
 * `sourceLinkPolicy.ts`.
 */
export type TranscriptSource = {
  /** The address, verbatim. Only a public `http(s)` one is tappable. */
  url: string;
  /** A title to print when the address has no host to print. */
  title?: string;
};

export type TranscriptProps = {
  messages: readonly TranscriptMessage[];
  insets: Insets;
  /** Overrides for the preview; the live window is the default. */
  width?: number;
  height?: number;
  mode?: ThemeMode;
  /** The clock the day marker compares against, as a prop so a capture is
   *  repeatable. Defaults to now. */
  now?: number;
};
