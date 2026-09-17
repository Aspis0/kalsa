#!/usr/bin/env node
/**
 * Deterministic engine build id from the inputs the compiled engine actually
 * depends on, shaped `kalsa-eng-v2:<64 hex>`.
 *
 * WHY THIS EXISTS: the saved KV sidecar must be invalidated when the compiled
 * engine changes. A runtime marker alone ("kalsa-native-patches") is a boolean
 * literal and cannot tell two engine builds apart (audit of e2e09f5,
 * 2026-09-10).
 *
 * llama.rn is a git dependency on the fork and its installed cpp/ IS the
 * engine tree (no overlay, no patch-package). The id binds CONTENT, not just
 * pointers to it:
 *   - llamaRnCommit: the fork commit from package-lock.json (fail-closed
 *     provenance of the dependency)
 *   - kalsallamaSha: cpp/KALSALLAMA_SHA (fail-closed proof the installed tree
 *     is the kalsallama fork, not upstream llama.rn)
 *   - engineTree: digest of node_modules/llama.rn/{cpp,android,bin,ios} minus
 *     in-place build output — the actual compiled content, so a drifted or
 *     re-resolved tree changes the id even when every pointer matches
 *   - native: digest of the native/ sources compiled on top (bmoe streamer,
 *     GovernorBatteryModule)
 *   - sourceBuildPlugin: plugins/withLlamaFromSource.js
 *   - llamaRnVersion: the bridge version string
 *
 * There is no variant: the fork ships no prebuilt jniLibs, the engine is
 * always compiled from source.
 *
 * The result is embedded at prebuild into the shipped APK's app.config `extra`
 * (see app.config.js) and consumed at runtime by src/engine/engineIdentity.ts.
 * Same inputs -> same id, any input change -> different id. It never
 * fabricates a value: unreadable or malformed inputs throw so prebuild fails
 * loudly instead of shipping an unidentifiable engine.
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

// In-place build output generated inside the installed package: not an input.
function isBuildOutput(rel) {
  return (
    rel === "android/.cxx" ||
    rel.startsWith("android/.cxx/") ||
    rel === "android/build" ||
    rel.startsWith("android/build/") ||
    rel === "ios/build" ||
    rel.startsWith("ios/build/") ||
    rel.split("/").includes("node_modules")
  );
}

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

/**
 * Recursive file list, POSIX-relative, sorted. Ignores filesystem noise,
 * skips paths the caller excludes, and refuses symlinks: a link could make
 * the digest depend on state outside the tree it names.
 */
function listFilesRecursive(dir, base = dir, exclude = null) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (error) {
    throw new Error(`engine-build-id: cannot list ${dir}: ${error.message}`);
  }
  const out = [];
  for (const entry of entries) {
    if (IGNORED_BASENAMES.has(entry.name)) continue;
    const abs = path.join(dir, entry.name);
    const rel = path.relative(base, abs).split(path.sep).join("/");
    if (exclude && exclude(rel)) continue;
    if (entry.isSymbolicLink()) {
      throw new Error(`engine-build-id: symlink in input tree: ${abs}`);
    }
    if (entry.isDirectory()) {
      out.push(...listFilesRecursive(abs, base, exclude));
    } else if (entry.isFile()) {
      out.push(rel);
    }
  }
  return out.sort();
}

function digestTree(dir, exclude = null) {
  return listFilesRecursive(dir, dir, exclude).map(
    (rel) => `${rel}:${sha256Hex(readFileOrThrow(path.join(dir, rel)))}`,
  );
}

// Both npm serializations of the github.com git dependency. The ssh form is
// npm's normal lockfile form and needs no SSH key: pacote clones over https
// first and only falls back to ssh.
const LLAMA_RN_GIT_URL =
  /^git\+(?:ssh|https):\/\/(?:git@)?github\.com\/Aspis0\/llama\.rn(?:\.git)?$/;

/**
 * The 40-hex llama.rn fork commit: the sha after the last '#' of the lockfile
 * resolved URL for node_modules/llama.rn. A wrong host/owner/repo or a
 * missing/short sha fails closed.
 */
function llamaRnCommit(root) {
  const lock = readJsonOrThrow(path.join(root, "package-lock.json"));
  const entry = lock.packages && lock.packages["node_modules/llama.rn"];
  const resolved =
    entry && typeof entry.resolved === "string" ? entry.resolved : "";
  const hash = resolved.lastIndexOf("#");
  const url = hash === -1 ? resolved : resolved.slice(0, hash);
  const commit = resolved.slice(hash + 1);
  if (!LLAMA_RN_GIT_URL.test(url)) {
    throw new Error(
      `engine-build-id: package-lock.json packages["node_modules/llama.rn"].resolved must be a github.com git URL for Aspis0/llama.rn (got ${JSON.stringify(resolved)})`,
    );
  }
  if (!/^[0-9a-f]{40}$/.test(commit)) {
    throw new Error(
      `engine-build-id: package-lock.json packages["node_modules/llama.rn"].resolved must end in '#<40-char sha>' (got ${JSON.stringify(resolved)})`,
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

  const packageDir = path.join(root, "node_modules", "llama.rn");
  return {
    llamaRnCommit: llamaRnCommit(root),
    kalsallamaSha: kalsallamaSha(root),
    engineTree: ["cpp", "android", "bin", "ios"].flatMap((sub) =>
      digestTree(path.join(packageDir, sub), isBuildOutput),
    ),
    native: digestTree(path.join(root, "native")),
    sourceBuildPlugin: sha256Hex(
      readFileOrThrow(path.join(root, "plugins", "withLlamaFromSource.js")),
    ),
    llamaRnVersion,
  };
}

function requireSha40(value, field) {
  if (typeof value !== "string" || !/^[0-9a-f]{40}$/.test(value)) {
    throw new Error(
      `engine-build-id: input ${field} must be a 40-hex sha (got ${JSON.stringify(value)})`,
    );
  }
  return value;
}

function requireSha256(value, field) {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) {
    throw new Error(
      `engine-build-id: input ${field} must be a 64-hex digest (got ${JSON.stringify(value)})`,
    );
  }
  return value;
}

function requireNonEmptyString(value, field) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(
      `engine-build-id: input ${field} must be a non-empty string (got ${JSON.stringify(value)})`,
    );
  }
  return value;
}

function requireDigestLines(value, field) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(
      `engine-build-id: input ${field} must be a non-empty array of strings (got ${JSON.stringify(value)})`,
    );
  }
  for (const entry of value) {
    if (typeof entry !== "string" || entry.length === 0) {
      throw new Error(
        `engine-build-id: input ${field} entries must be non-empty strings (got ${JSON.stringify(entry)})`,
      );
    }
    if (entry.includes("\n")) {
      throw new Error(
        `engine-build-id: input ${field} entries must not contain newlines (got ${JSON.stringify(entry)})`,
      );
    }
  }
  return value;
}

/** Validate inputs and hash them into a stable engine build id. */
function engineBuildIdFromInputs(inputs) {
  if (!inputs || typeof inputs !== "object") {
    throw new Error("engine-build-id: inputs required");
  }
  const canonical = [
    `llama-rn:${requireSha40(inputs.llamaRnCommit, "llamaRnCommit")}`,
    `kalsallama:${requireSha40(inputs.kalsallamaSha, "kalsallamaSha")}`,
    `llama-rn-version:${requireNonEmptyString(inputs.llamaRnVersion, "llamaRnVersion")}`,
    `source-plugin:${requireSha256(inputs.sourceBuildPlugin, "sourceBuildPlugin")}`,
    ...requireDigestLines(inputs.native, "native").map((n) => `native:${n}`),
    ...requireDigestLines(inputs.engineTree, "engineTree").map((n) => `engine:${n}`),
  ].join("\n");
  return `${ENGINE_BUILD_ID_PREFIX}:${sha256Hex(canonical)}`;
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
