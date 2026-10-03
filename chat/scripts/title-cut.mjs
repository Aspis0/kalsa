// The chat title's cut: by what a reader counts, never through an emoji. A
// title comes from the first message, so a cut in the middle of a surrogate
// pair turns the header into a broken glyph.
//
// Pure. Run: node scripts/title-cut.mjs   (from chat/)

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "../node_modules/esbuild/lib/main.js";

let fail = 0;
function check(label, condition, detail) {
  const ok = condition ? "ok  " : "FAIL";
  if (!condition) fail++;
  console.log(`${ok} ${label}${condition || detail === undefined ? "" : `\n     ${detail}`}`);
}
function equal(label, actual, expected) {
  check(label, actual === expected, `got ${JSON.stringify(actual)}\n     want ${JSON.stringify(expected)}`);
}

/** A surrogate half standing alone: what a UTF-16 slice leaves behind. */
function hasLoneSurrogate(text) {
  return Array.from(text).some((character) => {
    const point = character.codePointAt(0) ?? 0;
    return point >= 0xd800 && point <= 0xdfff;
  });
}

const dir = await mkdtemp(join(tmpdir(), "kalsa-title-"));
try {
  const outfile = join(dir, "store.mjs");
  await build({
    entryPoints: [fileURLToPath(new URL("../src/lib/store.ts", import.meta.url))],
    bundle: true,
    format: "esm",
    platform: "node",
    outfile,
    logLevel: "silent",
  });
  const { firstCharacters, titleFor } = await import(pathToFileURL(outfile).href);

  const ELLIPSIS = "…";
  const FAMILY = "👨‍👩‍👧‍👦";

  equal("a long plain title still cuts at 46", titleFor("a".repeat(60)), `${"a".repeat(46)}${ELLIPSIS}`);

  // A surrogate pair straddling the 46th UTF-16 unit: the old cut left half of
  // the rocket in the title.
  const rocket = `${"a".repeat(45)}🚀${"b".repeat(10)}`;
  const rocketCut = titleFor(rocket);
  check("the rocket survives whole", rocketCut === `${"a".repeat(45)}🚀${ELLIPSIS}`, JSON.stringify(rocketCut));
  check("no lone surrogate in the rocket cut", !hasLoneSurrogate(rocketCut));
  check("the cut keeps nothing past the 46th character", !rocketCut.includes("b"));

  // A ZWJ family is one character to a reader and seven code points to
  // Array.from; only grapheme segmentation keeps it whole.
  const family = `${"a".repeat(45)}${FAMILY}tail`;
  const familyCut = titleFor(family);
  check("the emoji family survives whole", familyCut === `${"a".repeat(45)}${FAMILY}${ELLIPSIS}`, JSON.stringify(familyCut));
  check("no lone surrogate in the family cut", !hasLoneSurrogate(familyCut));
  check("no fragment of the family is left", !familyCut.includes("tail"));

  // Thirty emoji are thirty characters, not the sixty UTF-16 units they used to
  // be measured in: no cut at all.
  const emoji = "🎉".repeat(30);
  equal("thirty emoji are not over the limit", titleFor(emoji), emoji);

  equal("an empty first message keeps the fallback", titleFor("   "), "New conversation");

  // The same cut titles a conversation made from an attached file's name.
  equal("a name under the limit is untouched", firstCharacters("mini-report.pdf", 46), "mini-report.pdf");
  const nameCut = firstCharacters(`${"a".repeat(45)}🚀name.pdf`, 46);
  check("an attached name's emoji survives the cut", nameCut === `${"a".repeat(45)}🚀`, JSON.stringify(nameCut));
  check("no lone surrogate in the attached-name cut", !hasLoneSurrogate(nameCut));

} finally {
  await rm(dir, { recursive: true, force: true });
}

if (fail > 0) {
  console.log(`\n${fail} check(s) failed`);
  process.exit(1);
}
console.log("\nall checks passed");
