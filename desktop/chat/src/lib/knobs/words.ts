import { knobWords } from "../../i18n/en/knobs";
import type { SamplingKnob } from "./types";
import type { English } from "../../i18n/en/all";

export type KnobWords = English["knobs"];
export { knobWords };

/** A sampling knob's words for one language. A wire the table has no row
    for falls back to English — a knob added without a row must still show
    its label. */
export function samplingWords(words: KnobWords, knob: SamplingKnob): { label: string; whatItIs: string; whatItsFor: string; usualValues: string | null } {
  return {
    label: knobWords(words, knob.wire, "label", knob.label),
    whatItIs: knobWords(words, knob.wire, "whatItIs", knob.whatItIs),
    whatItsFor: knobWords(words, knob.wire, "whatItsFor", knob.whatItsFor),
    usualValues: knob.usualValues === null ? null : knobWords(words, knob.wire, "usualValues", knob.usualValues),
  };
}

/** A launch knob's words, by the same rule. */
export function launchWords(words: KnobWords, knob: { wire: string; label: string; whatItIs: string; whatItsFor: string; usualValues: string | null }): { label: string; whatItIs: string; whatItsFor: string; usualValues: string | null } {
  return {
    label: knobWords(words, knob.wire, "label", knob.label),
    whatItIs: knobWords(words, knob.wire, "whatItIs", knob.whatItIs),
    whatItsFor: knobWords(words, knob.wire, "whatItsFor", knob.whatItsFor),
    usualValues: knob.usualValues === null ? null : knobWords(words, knob.wire, "usualValues", knob.usualValues),
  };
}

/** The group's heading. `group` is the stable id the knobs carry; the
    heading lives only in the words tables. */
export function groupWord(words: KnobWords, group: string): string {
  const named = words.groups as Record<string, string>;
  return named[group] ?? group;
}
