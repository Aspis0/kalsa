import { SAMPLING_KNOBS } from "./knobs/sampling";

const SAMPLING_KEY = "crescent-chat.sampling.v1";

export type Sampling = Record<string, number | null>;

function blankSampling(): Sampling {
  return Object.fromEntries(SAMPLING_KNOBS.map(({ wire }) => [wire, null]));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function storedNumber(wire: string, value: unknown): number | null {
  const knob = SAMPLING_KNOBS.find((candidate) => candidate.wire === wire);
  const number = finiteNumber(value);
  if (number === null) return null;
  if (knob?.automaticSentinels?.includes(number)) return null;
  if (knob && knob.kind === "integer" && !Number.isInteger(number)) return null;
  if (knob && (number < knob.min || number > knob.max)) return null;
  return number;
}

export function loadSampling(): Sampling {
  const empty = blankSampling();
  try {
    const raw = localStorage.getItem(SAMPLING_KEY);
    if (!raw) return empty;
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return empty;
    for (const { wire } of SAMPLING_KNOBS) empty[wire] = storedNumber(wire, parsed[wire]);
  } catch {
    return blankSampling();
  }
  return empty;
}

export function saveSampling(sampling: Sampling): boolean {
  try {
    const clean = Object.fromEntries(
      SAMPLING_KNOBS.map(({ wire }) => [wire, storedNumber(wire, sampling[wire])]),
    );
    localStorage.setItem(SAMPLING_KEY, JSON.stringify(clean));
    return true;
  } catch {
    // Private mode and unavailable storage are non-fatal.
    return false;
  }
}

export function samplingWire(sampling: Sampling): Record<string, number> {
  const wire: Record<string, number> = {};
  for (const { wire: name } of SAMPLING_KNOBS) {
    const value = storedNumber(name, sampling[name]);
    if (value !== null) wire[name] = value;
  }
  return wire;
}

function displayNumber(value: number): string {
  return String(value);
}

export function samplingProblem(sampling: Sampling): string | null {
  for (const knob of SAMPLING_KNOBS) {
    const value = sampling[knob.wire];
    if (value === null || value === undefined) continue;
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return `${knob.label} must be a finite number; got ${String(value)}.`;
    }
    if (knob.kind === "integer" && !Number.isInteger(value)) {
      return `${knob.label} must be a whole number; got ${displayNumber(value)}.`;
    }
    if (value < knob.min || value > knob.max) {
      return `${knob.label} must be between ${displayNumber(knob.min)} and ${displayNumber(knob.max)}; got ${displayNumber(value)}.`;
    }
  }
  return null;
}
