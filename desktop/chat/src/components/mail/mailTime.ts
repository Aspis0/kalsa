/**
 * When a mail arrived, the way the mockup reads it: a few minutes ago, an hour
 * ago, yesterday. A card is a glance, and an absolute timestamp is not one —
 * the Mail tab keeps the full time for when the person wants it.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function two(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/** "2 min fa" in the reader's language. Empty when the Date header was missing:
    nothing is invented for a mail whose time the mailbox never gave. */
export function stampRelative(iso: string | null, tag: string): string {
  if (iso === null) return "";
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return "";
  const ago = Date.now() - at;
  const unit = new Intl.RelativeTimeFormat(tag, { numeric: "auto" });
  if (ago < 0) return "";
  if (ago < HOUR) return unit.format(-Math.max(1, Math.round(ago / MINUTE)), "minute");
  if (ago < DAY) return unit.format(-Math.round(ago / HOUR), "hour");
  if (ago < 7 * DAY) return unit.format(-Math.round(ago / DAY), "day");
  return new Intl.DateTimeFormat(tag, { day: "numeric", month: "short" }).format(at);
}

/** The full time, for the Mail tab's header. */
export function stampFull(iso: string | null, tag: string): string {
  if (iso === null) return "";
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return "";
  const when = new Date(at);
  return `${new Intl.DateTimeFormat(tag, { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }).format(when)}`;
}

/** Kept for the card's own line: 09:14 beside a subject reads as a time of day. */
export function stampClock(iso: string | null): string {
  if (iso === null) return "";
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return "";
  return `${two(new Date(at).getHours())}:${two(new Date(at).getMinutes())}`;
}