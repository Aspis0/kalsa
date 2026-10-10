// The tool-refusal detector: the lab's saved refusals flag; idiomatic and
// apologetic answers that carry the retired bare markers do not; a refusal
// phrase outside the first sentence, a tool-call reply, a long reply and an
// empty one never flag.
//
// Run: node scripts/refusal.mjs   (from chat/)

import { mkdtemp, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "../node_modules/esbuild/lib/main.js";

const CASES = JSON.parse(readFileSync(new URL("./refusal-cases.json", import.meta.url), "utf8"));
const TOOL_CALL = [{ id: "0-call_0", name: "web_search", arguments: "{}", index: 0 }];
// The bare markers the detector used before it required a refusal phrase in the
// first sentence. Every idiom below must carry one, or the idiom check proves nothing.
const RETIRED_MARKERS = [
  "i'm sorry, but", "i can't help", "i cannot", "i can't", "i don't have the ability",
  "i don't have the capability", "isn't supported", "not able to", "mi dispiace", "non posso",
  "non ho la capacità", "non sono in grado", "lo siento", "no puedo", "no tengo la capacidad",
  "je suis désolé", "je ne peux pas", "je n'ai pas la capacité", "抱歉", "我无法", "我不能",
  "i don't have a tool",
];

let fail = 0;
function check(label, condition, detail) {
  if (!condition) fail++;
  console.log(`${condition ? "ok  " : "FAIL"} ${label}${condition || detail === undefined ? "" : `\n     ${detail}`}`);
}
const folded = (text) => text.replace(/[‘’]/g, "'").toLowerCase();
const carriesRetiredMarker = (text) => RETIRED_MARKERS.some((marker) => folded(text).includes(marker));

let dir = null;
try {
  dir = await mkdtemp(join(tmpdir(), "kalsa-refusal-"));
  const outfile = join(dir, "refusal.mjs");
  await build({
    entryPoints: [fileURLToPath(new URL("../src/lib/refusal.ts", import.meta.url))],
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node20",
    outfile,
    logLevel: "silent",
  });
  const { isToolRefusal } = await import(pathToFileURL(outfile).href);

  const missed = CASES.refusals.filter((text) => !isToolRefusal(text, []));
  check(`lab refusals flagged: ${CASES.refusals.length - missed.length}/${CASES.refusals.length}`, missed.length === 0, missed.join("\n     "));

  const idiomsFlagged = CASES.idioms.filter((text) => isToolRefusal(text, []));
  check(`idiomatic and apologetic answers not flagged: ${CASES.idioms.length - idiomsFlagged.length}/${CASES.idioms.length}`, idiomsFlagged.length === 0, idiomsFlagged.join("\n     "));
  const unmarked = CASES.idioms.filter((text) => !carriesRetiredMarker(text));
  check(`every idiom carries a retired marker (${CASES.idioms.length - unmarked.length}/${CASES.idioms.length})`, unmarked.length === 0, unmarked.join("\n     "));

  const flagged = CASES.notRefusals.filter((text) => isToolRefusal(text, []));
  check(`lab normal replies not flagged: ${CASES.notRefusals.length - flagged.length}/${CASES.notRefusals.length}`, flagged.length === 0, flagged.map((t) => t.slice(0, 100)).join("\n     "));

  const [longStory] = CASES.longStory;
  check("a long story that mentions no refusal is not flagged", !isToolRefusal(longStory, []) && !isToolRefusal(`${longStory} I can't help.`, []));
  check("a refusal phrase after the first sentence does not flag", !isToolRefusal("Sure, I can help with the list. I can't help with the last item.", []));
  check("a refusal phrase in the first sentence flags, whatever follows", isToolRefusal("I'm sorry, but I can't help with that. Ask a teacher.", []));
  check("a tool-call reply is never a refusal", !isToolRefusal("I'm sorry, but I can't help with that.", TOOL_CALL));
  check("an empty reply is not a refusal", !isToolRefusal("   ", []));
  check("case and curly apostrophes do not matter", isToolRefusal("I DON’T HAVE A TOOL for that.", []));
  check("\"i don't have a tool\" is a refusal", isToolRefusal("I don't have a tool for that.", []));
  check("CJK counts half a word: 100 characters flag", isToolRefusal(`${"字".repeat(99)}我无法帮`, []));
  check("CJK counts half a word: 200 characters do not", !isToolRefusal(`${"字".repeat(199)}我无法帮`, []));
} finally {
  if (dir) await rm(dir, { recursive: true, force: true });
}

if (fail > 0) {
  console.log(`\n${fail} check(s) failed`);
  process.exit(1);
}
console.log("\nall checks passed");
