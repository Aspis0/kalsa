/**
 * The transcript's public shapes.
 *
 * They live in their own file so the band and its parts can both import them
 * without a cycle. The message shape stays LOCAL on purpose: the real model
 * belongs to another layer, and guessing at it here would bind this file to a
 * decision it does not own.
 */
import type { TranslationKey } from "../../i18n";
import type { ReactNode } from "react";
import type { ThemeMode } from "../../theme/design";
import type { StopTone } from "./composerState";
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
  /**
   * The streaming caret is up: this answer is arriving right now (§2.11,
   * `caretVisible`). While true the band draws the answer as plain text with
   * the caret after its last segment — the controller's own render rule
   * (`AiChatPage.tsx:5486-5490`): markdown is parsed when the turn settles,
   * not per token.
   */
  caret?: boolean;
  /**
   * The turn ended early — stopped by the user, refused by the device, or
   * failed (§2.8) — and carries the line that says so, decided by the host's
   * mapper through `stopOutcome` (never re-derived here from the text). Absent
   * on a finished turn: silence is the honest row for a turn that completed.
   */
  stop?: TranscriptStop;
};

/**
 * §2.8's stop line, as data: one catalogue key, the engine's own reason when
 * the key interpolates one, and the tone the design assigns the outcome
 * (`quiet` marks, `attention` is the device having intervened, `danger` is
 * the failed row's explicit word). The band draws the line and never invents
 * a second sentence of its own.
 */
export type TranscriptStop = {
  key: TranslationKey;
  /** Interpolation params — `{ reason }` carries the engine's own words. */
  params?: { reason: string };
  tone: StopTone;
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
  /**
   * The first-open content (D1 row 12): rendered INSTEAD of the messages, in
   * this band's own scrolling content, while the conversation is empty. The
   * host decides WHEN (the `historyLoaded` gate the controller used at
   * `AiChatPage:4015-4016`) and WHAT; this band only places it, so the
   * welcome screen is not a fourth band and `shellGeometry.ts` is untouched.
   * Absent in the preview and in every conversation with messages.
   */
  empty?: ReactNode;
  /**
   * Long-press on a message — the controller's 350 ms hold
   * (`AiChatPage.tsx:5332-5334` and siblings), reported as the message itself.
   * The band only reports; the HOST decides whether a menu may open, through
   * the same refs-only guards the controller recorded (`Chat:3484-3487`,
   * `src/host/messageActions.ts`). Absent in the preview: with no handler the
   * pressables draw no long-press hint, because a hint that promises a menu is
   * a promise.
   */
  onMessageLongPress?: (message: TranscriptMessage) => void;
  /**
   * The inline copy chip's actual copy. Returns whether the clipboard took the
   * text, so the chip only flashes "Copied!" when it did (the controller's
   * `copyTextToClipboard`, which returned false on the share-sheet fallback).
   * Absent → no chip is drawn: absent, not present and inert.
   */
  onCopy?: (text: string) => Promise<boolean>;
  insets: Insets;
  /** Overrides for the preview; the live window is the default. */
  width?: number;
  height?: number;
  mode?: ThemeMode;
  /** The clock the day marker compares against, as a prop so a capture is
   *  repeatable. Defaults to now. */
  now?: number;
};
