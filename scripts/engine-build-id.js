#!/usr/bin/env node
/**
 * Deterministic engine build id from the inputs the native build actually
 * compiles.
 *
 * WHY THIS EXISTS: the saved KV sidecar must be invalidated when the compiled
 * engine changes — a new llama.rn fork commit, a new kalsallama (llama.cpp
 * fork) base, changed native sources, or a source-vs-prebuilt variant. A
 * runtime marker alone ("kalsa-native-patches") is a boolean literal and
 * cannot tell two engine builds apart, so it is not an identity (audit of
 * e2e09f5, 2026-09-10).
 *
 * The engine tree now ships as one piece: llama.rn is a git dependency on the
 * fork, and the installed cpp/ IS the engine tree (no overlay, no
 * patch-package). The fork commit pins that whole tree, so the id hashes:
 *   - the llama.rn git commit (the 40-hex sha after the last '#' of
 *     package-lock.json's node_modules/llama.rn resolved URL) — it pins the
 *     entire engine tree, bridge and native sources alike
 *   - node_modules/llama.rn/cpp/KALSALLAMA_SHA — proves the installed tree is
 *     the kalsallama fork and names the llama.cpp commit it carries; a tree
 *     without that file is upstream llama.rn, not our fork, and must fail the
 *     build instead of borrowing an id
 *   - the native/ source tree compiled on top of it (bmoe streamer,
 *     GovernorBatteryModule)
 *   - plugins/withLlamaFromSource.js (the source-build machinery)
 *   - the llama.rn package version (the bridge version string) and the build
 *     variant: source (default) vs prebuilt jniLibs opt-out
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

const ENGINE_BUILD_ID_PREFIX = "kalsa-eng-v2";

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
 * The 40-hex llama.rn fork commit: the sha after the last '#' of the lockfile
 * resolved URL for node_modules/llama.rn. Nothing about the URL before the
 * '#' is assumed; without a trailing '#<40-hex>' the engine tree is not
 * pinned and the build fails closed.
 */
function llamaRnCommit(root) {
  const lock = readJsonOrThrow(path.join(root, "package-lock.json"));
  const entry = lock.packages && lock.packages["node_modules/llama.rn"];
  const resolved =
    entry && typeof entry.resolved === "string" ? entry.resolved : "";
  const commit = resolved.slice(resolved.lastIndexOf("#") + 1);
  if (!/^[0-9a-f]{40}$/.test(commit)) {
    throw new Error(
      `engine-build-id: package-lock.json packages["node_modules/llama.rn"].resolved must be a git URL ending in '#<40-char sha>' (got ${JSON.stringify(resolved)})`,
    );
  }
  return commit;
}

/**
 * The 40-hex kalsallama commit stamped into the installed engine tree. A tree
 * without it is upstream llama.rn, not our fork, and must not be identified.
 */
function kalsallamaSha(root) {
  const file = path.join(root, "node_modules", "llama.rn", "cpp", "KALSALLAMA_SHA");
  let raw;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch (error) {
    throw new Error(
      `engine-build-id: cannot read node_modules/llama.rn/cpp/KALSALLAMA_SHA: ${error.message} (a tree without it is upstream llama.rn, not the kalsallama fork)`,
    );
  }
  const sha = raw.trim();
  if (!/^[0-9a-f]{40}$/.test(sha)) {
    throw new Error(
      `engine-build-id: node_modules/llama.rn/cpp/KALSALLAMA_SHA must be a 40-char sha (got ${JSON.stringify(raw)})`,
    );
  }
  return sha;
}

/**
 * Read the committed build inputs from a repository checkout.
 * Throws when a required input is missing so the build fails closed.
 */
function collectEngineBuildInputs(root = path.resolve(__dirname, "..")) {
  const llamaRnPkg = readJsonOrThrow(
    path.join(root, "node_modules", "llama.rn", "package.json"),
  );
  const llamaRnVersion =
    typeof llamaRnPkg.version === "string" ? llamaRnPkg.version.trim() : "";
  if (!llamaRnVersion) {
    throw new Error("engine-build-id: node_modules/llama.rn version is missing");
  }

  const variant =
    process.env.KALSA_LLAMA_FROM_SOURCE === "0" ? "prebuilt" : "source";

  return {
    llamaRnCommit: llamaRnCommit(root),
    kalsallamaSha: kalsallamaSha(root),
    native: digestTree(path.join(root, "native")),
    sourceBuildPlugin: sha256Hex(
      readFileOrThrow(path.join(root, "plugins", "withLlamaFromSource.js")),
    ),
    variant,
    llamaRnVersion,
  };
}

/** Hash normalized inputs into a stable engine build id. */
function engineBuildIdFromInputs(inputs) {
  if (!inputs || typeof inputs !== "object") {
    throw new Error("engine-build-id: inputs required");
  }
  const canonical = [
    `llama-rn:${inputs.llamaRnCommit}`,
    `kalsallama:${inputs.kalsallamaSha}`,
    `variant:${inputs.variant}`,
    `llama-rn-version:${inputs.llamaRnVersion}`,
    `source-plugin:${inputs.sourceBuildPlugin}`,
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
