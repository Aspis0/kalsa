#!/usr/bin/env node
/**
 * Deterministic engine build id, shaped `kalsa-eng-v2:<64 hex>`: the saved KV
 * sidecar must be invalidated when the compiled engine changes, and a bare
 * runtime marker cannot tell two builds apart (audit of e2e09f5, 2026-09-10).
 *
 * llama.rn is a git dependency on the fork; the engine it vendors under
 * vendor/llama.cpp IS the engine tree, and cpp/ is the binding on top of it.
 * The id binds CONTENT, not pointers: the fork commit from package-lock.json;
 * LLAMA_CPP_COMMIT in vendor/VERSIONS as fail-closed proof the tree is the
 * fork; the digested engine subtrees {android,bin,cpp,ios,lib,src,vendor}
 * — the native sources, JS bridge, and bin/ binaries the Android build reads,
 * minus build output, the prebuilt xcframework, the package-top node_modules
 * artifact (deeper node_modules components are digested), and npm's
 * pack-ignored components. The subject is always the INSTALLED tree: the
 * exclusions cover the divergences we know of, not every one npm applies
 * (it also strips *.orig, *.rej and nested lockfiles), so a git checkout of
 * the fork is not guaranteed to hash the same;
 * plus the native/ sources compiled on top, the source-build plugin, and the
 * bridge version. No variant: the fork has no prebuilt jniLibs. Embedded at
 * prebuild into app.config `extra` (app.config.js), read by
 * src/engine/engineIdentity.ts. Malformed or unreadable inputs throw so
 * prebuild fails loudly; a ':' in a digested path fails closed too.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ENGINE_BUILD_ID_PREFIX = "kalsa-eng-v2";

// Filesystem noise that is not a build input and must not change the id.
const IGNORED_BASENAMES = new Set([".DS_Store", "Thumbs.db", "desktop.ini"]);

// Engine-tree subtrees the Android engine build actually reads, evaluated on
// PACKAGE-relative paths. bin/ IS an input: gradle copies bin/arm64-v8a/
// libggml-htp-*.so into the APK assets and CMake links bin/${ANDROID_ABI}/
// libOpenCL.so; src/ and lib/ carry the JS bridge the app bundles.
//
// vendor/ REPLACED third_party/ in the fork's vendor migration, and it is not
// a cosmetic rename: the engine itself now lives in vendor/llama.cpp, and the
// OpenCL headers under vendor/OpenCL-Headers. isEngineTreeExcluded() drops any
// top-level component missing from this set, so leaving vendor/ out would mint
// an engine build id that does not cover the engine -- two different engines,
// one id.
const ENGINE_TREE_DIRS = new Set(["android", "bin", "cpp", "ios", "lib", "src", "vendor"]);

// Not engine input: in-place build output, the prebuilt xcframework (npm's
// files field excludes it too — it is why the commit tree and the npm-packed
// tree differ), and the package-top node_modules install artifact. A deeper
// node_modules component is NOT excluded: the rule is top-level only.
const ENGINE_TREE_EXCLUDED = ["android/.cxx", "android/build", "ios/build", "ios/rnllama.xcframework"];

/** The package's own "files" negations, for the components npm never ships.
 * Read from the installed package.json rather than copied here: the fork
 * excludes four vendor/ backends it does not build, and a second hand-written
 * copy of that list is what drifts. Only plain prefixes are taken; the glob
 * forms are already covered above and by NPM_PACK_IGNORED. */
function packNegatedPrefixes(pkg) {
  const files = Array.isArray(pkg.files) ? pkg.files : [];
  return files
    .filter((f) => typeof f === "string" && f.startsWith("!") && !f.includes("*"))
    .map((f) => f.slice(1).replace(/\/+$/, ""));
}

// npm pack never ships these components (package.json files negations).
const NPM_PACK_IGNORED = new Set(["__tests__", "__fixtures__", "__mocks__"]);

function isEngineTreeExcluded(rel) {
  if (!ENGINE_TREE_DIRS.has(rel.split("/")[0])) return true;
  if (ENGINE_TREE_EXCLUDED.some((d) => rel === d || rel.startsWith(`${d}/`))) {
    return true;
  }
  // Digesting pack-ignored components would make the id depend on how the
  // tree was materialised (git checkout vs npm install), not on its content.
  return rel.split("/").some((c) => c.startsWith(".") || NPM_PACK_IGNORED.has(c));
}

/** Every allow-listed subtree must contribute at least one digested file.
 * Checking the directory exists is not enough: an empty one — or one whose
 * whole content is excluded — digests a subset of the engine and mints a
 * different id in silence. */
function requireEveryEngineTreeDir(engineTree) {
  for (const dir of ENGINE_TREE_DIRS) {
    if (!engineTree.some((line) => line.startsWith(`${dir}/`))) {
      throw new Error(`engine-build-id: no digested file under ${dir} in node_modules/llama.rn`);
    }
  }
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
 * Recursive file list, POSIX-relative to base, sorted. Ignores filesystem
 * noise, skips paths the caller excludes, and refuses symlinks: a link could
 * make the digest depend on state outside the tree it names.
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

// Both npm serializations of the github.com git dependency (the ssh form is
// npm's normal lockfile form; pacote clones it over https, no SSH key needed).
// Canonical repo: Aspis0/kalsa.rn (the engine fork was renamed on GitHub from
// Aspis0/llama.rn; the npm package name stays llama.rn and the sha is
// unchanged). The legacy name is accepted on purpose: GitHub redirects it to
// the same repository, so an old lockfile keeps building green.
const LLAMA_RN_GIT_URL =
  /^git\+(?:ssh|https):\/\/(?:git@)?github\.com\/Aspis0\/(?:kalsa\.rn|llama\.rn)(?:\.git)?$/;

/** The fork commit: the sha after the last '#' of the lockfile resolved URL. */
function llamaRnCommit(root) {
  const lock = readJsonOrThrow(path.join(root, "package-lock.json"));
  const entry = lock.packages && lock.packages["node_modules/llama.rn"];
  const resolved = entry && typeof entry.resolved === "string" ? entry.resolved : "";
  const hash = resolved.lastIndexOf("#");
  const url = hash === -1 ? resolved : resolved.slice(0, hash);
  const commit = resolved.slice(hash + 1);
  const fail = (why) =>
    new Error(
      `engine-build-id: package-lock.json packages["node_modules/llama.rn"].resolved ${why} (got ${JSON.stringify(resolved)})`,
    );
  if (!LLAMA_RN_GIT_URL.test(url)) {
    // Names the canonical repo; the regex above also accepts the pre-rename
    // Aspis0/llama.rn name, which GitHub redirects to it.
    throw fail("must be a github.com git URL for Aspis0/kalsa.rn");
  }
  if (!/^[0-9a-f]{40}$/.test(commit)) {
    throw fail("must end in '#<40-char sha>'");
  }
  return commit;
}

/** The kalsallama commit stamped into the installed tree: without it the
 * tree is upstream llama.rn, not our fork, and must not be identified. */
function kalsallamaSha(root) {
  // Was cpp/KALSALLAMA_SHA, a stamp that made sense while cpp/ WAS kalsallama
  // flattened. After the vendor migration the pin is declarative and lives in
  // vendor/VERSIONS, which sync-vendor.sh rewrites; the fail-closed contract
  // is unchanged -- no pin, no identity.
  const file = path.join(root, "node_modules", "llama.rn", "vendor", "VERSIONS");
  let raw;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch (error) {
    throw new Error(
      `engine-build-id: cannot read node_modules/llama.rn/vendor/VERSIONS: ${error.message} (a tree without it is not the migrated kalsa fork)`,
    );
  }
  const match = /^LLAMA_CPP_COMMIT=([0-9a-f]{40})$/m.exec(raw);
  if (!match) {
    throw new Error(
      "engine-build-id: vendor/VERSIONS must carry LLAMA_CPP_COMMIT=<40-char sha>",
    );
  }
  return match[1];
}

/** Read the committed build inputs; throws so the build fails closed. */
function collectEngineBuildInputs(root = path.resolve(__dirname, "..")) {
  const llamaRnPkg = readJsonOrThrow(path.join(root, "node_modules", "llama.rn", "package.json"));
  const llamaRnVersion =
    typeof llamaRnPkg.version === "string" ? llamaRnPkg.version.trim() : "";
  if (!llamaRnVersion) {
    throw new Error("engine-build-id: node_modules/llama.rn version is missing");
  }
  const packageDir = path.join(root, "node_modules", "llama.rn");
  const commit = llamaRnCommit(root);
  const kalsallama = kalsallamaSha(root);
  // Walked from packageDir so exclusions see package-relative paths.
  const negated = packNegatedPrefixes(llamaRnPkg);
  const engineTree = digestTree(
    packageDir,
    (rel) => isEngineTreeExcluded(rel) || negated.some((d) => rel === d || rel.startsWith(`${d}/`)),
  );
  // Only after the tree is proven to be the fork does completeness matter.
  requireEveryEngineTreeDir(engineTree);
  return {
    llamaRnCommit: commit,
    kalsallamaSha: kalsallama,
    engineTree,
    native: digestTree(path.join(root, "native")),
    sourceBuildPlugin: sha256Hex(readFileOrThrow(path.join(root, "plugins", "withLlamaFromSource.js"))),
    llamaRnVersion,
  };
}

function requireHex(value, field, length) {
  if (typeof value !== "string" || !new RegExp(`^[0-9a-f]{${length}}$`).test(value)) {
    throw new Error(`engine-build-id: input ${field} must be a ${length}-hex digest (got ${JSON.stringify(value)})`);
  }
  return value;
}

function requireNonEmptyString(value, field) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`engine-build-id: input ${field} must be a non-empty string (got ${JSON.stringify(value)})`);
  }
  return value;
}

// Digest lines are '<path>:<sha256 hex>': newline-free, unforgeable.
const DIGEST_LINE = /^[^\n:]+:[0-9a-f]{64}$/;

/** Validate digest lines; return a sorted copy — the id hashes a SET. */
function requireDigestLines(value, field) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`engine-build-id: input ${field} must be a non-empty array of digest lines (got ${JSON.stringify(value)})`);
  }
  for (const entry of value) {
    if (typeof entry !== "string" || !DIGEST_LINE.test(entry)) {
      throw new Error(`engine-build-id: input ${field} entries must be '<path>:<64-hex sha256>' (got ${JSON.stringify(entry)})`);
    }
  }
  return [...value].sort();
}

/** Validate inputs and hash them into a stable engine build id. */
function engineBuildIdFromInputs(inputs) {
  if (!inputs || typeof inputs !== "object") {
    throw new Error("engine-build-id: inputs required");
  }
  const canonical = [
    `llama-rn:${requireHex(inputs.llamaRnCommit, "llamaRnCommit", 40)}`,
    `kalsallama:${requireHex(inputs.kalsallamaSha, "kalsallamaSha", 40)}`,
    `llama-rn-version:${requireNonEmptyString(inputs.llamaRnVersion, "llamaRnVersion")}`,
    `source-plugin:${requireHex(inputs.sourceBuildPlugin, "sourceBuildPlugin", 64)}`,
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
