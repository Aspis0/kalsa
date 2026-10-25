// The browser driver archive, assembled from pinned upstream sources and
// published by digest. Kalsa never fetches a driver at runtime: this script
// is the one place a driver exists, and the app's pin is the digest of what
// this writes.
//
// Two upstream sources, each verified before a byte is read out of it:
//   - `playwright-core@1.64.0` from npm, checked against the `integrity`
//     (sha512) pinned below, which is the digest npm itself publishes;
//   - `node v24.21.0` from nodejs.org, checked against the sha256 **pinned
//     below**. That release's own `SHASUMS256.txt` is fetched as a cross-check
//     and the build fails if the two disagree, but it is not what the pin rests
//     on: a listing downloaded at build time is something that can be replaced
//     with the file it replaces, and a digest in this file is something a
//     reviewer can read in a diff.
//
// The versions are the ones `playwright-rs 0.20.1` expects, and are not a
// choice this script makes: `driver_urls.rs:11` pins the Node, `build.rs:34`
// pins the Playwright, and a driver built from any other pair is a driver the
// crate will not launch. Bumping either is a release event.
//
// The archive is a `.tar.gz` on every platform, including Windows: one
// extractor in the app, and unlike a zip it keeps the executable bit that
// `node` cannot start without.
//
// Run: node scripts/build-driver-archive.mjs [--out DIR] [--only PLATFORM]
//   out defaults to /tmp/kalsa-driver-build, outside the repo on purpose:
//   these are megabytes of upstream code that are never a source file.

import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { readTgz, tarGz } from "./lib/tar.mjs";
import { readZip } from "./lib/zip.mjs";

// playwright-rs 0.20.1 — src/build_support/driver_urls.rs:11, build.rs:34.
const PLAYWRIGHT_VERSION = "1.64.0";
const NODE_VERSION = "24.21.0";

// The npm `integrity` of playwright-core@1.64.0, from registry.npmjs.org.
const PLAYWRIGHT_CORE_INTEGRITY =
  "sha512-T9r+MZkTECl2+oUcZ26YgZzTrYidTsIhYYkJix+6iDOymOb1FB2RLLSOxRGnZGv5DStt+aduIVbt+E8WygXYpg==";

/**
 * The Playwright platform ids the crate maps `("macos", "aarch64")` and the
 * rest to, each with the sha256 of that Node archive. These digests are the
 * pin; `SHASUMS256.txt` only has to agree with them.
 */
const PLATFORMS = {
  "mac-arm64": {
    nodeTriple: "darwin-arm64",
    extension: "tar.gz",
    exe: "node",
    nodeSha256: "bed7eea5325e1108f32ce5228ddd6a5f0f08a499ee42aa7442aea583702f6057",
  },
  mac: {
    nodeTriple: "darwin-x64",
    extension: "tar.gz",
    exe: "node",
    nodeSha256: "1462cb3b3046b815cf8ea436d3da450ec1a9f11dac7e5a46b0ada5305d7e8097",
  },
  win32_x64: {
    nodeTriple: "win-x64",
    extension: "zip",
    exe: "node.exe",
    nodeSha256: "158f7685b44de51f6c0df1d153526cbcd3e1bc739a8dfc607721cef75de9e541",
  },
};

const npmTarball = () =>
  `https://registry.npmjs.org/playwright-core/-/playwright-core-${PLAYWRIGHT_VERSION}.tgz`;
const nodeArchive = (triple, extension) =>
  `https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-${triple}.${extension}`;
const archiveName = (platform) =>
  `playwright-${PLAYWRIGHT_VERSION}-${platform}-node${NODE_VERSION}.tar.gz`;

/**
 * That Node's own listing agrees with the digest pinned above. A disagreement is
 * not a warning: either the pin is stale or the listing has been replaced, and
 * both mean this archive is not one a reviewer approved.
 */
async function agreesWithNodeListing(triple, extension, pinned) {
  const listing = await fetchText(`https://nodejs.org/dist/v${NODE_VERSION}/SHASUMS256.txt`);
  const name = `node-v${NODE_VERSION}-${triple}.${extension}`;
  const line = listing.split("\n").find((row) => row.trimEnd().endsWith(`  ${name}`));
  if (!line) throw new Error(`SHASUMS256.txt for node ${NODE_VERSION} has no line for ${name}`);
  const published = line.trim().split(/\s+/)[0];
  if (published !== pinned) {
    throw new Error(`${name} is ${published} in SHASUMS256.txt and ${pinned} in this script: the pin is stale`);
  }
}

/**
 * The digest of the unpacked driver, over the same recipe the app recomputes at
 * launch (`src-tauri/src/browser/tree.rs`): every file sorted by its name, then
 * `path\0mode\0sha256\n` into one hasher. The mode is in it because a lost
 * executable bit is a driver that will not start, and the archive's own digest
 * cannot see that.
 */
/**
 * The digest of an installed driver, which `src-tauri/src/browser/tree.rs`
 * recomputes at launch and compares against the pin.
 *
 * **Path and bytes only — the mode is not in it.** It was, and that made a pin
 * unmatchable on Windows: the tar header says `node.exe` is 0755, a tree
 * unpacked on Windows has no executable bit to compare against, and a pin
 * produced on one platform could never be met on the other. A mode is not
 * content. What is given up is checked at launch instead: the launcher refuses
 * to run a `node` it cannot execute.
 *
 * The two implementations must agree byte for byte, so the shape of each record
 * is `path\0sha256hex\n` and the files are sorted by that path.
 */
export function treeDigest(files) {
  const ordered = [...files].sort((a, b) => (a.name < b.name ? -1 : 1));
  const hasher = createHash("sha256");
  for (const file of ordered) {
    hasher.update(file.name);
    hasher.update("\0");
    hasher.update(createHash("sha256").update(file.body).digest("hex"));
    hasher.update("\n");
  }
  return hasher.digest("hex");
}

/** The `playwright-core` tarball, refused unless it hashes to the pinned integrity. */
async function playwrightCore() {
  const bytes = await fetchBytes(npmTarball());
  const actual = `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
  if (actual !== PLAYWRIGHT_CORE_INTEGRITY) {
    throw new Error(`playwright-core ${PLAYWRIGHT_VERSION} hashes to ${actual}, not the pinned integrity`);
  }
  return readTgz(bytes);
}

/** Node's runtime and licence, refused unless the archive hashes to SHASUMS256.txt. */
async function node(triple, extension, exe, pinned) {
  const url = nodeArchive(triple, extension);
  const bytes = await fetchBytes(url);
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== pinned) {
    throw new Error(`${basename(url)} hashes to ${actual}, not the ${pinned} pinned here`);
  }
  await agreesWithNodeListing(triple, extension, pinned);
  const entries = extension === "zip" ? readZip(bytes) : readTgz(bytes).files;
  const prefix = `node-v${NODE_VERSION}-${triple}/`;
  // Node puts the runtime in `bin/` on unix and at the root on Windows.
  const inner = extension === "zip" ? exe : `bin/${exe}`;
  const runtime = entries.find((entry) => entry.name === prefix + inner);
  if (!runtime) throw new Error(`${basename(url)} has no ${prefix + inner}`);
  const licence = entries.find((entry) => entry.name === `${prefix}LICENSE`);
  // Both land at the driver root, which is where the crate's runtime looks
  // for them (`driver_urls.rs`: `<driver>/node[.exe]` beside `package/cli.js`).
  return [runtime, licence].filter(Boolean).map((entry) => ({
    name: entry.name === runtime.name ? exe : "LICENSE",
    body: entry.body,
    mode: 0o755,
  }));
}

async function fetchBytes(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`fetching ${url} failed with ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

async function fetchText(url) {
  return (await fetchBytes(url)).toString("utf8");
}

/** One archive: the whole `playwright-core` package and the Node runtime beside it. */
async function build(platform) {
  const { nodeTriple, extension, exe, nodeSha256 } = PLATFORMS[platform];
  const core = await playwrightCore();
  const runtime = await node(nodeTriple, extension, exe, nodeSha256);
  const files = [...core.files, ...runtime];
  // The crate's own layout check (driver_urls.rs:node_exe_name), run here so a
  // driver that would not launch is never published with a digest beside it.
  for (const required of [exe, "package/cli.js"]) {
    if (!files.some((file) => file.name === required)) throw new Error(`the driver has no ${required}`);
  }
  const archive = tarGz(files);
  return {
    file: archiveName(platform),
    size: archive.length,
    sha256: createHash("sha256").update(archive).digest("hex"),
    tree: treeDigest(files),
    bytes: archive,
  };
}

const outDir = flagValue("out") ?? "/tmp/kalsa-driver-build";
const only = flagValue("only");

function flagValue(name) {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? null : process.argv[at + 1];
}

await mkdir(outDir, { recursive: true });
const platforms = only ? [only] : Object.keys(PLATFORMS);
const manifest = { driver: `${PLAYWRIGHT_VERSION}`, node: NODE_VERSION, platforms: {} };
for (const platform of platforms) {
  if (!PLATFORMS[platform]) throw new Error(`${platform} is not a platform this script builds`);
  const archive = await build(platform);
  await writeFile(join(outDir, archive.file), archive.bytes);
  const { bytes, ...entry } = archive;
  manifest.platforms[platform] = entry;
  console.log(`${platform.padEnd(10)} ${String(entry.size).padStart(9)} bytes  ${entry.sha256}  ${entry.file}`);
  console.log(`${" ".repeat(10)} tree ${entry.tree}`);
}
await writeFile(join(outDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`\narchives in ${outDir}, manifest.json beside them`);