/**
 * Harness for src/agent/webFetchTool.ts
 * Allowlist, fail-closed host gate, redirect policy, body decode, index cap.
 *
 * Build isolation: each harness uses scripts/.build/<harnessName> so running
 * harnesses in any order cannot leave a stale rootDir-inferred layout that
 * poisons a later compile (tsc rootDir depends on the entry-file set).
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const outDir = path.join(projectRoot, "scripts/.build/webFetchHarness");

function compile() {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const r = spawnSync(
    "npx",
    [
      "tsc",
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
    path.join(outDir, `agent/${base}`),
    path.join(outDir, `src/agent/${base}`),
    path.join(outDir, `util/${base}`),
    path.join(outDir, `src/util/${base}`),
    path.join(outDir, `context/${base}`),
    path.join(outDir, `src/context/${base}`),
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

function mockResponse({
  body = "",
  status = 200,
  contentType = "text/html; charset=utf-8",
  contentLength = null,
  url = "https://example.com/page",
  onText,
  arrayBufferBytes = null,
} = {}) {
  const headers = {
    get(name) {
      const key = String(name).toLowerCase();
      if (key === "content-type") return contentType;
      if (key === "content-length") return contentLength;
      return null;
    },
  };
  const res = {
    status,
    url,
    headers,
    async text() {
      onText?.();
      return body;
    },
  };
  if (arrayBufferBytes != null) {
    res.arrayBuffer = async () => {
      onText?.(); // count as body read
      return arrayBufferBytes.buffer.slice(
        arrayBufferBytes.byteOffset,
        arrayBufferBytes.byteOffset + arrayBufferBytes.byteLength,
      );
    };
  }
  return res;
}

const FIXTURE_HTML = `<!DOCTYPE html>
<html>
<head><title>Climate Report 2024</title></head>
<body>
  <h1>Global Climate Report 2024</h1>
  <p>Average global temperature rose by 1.5 degrees Celsius above pre-industrial levels according to the latest climate assessment.</p>
  <p>Sea levels have increased approximately 3.7 millimeters per year over the past decade due to thermal expansion and ice melt.</p>
  <p>Renewable energy capacity expanded rapidly, with solar and wind generating a record share of electricity in many regions.</p>
  <p>Unrelated cooking recipe: mix flour sugar eggs and bake at 180 for 25 minutes until golden brown cake forms.</p>
</body>
</html>`;

async function main() {
  console.log("Compiling webFetchTool + pure deps …");
  compile();
  const mod = await import(pathToFileURL(resolveBuilt("webFetchTool.js")).href);
  const {
    makeFetchAllowlist,
    makeWebFetchExecutor,
    normalizeFetchUrl,
    isPubliclyRoutableHttpUrl,
    sameHost,
    WEB_FETCH_TOOL,
    BODY_HARD_CAP,
    MAX_INDEX_CHARS,
    FETCH_TIMEOUT_MS,
    RETRIEVAL_BUDGET_CHARS,
  } = mod;

  check("tool def name", WEB_FETCH_TOOL?.function?.name === "web_fetch");
  check("exports BODY_HARD_CAP", typeof BODY_HARD_CAP === "number" && BODY_HARD_CAP === 1_500_000);
  check("exports MAX_INDEX_CHARS", typeof MAX_INDEX_CHARS === "number" && MAX_INDEX_CHARS === 120_000);
  check("exports FETCH_TIMEOUT_MS 8s", FETCH_TIMEOUT_MS === 8_000);
  check("exports RETRIEVAL_BUDGET", RETRIEVAL_BUDGET_CHARS === 1800);
  {
    const desc = WEB_FETCH_TOOL?.function?.description ?? "";
    const urlDesc = WEB_FETCH_TOOL?.function?.parameters?.properties?.url?.description ?? "";
    // Pinned budget so the 4B prompt does not grow silently (audit item 10).
    const DESC_BUDGET = 420;
    check(
      "tool description mentions PDF and page labels",
      /PDF/i.test(desc) && /page/i.test(desc) && /PDF/i.test(urlDesc),
      desc.slice(0, 120),
    );
    check(
      "tool description keeps ~120k claim",
      /120k|120\s*k/i.test(desc),
      desc,
    );
    check(
      "tool description under character budget",
      desc.length <= DESC_BUDGET,
      `len=${desc.length} budget=${DESC_BUDGET}`,
    );
  }

  // ── Fail-closed host gate: REFUSED families ────────────────────────────
  const refused = [
    "http://127.1/x",
    "http://127.0.1/x",
    "http://10.1/x",
    "http://192.168.1/x",
    "http://169.254.1/x",
    "http://0177.0.0.1/x",
    "http://0x7f.0.0.1/x",
    "http://2130706433/x",
    "http://127.0.0.1\\evil.com/x",
    "http://[::1]/x",
    "http://[::0:1]/x",
    "http://[0:0:0:0:0:ffff:7f00:1]/x",
    "http://[ff02::1]/x",
    "http://evil.com:65536/x",
    "http://evil.com%3a80/x",
    "http://例え.jp/x",
    "http://example.com./x",
    "http://localhost/x",
    "http://127.0.0.1/x",
    "http://10.0.0.5/x",
    "http://192.168.1.1/x",
    "http://user:pass@example.com/x",
    "http://intranet/secret",
  ];
  let refusedOk = true;
  for (const u of refused) {
    if (isPubliclyRoutableHttpUrl(u)) {
      console.log(`  still allowed: ${u}`);
      refusedOk = false;
    }
  }
  check("host gate REFUSED attack family", refusedOk, `n=${refused.length}`);

  // ── ALLOWED ordinary hosts ─────────────────────────────────────────────
  const allowed = [
    "https://example.com",
    "https://example.com/path",
    "https://sub.example.co.uk:8443/a",
    "http://93.184.216.34/",
    "https://93.184.216.34:443/docs",
  ];
  let allowedOk = true;
  for (const u of allowed) {
    if (!isPubliclyRoutableHttpUrl(u)) {
      console.log(`  still refused: ${u}`);
      allowedOk = false;
    }
  }
  check("host gate ALLOWED ordinary hosts", allowedOk);

  check("sameHost true", sameHost("https://Ex.COM/a", "https://ex.com/b"));
  check("sameHost false", !sameHost("https://a.com/x", "https://b.com/x"));

  // ── Allowlist refusal ──────────────────────────────────────────────────
  {
    let called = 0;
    const allow = makeFetchAllowlist();
    allow.add("https://allowed.example/a");
    const exec = makeWebFetchExecutor("en", allow, {
      fetchImpl: async () => {
        called += 1;
        return mockResponse();
      },
    });
    const out = await exec("web_fetch", {
      url: "https://evil.example/x",
      query: "anything",
    });
    check(
      "1 allowlist refusal no network",
      called === 0 && /refused|not in this turn|surfaced/i.test(out.text),
    );
  }

  // ── Normalization ──────────────────────────────────────────────────────
  {
    const allow = makeFetchAllowlist();
    allow.add("https://Example.COM/Path/page");
    check("2a fragment matches", allow.has("https://example.com/Path/page#section"));
    check("2b trailing slash matches", allow.has("https://example.com/Path/page/"));
    check("2c different path no", !allow.has("https://example.com/Path/other"));
    check(
      "2d normalize trailing slash",
      normalizeFetchUrl("https://ex.com/page/") === "https://ex.com/page",
    );
    check(
      "2e root slash kept",
      normalizeFetchUrl("https://ex.com/") === "https://ex.com/",
    );
  }

  // ── Happy path ─────────────────────────────────────────────────────────
  {
    const pageUrl = "https://climate.example/report-2024";
    const allow = makeFetchAllowlist();
    allow.add(pageUrl);
    const exec = makeWebFetchExecutor("en", allow, {
      fetchImpl: async (u) =>
        mockResponse({ body: FIXTURE_HTML, url: String(u) }),
    });
    const out = await exec("web_fetch", {
      url: pageUrl,
      query: "global temperature sea levels climate",
    });
    check("3a numbered passages", /^1\.\s/m.test(out.text) && out.text.length <= 2200);
    check("3b relevant", /temperature|climate/i.test(out.text));
    check(
      "3c sources",
      out.sources?.[0]?.url === pageUrl && out.sources[0].provider === "fetch",
    );
    check("3d no raw html", !out.text.includes("<html"));
  }

  // ── Redirect policies ──────────────────────────────────────────────────
  {
    const allow = makeFetchAllowlist();
    allow.add("https://public.example/start");
    let textReads = 0;
    const exec = makeWebFetchExecutor("en", allow, {
      fetchImpl: async () =>
        mockResponse({
          body: "SECRET",
          url: "http://192.168.0.5/admin",
          onText: () => {
            textReads += 1;
          },
        }),
    });
    const out = await exec("web_fetch", {
      url: "https://public.example/start",
      query: "admin",
    });
    check(
      "F1a private redirect no body",
      textReads === 0 && /redirect|refused/i.test(out.text) && !out.text.includes("SECRET"),
    );
  }
  {
    const allow = makeFetchAllowlist();
    allow.add("https://a.example/page");
    let textReads = 0;
    const exec = makeWebFetchExecutor("en", allow, {
      fetchImpl: async () =>
        mockResponse({
          body: FIXTURE_HTML,
          url: "https://other.example/evil",
          onText: () => {
            textReads += 1;
          },
        }),
    });
    const out = await exec("web_fetch", {
      url: "https://a.example/page",
      query: "climate",
    });
    check("F1b other host refused", textReads === 0 && /redirect|refused/i.test(out.text));
  }
  {
    const allow = makeFetchAllowlist();
    allow.add("https://same.example/start");
    const exec = makeWebFetchExecutor("en", allow, {
      fetchImpl: async () =>
        mockResponse({
          body: FIXTURE_HTML,
          url: "https://same.example/final-report",
        }),
    });
    const out = await exec("web_fetch", {
      url: "https://same.example/start",
      query: "temperature climate sea",
    });
    check(
      "F1c same host allowed",
      /temperature|climate/i.test(out.text) &&
        out.sources?.[0]?.url === "https://same.example/final-report",
    );
  }
  {
    const allow = makeFetchAllowlist();
    allow.add("https://secure.example/a");
    let textReads = 0;
    const exec = makeWebFetchExecutor("en", allow, {
      fetchImpl: async () =>
        mockResponse({
          body: FIXTURE_HTML,
          url: "http://secure.example/a",
          onText: () => {
            textReads += 1;
          },
        }),
    });
    const out = await exec("web_fetch", {
      url: "https://secure.example/a",
      query: "climate",
    });
    check("F1d https→http refused", textReads === 0 && /redirect|refused/i.test(out.text));
  }

  // ── Empty response.url fail-safe ───────────────────────────────────────
  {
    const allow = makeFetchAllowlist();
    allow.add("https://emptyurl.example/p");
    const exec = makeWebFetchExecutor("en", allow, {
      fetchImpl: async () =>
        mockResponse({
          body: FIXTURE_HTML,
          url: "",
        }),
    });
    // mock with empty url — executor falls back to requested
    const out = await exec("web_fetch", {
      url: "https://emptyurl.example/p",
      query: "temperature climate",
    });
    check(
      "empty response.url fail-safe",
      /temperature|climate|1\./i.test(out.text) &&
        out.sources?.[0]?.url === "https://emptyurl.example/p",
      out.text?.slice(0, 80),
    );
  }

  // ── External signal (manual combine path when AbortSignal.any missing) ─
  {
    const allow = makeFetchAllowlist();
    allow.add("https://signal.example/p");
    const ac = new AbortController();
    // Force manual combine by temporarily hiding AbortSignal.any
    const origAny = AbortSignal.any;
    try {
      // @ts-ignore
      delete AbortSignal.any;
      AbortSignal.any = undefined;
    } catch {
      AbortSignal.any = undefined;
    }
    let sawSignal = false;
    const exec = makeWebFetchExecutor("en", allow, {
      fetchImpl: async (_u, init) => {
        sawSignal = Boolean(init?.signal);
        return mockResponse({
          body: FIXTURE_HTML,
          url: "https://signal.example/p",
        });
      },
    });
    const out = await exec(
      "web_fetch",
      { url: "https://signal.example/p", query: "temperature climate" },
      ac.signal,
    );
    AbortSignal.any = origAny;
    check(
      "external signal combined path",
      sawSignal && /temperature|climate/i.test(out.text),
      `sawSignal=${sawSignal}`,
    );
  }

  // ── Content-Length over cap ────────────────────────────────────────────
  {
    const allow = makeFetchAllowlist();
    allow.add("https://big.example/huge");
    let textReads = 0;
    const exec = makeWebFetchExecutor("en", allow, {
      fetchImpl: async () =>
        mockResponse({
          body: "SHOULD_NOT_READ",
          url: "https://big.example/huge",
          contentLength: String(BODY_HARD_CAP + 1),
          onText: () => {
            textReads += 1;
          },
        }),
    });
    const out = await exec("web_fetch", {
      url: "https://big.example/huge",
      query: "x",
    });
    check(
      "CL over cap no body",
      textReads === 0 && /too large|KB/i.test(out.text),
    );
  }

  // ── Content-Length absent large body still proceeds (then post-cap) ────
  {
    const allow = makeFetchAllowlist();
    allow.add("https://nocl.example/p");
    const exec = makeWebFetchExecutor("en", allow, {
      fetchImpl: async () =>
        mockResponse({
          body: FIXTURE_HTML,
          url: "https://nocl.example/p",
          contentLength: null,
        }),
    });
    const out = await exec("web_fetch", {
      url: "https://nocl.example/p",
      query: "temperature climate",
    });
    check("CL absent proceeds", /temperature|climate/i.test(out.text));
  }

  // ── arrayBuffer + windows-1252 decoding ────────────────────────────────
  {
    // "café" in windows-1252: c a f e9
    const bytes = new Uint8Array([0x63, 0x61, 0x66, 0xe9, 0x20, 0x71, 0x75, 0x61, 0x6e, 0x74, 0x75, 0x6d, 0x20, 0x63, 0x6f, 0x6d, 0x70, 0x75, 0x74, 0x69, 0x6e, 0x67, 0x20, 0x71, 0x75, 0x62, 0x69, 0x74, 0x73, 0x20, 0x6c, 0x61, 0x62]);
    const allow = makeFetchAllowlist();
    allow.add("https://enc.example/p");
    const exec = makeWebFetchExecutor("en", allow, {
      fetchImpl: async () =>
        mockResponse({
          body: "", // unused when arrayBuffer present
          url: "https://enc.example/p",
          contentType: "text/plain; charset=windows-1252",
          arrayBufferBytes: bytes,
        }),
    });
    const out = await exec("web_fetch", {
      url: "https://enc.example/p",
      query: "quantum computing qubits café",
    });
    check(
      "arrayBuffer windows-1252 decode",
      /quantum|qubit/i.test(out.text) && (out.text.includes("café") || out.text.includes("caf")),
      out.text?.slice(0, 120),
    );
  }

  // ── byteLength gate: CL small, body huge ───────────────────────────────
  {
    const allow = makeFetchAllowlist();
    allow.add("https://gzip.example/p");
    const huge = new Uint8Array(BODY_HARD_CAP + 100);
    huge.fill(0x61);
    let reads = 0;
    const exec = makeWebFetchExecutor("en", allow, {
      fetchImpl: async () =>
        mockResponse({
          body: "",
          url: "https://gzip.example/p",
          contentType: "text/plain",
          contentLength: "100", // declared small (gzip-style lie)
          arrayBufferBytes: huge,
          onText: () => {
            reads += 1;
          },
        }),
    });
    const out = await exec("web_fetch", {
      url: "https://gzip.example/p",
      query: "aaa",
    });
    check(
      "byteLength gate refuses oversized buffer",
      /too large|KB/i.test(out.text),
      out.text?.slice(0, 100),
    );

    // Same constant, both paths: arrayBuffer hard-error vs text() fail-closed
    // (no silent truncate). Outcomes must match on over-cap input.
    const overText = "z".repeat(BODY_HARD_CAP + 50);
    const allowT = makeFetchAllowlist();
    allowT.add("https://textpath.example/p");
    allowT.add("https://bufpath.example/p");
    const textPathOut = await makeWebFetchExecutor("en", allowT, {
      fetchImpl: async () =>
        mockResponse({
          body: overText,
          contentType: "text/plain",
          url: "https://textpath.example/p",
          // no arrayBuffer → text() fallback
        }),
    })("web_fetch", { url: "https://textpath.example/p", query: "zzzz" });
    const bufPathOut = await makeWebFetchExecutor("en", allowT, {
      fetchImpl: async () =>
        mockResponse({
          body: "",
          contentType: "text/plain",
          url: "https://bufpath.example/p",
          arrayBufferBytes: new Uint8Array(BODY_HARD_CAP + 50).fill(0x7a),
        }),
    })("web_fetch", { url: "https://bufpath.example/p", query: "zzzz" });
    check(
      "body hard cap same outcome both paths",
      /too large/i.test(textPathOut.text) &&
        /too large/i.test(bufPathOut.text) &&
        !textPathOut.text.includes(overText.slice(0, 80)),
      `text=${textPathOut.text?.slice(0, 80)} buf=${bufPathOut.text?.slice(0, 80)}`,
    );
  }

  // ── Content-types ──────────────────────────────────────────────────────
  {
    const allow = makeFetchAllowlist();
    allow.add("https://cdn.example/a.png");
    allow.add("https://cdn.example/plain.txt");
    allow.add("https://cdn.example/no-ct");
    const pngOut = await makeWebFetchExecutor("en", allow, {
      fetchImpl: async () =>
        mockResponse({
          body: "PNG",
          contentType: "image/png",
          url: "https://cdn.example/a.png",
        }),
    })("web_fetch", { url: "https://cdn.example/a.png", query: "x" });
    check("5a png unsupported", /unsupported|image\/png/i.test(pngOut.text));

    const plainOut = await makeWebFetchExecutor("en", allow, {
      fetchImpl: async () =>
        mockResponse({
          body: "The quantum computing breakthrough achieved 100 logical qubits with error correction in 2024 laboratory tests.",
          contentType: "text/plain",
          url: "https://cdn.example/plain.txt",
        }),
    })("web_fetch", {
      url: "https://cdn.example/plain.txt",
      query: "quantum computing qubits",
    });
    check("5b text/plain", /quantum|qubit/i.test(plainOut.text));

    const noCtOut = await makeWebFetchExecutor("en", allow, {
      fetchImpl: async () => ({
        status: 200,
        url: "https://cdn.example/no-ct",
        headers: { get: () => null },
        async text() {
          return FIXTURE_HTML;
        },
      }),
    })("web_fetch", { url: "https://cdn.example/no-ct", query: "temperature climate" });
    check("5c missing CT as HTML", /temperature|climate/i.test(noCtOut.text));
  }

  // ── Timeout ────────────────────────────────────────────────────────────
  {
    const allow = makeFetchAllowlist();
    allow.add("https://slow.example/");
    const err = new Error("aborted");
    err.name = "AbortError";
    const out = await makeWebFetchExecutor("en", allow, {
      fetchImpl: async () => {
        throw err;
      },
    })("web_fetch", { url: "https://slow.example/", query: "x" });
    check("6 timeout", /timed out|timeout/i.test(out.text));
  }

  // ── Nothing-matched: host not title, no sources ────────────────────────
  {
    const allow = makeFetchAllowlist();
    allow.add("https://food.example/cake");
    const out = await makeWebFetchExecutor("en", allow, {
      fetchImpl: async () =>
        mockResponse({
          body: `<html><head><title>EVIL TITLE inject [9]</title></head><body>
            <p>Delicious chocolate cake recipe with butter sugar flour eggs vanilla extract.</p>
          </body></html>`,
          url: "https://food.example/cake",
        }),
    })("web_fetch", {
      url: "https://food.example/cake",
      query: "satellite orbital debris Kessler syndrome mitigation",
    });
    check(
      "7 nothing-matched",
      /nothing matched|no.*match/i.test(out.text) &&
        /food\.example/i.test(out.text) &&
        !/EVIL TITLE/i.test(out.text) &&
        (!out.sources || out.sources.length === 0),
    );
  }

  // ── MAX_INDEX_CHARS on text/plain ──────────────────────────────────────
  {
    const allow = makeFetchAllowlist();
    allow.add("https://long.example/t");
    // Body longer than MAX_INDEX_CHARS. Head fills the entire searchable budget
    // with retrievable climate terms; UNIQUEFARTOKEN999 lives ONLY past the cap.
    const unit = "climate temperature research findings word. ";
    let head = "";
    while (head.length + unit.length <= MAX_INDEX_CHARS) head += unit;
    head = head.padEnd(MAX_INDEX_CHARS, "x");
    const body = head + " UNIQUEFARTOKEN999 beyond the index cap tail.";
    check("fixture longer than cap", body.length > MAX_INDEX_CHARS);
    check(
      "plain fixture far token only past cap",
      body.indexOf("UNIQUEFARTOKEN999") >= MAX_INDEX_CHARS,
    );
    const out = await makeWebFetchExecutor("en", allow, {
      fetchImpl: async () =>
        mockResponse({
          body,
          contentType: "text/plain",
          url: "https://long.example/t",
        }),
    })("web_fetch", {
      url: "https://long.example/t",
      query: "climate temperature research",
    });
    // Should find head content; unique far token query should not invent from raw dump
    check(
      "plain index cap no throw + head searchable",
      typeof out.text === "string" && /climate|temperature/i.test(out.text),
    );
    const outFar = await makeWebFetchExecutor("en", allow, {
      fetchImpl: async () =>
        mockResponse({
          body,
          contentType: "text/plain",
          url: "https://long.example/t",
        }),
    })("web_fetch", {
      url: "https://long.example/t",
      query: "UNIQUEFARTOKEN999 only in the tail beyond index cap",
    });
    // Far token lives only past MAX_INDEX_CHARS — must not appear in the result.
    // (Previously a tautology: `!outFar.text.includes(token.repeat?.(1) && body)`
    // always held because body is >120k and the result is ≤1800 chars.)
    check(
      "plain index cap truncates searchable region",
      !outFar.text.includes("UNIQUEFARTOKEN999"),
      outFar.text?.slice(0, 160),
    );
  }

  // ── Defensive ──────────────────────────────────────────────────────────
  {
    const allow = makeFetchAllowlist();
    allow.add("https://big.example/h");
    let threw = false;
    try {
      await makeWebFetchExecutor("en", allow, {
        fetchImpl: async () =>
          mockResponse({
            body: `<html><body><p>${"word ".repeat(50_000)}climate temperature</p></body></html>`,
            url: "https://big.example/h",
          }),
      })("web_fetch", { url: "https://big.example/h", query: "climate temperature" });
    } catch {
      threw = true;
    }
    check("8a large HTML no throw", !threw);

    const exec2 = makeWebFetchExecutor("en", allow, {
      fetchImpl: async () => {
        throw new Error("no");
      },
    });
    const missing = await exec2("web_fetch", {});
    check("8b missing args", typeof missing.text === "string" && missing.text.length > 0);
    const nullArgs = await exec2("web_fetch", null);
    check("8c null args", typeof nullArgs.text === "string");
  }

  // ── Determinism ────────────────────────────────────────────────────────
  {
    const allow = makeFetchAllowlist();
    allow.add("https://det.example/p");
    const exec = makeWebFetchExecutor("en", allow, {
      fetchImpl: async () =>
        mockResponse({ body: FIXTURE_HTML, url: "https://det.example/p" }),
    });
    const a = await exec("web_fetch", {
      url: "https://det.example/p",
      query: "temperature climate sea",
    });
    const b = await exec("web_fetch", {
      url: "https://det.example/p",
      query: "temperature climate sea",
    });
    check("9 determinism", a.text === b.text && JSON.stringify(a.sources) === JSON.stringify(b.sources));
  }

  // ── Locale: seed allowlist and compare error paths that differ ─────────
  // Passage body text is locale-independent (page content). Error messages differ.
  {
    const allow = makeFetchAllowlist();
    // empty allowlist → blocked message differs by locale
    const enBlock = await makeWebFetchExecutor("en", allow, {
      fetchImpl: async () => mockResponse(),
    })("web_fetch", { url: "https://x.example/", query: "q" });
    const itBlock = await makeWebFetchExecutor("it", allow, {
      fetchImpl: async () => mockResponse(),
    })("web_fetch", { url: "https://x.example/", query: "q" });
    check(
      "10a locale error messages differ",
      enBlock.text !== itBlock.text && enBlock.text.length > 0 && itBlock.text.length > 0,
    );

    // Happy path: passage body is locale-independent (same English page content)
    allow.add("https://loc.example/p");
    const enOk = await makeWebFetchExecutor("en", allow, {
      fetchImpl: async () =>
        mockResponse({ body: FIXTURE_HTML, url: "https://loc.example/p" }),
    })("web_fetch", {
      url: "https://loc.example/p",
      query: "temperature climate sea",
    });
    const itOk = await makeWebFetchExecutor("it", allow, {
      fetchImpl: async () =>
        mockResponse({ body: FIXTURE_HTML, url: "https://loc.example/p" }),
    })("web_fetch", {
      url: "https://loc.example/p",
      query: "temperature climate sea",
    });
    // Body passages are from the page — locale-independent.
    check(
      "10b passage body locale-independent",
      enOk.text === itOk.text,
      // if this fails, cite is not in executor (good) — only body compared
    );
  }

  // ── Title clamped in sources ───────────────────────────────────────────
  {
    const longTitle = "T".repeat(200);
    const allow = makeFetchAllowlist();
    allow.add("https://title.example/p");
    const out = await makeWebFetchExecutor("en", allow, {
      fetchImpl: async () =>
        mockResponse({
          body: `<html><head><title>${longTitle}</title></head><body>
            <p>Average global temperature rose climate assessment sea levels research findings detailed.</p>
          </body></html>`,
          url: "https://title.example/p",
        }),
    })("web_fetch", {
      url: "https://title.example/p",
      query: "temperature climate sea levels",
    });
    check(
      "title clamped ≤120",
      Boolean(out.sources?.[0]) && out.sources[0].title.length <= 120,
      out.sources?.[0]
        ? `len=${out.sources[0].title.length}`
        : `no sources: ${out.text?.slice(0, 80)}`,
    );
  }

  // ═══════════════════════════════════════════════════════════════════════
  // PDF path (phase C1) — extractor injection, caps, cache cleanup, gates
  // ═══════════════════════════════════════════════════════════════════════
  const {
    PDF_BODY_HARD_CAP,
    PDF_FETCH_TIMEOUT_MS,
    FETCH_TIMEOUT_MS: FETCH_TO,
    remapPdfDocsToSourceUrl,
    pageFromDocId,
    urlPathLooksLikePdf,
    resolveFetchNetworkTimeoutMs,
  } = mod;

  check(
    "exports PDF_BODY_HARD_CAP 5MB",
    typeof PDF_BODY_HARD_CAP === "number" && PDF_BODY_HARD_CAP === 5 * 1024 * 1024,
  );
  check(
    "exports PDF_FETCH_TIMEOUT_MS 20s",
    PDF_FETCH_TIMEOUT_MS === 20_000,
  );

  // Network timeout from URL path only (not from extractor-wired). RN cannot
  // peek Content-Type before the body is buffered, so .pdf path → 20s else 8s.
  {
    check(
      "timeout: path ends .pdf → PDF window",
      urlPathLooksLikePdf("https://host/doc.pdf") === true &&
        resolveFetchNetworkTimeoutMs("https://host/doc.pdf") === PDF_FETCH_TIMEOUT_MS,
    );
    check(
      "timeout: HTML path → 8s even with extractor concept",
      urlPathLooksLikePdf("https://host/page") === false &&
        resolveFetchNetworkTimeoutMs("https://host/page") === FETCH_TO &&
        FETCH_TO === 8_000,
    );
    check(
      "timeout: .PDF + query + fragment recognised",
      urlPathLooksLikePdf("https://host/doc.PDF?x=1#y") === true &&
        resolveFetchNetworkTimeoutMs("https://host/doc.PDF?x=1#y") === PDF_FETCH_TIMEOUT_MS,
    );
    check(
      "timeout: query .pdf only is NOT long window",
      urlPathLooksLikePdf("https://host/page?file=a.pdf") === false &&
        resolveFetchNetworkTimeoutMs("https://host/page?file=a.pdf") === FETCH_TO,
    );
    check(
      "timeout: %2Epdf path recognised",
      urlPathLooksLikePdf("https://host/doc%2Epdf") === true &&
        resolveFetchNetworkTimeoutMs("https://host/doc%2Epdf") === PDF_FETCH_TIMEOUT_MS,
    );
    check(
      "timeout: path param after .pdf recognised",
      urlPathLooksLikePdf("https://host/a.pdf;x=1") === true,
    );
    check(
      "timeout: matrix param mid-path still PDF",
      urlPathLooksLikePdf("https://host/dir;param/file.pdf") === true &&
        resolveFetchNetworkTimeoutMs("https://host/dir;param/file.pdf") ===
          PDF_FETCH_TIMEOUT_MS,
    );
    // Integration: extractor wired + HTML URL still uses short timeout for the
    // resolve helper (executor calls the same pure function). PDF URL uses long.
    const { fs } = (() => {
      const files = new Map();
      return {
        fs: {
          async write(bytes) {
            const uri = `file:///cache/t-${bytes.byteLength}.pdf`;
            files.set(uri, bytes);
            return uri;
          },
          async remove() {},
        },
      };
    })();
    const extractPdfText = async () => ({
      docs: [
        {
          docId: "x#p1",
          text: "Global climate temperature rose assessment sea levels research findings.",
        },
      ],
      skippedPages: [],
    });
    check(
      "timeout helper PDF URL with extractor deps concept",
      resolveFetchNetworkTimeoutMs("https://reports.example/climate.pdf") ===
        PDF_FETCH_TIMEOUT_MS,
    );
    // Smoke: HTML fetch still works with extractor wired (regression guard).
    {
      const htmlUrl = "https://news.example/page";
      const allow = makeFetchAllowlist();
      allow.add(htmlUrl);
      const out = await makeWebFetchExecutor("en", allow, {
        fetchImpl: async () =>
          mockResponse({
            body: FIXTURE_HTML,
            url: htmlUrl,
          }),
        extractPdfText,
        pdfCacheFs: fs,
      })("web_fetch", {
        url: htmlUrl,
        query: "temperature climate sea",
      });
      check(
        "timeout: HTML fetch with extractor wired still succeeds",
        /temperature|climate/i.test(out.text) &&
          resolveFetchNetworkTimeoutMs(htmlUrl) === FETCH_TO,
        out.text?.slice(0, 100),
      );
    }
    // Smoke: application/pdf at *.pdf path routes with extractor (long timeout path).
    {
      const pdfUrl = "https://cdn.example/doc.pdf";
      const allow = makeFetchAllowlist();
      allow.add(pdfUrl);
      const out = await makeWebFetchExecutor("en", allow, {
        fetchImpl: async () =>
          mockResponse({
            contentType: "application/pdf",
            url: pdfUrl,
            arrayBufferBytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
          }),
        extractPdfText,
        pdfCacheFs: fs,
      })("web_fetch", {
        url: pdfUrl,
        query: "climate temperature sea levels",
      });
      check(
        "timeout: application/pdf at /doc.pdf routes to extractor",
        /climate|temperature/i.test(out.text) &&
          resolveFetchNetworkTimeoutMs(pdfUrl) === PDF_FETCH_TIMEOUT_MS,
        out.text?.slice(0, 100),
      );
    }
  }
  check(
    "remapPdfDocsToSourceUrl builds #pN",
    (() => {
      const r = remapPdfDocsToSourceUrl(
        [{ docId: "local#p3", text: "hello world climate", title: "t" }],
        "https://docs.example/a.pdf",
      );
      return r[0]?.docId === "https://docs.example/a.pdf#p3" && pageFromDocId(r[0].docId) === 3;
    })(),
  );
  check(
    "remapPdfDocsToSourceUrl missing page does not invent #p1",
    (() => {
      const r = remapPdfDocsToSourceUrl(
        [{ docId: "local-no-page", text: "hello world climate", title: "t" }],
        "https://docs.example/a.pdf",
      );
      return (
        r.length === 1 &&
        r[0].docId === "https://docs.example/a.pdf" &&
        !r[0].docId.includes("#p") &&
        pageFromDocId(r[0].docId) == null
      );
    })(),
  );
  check(
    "remapPdfDocsToSourceUrl rejects page > maxPage",
    (() => {
      const r = remapPdfDocsToSourceUrl(
        [
          { docId: "x#p2", text: "page two climate", title: "t" },
          { docId: "x#p7", text: "page seven should drop", title: "t" },
        ],
        "https://docs.example/a.pdf",
        { maxPage: 5 },
      );
      return (
        r.length === 1 &&
        r[0].docId === "https://docs.example/a.pdf#p2" &&
        !r.some((d) => d.docId.includes("#p7"))
      );
    })(),
  );

  function makeFakeFs() {
    const files = new Map();
    const log = { writes: [], removes: [] };
    return {
      log,
      files,
      fs: {
        async write(bytes) {
          const uri = `file:///cache/pdf-${log.writes.length}-${bytes.byteLength}.pdf`;
          files.set(uri, bytes);
          log.writes.push(uri);
          return uri;
        },
        async remove(uri) {
          log.removes.push(uri);
          files.delete(uri);
        },
      },
    };
  }

  // PDF without extractor → unsupported (no extractPdfText in deps)
  {
    const allow = makeFetchAllowlist();
    allow.add("https://cdn.example/doc.pdf");
    const out = await makeWebFetchExecutor("en", allow, {
      fetchImpl: async () =>
        mockResponse({
          body: "%PDF-1.4 fake",
          contentType: "application/pdf",
          url: "https://cdn.example/doc.pdf",
          arrayBufferBytes: new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]),
        }),
      // no extractPdfText
    })("web_fetch", { url: "https://cdn.example/doc.pdf", query: "climate" });
    check(
      "pdf no-extractor → unsupported",
      /unsupported|application\/pdf/i.test(out.text),
      out.text?.slice(0, 120),
    );
  }

  // PDF with extractor → routed; never htmlToText (no HTML artifact; #pN docIds)
  {
    const pdfUrl = "https://reports.example/climate.pdf";
    const allow = makeFetchAllowlist();
    allow.add(pdfUrl);
    const { fs, log } = makeFakeFs();
    let extractCalls = 0;
    let extractUri = null;
    const exec = makeWebFetchExecutor("en", allow, {
      fetchImpl: async () =>
        mockResponse({
          body: "%PDF-1.4",
          contentType: "application/pdf",
          url: pdfUrl,
          arrayBufferBytes: new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]),
        }),
      pdfCacheFs: fs,
      extractPdfText: async (fileUri) => {
        extractCalls += 1;
        extractUri = fileUri;
        return {
          docs: [
            {
              docId: "cache#p1",
              title: "p. 1",
              text: "Global climate temperature rose by 1.5 degrees above pre-industrial levels in the assessment.",
            },
            {
              docId: "cache#p3",
              title: "p. 3",
              text: "Sea levels increased approximately 3.7 millimeters per year from thermal expansion.",
            },
          ],
          skippedPages: [],
        };
      },
    });
    const out = await exec("web_fetch", {
      url: pdfUrl,
      query: "global temperature climate sea levels",
    });
    check("pdf with extractor routed", extractCalls === 1 && extractUri != null);
    check(
      "pdf never htmlToText artifacts",
      !out.text.includes("<html") && !out.text.includes("Climate Report 2024"),
    );
    check(
      "pdf passages numbered with page labels",
      /1\.\s*\(p\.\s*1\)/i.test(out.text) || /1\.\s*\(p\. 1\)/.test(out.text),
      out.text?.slice(0, 200),
    );
    check(
      "pdf sources carry pdfPages",
      Array.isArray(out.sources?.[0]?.pdfPages) &&
        out.sources[0].pdfPages.includes(1) &&
        out.sources[0].url === pdfUrl,
      JSON.stringify(out.sources?.[0]),
    );
    check(
      "pdf cache deleted on success",
      log.writes.length === 1 &&
        log.removes.length === 1 &&
        log.removes[0] === log.writes[0],
      JSON.stringify(log),
    );

    // Citation suffix names pages (ledger helper, same strings as production)
    const ledgerCompile = spawnSync(
      "npx",
      [
        "tsc",
        "src/agent/toolSourceLedger.ts",
        "src/util/url.ts",
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
      ],
      { cwd: projectRoot, encoding: "utf8", shell: true },
    );
    if (ledgerCompile.status === 0) {
      const ledger = await import(pathToFileURL(resolveBuilt("toolSourceLedger.js")).href);
      const { en } = await import(pathToFileURL(resolveBuilt("en.js")).href);
      const suffix = ledger.buildCiteInstructionSuffix(
        [1],
        en,
        "passages",
        { pdfPages: out.sources[0].pdfPages },
      );
      check(
        "pdf citation suffix names pages",
        /p\.\s*1/i.test(suffix) && /\[1\]/.test(suffix),
        suffix?.slice(0, 200),
      );
    } else {
      check("pdf citation suffix names pages", false, "ledger compile failed");
    }
  }

  // No text layer → explicit message, not generic error
  {
    const pdfUrl = "https://scan.example/blank.pdf";
    const allow = makeFetchAllowlist();
    allow.add(pdfUrl);
    const { fs, log } = makeFakeFs();
    const out = await makeWebFetchExecutor("en", allow, {
      fetchImpl: async () =>
        mockResponse({
          contentType: "application/pdf",
          url: pdfUrl,
          arrayBufferBytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
        }),
      pdfCacheFs: fs,
      extractPdfText: async () => ({
        docs: [],
        skippedPages: [1, 2, 3],
        documentPageCount: 10,
      }),
    })("web_fetch", { url: pdfUrl, query: "anything climate temperature" });
    check(
      "pdf no-text-layer explicit message",
      /no extractable text layer/i.test(out.text) &&
        /reports 10 pages/i.test(out.text) &&
        /3 inspected/i.test(out.text) &&
        !/unsupported/i.test(out.text),
      out.text?.slice(0, 200),
    );
    check(
      "pdf cache deleted on no-text",
      log.removes.length === 1 && log.writes.length === 1,
    );
  }

  // Partial: page 1 text, pages 9–10 none, document has 10 pages
  {
    const pdfUrl = "https://mixed.example/doc.pdf";
    const allow = makeFetchAllowlist();
    allow.add(pdfUrl);
    const { fs } = makeFakeFs();
    const out = await makeWebFetchExecutor("en", allow, {
      fetchImpl: async () =>
        mockResponse({
          contentType: "application/pdf",
          url: pdfUrl,
          arrayBufferBytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
        }),
      pdfCacheFs: fs,
      extractPdfText: async () => ({
        docs: [
          {
            docId: "x#p1",
            text: "Renewable energy capacity expanded rapidly with solar and wind generating record electricity share climate policy.",
          },
          {
            docId: "x#p2",
            text: "Further climate policy details on solar incentives and wind capacity expansion across regions.",
          },
          {
            docId: "x#p3",
            text: "Additional renewable energy findings for retrieval matching temperature and climate terms.",
          },
        ],
        skippedPages: [9, 10],
        documentPageCount: 10,
      }),
    })("web_fetch", {
      url: pdfUrl,
      query: "renewable energy solar wind climate",
    });
    check(
      "pdf partial passages + skipped note",
      /renewable|solar/i.test(out.text) &&
        /2 of 5 inspected/i.test(out.text) &&
        /document reports 10 pages/i.test(out.text),
      out.text?.slice(0, 320),
    );
  }

  // Forged documentPageCount below processed is clamped up (surfaced via skip note)
  {
    const pdfUrl = "https://forge.example/a.pdf";
    const allow = makeFetchAllowlist();
    allow.add(pdfUrl);
    const { fs } = makeFakeFs();
    const out = await makeWebFetchExecutor("en", allow, {
      fetchImpl: async () =>
        mockResponse({
          contentType: "application/pdf",
          url: pdfUrl,
          arrayBufferBytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
        }),
      pdfCacheFs: fs,
      extractPdfText: async () => ({
        docs: [
          {
            docId: "x#p1",
            text: "Climate temperature assessment findings for retrieval matching renewable energy policy.",
          },
          {
            docId: "x#p2",
            text: "Sea levels research findings climate report details about coastal expansion.",
          },
        ],
        skippedPages: [3, 4],
        documentPageCount: 1, // attacker-low; processed=4
      }),
    })("web_fetch", {
      url: pdfUrl,
      query: "climate temperature renewable",
    });
    check(
      "pdf forged pageCount clamped to processed",
      /reports 4 pages/i.test(out.text) && !/reports 1 pages/i.test(out.text),
      out.text?.slice(0, 320),
    );
  }

  // PDF size cap
  {
    const pdfUrl = "https://huge.example/big.pdf";
    const allow = makeFetchAllowlist();
    allow.add(pdfUrl);
    let extractCalls = 0;
    const { fs, log } = makeFakeFs();
    const out = await makeWebFetchExecutor("en", allow, {
      fetchImpl: async () =>
        mockResponse({
          contentType: "application/pdf",
          url: pdfUrl,
          contentLength: String(PDF_BODY_HARD_CAP + 1),
          arrayBufferBytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
        }),
      pdfCacheFs: fs,
      extractPdfText: async () => {
        extractCalls += 1;
        return { docs: [], skippedPages: [] };
      },
    })("web_fetch", { url: pdfUrl, query: "x" });
    check(
      "pdf size cap fires",
      /too large|KB/i.test(out.text) && /PDF/i.test(out.text),
      out.text?.slice(0, 120),
    );
    check("pdf size cap no extract", extractCalls === 0);
    check("pdf size cap no cache write", log.writes.length === 0);
  }

  // PDF body timeout (AbortError during arrayBuffer)
  {
    const pdfUrl = "https://slowpdf.example/a.pdf";
    const allow = makeFetchAllowlist();
    allow.add(pdfUrl);
    const { fs, log } = makeFakeFs();
    const err = new Error("aborted");
    err.name = "AbortError";
    const out = await makeWebFetchExecutor("en", allow, {
      fetchImpl: async () => ({
        status: 200,
        url: pdfUrl,
        headers: {
          get(name) {
            return String(name).toLowerCase() === "content-type"
              ? "application/pdf"
              : null;
          },
        },
        async arrayBuffer() {
          throw err;
        },
        async text() {
          throw err;
        },
      }),
      pdfCacheFs: fs,
      extractPdfText: async () => ({ docs: [], skippedPages: [] }),
    })("web_fetch", { url: pdfUrl, query: "x" });
    check(
      "pdf timeout message",
      /PDF.*timed out|timed out.*PDF|PDF download timed out/i.test(out.text),
      out.text?.slice(0, 120),
    );
    check("pdf timeout no cache left", log.writes.length === 0);
  }

  // Extractor throws after write → cache deleted
  {
    const pdfUrl = "https://fail.example/a.pdf";
    const allow = makeFetchAllowlist();
    allow.add(pdfUrl);
    const { fs, log } = makeFakeFs();
    const out = await makeWebFetchExecutor("en", allow, {
      fetchImpl: async () =>
        mockResponse({
          contentType: "application/pdf",
          url: pdfUrl,
          arrayBufferBytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
        }),
      pdfCacheFs: fs,
      extractPdfText: async () => {
        throw Object.assign(new Error("boom extract"), { code: "failed" });
      },
    })("web_fetch", { url: pdfUrl, query: "x" });
    check(
      "pdf extract error message",
      /extract/i.test(out.text) && /boom|failed/i.test(out.text),
      out.text?.slice(0, 120),
    );
    check(
      "pdf cache deleted on extract error",
      log.writes.length === 1 && log.removes.length === 1,
      JSON.stringify(log),
    );
  }

  // application/pdf but extractor returns no pages → honest failure
  {
    const pdfUrl = "https://fake.example/notreally.pdf";
    const allow = makeFetchAllowlist();
    allow.add(pdfUrl);
    const { fs } = makeFakeFs();
    const out = await makeWebFetchExecutor("en", allow, {
      fetchImpl: async () =>
        mockResponse({
          contentType: "application/pdf",
          url: pdfUrl,
          arrayBufferBytes: new Uint8Array([0x00, 0x01, 0x02]),
        }),
      pdfCacheFs: fs,
      extractPdfText: async () => ({ docs: [], skippedPages: [] }),
    })("web_fetch", { url: pdfUrl, query: "climate temperature" });
    check(
      "pdf invalid body honest failure",
      /claimed to be a PDF|no pages|not.*extract/i.test(out.text) &&
        !/undefined|TypeError/i.test(out.text),
      out.text?.slice(0, 160),
    );
  }

  // H2: throwing pdfCacheFs.write → i18n, never reject, path-free
  {
    const pdfUrl = "https://disk.example/a.pdf";
    const allow = makeFetchAllowlist();
    allow.add(pdfUrl);
    let rejected = false;
    let out;
    try {
      out = await makeWebFetchExecutor("en", allow, {
        fetchImpl: async () =>
          mockResponse({
            contentType: "application/pdf",
            url: pdfUrl,
            arrayBufferBytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
          }),
        pdfCacheFs: {
          async write() {
            throw new Error("ENOSPC: write failed at /data/user/0/com.app/cache/web-fetch-pdf-xyz.pdf");
          },
          async remove() {},
        },
        extractPdfText: async () => ({ docs: [], skippedPages: [] }),
      })("web_fetch", { url: pdfUrl, query: "x" });
    } catch {
      rejected = true;
    }
    check("pdf write throw never rejects", !rejected && typeof out?.text === "string");
    check(
      "pdf write throw sanitized i18n",
      /extract/i.test(out?.text ?? "") &&
        !/\/data\/user/i.test(out?.text ?? "") &&
        !/web-fetch-pdf/i.test(out?.text ?? ""),
      out?.text?.slice(0, 160),
    );
  }

  // H3: busy pre-check → 0 network calls
  {
    let fetches = 0;
    const allow = makeFetchAllowlist();
    allow.add("https://busy.example/a.pdf");
    const out = await makeWebFetchExecutor("en", allow, {
      fetchImpl: async () => {
        fetches += 1;
        return mockResponse({ contentType: "application/pdf" });
      },
      extractPdfText: async () => ({ docs: [], skippedPages: [] }),
      pdfCacheFs: makeFakeFs().fs,
      isPdfTextExtractionBusy: () => true,
    })("web_fetch", { url: "https://busy.example/a.pdf", query: "x" });
    check(
      "pdf busy pre-check 0 fetches",
      fetches === 0 && /already being extracted|Wait for it/i.test(out.text),
      out.text?.slice(0, 120),
    );
  }

  // PDF post-read byteLength gate (measured size message)
  {
    const pdfUrl = "https://bigbody.example/a.pdf";
    const allow = makeFetchAllowlist();
    allow.add(pdfUrl);
    const huge = new Uint8Array(PDF_BODY_HARD_CAP + 50);
    huge.fill(0x41);
    let extractCalls = 0;
    const { fs, log } = makeFakeFs();
    const out = await makeWebFetchExecutor("en", allow, {
      fetchImpl: async () =>
        mockResponse({
          contentType: "application/pdf",
          url: pdfUrl,
          contentLength: "100",
          arrayBufferBytes: huge,
        }),
      pdfCacheFs: fs,
      extractPdfText: async () => {
        extractCalls += 1;
        return { docs: [], skippedPages: [] };
      },
    })("web_fetch", { url: pdfUrl, query: "x" });
    check(
      "pdf post-read size cap measured",
      /measured/i.test(out.text) && /too large/i.test(out.text) && extractCalls === 0,
      out.text?.slice(0, 120),
    );
    check("pdf post-read size no cache", log.writes.length === 0);
  }

  // Host missing / extract timeout / abort mapping (by code, not substring)
  {
    const pdfUrl = "https://map.example/a.pdf";
    const allow = makeFetchAllowlist();
    allow.add(pdfUrl);
    const { fs } = makeFakeFs();
    const base = {
      fetchImpl: async () =>
        mockResponse({
          contentType: "application/pdf",
          url: pdfUrl,
          arrayBufferBytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
        }),
      pdfCacheFs: fs,
    };
    // Fixture message has NO keywords the fallback path would echo — only
    // the no_host branch can produce the catalog string.
    const hostOut = await makeWebFetchExecutor("en", allow, {
      ...base,
      extractPdfText: async () => {
        throw Object.assign(new Error("xyz-no-keywords-fixture"), { code: "no_host" });
      },
    })("web_fetch", { url: pdfUrl, query: "x" });
    const hostCatalog =
      "PDF text extraction is unavailable (extractor host not mounted).";
    check(
      "pdf host-missing mapping",
      hostOut.text === hostCatalog,
      hostOut.text?.slice(0, 120),
    );

    const toOut = await makeWebFetchExecutor("en", allow, {
      ...base,
      extractPdfText: async () => {
        throw Object.assign(new Error("PDF text extraction timed out"), {
          code: "timeout",
        });
      },
    })("web_fetch", { url: pdfUrl, query: "x" });
    check(
      "pdf extract-timeout mapping",
      /extraction timed out/i.test(toOut.text) && /Try again/i.test(toOut.text),
      toOut.text?.slice(0, 100),
    );

    const abOut = await makeWebFetchExecutor("en", allow, {
      ...base,
      extractPdfText: async () => {
        throw Object.assign(new Error("PDF text extraction aborted"), {
          code: "aborted",
        });
      },
    })("web_fetch", { url: pdfUrl, query: "x" });
    check(
      "pdf abort mapping no try-again",
      /cancell?ed/i.test(abOut.text) && !/Try again/i.test(abOut.text),
      abOut.text?.slice(0, 100),
    );

    // renderer_gone → distinct message, never "try again" / timeout copy
    const rgCatalogEn =
      "PDF text extraction failed: the document is too large or too complex for this device. " +
      "Do not retry the same fetch; tell the user the PDF could not be read here.";
    const rgOut = await makeWebFetchExecutor("en", allow, {
      ...base,
      extractPdfText: async () => {
        throw Object.assign(new Error("renderer process gone"), {
          code: "renderer_gone",
        });
      },
    })("web_fetch", { url: pdfUrl, query: "x" });
    check(
      "pdf renderer_gone mapping",
      rgOut.text === rgCatalogEn &&
        !/Try again/i.test(rgOut.text) &&
        !/extraction timed out/i.test(rgOut.text),
      rgOut.text?.slice(0, 160),
    );

    // Untyped extractor throw with a cache path must be sanitized via mapPdfExtractError.
    const pathOut = await makeWebFetchExecutor("en", allow, {
      ...base,
      extractPdfText: async () => {
        throw new Error(
          "pdf.js failed at /data/user/0/com.kalsa.app/cache/web-fetch-pdf-1.pdf",
        );
      },
    })("web_fetch", { url: pdfUrl, query: "x" });
    check(
      "pdf extract untyped path sanitized",
      pathOut.text.includes("[path]") &&
        !pathOut.text.includes("/data/") &&
        /extraction failed/i.test(pathOut.text),
      pathOut.text?.slice(0, 160),
    );

    // pdf.js-like "timed out" without code must NOT become extract-timeout
    const jsOut = await makeWebFetchExecutor("en", allow, {
      ...base,
      extractPdfText: async () => {
        throw new Error("Rendering timed out in worker");
      },
    })("web_fetch", { url: pdfUrl, query: "x" });
    check(
      "pdf substring timed out not remapped",
      /extract/i.test(jsOut.text) && !/extraction timed out/i.test(jsOut.text),
      jsOut.text?.slice(0, 120),
    );
  }

  // fs not configured
  {
    const pdfUrl = "https://nofs.example/a.pdf";
    const allow = makeFetchAllowlist();
    allow.add(pdfUrl);
    const out = await makeWebFetchExecutor("en", allow, {
      fetchImpl: async () =>
        mockResponse({
          contentType: "application/pdf",
          url: pdfUrl,
          arrayBufferBytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
        }),
      extractPdfText: async () => ({ docs: [], skippedPages: [] }),
      // no pdfCacheFs
    })("web_fetch", { url: pdfUrl, query: "x" });
    check(
      "pdf fs-not-configured message",
      /cache filesystem is not configured/i.test(out.text),
      out.text?.slice(0, 120),
    );
  }

  // sanitizeToolErrorMessage: strip paths, keep https URLs
  {
    const { sanitizeToolErrorMessage } = mod;
    check(
      "sanitize strips absolute paths",
      typeof sanitizeToolErrorMessage === "function" &&
        !sanitizeToolErrorMessage(
          "ENOSPC at /data/user/0/com.app/cache/web-fetch-pdf-1.pdf",
        ).includes("/data/user"),
    );
    const urlMsg = sanitizeToolErrorMessage(
      "fetch failed for https://example.com/a/b/c",
    );
    check(
      "sanitize keeps https URL intact",
      urlMsg.includes("https://example.com/a/b/c") && !urlMsg.includes("https:/[path]"),
      urlMsg,
    );
    check(
      "sanitize strips file://",
      !sanitizeToolErrorMessage("err file:///tmp/x/y/z.pdf more").includes("file://"),
    );
    check(
      "sanitize strips Windows path",
      !sanitizeToolErrorMessage("err C:\\Users\\me\\cache\\a.pdf").includes("C:\\"),
    );
    check(
      "sanitize strips UNC",
      !sanitizeToolErrorMessage("err \\\\server\\share\\folder\\a.pdf").includes("\\\\server"),
    );
    check(
      "sanitize strips percent-encoded absolute",
      !sanitizeToolErrorMessage("err %2Fdata%2Fuser%2F0%2Fcom.app%2Fcache").includes("%2Fdata"),
    );
    const contentUri = sanitizeToolErrorMessage(
      "open failed content://media/external/file/42 more",
    );
    check(
      "sanitize does not mangle content:// scheme",
      contentUri.includes("content://media/external/file/42") &&
        !contentUri.includes("content:/[path]"),
      contentUri,
    );
  }

  // MAX_INDEX_CHARS cap on PDF path — pin the CALL SITE in handlePdfResponse,
  // not only the pure helper. Two-page fixture: page 1 fills the entire budget
  // with retrievable terms (no probe); page 2 holds a unique probe token that
  // is only indexed when the call is removed / the helper is a no-op.
  {
    const { capDocsForIndex } = mod;
    const filler = "w".repeat(MAX_INDEX_CHARS);
    const pureBig = `${filler} MARKERONLYINTAIL999 end`;
    check("pdf index fixture longer than cap", pureBig.length > MAX_INDEX_CHARS);
    const pureCapped = capDocsForIndex(
      [{ docId: "d#p1", text: pureBig }],
      MAX_INDEX_CHARS,
    );
    check(
      "pdf index cap pure drops tail",
      pureCapped.docs.length === 1 &&
        pureCapped.docs[0].text.length === MAX_INDEX_CHARS &&
        !pureCapped.docs[0].text.includes("MARKERONLYINTAIL999") &&
        pureCapped.lastTruncated === true,
      `len=${pureCapped.docs[0]?.text?.length}`,
    );

    const PROBE = "zebrafishchromatophore991";
    const unit =
      "climate temperature sea levels research findings uniqueHEADTOKEN777. ";
    let page1 = "";
    while (page1.length + unit.length <= MAX_INDEX_CHARS) page1 += unit;
    // Exact budget fill so remaining chars for page 2 is 0 after the call.
    page1 = page1.padEnd(MAX_INDEX_CHARS, "x");
    check("pdf index page1 exactly MAX_INDEX_CHARS", page1.length === MAX_INDEX_CHARS);
    check("pdf index page1 has no probe", !page1.includes(PROBE));

    const page2 =
      `Only page two documents the rare token ${PROBE} for chromatophore studies.`;
    check("pdf index page2 carries probe", page2.includes(PROBE));

    // Pure multi-doc: after cap only page 1 remains.
    const multiCapped = capDocsForIndex(
      [
        { docId: "x#p1", text: page1 },
        { docId: "x#p2", text: page2 },
      ],
      MAX_INDEX_CHARS,
    );
    check(
      "pdf index cap pure drops second doc",
      multiCapped.docs.length === 1 &&
        multiCapped.docs[0].docId.endsWith("#p1") &&
        !multiCapped.docs.some((d) => d.text.includes(PROBE)) &&
        multiCapped.droppedCount === 1 &&
        multiCapped.droppedPageNumbers.includes(2),
      multiCapped.docs.map((d) => d.docId).join(","),
    );

    const pdfUrl = "https://longpdf.example/a.pdf";
    const allow = makeFetchAllowlist();
    allow.add(pdfUrl);
    const { fs } = makeFakeFs();
    const extractTwoPages = async () => ({
      docs: [
        { docId: "x#p1", text: page1 },
        { docId: "x#p2", text: page2 },
      ],
      skippedPages: [],
    });
    const mockPdf = () =>
      mockResponse({
        contentType: "application/pdf",
        url: pdfUrl,
        arrayBufferBytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
      });

    // Probe query: with the call site intact, page 2 is never indexed →
    // nothing-matched AND an index-cap note naming the dropped page.
    const outProbe = await makeWebFetchExecutor("en", allow, {
      fetchImpl: async () => mockPdf(),
      pdfCacheFs: fs,
      extractPdfText: extractTwoPages,
    })("web_fetch", { url: pdfUrl, query: PROBE });
    check(
      "pdf index cap drops second page by budget",
      !outProbe.text.includes(PROBE) &&
        /nothing matched|no.*match/i.test(outProbe.text) &&
        /not searched/i.test(outProbe.text) &&
        /\b2\b/.test(outProbe.text),
      outProbe.text?.slice(0, 220),
    );

    // Head still reachable — so a broken executor cannot pass the probe test.
    const outHead = await makeWebFetchExecutor("en", allow, {
      fetchImpl: async () => mockPdf(),
      pdfCacheFs: fs,
      extractPdfText: extractTwoPages,
    })("web_fetch", {
      url: pdfUrl,
      query: "climate temperature uniqueHEADTOKEN777",
    });
    check(
      "pdf index cap first page still searchable",
      /climate|temperature|uniqueHEADTOKEN777/i.test(outHead.text),
      outHead.text?.slice(0, 120),
    );

    // Reproduction: 5 × 30k pages (120_078 total, cap 120_000), answer on page 5.
    // Must not silently say "nothing matched" without naming the dropped page.
    {
      const ANSWER = "UNICORNFINALPAGEANSWER888";
      const pageDocs = [];
      for (let p = 1; p <= 5; p++) {
        const base =
          p === 5
            ? `Page five holds the answer ${ANSWER} for the rare query. `
            : `Page ${p} filler climate temperature research findings sea. `;
        let text = base;
        while (text.length < 30_000) text += base;
        text = text.slice(0, 30_000);
        pageDocs.push({ docId: `x#p${p}`, text });
      }
      const total = pageDocs.reduce((s, d) => s + d.text.length, 0);
      check("pdf index 5x30k total over cap", total > MAX_INDEX_CHARS && total === 150_000);
      const fiveUrl = "https://a2.example/long.pdf";
      allow.add(fiveUrl);
      const outFive = await makeWebFetchExecutor("en", allow, {
        fetchImpl: async () =>
          mockResponse({
            contentType: "application/pdf",
            url: fiveUrl,
            arrayBufferBytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
          }),
        pdfCacheFs: fs,
        extractPdfText: async () => ({
          docs: pageDocs,
          skippedPages: [],
          documentPageCount: 5,
        }),
      })("web_fetch", {
        url: fiveUrl,
        query: ANSWER,
      });
      check(
        "pdf index cap 5x30k note names dropped page",
        !outFive.text.includes(ANSWER) &&
          /not searched/i.test(outFive.text) &&
          /\b5\b/.test(outFive.text),
        outFive.text?.slice(0, 280),
      );
    }

    // Under budget: note must be absent.
    {
      const smallUrl = "https://smallpdf.example/a.pdf";
      allow.add(smallUrl);
      const outSmall = await makeWebFetchExecutor("en", allow, {
        fetchImpl: async () =>
          mockResponse({
            contentType: "application/pdf",
            url: smallUrl,
            arrayBufferBytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
          }),
        pdfCacheFs: fs,
        extractPdfText: async () => ({
          docs: [
            {
              docId: "s#p1",
              text: "Short climate temperature sea levels research findings only.",
            },
          ],
          skippedPages: [],
        }),
      })("web_fetch", {
        url: smallUrl,
        query: "climate temperature sea levels",
      });
      check(
        "pdf index cap note absent when nothing dropped",
        /climate|temperature/i.test(outSmall.text) &&
          !/not searched/i.test(outSmall.text) &&
          !/budget was exhausted/i.test(outSmall.text),
        outSmall.text?.slice(0, 160),
      );
    }
  }

  // Post-CT busy (non-.pdf URL serving application/pdf)
  {
    let fetches = 0;
    const allow = makeFetchAllowlist();
    allow.add("https://sneaky.example/page");
    const out = await makeWebFetchExecutor("en", allow, {
      fetchImpl: async () => {
        fetches += 1;
        return mockResponse({
          contentType: "application/pdf",
          url: "https://sneaky.example/page",
          arrayBufferBytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
        });
      },
      extractPdfText: async () => ({ docs: [], skippedPages: [] }),
      pdfCacheFs: makeFakeFs().fs,
      isPdfTextExtractionBusy: () => true,
    })("web_fetch", { url: "https://sneaky.example/page", query: "x" });
    check(
      "pdf busy after content-type 0 body extract",
      fetches === 1 && /already being extracted|Wait for it/i.test(out.text),
      `fetches=${fetches} ${out.text?.slice(0, 80)}`,
    );
  }

  // mapPdfExtractError busy + unmounted
  {
    const pdfUrl = "https://codes.example/a.pdf";
    const allow = makeFetchAllowlist();
    allow.add(pdfUrl);
    const { fs } = makeFakeFs();
    const base = {
      fetchImpl: async () =>
        mockResponse({
          contentType: "application/pdf",
          url: pdfUrl,
          arrayBufferBytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
        }),
      pdfCacheFs: fs,
    };
    const busyOut = await makeWebFetchExecutor("en", allow, {
      ...base,
      extractPdfText: async () => {
        throw Object.assign(new Error("already in progress"), { code: "busy" });
      },
    })("web_fetch", { url: pdfUrl, query: "x" });
    check(
      "pdf map code busy",
      /already being extracted|Wait for it/i.test(busyOut.text),
      busyOut.text?.slice(0, 100),
    );
    const unOut = await makeWebFetchExecutor("en", allow, {
      ...base,
      extractPdfText: async () => {
        throw Object.assign(new Error("host unmounted"), { code: "unmounted" });
      },
    })("web_fetch", { url: pdfUrl, query: "x" });
    check(
      "pdf map code unmounted → cancelled",
      /cancell?ed/i.test(unOut.text) && !/Try again/i.test(unOut.text),
      unOut.text?.slice(0, 100),
    );
  }

  // Fetch-phase abort: turn vs timer; both-aborted → cancelled
  {
    const pdfUrl = "https://abort.example/a.pdf";
    const allow = makeFetchAllowlist();
    allow.add(pdfUrl);
    const ac = new AbortController();
    ac.abort();
    const turnOut = await makeWebFetchExecutor("en", allow, {
      fetchImpl: async (_u, init) => {
        // Simulate abort via signal
        const err = new Error("aborted");
        err.name = "AbortError";
        throw err;
      },
      extractPdfText: async () => ({ docs: [], skippedPages: [] }),
      pdfCacheFs: makeFakeFs().fs,
    })("web_fetch", { url: pdfUrl, query: "x" }, ac.signal);
    check(
      "pdf fetch turn abort → cancelled",
      /cancell?ed/i.test(turnOut.text) && !/Try again/i.test(turnOut.text),
      turnOut.text?.slice(0, 100),
    );

    const timerOut = await makeWebFetchExecutor("en", allow, {
      fetchImpl: async () => {
        const err = new Error("aborted");
        err.name = "AbortError";
        throw err;
      },
      extractPdfText: async () => ({ docs: [], skippedPages: [] }),
      pdfCacheFs: makeFakeFs().fs,
    })("web_fetch", { url: pdfUrl, query: "x" });
    check(
      "pdf fetch timer abort → try again",
      /timed out/i.test(timerOut.text) && /Try again/i.test(timerOut.text),
      timerOut.text?.slice(0, 100),
    );

    // Both aborted: fire the network timer AND the turn signal so the
    // precedence path is real (not a pre-aborted signal with a sync throw).
    const bothAc = new AbortController();
    const bothOut = await makeWebFetchExecutor("en", allow, {
      resolveNetworkTimeoutMs: () => 30,
      fetchImpl: async (_u, init) => {
        await new Promise((r) => setTimeout(r, 80));
        bothAc.abort();
        const err = new Error("aborted");
        err.name = "AbortError";
        throw err;
      },
      extractPdfText: async () => ({ docs: [], skippedPages: [] }),
      pdfCacheFs: makeFakeFs().fs,
    })("web_fetch", { url: pdfUrl, query: "x" }, bothAc.signal);
    check(
      "pdf both-aborted → cancelled not try-again",
      /cancell?ed/i.test(bothOut.text) && !/Try again/i.test(bothOut.text),
      bothOut.text?.slice(0, 100),
    );

    // H1: clearNetworkTimer before extraction — 50 ms network window, 200 ms
    // fake extract must still complete (pre-fix code would kill at ~50 ms).
    {
      const slowUrl = "https://slowextract.example/a.pdf";
      allow.add(slowUrl);
      const { fs } = makeFakeFs();
      let extractStarted = 0;
      let extractFinished = 0;
      const out = await makeWebFetchExecutor("en", allow, {
        resolveNetworkTimeoutMs: () => 50,
        fetchImpl: async () =>
          mockResponse({
            contentType: "application/pdf",
            url: slowUrl,
            arrayBufferBytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
          }),
        pdfCacheFs: fs,
        extractPdfText: async () => {
          extractStarted = Date.now();
          await new Promise((r) => setTimeout(r, 200));
          extractFinished = Date.now();
          return {
            docs: [
              {
                docId: "s#p1",
                text: "climate temperature sea levels research findings slow extract.",
              },
            ],
            skippedPages: [],
          };
        },
      })("web_fetch", {
        url: slowUrl,
        query: "climate temperature sea levels",
      });
      check(
        "pdf clearNetworkTimer allows long extract",
        extractStarted > 0 &&
          extractFinished > 0 &&
          extractFinished - extractStarted >= 150 &&
          /climate|temperature/i.test(out.text) &&
          !/timed out/i.test(out.text),
        out.text?.slice(0, 160),
      );
    }
  }

  // component-timeout path (service code timeout) → extract timeout copy
  {
    const pdfUrl = "https://compto.example/a.pdf";
    const allow = makeFetchAllowlist();
    allow.add(pdfUrl);
    const { fs } = makeFakeFs();
    const out = await makeWebFetchExecutor("en", allow, {
      fetchImpl: async () =>
        mockResponse({
          contentType: "application/pdf",
          url: pdfUrl,
          arrayBufferBytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
        }),
      pdfCacheFs: fs,
      // Host maps PdfExtractError(timeout) → PdfTextServiceError(timeout)
      extractPdfText: async () => {
        throw Object.assign(new Error("PDF text extraction timed out"), {
          code: "timeout",
        });
      },
    })("web_fetch", { url: pdfUrl, query: "x" });
    check(
      "pdf component-timeout → extractTimeout not failed",
      /extraction timed out/i.test(out.text) &&
        /Try again/i.test(out.text) &&
        !/extraction failed/i.test(out.text),
      out.text?.slice(0, 120),
    );
  }

  // Host gate / allowlist / redirect still refuse PDFs (reuse attack list)
  {
    let networkCalls = 0;
    const { fs } = makeFakeFs();
    const extractPdfText = async () => {
      throw new Error("should not extract");
    };
    const depsBase = { pdfCacheFs: fs, extractPdfText };

    // Allowlist
    {
      const allow = makeFetchAllowlist();
      allow.add("https://ok.example/a.pdf");
      const out = await makeWebFetchExecutor("en", allow, {
        ...depsBase,
        fetchImpl: async () => {
          networkCalls += 1;
          return mockResponse({ contentType: "application/pdf" });
        },
      })("web_fetch", {
        url: "https://evil.example/secret.pdf",
        query: "x",
      });
      check(
        "pdf allowlist refusal no network",
        networkCalls === 0 && /refused|not in this turn|surfaced/i.test(out.text),
      );
    }

    // Host gate: reuse refused family — no network
    {
      let calls = 0;
      const allow = makeFetchAllowlist();
      for (const u of refused) {
        allow.add(u); // even if allowlisted, host gate refuses first
      }
      const exec = makeWebFetchExecutor("en", allow, {
        ...depsBase,
        fetchImpl: async () => {
          calls += 1;
          return mockResponse({ contentType: "application/pdf" });
        },
      });
      let allRefused = true;
      for (const u of refused) {
        const out = await exec("web_fetch", { url: u, query: "x" });
        if (!/refused|safe|not a safe/i.test(out.text)) {
          allRefused = false;
          console.log(`  pdf still allowed unsafe: ${u} → ${out.text?.slice(0, 80)}`);
        }
      }
      check("pdf host gate REFUSED attack family", allRefused && calls === 0, `calls=${calls}`);
    }

    // Redirect to private host refused without body/extract
    {
      let extractCalls = 0;
      let bodyReads = 0;
      const allow = makeFetchAllowlist();
      allow.add("https://public.example/start.pdf");
      const out = await makeWebFetchExecutor("en", allow, {
        fetchImpl: async () =>
          mockResponse({
            body: "SECRET",
            contentType: "application/pdf",
            url: "http://192.168.0.5/admin.pdf",
            onText: () => {
              bodyReads += 1;
            },
            arrayBufferBytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
          }),
        pdfCacheFs: fs,
        extractPdfText: async () => {
          extractCalls += 1;
          return { docs: [], skippedPages: [] };
        },
      })("web_fetch", {
        url: "https://public.example/start.pdf",
        query: "x",
      });
      check(
        "pdf redirect to private refused",
        /redirect|refused/i.test(out.text) && extractCalls === 0 && bodyReads === 0,
        out.text?.slice(0, 120),
      );
    }

    // https→http downgrade refused
    {
      let extractCalls = 0;
      const allow = makeFetchAllowlist();
      allow.add("https://secure.example/a.pdf");
      const out = await makeWebFetchExecutor("en", allow, {
        fetchImpl: async () =>
          mockResponse({
            contentType: "application/pdf",
            url: "http://secure.example/a.pdf",
            arrayBufferBytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
          }),
        pdfCacheFs: fs,
        extractPdfText: async () => {
          extractCalls += 1;
          return { docs: [], skippedPages: [] };
        },
      })("web_fetch", {
        url: "https://secure.example/a.pdf",
        query: "x",
      });
      check(
        "pdf https→http downgrade refused",
        /redirect|refused|downgrade/i.test(out.text) && extractCalls === 0,
        out.text?.slice(0, 120),
      );
    }
  }

  // ── web_search delivery hardening (parseExaTextResults + thin-snippet marker) ──
  // Closest harness for search delivery path; pure modules only (no secretStore/network).
  {
    console.log("\nCompiling search delivery helpers (ExaMCP + SearchProvider) …");
    const searchOut = path.join(projectRoot, "scripts/.build/webSearchDelivery");
    rmSync(searchOut, { recursive: true, force: true });
    mkdirSync(searchOut, { recursive: true });
    const sr = spawnSync(
      "npx",
      [
        "tsc",
        "src/search/ExaMCP.ts",
        "src/search/http.ts",
        "src/search/SearchProvider.ts",
        "--outDir",
        searchOut,
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
    if (sr.status !== 0) {
      console.error("search delivery tsc failed:\n", sr.stdout, sr.stderr);
      process.exit(1);
    }
    const resolveSearch = (base) => {
      const candidates = [
        path.join(searchOut, `search/${base}`),
        path.join(searchOut, `src/search/${base}`),
        path.join(searchOut, base),
      ];
      for (const c of candidates) {
        if (existsSync(c)) return c;
      }
      console.error(`Could not find compiled search ${base}`);
      process.exit(1);
    };
    const exaMod = await import(pathToFileURL(resolveSearch("ExaMCP.js")).href);
    const spMod = await import(pathToFileURL(resolveSearch("SearchProvider.js")).href);
    const { parseExaTextResults } = exaMod;
    const { buildWebSearchSnippet, NO_PREVIEW_SNIPPET } = spMod;

    // Case 1: Published "N/A" must yield no publishedDate
    {
      const text = [
        "Title: NWS Forecast Office New York, NY",
        "URL: https://www.weather.gov/okx/",
        "Published: N/A",
        "Author: N/A",
        "Highlights:",
        "New York, NY forecast text",
      ].join("\n");
      const results = parseExaTextResults(text);
      check(
        "parseExa: Published N/A → no publishedDate",
        results.length === 1 && results[0].publishedDate === undefined,
        JSON.stringify(results[0]),
      );
    }
    // Real date still kept
    {
      const text = [
        "Title: Dated article",
        "URL: https://example.com/a",
        "Published: 2026-08-07",
        "Highlights:",
        "body",
      ].join("\n");
      const results = parseExaTextResults(text);
      check(
        "parseExa: real date kept",
        results[0]?.publishedDate === "2026-08-07",
        JSON.stringify(results[0]),
      );
    }
    // Case 2: bare --- separator must not leak into highlights
    {
      const text = [
        "Title: First",
        "URL: https://example.com/1",
        "Highlights:",
        "highlight one",
        "---",
        "Title: Second",
        "URL: https://example.com/2",
        "Highlights:",
        "highlight two",
      ].join("\n");
      const results = parseExaTextResults(text);
      const leaked = results.some((r) =>
        (r.highlights ?? []).some((h) => h === "---" || h.includes("---")),
      );
      check(
        "parseExa: --- separator not in highlights",
        results.length === 2 && !leaked,
        JSON.stringify(results.map((r) => r.highlights)),
      );
    }
    // Case 3: empty highlights → no-preview marker
    {
      const empty = buildWebSearchSnippet({ title: "Bare", url: "https://example.com/x" });
      check(
        "snippet: empty highlights → no-preview marker",
        empty === NO_PREVIEW_SNIPPET &&
          /no preview/i.test(empty) &&
          /web_fetch/i.test(empty),
        empty,
      );
      const withHl = buildWebSearchSnippet({
        highlights: ["some preview text"],
      });
      check(
        "snippet: highlights used when present",
        withHl === "some preview text",
        withHl,
      );
    }
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
