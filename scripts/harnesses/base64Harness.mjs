/**
 * Harness for src/util/base64.ts (Hermes-safe uint8ArrayToBase64).
 * Correctness only — no timing assertions.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "../..");
const outDir = path.join(projectRoot, "scripts/.build/base64Harness");

function compile() {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const r = spawnSync(
    "npx",
    [
      "tsc",
      "src/util/base64.ts",
      "--outDir",
      outDir,
      "--module",
      "nodenext",
      "--target",
      "es2020",
      "--moduleResolution",
      "nodenext",
      "--skipLibCheck",
      "--ignoreConfig",
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
    path.join(outDir, "util/base64.js"),
    path.join(outDir, "src/util/base64.js"),
    path.join(outDir, "base64.js"),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  console.error("Could not find compiled base64.js");
  process.exit(1);
}

let pass = 0;
let fail = 0;
function check(name, cond, detail = "") {
  if (cond) {
    console.log(`PASS ${name}`);
    pass++;
  } else {
    console.log(`FAIL ${name}${detail ? ` — ${detail}` : ""}`);
    fail++;
  }
}

/** Known vector: bytes → standard base64 (Node Buffer as oracle). */
function oracle(bytes) {
  return Buffer.from(bytes).toString("base64");
}

async function main() {
  console.log("Compiling base64 …");
  compile();
  const mod = await import(pathToFileURL(resolveBuilt()).href);
  const { uint8ArrayToBase64 } = mod;

  check("exports uint8ArrayToBase64", typeof uint8ArrayToBase64 === "function");

  // Empty
  check("empty → empty base64", uint8ArrayToBase64(new Uint8Array(0)) === "");

  // Round-trip against known vectors
  const vectors = [
    new Uint8Array([0x00]),
    new Uint8Array([0xff]),
    new Uint8Array([0x00, 0xff, 0x00, 0xff]),
    new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f]), // Hello
    new Uint8Array([0x25, 0x50, 0x44, 0x46]), // %PDF
  ];
  for (let i = 0; i < vectors.length; i++) {
    const b = vectors[i];
    const got = uint8ArrayToBase64(b);
    const exp = oracle(b);
    check(`vector[${i}] round-trip`, got === exp, `got=${got} exp=${exp}`);
  }

  // Length not a multiple of the 0x8000 chunk size (and > one chunk to exercise join).
  {
    const len = 0x8000 + 17;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = i & 0xff;
    bytes[0] = 0x00;
    bytes[len - 1] = 0xff;
    const got = uint8ArrayToBase64(bytes);
    check(
      "non-multiple of chunk size",
      got === oracle(bytes) && got.length > 0,
      `len=${len}`,
    );
    check("contains 0x00 and 0xFF bytes", got === oracle(bytes));
  }

  // Multi-chunk determinism
  {
    const bytes = new Uint8Array(0x8000 * 2 + 3);
    bytes.fill(0x41);
    bytes[0] = 0x00;
    bytes[bytes.length - 1] = 0xff;
    const a = uint8ArrayToBase64(bytes);
    const b = uint8ArrayToBase64(bytes);
    check("deterministic multi-chunk", a === b && a === oracle(bytes));
  }

  console.log(`\n${pass} PASS, ${fail} FAIL`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
