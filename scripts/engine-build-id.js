#!/usr/bin/env node
/**
 * Deterministic engine build id from the inputs the native build actually
 * compiles.
 *
 * WHY THIS EXISTS: the saved KV sidecar must be invalidated when the compiled
 * engine changes — a new kalsallama pin, new llama.rn bridge patches, changed
 * native sources, or a source-vs-prebuilt variant. A runtime marker alone
 * ("kalsa-native-patches") is a boolean literal and cannot tell two engine
 * builds apart, so it is not an identity (audit of e2e09f5, 2026-09-10).
 *
 * This module hashes the real, committed build inputs:
 *   - native/kalsallama.pin commit (the fork pin; vendor/kalsallama-cpp is the
 *     flattened tree for that commit, cross-checked by sync-kalsallama.sh)
 *   - every patches/*.patch (the llama.rn bridge/native patch set)
 *   - the native/ source tree compiled through those patches (bmoe streamer,
 *     GovernorBatteryModule)
 *   - scripts/sync-kalsallama.sh and plugins/withLlamaFromSource.js (the
 *     overlay/source-build machinery)
 *   - the llama.rn package version (the base tree the patches apply to)
 *   - the build variant: source (default) vs prebuilt jniLibs opt-out
 *
 * The result is embedded at prebuild into the shipped APK's app.config `extra`
 * (see app.config.js) and consumed at runtime by src/engine/engineIdentity.ts.
 * It is a pure function of the inputs: same inputs -> same id, any input
 * change -> different id. It never fabricates a value: unreadable inputs throw
 * so prebuild fails loudly instead of shipping an unidentifiable engine.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ENGINE_BUILD_ID_PREFIX = "kalsa-eng-v1";

// Filesystem noise that is not a build input and must not change the id.
const IGNORED_BASENAMES = new Set([
  ".DS_Store",
  "Thumbs.db",
  "desktop.ini",
]);

function sha256Hex(data) {
  return crypto.createHash("sha256").update(data).digest("hex");
}

function readFileOrThrow(file) {
  try {
    return fs.readFileSync(file);
  } catch (error) {
    throw new Error(`engine-build-id: cannot read ${file}: ${error.message}`);
  }
}

function readJsonOrThrow(file) {
  try {
    return JSON.parse(readFileOrThrow(file).toString("utf8"));
  } catch (error) {
    throw new Error(`engine-build-id: invalid JSON in ${file}: ${error.message}`);
  }
}

/** Recursive file list, POSIX-relative, sorted. Ignores filesystem noise. */
function listFilesRecursive(dir, base = dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (IGNORED_BASENAMES.has(entry.name)) continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listFilesRecursive(abs, base));
    } else if (entry.isFile()) {
      out.push(path.relative(base, abs).split(path.sep).join("/"));
    }
  }
  return out.sort();
}

function digestTree(dir) {
  return listFilesRecursive(dir).map(
    (rel) => `${rel}:${sha256Hex(readFileOrThrow(path.join(dir, rel)))}`,
  );
}

/**
 * Read the committed build inputs from a repository checkout.
 * Throws when a required input is missing so the build fails closed.
 */
function collectEngineBuildInputs(root = path.resolve(__dirname, "..")) {
  const pin = readJsonOrThrow(path.join(root, "native", "kalsallama.pin"));
  const commit = typeof pin.commit === "string" ? pin.commit.trim() : "";
  if (!/^[0-9a-f]{40}$/.test(commit)) {
    throw new Error(
      `engine-build-id: native/kalsallama.pin commit must be a 40-char sha (got ${JSON.stringify(pin.commit)})`,
    );
  }

  const patchesDir = path.join(root, "patches");
  const patches = fs
    .readdirSync(patchesDir)
    .filter((name) => name.endsWith(".patch"))
    .sort()
    .map((name) => `${name}:${sha256Hex(readFileOrThrow(path.join(patchesDir, name)))}`);
  if (patches.length === 0) {
    throw new Error("engine-build-id: no patches/*.patch found");
  }

  const native = digestTree(path.join(root, "native")).filter(
    (entry) => !entry.startsWith("kalsallama.pin:"),
  );

  const llamaRnPkg = readJsonOrThrow(
    path.join(root, "node_modules", "llama.rn", "package.json"),
  );
  const llamaRnVersion =
    typeof llamaRnPkg.version === "string" ? llamaRnPkg.version.trim() : "";
  if (!llamaRnVersion) {
    throw new Error("engine-build-id: node_modules/llama.rn version is missing");
  }

  const overlayScript = sha256Hex(
    readFileOrThrow(path.join(root, "scripts", "sync-kalsallama.sh")),
  );
  const sourceBuildPlugin = sha256Hex(
    readFileOrThrow(path.join(root, "plugins", "withLlamaFromSource.js")),
  );

  const variant =
    process.env.KALSA_LLAMA_FROM_SOURCE === "0" ? "prebuilt" : "source";

  return {
    pin: commit,
    variant,
    llamaRnVersion,
    overlayScript,
    sourceBuildPlugin,
    patches,
    native,
  };
}

/** Hash normalized inputs into a stable engine build id. */
function engineBuildIdFromInputs(inputs) {
  if (!inputs || typeof inputs !== "object") {
    throw new Error("engine-build-id: inputs required");
  }
  const canonical = [
    `pin:${inputs.pin}`,
    `variant:${inputs.variant}`,
    `llama.rn:${inputs.llamaRnVersion}`,
    `overlay:${inputs.overlayScript}`,
    `source-plugin:${inputs.sourceBuildPlugin}`,
    ...(inputs.patches || []).map((p) => `patch:${p}`),
    ...(inputs.native || []).map((n) => `native:${n}`),
  ].join("\n");
  return `${ENGINE_BUILD_ID_PREFIX}:${inputs.variant}:${sha256Hex(canonical)}`;
}

/** Convenience: collect from disk and hash. */
function computeEngineBuildId(root = path.resolve(__dirname, "..")) {
  return engineBuildIdFromInputs(collectEngineBuildInputs(root));
}

module.exports = {
  ENGINE_BUILD_ID_PREFIX,
  collectEngineBuildInputs,
  engineBuildIdFromInputs,
  computeEngineBuildId,
};

if (require.main === module) {
  process.stdout.write(`${computeEngineBuildId()}\n`);
}
