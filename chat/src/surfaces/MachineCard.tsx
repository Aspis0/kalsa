import "./surfaces.css";
import "./BrainSurface.css";

/** One of the two the page offers. Both are the same shape by construction:
    the backend builds them from the same row type. */
export interface ModelOption {
  name: string;
  quant: string;
  weights_bytes: number;
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
  reason: string; // one or two sentences, already written for a human
  details: string; // the full working, technical
}

/** What `brain_capability` answers: this computer, and what the chooser picked. */
export type Capability =
  | { kind: "unmeasured" }
  | {
      kind: "measured";
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
    };

type Machine = Extract<Capability, { kind: "measured" }>["machine"];
type Speed = ModelOption["speed"];

// One byte formatter for the page. The divisor is binary and so is the LABEL:
// the catalog's own working text, one click below on the same card, prints
// these same quantities as GiB, and printing "12.8 GB" over "12.75 GiB" is
// two labels for one quantity. One decimal above a gibibyte, MiB below, and
// no decimal where it would say nothing.
const GIB = 1024 ** 3;
const MIB = 1024 ** 2;

function bytesText(bytes: number): string {
  if (bytes < GIB) return `${Math.round(bytes / MIB)} MiB`;
  const value = bytes / GIB;
  return `${Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1)} GiB`;
}

// A memory RATE is decimal, because every figure it will ever be compared
// against is: Apple says 400 GB/s, the fit says 197 GB/s, the probe reports
// GB/s. Dividing those bytes by 1024^3 and writing "GB/s" printed 183.5 for
// a 197 GB/s machine — a number that appears nowhere else, and the shot
// fixture had been bent to 183.5 to match it.
function rateText(bytesPerSecond: number): string {
  const value = bytesPerSecond / 1e9;
  return `${Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1)} GB/s`;
}

// One speed formatter, following the Server page's convention. A measured
// rate keeps its figure here and names its machine in the detail line: it is
// a fact about one computer, never a property of the model.
function speedText(speed: Speed): string {
  switch (speed.shape) {
    case "range":
      return `${speed.low.toFixed(1)}–${speed.high.toFixed(1)} tokens/s`;
    case "at_least":
      return `At least ${speed.value.toFixed(1)} tokens/s`;
    case "measured":
      return `${speed.value.toFixed(1)} tokens/s`;
  }
}

function speedDetail(speed: Speed): string {
  switch (speed.shape) {
    case "range":
      return "estimated from memory speed";
    case "at_least":
      return "a lower bound, not a prediction";
    case "measured":
      return `measured on ${speed.machine}`;
  }
}

// "This computer" in one breath, with the numbers inside it. Two facts are
// load-bearing and survive any shortening: a rate taken on a slower path than
// the model will use is a floor and is said as one ("at least"), never as a
// figure the machine may not reach; and a graphics card whose memory could not
// be read is not counted in the budget, which changes what the number means.
function machineSentence(machine: Machine): string {
  const parts = [
    `${bytesText(machine.ram_bytes)} of memory, ${bytesText(machine.budget_bytes)} free for a model, ` +
      `running on ${machine.runs_on}.`,
  ];
  if (!machine.gpu_accounted_for) {
    parts.push("The graphics card's memory could not be read, so it is not counted.");
  }
  const rate = rateText(machine.bandwidth_bytes_per_second);
  parts.push(
    {
      measured: `Memory speed was measured at ${rate} — the path a model would use.`,
      floor: `Memory speed was measured on the processor: at least ${rate}, and a model would run on something faster.`,
      chip: `Memory reaches about ${rate} where a model decodes — this chip's published figure, at the share one like it was measured at.`,
    }[machine.bandwidth_basis],
  );
  return parts.join(" ");
}

// What the model's detail line says. The context appears only when the
// machine funds one: `funded_context` answers None for a row that fits with
// nothing left over, and "null tokens of context" is not a fact to print.
function modelDetail(model: ModelOption): string {
  const held = `${model.quant} · ${bytesText(model.weights_bytes)} on disk`;
  // "up to": the figure is the largest context the memory funds, and the
  // speed beside it is priced at a much shorter conversation. Saying it flat
  // would put two numbers on one line that cannot both hold at once.
  const context =
    typeof model.context_tokens === "number"
      ? ` · up to ${model.context_tokens.toLocaleString()} tokens of context`
      : "";
  return `${held}${context} · ${speedDetail(model.speed)}`;
}

// The machine card: the numbers the chooser used, and the model it chose. It is
// the reason the Models page may say a model is picked automatically — the value
// chosen is on the home page, in the open, before anyone thinks of overriding
// it. Rendering only: the read belongs to the caller.
// One option, on three tight lines: what it is and how fast, what it costs on
// disk and where the speed comes from, and why you would take this one. Three
// lines because the page also has to hold the writing bar above the fold.
function Option({ model }: { model: ModelOption }) {
  return (
    <div className="machine-option">
      <p className="machine-option-head">
        <strong className="machine-option-name">{model.name}</strong>
        <span className="machine-option-speed">{speedText(model.speed)}</span>
      </p>
      <p className="machine-option-detail">{modelDetail(model)}</p>
      <p className="machine-option-reason">{model.reason}</p>
    </div>
  );
}

export function MachineCard({ capability }: { capability: Capability }) {
  if (capability.kind === "unmeasured") {
    return (
      <p className="surface-quiet">
        This computer has not been measured yet; turning the assistant on measures it.
      </p>
    );
  }

  const { machine, model, quicker, refusal } = capability;
  // The second option only exists beside a first one; `quicker` is null on
  // every path that has no pick, so this is belt and braces around a shape
  // the backend already guarantees.
  const second = model ? quicker : null;

  return (
    <section className="machine-card" aria-label="This computer and what it would run">
      <p className="surface-eyebrow">This computer</p>
      <p className="surface-sentence">{machineSentence(machine)}</p>

      <p className="surface-eyebrow">{second ? "What it would run — two options" : "What it would run"}</p>
      {model ? (
        <>
          <Option model={model} />
          {second ? <Option model={second} /> : null}
          {/* Said once, under both: the cache is re-read on every token, so
              the speeds above hold at the length they were priced at and
              fall from there. Repeating it per option would double a
              sentence that is about the machine, not about either model. */}
          <p className="surface-quiet">
            Predicted speeds are for a {model.speed_context_tokens.toLocaleString()}-token
            conversation and fall as it grows. A measured one was taken on its own machine and
            says so.
          </p>
          <details className="machine-working">
            <summary>Show the working</summary>
            <p className="machine-working-body">{model.details}</p>
            {second ? <p className="machine-working-body">{second.details}</p> : null}
          </details>
        </>
      ) : (
        <p className="surface-sentence">{refusal}</p>
      )}
    </section>
  );
}
