// The date a user turn was sent: English words, local day, carried on that turn
// as stored. Driven through the real `sentDatePhrase`, `buildPinnedContext` and
// `createStore`, not copies of them.
//
// The two invariants the prefix cache needs: the system prompt is the same bytes
// on two different days, and a stored turn goes out as it was sent, whatever the
// clock says on the day it goes out again.
//
// Run: node scripts/sent-date.mjs   (from chat/)

import { rm } from "node:fs/promises";
import { loadApp } from "./lib/app-bundle.mjs";

let fail = 0;
function check(label, condition, detail) {
  const ok = condition ? "ok  " : "FAIL";
  if (!condition) fail++;
  console.log(`${ok} ${label}${condition || detail === undefined ? "" : `\n     ${detail}`}`);
}
function equal(label, actual, expected) {
  check(
    label,
    JSON.stringify(actual) === JSON.stringify(expected),
    `got ${JSON.stringify(actual)}\n     want ${JSON.stringify(expected)}`,
  );
}

// Replaces the clock for one synchronous call: `new Date()` and `Date.now()`
// both read `iso`. The app's code, if it reads the clock anywhere on the wire,
// now reads a fixed day, and two days give two answers.
const RealDate = Date;
function onDay(iso, fn) {
  const fixed = new RealDate(iso).getTime();
  globalThis.Date = class extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(fixed);
      else super(...args);
    }
    static now() {
      return fixed;
    }
  };
  try {
    return fn();
  } finally {
    globalThis.Date = RealDate;
  }
}

// The store reads and writes localStorage; a plain map is enough for one run.
class MemoryStorage {
  constructor() {
    this.map = new Map();
  }
  getItem(key) {
    return this.map.has(key) ? this.map.get(key) : null;
  }
  setItem(key, value) {
    this.map.set(key, String(value));
  }
  removeItem(key) {
    this.map.delete(key);
  }
  key(index) {
    return [...this.map.keys()][index] ?? null;
  }
  get length() {
    return this.map.size;
  }
}
globalThis.localStorage = new MemoryStorage();

let dir = null;
try {
  const loaded = await loadApp();
  dir = loaded.dir;
  const { buildPinnedContext, estTokens, sentDatePhrase, createStore } = loaded.app;

  // Local midday, so the day is the same in every timezone the check runs in.
  const THURSDAY = new RealDate(2026, 9, 8, 12).getTime();
  equal("the phrase is English words for the local day", sentDatePhrase(new RealDate(THURSDAY)), "Thursday, 8 October 2026");
  equal(
    "the phrase has no time of day",
    sentDatePhrase(new RealDate(2026, 9, 8, 23, 59)),
    "Thursday, 8 October 2026",
  );
  equal("the phrase names a weekday from the calendar", sentDatePhrase(new RealDate(2026, 0, 1)), "Thursday, 1 January 2026");

  const SENT = "Thursday, 8 October 2026";
  const LINE = `Sent on ${SENT}.`;
  const dated = [{ id: "u1", role: "user", content: "What day is it?", createdAt: 1, sentOn: SENT }];
  const undated = [{ id: "u1", role: "user", content: "What day is it?", createdAt: 1 }];

  const datedWire = buildPinnedContext(dated, [], null).wire;
  equal("the newest turn carries its date after its words", datedWire[1].content, `What day is it?\n\n${LINE}`);

  const undatedWire = buildPinnedContext(undated, [], null).wire;
  equal("a turn stored before dates existed goes out unchanged", undatedWire[1].content, "What day is it?");

  const fit = buildPinnedContext(dated, [], null).historyTokens - buildPinnedContext(undated, [], null).historyTokens;
  equal("the fit counts the date line as history", fit, estTokens(LINE));

  // The system prompt is one fixed string: the same bytes on two days, with the
  // same stored history, and with a newer dated turn added after it.
  const history = [
    { id: "u1", role: "user", content: "Hello.", createdAt: 1, sentOn: "Wednesday, 7 October 2026" },
    { id: "a1", role: "assistant", content: "Hi.", createdAt: 2 },
  ];
  const monday = onDay("2026-10-08T12:00:00", () => buildPinnedContext(history, [], null).wire);
  const tuesday = onDay("2026-10-09T12:00:00", () => buildPinnedContext(history, [], null).wire);
  equal("the wire is byte-identical on two different days", tuesday, monday);

  const grown = [...history, { id: "u2", role: "user", content: "And today?", createdAt: 3, sentOn: "Thursday, 8 October 2026" }];
  const grownWire = onDay("2026-10-09T12:00:00", () => buildPinnedContext(grown, [], null).wire);
  equal("the system prompt does not move when a dated turn is added", grownWire[0], monday[0]);
  equal("the earlier turn goes out exactly as it was sent", grownWire[1], monday[1]);

  // A stored turn keeps its date through the store: it is the same bytes it went
  // out with, on the next day, after a reload.
  const store = createStore();
  store.put({ id: "c1", title: "t", createdAt: 1, updatedAt: 1, messages: dated });
  const reloaded = store.get("c1");
  equal("the date survives the store", reloaded?.messages[0]?.sentOn, SENT);
  const afterReload = onDay("2026-10-09T12:00:00", () => buildPinnedContext(reloaded.messages, [], null).wire);
  equal("a reloaded turn goes out as it was sent", afterReload[1], datedWire[1]);
} finally {
  if (dir) await rm(dir, { recursive: true, force: true });
}

if (fail > 0) {
  console.log(`\n${fail} check(s) failed`);
  process.exit(1);
}
console.log("\nall checks passed");
