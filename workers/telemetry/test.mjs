import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);
const out = mkdtempSync(path.join(tmpdir(), "kalsa-worker-v2-"));
const legacy = spawnSync("node", ["scripts/telemetryWorkerHarness.mjs"], { cwd: root, stdio: "inherit" });
assert.equal(legacy.status, 0, "v1 Worker harness");
const reads = spawnSync("node", ["workers/telemetry/test-admin-read.mjs"], { cwd: root, stdio: "inherit" });
assert.equal(reads.status, 0, "admin reports routes");
const cli = spawnSync("node", ["workers/telemetry/test-read-cli.mjs"], { cwd: root, stdio: "inherit" });
assert.equal(cli.status, 0, "read.mjs end-to-end");
try {
  const compile = spawnSync("npx", ["tsc", "workers/telemetry/schema.ts", "--outDir", out, "--module", "commonjs", "--target", "es2020", "--skipLibCheck", "--ignoreConfig", "--types", "node"], { cwd: root, encoding: "utf8" });
  assert.equal(compile.status, 0, compile.stdout + compile.stderr);
  const { validateReport, signatureFields, buildIssueBody, escapeIssueText } = require(path.join(out, "schema.js"));
  const { V2 } = require(path.join(out, "contract-v2.js"));
  const base = (platform = "macos", v = 2) => ({ v, app: "kalsa", appVersion: "0.1.0", platform, deviceBucket: "mid", osMajor: "15", error: { code: "engine.init", detail: "native_crash" }, context: { phase: "turn", modelCategory: "unknown" }, dateBucket: "2026-10-09", manual: false });
  for (const platform of ["android", "ios", "windows", "macos", "linux"]) {
    assert.equal(validateReport(base(platform, 1)), null, `v1 platform ${platform}`);
    assert.equal(validateReport({ ...base(platform), diagnostics: { osFamily: platform } }), null, `v2 platform ${platform}`);
  }
  assert.ok(validateReport(base("PRIVATE-HOST-CANARY")));
  for (const [field, values] of Object.entries(V2.enums)) {
    for (const value of values) assert.equal(validateReport({ ...base(field === "osFamily" ? value : "macos"), diagnostics: { [field]: value } }), null, `${field}=${value}`);
    assert.ok(validateReport({ ...base(), diagnostics: { [field]: "OUTSIDE-ALLOWLIST-CANARY" } }), `${field} rejects unknown`);
  }
  for (const [field, { labels }] of Object.entries(V2.buckets)) {
    if (field === "deviceBucket") continue;
    for (const value of labels) assert.equal(validateReport({ ...base(), diagnostics: { [field]: value } }), null, field);
    for (const value of ["OUTSIDE-ALLOWLIST-CANARY", 99, null]) assert.ok(validateReport({ ...base(), diagnostics: { [field]: value } }), field);
  }
  for (const field of ["onBattery", "exitCode", "exitSignal", "breadcrumbs", "signature", "gpuDriver", "cpuModel", "gpuModel"]) assert.ok(validateReport({ ...base(), diagnostics: { [field]: "OUTSIDE-ALLOWLIST-CANARY" } }), field);
  for (const diagnostics of [{ nope: "canary" }, { toString: "canary" }, { exitCode: 1.5 }, { exitCode: 4294967296 }, { exitSignal: 0 }, { exitSignal: 128 }, { exitSignal: -6 }, { onBattery: 1 }, { breadcrumbs: Array(9).fill({ component: "engine", stage: "load" }) }, { breadcrumbs: [{ component: "canary", stage: "load" }] }, { breadcrumbs: [{ component: "engine", stage: "canary" }] }, { breadcrumbs: [{ component: "engine", stage: "load", sinceStart: 1 }] }, { breadcrumbs: [{ component: "engine", stage: "load", timestamp: 1 }] }]) assert.ok(validateReport({ ...base(), diagnostics }));
  for (const canary of ["192.168.0.1", "127.0.0.1", "USER-TEXT-CANARY", "/Users/PRIVATE-CANARY/model.gguf", "https://SECRET-CANARY.example", "PRIVATE-HOST-CANARY.local", "C:\\private\\MODEL-CANARY.gguf"]) {
    for (const field of [...Object.keys(V2.enums), ...Object.keys(V2.buckets).filter(key => key !== "deviceBucket"), "cpuModel", "gpuModel", "gpuDriver", "signature", "engineRelease"]) assert.ok(validateReport({ ...base(), diagnostics: { gpuVendor: "apple", [field]: canary } }), field);
    for (const field of ["component", "stage", "sinceStart"]) assert.ok(validateReport({ ...base(), diagnostics: { breadcrumbs: [{ component: "engine", stage: "prefill", [field]: canary }] } }), `breadcrumb.${field}`);
    for (const field of ["gpuModel", "cpuModel"]) assert.ok(validateReport({ ...base(), diagnostics: { gpuVendor: "apple", [field]: `Apple M3 Pro ${canary}` } }), field);
  }
  for (const [gpuVendor, gpuModel] of [["intel", "Intel(R) Iris(R) Xe Graphics"], ["amd", "AMD Radeon RX 7900 XTX"], ["nvidia", "NVIDIA GeForce RTX 4090"], ["apple", "Apple M3 Pro"], ["qualcomm", "Qualcomm Adreno 740"], ["arm", "Mali-G710"]]) assert.equal(validateReport({ ...base(), diagnostics: { gpuVendor, gpuModel } }), null);
  for (const cpuModel of ["Apple M3 Pro", "Intel Core i7-13700K", "AMD Ryzen 9 7950X 16-Core Processor", "Snapdragon 8 Gen 2", "A17 Pro"]) assert.equal(validateReport({ ...base(), diagnostics: { cpuModel } }), null);
  assert.equal(validateReport({ ...base(), diagnostics: { gpuVendor: "apple", gpuModel: "Apple M3 Pro", gpuDriver: "15.0.1", signature: "GGML_ASSERT ggml-vulkan.cpp:1234", exitSignal: 6, onBattery: false } }), null);
  assert.equal(validateReport({ ...base(), diagnostics: { gpuDriver: "31.0.101.5186", engineRelease: "v9.2.3" } }), null);
  assert.ok(validateReport({ ...base(), diagnostics: { engineRelease: "v9.2.3-extra" } }));
  assert.ok(validateReport({ ...base(), diagnostics: { gpuVendor: "intel", gpuModel: "Apple M3 Pro" } }));
  assert.ok(validateReport({ ...base(), diagnostics: { osFamily: "windows" } }));
  assert.ok(validateReport({ ...base("macos", 1), diagnostics: {} }), "v1 cannot carry v2 fields");
  const crash = { ...base(), diagnostics: { component: "engine", stage: "prefill", signature: "vk::DeviceLostError" } };
  assert.ok(buildIssueBody("abc", crash).includes("stage: prefill"));
  const hardware = { ...base(), diagnostics: { gpuVendor: "intel", gpuModel: "Intel(R) Iris(R) Xe Graphics", breadcrumbs: [{ component: "engine", stage: "prefill" }] } };
  assert.ok(buildIssueBody("abc", hardware).includes(`gpuModel: ${escapeIssueText(hardware.diagnostics.gpuModel)}`));
  assert.ok(!buildIssueBody("abc", hardware).includes("Iris(R)"));
  assert.ok(validateReport({ ...base(), diagnostics: { deviceBucket: "mid" } }));
  assert.ok(!buildIssueBody("abc", { ...crash, platform: "https://SECRET-CANARY.example" }).includes("SECRET-CANARY"));
  assert.notEqual(signatureFields(crash), signatureFields({ ...crash, diagnostics: { ...crash.diagnostics, stage: "decode" } }));
  if (process.env.KALSA_TELEMETRY_SAMPLE) {
    const sample = JSON.parse(readFileSync(process.env.KALSA_TELEMETRY_SAMPLE, "utf8"));
    assert.equal(validateReport(sample), null, "Rust sample passes the Worker");
  }
  console.log("v2 Worker allowlists, platforms, canaries, issue projection and signatures: PASS");
} finally { rmSync(out, { recursive: true, force: true }); }
