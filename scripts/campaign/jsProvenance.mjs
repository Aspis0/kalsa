/** Verify the JS source the installed Android app will actually execute. */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { runMetroGate, verifyBundleText } from "./metroGate.mjs";

const PACKAGE_NAME = "com.kalsa.app";
const EMBEDDED_ENTRY = "assets/index.android.bundle";
const HERMES_MAGIC = Buffer.from([0xc6, 0x1f, 0xbc, 0x03]);
const MAX_UNZIP_BYTES = 256 * 1024 * 1024;

function command(name, args, options = {}) {
  const result = spawnSync(name, args, {
    encoding: options.encoding || "utf8",
    maxBuffer: MAX_UNZIP_BYTES,
  });
  if (result.error) throw new Error(`${name} failed: ${result.error.message}`);
  if (result.status !== 0) {
    const detail = String(result.stderr || "").trim();
    throw new Error(`${name} exited ${result.status}${detail ? `: ${detail}` : ""}`);
  }
  return result;
}

function requiredArg(flag) {
  const index = process.argv.indexOf(flag);
  const value = index >= 0 ? process.argv[index + 1] : "";
  if (index < 0 || !value || value.startsWith("-")) {
    throw new Error(`usage: jsProvenance.mjs --apk APK --evidence-dir DIR (missing ${flag})`);
  }
  return value;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function prepareEvidence(evidenceDir) {
  mkdirSync(evidenceDir, { recursive: true });
  for (const name of ["bundle.sha256", "result.json"]) {
    if (existsSync(path.join(evidenceDir, name))) {
      throw new Error(`refusing to overwrite existing evidence: ${path.join(evidenceDir, name)}`);
    }
  }
}

function installedApkHashes(apkHash) {
  const serial = process.env.ANDROID_SERIAL || process.env.CAMPAIGN_SERIAL;
  if (!serial) throw new Error("ANDROID_SERIAL or CAMPAIGN_SERIAL is required");
  const paths = command("adb", ["-s", serial, "shell", "pm", "path", PACKAGE_NAME])
    .stdout.toString()
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("package:"))
    .map((line) => line.slice("package:".length).trim())
    .filter(Boolean);
  if (paths.length === 0) throw new Error(`adb pm path returned no APK for ${PACKAGE_NAME}`);

  const hashes = [];
  for (const devicePath of paths) {
    const result = command("adb", ["-s", serial, "shell", "sha256sum", devicePath]);
    const match = result.stdout.toString().match(/\b([0-9a-f]{64})\b/i);
    if (!match) throw new Error(`could not read sha256 for device APK ${devicePath}`);
    hashes.push({ path: devicePath, hash: match[1].toLowerCase() });
  }
  if (!hashes.some((item) => item.hash === apkHash)) {
    throw new Error(
      `local APK sha256 ${apkHash} does not match installed APKs: ${hashes
        .map((item) => `${item.path}=${item.hash}`)
        .join(", ")}`,
    );
  }
  return hashes;
}

function embeddedResult(
  evidenceDir,
  apk,
  apkHash,
  installed,
  bundle,
  bundleFormat,
  checks,
  error = null,
) {
  const digest = bundle ? sha256(bundle) : null;
  return {
    schema: "kalsa.metro-content-gate.v2",
    evidenceDir,
    requestedEvidenceDir: evidenceDir,
    requestedUrl: null,
    expectedBundlePath: EMBEDDED_ENTRY,
    fuseboxEnabled: null,
    fetchedAt: new Date().toISOString(),
    partialBody: false,
    bundleBytes: bundle?.length ?? null,
    sha256: digest,
    bundleFormat,
    apkSha256: apkHash,
    installedApkHashes: installed,
    httpStatus: null,
    responseMetadata: null,
    checks,
    error,
    ok: bundleFormat === "hermes-bytecode" ? !error : checks?.ok === true && !error,
    source: "embedded-apk",
    apk,
  };
}

function writeEmbeddedEvidence(evidenceDir, result) {
  if (result.sha256 !== null) {
    writeFileSync(
      path.join(evidenceDir, "bundle.sha256"),
      `sha256=${result.sha256}\nbytes=${result.bundleBytes}\n`,
      "utf8",
    );
  }
  writeFileSync(
    path.join(evidenceDir, "result.json"),
    `${JSON.stringify(result, null, 2)}\n`,
    "utf8",
  );
}

async function verify(apk, evidenceDir) {
  let apkBytes;
  try {
    apkBytes = readFileSync(apk);
  } catch (error) {
    throw new Error(`could not read APK ${apk}: ${error.message}`);
  }
  const apkHash = sha256(apkBytes);
  const installed = installedApkHashes(apkHash);
  console.log(`js provenance apk-sha256=${apkHash} installed=${installed.map((item) => `${item.path}:${item.hash}`).join(",")}`);
  const listed = command("unzip", ["-l", apk]);
  const hasEmbeddedEntry = listed.stdout
    .toString()
    .split(/\r?\n/)
    .some((line) => line.trim().split(/\s+/).at(-1) === EMBEDDED_ENTRY);

  if (!hasEmbeddedEntry) {
    console.log(
      `js provenance source=metro reason=${EMBEDDED_ENTRY} is absent from the verified installed APK`,
    );
    return runMetroGate({ evidenceDir });
  }

  console.log(
    `js provenance source=embedded-apk reason=${EMBEDDED_ENTRY} is present in the verified installed APK`,
  );
  prepareEvidence(evidenceDir);
  const extracted = command(
    "unzip",
    ["-p", apk, EMBEDDED_ENTRY],
    { encoding: "buffer" },
  ).stdout;
  const bundleFormat = extracted.subarray(0, HERMES_MAGIC.length).equals(HERMES_MAGIC)
    ? "hermes-bytecode"
    : "plain-text";
  if (bundleFormat === "hermes-bytecode") {
    const result = embeddedResult(
      evidenceDir,
      apk,
      apkHash,
      installed,
      extracted,
      bundleFormat,
      null,
    );
    writeEmbeddedEvidence(evidenceDir, result);
    console.log(`metro gate evidence=${evidenceDir}`);
    console.log(`metro gate requested-url=embedded://${EMBEDDED_ENTRY}`);
    console.log(
      `metro gate HTTP=none bytes=${result.bundleBytes} sha256=${result.sha256}`,
    );
    console.log("metro gate bundle-format=hermes-bytecode");
    console.log(
      "metro gate content-inspection=not-possible reason=Hermes bytecode is binary; source-text protocol checks cannot inspect it",
    );
    console.log(
      "metro gate identity=PASS means the device runs exactly this APK; it does not mean any protocol code was verified",
    );
    console.log("metro gate result=PASS");
    return result;
  }

  const checks = verifyBundleText(extracted);
  const result = embeddedResult(
    evidenceDir,
    apk,
    apkHash,
    installed,
    extracted,
    bundleFormat,
    checks,
    checks.ok ? null : "embedded bundle failed the content checks",
  );
  writeEmbeddedEvidence(evidenceDir, result);
  console.log(`metro gate evidence=${evidenceDir}`);
  console.log(`metro gate requested-url=embedded://${EMBEDDED_ENTRY}`);
  console.log(
    `metro gate HTTP=none bytes=${result.bundleBytes} sha256=${result.sha256}`,
  );
  console.log(`metro gate bundle-format=${bundleFormat}`);
  console.log(`metro gate bundle-mode=${checks.bundleMode}`);
  console.log(
    `metro gate checks=marker,forbidden-stale-symbols${checks.bundleMode === "unminified" ? ",in-flight-semantics" : ""}`,
  );
  console.log(`metro gate marker=${checks.marker.present ? "present" : "missing"}`);
  console.log(
    `metro gate in-flight-semantics=${checks.inFlightSemantics.checked === false ? "not-checked" : checks.inFlightSemantics.present ? "present" : "missing"}`,
  );
  console.log(
    `metro gate forbidden-stale-symbols=${checks.forbidden.every((item) => !item.present) ? "absent" : "present"}`,
  );
  console.log(`metro gate result=${result.ok ? "PASS" : "FAIL"}`);
  if (result.error) console.error(`metro gate error=${result.error}`);
  return result;
}

try {
  const result = await verify(requiredArg("--apk"), requiredArg("--evidence-dir"));
  process.exitCode = result.ok ? 0 : 1;
} catch (error) {
  console.error(`js provenance error=${error.message || String(error)}`);
  process.exitCode = 2;
}
