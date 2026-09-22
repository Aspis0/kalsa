/**
 * The composer's held states, and stop's four outcomes, as a decision layer
 * (DESIGN.md §2.7 and §2.8).
 *
 * The composer has two questions that look like one and are not: *may the
 * field take typing* and *may this be sent*. §2.7 answers them separately —
 * typing the next message while the model generates is allowed, only sending
 * is held — which is exactly the single `disabled` the old composer computed
 * for both (`AiChatPage.tsx:4339`). So this module returns two booleans, and
 * the test pins them disagreeing wherever the machine is merely not ready.
 *
 * The second §2.7 rule is about refusals: a place that refuses input never
 * shows the input placeholder and always carries exactly one line of reason.
 * `FieldView` is a union so that "refusing and inviting" is unrepresentable
 * in TypeScript, and `hold` is never null while anything refuses — the
 * `shell.held.*` catalogue's own comment says the reason is "never empty
 * then" (`en.ts:1217`). The test re-checks both properties at runtime, for
 * the JavaScript side that types never see.
 *
 * The third is §2.8's invariant: one control with three faces, where
 * `stopping` lasts until the engine confirms release — the interface never
 * claims the machine has stopped before the machine has. The release is an
 * INPUT (the next `phase` is `idle`), never a duration: this module holds no
 * clock, and the test fails the day one appears.
 *
 * Leaf rule, same as the transcript band beside it: plain data in, i18n keys
 * and booleans out. No React, no storage, nothing from `src/engine`.
 */
import type { TranslationKey } from "../../i18n";

/**
 * The states the composer reasons about. Eight of them are machine or
 * composer conditions the catalogue already has a `shell.held.*` reason for;
 * `converting` is the composer's own (a document is still being read into the
 * message) rather than a band phase — `shell.phase.*` has no `converting`,
 * and it does not need one: the band shows the machine, this row shows whether
 * your message can go.
 */
export type ComposerPhase =
  | "idle"
  | "loading"
  | "prefill"
  | "thinking"
  | "writing"
  | "stopping"
  | "tooHot"
  | "unloaded"
  | "converting";

/**
 * What the field offers. The invite exists exactly where typing is accepted:
 * a refusing field carries `placeholder: null` by construction, so the old
 * bug ("Fai una domanda…" over a field with `editable={false}`,
 * DESIGN.md §2.7) cannot be written in TypeScript at all.
 */
export type FieldView =
  | { editable: true; placeholder: TranslationKey }
  | { editable: false; placeholder: null };

/** §2.8's one control: `send` when idle, `stop` while generating, and the
 *  visible `stopping` that ends only on the engine's confirmation. */
export type ComposerFace = "send" | "stop" | "stopping";

/**
 * The attachment drawn as an explicit chip: a label with the name inside it,
 * never the bare filename — "a chip with no label is a rebus" (§2.7). There
 * is deliberately no field holding the filename alone to render.
 */
export type AttachmentView = { key: TranslationKey; params: { name: string } };

export type ComposerInput = {
  phase: ComposerPhase;
  /** The attached file's name; null (or blank) means nothing is attached. */
  attachment?: string | null;
};

export type ComposerState = {
  field: FieldView;
  /** Exactly one reason line while anything is held, null when nothing is. */
  hold: TranslationKey | null;
  /**
   * Whether the engine would accept a send. This is the MACHINE's answer
   * only: an empty draft is the field's own business and the component dims
   * the control for it without a reason line — the design gives the
   * machine-held states reasons (`shell.held.*`) and gives the empty draft
   * none, and conflating the two is the same mistake as one `disabled`.
   */
  canSend: boolean;
  face: ComposerFace;
  /** The control's accessible name; also its visible text for `stopping`,
   *  the one face §2.8 requires to be seen rather than inferred. */
  faceLabel: TranslationKey;
  /** False exactly where a tap must do nothing (§2.11): a held `send`, and
   *  `stopping`, whose release only the engine supplies. */
  faceEnabled: boolean;
  /** The field's accessible name, so the nodes this module decides carry
   *  their names from data rather than from the component's own string. */
  fieldLabel: TranslationKey;
  attachment: AttachmentView | null;
};

type PhaseRule = {
  /** Why the composer holds, or null when it does not hold at all. */
  hold: TranslationKey | null;
  /** Whether the field takes typing. True in every phase the table knows
   *  (§2.7's first sentence covers the whole wait, longest at `loading` and
   *  `unloaded`); false only where the design refuses outright — the line. */
  editable: boolean;
  face: ComposerFace;
};

/**
 * One row per phase, and every axis lives in the row rather than being
 * derived, so a phase is decided in exactly one place. The two invariants the
 * design asks for are properties of this table and are asserted over it by
 * the test: `hold: null` only at `idle` (nothing else may refuse without a
 * reason), and `face: "stop"` only where the machine is generating.
 */
const PHASE_RULES: Readonly<Record<ComposerPhase, PhaseRule>> = Object.freeze({
  idle: { hold: null, editable: true, face: "send" },
  loading: { hold: "shell.held.loading", editable: true, face: "send" },
  prefill: { hold: "shell.held.prefill", editable: true, face: "stop" },
  thinking: { hold: "shell.held.thinking", editable: true, face: "stop" },
  writing: { hold: "shell.held.writing", editable: true, face: "stop" },
  stopping: { hold: "shell.held.stopping", editable: true, face: "stopping" },
  tooHot: { hold: "shell.held.tooHot", editable: true, face: "send" },
  unloaded: { hold: "shell.held.unloaded", editable: true, face: "send" },
  converting: { hold: "shell.held.converting", editable: true, face: "send" },
});

/**
 * A phase this module does not know. The phase arrives from the engine, so an
 * unknown one is a wire value that can actually happen — the same case
 * `toolLabels.ts` meets with an unknown tool name. The honest answer is to
 * hold: never to default to `idle`, because a default that reads as "ready to
 * send" is this interface claiming the machine is stopped before it is.
 */
const UNKNOWN_PHASE_RULE: PhaseRule = Object.freeze({
  hold: "shell.held.unknown",
  editable: false,
  face: "send",
});

/** Every phase the table decides, in the table's own order. The test iterates
 *  this list, so a phase added to the union cannot skip the checks. */
export const COMPOSER_PHASES: readonly ComposerPhase[] = Object.freeze(
  Object.keys(PHASE_RULES) as ComposerPhase[],
);

const PLACEHOLDER_KEY: TranslationKey = "shell.composer.placeholder";
const FIELD_LABEL_KEY: TranslationKey = "shell.a11y.field";

const FACE_LABELS: Readonly<Record<ComposerFace, TranslationKey>> = Object.freeze({
  send: "shell.a11y.send",
  stop: "shell.a11y.stop",
  stopping: "shell.composer.stopping",
});

export function composerState(input: ComposerInput): ComposerState {
  // `hasOwnProperty` rather than a bare lookup, for the same reason
  // `toolRowLabel` does it: a wire value like "constructor" would otherwise
  // find Object.prototype's member and draw a rule built from a function.
  const rule = Object.prototype.hasOwnProperty.call(PHASE_RULES, input.phase)
    ? PHASE_RULES[input.phase]
    : UNKNOWN_PHASE_RULE;
  const name = typeof input.attachment === "string" ? input.attachment.trim() : "";
  return {
    field: rule.editable
      ? { editable: true, placeholder: PLACEHOLDER_KEY }
      : { editable: false, placeholder: null },
    hold: rule.hold,
    canSend: rule.hold === null,
    face: rule.face,
    faceLabel: FACE_LABELS[rule.face],
    faceEnabled: rule.face === "stop" ? true : rule.hold === null,
    fieldLabel: FIELD_LABEL_KEY,
    attachment: name === "" ? null : { key: "shell.composer.attachment", params: { name } },
  };
}

// ── Stop, and its four outcomes (§2.8) ───────────────────────────────────

/**
 * What the engine reports when a run ends early. The three causes are the
 * design's table; `tokens` exists only where the design branches on it —
 * a user stop before the first token is a different message than one after.
 */
export type StopReport =
  | { cause: "user"; tokens: number }
  | { cause: "thermal" }
  /** The engine's own reason, verbatim after trimming: §2.8 forbids a
   *  generic apology in this row, so the text is data, not a catalogue
   *  string — the same deal `toolLabels` makes with an unknown tool name. */
  | { cause: "error"; reason: string };

export type StopOutcome = "stoppedByUser" | "stoppedEmpty" | "thermal" | "failed";

/**
 * The line's tone. `danger` is the design's explicit word and belongs to
 * `failed` alone; `quiet` marks rather than alarms (the partial stays and is
 * copyable); `attention` is the device having intervened. Which palette
 * colour each tone resolves to is the component's translation, later step.
 */
export type StopTone = "quiet" | "attention" | "danger";

export type StopLine = { key: TranslationKey; params?: { reason: string } };

export type StopView = {
  outcome: StopOutcome;
  /** Which line to show: one key, plus the engine's reason when the cause is
   *  an error. */
  line: StopLine;
  tone: StopTone;
  /** Only the actions the engine can honour in this state (§2.8): the
   *  thermal row offers `wait` and `stop`, and no state offers more. */
  actions: readonly TranslationKey[];
  /** A partial answer exists: it stays on screen, marked by `line`, and
   *  remains copyable. False only before the first token — and the component
   *  must take it from here, never infer it by parsing a translated line. */
  keepsPartial: boolean;
};

const NO_ACTIONS: readonly TranslationKey[] = Object.freeze([]);
const THERMAL_ACTIONS: readonly TranslationKey[] = Object.freeze([
  "shell.action.wait",
  "shell.action.stop",
]);

export function stopOutcome(report: StopReport): StopView {
  switch (report.cause) {
    case "user":
      // `> 0` and not `!== 0`: a nonsensical count (NaN, negative) reads as
      // "no tokens observed", which is the safe direction — it never claims
      // content exists that the run did not produce.
      return report.tokens > 0
        ? {
            outcome: "stoppedByUser",
            line: { key: "shell.phase.stoppedByUser" },
            tone: "quiet",
            actions: NO_ACTIONS,
            keepsPartial: true,
          }
        : {
            outcome: "stoppedEmpty",
            line: { key: "shell.phase.stoppedEmpty" },
            tone: "quiet",
            actions: NO_ACTIONS,
            keepsPartial: false,
          };
    case "thermal":
      return {
        outcome: "thermal",
        line: { key: "shell.phase.tooHot" },
        tone: "attention",
        // "wait, stop" in the design's own order. Not `retry`: a run started
        // while the governor holds the phone would be refused by the
        // governor, so offering it would be an action the engine cannot honour.
        actions: THERMAL_ACTIONS,
        keepsPartial: true,
      };
    case "error": {
      // An engine that failed without a reason still gets the honest line,
      // never `stopFailed` with an empty tail: "Stopped by an error: " is
      // the generic shape §2.8 forbids, apology or not.
      const reason = report.reason.trim();
      return {
        outcome: "failed",
        line:
          reason === ""
            ? { key: "shell.phase.failed" }
            : { key: "shell.composer.stopFailed", params: { reason } },
        tone: "danger",
        actions: NO_ACTIONS,
        keepsPartial: true,
      };
    }
  }
}
