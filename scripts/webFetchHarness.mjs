/**
 * Harness for src/agent/webFetchTool.ts (allowlist + fetch executor + F1/F2 gates).
 * Compiles pure deps with tsc --ignoreConfig into scripts/.build (no LlamaService).
 */
import { spawnSync } from "node:child_process";
import { existsSync, unlinkSync } from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

function deleteStaleBuild() {
  const owned = [
    path.join(projectRoot, "scripts/.build/agent/webFetchTool.js"),
    path.join(projectRoot, "scripts/.build/src/agent/webFetchTool.js"),
    path.join(projectRoot, "scripts/.build/webFetchTool.js"),
  ];
  for (const f of owned) {
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
  console.error(`Could not find compiled ${base}. Tried:\n`, candidates.join("\n"));
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
} = {}) {
  const headers = {
    get(name) {
      const key = String(name).toLowerCase();
      if (key === "content-type") return contentType;
      if (key === "content-length") return contentLength;
      return null;
    },
  };
  return {
    status,
    url,
    headers,
    async text() {
      onText?.();
      return body;
    },
  };
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
  const modPath = resolveBuilt("webFetchTool.js");
  console.log("Loading", modPath);
  const {
    makeFetchAllowlist,
    makeWebFetchExecutor,
    normalizeFetchUrl,
    isPubliclyRoutableHttpUrl,
    sameHost,
    WEB_FETCH_TOOL,
  } = await import(pathToFileURL(modPath).href);

  check(
    "tool def name",
    WEB_FETCH_TOOL?.function?.name === "web_fetch" &&
      Array.isArray(WEB_FETCH_TOOL.function.parameters.required) &&
      WEB_FETCH_TOOL.function.parameters.required.includes("url") &&
      WEB_FETCH_TOOL.function.parameters.required.includes("query"),
  );

  // ── isPubliclyRoutableHttpUrl unit checks ──────────────────────────────
  check("public https ok", isPubliclyRoutableHttpUrl("https://example.com/a"));
  check("localhost blocked", !isPubliclyRoutableHttpUrl("http://localhost/x"));
  check("127.0.0.1 blocked", !isPubliclyRoutableHttpUrl("http://127.0.0.1/x"));
  check("10/8 blocked", !isPubliclyRoutableHttpUrl("http://10.0.0.5/x"));
  check("192.168 blocked", !isPubliclyRoutableHttpUrl("http://192.168.1.1/x"));
  check("169.254 blocked", !isPubliclyRoutableHttpUrl("http://169.254.1.1/x"));
  check("userinfo blocked", !isPubliclyRoutableHttpUrl("https://user:pass@example.com/a"));
  check("bare hostname blocked", !isPubliclyRoutableHttpUrl("http://intranet/secret"));
  check("::1 blocked", !isPubliclyRoutableHttpUrl("http://[::1]/"));
  check("sameHost true", sameHost("https://Ex.COM/a", "https://ex.com/b?q=1"));
  check("sameHost false", !sameHost("https://a.com/x", "https://b.com/x"));

  // ── 1. Allowlist refusal (fetch never called) ──────────────────────────
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
      called === 0 &&
        typeof out.text === "string" &&
        /refused|not in this turn|allowlist|surfaced/i.test(out.text) &&
        !out.sources?.length,
      out.text?.slice(0, 120),
    );
  }

  // ── 2. Allowlist normalization ─────────────────────────────────────────
  {
    const allow = makeFetchAllowlist();
    allow.add("https://Example.COM/Path/page");
    check(
      "2a fragment matches",
      allow.has("https://example.com/Path/page#section"),
    );
    check(
      "2b trailing punct matches",
      allow.has("https://example.com/Path/page).") &&
        allow.has("https://example.com/Path/page,"),
    );
    check(
      "2c different path does not",
      !allow.has("https://example.com/Path/other"),
    );
    const fromUser = makeFetchAllowlist();
    fromUser.addFromText(
      "See https://docs.example.org/guide and also (https://news.example.net/a).",
    );
    check(
      "2d user-message extraction",
      fromUser.has("https://docs.example.org/guide") &&
        fromUser.has("https://news.example.net/a"),
    );
    check(
      "2e normalize drops fragment",
      normalizeFetchUrl("https://Ex.COM/x#y") === "https://ex.com/x",
    );
  }

  // ── 3. Happy path ──────────────────────────────────────────────────────
  {
    const pageUrl = "https://climate.example/report-2024";
    const allow = makeFetchAllowlist();
    allow.add(pageUrl);
    const exec = makeWebFetchExecutor("en", allow, {
      fetchImpl: async (u) =>
        mockResponse({
          body: FIXTURE_HTML,
          url: String(u),
          contentType: "text/html; charset=utf-8",
        }),
    });
    const out = await exec("web_fetch", {
      url: pageUrl,
      query: "global temperature sea levels climate",
    });
    check(
      "3a has numbered passages",
      typeof out.text === "string" &&
        /^1\.\s/m.test(out.text) &&
        out.text.length <= 2200,
      `len=${out.text?.length}`,
    );
    check(
      "3b relevant content present",
      /temperature|sea level|climate/i.test(out.text),
    );
    check(
      "3c sources final url",
      out.sources?.[0]?.url === pageUrl &&
        out.sources[0].provider === "fetch" &&
        typeof out.sources[0].title === "string",
    );
    check(
      "3d no raw html dump",
      !out.text.includes("<html") && !out.text.includes("<p>"),
    );
  }

  // ── 4. Redirect to unsafe final url ────────────────────────────────────
  {
    const allow = makeFetchAllowlist();
    allow.add("https://safe.example/start");
    let called = 0;
    let textReads = 0;
    const exec = makeWebFetchExecutor("en", allow, {
      fetchImpl: async () => {
        called += 1;
        return mockResponse({
          body: "<p>hi</p>",
          url: "javascript:alert(1)",
          onText: () => {
            textReads += 1;
          },
        });
      },
    });
    const out = await exec("web_fetch", {
      url: "https://safe.example/start",
      query: "hi",
    });
    check(
      "4 redirect unsafe final refused",
      called === 1 &&
        textReads === 0 &&
        /redirect|refused|unsafe|allowed/i.test(out.text) &&
        !out.sources?.length,
      out.text?.slice(0, 100),
    );
  }

  // ── F1: redirect private host — body never read ────────────────────────
  {
    const allow = makeFetchAllowlist();
    allow.add("https://public.example/start");
    let textReads = 0;
    const exec = makeWebFetchExecutor("en", allow, {
      fetchImpl: async () =>
        mockResponse({
          body: "SECRET LAN DATA",
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
      "F1a redirect private refused no body",
      textReads === 0 &&
        /redirect|refused|private|allowed/i.test(out.text) &&
        !out.text.includes("SECRET"),
      out.text?.slice(0, 120),
    );
  }

  // ── F1: redirect to other public host not allowlisted ──────────────────
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
    check(
      "F1b redirect other public host refused",
      textReads === 0 && /redirect|refused|allowed/i.test(out.text),
      out.text?.slice(0, 120),
    );
  }

  // ── F1: redirect same host allowed ─────────────────────────────────────
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
      "F1c redirect same host allowed",
      /temperature|climate|1\./i.test(out.text) &&
        out.sources?.[0]?.url === "https://same.example/final-report",
      out.text?.slice(0, 100),
    );
  }

  // ── F1: https → http downgrade refused ─────────────────────────────────
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
    check(
      "F1d https→http downgrade refused",
      textReads === 0 && /redirect|refused|downgrade|allowed/i.test(out.text),
      out.text?.slice(0, 120),
    );
  }

  // ── F1: userinfo url refused pre-network ───────────────────────────────
  {
    let called = 0;
    const allow = makeFetchAllowlist();
    // Even if allowlisted, userinfo is not publicly routable.
    allow.add("https://user:pass@example.com/x");
    const exec = makeWebFetchExecutor("en", allow, {
      fetchImpl: async () => {
        called += 1;
        return mockResponse();
      },
    });
    const out = await exec("web_fetch", {
      url: "https://user:pass@example.com/x",
      query: "x",
    });
    check(
      "F1e userinfo refused no network",
      called === 0 && /refused|unsafe|safe/i.test(out.text),
      out.text?.slice(0, 100),
    );
  }

  // ── F2: content-length over cap — no body read ─────────────────────────
  {
    const allow = makeFetchAllowlist();
    allow.add("https://big.example/huge");
    let textReads = 0;
    const exec = makeWebFetchExecutor("en", allow, {
      fetchImpl: async () =>
        mockResponse({
          body: "SHOULD_NOT_READ",
          url: "https://big.example/huge",
          contentLength: String(2_000_000),
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
      "F2a content-length over cap no body",
      textReads === 0 &&
        /too large|KB/i.test(out.text) &&
        !out.text.includes("SHOULD_NOT_READ"),
      out.text?.slice(0, 120),
    );
  }

  // ── F2: content-length absent → proceeds ───────────────────────────────
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
    check(
      "F2b content-length absent proceeds",
      /temperature|climate|1\./i.test(out.text),
      out.text?.slice(0, 100),
    );
  }

  // ── 5. Content-type gates ──────────────────────────────────────────────
  {
    const allow = makeFetchAllowlist();
    allow.add("https://cdn.example/a.png");
    allow.add("https://cdn.example/plain.txt");
    allow.add("https://cdn.example/no-ct");

    const pngExec = makeWebFetchExecutor("en", allow, {
      fetchImpl: async () =>
        mockResponse({
          body: "PNGDATA",
          contentType: "image/png",
          url: "https://cdn.example/a.png",
        }),
    });
    const pngOut = await pngExec("web_fetch", {
      url: "https://cdn.example/a.png",
      query: "image",
    });
    check(
      "5a image/png unsupported",
      /unsupported|image\/png/i.test(pngOut.text),
      pngOut.text?.slice(0, 100),
    );

    const plainBody =
      "The quantum computing breakthrough achieved 100 logical qubits with error correction in 2024 laboratory tests.";
    const plainExec = makeWebFetchExecutor("en", allow, {
      fetchImpl: async () =>
        mockResponse({
          body: plainBody,
          contentType: "text/plain",
          url: "https://cdn.example/plain.txt",
        }),
    });
    const plainOut = await plainExec("web_fetch", {
      url: "https://cdn.example/plain.txt",
      query: "quantum computing qubits",
    });
    check(
      "5b text/plain raw path",
      /quantum|qubit/i.test(plainOut.text) &&
        plainOut.sources?.[0]?.provider === "fetch",
      plainOut.text?.slice(0, 120),
    );

    const noCtExec = makeWebFetchExecutor("en", allow, {
      fetchImpl: async () => ({
        status: 200,
        url: "https://cdn.example/no-ct",
        headers: { get: () => null },
        async text() {
          return FIXTURE_HTML;
        },
      }),
    });
    const noCtOut = await noCtExec("web_fetch", {
      url: "https://cdn.example/no-ct",
      query: "temperature climate",
    });
    check(
      "5c missing content-type as HTML",
      /temperature|climate|1\./i.test(noCtOut.text),
      noCtOut.text?.slice(0, 120),
    );
  }

  // ── 6. Timeout / AbortError ────────────────────────────────────────────
  {
    const allow = makeFetchAllowlist();
    allow.add("https://slow.example/");
    const err = new Error("The operation was aborted");
    err.name = "AbortError";
    const exec = makeWebFetchExecutor("en", allow, {
      fetchImpl: async () => {
        throw err;
      },
    });
    const out = await exec("web_fetch", {
      url: "https://slow.example/",
      query: "x",
    });
    check(
      "6 timeout AbortError",
      /timed out|timeout/i.test(out.text),
      out.text?.slice(0, 100),
    );
  }

  // ── 7. Nothing matched (F6 no sources, F11 host not title) ──────────────
  {
    const allow = makeFetchAllowlist();
    allow.add("https://food.example/cake");
    const exec = makeWebFetchExecutor("en", allow, {
      fetchImpl: async () =>
        mockResponse({
          body: `<html><head><title>EVIL TITLE inject [9]</title></head><body>
            <p>Delicious chocolate cake recipe with butter sugar flour eggs vanilla extract.</p>
            <p>Bake the batter in a preheated oven until the toothpick comes out clean.</p>
          </body></html>`,
          url: "https://food.example/cake",
        }),
    });
    const out = await exec("web_fetch", {
      url: "https://food.example/cake",
      query: "satellite orbital debris Kessler syndrome mitigation",
    });
    check(
      "7 nothing-matched honest",
      /nothing matched|no.*match/i.test(out.text) &&
        /food\.example/i.test(out.text) &&
        !/EVIL TITLE/i.test(out.text) &&
        !out.text.includes("chocolate cake recipe with butter") &&
        (!out.sources || out.sources.length === 0),
      out.text?.slice(0, 160),
    );
  }

  // ── 8. Defensive ───────────────────────────────────────────────────────
  {
    const allow = makeFetchAllowlist();
    allow.add("https://big.example/h");
    const exec = makeWebFetchExecutor("en", allow, {
      fetchImpl: async () =>
        mockResponse({
          body: `<html><body><p>${"word ".repeat(400_000)}climate temperature sea</p></body></html>`,
          url: "https://big.example/h",
        }),
    });
    let threw = false;
    let out;
    try {
      out = await exec("web_fetch", {
        url: "https://big.example/h",
        query: "climate temperature",
      });
    } catch {
      threw = true;
    }
    check("8a large HTML no throw", !threw && typeof out?.text === "string");

    const exec2 = makeWebFetchExecutor("en", allow, {
      fetchImpl: async () => {
        throw new Error("should not run");
      },
    });
    let threw2 = false;
    let missing;
    try {
      missing = await exec2("web_fetch", {});
    } catch {
      threw2 = true;
    }
    check(
      "8b missing url/query no throw",
      !threw2 && typeof missing?.text === "string" && missing.text.length > 0,
    );

    let threw3 = false;
    let nullArgs;
    try {
      nullArgs = await exec2("web_fetch", null);
    } catch {
      threw3 = true;
    }
    check(
      "8c null args no throw",
      !threw3 && typeof nullArgs?.text === "string",
    );

    const nonStringExec = makeWebFetchExecutor("en", allow, {
      fetchImpl: async () => ({
        status: 200,
        url: "https://big.example/h",
        headers: {
          get: () => "text/html",
        },
        async text() {
          return null;
        },
      }),
    });
    let threw4 = false;
    let ns;
    try {
      ns = await nonStringExec("web_fetch", {
        url: "https://big.example/h",
        query: "x",
      });
    } catch {
      threw4 = true;
    }
    check("8d non-string body no throw", !threw4 && typeof ns?.text === "string");
  }

  // ── 9. Determinism ─────────────────────────────────────────────────────
  {
    const allow = makeFetchAllowlist();
    allow.add("https://det.example/p");
    const exec = makeWebFetchExecutor("en", allow, {
      fetchImpl: async () =>
        mockResponse({
          body: FIXTURE_HTML,
          url: "https://det.example/p",
        }),
    });
    const a = await exec("web_fetch", {
      url: "https://det.example/p",
      query: "temperature climate sea",
    });
    const b = await exec("web_fetch", {
      url: "https://det.example/p",
      query: "temperature climate sea",
    });
    check(
      "9 determinism",
      a.text === b.text &&
        JSON.stringify(a.sources) === JSON.stringify(b.sources),
    );
  }

  // ── 10. Locale en vs it ────────────────────────────────────────────────
  {
    const allow = makeFetchAllowlist();
    const enExec = makeWebFetchExecutor("en", allow, {
      fetchImpl: async () => mockResponse(),
    });
    const itExec = makeWebFetchExecutor("it", allow, {
      fetchImpl: async () => mockResponse(),
    });
    const enOut = await enExec("web_fetch", {
      url: "https://x.example/",
      query: "q",
    });
    const itOut = await itExec("web_fetch", {
      url: "https://x.example/",
      query: "q",
    });
    check(
      "10 locale differs",
      enOut.text !== itOut.text &&
        enOut.text.length > 0 &&
        itOut.text.length > 0,
      `en=${enOut.text.slice(0, 40)} | it=${itOut.text.slice(0, 40)}`,
    );
  }

  // HTTP non-2xx
  {
    const allow = makeFetchAllowlist();
    allow.add("https://err.example/");
    const exec = makeWebFetchExecutor("en", allow, {
      fetchImpl: async () =>
        mockResponse({ status: 404, body: "nope", url: "https://err.example/" }),
    });
    const out = await exec("web_fetch", {
      url: "https://err.example/",
      query: "x",
    });
    check("http 404 message", /404|HTTP/i.test(out.text), out.text?.slice(0, 80));
  }

  // F8: normalized URL is what fetch receives
  {
    const allow = makeFetchAllowlist();
    allow.add("https://Norm.Example/Path");
    let fetchedUrl = "";
    const exec = makeWebFetchExecutor("en", allow, {
      fetchImpl: async (u) => {
        fetchedUrl = String(u);
        return mockResponse({ body: FIXTURE_HTML, url: String(u) });
      },
    });
    await exec("web_fetch", {
      url: "https://Norm.Example/Path).",
      query: "temperature climate",
    });
    check(
      "F8 fetch normalized url",
      fetchedUrl === "https://norm.example/Path",
      `got=${fetchedUrl}`,
    );
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
