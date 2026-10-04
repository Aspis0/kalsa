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

type FormatKind = "clock" | "full" | "day" | "recent";

const FORMAT_OPTIONS: Record<FormatKind, Intl.DateTimeFormatOptions> = {
  clock: { timeStyle: "short" },
  full: { dateStyle: "full", timeStyle: "short" },
  day: { dateStyle: "medium" },
  // "medium" plus the weekday, spelled out component by component: Intl
  // refuses dateStyle beside weekday, and a hand-built separator would be
  // wrong in half the languages.
  recent: { weekday: "short", year: "numeric", month: "short", day: "numeric" },
};

const formatters = new Map<string, Intl.DateTimeFormat>();

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

/** The hour and minute on a bubble, in the language's own 12/24-hour
    convention. */
export function clockTime(when: number, tag: string): string {
  try {
    return formatter("clock", tag).format(when);
  } catch {
    return "";
  }
}

/** The whole moment — full date and time — for the hover. */
export function fullStamp(when: number, tag: string): string {
  try {
    return formatter("full", tag).format(when);
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
    if (days === 0 || days === -1) {
      return new Intl.RelativeTimeFormat(tag, { numeric: "auto" }).format(days, "day");
    }
    const kind = days <= -2 && days >= -6 ? "recent" : "day";
    return formatter(kind, tag).format(when);
  } catch {
    return "";
  }
}
