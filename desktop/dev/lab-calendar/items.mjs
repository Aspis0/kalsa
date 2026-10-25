// The item set (one responsibility: the prompts and the CODE that computes
// each one's expected behaviour from the fixed now). Kinds:
//   read    — expected calendar_agenda window [fromISO, toISO]
//   create  — expected create_calendar_event fields (end = start+60min when
//             the person did not say one — the declared default)
//   clarify — no complete time was given; correct behaviour is to ask, no call
//   notool  — a general question; correct behaviour is no call at all
//   trap    — an impossible date/time; correct behaviour is no event (ask or
//             refuse), never a silently shifted call
// Declared interpretation rules: weekday names mean the next occurrence
// strictly after today; "this week" is Monday..Sunday of the current week;
// "the weekend" is the coming Saturday..Monday; an unspecified year is the
// current one; a create with no time and no all-day marker is a clarify.
import { NOW, WD, nextWeekday, plusDays, dayWindow, rangeWindow, romeISO } from "./now.mjs";

const today = { y: NOW.year, m: NOW.month, d: NOW.day };
const tomorrow = plusDays(today, 1);
const mondayNext = plusDays(today, 7);
const tue = nextWeekday(today, WD.tue);
const wed = nextWeekday(today, WD.wed);
const thu = nextWeekday(today, WD.thu);
const fri = nextWeekday(today, WD.fri);
const sat = nextWeekday(today, WD.sat);
const sun = nextWeekday(today, WD.sun);

const ev = (title, date, hh, mm, minutes = 60) => {
  const [eh, em] = endHM(hh, mm, minutes);
  return {
    title,
    start: romeISO(date.y, date.m, date.d, hh, mm),
    end: romeISO(date.y, date.m, date.d, eh, em),
    allDay: false,
  };
};

/** start + minutes, whole-minute. */
function endHM(hh, mm, minutes) {
  const total = hh * 60 + mm + minutes;
  return [Math.floor(total / 60), total % 60];
}

const allDay = (title, date) => ({
  title,
  start: romeISO(date.y, date.m, date.d, 0, 0),
  end: romeISO(...Object.values(plusDays(date, 1)), 0, 0),
  allDay: true,
});

export const ITEMS = [
  // ── read (12) ─────────────────────────────────────────────────────────────
  { id: "r01", kind: "read", it: "cosa ho domani?", en: "what do I have tomorrow?", expect: dayWindow(tomorrow) },
  { id: "r02", kind: "read", it: "com'è la mia settimana?", en: "what's on this week?", expect: rangeWindow(today, mondayNext) },
  // "venerdì prossimo" is genuinely ambiguous in Italian (the coming Friday
  // or next week's); either window is accepted — declared, not silently.
  { id: "r03", kind: "read", it: "venerdì prossimo sono libero?", en: "am I free next Friday?", weekdayNamed: WD.fri, expect: [dayWindow(fri), dayWindow(plusDays(fri, 7))] },
  { id: "r04", kind: "read", it: "cosa ho nel weekend?", en: "what's on this weekend?", expect: rangeWindow(sat, plusDays(sat, 2)) },
  { id: "r05", kind: "read", it: "cosa ho il 12?", en: "what's on on the 12th?", expect: dayWindow({ y: 2026, m: 10, d: 12 }) },
  { id: "r06", kind: "read", it: "cosa ho il 26 ottobre?", en: "what's on on October 26?", expect: dayWindow({ y: 2026, m: 10, d: 26 }) }, // DST: +01:00
  { id: "r07", kind: "read", it: "la prossima settimana com'è?", en: "how does next week look?", expect: rangeWindow(mondayNext, plusDays(mondayNext, 7)) },
  { id: "r08", kind: "read", it: "cosa ho sabato?", en: "what's on Saturday?", weekdayNamed: WD.sat, expect: dayWindow(sat) },
  { id: "r09", kind: "read", it: "cosa ho oggi pomeriggio?", en: "what's on this afternoon?", expect: [romeISO(today.y, today.m, today.d, 12, 0), romeISO(today.y, today.m, today.d, 23, 59)] },
  { id: "r10", kind: "read", it: "cosa ho giovedì 8?", en: "what's on Thursday the 8th?", expect: dayWindow({ y: 2026, m: 10, d: 8 }) },
  { id: "r11", kind: "read", it: "cosa ho il primo novembre?", en: "what's on on November 1st?", expect: dayWindow({ y: 2026, m: 11, d: 1 }) },
  { id: "r12", kind: "read", it: "cosa ho il 30 di questo mese?", en: "what's on on the 30th of this month?", expect: dayWindow({ y: 2026, m: 10, d: 30 }) },
  { id: "r13", kind: "read", it: "cosa ho il 25 ottobre?", en: "what's on on October 25?", expect: dayWindow({ y: 2026, m: 10, d: 25 }) }, // the DST switch day: +01:00

  // ── create (14) ───────────────────────────────────────────────────────────
  { id: "c01", kind: "create", it: "metti dentista martedì alle 15 per un'ora", en: "put dentist Tuesday at 3pm for an hour", weekdayNamed: WD.tue, expect: ev("dentista", tue, 15, 0) },
  { id: "c02", kind: "create", it: "pranzo con Ana domani all'una", en: "lunch with Ana tomorrow at 1pm", expect: ev("pranzo con Ana", tomorrow, 13, 0) },
  { id: "c03", kind: "create", it: "riunione giovedì 9:30–11", en: "meeting Thursday 9:30–11", weekdayNamed: WD.thu, expect: ev("riunione", thu, 9, 30, 90) },
  { id: "c04", kind: "create", it: "compleanno di Luca il 20 ottobre", en: "Luca's birthday on October 20", expect: allDay("compleanno di Luca", { y: 2026, m: 10, d: 20 }) },
  { id: "c05", kind: "create", it: "call con il team domani alle 17:30", en: "team call tomorrow at 5:30pm", expect: ev("call con il team", tomorrow, 17, 30) },
  { id: "c06", kind: "create", it: "dal dottore mercoledì mattina alle 10", en: "doctor Wednesday morning at 10", weekdayNamed: WD.wed, expect: ev("dal dottore", wed, 10, 0) },
  { id: "c07", kind: "create", it: "cena con Marco venerdì sera alle 20", en: "dinner with Marco Friday evening at 8pm", weekdayNamed: WD.fri, expect: ev("cena con Marco", fri, 20, 0) },
  { id: "c08", kind: "create", it: "videochiamata sabato alle 11 per 45 minuti", en: "video call Saturday at 11 for 45 minutes", weekdayNamed: WD.sat, expect: ev("videochiamata", sat, 11, 0, 45) },
  { id: "c09", kind: "create", it: "appuntamento dal barbiere il 15 ottobre alle 16", en: "barber appointment October 15 at 4pm", expect: ev("barbiere", { y: 2026, m: 10, d: 15 }, 16, 0) },
  { id: "c10", kind: "create", it: "workshop il 3 novembre dalle 9 alle 17", en: "workshop on November 3 from 9 to 5", expect: ev("workshop", { y: 2026, m: 11, d: 3 }, 9, 0, 480) },
  { id: "c11", kind: "create", it: "ricordami la call il 27 ottobre alle 15", en: "remind me about the call on October 27 at 3pm", expect: ev("call", { y: 2026, m: 10, d: 27 }, 15, 0) }, // after DST: +01:00
  { id: "c12", kind: "create", it: "commissioni domenica pomeriggio alle 16:15", en: "errands Sunday afternoon at 4:15pm", weekdayNamed: WD.sun, expect: ev("commissioni", sun, 16, 15) },
  { id: "c13", kind: "create", it: "esame il 2 dicembre alle 9 per due ore", en: "exam on December 2 at 9am for two hours", expect: ev("esame", { y: 2026, m: 12, d: 2 }, 9, 0, 120) },
  { id: "c14", kind: "create", it: "allenamento domattina alle 7:30", en: "workout tomorrow morning at 7:30", expect: ev("allenamento", tomorrow, 7, 30) },
  { id: "c15", kind: "create", it: "pulizia dei denti il 5 novembre alle 10", en: "dental cleaning on November 5 at 10am", expect: ev("pulizia dei denti", { y: 2026, m: 11, d: 5 }, 10, 0) }, // +01:00

  // ── clarify (5) ───────────────────────────────────────────────────────────
  { id: "q01", kind: "clarify", it: "fissa una riunione", en: "set up a meeting" },
  { id: "q02", kind: "clarify", it: "metti un appuntamento dal medico", en: "book a doctor's appointment" },
  { id: "q03", kind: "clarify", it: "domani pomeriggio", en: "tomorrow afternoon" },
  { id: "q04", kind: "clarify", it: "prenota una cena", en: "arrange a dinner" },
  { id: "q05", kind: "clarify", it: "metti la presentazione la settimana prossima", en: "schedule the presentation next week" },
  { id: "q06", kind: "clarify", it: "organizza una call con Giulia", en: "organize a call with Giulia" },

  // ── no-tool (9) ───────────────────────────────────────────────────────────
  { id: "n01", kind: "notool", it: "quanto fa 17 per 24?", en: "what is 17 times 24?" },
  { id: "n02", kind: "notool", it: "chi era Leonardo da Vinci?", en: "who was Leonardo da Vinci?" },
  { id: "n03", kind: "notool", it: "traduci 'buongiorno' in francese", en: "translate 'good morning' into French" },
  { id: "n04", kind: "notool", it: "quanti giorni ha febbraio?", en: "how many days does February have?" },
  { id: "n05", kind: "notool", it: "dammi una ricetta per la carbonara", en: "give me a recipe for carbonara" },
  { id: "n06", kind: "notool", it: "che differenza c'è tra RAM e ROM?", en: "what's the difference between RAM and ROM?" },
  { id: "n07", kind: "notool", it: "scrivi una frase sul mare", en: "write a sentence about the sea" },
  { id: "n08", kind: "notool", it: "qual è la capitale del Portogallo?", en: "what's the capital of Portugal?" },
  { id: "n09", kind: "notool", it: "come si legge un file .ics?", en: "how do you read a .ics file?" },
  { id: "n10", kind: "notool", it: "quanti sono 15% di 80?", en: "what is 15% of 80?" },

  // ── traps (4) ─────────────────────────────────────────────────────────────
  { id: "t01", kind: "trap", it: "metti una cena il 31 novembre alle 20", en: "put a dinner on November 31 at 8pm" },
  { id: "t02", kind: "trap", it: "ricordami di chiamare ieri alle 25:00", en: "remind me to call yesterday at 25:00" },
  { id: "t03", kind: "trap", it: "metti la call il 30 febbraio alle 10", en: "schedule the call on February 30 at 10am" },
  { id: "t04", kind: "trap", it: "prenota il dentista il 32 ottobre", en: "book the dentist on October 32" },
];

/** The expected title per language: the GT titles are Italian; the English
 *  prompts are matched against these (lenient matcher in score.mjs). */
const TITLE_EN = {
  c01: "dentist", c02: "lunch with Ana", c03: "meeting", c04: "Luca's birthday",
  c05: "team call", c06: "doctor", c07: "dinner with Marco", c08: "video call",
  c09: "barber", c10: "workshop", c11: "call", c12: "errands", c13: "exam",
  c14: "workout", c15: "dental cleaning",
};
for (const item of ITEMS) if (item.kind === "create") item.expect.titleEn = TITLE_EN[item.id];

/** The smoke subset: one create, one read, one no-tool. */
export const SMOKE_IDS = ["c01", "r01", "n01"];

export const itemFor = (id) => ITEMS.find((i) => i.id === id);

/** The prompt as sent: odd-numbered items Italian, even English, evenly
 *  spread within every kind. promptFor returns the text, langFor the code. */
export function langFor(item) {
  return Number(item.id.slice(1)) % 2 === 1 ? "it" : "en";
}
export function promptFor(item) {
  return langFor(item) === "it" ? item.it : item.en;
}
