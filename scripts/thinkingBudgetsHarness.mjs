/**
 * Harness for src/engine/thinkingBudgets.ts (per-model thinking budgets).
 *
 * Covers:
 *  - every accepted mode keeps thinking on with a positive budget
 *  - default → thinking on, short budget (never 0)
 *  - budget256 / budget512 with null model → historical defaults
 *  - per-model short/extended/nPredict overrides
 *  - budget modes omit kwargs unless preserveThinking
 *  - nPredict floor of 1024
 *
 * Compile-from-disk pattern (same as turnTelemetryHarness). Exit 1 on fail.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

function compile() {
  const r = spawnSync(
    "npx",
    [
      "tsc",
      "src/engine/thinkingBudgets.ts",
      // Also emit ModelRegistry so case 10 asserts the REAL catalog values —
      // a registry typo (extended: 15360) must fail CI, not just synthetic models.
      "src/engine/ModelRegistry.ts",
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
      // thinkingBudgets type-imports ModelRegistry → contextProfile (require("expo-device")).
      // --types node arms require for that resolution chain; emitted JS still has no runtime deps.
      "--types",
      "node",
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
    path.join(projectRoot, "scripts/.build/thinkingBudgets.js"),
    path.join(projectRoot, "scripts/.build/engine/thinkingBudgets.js"),
    path.join(projectRoot, "scripts/.build/src/engine/thinkingBudgets.js"),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  console.error("Could not find compiled thinkingBudgets.js. Tried:\n", candidates.join("\n"));
  process.exit(1);
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function main() {
  console.log("Compiling thinkingBudgets.ts …");
  compile();
  const modPath = resolveBuilt();
  console.log("Loading", modPath);
  const { resolveThinkingParams } = await import(pathToFileURL(modPath).href);

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

  // ── 1. accepted modes ──────────────────────────────────────────────────
  test("accepted modes never disable thinking or use budget 0", () => {
    for (const mode of ["default", "budget256", "budget512"]) {
      const { fields } = resolveThinkingParams(mode, null);
      assert(fields.enable_thinking === true, `${mode}: enable_thinking must be true`);
      assert(
        typeof fields.thinking_budget_tokens === "number" && fields.thinking_budget_tokens > 0,
        `${mode}: thinking budget must be positive, got ${fields.thinking_budget_tokens}`,
      );
      assert(fields.enable_thinking !== false, `${mode}: enable_thinking must not be false`);
      assert(fields.thinking_budget_tokens !== 0, `${mode}: thinking budget must not be 0`);
    }
  });

  // ── 2. default ─────────────────────────────────────────────────────────
  test("default → thinking on, short budget (never 0)", () => {
    const { fields, nPredict } = resolveThinkingParams("default", null);
    assert(fields.enable_thinking === true, `enable_thinking expected true, got ${fields.enable_thinking}`);
    assert(fields.thinking_budget_tokens === 256, `budget expected 256, got ${fields.thinking_budget_tokens}`);
    assert(fields.thinking_budget_tokens !== 0, "production default must not be budget 0");
    assert(nPredict === 1024, `nPredict expected 1024, got ${nPredict}`);
  });

  test("default with model.thinking.short uses that budget", () => {
    const { fields, nPredict } = resolveThinkingParams("default", {
      thinking: { short: 512, extended: 1536, nPredict: 2560 },
    });
    assert(fields.enable_thinking === true, `enable_thinking expected true, got ${fields.enable_thinking}`);
    assert(fields.thinking_budget_tokens === 512, `budget expected 512, got ${fields.thinking_budget_tokens}`);
    assert(nPredict === 2560, `nPredict expected 2560, got ${nPredict}`);
    assert(fields.chat_template_kwargs === undefined, "Qwen-shaped model must not emit preserve_thinking");
  });

  test("preserveThinking model emits preserve_thinking: true", () => {
    const { fields } = resolveThinkingParams("default", {
      thinking: { short: 256, extended: 512 },
      preserveThinking: true,
    });
    assert(fields.chat_template_kwargs?.preserve_thinking === true, "preserve_thinking expected true");
    assert(fields.chat_template_kwargs?.enable_thinking === true, "enable_thinking kwargs expected true");
  });

  // ── 3. budget256 null model ────────────────────────────────────────────
  test("budget256 null model → budget 256, nPredict 1024", () => {
    const { fields, nPredict } = resolveThinkingParams("budget256", null);
    assert(fields.enable_thinking === true, `enable_thinking expected true, got ${fields.enable_thinking}`);
    assert(fields.thinking_budget_tokens === 256, `budget expected 256, got ${fields.thinking_budget_tokens}`);
    assert(nPredict === 1024, `nPredict expected 1024, got ${nPredict}`);
  });

  // ── 4. budget512 null model ────────────────────────────────────────────
  test("budget512 null model → budget 512, nPredict 1024", () => {
    const { fields, nPredict } = resolveThinkingParams("budget512", null);
    assert(fields.enable_thinking === true, `enable_thinking expected true, got ${fields.enable_thinking}`);
    assert(fields.thinking_budget_tokens === 512, `budget expected 512, got ${fields.thinking_budget_tokens}`);
    assert(nPredict === 1024, `nPredict expected 1024, got ${nPredict}`);
  });

  const model2b = { thinking: { short: 512, extended: 1536, nPredict: 2560 } };

  // ── 5. budget256 with 2B-like model ────────────────────────────────────
  test("budget256 with model short/nPredict → budget 512, nPredict 2560", () => {
    const { fields, nPredict } = resolveThinkingParams("budget256", model2b);
    assert(fields.thinking_budget_tokens === 512, `budget expected 512, got ${fields.thinking_budget_tokens}`);
    assert(nPredict === 2560, `nPredict expected 2560, got ${nPredict}`);
  });

  // ── 6. budget512 with 2B-like model ────────────────────────────────────
  test("budget512 with model extended/nPredict → budget 1536, nPredict 2560", () => {
    const { fields, nPredict } = resolveThinkingParams("budget512", model2b);
    assert(fields.thinking_budget_tokens === 1536, `budget expected 1536, got ${fields.thinking_budget_tokens}`);
    assert(nPredict === 2560, `nPredict expected 2560, got ${nPredict}`);
  });

  // ── 7. budget512 without nPredict ──────────────────────────────────────
  test("budget512 with short/extended only → budget 512, nPredict 1024", () => {
    const model = { thinking: { short: 256, extended: 512 } };
    const { fields, nPredict } = resolveThinkingParams("budget512", model);
    assert(fields.thinking_budget_tokens === 512, `budget expected 512, got ${fields.thinking_budget_tokens}`);
    assert(nPredict === 1024, `nPredict expected 1024, got ${nPredict}`);
  });

  // ── 8. budget modes omit reasoning_format / chat_template_kwargs ───────
  test("budget modes never set reasoning_format / chat_template_kwargs", () => {
    for (const mode of ["budget256", "budget512"]) {
      const { fields } = resolveThinkingParams(mode, null);
      assert(fields.reasoning_format === undefined, `${mode}: reasoning_format must be absent`);
      assert(fields.chat_template_kwargs === undefined, `${mode}: chat_template_kwargs must be absent`);
    }
  });

  // ── 9. nPredict floor 1024 ─────────────────────────────────────────────
  test("nPredict never below 1024 even if model.nPredict is smaller", () => {
    const model = { thinking: { short: 1, extended: 2, nPredict: 64 } };
    const { fields, nPredict } = resolveThinkingParams("budget256", model);
    assert(fields.thinking_budget_tokens === 1, `budget expected 1, got ${fields.thinking_budget_tokens}`);
    assert(nPredict === 1024, `nPredict expected 1024 floor, got ${nPredict}`);
  });

  // ── 10. REAL registry values (typo guard) ──────────────────────────────
  const registryPath = path.join(path.dirname(modPath), "ModelRegistry.js");
  const { MODEL_REGISTRY } = await import(pathToFileURL(registryPath).href);
  test("registry: 2B {512,1536,2560}, 4B {256,512}, extended headroom ≥1024 when nPredict set", () => {
    const byId = Object.fromEntries(MODEL_REGISTRY.map((m) => [m.id, m]));
    const t2b = byId["qwen3.5-2b"]?.thinking;
    assert(
      t2b && t2b.short === 512 && t2b.extended === 1536 && t2b.nPredict === 2560,
      `qwen3.5-2b thinking expected {512,1536,2560}, got ${JSON.stringify(t2b)}`,
    );
    for (const id of ["qwen3.5-4b", "qwen3.5-4b-q3"]) {
      const t = byId[id]?.thinking;
      assert(
        t && t.short === 256 && t.extended === 512 && t.nPredict === undefined,
        `${id} thinking expected {256,512}, got ${JSON.stringify(t)}`,
      );
    }
    for (const m of MODEL_REGISTRY) {
      if (m.thinking?.nPredict !== undefined) {
        assert(
          m.thinking.nPredict - m.thinking.extended >= 1024,
          `${m.id}: nPredict ${m.thinking.nPredict} - extended ${m.thinking.extended} < 1024 answer floor`,
        );
      }
    }
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  console.log("All thinkingBudgets harness cases passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
