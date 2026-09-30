import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "../chat/node_modules/esbuild/lib/main.js";

// Every path is relative to this file, never to a home directory: the
// renderer must run from any checkout, and the bundle never lands in one.
const checkout = fileURLToPath(new URL("..", import.meta.url));
const chat = join(checkout, "chat");
const dir = await mkdtemp(join(tmpdir(), "i18n3-"));
const out = join(dir, "tables.mjs");
await build({
  entryPoints: [join(chat, "src/i18n/index.ts")],
  bundle: true, format: "esm", platform: "node", target: "node20",
  outfile: out, nodePaths: [join(chat, "node_modules")],
  loader: { ".css": "empty" }, logLevel: "silent",
});
const mod = await import(`${pathToFileURL(out).href}?c=${Date.now()}`);


/** Example values for the function keys, keyed by the flattened path so
    two areas may share a leaf name without sharing an example. Every number
    goes through `num`, which formats it in the language being rendered, so
    a card never shows another language's separators; a clause or join that
    is itself a table's output is composed from that table. */
const EXAMPLES = {
  "room.answering": (fn) => fn("Marco"),
  "room.queueNext": (fn) => fn("Marco"),
  "room.youAre": (fn) => fn("Marco"),
  "room.queueThen": (fn, areaTable) => fn("Marco", areaTable.listJoin(["Luca", "Sofia"])),
  "room.readLast": (fn) => `${fn(1)} / ${fn(5)}`,
  "room.listJoin": (fn) => fn(["Luca", "Sofia"]),
  "thread.errorBody": (fn) => `${fn(500)} / ${fn(undefined)}`,
  "thread.called": (fn) => fn("http://localhost:8080"),
  "thread.thoughtFor": (fn, _area, num) => fn(num(3.4, 1)),
  "tools.running": (fn) => fn("web_search"),
  "tools.read": (fn) => fn("example.com"),
  "tools.searchedFor": (fn) => fn("cena"),
  "tools.didNotRun": (fn) => fn("web_search"),
  "tools.ran": (fn) => fn("web_search"),
  "tools.gateWhy": (fn, areaTable) => fn(areaTable.documentsAttached(2)),
  "tools.documentsAttached": (fn) => fn(2),
  "tools.moreWaiting": (fn) => fn(2),
  "tools.findingFrom": (fn) => fn("report.pdf"),
  "tools.turnEnded": (fn) => fn("length"),
  "tools.argumentsNotValid": (fn) => fn("web_search"),
  "advanced.whatItDoes": (fn) => fn("Context size"),
  "advanced.explanationAria": (fn) => fn("Context size"),
  "sidebar.noMatch": (fn) => fn("cena"),
  "sidebar.capped": (fn, _area, num) => fn(num(150), num(240)),
  "files.pages": (fn) => fn(12),
  "files.tokens": (fn, _area, num) => fn(num(1200)),
  "files.filesTerm": (fn, _area, num) => fn(`≈${num(1200)}`),
  "files.conversationTerm": (fn, _area, num) => fn(`≈${num(2400)}`),
  "files.reservedTerm": (fn, _area, num) => fn(`≈${num(512)}`),
  "files.leftTerm": (fn, _area, num) => fn(`≈${num(3000)}`),
  "files.overTerm": (fn, _area, num) => fn(`≈${num(300)}`),
  "files.ofTotal": (fn, _area, num) => fn(`≈${num(8192)}`),
  "files.unsupportedKind": (fn) => fn("photo.png"),
  "files.unsupportedLegacy": (fn) => fn("letter.doc", "Word", "docx"),
  "files.tooBig": (fn, _area, num) => fn("book.pdf", num(64)),
  "files.unreadable": (fn) => fn("book.pdf"),
  "files.noText": (fn) => fn("scan.pdf"),
  "files.notFromComputer": (fn) => fn("book.pdf"),
  "setup.downloadSize": (fn, _area, num) => fn(`${num(4.7, 1)} GB`),
  "setup.downloadQ": (fn, _area, num) => fn(`${num(4.7, 1)} GB`),
  "setup.needsFiles": (fn) => fn("gemma"),
  "setup.needsFile": (fn) => fn("gemma"),
  "setup.ofTotal": (fn, _area, num) => fn(num(1.2, 1), num(4.7, 1), "GB"),
  "setup.receivedSoFar": (fn, _area, num) => fn(`${num(1.2, 1)} GB`),
  "setup.pickingUp": (fn, areaTable, num) => fn(areaTable.ofTotal(num(1.2, 1), num(4.7, 1), "GB")),
  "machine.running": (fn) => fn("gemma"),
  "machine.memorySentence": (fn, _area, num) => fn(`${num(16)} GiB`, `${num(9)} GiB`, "the graphics chip"),
  "machine.bandwidthMeasured": (fn, _area, num) => fn(`${num(100)} GB/s`),
  "machine.bandwidthFloor": (fn, _area, num) => fn(`${num(100)} GB/s`),
  "machine.bandwidthChip": (fn, _area, num) => fn(`${num(100)} GB/s`),
  "machine.speedRange": (fn, _area, num) => fn(num(12, 1), num(24, 1)),
  "machine.speedAtLeast": (fn, _area, num) => fn(num(12, 1)),
  "machine.speedMeasured": (fn, _area, num) => fn(num(12, 1)),
  "machine.detailMeasured": (fn, areaTable) => fn(areaTable.thisComputerMachine),
  "machine.onDisk": (fn, _area, num) => fn("q4_0", `${num(4.7, 1)} GiB`),
  "machine.upToContext": (fn, _area, num) => fn(num(8192)),
  "machine.confirmSwitch": (fn, _area, num) => fn("gemma", `${num(4.7, 1)} GiB`),
  "machine.startAgainOn": (fn) => fn("gemma"),
  "machine.speedsHeld": (fn, _area, num) => fn(num(65536)),
  "server.residentsOfCapacity": (fn) => fn(1, 4),
  "server.filesUnreadable": (fn) => fn(12, 1),
  "server.filesFromScan": (fn) => fn(12),
  "server.eachX": (fn, _area, num) => fn(num(0.73, 2)),
  "server.perSlot": (fn, _area, num) => fn(num(0.73, 2), num(0.73, 2)),
  "server.together": (fn, areaTable, num) => fn(areaTable.eachX(num(0.73, 2)), num(1.47, 2)),
  "server.concurrencyDetail": (fn) => fn("kalsa-server-v1.1.1", "macos-arm64/metal"),
  "server.tokensPerSecond": (fn, _area, num) => fn(num(12, 1)),
  "devices.waitingNamed": (fn, areaTable) => fn("Pixel 9", areaTable.owedPending),
  "devices.waitingCount": (fn, areaTable) => fn(2, areaTable.undeliveredClause),
  "devices.mixedOne": (fn, areaTable) => fn(3, areaTable.undeliveredClause),
  "devices.mixedMany": (fn, areaTable) => fn(3, 2, areaTable.undeliveredClause),
  "devices.savedPending": (fn) => fn("Pixel 9"),
  "devices.worksWith": (fn) => fn("Pixel 9"),
  "devices.worksWithCount": (fn) => fn(2),
  "devices.worksWithCountPending": (fn) => fn(2),
  "devices.deviceLabel": (fn) => fn(5),
  "devices.connectedSentence": (fn) => fn("Pixel 9"),
  "devices.pairingAgain": (fn) => fn("Pixel 9"),
  "devices.runForTailscale": (fn) => fn("tailscale serve --bg 8080"),
  "devices.deskMoved": (fn) => fn(8444),
  "invite.expires": (fn) => fn("17:30"),
  "invite.tomorrowAt": (fn) => fn("17:30"),
  "invite.copiedUntil": (fn, areaTable) => fn(areaTable.tomorrowAt("17:30")),
  "shell.backTo": (fn) => fn("Home"),
  "shell.dontFit": (fn) => fn("a.pdf, b.pdf"),
  "shell.doesntFit": (fn) => fn("a.pdf"),
  "shell.refusalBody": (fn, _area, num) => fn(num(1200), num(2400), num(512), num(4112), num(8192)),
  "shell.oversizeDetail": (fn, _area, num) => fn(num(1200), num(2400), num(512), num(4112), num(8192)),
  "shell.readingOne": (fn) => fn("book.pdf"),
  "shell.readingMany": (fn) => fn(3),
  "shell.attachedOne": (fn) => fn("book.pdf"),
  "shell.attachedMany": (fn) => fn(3),
};

/** One rendered value per function key: the path's own example when one is
    named, and one plain word for the rest — a card needs a value, never a
    computation. `num` formats figures in the language being rendered. */
const RENDER_CASES = (path, areaTable, num) => {
  const example = EXAMPLES[path];
  if (example) return (fn) => example(fn, areaTable, num);
  return (fn) => fn("…");
};

function collect(table, lang) {
  const rows = [];
  const seen = new Set();
  const num = (value, digits = 0) =>
    new Intl.NumberFormat(lang, digits ? { minimumFractionDigits: digits, maximumFractionDigits: digits } : undefined).format(value);
  const walk = (node, area, areaTable) => {
    for (const [key, value] of Object.entries(node)) {
      const path = area ? `${area}.${key}` : key;
      // A flattened key naming two rows would make the rendered card
      // ambiguous, so the walk refuses to continue past the first repeat.
      if (seen.has(path)) throw new Error(`duplicate flattened key: ${path}`);
      seen.add(path);
      if (typeof value === "function") {
        // A function key renders with its own area's table — queueThen
        // borrows its area's listJoin to build {rest}.
        rows.push([path, RENDER_CASES(path, areaTable, num)((...args) => value(...args))]);
      } else if (typeof value === "string") {
        rows.push([path, value]);
      } else if (value !== null && typeof value === "object") {
        walk(value, path, value);
      }
    }
  };
  walk(table, "", table);
  return rows;
}

const english = collect(mod.TABLES.en, "en");
const others = {};
for (const lang of ["it", "es", "fr", "zh"]) others[lang] = collect(mod.TABLES[lang], lang);
console.log(JSON.stringify({ english, others }));
