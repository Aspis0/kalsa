/**
 * The transcript's public shapes.
 *
 * Own file so the band and its parts can both import without a cycle. The
 * message shape stays LOCAL on purpose: the real model belongs to another
 * layer, and guessing at it here would bind this file to a decision it does
 * not own.
 */
import type { TranslationKey, Locale } from "../../i18n";
import type { ReactNode } from "react";
import type { ThemeMode } from "../../theme/design";
import type { StopTone } from "./composerState";
import type { Insets } from "./shellGeometry";

export type TranscriptRole = "user" | "assistant";

/**
 * What makes the cloud appear: reasoning still arriving, and whether the
 * answer has started. The cloud owns the gesture; these flags are all it needs.
 */
export type TranscriptThinking = {
  reasoning: string;
  working: boolean;
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
   * The tool calls this answer stands on, one quiet row each above it (§2.4).
   * VOLATILE BY DECISION: live activity, never persisted — absent on a message
   * that comes back from a reopen; the durable evidence is `sources`, which the
   * history path saves. Nothing here touches storage, so the rule is a shape
   * rather than a policy the UI must remember.
   */
  tools?: readonly TranscriptToolCall[];
  /** What the answer stands on, drawn as chips below it (§2.5). Persisted by
   *  the history path, unlike `tools`. */
  sources?: readonly TranscriptSource[];
  /**
   * The streaming caret is up: while true the band draws plain text with the
   * caret after its last segment — markdown is parsed when the turn settles,
   * not per token (§2.11).
   */
  caret?: boolean;
  /**
   * The turn ended early (§2.8) with the line that says so, decided by the
   * host's mapper through `stopOutcome` — never re-derived here from the text.
   * Absent on a finished turn: silence is the honest row.
   */
  stop?: TranscriptStop;
  /**
   * The user edited this bubble and resent it (D1 row 17): the small badge
   * under the capsule. Carried from the host's `Message.edited`, which the
   * history path already round-trips.
   */
  edited?: boolean;
  /**
   * The action chips under an answer (D1 row 26). Drawn as STATIC chips:
   * the controller's press handler was a stub (`AppShell.tsx:7047`) and this
   * build has no outputs view behind `target: "outputs"`, so a button here
   * would be a control that does nothing. See `TranscriptTurns`.
   */
  ctas?: readonly TranscriptCta[];
  /**
   * The interactive mini-app card under an answer (D1 row 28). PERSISTED by
   * the history path (unlike `tools`): a definition that comes back from a
   * reopen still draws its card, and the sheet still opens from it.
   */
  miniapp?: TranscriptMiniapp;
};

/**
 * One CTA chip as the band draws it: the label the engine wrote (already
 * localized at capture, `sendCallbacks.ts`) and the kind that tints it. The
 * outputs-system fields (`outputId`, `target`, `artifactType`, `contrastId`)
 * are dropped by the mapper — nothing reads them while the chip is text.
 */
export type TranscriptCta = {
  label: string;
  kind: string;
  id?: string;
};

/**
 * §2.8's stop line, as data: one catalogue key, the engine's own reason when
 * one interpolates, and the design's tone. The band draws the line and never
 * invents a second sentence of its own.
 */
export type TranscriptStop = {
  key: TranslationKey;
  /** Interpolation params — `{ reason }` carries the engine's own words. */
  params?: { reason: string };
  tone: StopTone;
};

/**
 * One tool call, as the row above an answer draws it. Only the name is carried:
 * the rows are collapsed to one line, so `arguments` is deliberately not
 * modelled — modelling what nothing reads is how dead weight arrives.
 */
export type TranscriptToolCall = {
  /** The engine's own wire name, verbatim (`web_search`, `web_fetch`, …). An
   *  unknown name is kept and drawn, never dropped; see `toolLabels.ts`. */
  name: string;
};

/**
 * One source behind an answer: the chip prints the citation index (1-based
 * position in this array, the same number the answer's `[N]` markers use) and
 * the host, derived from `url` by the pure policy in `sourceLinkPolicy.ts`.
 */
export type TranscriptSource = {
  /** The address, verbatim. Only a public `http(s)` one is tappable. */
  url: string;
  title?: string;
};

/**
 * One message's translation, as the band draws it (D1 row 18): the busy row
 * while the engine job runs, the expandable block once a result exists. The
 * host owns the state — it is NEVER a field of a message, so it cannot enter
 * the persist path; the band draws whatever it is handed under the message
 * whose id matches.
 */
export type TranscriptTranslation = {
  /** The message this run belongs to; drawn only under that message. */
  messageId: string;
  /** The engine job is running: the band draws the "Translating…" row. */
  busy: boolean;
  /** The block's expand/collapse. */
  expanded: boolean;
  /** Absent while busy: an error result carries `error` and no text. */
  result?: {
    text: string;
    /** Captured at run start, so the badge survives a locale change. */
    lang: Locale;
    error?: boolean;
    truncated?: boolean;
  };
};

/**
 * The translate action the band is given as ONE prop: the view plus the
 * handlers that belong to it, so the band can never draw the block with a
 * control that has nothing behind it (absent together or present together).
 */
export type TranscriptTranslateAction = {
  view: TranscriptTranslation;
  onToggle: () => void;
  onClose: () => void;
  onRetry: () => void;
};

/**
 * The mini-app envelope a message carries (D1 rows 4/28), as the card draws
 * it: `kind` picks the icon, `title` the header. At runtime the object IS
 * the full normalized envelope — `blocks`, `actions` and `state` ride along
 * unmodelled and the host hands the same object to the sheet's renderer, so
 * modelling what the card does not read would be dead weight (the controller
 * cast the same object at `AppShell.tsx:7046`).
 */
export type TranscriptMiniapp = {
  kind: string;
  title: string;
};

export type TranscriptProps = {
  messages: readonly TranscriptMessage[];
  /**
   * The first-open content (D1 row 12): rendered INSTEAD of the messages, in
   * this band's own scrolling content, while the conversation is empty. The
   * host decides WHEN and WHAT; this band only places it, so the welcome
   * screen is not a fourth band and `shellGeometry.ts` is untouched.
   */
  empty?: ReactNode;
  /**
   * Long-press on a message (the controller's 350 ms hold), reported as the
   * message itself. The band only reports; the HOST decides whether a menu may
   * open. Absent in the preview: with no handler the pressables draw no
   * long-press hint, because a hint that promises a menu is a promise.
   */
  onMessageLongPress?: (message: TranscriptMessage) => void;
  /**
   * The inline copy chip's actual copy. Returns whether the clipboard took the
   * text, so the chip only flashes "Copied!" when it did. Absent → no chip is
   * drawn: absent, not present and inert.
   */
  onCopy?: (text: string) => Promise<boolean>;
  /**
   * The mini-app card's open: hands the message's envelope to the host,
   * which applies the controller's open policy (`AppShell.tsx:7035-7046`).
   * Absent (the preview) → the card draws with NO "tap to open" hint and no
   * Open control: a hint that promises an opener nothing can perform is the
   * inert affordance this build does not ship.
   */
  onMiniappOpen?: (miniapp: TranscriptMiniapp) => void;
  /**
   * The translate run under ONE message (D1 row 18): busy row + expandable
   * block, handlers bundled with the view. Absent (the preview, or no run):
   * no block at all. The host's `useTranslateMessage` owns the state.
   */
  translate?: TranscriptTranslateAction | null;
  /**
   * Read-aloud (D1 row 19): the id whose chip reads "Stop reading", and the
   * press that speaks an answer (the controller's `speakingId` + `onSpeak`).
   * Absent → no chip is drawn: absent, not present and inert.
   */
  speakingId?: string | null;
  onSpeak?: (id: string, text: string) => void;
  insets: Insets;
  /** Overrides for the preview; the live window is the default. */
  width?: number;
  height?: number;
  mode?: ThemeMode;
  /** The clock the day marker compares against, as a prop so a capture is
   *  repeatable. Defaults to now. */
  now?: number;
};
