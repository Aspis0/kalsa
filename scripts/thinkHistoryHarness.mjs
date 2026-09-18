/**
 * Compile and exercise llamaHistoryAssistantFields without Jest or React Native.
 * Exit 1 on any compile or assertion failure.
 */

import { strict as assert } from "node:assert";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const require = createRequire(import.meta.url);
const outDir = mkdtempSync(path.join(tmpdir(), "kalsa-think-history-"));

function compile() {
  const result = spawnSync(
    "npx",
    [
      "tsc",
      "src/engine/modelEmittedText.ts",
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
      "--strict",
      "--types",
      "node",
    ],
    { cwd: projectRoot, encoding: "utf8" },
  );
  if (result.status !== 0) {
    throw new Error(`tsc failed:\n${result.stdout}${result.stderr}`);
  }
}

/** Comments stripped, whitespace normalised — region pins by SHAPE. */
function shapeOf(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The AppShell LOAD path must apply the same rule as the save path. It once
 * trimmed on load while the save path preserved bytes, so an emission that
 * began with a newline (the abort path stores the raw accumulation) came back
 * trimmed and the replay diverged at its first token. Any reappearance of the
 * inline trim must fail here by name.
 */
function assertAppShellLoadPreservesBytes() {
  const appShellPath = path.join(projectRoot, "src/app/AppShell.tsx");
  const src = readFileSync(appShellPath, "utf8");
  const fnAt = src.indexOf("function validateHistoryMessages(");
  if (fnAt < 0) throw new Error("AppShell: validateHistoryMessages disappeared");
  const fnEnd = src.indexOf("\n}", fnAt);
  if (fnEnd < 0) throw new Error("AppShell: validateHistoryMessages never closes");
  const fn = src.slice(fnAt, fnEnd);
  if (!fn.includes("readModelEmittedText(role, rawEmitted)")) {
    throw new Error(
      "AppShell validateHistoryMessages must restore modelEmittedText via " +
        "readModelEmittedText(role, rawEmitted) — the save path's own policy. " +
        "The load path drifted from the save path again.",
    );
  }
  if (/rawEmitted\.trim\(\)/.test(shapeOf(fn))) {
    throw new Error(
      "AppShell validateHistoryMessages TRIMS the emission on load again " +
        "(rawEmitted.trim()) — load destroys what save preserves; the KV " +
        "replay diverges at the first token of any emission with edge " +
        "whitespace.",
    );
  }
  console.log("PASS AppShell load path preserves emission bytes");
}

function resolveBuiltModule() {
  const candidates = [
    path.join(outDir, "modelEmittedText.js"),
    path.join(outDir, "src/engine/modelEmittedText.js"),
    path.join(outDir, "engine/modelEmittedText.js"),
  ];
  const modulePath = candidates.find((candidate) => existsSync(candidate));
  if (!modulePath) {
    throw new Error(`Could not find compiled module. Tried:\n${candidates.join("\n")}`);
  }
  return modulePath;
}

/**
 * Enumerates EVERY writer of modelEmittedText in src and requires each to
 * handle emissionSource in the same region. A writer that moves the string
 * without the flag desyncs the renderer from the native KV. In-place editing
 * of assistant text does not exist today (editing re-sends and produces a NEW
 * turn); if it is ever added, its write lands here and fails BY NAME until it
 * sets or clears the flag and the expected counts are updated on purpose.
 */
function assertEmissionSourceWriters() {
  const fs = require("node:fs");
  const srcRoot = path.join(projectRoot, "src");
  // Writes only: excludes === / !== / >= comparisons and reads.
  const assignRe = /\w+\.modelEmittedText\s*=(?![=>])/g;
  const literalRe = /\{\s*modelEmittedText:/g;
  // Per-file expectation: [property assignments, object-literal writes].
  // 1. screens/AiChatPage.tsx — hydration restore + finalize spread (capture
  //    producer writes the pair through the finalize literal).
  // 2. app/AppShell.tsx — validateHistoryMessages + engine-message copy.
  // 3. context/compactor.ts — toEngineHistoryMessage assembly.
  // 4. engine/historyPersistable.ts — persistence normaliser.
  const expected = {
    "screens/AiChatPage.tsx": [1, 1],
    "app/AppShell.tsx": [2, 0],
    "context/compactor.ts": [1, 0],
    "engine/historyPersistable.ts": [1, 0],
  };

  function listSources(dir) {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .flatMap((e) => {
        const p = path.join(dir, e.name);
        return e.isDirectory()
          ? listSources(p)
          : /\.tsx?$/.test(e.name) && !/\.test\./.test(e.name)
            ? [p]
            : [];
      });
  }

  for (const [rel, [assigns, literals]] of Object.entries(expected)) {
    const src = fs.readFileSync(path.join(srcRoot, rel), "utf8");
    const found = [
      ...(src.match(assignRe) ?? []),
      ...(src.match(literalRe) ?? []),
    ];
    const expectedCount = assigns + literals;
    if (found.length !== expectedCount) {
      throw new Error(
        `${rel}: expected ${expectedCount} writer(s) of modelEmittedText, ` +
          `found ${found.length} (${JSON.stringify(found)}) — a writer was ` +
          `added or removed without updating the emissionSource audit`,
      );
    }
    for (const m of found) {
      const at = src.indexOf(m);
      const region = src.slice(Math.max(0, at - 200), at + m.length + 400);
      if (!region.includes("emissionSource")) {
        throw new Error(
          `${rel}: the writer "${m.trim()}" does not handle emissionSource ` +
            `beside it — a string moved without its provenance flag desyncs ` +
            `the renderer from the native KV`,
        );
      }
    }
  }

  let total = 0;
  const unregistered = [];
  for (const file of listSources(srcRoot)) {
    const src = fs.readFileSync(file, "utf8");
    const hits = [
      ...(src.match(assignRe) ?? []),
      ...(src.match(literalRe) ?? []),
    ];
    total += hits.length;
    const rel = path.relative(srcRoot, file);
    if (hits.length > 0 && expected[rel] === undefined) {
      unregistered.push(`${rel}: ${hits.length}`);
    }
  }
  if (unregistered.length > 0) {
    throw new Error(
      `unregistered writer(s) of modelEmittedText in src — set or clear ` +
        `emissionSource beside the string and register the site in this ` +
        `audit: ${unregistered.join(", ")}`,
    );
  }
  if (total !== 6) {
    throw new Error(
      `expected 6 writers of modelEmittedText across src, found ${total} — ` +
        `the writer list changed; update the audit on purpose`,
    );
  }
  console.log("PASS emissionSource writer audit (6 writers, all paired)");
}

function main() {
  try {
    compile();
    const {
      historyBudgetCharge,
      historyReplayCharLength,
      llamaHistoryAssistantFields,
      normalizeModelEmittedTextForSave,
      readModelEmittedText,
    } = require(resolveBuiltModule());

    // ── emissionSource: provenance decides the seed ─────────────────────────
    // "parsed" (completed turn, reasoning_format "none") keeps the seeded tag
    // inside content; "raw" (interrupted accumulation) never includes it — the
    // seed is prompt bytes, so it is restored unconditionally, EVEN when the
    // model echoed the tag itself (the KV then legitimately holds two).
    assert.deepEqual(
      llamaHistoryAssistantFields({
        role: "assistant",
        content: "",
        modelEmittedText: "<think>unfinished",
        emissionSource: "raw",
      }),
      { content: "<think><think>unfinished" },
      "raw + echoed tag renders TWO opens — the hole the flag closes",
    );
    assert.deepEqual(
      llamaHistoryAssistantFields({
        role: "assistant",
        content: "",
        modelEmittedText: "partial answer",
        emissionSource: "raw",
      }),
      { content: "<think>partial answer" },
      "raw without a tag still gets the seed restored",
    );
    assert.deepEqual(
      llamaHistoryAssistantFields({
        role: "assistant",
        content: "answer",
        modelEmittedText: "<think>\n\n</think>answer",
        emissionSource: "parsed",
      }),
      { content: "<think>\n\n</think>answer" },
      "parsed never duplicates the tag the parser kept",
    );
    assert.deepEqual(
      llamaHistoryAssistantFields({
        role: "assistant",
        content: "",
        modelEmittedText: "<think>kept",
      }),
      { content: "<think>kept" },
      "unknown provenance keeps the pre-flag syntactic behaviour (no migration)",
    );
    assert.equal(
      historyReplayCharLength(
        {
          role: "assistant",
          text: "ui",
          modelEmittedText: "<think>unfinished",
          emissionSource: "raw",
        },
        { historyThink: "reasoning_content" },
      ),
      "<think>unfinished".length + 7,
      "raw charge always includes the seed",
    );
    console.log("PASS emissionSource provenance rendering");

    // ── The writer audit: every writer of modelEmittedText handles ──────────
    // emissionSource beside it. A flag that asserts something about native KV
    // state becomes a lie the moment a writer moves the string without it.
    assertEmissionSourceWriters();

    const cases = [
      {
        name: "empty raw",
        message: {
          role: "assistant",
          content: "",
          modelEmittedText: "",
        },
        options: undefined,
        expected: { content: "<think>" },
      },
      {
        name: "close at position zero",
        message: {
          role: "assistant",
          content: "</think>",
          modelEmittedText: "</think>",
        },
        options: undefined,
        expected: { content: "<think></think>" },
      },
      {
        name: "implicit-open close plus answer",
        message: {
          role: "assistant",
          content: "</think>ANSWER",
          modelEmittedText: "</think>ANSWER",
        },
        options: undefined,
        expected: { content: "<think></think>ANSWER" },
      },
      {
        name: "two closes",
        message: {
          role: "assistant",
          content: "REASONING</think>ANSWER</think>MORE",
          modelEmittedText: "REASONING</think>ANSWER</think>MORE",
        },
        options: undefined,
        expected: { content: "<think>REASONING</think>ANSWER</think>MORE" },
      },
      {
        name: "later opening tag",
        message: {
          role: "assistant",
          content: "REASONING</think>ANSWER <think>more",
          modelEmittedText: "REASONING</think>ANSWER <think>more",
        },
        options: undefined,
        expected: { content: "<think>REASONING</think>ANSWER <think>more" },
      },
      {
        name: "quoted opening tag",
        message: {
          role: "assistant",
          content: "a<think>b</think>c",
          modelEmittedText: "a<think>b</think>c",
        },
        options: undefined,
        expected: { content: "<think>a<think>b</think>c" },
      },
      {
        name: "form B: leading-think shape is not duplicated",
        message: {
          role: "assistant",
          content: "<think>REASONING</think>ANSWER",
          modelEmittedText: "<think>REASONING</think>ANSWER",
        },
        options: undefined,
        expected: { content: "<think>REASONING</think>ANSWER" },
      },
      {
        name: "form A interrupted: reasoning-only shape gets the prefix",
        message: {
          role: "assistant",
          content: "",
          modelEmittedText: "unfinished reasoning",
        },
        options: undefined,
        expected: { content: "<think>unfinished reasoning" },
      },
      {
        name: "form B: truncated leading-think shape is not duplicated",
        message: {
          role: "assistant",
          content: "<think>UNFINISHED",
          modelEmittedText: "<think>UNFINISHED",
        },
        options: undefined,
        expected: { content: "<think>UNFINISHED" },
      },
      {
        name: "form A: whitespace before think still gets the prefix",
        message: {
          role: "assistant",
          content: "ANSWER",
          modelEmittedText: "\n<think>REASONING</think>ANSWER",
        },
        options: undefined,
        expected: { content: "<think>\n<think>REASONING</think>ANSWER" },
      },
      {
        name: "form B: absent emission uses content as source",
        message: {
          role: "assistant",
          content: "<think>FALLBACK",
        },
        options: undefined,
        expected: { content: "<think>FALLBACK" },
      },
      {
        name: "form A: absent emission prefixes plain content",
        message: {
          role: "assistant",
          content: "plain content",
        },
        options: undefined,
        expected: { content: "<think>plain content" },
      },
      {
        name: "content_span branch",
        message: {
          role: "assistant",
          content: "ANSWER",
          modelEmittedText: "<think>REASONING</think>ANSWER",
        },
        options: { historyThink: "content_span" },
        expected: {
          content: "<think>REASONING</think>ANSWER",
          reasoning_content: "",
        },
      },
      {
        name: "content_span empty inner",
        message: {
          role: "assistant",
          content: "<think></think>ANSWER",
          modelEmittedText: "<think></think>ANSWER",
        },
        options: { historyThink: "content_span" },
        expected: {
          content: "<think></think>ANSWER",
          reasoning_content: "",
        },
      },
    ];

    for (const testCase of cases) {
      const actual = llamaHistoryAssistantFields(testCase.message, testCase.options);
      assert.deepEqual(actual, testCase.expected, testCase.name);
      console.log(`PASS ${testCase.name}`);
    }

    const normalizedRaw = "\nREASONING</think>ANSWER";
    assert.equal(
      normalizeModelEmittedTextForSave("assistant", normalizedRaw),
      normalizedRaw,
      "save normalizer preserves leading newline",
    );
    assert.deepEqual(
      llamaHistoryAssistantFields({
        role: "assistant",
        content: "ANSWER",
        modelEmittedText: normalizedRaw,
      }),
      { content: `<think>${normalizedRaw}` },
      "normalized leading-newline replay",
    );
    console.log("PASS save normalizer and leading-newline replay");

    // Save and load are ONE policy: whitespace-only → absent, everything else
    // byte-for-byte. The load twin (readModelEmittedText) is the same function
    // AppShell's history validation must call.
    assert.equal(
      readModelEmittedText("assistant", "\nREASONING</think>ANSWER"),
      "\nREASONING</think>ANSWER",
      "load preserves a leading newline byte-for-byte",
    );
    assert.equal(
      readModelEmittedText("assistant", "   \n\t  "),
      undefined,
      "load treats whitespace-only as absent, like save",
    );
    assert.equal(
      normalizeModelEmittedTextForSave("assistant", "  hello  "),
      readModelEmittedText("assistant", "  hello  "),
      "save and load agree byte-for-byte on a padded emission",
    );
    console.log("PASS load twin of the save normalizer");

    assertAppShellLoadPreservesBytes();

    const formA = "RAW";
    const formB = "<think>RAW";
    const whitespaceBeforeThink = "\n<think>RAW";
    assert.equal(
      historyReplayCharLength(
        { role: "assistant", text: "ui", modelEmittedText: formA },
        { historyThink: "reasoning_content" },
      ),
      formA.length + 7,
      "form A budget includes the seeded prefix",
    );
    assert.equal(
      historyReplayCharLength(
        { role: "assistant", text: "ui", modelEmittedText: formB },
        { historyThink: "reasoning_content" },
      ),
      formB.length,
      "form B budget does not charge an absent prefix",
    );
    assert.equal(
      historyReplayCharLength(
        { role: "assistant", text: "ui", modelEmittedText: whitespaceBeforeThink },
        { historyThink: "reasoning_content" },
      ),
      whitespaceBeforeThink.length + 7,
      "strict whitespace-before-tag budget includes the seeded prefix",
    );
    assert.equal(
      historyReplayCharLength(
        { role: "assistant", content: "<think>FALLBACK" },
        { historyThink: "reasoning_content" },
      ),
      "<think>FALLBACK".length,
      "absent emission budget measures content source",
    );
    const fallbackText = "plain text";
    const differentContent = "<think>different content";
    assert.equal(
      historyReplayCharLength(
        { role: "assistant", text: fallbackText },
        { historyThink: "reasoning_content" },
      ),
      fallbackText.length + 7,
      "reachable absent emission budget measures text source",
    );
    assert.equal(
      historyReplayCharLength(
        { role: "assistant", text: fallbackText, content: differentContent },
        { historyThink: "reasoning_content" },
      ),
      fallbackText.length + 7,
      "text wins over different content in the reachable budget shape",
    );
    assert.equal(
      historyReplayCharLength(
        { role: "assistant", text: "ui", modelEmittedText: "RAW" },
        { historyThink: "content_span" },
      ),
      3,
      "Qwen budget remains raw length",
    );
    console.log("PASS history budget placement");

    // ── The window budget charges what assembly builds ──────────────────────
    // Assembly caps the stored text but never the replay field (byte-identity
    // with the KV). The budget must therefore charge a long emission at its
    // full replay length: an under-charge hides chars from the window walk AND
    // from the ceiling guard, which is how a held-KV send crosses n_ctx.
    const longEmission = `REASONING</think>${"x".repeat(5000)}`;
    const baseOpts = { historyThink: "reasoning_content", baseMessageCap: 4000 };
    assert.equal(
      historyBudgetCharge(
        { role: "assistant", text: "short ui", modelEmittedText: longEmission },
        baseOpts,
      ),
      longEmission.length + 7,
      "long emission is charged uncapped — capping hides it from the ceiling guard",
    );
    assert.equal(
      historyBudgetCharge(
        { role: "assistant", text: "ui", modelEmittedText: "RAW" },
        baseOpts,
      ),
      3 + 7,
      "short emission keeps the seeded-prefix charge",
    );
    assert.equal(
      historyBudgetCharge({ role: "user", text: "u".repeat(9000) }, baseOpts),
      4000,
      "user stored text is charged capped — assembly caps it",
    );
    assert.equal(
      historyBudgetCharge(
        { role: "user", text: "hello" },
        { ...baseOpts, userTailChars: 120 },
      ),
      125,
      "user tail rides the charge exactly as assembly applies it",
    );
    assert.equal(
      historyBudgetCharge(
        { role: "assistant", text: "hello", modelEmittedText: "hello" },
        { ...baseOpts, userTailChars: 120 },
      ),
      12,
      "assistant never carries the user tail",
    );
    console.log("PASS history budget charge matches assembly");

    // The AppShell wiring: the map must use historyBudgetCharge (the capped
    // form under-counted by emission.length - cap) and every budget consumer
    // must pass the no-cap marker, or messageCost re-shaves a long emission
    // back off behind the budget's back.
    {
      const appShellPath = path.join(projectRoot, "src/app/AppShell.tsx");
      const src = readFileSync(appShellPath, "utf8");
      if (src.includes("Math.min(historyReplayCharLength")) {
        throw new Error(
          "AppShell caps the window-budget charge with baseMessageCap again " +
            "(Math.min(historyReplayCharLength…)) — for any emission longer " +
            "than the cap the prompt carries more chars than the budget " +
            "believes, and the ceiling guard clears a window it thought was " +
            "inside n_ctx. Charge with historyBudgetCharge.",
        );
      }
      if (!src.includes("historyBudgetCharge(m, { historyThink, baseMessageCap, userTailChars })")) {
        throw new Error(
          "AppShell's historyLengths walk must price each message with " +
            "historyBudgetCharge — the per-message budget charge lives there",
        );
      }
      const noCapCount = (src.match(/noPerMessageCap/g) ?? []).length;
      if (noCapCount !== 6) {
        throw new Error(
          `AppShell must declare noPerMessageCap once and pass it to all five ` +
            `budget consumers (windowStartIndex, anchoredWindowChars, ` +
            `shouldRebuildAnchored, advanceAnchoredBoundary, ` +
            `advanceCompactionBoundary) — found ${noCapCount} of 6 occurrences`,
        );
      }
      console.log("PASS AppShell budget consumers do not re-cap the replay field");
    }
  } catch (error) {
    console.error(error instanceof Error ? error.stack : error);
    process.exitCode = 1;
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
}

main();
