import { useState } from "react";
import type { English } from "../i18n/en/all";
import { speedLine } from "../lib/speed";
import { useLanguage } from "../i18n/useLanguage";
import "./surfaces.css";
import "./BrainSurface.css";

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
  // The conversation length `speed` is priced at. A speed without it is the
  // empty-cache best case wearing a general claim: the cache is re-read on
  // every token, so a longer conversation is a slower one.
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
  | { kind: "unmeasured"; chosen: boolean }
  | {
      kind: "measured";
      /** Whether a model choice is stored. False is a first run: the home
          page shows Start, and nothing downloads before Allow. */
      chosen: boolean;
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

// The speed as words a reader can hold: an estimate says it is one, a
// measurement says where it was taken, and the figure rides beside the words.
function speedText(t: English["machine"], speed: Speed, tag: string): string {
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

function speedDetail(t: English["machine"], speed: Speed): string {
  switch (speed.shape) {
    case "range":
    case "at_least":
      return t.detailRange;
    // "last": a measured figure is a reading from one moment on one
    // machine — an engine or driver change since can have moved it.
    case "measured":
      return t.detailMeasured(speed.machine);
  }
}

// The detail line under a choice's name: what it costs on this computer and
// where the speed comes from.
function modelDetail(t: English["machine"], model: ModelOption, speed: Speed, tag: string): string {
  return `${t.onDisk(bytesText(model.download_bytes, tag))} · ${speedDetail(t, speed)}`;
}

/** A choice's reason: the approved sentence when the code is one of ours,
    the catalog's own English otherwise. */
function reasonLine(t: English["machine"], model: ModelOption): string {
  const byCode: Record<string, string> = {
    "model.reason.pick": t.reasonPicked,
    "model.reason.chosen": t.reasonChosen,
  };
  return (model.reason_code && byCode[model.reason_code]) || model.reason;
}

// The choice card: the options the chooser found for this computer. Rendering
// only: the read belongs to the caller.
// One option, on three tight lines: what it is and how fast, what it costs on
// disk and where the speed comes from, and why you would take this one. Three
// lines because the page also has to hold the writing bar above the fold.
function Option({
  model,
  running,
  busy,
  onChoose,
}: {
  model: ModelOption;
  running?: string | null;
  busy?: boolean;
  onChoose?: (token: string) => void;
}) {
  const { table, tag } = useLanguage();
  const t = table.machine;
  const [confirming, setConfirming] = useState(false);
  const isRunning = running != null && running === model.name;
  // The tune's own number replaces the prediction when this machine has
  // one; "measured on this computer" is then the truth of the figure.
  const speed: Speed =
    model.measured != null
      ? { shape: "measured", value: model.measured, machine: t.thisComputerMachine }
      : model.speed;
  return (
    <div className="machine-option">
      <p className="machine-option-head">
        <strong className="machine-option-name">{model.name}</strong>
        <span className="machine-option-speed">{speedText(t, speed, tag)}</span>
        {isRunning ? <span className="machine-option-running">{t.runningNow}</span> : null}
      </p>
      <p className="machine-option-detail">{modelDetail(t, model, speed, tag)}</p>
      <p className="machine-option-reason">{reasonLine(t, model)}</p>
      {isRunning ? null : model.id === null || onChoose === undefined ? null : confirming ? (
        <div className="machine-option-choose">
          <p>{t.confirmSwitch(model.name, bytesText(model.download_bytes, tag))}</p>
          <div className="machine-option-actions">
            <button
              type="button"
              className="btn-primary"
              disabled={busy}
              onClick={() => {
                setConfirming(false);
                onChoose(model.id as string);
              }}
            >
              {t.startAgainOn(model.name)}
            </button>
            <button type="button" className="btn-quiet" onClick={() => setConfirming(false)}>
              {t.cancel}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="btn-quiet machine-option-use"
          disabled={busy}
          onClick={() => setConfirming(true)}
        >
          {t.useThisModel}
        </button>
      )}
    </div>
  );
}

export function MachineCard({
  capability,
  running,
  busy,
  onChoose,
}: {
  capability: Capability;
  /** The display name of the model running right now, if the brain is up. */
  running?: string | null;
  busy?: boolean;
  onChoose?: (token: string) => void;
}) {
  const { table } = useLanguage();
  const t = table.machine;
  if (capability.kind !== "measured") {
    return <p className="surface-quiet">{t.notMeasured}</p>;
  }

  const { model, quicker, refusal } = capability;
  // The second option only exists beside a first one; `quicker` is null on
  // every path that has no pick, so this is belt and braces around a shape
  // the backend already guarantees.
  const second = model ? quicker : null;

  return (
    <section className="machine-card" aria-label={t.whatItWouldRun}>

      <p className="surface-eyebrow">
        {second ? t.whatItWouldRunPick : t.whatItWouldRun}
      </p>
      {model ? (
        <>
          <Option model={model} running={running} busy={busy} onChoose={onChoose} />
          {second ? <Option model={second} running={running} busy={busy} onChoose={onChoose} /> : null}
          <details className="machine-working">
            <summary>{t.showWorking}</summary>
            <p className="machine-working-body">{model.details}</p>
            {second ? <p className="machine-working-body">{second.details}</p> : null}
            {/* Once, under both, and in the drawer rather than on the card:
                the cache is re-read on every token, so the speeds hold at the
                length they were priced at and fall from there. On the card it
                was dev material in the middle of a choice. */}
            <p className="machine-working-body">
              {t.speedsHeld}
            </p>
          </details>
        </>
      ) : (
        <p className="surface-sentence">
          {capability.refusal_code === "catalog.nothing_fits" ||
          capability.refusal_code === "catalog.nothing_fast_enough"
            ? t.noSuitableChoice
            : refusal}
        </p>
      )}
    </section>
  );
}
