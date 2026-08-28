/**
 * Harness for src/engine/streamCoalescer.ts (~30 fps token UI coalescer).
 *
 * Covers:
 *  - leading-edge flush (first push / after interval)
 *  - trailing flush of the last push within a window
 *  - overwrite semantics (intermediate pushes dropped; LAST text wins)
 *  - finalize() flushes pending synchronously
 *  - cancel() drops pending without flushing
 *
 * Uses real short timers (no fake-timer deps). Exit 1 on any failure.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "../..");

function compile() {
  const r = spawnSync(
    "npx",
    [
      "tsc",
      "src/engine/streamCoalescer.ts",
      "--outDir",
      "scripts/.build",
      "--module",
      "nodenext",
      "--target",
      "es2020",
      "--moduleResolution",
      "nodenext",
      "--skipLibCheck",
      "--ignoreConfig",
    ],
    { cwd: projectRoot, encoding: "utf8", shell: true },
  );
  if (r.status !== 0) {
    console.error("tsc failed:\n", r.stdout, r.stderr);
    process.exit(1);
  }
}

function resolveBuilt() {
  const candidates = [
    path.join(projectRoot, "scripts/.build/streamCoalescer.js"),
    path.join(projectRoot, "scripts/.build/engine/streamCoalescer.js"),
    path.join(projectRoot, "scripts/.build/src/engine/streamCoalescer.js"),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  console.error("Could not find compiled streamCoalescer.js. Tried:\n", candidates.join("\n"));
  process.exit(1);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function main() {
  console.log("Compiling streamCoalescer.ts …");
  compile();
  const modPath = resolveBuilt();
  console.log("Loading", modPath);
  const { createStreamCoalescer } = await import(pathToFileURL(modPath).href);

  let passed = 0;
  let failed = 0;

  async function test(name, fn) {
    try {
      await fn();
      console.log(`  OK  ${name}`);
      passed += 1;
    } catch (err) {
      console.error(`  FAIL ${name}: ${err instanceof Error ? err.message : err}`);
      failed += 1;
    }
  }

  // ── 1. Leading-edge: first push flushes immediately ───────────────────
  await test("leading-edge flush on first push", async () => {
    const flushes = [];
    const c = createStreamCoalescer((t) => flushes.push(t), 40);
    c.push("a");
    assert(flushes.length === 1, `expected 1 flush, got ${flushes.length}`);
    assert(flushes[0] === "a", `expected "a", got ${JSON.stringify(flushes[0])}`);
    c.cancel();
  });

  // ── 2. Trailing flush of last push within the window ──────────────────
  await test("trailing flush of last push", async () => {
    const flushes = [];
    const c = createStreamCoalescer((t) => flushes.push(t), 40);
    c.push("a"); // leading
    c.push("b"); // pending trailing
    assert(flushes.length === 1, `expected only leading so far, got ${flushes.length}`);
    await sleep(55);
    assert(flushes.length === 2, `expected trailing flush, got ${flushes.length}`);
    assert(flushes[1] === "b", `expected "b", got ${JSON.stringify(flushes[1])}`);
    c.cancel();
  });

  // ── 3. Overwrite: intermediate pushes dropped; LAST wins ──────────────
  await test("overwrite semantics (last text wins)", async () => {
    const flushes = [];
    const c = createStreamCoalescer((t) => flushes.push(t), 40);
    c.push("v1"); // leading
    c.push("v2");
    c.push("v3");
    c.push("v4"); // last pending
    await sleep(55);
    assert(flushes.length === 2, `expected leading + one trailing, got ${flushes.length}: ${JSON.stringify(flushes)}`);
    assert(flushes[0] === "v1", `leading should be v1, got ${flushes[0]}`);
    assert(flushes[1] === "v4", `trailing should be v4 (last), got ${flushes[1]}`);
    c.cancel();
  });

  // ── 4. Leading edge again after interval elapsed ──────────────────────
  await test("leading edge after interval elapsed", async () => {
    const flushes = [];
    const c = createStreamCoalescer((t) => flushes.push(t), 30);
    c.push("a");
    await sleep(40);
    c.push("b"); // should lead immediately
    assert(flushes.length === 2, `expected 2 immediate flushes, got ${flushes.length}`);
    assert(flushes[1] === "b", `expected "b", got ${flushes[1]}`);
    c.cancel();
  });

  // ── 5. finalize flushes pending ───────────────────────────────────────
  await test("finalize flushes pending", async () => {
    const flushes = [];
    const c = createStreamCoalescer((t) => flushes.push(t), 200);
    c.push("a"); // leading
    c.push("pending");
    assert(flushes.length === 1, "pending should not have flushed yet");
    c.finalize();
    assert(flushes.length === 2, `expected finalize flush, got ${flushes.length}`);
    assert(flushes[1] === "pending", `expected "pending", got ${flushes[1]}`);
    // Second finalize is a no-op (nothing pending).
    c.finalize();
    assert(flushes.length === 2, "second finalize should not re-flush");
  });

  // ── 6. cancel drops pending without flushing ──────────────────────────
  await test("cancel drops pending", async () => {
    const flushes = [];
    const c = createStreamCoalescer((t) => flushes.push(t), 50);
    c.push("a"); // leading
    c.push("should-not-appear");
    c.cancel();
    await sleep(70);
    assert(flushes.length === 1, `expected only leading, got ${flushes.length}: ${JSON.stringify(flushes)}`);
    assert(flushes[0] === "a", `expected "a", got ${flushes[0]}`);
  });

  // ── 7. finalize after cancel does nothing ─────────────────────────────
  await test("finalize after cancel is no-op", async () => {
    const flushes = [];
    const c = createStreamCoalescer((t) => flushes.push(t), 50);
    c.push("a");
    c.push("x");
    c.cancel();
    c.finalize();
    assert(flushes.length === 1, `expected only leading, got ${flushes.length}`);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  console.log("All streamCoalescer harness cases passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
