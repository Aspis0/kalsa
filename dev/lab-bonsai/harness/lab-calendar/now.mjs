// The lab's clock (one responsibility: the fixed "now" and every date fact
// the ground truth is computed from — never by hand). Europe/Rome, DST-aware:
// Rome is +02:00 until 2026-10-25 (the switch Sunday) and +01:00 after.

export const NOW = {
  iso: "2026-10-05T10:00:00+02:00",
  year: 2026, month: 10, day: 5, hour: 10, minute: 0,
  weekday: 1, // Monday
  zone: "Europe/Rome",
};

/** The day-of-month of a month's last Sunday. */
function lastSundayDay(y, m) {
  const last = new Date(Date.UTC(y, m, 0)); // the month's last day
  return last.getUTCDate() - ((last.getUTCDay() + 7) % 7);
}

/** Rome's UTC offset in minutes for a local date-TIME. CEST (+120) from
 *  02:00 on the last Sunday of March until 03:00 on the last Sunday of
 *  October; the switch hours themselves belong to the incoming side
 *  (02:00–03:00 on the October Sunday does not exist as local time, and any
 *  instant written there is read as +01:00). */
export function romeOffsetMinutes(y, m, d, hh = 0, mm = 0) {
  if (m >= 4 && m <= 9) return 120;
  if (m === 10) {
    if (d < lastSundayDay(y, 10)) return 120;
    if (d > lastSundayDay(y, 10)) return 60;
    return hh < 3 ? 120 : 60; // the switch is AT 03:00 local
  }
  if (m === 3) {
    if (d < lastSundayDay(y, 3)) return 60;
    if (d > lastSundayDay(y, 3)) return 120;
    return hh < 2 ? 60 : 120; // springs forward AT 02:00 local
  }
  return 60;
}

/** A local Rome date-time as an ISO string with its own offset. */
export function romeISO(y, m, d, hh = 0, mm = 0) {
  const off = romeOffsetMinutes(y, m, d, hh, mm);
  const sign = off < 0 ? "-" : "+";
  const oh = String(Math.floor(Math.abs(off) / 60)).padStart(2, "0");
  const om = String(Math.abs(off) % 60).padStart(2, "0");
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00${sign}${oh}:${om}`;
}

const DAY = 86400000;

/** The next local date strictly after `now` whose weekday matches (0=Sun). */
export function nextWeekday(after, weekday) {
  let { y, m, d } = after;
  for (let i = 1; i <= 14; i += 1) {
    const t = new Date(Date.UTC(y, m - 1, d + i));
    if (t.getUTCDay() === weekday) {
      return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
    }
  }
  throw new Error("unreachable");
}

export const WD = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

/** Date arithmetic on {y,m,d} in whole local days. */
export function plusDays(base, n) {
  const t = new Date(Date.UTC(base.y, base.m - 1, base.d + n));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

/** One local day as a [fromISO, toISO] window at midnight bounds. */
export function dayWindow(date) {
  return [romeISO(date.y, date.m, date.d, 0, 0), romeISO(...Object.values(plusDays(date, 1)), 0, 0).slice(0)];
}

/** A [fromISO, toISO] window from two local dates, both at midnight. */
export function rangeWindow(from, to) {
  return [
    romeISO(from.y, from.m, from.d, 0, 0),
    romeISO(to.y, to.m, to.d, 0, 0),
  ];
}

/** Compare two ISO instants by instant, not by representation. */
export function sameInstant(a, b) {
  return Date.parse(a) === Date.parse(b);
}
