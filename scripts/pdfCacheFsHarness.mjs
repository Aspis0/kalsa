/**
 * Harness for src/pdf/pdfCacheFs.ts — partial-write cleanup + no-cache-dir i18n.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const outDir = path.join(projectRoot, "scripts/.build/pdfCacheFsHarness");

function compile() {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const r = spawnSync(
    "npx",
    [
      "tsc",
      "src/pdf/pdfCacheFs.ts",
      "src/util/base64.ts",
      "src/agent/webFetchTool.ts",
      "src/util/url.ts",
      "src/util/htmlToText.ts",
      "src/context/retriever.ts",
      "src/context/retrievalLoop.ts",
      "src/i18n/en.ts",
      "src/i18n/it.ts",
      "src/i18n/types.ts",
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
      // --types node matches the 17 other harnesses; required because the compiled graph reaches src/telemetry/telemetry.ts (node-style loaders).
      "--types",
      "node",
    ],
    { cwd: projectRoot, encoding: "utf8", shell: true },
  );
  if (r.status !== 0) {
    console.error("tsc failed:\n", r.stdout, r.stderr);
    process.exit(1);
  }
}

function resolveBuilt(base) {
  const candidates = [
    path.join(outDir, `pdf/${base}`),
    path.join(outDir, `src/pdf/${base}`),
    path.join(outDir, `i18n/${base}`),
    path.join(outDir, `src/i18n/${base}`),
    path.join(outDir, base),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  console.error(`Could not find compiled ${base}`);
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

async function main() {
  console.log("Compiling pdfCacheFs …");
  compile();
  const mod = await import(pathToFileURL(resolveBuilt("pdfCacheFs.js")).href);
  const en = await import(pathToFileURL(resolveBuilt("en.js")).href);
  const it = await import(pathToFileURL(resolveBuilt("it.js")).href);
  const { makePdfCacheFs } = mod;

  const enMsg = en.en?.errors?.webFetchPdfNoCacheDir;
  const itMsg = it.it?.errors?.webFetchPdfNoCacheDir;
  check(
    "no-cache-dir catalog en",
    typeof enMsg === "string" && enMsg.length > 0 && /cache/i.test(enMsg),
    enMsg,
  );
  check(
    "no-cache-dir catalog it",
    typeof itMsg === "string" && itMsg.length > 0 && /cache/i.test(itMsg),
    itMsg,
  );
  check("no-cache-dir en ≠ it", enMsg !== itMsg);

  // Missing directory → catalog string
  {
    let threw = null;
    const fs = makePdfCacheFs({
      getDirectory: () => "",
      writeAsBase64: async () => {},
      deleteAsync: async () => {},
      noCacheDirMessage: enMsg,
    });
    try {
      await fs.write(new Uint8Array([1, 2, 3]));
    } catch (e) {
      threw = e;
    }
    check(
      "missing cache dir throws catalog string",
      threw instanceof Error && threw.message === enMsg,
      threw?.message,
    );
  }

  // Throwing writeAsBase64 → delete attempt on the partial URI
  {
    const deleted = [];
    const fs = makePdfCacheFs({
      getDirectory: () => "file:///cache/",
      writeAsBase64: async () => {
        throw new Error("ENOSPC disk full");
      },
      deleteAsync: async (uri) => {
        deleted.push(uri);
      },
      noCacheDirMessage: enMsg,
      now: () => 42,
      randomId: () => "abc",
    });
    let threw = false;
    try {
      await fs.write(new Uint8Array([0x25, 0x50, 0x44, 0x46]));
    } catch {
      threw = true;
    }
    check("write throw rethrows", threw);
    check(
      "write throw deletes partial file",
      deleted.length === 1 &&
        deleted[0].includes("web-fetch-pdf-42-abc.pdf"),
      deleted.join(","),
    );
  }

  // Happy path
  {
    const written = [];
    const fs = makePdfCacheFs({
      getDirectory: () => "file:///cache/",
      writeAsBase64: async (uri, b64) => {
        written.push({ uri, b64 });
      },
      deleteAsync: async () => {},
      noCacheDirMessage: enMsg,
      now: () => 1,
      randomId: () => "ok",
    });
    const uri = await fs.write(new Uint8Array([0x00, 0xff]));
    check(
      "write success returns uri",
      uri.includes("web-fetch-pdf-1-ok.pdf") && written.length === 1,
      uri,
    );
  }

  console.log(`\n${pass} PASS, ${fail} FAIL`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
