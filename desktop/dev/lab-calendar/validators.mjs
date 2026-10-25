// Condition B's code half (one responsibility: decide whether a proposed
// create/agenda call is internally consistent — never whether it matches the
// ground truth). Checks: ISO parses with an offset; end after start; the
// calendar date exists; within ±400 days of the fixed now; when the item
// NAMED a weekday (a lexical fact, not ground truth), the date IS it.
import { NOW, romeOffsetMinutes } from "./now.mjs";

const ISO = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(Z|[+-]\d{2}:\d{2})?$/;

/** One ISO instant, offset-less strings read as Rome-local — exactly what the
 *  phone's executor does (`new Date(raw)` parses them as device-local), so a
 *  no-offset call is VALID there and must be here too. Returns
 *  { exists, instant, y, m, d, hh, mi, offset: "none" | "+HH:MM" | "Z" }. */
export function parseISOWithOffset(value) {
  const m = ISO.exec(String(value ?? ""));
  if (!m) return null;
  const [, y, mo, d, hh, mi, ss, off] = m;
  const daysInMonth = new Date(Date.UTC(+y, +mo, 0)).getUTCDate();
  if (+mo < 1 || +mo > 12 || +d < 1 || +d > daysInMonth) return { exists: false };
  if (+hh > 23 || +mi > 59) return { exists: false };
  let suffix = off ?? "";
  if (!off) {
    const rome = romeOffsetMinutes(+y, +mo, +d, +hh, +mi);
    const sign = rome < 0 ? "-" : "+";
    suffix = `${sign}${String(Math.floor(Math.abs(rome) / 60)).padStart(2, "0")}:${String(Math.abs(rome) % 60).padStart(2, "0")}`;
  }
  const t = Date.parse(`${y}-${mo}-${d}T${hh}:${mi}:${ss ?? "00"}${suffix}`);
  return Number.isFinite(t)
    ? { exists: true, instant: t, y: +y, m: +mo, d: +d, hh: +hh, mi: +mi, offset: off ?? "none" }
    : null;
}

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

/** All mechanical checks over one create_calendar_event proposal. */
export function validateCreate(args, { weekdayNamed } = {}) {
  const failures = [];
  const start = parseISOWithOffset(args?.start);
  const end = parseISOWithOffset(args?.end);
  if (start === null || start?.exists === false) failures.push("lo start non è un istante ISO valido");
  if (end === null || end?.exists === false) failures.push("l'end non è un istante ISO valido");
  if (start?.exists && end?.exists && end.instant <= start.instant) failures.push("l'end non è dopo lo start");
  if (typeof args?.allDay !== "boolean") failures.push("allDay deve essere vero o falso");
  const NOW_MS = Date.parse(NOW.iso);
  if (start?.exists) {
    if (Math.abs(start.instant - NOW_MS) > 400 * 86400000) failures.push("la data è a più di 400 giorni da oggi");
    if (weekdayNamed !== undefined) {
      const wd = new Date(Date.UTC(start.y, start.m - 1, start.d)).getUTCDay();
      if (wd !== weekdayNamed) {
        failures.push(`il giorno richiesto era ${WEEKDAYS[weekdayNamed]} ma la data è di ${WEEKDAYS[wd]}`);
      }
    }
  }
  return failures;
}

/** The agenda window's own sanity (ISO, order, near now). */
export function validateAgenda(args) {
  const failures = [];
  const from = parseISOWithOffset(args?.fromISO);
  const to = parseISOWithOffset(args?.toISO);
  if (from === null || from?.exists === false) failures.push("fromISO non è un istante ISO valido");
  if (to === null || to?.exists === false) failures.push("toISO non è un istante ISO valido");
  if (from?.exists && to?.exists && to.instant <= from.instant) failures.push("toISO non è dopo fromISO");
  const NOW_MS = Date.parse(NOW.iso);
  if (from?.exists && Math.abs(from.instant - NOW_MS) > 400 * 86400000) {
    failures.push("fromISO è a più di 400 giorni da oggi");
  }
  return failures;
}

/** The re-ask, naming the failed checks. */
export function reaskPrompt(failures) {
  return (
    "La chiamata che hai fatto non supera questi controlli: " + failures.join("; ") +
    ". Rileggi la richiesta e ridammi SOLO la chiamata corretta; se la richiesta " +
    "nomina un giorno o un'ora impossibile, rispondi chiedendo la data corretta " +
    "senza chiamare nessuno strumento."
  );
}
