/**
 * Compile and exercise llamaHistoryAssistantFields without Jest or React Native.
 * Exit 1 on any compile or assertion failure.
 */

import { strict as assert } from "node:assert";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
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
      historyReplayCharLength,
      llamaHistoryAssistantFields,
      normalizeModelEmittedTextForSave,
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
        name: "leading-think shape",
        message: {
          role: "assistant",
          content: "<think>REASONING</think>ANSWER",
          modelEmittedText: "<think>REASONING</think>ANSWER",
        },
        options: undefined,
        expected: { content: "<think><think>REASONING</think>ANSWER" },
      },
      {
        name: "no-tags shape",
        message: {
          role: "assistant",
          content: "RAW",
          modelEmittedText: "RAW",
        },
        options: undefined,
        expected: { content: "<think>RAW" },
      },
      {
        name: "truncated shape",
        message: {
          role: "assistant",
          content: "<think>UNFINISHED",
          modelEmittedText: "<think>UNFINISHED",
        },
        options: undefined,
        expected: { content: "<think><think>UNFINISHED" },
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

    assert.equal(
      historyReplayCharLength(
        { role: "assistant", text: "ui", modelEmittedText: "RAW" },
        { historyThink: "reasoning_content" },
      ),
      3 + 7,
      "LFM budget includes the seven-character seeded prefix",
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
  } catch (error) {
    console.error(error instanceof Error ? error.stack : error);
    process.exitCode = 1;
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
}

main();
