// The scorer (one responsibility: compare what the model did against the
// item's code-computed expectation). Verdicts per item:
//   toolChoice — right tool / wrong tool / call-where-ask-was-right /
//                no-call-where-call-was-right / no-call (right for notool)
//   fields     — per create field: right / wrong / omitted
//   window     — for reads: exact (== GT window) / covers (⊇ GT, right
//                offsets) / wrong
//   SILENT ERROR — a confident call with a wrong instant: a create whose
//                start is not the expected instant, or a read whose window
//                misses an asked day, with no UNSURE in between.
import { parseISOWithOffset } from "./validators.mjs";

/** Instant-of via the one parser (Rome-local for offset-less strings), so
 *  the HOST machine's timezone never leaks into a comparison. */
const at = (iso) => parseISOWithOffset(iso)?.instant ?? NaN;

const titleNorm = (s) =>
  String(s ?? "").toLowerCase()
    .replace(/[’']/g, "'")
    .split(/\s+/)
    .filter((w) => !["il", "lo", "la", "i", "gli", "le", "un", "uno", "una", "the", "a", "an", "di", "of", "dal", "al", "del"].includes(w))
    .join(" ")
    .trim();

/** Lenient title match: equal normalized, or one contains the other, or they
 *  share a significant token (>= 4 chars) — "Dentista" ~ "dentist
 *  appointment" via "dent*"? No: containment/token rules only, no stemming. */
export function titleMatches(delivered, expected) {
  const a = titleNorm(delivered);
  const b = titleNorm(expected);
  if (!a || !b) return false;
  if (a === b || a.includes(b) || b.includes(a)) return true;
  const ta = a.split(" ").filter((w) => w.length >= 4);
  const tb = b.split(" ").filter((w) => w.length >= 4);
  return ta.some((w) => tb.includes(w));
}
const ASK_RE = /\?|che ora|what time|which (day|time|date)|what date|quando|per quando|a che|quale (giorno|data)/i;

export function looksLikeAsk(text) {
  return ASK_RE.test(String(text ?? "").trim()) && String(text ?? "").trim().length > 0;
}

export function scoreItem({ item, calls, reply, finalArgs, outcome, lang }) {
  // calls: [{name, args}] in order (C may compute finalArgs from relative fields)
  const verdict = { kind: item.kind, toolChoice: null, fields: null, window: null, silent: false, asked: false };
  const first = calls?.[0] ?? null;
  // The turn record always has a first entry; a call happened iff it is named.
  if (!first?.name) {
    verdict.asked = looksLikeAsk(reply);
    verdict.toolChoice = item.kind === "notool" ? "right" : verdict.asked ? "ask" : "no-call";
    return verdict;
  }
  if (item.kind === "notool") {
    verdict.toolChoice = "call-where-none";
    return verdict;
  }
  if (item.kind === "clarify" || item.kind === "trap") {
    verdict.toolChoice = "call-where-ask";
    // A call on a trap is a silent error unless the call itself is impossible
    // and would have failed validation (B/C refuse it there).
    if (item.kind === "trap") verdict.silent = Boolean(finalArgs);
    return verdict;
  }
  if (item.kind === "read") {
    const right = first.name === "calendar_agenda";
    verdict.toolChoice = right ? "right" : "wrong-tool";
    if (!right || !finalArgs) return verdict;
    const from = parseISOWithOffset(finalArgs.fromISO);
    const to = parseISOWithOffset(finalArgs.toISO);
    if (!from?.exists || !to?.exists) { verdict.window = "unparseable"; verdict.silent = true; return verdict; }
    // The expected windows: normally [fromISO, toISO]; an ambiguous ask
    // carries several, one per accepted reading.
    const windows = Array.isArray(item.expect[0]) ? item.expect : [item.expect];
    verdict.noOffset = from.offset === "none" || to.offset === "none";
    for (const [ef, et] of windows) {
      if (at(finalArgs.fromISO) === at(ef) && at(finalArgs.toISO) === at(et)) {
        verdict.window = "exact";
        return verdict;
      }
    }
    // A one-second tolerance on the upper bound: a day expressed with an
    // inclusive 23:59:59 end covers the same day a midnight bound does.
    for (const [ef, et] of windows) {
      const covers =
        at(finalArgs.fromISO) <= at(ef) &&
        at(finalArgs.toISO) >= at(et) - 1000;
      if (covers) {
        verdict.window = "covers";
        verdict.widthDays = Math.round((at(finalArgs.toISO) - at(finalArgs.fromISO)) / 86400000);
        return verdict;
      }
    }
    verdict.window = "wrong";
    verdict.silent = true;
    return verdict;
  }
  // create
  const right = first.name === "create_calendar_event";
  verdict.toolChoice = right ? "right" : "wrong-tool";
  if (!right || !finalArgs) {
    // A call whose arguments never parsed is silent ONLY when it was
    // delivered; an UNSURE refusal delivered nothing.
    verdict.silent = right && outcome !== "unsure";
    return verdict;
  }
  const fields = {};
  const expectedTitle = lang === "en" && item.expect.titleEn ? item.expect.titleEn : item.expect.title;
  fields.title = finalArgs.title === undefined || finalArgs.title === null ? "omitted"
    : titleMatches(finalArgs.title, expectedTitle) ? "right" : "wrong";
  fields.start = finalArgs.start !== undefined && at(finalArgs.start) === at(item.expect.start) ? "right"
    : finalArgs.start === undefined ? "omitted" : "wrong";
  fields.end = finalArgs.end !== undefined && at(finalArgs.end) === at(item.expect.end) ? "right"
    : finalArgs.end === undefined ? "omitted" : "wrong";
  verdict.noOffset = [finalArgs.start, finalArgs.end].some((v) => parseISOWithOffset(v)?.offset === "none");
  fields.allDay = finalArgs.allDay === item.expect.allDay ? "right"
    : finalArgs.allDay === undefined ? "omitted" : "wrong";
  verdict.fields = fields;
  verdict.silent = outcome !== "unsure" && (fields.start === "wrong" || fields.allDay === "wrong" || fields.end === "wrong");
  return verdict;
}

function offsetsMatch(args, expect) {
  const off = (iso) => (/[+-]\d{2}:\d{2}$/.exec(String(iso)) ?? ["Z"])[0];
  return off(args.fromISO) === off(expect[0]) && off(args.toISO) === off(expect[1]);
}
