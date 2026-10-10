#!/usr/bin/env node
/**
 * Publishes one installer, reads it back from R2, and only then rewrites that
 * platform's entry in current.json.
 *
 *   node scripts/release.mjs <windows|mac> <installer file> <version> [--dry-run] [--new-manifest]
 *
 * --dry-run runs the local checks and prints the wrangler commands without running them.
 * --new-manifest lets an unreadable current.json start empty; use it for the first release only.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BUCKET = "kalsa-downloads";
const MANIFEST_KEY = "current.json";
const PLATFORMS = new Set(["windows", "mac"]);
const VERSION = /^\d+\.\d+\.\d+$/;
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
// Mirrors KEY in manifest.ts; a test keeps the two equal.
const KEY = /^releases\/[A-Za-z0-9][A-Za-z0-9._-]{0,31}\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BUILD_GUIDE = path.join(HERE, "build-guide.mjs");
const DEFAULT_MARKDOWN = path.resolve(HERE, "../../../../kalsa-brain/docs/ALPHA-TESTERS.md");

let work = null;

function die(message, code = 1) {
  console.error(message);
  if (work !== null) rmSync(work, { recursive: true, force: true });
  process.exit(code);
}

function quote(arg) {
  return /^[A-Za-z0-9_./:=@%+-]+$/.test(arg) ? arg : `'${arg.replace(/'/g, "'\\''")}'`;
}

function digestOf(file) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    let size = 0;
    const stream = createReadStream(file);
    stream.on("data", (chunk) => {
      hash.update(chunk);
      size += chunk.length;
    });
    stream.on("error", reject);
    stream.on("end", () => resolve({ size, sha256: hash.digest("hex") }));
  });
}

const args = process.argv.slice(2);
const flags = new Set(args.filter((arg) => arg.startsWith("--")));
const [platform, file, version] = args.filter((arg) => !arg.startsWith("--"));
const dryRun = flags.has("--dry-run");
const newManifest = flags.has("--new-manifest");

if (!PLATFORMS.has(platform) || !file || !version) {
  die("usage: release.mjs <windows|mac> <installer file> <version> [--dry-run] [--new-manifest]", 2);
}
if (!VERSION.test(version)) die(`version must be X.Y.Z, got ${version}`);
if (!statSync(file, { throwIfNoEntry: false })?.isFile()) die(`not a file: ${file}`);
const name = path.basename(file);
if (!NAME.test(name)) die(`file name must be letters, digits, dot, underscore or hyphen: ${name}`);
const key = `releases/${version}/${name}`;
if (!KEY.test(key)) die(`key would be outside releases/: ${key}`);

const markdown = process.env.ALPHA_TESTERS_MD ?? DEFAULT_MARKDOWN;
if (!existsSync(markdown)) die(`tester guide markdown not found at ${markdown}; set ALPHA_TESTERS_MD`);
const guide = spawnSync(process.execPath, [BUILD_GUIDE, markdown, "--check"], { encoding: "utf8" });
if (guide.status !== 0) {
  die(`guide.ts is stale or the markdown does not convert; run build-guide.mjs\n${guide.stderr}`);
}

const local = await digestOf(file);
const entry = { key, name, size: local.size, sha256: local.sha256 };
console.log(`local ${name}: ${local.size} bytes, sha256 ${local.sha256}`);

work = mkdtempSync(path.join(os.tmpdir(), "kalsa-release-"));
const verifyPath = path.join(work, "published-installer");
const currentPath = path.join(work, "current.json");
const nextPath = path.join(work, "next-current.json");

function wrangler(wranglerArgs) {
  if (dryRun) {
    console.log(["npx", "wrangler", ...wranglerArgs].map(quote).join(" "));
    return 0;
  }
  return spawnSync("npx", ["wrangler", ...wranglerArgs], { stdio: "inherit" }).status;
}

console.log(`1. publish releases/${version}/${name}`);
if (wrangler(["r2", "object", "put", `${BUCKET}/${key}`, "--file", file, "--remote"]) !== 0) {
  die("upload failed; current.json is unchanged");
}

console.log("2. read the installer back and re-hash it");
if (wrangler(["r2", "object", "get", `${BUCKET}/${key}`, "--remote", "--file", verifyPath]) !== 0) {
  die("read-back failed; current.json is unchanged");
}
if (!dryRun) {
  const published = await digestOf(verifyPath);
  if (published.sha256 !== local.sha256 || published.size !== local.size) {
    die(
      `published bytes differ from the local file (${published.size} bytes, sha256 ${published.sha256}); current.json is unchanged`,
    );
  }
}

console.log(`3. read ${MANIFEST_KEY}`);
let current = {};
if (wrangler(["r2", "object", "get", `${BUCKET}/${MANIFEST_KEY}`, "--remote", "--file", currentPath]) !== 0) {
  if (!newManifest) {
    die(`could not read ${MANIFEST_KEY}; for the first release rerun with --new-manifest`);
  }
} else if (!dryRun) {
  try {
    current = JSON.parse(readFileSync(currentPath, "utf8"));
  } catch {
    die(`${MANIFEST_KEY} is not valid JSON; fix it in the bucket before releasing`);
  }
}

console.log(`4. set ${platform} in ${MANIFEST_KEY}, keep the other platform's entry`);
if (dryRun) {
  console.log(`   ${platform} = ${JSON.stringify(entry)}`);
} else {
  const next = {
    windows: platform === "windows" ? entry : current.windows,
    mac: platform === "mac" ? entry : current.mac,
  };
  writeFileSync(nextPath, `${JSON.stringify(next, null, 2)}\n`);
}

console.log(`5. upload ${MANIFEST_KEY}`);
if (
  wrangler(["r2", "object", "put", `${BUCKET}/${MANIFEST_KEY}`, "--file", nextPath, "--remote", "--content-type", "application/json"]) !== 0
) {
  die(`manifest upload failed; the installer is published but ${MANIFEST_KEY} may be stale`);
}

rmSync(work, { recursive: true, force: true });
console.log(dryRun ? "dry run: nothing was run" : `released ${platform} ${version}; check the private link (README)`);
