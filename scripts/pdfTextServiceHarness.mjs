/**
 * Harness for src/pdf/pdfTextService.ts — single-flight, no-host, timeout.
 * Pure protocol only (no React / PdfToImages).
 */
import { spawnSync } from "node:child_process";
import { existsSync, unlinkSync } from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

function deleteStaleBuild() {
  for (const f of [
    path.join(projectRoot, "scripts/.build/pdf/pdfTextService.js"),
    path.join(projectRoot, "scripts/.build/src/pdf/pdfTextService.js"),
  ]) {
    try {
      if (existsSync(f)) unlinkSync(f);
    } catch {
      /* ignore */
    }
  }
}

function compile() {
  deleteStaleBuild();
  const r = spawnSync(
    "npx",
    [
      "tsc",
      "src/pdf/pdfTextService.ts",
      "src/util/pdfText.ts",
      "--outDir",
      "scripts/.build",
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

function resolveBuilt(base) {
  const candidates = [
    path.join(projectRoot, `scripts/.build/pdf/${base}`),
    path.join(projectRoot, `scripts/.build/src/pdf/${base}`),
    path.join(projectRoot, `scripts/.build/${base}`),
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
  console.log("Compiling pdfTextService …");
  compile();
  const mod = await import(pathToFileURL(resolveBuilt("pdfTextService.js")).href);
  const {
    requestPdfText,
    registerPdfTextHost,
    resolvePdfTextRequest,
    rejectPdfTextRequest,
    __resetPdfTextServiceForTests,
    PdfTextServiceError,
    PDF_TEXT_SERVICE_TIMEOUT_MS,
    isPdfTextHostMounted,
    isPdfTextExtractionBusy,
  } = mod;

  check("timeout constant", PDF_TEXT_SERVICE_TIMEOUT_MS === 160_000);

  // ── No host → immediate reject ─────────────────────────────────────────
  {
    __resetPdfTextServiceForTests();
    check("no host initially", !isPdfTextHostMounted());
    let err = null;
    try {
      await requestPdfText("file:///tmp/a.pdf");
    } catch (e) {
      err = e;
    }
    check(
      "no host rejects immediately",
      err instanceof PdfTextServiceError && err.code === "no_host",
      err?.message,
    );
  }

  // ── Happy path via host bridge ─────────────────────────────────────────
  {
    __resetPdfTextServiceForTests();
    let seenFileUri = null;
    const unreg = registerPdfTextHost({
      setRequest(req) {
        if (req) {
          seenFileUri = req.fileUri;
          queueMicrotask(() => {
            resolvePdfTextRequest(req.id, {
              docs: [{ docId: "s#p1", text: "hello" }],
              skippedPages: [],
            });
          });
        }
      },
    });
    check("host mounted", isPdfTextHostMounted());
    const result = await requestPdfText("file:///tmp/a.pdf", { sourceId: "src" });
    check(
      "happy path resolves docs",
      result.docs.length === 1 && result.docs[0].text === "hello",
    );
    check("request had fileUri", seenFileUri === "file:///tmp/a.pdf");
    unreg();
    check("host unregistered", !isPdfTextHostMounted());
  }

  // ── Single-flight reject (not queue) ───────────────────────────────────
  {
    __resetPdfTextServiceForTests();
    let resolveFirst = null;
    registerPdfTextHost({
      setRequest(req) {
        if (!req) return;
        // Hold first request open until we say so.
        resolveFirst = () =>
          resolvePdfTextRequest(req.id, {
            docs: [{ docId: "a#p1", text: "first" }],
            skippedPages: [],
          });
      },
    });
    const p1 = requestPdfText("file:///tmp/1.pdf");
    check("busy while first in flight", isPdfTextExtractionBusy());
    let busyErr = null;
    try {
      await requestPdfText("file:///tmp/2.pdf");
    } catch (e) {
      busyErr = e;
    }
    check(
      "concurrent reject busy",
      busyErr instanceof PdfTextServiceError && busyErr.code === "busy",
      busyErr?.message,
    );
    resolveFirst();
    const r1 = await p1;
    check("first still succeeds", r1.docs[0].text === "first");
    check("not busy after settle", !isPdfTextExtractionBusy());
  }

  // ── Hard timeout + late resolve is no-op ───────────────────────────────
  {
    __resetPdfTextServiceForTests();
    let heldId = null;
    registerPdfTextHost({
      setRequest(req) {
        if (req) heldId = req.id;
      },
    });
    let timedOut = null;
    try {
      await requestPdfText("file:///tmp/slow.pdf", { timeoutMs: 30 });
    } catch (e) {
      timedOut = e;
    }
    check(
      "service timeout rejects",
      timedOut instanceof PdfTextServiceError && timedOut.code === "timeout",
      timedOut?.message,
    );
    // Late resolve must not throw or resurrect the promise.
    let lateThrew = false;
    try {
      resolvePdfTextRequest(heldId, {
        docs: [{ docId: "late#p1", text: "too late" }],
        skippedPages: [],
      });
    } catch {
      lateThrew = true;
    }
    check("late resolve is no-op", !lateThrew && !isPdfTextExtractionBusy());
  }

  // ── Host unmount mid-flight ────────────────────────────────────────────
  {
    __resetPdfTextServiceForTests();
    const unreg = registerPdfTextHost({
      setRequest() {
        /* hold open */
      },
    });
    const p = requestPdfText("file:///tmp/u.pdf");
    unreg();
    let err = null;
    try {
      await p;
    } catch (e) {
      err = e;
    }
    check(
      "unmount rejects inflight",
      err instanceof PdfTextServiceError && err.code === "unmounted",
      err?.message,
    );
  }

  // ── rejectPdfTextRequest path ──────────────────────────────────────────
  {
    __resetPdfTextServiceForTests();
    registerPdfTextHost({
      setRequest(req) {
        if (req) {
          queueMicrotask(() =>
            rejectPdfTextRequest(req.id, new Error("webview crashed")),
          );
        }
      },
    });
    let err = null;
    try {
      await requestPdfText("file:///tmp/bad.pdf");
    } catch (e) {
      err = e;
    }
    check(
      "host onError rejects",
      err instanceof PdfTextServiceError &&
        err.code === "failed" &&
        /webview crashed/i.test(err.message),
      err?.message,
    );
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
