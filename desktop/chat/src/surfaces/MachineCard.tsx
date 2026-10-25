import type { English } from "../i18n/en/all";
import { speedLine } from "../lib/speed";

/** One of the two the page offers. Both are the same shape by construction:
    the backend builds them from the same row type. */
export interface ModelOption {
  /**
   * The backend's own opaque name for this row, to send back when the reader
   * chooses it. `null` when the backend could not resolve the row to exactly
   * one catalog entry — then this option is shown and not offered.
   */
  id: string | null;
  name: string;
  quant: string;
  // What downloading this model costs, as one number: its file plus the
  // drafter its row ships beside it.
  download_bytes: number;
  // null when this machine cannot fund even one token of context: the
  // chosen row fits the budget with nothing left for a window. There is
  // then no context to show — not an unknown one.
  context_tokens: number | null;
  // The conversation length `speed` is priced at: the chooser's window,
  // lowered to the row's own trained cap where that is shorter. A speed
  // without it is the empty-cache best case wearing a general claim: the
  // cache is re-read on every token, so a longer conversation is a slower
  // one.
  speed_context_tokens: number;
  speed:
    | { shape: "range"; low: number; high: number }
    | { shape: "at_least"; value: number }
    | { shape: "measured"; value: number; machine: string };
  // The tune's measured decode rate on this machine, when one exists —
  // null until the tune has run. It outranks the predicted speed beside
  // it: a measurement of this computer beats an arithmetic about it.
  measured: number | null;
  reason: string; // one or two sentences, already written for a human
  /** The reason's stable code, beside the English; the screen renders the
      code in the owner's language and falls back to `reason`. */
  reason_code?: string;
  details: string; // the full working, technical
}

/** What `brain_capability` answers: this computer, and what the chooser picked. */
export type Capability =
  | { kind: "migrating" }
  | { kind: "unmeasured"; chosen: boolean; chosen_model: string | null }
  | {
      kind: "measured";
      /** Whether a model choice is stored. False is a first run: the home
          page shows Start, and nothing downloads before Allow. */
      chosen: boolean;
      /** The stored choice's display name, present exactly when `chosen`. */
      chosen_model: string | null;
      /** The stored choice's token, as an option's `id` carries it. */
      chosen_id: string | null;
      machine: {
        ram_bytes: number;
        budget_bytes: number; // what a model may occupy
        gpu_accounted_for: boolean; // false = a graphics card is present but its memory could not be read
        runs_on: string; // already in words: "the graphics chip" | "the processor" | "the graphics card" | "this computer"
        bandwidth_bytes_per_second: number;
        // Where that rate comes from: "measured" on the path the model will
        // use, "floor" on a slower one, "chip" from the chip's published
        // figure scaled by a share measured elsewhere. Three sentences,
        // because calling a derived figure measured would be a lie.
        bandwidth_basis: "measured" | "floor" | "chip";
      };
      model: ModelOption | null;
      // The second option, when this machine has one that is clearly faster.
      // null is ordinary: a machine with a single speed class is owed one
      // honest answer, not two that feel the same.
      quicker: ModelOption | null;
      refusal: string | null; // set when there is no pick; already a sentence
      /** The refusal's stable code, beside the English. */
      refusal_code?: string;
    };

type Speed = ModelOption["speed"];

// One byte formatter for the page. The divisor is binary and so is the LABEL:
// the catalog's own working text, one click below on the same card, prints
// these same quantities as GiB, and printing "12.8 GB" over "12.75 GiB" is
// two labels for one quantity. One decimal above a gibibyte, MiB below, and
// no decimal where it would say nothing.
const GIB = 1024 ** 3;
const MIB = 1024 ** 2;

export function bytesText(bytes: number, tag = "en"): string {
  if (bytes < GIB) return `${new Intl.NumberFormat(tag).format(Math.round(bytes / MIB))} MiB`;
  const value = bytes / GIB;
  const shown = new Intl.NumberFormat(tag, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value);
  return `${Number.isInteger(value) ? new Intl.NumberFormat(tag).format(value) : shown} GiB`;
}

/** A context length as a chat figure: 65536 is "64k", 65315 is "63.8k". */
export function tokensText(tokens: number): string {
  if (tokens < 1024) return String(tokens);
  const thousands = tokens / 1024;
  return `${Number.isInteger(thousands) ? thousands.toFixed(0) : thousands.toFixed(1)}k`;
}

// The speed as words a reader can hold: an estimate says it is one, a
// measurement says where it was taken, and the figure rides beside the words.
export function speedText(t: English["machine"], speed: Speed, tag: string): string {
  const one = new Intl.NumberFormat(tag, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  switch (speed.shape) {
    case "range":
      return t.speedRange(one.format(speed.low), one.format(speed.high));
    case "at_least":
      return t.speedAbout(one.format(speed.value));
    case "measured":
      return speedLine(t, tag, speed.value);
  }
}

/** The speed an option is shown with: the tune's own number replaces the
    prediction when this machine has one. */
export function shownSpeed(t: English["machine"], model: ModelOption): Speed {
  return model.measured != null
    ? { shape: "measured", value: model.measured, machine: t.thisComputerMachine }
    : model.speed;
}

/** A reason: the approved sentence when the code is one of ours, the
    catalog's own English otherwise, and nothing for a pick the user made. */
export function reasonSentence(t: English["machine"], code: string | undefined, text: string): string {
  if (code === "model.reason.chosen") return "";
  const byCode: Record<string, string> = {
    "model.reason.pick": t.reasonPicked,
    "model.reason.quicker": t.reasonQuicker,
    "model.reason.quicker_smaller": t.reasonQuickerSmaller,
    "model.reason.bigger": t.reasonBigger,
    "model.reason.more_capable": t.reasonMoreCapable,
  };
  return (code && byCode[code]) || text;
}

/** Why there is no pick: the approved sentence for the two catalog refusals,
    the backend's own words otherwise. */
export function refusalSentence(t: English["machine"], code: string | undefined, refusal: string | null): string | null {
  return code === "catalog.nothing_fits" || code === "catalog.nothing_fast_enough" ? t.noSuitableChoice : refusal;
}
