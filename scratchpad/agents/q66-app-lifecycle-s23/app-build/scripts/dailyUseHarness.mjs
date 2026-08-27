/**
 * Harness for daily-use Phase 3–7 pure helpers:
 * persona tail (format B, no system-prompt mutation), notes filter,
 * calc parser, share URL parse.
 * Exit 1 on fail.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const outDir = path.join(projectRoot, "scripts/.build/dailyUseHarness");

function compile() {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const r = spawnSync(
    "npx",
    [
      "tsc",
      "src/engine/personaTail.ts",
      "src/util/filterByTokens.ts",
      "src/notes/NotesStore.ts",
      "src/agent/deviceCalc.ts",
      "src/app/shareIntent.ts",
      "src/agent/calendarAgenda.ts",
      "src/conversations/PersonasStore.ts",
      "src/conversations/ConversationsStore.ts",
      "--outDir",
      outDir,
      "--module",
      "nodenext",
      "--target",
      "es2020",
      "--moduleResolution",
      "nodenext",
      "--skipLibCheck",
      "--ignoreConfig",
      "--esModuleInterop",
      "--types",
      "node",
    ],
    { cwd: projectRoot, encoding: "utf8", shell: true },
  );
  if (r.status !== 0) {
    console.error("tsc failed:\n", r.stdout, r.stderr);
    process.exit(1);
  }
}

function resolveBuilt(relParts) {
  const candidates = [
    path.join(outDir, ...relParts),
    path.join(outDir, "src", ...relParts),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  console.error(`Could not find ${relParts.join("/")}. Tried:\n`, candidates.join("\n"));
  process.exit(1);
}

let pass = 0;
let fail = 0;
function check(name, cond, detail = "") {
  if (cond) {
    console.log(`PASS ${name}`);
    pass += 1;
  } else {
    console.log(`FAIL ${name}${detail ? ` — ${detail}` : ""}`);
    fail += 1;
  }
}

async function main() {
  console.log("Compiling daily-use helpers …");
  compile();

  const persona = await import(pathToFileURL(resolveBuilt(["engine", "personaTail.js"])).href);
  const notes = await import(pathToFileURL(resolveBuilt(["notes", "NotesStore.js"])).href);
  const calc = await import(pathToFileURL(resolveBuilt(["agent", "deviceCalc.js"])).href);
  const share = await import(pathToFileURL(resolveBuilt(["app", "shareIntent.js"])).href);
  const personas = await import(
    pathToFileURL(resolveBuilt(["conversations", "PersonasStore.js"])).href
  );

  const { applyPersonaTail, sanitizePersonaInstructions, PERSONA_INSTRUCTIONS_CAP } = persona;
  const { filterNotes, parseNotesIndex, serializeNotesIndex, titleFromNoteBody } = notes;
  const { evaluateCalc } = calc;
  const { parseShareUrl, normalizeShareFileUri, mergeSharePrefill, SHARE_TEXT_CAP } = share;
  const calendar = await import(pathToFileURL(resolveBuilt(["agent", "calendarAgenda.js"])).href);
  const { resolveAgendaRange, mapCalendarEvents, AGENDA_MAX_DAYS, AGENDA_MAX_EVENTS } = calendar;
  const { parsePersonasPersisted, upsertUserPersona, removeUserPersona, findPersona, emptyPersonasPersisted } =
    personas;

  // ── persona tail ────────────────────────────────────────────────────────
  const user = "What is 2+2?";
  check("empty instructions leave user text unchanged", applyPersonaTail(user, "") === user);
  check("null instructions leave user text unchanged", applyPersonaTail(user, null) === user);
  const tailed = applyPersonaTail(user, "Be terse.");
  check("tail prefixes user text", tailed.endsWith(user) && tailed.includes("Be terse."));
  check("tail uses untrusted frame", tailed.includes("<<<PERSONA") && tailed.includes("untrusted"));
  check("tail does not equal a system prompt", !tailed.startsWith("You are Kalsa"));
  const long = "x".repeat(PERSONA_INSTRUCTIONS_CAP + 50);
  check(
    "instructions cap",
    sanitizePersonaInstructions(long).length === PERSONA_INSTRUCTIONS_CAP,
  );
  const builtins = {
    "builtin-assistant": { name: "Assistant", instructions: "Help." },
    "builtin-coder": { name: "Coder", instructions: "Code." },
    "builtin-translator": { name: "Translator", instructions: "Translate." },
    "builtin-mentor": { name: "Mentor", instructions: "Mentor." },
  };
  let state = emptyPersonasPersisted();
  state = upsertUserPersona(state, {
    id: "persona-1",
    name: "Pirate",
    instructions: "Talk like a pirate.",
  });
  check("user persona stored", findPersona(state, "persona-1", builtins)?.name === "Pirate");
  check(
    "cannot delete builtin via removeUserPersona",
    removeUserPersona(state, "builtin-assistant").items.length === 1,
  );
  state = removeUserPersona(state, "persona-1");
  check("user persona deleted", state.items.length === 0);
  const parsed = parsePersonasPersisted(
    JSON.stringify({ items: [{ id: "builtin-assistant", name: "X", instructions: "Y" }] }),
  );
  check("persisted builtin id dropped from user list", parsed.items.length === 0);

  // ── notes filter ────────────────────────────────────────────────────────
  const noteItems = [
    { id: "note-1", title: "Grocery list", updatedAt: 3, searchBlob: "milk eggs bread" },
    { id: "note-2", title: "Meeting notes", updatedAt: 2, searchBlob: "agenda q3 budget" },
    { id: "note-3", title: "Idea", updatedAt: 1, searchBlob: "garden tomatoes" },
  ];
  check("empty query returns all notes recency-sorted", filterNotes(noteItems, "").length === 3);
  check("empty query first is newest", filterNotes(noteItems, "")[0].id === "note-1");
  check("AND tokens on title", filterNotes(noteItems, "meeting").map((n) => n.id).join() === "note-2");
  check(
    "AND tokens on blob",
    filterNotes(noteItems, "tomatoes").map((n) => n.id).join() === "note-3",
  );
  check("short tokens dropped when a long token exists", filterNotes(noteItems, "q3 budget").length === 1);
  check("unknown token matches none", filterNotes(noteItems, "xyzzy").length === 0);
  check("titleFromNoteBody first line", titleFromNoteBody("Hello\nworld") === "Hello");
  const indexRound = parseNotesIndex(
    serializeNotesIndex([{ id: "note-1", title: "A", updatedAt: 9, searchBlob: "a" }]),
  );
  check("notes index round-trip", indexRound.length === 1 && indexRound[0].id === "note-1");

  // ── calc parser ─────────────────────────────────────────────────────────
  check("1+2", evaluateCalc("1+2").ok && evaluateCalc("1+2").value === 3);
  check("(3+4)*2", evaluateCalc("(3+4)*2").ok && evaluateCalc("(3+4)*2").value === 14);
  check("unary minus", evaluateCalc("-3+5").ok && evaluateCalc("-3+5").value === 2);
  check("floats", evaluateCalc("1.5*2").ok && evaluateCalc("1.5*2").value === 3);
  check("div", evaluateCalc("8/2").ok && evaluateCalc("8/2").value === 4);
  check("divzero", !evaluateCalc("1/0").ok && evaluateCalc("1/0").error === "divzero");
  check("reject identifier", !evaluateCalc("alert(1)").ok);
  check("reject leftover", !evaluateCalc("1+2x").ok);
  check("reject empty", !evaluateCalc("").ok);
  check("whitespace", evaluateCalc("  2 + 2  ").ok && evaluateCalc("  2 + 2  ").value === 4);
  check("nested parens", evaluateCalc("((1+2)*3)-1").value === 8);

  // ── share URL ───────────────────────────────────────────────────────────
  const textShare = parseShareUrl("kalsa://share?text=hello%20world");
  check("share text", textShare?.kind === "text" && textShare.text === "hello world");
  const fileShare = parseShareUrl("kalsa://share?file=%2Fdata%2Fshare-in%2Fa.pdf");
  check(
    "share file",
    fileShare?.kind === "file" && fileShare.uri.includes("a.pdf"),
  );
  check("share ignore other scheme", parseShareUrl("https://example.com/share?text=x") === null);
  check("share empty", parseShareUrl("kalsa://share") === null);
  check("normalize bare path", normalizeShareFileUri("/tmp/a.pdf") === "file:///tmp/a.pdf");
  check("normalize file uri", normalizeShareFileUri("file:///tmp/a.pdf") === "file:///tmp/a.pdf");
  check("share merge empty draft", mergeSharePrefill("", "hello") === "hello");
  check("share merge append", mergeSharePrefill("draft", "shared") === "draft\n\nshared");
  check(
    "share merge cap",
    mergeSharePrefill("x".repeat(SHARE_TEXT_CAP - 4), "yyyyyyyy").length === SHARE_TEXT_CAP,
  );

  // ── calendar clamp ──────────────────────────────────────────────────────
  const from = new Date("2026-01-01T00:00:00.000Z");
  const far = resolveAgendaRange(
    { fromISO: from.toISOString(), toISO: "2026-03-01T00:00:00.000Z" },
    from,
  );
  check(
    "agenda range clamp 14 days",
    far.to.getTime() - far.from.getTime() === AGENDA_MAX_DAYS * 24 * 60 * 60 * 1000,
  );
  const many = Array.from({ length: AGENDA_MAX_EVENTS + 10 }, (_, i) => ({
    title: `e${i}`,
    startDate: "2026-01-01T00:00:00.000Z",
    endDate: "2026-01-01T01:00:00.000Z",
    allDay: false,
    location: "x",
  }));
  check("agenda event cap 50", mapCalendarEvents(many).length === AGENDA_MAX_EVENTS);

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
