// The Room feed's moments, pure: the same-day check a day separator stands
// on, the label that separator shows, the clock in a bubble, the full stamp
// behind the hover, and the wait to the next local midnight. Every earlier
// moment is built as a local time, so those checks hold in whatever zone
// the bench runs in; the last section sets the zone itself, to prove the
// cached formatters and the day rule follow it.
//
// The real `src/surfaces/roomTime.ts` is imported, never copied.
//
// Run: node scripts/room-time.mjs   (from chat/)

import {
  clockTime,
  dayLabel,
  fullStamp,
  msUntilNextLocalMidnight,
  sameLocalDay,
} from "../src/surfaces/roomTime.ts";

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

// --- the wait to the next midnight: what moves the reading --------------

const justBefore = new Date(2026, 5, 15, 23, 59, 59, 500).getTime();
equal("the day change itself is the wait", msUntilNextLocalMidnight(justBefore), 500);
equal("from noon it waits the half-day", msUntilNextLocalMidnight(at(2026, 6, 15, 12, 0)), 12 * 3600 * 1000);
check(
  "a far-off moment still waits less than a day",
  msUntilNextLocalMidnight(at(2026, 6, 15, 13, 37)) <= 24 * 3600 * 1000,
  String(msUntilNextLocalMidnight(at(2026, 6, 15, 13, 37))),
);

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
equal("today in en", dayLabel(at(2026, 6, 15, 9, 0), afternoon, "en"), "Today");
equal("today in it", dayLabel(at(2026, 6, 15, 9, 0), afternoon, "it"), "Oggi");
equal("yesterday in en", dayLabel(at(2026, 6, 14, 23, 30), at(2026, 6, 15, 0, 10), "en"), "Yesterday");
equal("yesterday in it", dayLabel(at(2026, 6, 14, 23, 30), at(2026, 6, 15, 0, 10), "it"), "Ieri");
equal("yesterday across a year", dayLabel(at(2026, 12, 31, 23, 50), at(2027, 1, 1, 0, 10), "en"), "Yesterday");
// Same clock time, two days: an hours-only check says "Today", the
// calendar says yesterday.
equal("the same clock time on the eve is not today", dayLabel(at(2026, 6, 14, 15, 0), afternoon, "en"), "Yesterday");
equal("two days back keeps the weekday (en)", dayLabel(at(2026, 6, 13, 11, 0), afternoon, "en"), "Sat, Jun 13, 2026");
equal("two days back keeps the weekday (it)", dayLabel(at(2026, 6, 13, 11, 0), afternoon, "it"), "sab 13 giu 2026");
equal("six days back keeps the weekday (en)", dayLabel(at(2026, 6, 9, 11, 0), afternoon, "en"), "Tue, Jun 9, 2026");
equal("a week back drops to the plain date (en)", dayLabel(at(2026, 6, 8, 11, 0), afternoon, "en"), "Jun 8, 2026");
equal("an older day is the plain date (it)", dayLabel(at(2026, 5, 8, 11, 0), afternoon, "it"), "8 mag 2026");
equal("now is the caller's (today)", dayLabel(at(2026, 6, 15, 10, 0), at(2026, 6, 15, 18, 0), "en"), "Today");
equal("now is the caller's (a month later)", dayLabel(at(2026, 6, 15, 10, 0), at(2026, 7, 20, 18, 0), "en"), "Jun 15, 2026");
equal("a day that lies ahead claims no name", dayLabel(at(2026, 6, 16, 10, 0), afternoon, "en"), "Jun 16, 2026");

// --- the zone under it all ----------------------------------------------
// A cached formatter must not freeze the zone the reader has left: the
// clock, the date and the day rule all read the live zone.

process.env.TZ = "Europe/Rome";
equal("a summer instant in Rome", clockTime(Date.UTC(2026, 6, 15, 13, 4), "it"), "15:04");
equal("the hour the clock skipped resolves forward", clockTime(Date.UTC(2026, 2, 29, 1, 30), "it"), "03:30");
equal("a spring-forward day is 23 hours", msUntilNextLocalMidnight(new Date(2026, 2, 29, 0, 0, 0, 0).getTime()), 23 * 3600 * 1000);
check("two instants are one Rome day", sameLocalDay(Date.UTC(2026, 6, 15, 23, 30), Date.UTC(2026, 6, 16, 0, 30)));

process.env.TZ = "UTC";
equal("the cached formatter reads the new zone", clockTime(Date.UTC(2026, 6, 15, 13, 4), "it"), "13:04");
const utcFull = fullStamp(Date.UTC(2026, 6, 15, 13, 4), "en");
check("and the hover reads it too", utcFull.includes("Wednesday, July 15, 2026") && utcFull.includes("1:04"), utcFull);
check("the same instants are two UTC days", !sameLocalDay(Date.UTC(2026, 6, 15, 23, 30), Date.UTC(2026, 6, 16, 0, 30)));

console.log(fail === 0 ? "room-time: all checks passed" : `room-time: ${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
