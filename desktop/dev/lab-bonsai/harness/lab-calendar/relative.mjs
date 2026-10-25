// Condition C's code half (one responsibility: turn the relative fields the
// model filled into the same ISO instants condition A/B's tools carry). The
// rules are the declared ones from items.mjs, applied by code: weekday names
// are the next occurrence strictly after today; "date" uses the date field;
// the offset is Rome's for that date.
import { NOW, WD, nextWeekday, plusDays, romeISO } from "./now.mjs";

const BY_NAME = { today: -1, tomorrow: -2, monday: WD.mon, tuesday: WD.tue, wednesday: WD.wed, thursday: WD.thu, friday: WD.fri, saturday: WD.sat, sunday: WD.sun };

/** Returns { start, end, allDay } or { error } — code decides, never guesses. */
export function instantsFrom(args) {
  const today = { y: NOW.year, m: NOW.month, d: NOW.day };
  let date = null;
  if (args?.day === "today") date = today;
  else if (args?.day === "tomorrow") date = plusDays(today, 1);
  else if (args?.day === "date") {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(args?.date ?? ""));
    if (!m) return { error: "date mancante o malformata" };
    const [, y, mo, d] = m;
    const dim = new Date(Date.UTC(+y, +mo, 0)).getUTCDate();
    if (+d > dim || +mo > 12) return { error: `la data ${args.date} non esiste` };
    date = { y: +y, m: +mo, d: +d };
  } else if (args?.day && BY_NAME[args.day] !== undefined) {
    date = nextWeekday(today, BY_NAME[args.day]);
    // "next" week shifts a weekday one week forward when the coming one is
    // still this week — the declared reading of "venerdì della prossima settimana".
    if (args?.week === "next" && new Date(Date.UTC(date.y, date.m - 1, date.d)).getTime() <
        Date.UTC(today.y, today.m - 1, today.d + (7 - ((NOW.weekday + 6) % 7)))) {
      date = plusDays(date, 7);
    }
  } else {
    return { error: "day mancante o non riconosciuto" };
  }
  if (args?.allDay === true) {
    return {
      start: romeISO(date.y, date.m, date.d, 0, 0),
      end: romeISO(...Object.values(plusDays(date, 1)), 0, 0),
      allDay: true,
    };
  }
  const t = /^(\d{1,2}):(\d{2})$/.exec(String(args?.time ?? ""));
  if (!t) return { error: "time mancante o malformata per un evento non giornata" };
  const [, hh, mi] = t;
  if (+hh > 23 || +mi > 59) return { error: `l'ora ${args.time} non esiste` };
  const minutes = typeof args?.durationMinutes === "number" && args.durationMinutes > 0 ? args.durationMinutes : 60;
  const total = +hh * 60 + +mi + minutes;
  const endDate = total >= 1440 ? plusDays(date, Math.floor(total / 1440)) : date;
  const [eh, em] = [Math.floor((total % 1440) / 60), total % 60];
  return {
    start: romeISO(date.y, date.m, date.d, +hh, +mi),
    end: romeISO(endDate.y, endDate.m, endDate.d, eh, em),
    allDay: false,
  };
}
