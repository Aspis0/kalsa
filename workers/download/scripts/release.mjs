#!/usr/bin/env node
/**
 * Publishes one platform's installer and its updater artifact, reads both back
 * from R2, and only then rewrites current.json.
 *
 *   node scripts/release.mjs <windows|mac> <installer file> <version> \
 *     --update <artifact file> --sig <file.sig> [--notes <file>] [--dry-run] [--new-manifest] [--allow-mixed]
 *
 * --dry-run runs the local checks and prints the wrangler commands without running them.
 * --new-manifest lets an unreadable current.json start empty; use it for the first release only.
 * --allow-mixed publishes this platform alone; the other platform keeps its installer
 * and loses its update until it is released at the same version.
 * --notes is the plain-text release notes shown in the update notice. Without it, a later
 * platform of the same version keeps the notes already published.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { mergeRelease } from "./merge-manifest.mjs";

const BUCKET = "kalsa-installers";
const MANIFEST_KEY = "current.json";
const PLATFORMS = new Set(["windows", "mac"]);
const VALUE_OPTIONS = new Set(["--update", "--sig", "--notes"]);
const FLAGS = new Set(["--dry-run", "--new-manifest", "--allow-mixed"]);
// The Worker's SemVer rule, copied from semver.ts; a test keeps the two equal.
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const NAME = /^[A-Za-z0-9][A-Za-z0-9._ -]{0,127}$/;
const SIGNATURE = /^[A-Za-z0-9+/=]{1,4096}$/;
const TRUSTED_COMMENT = "trusted comment: ";
const VERSION_FIELD = "version:";
// Mirrors KEY in manifest.ts; a test keeps the two equal.
const KEY = /^releases\/[A-Za-z0-9][A-Za-z0-9._-]{0,31}\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
// Mirrors NOTES_MAX and NOTES_FORBIDDEN in manifest.ts; a test keeps them equal.
const NOTES_MAX = 600;
const NOTES_FORBIDDEN = /[\u0000-\u0009\u000B-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2028\u2029\u2066-\u2069\uFEFF]/;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BUILD_GUIDE = path.join(HERE, "build-guide.mjs");
const DEFAULT_MARKDOWN = path.resolve(HERE, "../../../../kalsa-brain/docs/ALPHA-TESTERS.md");
const USAGE =
  "usage: release.mjs <windows|mac> <installer file> <version> --update <artifact> --sig <file.sig> [--notes <file>] [--dry-run] [--new-manifest] [--allow-mixed]";

let work = null;

function die(message, code = 1) {
  console.error(message);
  if (work !== null) rmSync(work, { recursive: true, force: true });
  process.exit(code);
}

function usage(message) {
  console.error(`${message}\n${USAGE}`);
  process.exit(2);
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

/** The version the signature's trusted comment names, read as the updater reads it: the first tab-separated `version:` field. */
function signedVersion(signature) {
  const text = Buffer.from(signature, "base64").toString("utf8");
  const comment = text.split(/\r?\n/).find((line) => line.startsWith(TRUSTED_COMMENT));
  const field = comment?.slice(TRUSTED_COMMENT.length).split("\t").find((part) => part.startsWith(VERSION_FIELD));
  return field === undefined ? null : field.slice(VERSION_FIELD.length);
}

/** The notes file, trimmed. CRLF is a line break, not a control character, so it becomes LF first. */
function readNotes(file) {
  if (!statSync(file, { throwIfNoEntry: false })?.isFile()) die(`not a file: ${file}`);
  const text = readFileSync(file, "utf8").replace(/\r\n/g, "\n").trim();
  if (text === "") die(`${file} is empty`);
  if (NOTES_FORBIDDEN.test(text)) {
    die(`${file} has a control, zero-width, bidi or line-separator character; notes are plain text with line breaks only`);
  }
  const length = [...text].length;
  if (length > NOTES_MAX) die(`${file} is ${length} characters; the limit is ${NOTES_MAX}`);
  return text;
}

function parseArgs(argv) {
  const flags = new Set();
  const options = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (FLAGS.has(arg)) flags.add(arg);
    else if (VALUE_OPTIONS.has(arg) && argv[i + 1] !== undefined) options[arg.slice(2)] = argv[++i];
    else if (arg.startsWith("--")) usage(`bad argument ${arg}`);
    else positional.push(arg);
  }
  return { flags, options, positional };
}

const { flags, options, positional } = parseArgs(process.argv.slice(2));
const [platform, file, version] = positional;
const dryRun = flags.has("--dry-run");
const newManifest = flags.has("--new-manifest");
if (!PLATFORMS.has(platform) || !file || !version || positional.length !== 3) usage("missing or extra arguments");
if (!options.update || !options.sig) usage("--update and --sig are required");
if (!VERSION.test(version)) die(`version must be X.Y.Z, got ${version}`);
for (const candidate of [file, options.update, options.sig]) {
  if (!statSync(candidate, { throwIfNoEntry: false })?.isFile()) die(`not a file: ${candidate}`);
}
const name = path.basename(file);
const updateName = path.basename(options.update);
for (const fileName of [name, updateName]) {
  if (!NAME.test(fileName)) die(`file name must be letters, digits, dot, underscore or hyphen: ${fileName}`);
}
const key = `releases/${version}/${name}`;
const updateKey = `releases/${version}/${updateName}`;
for (const candidate of [key, updateKey]) {
  if (!KEY.test(candidate)) die(`not allowed in a key: ${candidate}`);
}
const signature = readFileSync(options.sig, "utf8").trim();
if (!SIGNATURE.test(signature)) die(`${options.sig} must hold one base64 line of at most 4096 characters`);
const signed = signedVersion(signature);
if (signed === null) die(`${options.sig} has no version in its trusted comment; the updater cannot check it`);
if (signed !== version) die(`${options.sig} is signed for version ${signed}, but this release is ${version}`);
const notes = options.notes === undefined ? null : readNotes(options.notes);

const markdown = process.env.ALPHA_TESTERS_MD ?? DEFAULT_MARKDOWN;
if (!existsSync(markdown)) die(`tester guide markdown not found at ${markdown}; set ALPHA_TESTERS_MD`);
const guideModule = process.env.GUIDE_TS;
const guideArgs = guideModule ? ["--out", guideModule] : [];
const guide = spawnSync(process.execPath, [BUILD_GUIDE, markdown, "--check", ...guideArgs], { encoding: "utf8" });
if (guide.status !== 0) die(`guide.ts is stale or the markdown does not convert; run build-guide.mjs\n${guide.stderr}`);

const local = await digestOf(file);
const artifact = await digestOf(options.update);
const sameFile = updateKey === key;
if (sameFile && artifact.sha256 !== local.sha256) {
  die(`the update artifact has the installer's name but different bytes; rename one of them`);
}
const release = {
  version,
  notes,
  installer: { key, name, size: local.size, sha256: local.sha256 },
  update: { key: updateKey, name: updateName, size: artifact.size, sha256: artifact.sha256, signature },
};
console.log(`installer ${name}: ${local.size} bytes, sha256 ${local.sha256}`);
console.log(`update ${updateName}: ${artifact.size} bytes, sha256 ${artifact.sha256}`);

work = mkdtempSync(path.join(os.tmpdir(), "kalsa-release-"));
const currentPath = path.join(work, "current.json");
const nextPath = path.join(work, "next-current.json");

function wrangler(wranglerArgs, { read = false } = {}) {
  if (dryRun && !read) {
    console.log(["npx", "wrangler", ...wranglerArgs].map(quote).join(" "));
    return 0;
  }
  return spawnSync("npx", ["wrangler", ...wranglerArgs], { stdio: "inherit" }).status;
}

const uploads = sameFile ? [[key, file, local]] : [[key, file, local], [updateKey, options.update, artifact]];
console.log(`1. publish ${uploads.map(([uploaded]) => uploaded).join(" and ")}`);
for (const [uploaded, source] of uploads) {
  if (wrangler(["r2", "object", "put", `${BUCKET}/${uploaded}`, "--file", source, "--remote"]) !== 0) {
    die(`upload of ${uploaded} failed; current.json is unchanged`);
  }
}

console.log("2. read each object back and re-hash it");
for (const [uploaded, , expected] of uploads) {
  const readBack = path.join(work, `published-${path.basename(uploaded)}`);
  if (wrangler(["r2", "object", "get", `${BUCKET}/${uploaded}`, "--remote", "--file", readBack]) !== 0) {
    die(`read-back of ${uploaded} failed; current.json is unchanged`);
  }
  if (!dryRun) {
    const published = await digestOf(readBack);
    if (published.sha256 !== expected.sha256 || published.size !== expected.size) {
      die(`published ${uploaded} differs from the local file; current.json is unchanged`);
    }
  }
}

console.log(`3. read ${MANIFEST_KEY}`);
let current = null;
if (wrangler(["r2", "object", "get", `${BUCKET}/${MANIFEST_KEY}`, "--remote", "--file", currentPath], { read: true }) === 0) {
  try {
    current = JSON.parse(readFileSync(currentPath, "utf8"));
  } catch {
    die(`${MANIFEST_KEY} is not valid JSON; fix it in the bucket before releasing`);
  }
} else if (!newManifest) {
  die(`could not read ${MANIFEST_KEY}; for the first release rerun with --new-manifest`);
}

console.log(`4. merge ${platform} ${version} into ${MANIFEST_KEY}`);
if (current === null && dryRun) {
  console.log(`   ${MANIFEST_KEY} could not be read here, so the version check did not run`);
} else {
  let next;
  try {
    next = mergeRelease(current ?? {}, platform, release, { allowMixed: flags.has("--allow-mixed") });
  } catch (err) {
    die(err.message);
  }
  if (dryRun) console.log(`   would write ${MANIFEST_KEY}: ${JSON.stringify(next)}`);
  else writeFileSync(nextPath, `${JSON.stringify(next, null, 2)}\n`);
}

console.log(`5. upload ${MANIFEST_KEY}`);
const manifestPut = ["r2", "object", "put", `${BUCKET}/${MANIFEST_KEY}`, "--file", nextPath, "--remote", "--content-type", "application/json"];
if (wrangler(manifestPut) !== 0) {
  die(`manifest upload failed; the files are published but ${MANIFEST_KEY} may be stale`);
}

rmSync(work, { recursive: true, force: true });
console.log(dryRun ? "dry run: no upload was made" : `released ${platform} ${version}; check the private link (README)`);
