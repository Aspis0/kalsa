/**
 * Regression harness for the whisper.rn Buffer chain (voice crash, task #24).
 *
 * whisper.rn imports `safe-buffer`, whose module body ALWAYS runs
 * `SafeBuffer.prototype = Object.create(Buffer.prototype)` (safe-buffer:24).
 * A hand-rolled `buffer` shim exporting a plain object had no `.prototype`,
 * so that line threw "Object prototype may only be an Object or null" inside
 * metroRequire — a deterministic release-build crash the moment the user
 * tapped stop-and-transcribe (device logcat 2026-08-08 21:09:35).
 *
 * This harness fails if the resolved `buffer` implementation cannot carry
 * safe-buffer's module body, or if the base64 path whisper.rn uses breaks.
 */
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  OK  ${name}`);
    passed += 1;
  } catch (err) {
    console.error(`  FAIL ${name}: ${err instanceof Error ? err.message : err}`);
    failed += 1;
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

test("buffer resolves to an implementation with a real Buffer.prototype", () => {
  const buffer = require("buffer");
  assert(typeof buffer.Buffer === "function", `Buffer must be a constructor, got ${typeof buffer.Buffer}`);
  assert(
    buffer.Buffer.prototype && typeof buffer.Buffer.prototype === "object",
    "Buffer.prototype must be an object — Object.create(Buffer.prototype) is executed by safe-buffer",
  );
});

test("safe-buffer module body loads (the exact crash site)", () => {
  const sb = require("safe-buffer");
  assert(typeof sb.Buffer.from === "function", "safe-buffer must expose Buffer.from");
});

test("Buffer.from(base64) — the call whisper.rn makes on transcribe", () => {
  const { Buffer } = require("safe-buffer");
  assert(Buffer.from("aGk=", "base64").toString() === "hi", "base64 decode must round-trip");
});

test("Buffer.from(Uint8Array) keeps byte length", () => {
  const { Buffer } = require("safe-buffer");
  assert(Buffer.from(new Uint8Array([1, 2, 3])).length === 3, "byte length must be preserved");
});

test("no hand-rolled buffer shim is aliased in metro config", () => {
  const fs = require("node:fs");
  const cfg = fs.readFileSync(new URL("../metro.config.js", import.meta.url), "utf8");
  assert(
    !/moduleName === ["']buffer["']/.test(cfg),
    "metro.config.js still aliases 'buffer' to a local shim — that shim caused the voice crash",
  );
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
console.log("All bufferShim harness cases passed.");
