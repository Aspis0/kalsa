// The Room feed's moments, pure: the same-day check a day separator stands
// on, the label that separator shows, the clock in a bubble and the full
// stamp behind the hover. Every moment is built as a local time, so the
// checks hold in whatever zone the bench runs in; "now" is always passed
// in, and the labels are asserted in the two languages the owner reads.
//
// The real `src/surfaces/roomTime.ts` is imported, never copied.
//
// Run: node scripts/room-time.mjs   (from chat/)

import { clockTime, dayLabel, fullStamp, sameLocalDay } from "../src/surfaces/roomTime.ts";

let fail = 0;
function check(label, condition, detail) {
  const ok = condition ? "ok  " : "FAIL";
  if (!condition) fail++;
  console.log(`${ok} ${label}${condition || detail === undefined ? "" : `\n     ${detail}`}`);
}
function equal(label, actual, expected) {
  check(label, actual === expected, `got ${JSON.stringify(actual)}\n     want ${JSON.stringify(expected)}`);
}

/// One local moment, month 1-12.
const at = (year, month, day, hour = 12, minute = 0) =>
  new Date(year, month - 1, day, hour, minute).getTime();

// --- the same-day check: what a day separator stands on -----------------

check("one local day, its first and last minute", sameLocalDay(at(2026, 6, 15, 0, 0), at(2026, 6, 15, 23, 59)));
check("crossing midnight is two days", !sameLocalDay(at(2026, 6, 15, 23, 59), at(2026, 6, 16, 0, 0)));
// An hours-only comparison calls this pair one day; the calendar says two.
check("the same hour on different days is two days", !sameLocalDay(at(2026, 6, 15, 10, 0), at(2026, 6, 16, 10, 0)));
check("a year change is two days", !sameLocalDay(at(2026, 12, 31, 23, 0), at(2027, 1, 1, 1, 0)));

// --- the clock in the bubble -------------------------------------------

equal("it keeps 24 hours", clockTime(at(2026, 6, 15, 15, 4), "it"), "15:04");
equal("it pads the small hours", clockTime(at(2026, 6, 15, 0, 4), "it"), "00:04");
const enAfternoon = clockTime(at(2026, 6, 15, 15, 4), "en");
check("en speaks 12 hours", /^3:04[\s\u202f\u00a0]PM$/u.test(enAfternoon), enAfternoon);
const enMidnight = clockTime(at(2026, 6, 15, 0, 4), "en");
check("en's midnight is 12 AM", /^12:04[\s\u202f\u00a0]AM$/u.test(enMidnight), enMidnight);

// --- the full stamp behind the hover -----------------------------------

const moment = at(2026, 6, 15, 15, 4);
const enFull = fullStamp(moment, "en");
const itFull = fullStamp(moment, "it");
check("en's hover names the whole day", enFull.includes("Monday, June 15, 2026"), enFull);
check("en's hover carries the time", enFull.includes("3:04"), enFull);
check("it's hover names the whole day", itFull.includes("lunedì 15 giugno 2026"), itFull);
check("it's hover carries the time", itFull.includes("15:04"), itFull);

// --- the day label on a separator --------------------------------------

const afternoon = at(2026, 6, 15, 15, 0);
equal("today in en", dayLabel(at(2026, 6, 15, 9, 0), afternoon, "en"), "today");
equal("today in it", dayLabel(at(2026, 6, 15, 9, 0), afternoon, "it"), "oggi");
equal("yesterday in en", dayLabel(at(2026, 6, 14, 23, 30), at(2026, 6, 15, 0, 10), "en"), "yesterday");
equal("yesterday in it", dayLabel(at(2026, 6, 14, 23, 30), at(2026, 6, 15, 0, 10), "it"), "ieri");
equal("yesterday across a year", dayLabel(at(2026, 12, 31, 23, 50), at(2027, 1, 1, 0, 10), "en"), "yesterday");
// Same clock time, two days: an hours-only check says "today", the
// calendar says yesterday.
equal("the same clock time on the eve is not today", dayLabel(at(2026, 6, 14, 15, 0), afternoon, "en"), "yesterday");
equal("two days back keeps the weekday (en)", dayLabel(at(2026, 6, 13, 11, 0), afternoon, "en"), "Sat, Jun 13, 2026");
equal("two days back keeps the weekday (it)", dayLabel(at(2026, 6, 13, 11, 0), afternoon, "it"), "sab 13 giu 2026");
equal("six days back keeps the weekday (en)", dayLabel(at(2026, 6, 9, 11, 0), afternoon, "en"), "Tue, Jun 9, 2026");
equal("a week back drops to the plain date (en)", dayLabel(at(2026, 6, 8, 11, 0), afternoon, "en"), "Jun 8, 2026");
equal("an older day is the plain date (it)", dayLabel(at(2026, 5, 8, 11, 0), afternoon, "it"), "8 mag 2026");
equal("now is the caller's (today)", dayLabel(at(2026, 6, 15, 10, 0), at(2026, 6, 15, 18, 0), "en"), "today");
equal("now is the caller's (a month later)", dayLabel(at(2026, 6, 15, 10, 0), at(2026, 7, 20, 18, 0), "en"), "Jun 15, 2026");
equal("a day that lies ahead claims no name", dayLabel(at(2026, 6, 16, 10, 0), afternoon, "en"), "Jun 16, 2026");

console.log(fail === 0 ? "room-time: all checks passed" : `room-time: ${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
