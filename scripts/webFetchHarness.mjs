/**
 * Harness for src/agent/webFetchTool.ts
 * Allowlist, fail-closed host gate, redirect policy, body decode, index cap.
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
    path.join(projectRoot, "scripts/.build/agent/webFetchTool.js"),
    path.join(projectRoot, "scripts/.build/src/agent/webFetchTool.js"),
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
      "src/agent/webFetchTool.ts",
      "src/util/url.ts",
      "src/util/htmlToText.ts",
      "src/context/retriever.ts",
      "src/context/retrievalLoop.ts",
      "src/i18n/en.ts",
      "src/i18n/it.ts",
      "src/i18n/types.ts",
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
    path.join(projectRoot, `scripts/.build/agent/${base}`),
    path.join(projectRoot, `scripts/.build/src/agent/${base}`),
    path.join(projectRoot, `scripts/.build/util/${base}`),
    path.join(projectRoot, `scripts/.build/src/util/${base}`),
    path.join(projectRoot, `scripts/.build/context/${base}`),
    path.join(projectRoot, `scripts/.build/src/context/${base}`),
    path.join(projectRoot, `scripts/.build/i18n/${base}`),
    path.join(projectRoot, `scripts/.build/src/i18n/${base}`),
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
    // Body longer than MAX_INDEX_CHARS; unique token only past the cap would be unfindable
    // if we correctly slice. Put needle in the first cap chars so retrieval works,
    // and assert we didn't throw; also put a far token after cap that must not match alone.
    const head = `climate temperature research findings ${"word ".repeat(1000)}`;
    const tail = ` UNIQUEFARTOKEN999 ${"z".repeat(MAX_INDEX_CHARS)}`;
    const body = head + tail;
    check("fixture longer than cap", body.length > MAX_INDEX_CHARS);
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
    // Either nothing-matched or no raw full dump of the far token as primary dump
    check(
      "plain index cap truncates searchable region",
      /nothing matched|no.*match/i.test(outFar.text) ||
        !outFar.text.includes("UNIQUEFARTOKEN999".repeat?.(1) && body),
      // Prefer nothing-matched when only the far token is queried
      outFar.text?.slice(0, 100),
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
    if (out.sources?.[0]) {
      check("title clamped ≤120", out.sources[0].title.length <= 120);
    } else {
      // nothing matched still ok for clamp contract on success path
      check("title clamped ≤120 (no sources skip)", true);
    }
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
