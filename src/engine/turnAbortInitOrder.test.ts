/**
 * The turn's stream state must exist BEFORE `abort` can run.
 *
 * Device bug (iPhone, new chat, long prompt): the turn showed
 * "⚠️ Cannot read property 'thinkingText' of undefined" and then "Stopped by
 * you", which the user never asked for. Cause: `abort` closes a turn by reading
 * the live think cleaner, and the cleaner (plus `joinThinking`, the streamed
 * length) was declared a few hundred lines BELOW `abort`. Two windows reach
 * `abort` before those initializers run — the pre-check
 * `if (signal?.aborted)` branch, and any abort landing inside the bench-knob
 * awaits that follow it — so the flush read uninitialized state instead of
 * stopping cleanly.
 *
 * LlamaService.ts value-imports llama.rn, so no Jest test may import it (see
 * sessionMarkerPrivacy.test.ts): the order is pinned as source text. The rule
 * is read from `abort`'s own body rather than a hand-written list, so a new
 * dependency added there fails this test instead of the device.
 */

import fs from "fs";
import path from "path";

const service = fs.readFileSync(
  path.resolve(__dirname, "LlamaService.ts"),
  "utf8",
);

const ABORT_AT = service.indexOf("const abort = (error?: Error) => {");
const abortBody = service.slice(ABORT_AT, service.indexOf("\n    };\n", ABORT_AT));

if (ABORT_AT < 0 || abortBody.length === 0) {
  throw new Error("abort() not found in LlamaService.ts");
}

/** The function abort is defined in: from its last two-space-indented line
 *  above the definition to the closing `  }` below it. Common names (`strings`)
 *  are declared in many functions, so declarations are matched inside this
 *  scope only. */
const lines = service.split("\n");
const abortLine = lines.findIndex((line) => line.includes("const abort = (error?: Error) => {"));
let scopeStart = abortLine;
while (scopeStart > 0 && !/^ {2}\S/.test(lines[scopeStart])) scopeStart -= 1;
let scopeEnd = abortLine;
while (scopeEnd < lines.length - 1 && !/^ {2}\}/.test(lines[scopeEnd])) scopeEnd += 1;
const scope = lines.slice(scopeStart, scopeEnd + 1);
const scopeText = scope.join("\n");
const abortAt = abortLine - scopeStart;

/** Index within `scope` of the closure declaration of `name` (a `let`/`const`
 *  at the function's own indent, four spaces), -1 when there is none. */
function closureDeclarationIn(name: string): number {
  return scope.findIndex((line) => new RegExp(`^ {4}(?:let|const) ${name}\\b`).test(line));
}

/** abort's code, comments removed: a name in a comment is not a read. */
const abortCode = abortBody.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
/** Every identifier abort's code mentions that is closure state of its scope.
 *  Derived, not listed, so a new read fails here. */
const abortReads = [...new Set(abortCode.match(/\b[A-Za-z_]\w*\b/g) ?? [])].filter(
  (name) => name !== "abort",
);
const closureState = abortReads.filter((name) => closureDeclarationIn(name) >= 0);

describe("abort() reads only state that exists", () => {
  it("derives the closure state from abort's body, including the five the device bug came from", () => {
    // A derivation that found nothing would pass every check below vacuously.
    expect(closureState).toEqual(
      expect.arrayContaining([
        "joinThinking",
        "thinkingAccum",
        "thinkCleaner",
        "streamedText",
        "rawEmittedAccum",
      ]),
    );
  });

  it("declares each before abort() is defined", () => {
    for (const name of closureState) {
      expect({ name, before: closureDeclarationIn(name) < abortAt }).toEqual({
        name,
        before: true,
      });
    }
  });

  it("declares each exactly once in its scope — a moved block, not a second copy", () => {
    for (const name of closureState) {
      const occurrences = scopeText.match(new RegExp(`^ {4}(?:let|const) ${name}\\b`, "gm"))?.length ?? 0;
      expect({ name, occurrences }).toEqual({ name, occurrences: 1 });
    }
  });

  it("keeps them let: the per-round cleaners are reassigned, not frozen", () => {
    // The hoist moved the DECLARATIONS only. A const here would break the
    // round reset (one cleaner per completion) and the fallback round's.
    expect(service).toContain("let thinkCleaner = createThinkStreamCleaner();");
    expect(service).toContain("let toolCallStrip = createToolCallDeltaStripper();");
    expect(service.match(/thinkCleaner = createThinkStreamCleaner/g) ?? []).toHaveLength(3);
    expect(service.match(/toolCallStrip = createToolCallDeltaStripper/g) ?? []).toHaveLength(3);
  });

  it("the two abort windows that reached the uninitialized state sit after them", () => {
    // Pre-check and the bench-knob awaits are both below the declarations now.
    const preCheck = service.indexOf("if (signal?.aborted) {");
    const benchKnobs = service.indexOf("const blockFormat = await getBlockFormat();");
    expect(preCheck).toBeGreaterThan(ABORT_AT);
    expect(benchKnobs).toBeGreaterThan(ABORT_AT);
    // `abort` is still armed BEFORE both (that is the whole hazard), so this
    // pin fails if someone moves the listener back above the declarations.
    const armed = service.indexOf('signal?.addEventListener("abort", onAbort');
    expect(armed).toBeGreaterThan(ABORT_AT);
    expect(armed).toBeLessThan(preCheck);
    expect(armed).toBeLessThan(benchKnobs);
  });
});