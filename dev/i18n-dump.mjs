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
    two areas may share a leaf name without sharing an example: a name like
    Marco, a small count, one plain sentence for the rest. */
const EXAMPLES = {
  "room.answering": (fn) => fn("Marco"),
  "room.queueNext": (fn) => fn("Marco"),
  "room.youAre": (fn) => fn("Marco"),
  "room.queueThen": (fn, areaTable) => fn("Marco", areaTable.listJoin(["Luca", "Sofia"])),
  "room.readLast": (fn) => `${fn(1)} / ${fn(5)}`,
  "room.listJoin": (fn) => fn(["Luca", "Sofia"]),
  "thread.errorBody": (fn) => `${fn(500)} / ${fn(undefined)}`,
  "thread.called": (fn) => fn("http://localhost:8080"),
  "thread.thoughtFor": (fn) => fn("3.4"),
  "tools.running": (fn) => fn("web_search"),
  "tools.read": (fn) => fn("example.com"),
  "tools.searchedFor": (fn) => fn("cena"),
  "tools.didNotRun": (fn) => fn("web_search"),
  "tools.ran": (fn) => fn("web_search"),
  "tools.searchedForLabel": null,
  "tools.gateWhy": (fn) => fn("Two documents are attached"),
  "tools.documentsAttached": (fn) => fn(2),
  "tools.moreWaiting": (fn) => fn(2),
  "tools.findingFrom": (fn) => fn("report.pdf"),
  "tools.turnEnded": (fn) => fn("length"),
  "tools.argumentsNotValid": (fn) => fn("web_search"),
  "advanced.whatItDoes": (fn) => fn("Context size"),
  "advanced.explanationAria": (fn) => fn("Context size"),
  "sidebar.noMatch": (fn) => fn("cena"),
  "sidebar.capped": (fn) => fn(150, 240),
  "files.pages": (fn) => fn(12),
  "files.tokens": (fn) => fn("1,200"),
  "files.filesTerm": (fn) => fn("≈1,200"),
  "files.conversationTerm": (fn) => fn("≈2,400"),
  "files.reservedTerm": (fn) => fn("≈512"),
  "files.leftTerm": (fn) => fn("≈3,000"),
  "files.overTerm": (fn) => fn("≈300"),
  "files.ofTotal": (fn) => fn("≈8,192"),
  "files.unsupportedKind": (fn) => fn("photo.png"),
  "files.unsupportedLegacy": (fn) => fn("letter.doc", "Word", "docx"),
  "files.tooBig": (fn) => fn("book.pdf", "64"),
  "files.unreadable": (fn) => fn("book.pdf"),
  "files.noText": (fn) => fn("scan.pdf"),
  "files.notFromComputer": (fn) => fn("book.pdf"),
  "setup.downloadSize": (fn) => fn("4.7 GB"),
  "setup.downloadQ": (fn) => fn("4.7 GB"),
  "setup.needsFiles": (fn) => fn("gemma"),
  "setup.needsFile": (fn) => fn("gemma"),
  "setup.ofTotal": (fn) => fn("1.2", "4.7", "GB"),
  "setup.receivedSoFar": (fn) => fn("1.2 GB"),
  "setup.pickingUp": (fn) => fn("1.2 of 4.7 GB"),
  "machine.running": (fn) => fn("gemma"),
  "machine.memorySentence": (fn) => fn("16 GiB", "9 GiB", "the graphics chip"),
  "machine.bandwidthMeasured": (fn) => fn("100 GB/s"),
  "machine.bandwidthFloor": (fn) => fn("100 GB/s"),
  "machine.bandwidthChip": (fn) => fn("100 GB/s"),
  "machine.speedRange": (fn) => fn("12.0", "24.0"),
  "machine.speedAtLeast": (fn) => fn("12.0"),
  "machine.speedMeasured": (fn) => fn("12.0"),
  "machine.detailMeasured": (fn) => fn("this computer"),
  "machine.onDisk": (fn) => fn("q4_0", "4.7 GiB"),
  "machine.upToContext": (fn) => fn("8,192"),
  "machine.confirmSwitch": (fn) => fn("gemma", "4.7 GiB"),
  "machine.startAgainOn": (fn) => fn("gemma"),
  "machine.speedsHeld": (fn) => fn("65,536"),
  "server.residentsOfCapacity": (fn) => fn(1, 4),
  "server.filesUnreadable": (fn) => fn(12, 1),
  "server.filesFromScan": (fn) => fn(12),
  "server.eachX": (fn) => fn("0.73"),
  "server.perSlot": (fn) => fn("0.73", "0.73"),
  "server.together": (fn) => fn("0.73x each", "1.47"),
  "server.concurrencyDetail": (fn) => fn("kalsa-server-v1.1.1", "macos-arm64/metal"),
  "server.tokensPerSecond": (fn) => fn("12.0"),
  "devices.waitingNamed": (fn) => fn("Pixel 9", "; the phone still needs its connection"),
  "devices.waitingCount": (fn) => fn(2, ", and one phone awaits its connection"),
  "devices.mixedOne": (fn) => fn(3, ", and one phone awaits its connection"),
  "devices.mixedMany": (fn) => fn(3, 2, ", and one phone awaits its connection"),
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
  "invite.copiedUntil": (fn) => fn("tomorrow at 17:30"),
  "shell.backTo": (fn) => fn("Home"),
  "shell.dontFit": (fn) => fn("a.pdf, b.pdf"),
  "shell.doesntFit": (fn) => fn("a.pdf"),
  "shell.refusalBody": (fn) => fn("1,200", "2,400", "512", "4,112", "8,192"),
  "shell.oversizeDetail": (fn) => fn("1,200", "2,400", "512", "4,112", "8,192"),
  "shell.readingOne": (fn) => fn("book.pdf"),
  "shell.readingMany": (fn) => fn(3),
  "shell.attachedOne": (fn) => fn("book.pdf"),
  "shell.attachedMany": (fn) => fn(3),
};

/** One rendered value per function key: the path's own example when one is
    named, and one plain word for the rest — a card needs a value, never a
    computation. */
const RENDER_CASES = (path, areaTable) => {
  const example = EXAMPLES[path];
  if (example) return (fn) => example(fn, areaTable);
  return (fn) => fn("…");
};

function collect(table) {
  const rows = [];
  const seen = new Set();
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
        rows.push([path, RENDER_CASES(path, areaTable)((...args) => value(...args))]);
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

const english = collect(mod.TABLES.en);
const others = {};
for (const lang of ["it", "es", "fr", "zh"]) others[lang] = collect(mod.TABLES[lang]);
console.log(JSON.stringify({ english, others }));
