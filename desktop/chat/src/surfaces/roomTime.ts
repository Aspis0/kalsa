// The room feed's moments: the clock on a bubble, the full stamp behind
// the hover, and the calendar-day rule that cuts the feed into days. Pure —
// a script drives these without React, and "now" is always the caller's.

/** The reader's own calendar day as a day number: the local year, month
    and day mapped onto UTC, so two moments of one local day share the
    number and consecutive days differ by exactly one — no DST hour can
    bend the count. */
function localDay(when: number): number {
  const date = new Date(when);
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000;
}

/** Whether two moments fall on the same calendar day, the reader's own
    time zone. */
export function sameLocalDay(a: number, b: number): boolean {
  return localDay(a) === localDay(b);
}

/** Milliseconds from `now` to the next local midnight: the reading the day
    labels stand on moves then. */
export function msUntilNextLocalMidnight(now: number): number {
  const date = new Date(now);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime() - now;
}

type FormatKind = "clock" | "full" | "day" | "recent";

/** The moment's own wall clock, as a UTC timestamp. Formatting this in UTC
    prints what the reader's zone would, moment by moment: a cached
    formatter can never freeze a zone the reader has left. */
function localInstant(when: number): number {
  return when - new Date(when).getTimezoneOffset() * 60_000;
}

const FORMAT_OPTIONS: Record<FormatKind, Intl.DateTimeFormatOptions> = {
  clock: { timeStyle: "short", timeZone: "UTC" },
  full: { dateStyle: "full", timeStyle: "short", timeZone: "UTC" },
  day: { dateStyle: "medium", timeZone: "UTC" },
  // "medium" plus the weekday, spelled out component by component: Intl
  // refuses dateStyle beside weekday, and a hand-built separator would be
  // wrong in half the languages.
  recent: { weekday: "short", year: "numeric", month: "short", day: "numeric", timeZone: "UTC" },
};

const formatters = new Map<string, Intl.DateTimeFormat>();
const relatives = new Map<string, Intl.RelativeTimeFormat>();
const segmenters = new Map<string, Intl.Segmenter>();

/** One formatter per kind and language: the whole feed re-renders on every
    streamed delta, and building an Intl formatter per row per render is
    the cost the reader feels. */
function formatter(kind: FormatKind, tag: string): Intl.DateTimeFormat {
  const key = `${kind}\u0000${tag}`;
  let found = formatters.get(key);
  if (!found) {
    found = new Intl.DateTimeFormat(tag, FORMAT_OPTIONS[kind]);
    formatters.set(key, found);
  }
  return found;
}

/** The first grapheme upper-cased in the label's own language, the rest of
    the label untouched — a plain date ("8 mag 2026") must never be
    transformed. */
function sentenceCase(label: string, tag: string): string {
  let segmenter = segmenters.get(tag);
  if (!segmenter) {
    segmenter = new Intl.Segmenter(tag, { granularity: "grapheme" });
    segmenters.set(tag, segmenter);
  }
  for (const part of segmenter.segment(label)) {
    return part.segment.toLocaleUpperCase(tag) + label.slice(part.segment.length);
  }
  return label;
}

/** Today and yesterday in the reader's own words, cached per language. */
function relativeDay(days: number, tag: string): string {
  let found = relatives.get(tag);
  if (!found) {
    found = new Intl.RelativeTimeFormat(tag, { numeric: "auto" });
    relatives.set(tag, found);
  }
  return sentenceCase(found.format(days, "day"), tag);
}

/** The hour and minute on a bubble, in the language's own 12/24-hour
    convention. */
export function clockTime(when: number, tag: string): string {
  try {
    return formatter("clock", tag).format(localInstant(when));
  } catch {
    return "";
  }
}

/** The whole moment — full date and time — for the hover. */
export function fullStamp(when: number, tag: string): string {
  try {
    return formatter("full", tag).format(localInstant(when));
  } catch {
    return "";
  }
}

/** What day a message belongs to, in words: today and yesterday by their
    Intl names in every language, the last week by its weekday, anything
    older as the plain date. `now` is the caller's, so a bench can stand on
    any day it likes. */
export function dayLabel(when: number, now: number, tag: string): string {
  try {
    const days = localDay(when) - localDay(now);
    if (days === 0 || days === -1) return relativeDay(days, tag);
    const kind = days <= -2 && days >= -6 ? "recent" : "day";
    return formatter(kind, tag).format(localInstant(when));
  } catch {
    return "";
  }
}
