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
