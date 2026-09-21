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
