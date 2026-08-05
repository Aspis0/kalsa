/**
 * Harness for src/agent/toolSourceLedger.ts
 * (source accumulation, cite kinds, call-key / budget bookkeeping).
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
    path.join(projectRoot, "scripts/.build/agent/toolSourceLedger.js"),
    path.join(projectRoot, "scripts/.build/src/agent/toolSourceLedger.js"),
    path.join(projectRoot, "scripts/.build/util/url.js"),
    path.join(projectRoot, "scripts/.build/src/util/url.js"),
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
      "src/agent/toolSourceLedger.ts",
      "src/util/url.ts",
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

async function main() {
  console.log("Compiling toolSourceLedger + deps …");
  compile();
  const ledger = await import(pathToFileURL(resolveBuilt("toolSourceLedger.js")).href);
  const { en } = await import(pathToFileURL(resolveBuilt("en.js")).href);
  // Pull real retrieval budget from webFetchTool if available (optional second compile).
  // Fall back is only for messaging; primary assertions use exported ledger behavior.
  let RETRIEVAL_BUDGET_CHARS = 1800;
  try {
    const wfCompile = spawnSync(
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
    if (wfCompile.status === 0) {
      const wf = await import(pathToFileURL(resolveBuilt("webFetchTool.js")).href);
      if (typeof wf.RETRIEVAL_BUDGET_CHARS === "number") {
        RETRIEVAL_BUDGET_CHARS = wf.RETRIEVAL_BUDGET_CHARS;
      }
    }
  } catch {
    /* use default */
  }

  const {
    accumulateToolSources,
    buildCiteInstructionSuffix,
    makeToolCallKey,
    canonicalizeArgs,
    decideToolExecution,
    recordToolSuccess,
    recordToolFailure,
    citeKindForTool,
  } = ledger;

  // ── URL identity dedup (fragment / case / trailing slash) ──────────────
  {
    const acc = [];
    accumulateToolSources(acc, [
      { title: "First", url: "https://Example.COM/page#top", provider: "brave" },
    ]);
    const r2 = accumulateToolSources(acc, [
      { title: "Fetch should not win", url: "https://example.com/page/", provider: "fetch" },
    ]);
    check(
      "identity fragment+slash+case dedup",
      acc.length === 1 && r2.assigned[0] === 1 && acc[0].title === "First",
      `n=${acc.length} assigned=${r2.assigned}`,
    );
  }

  // ── Search assigned 1..2 ───────────────────────────────────────────────
  {
    const acc = [];
    const search = accumulateToolSources(acc, [
      { title: "A", url: "https://a.example/1" },
      { title: "B", url: "https://a.example/2" },
    ]);
    check("search assigned 1..2", search.assigned.join(",") === "1,2");
  }

  // ── Cite: search-alone byte-identical ──────────────────────────────────
  {
    const suffix = buildCiteInstructionSuffix([1, 2, 3, 4], en, "sources");
    const expected = `\n\n${en.errors.webSearchCiteInstruction}`;
    check("search-alone cite byte-identical", suffix === expected);
  }

  // ── Cite: fetch-only → passages [1] ────────────────────────────────────
  {
    const suffix = buildCiteInstructionSuffix([1], en, "passages");
    check(
      "fetch-only passages cite [1]",
      suffix.includes("[1]") &&
        suffix.includes(en.errors.webFetchCiteInstruction.replace("{index}", "1").slice(0, 30)) &&
        !suffix.includes(en.errors.webSearchCiteInstruction.slice(0, 40)),
      suffix.slice(0, 160),
    );
  }

  // ── Cite: fetch of search #1 (assigned [1]) is still passages, not plain ─
  {
    const suffix = buildCiteInstructionSuffix([1], en, "passages");
    const plain = `\n\n${en.errors.webSearchCiteInstruction}`;
    check(
      "fetch-of-result-1 not plain search cite",
      suffix !== plain && /\[1\]/.test(suffix),
    );
  }

  // ── Cite: fetch introducing source #5 ──────────────────────────────────
  {
    const suffix = buildCiteInstructionSuffix([5], en, "passages");
    const expected = `\n\n${en.errors.webFetchCiteInstruction.replace("{index}", "5")}`;
    check("fetch source #5 passages cite", suffix === expected, suffix.slice(0, 120));
  }

  // ── Multi-source passages → mapped fallback ────────────────────────────
  {
    const suffix = buildCiteInstructionSuffix([3, 7], en, "passages");
    check(
      "multi passages mapped fallback",
      suffix.includes("1→[3]") && suffix.includes("2→[7]"),
    );
  }

  // ── citeKindForTool ────────────────────────────────────────────────────
  check("citeKind web_fetch", citeKindForTool("web_fetch") === "passages");
  check("citeKind web_search", citeKindForTool("web_search") === "sources");

  // ── URL-less append ────────────────────────────────────────────────────
  {
    const acc = [];
    accumulateToolSources(acc, [{ title: "A" }]);
    accumulateToolSources(acc, [{ title: "B" }]);
    check("url-less both append", acc.length === 2);
  }

  // ── Call key: order independence ───────────────────────────────────────
  {
    const k1 = makeToolCallKey("web_fetch", { url: "https://a.com", query: "q" });
    const k2 = makeToolCallKey("web_fetch", { query: "q", url: "https://a.com" });
    check("call key order-independent", k1 === k2, `${k1} vs ${k2}`);
  }

  // ── Call key: malformed args distinct ──────────────────────────────────
  {
    const kA = makeToolCallKey("web_fetch", {}, { parseFailed: true, rawArguments: "{not json A" });
    const kB = makeToolCallKey("web_fetch", {}, { parseFailed: true, rawArguments: "{not json B" });
    const kEmpty = makeToolCallKey("web_fetch", {});
    check("malformed args distinct", kA !== kB && kA !== kEmpty);
  }

  // ── Budget: failure → retry allowed; success → blocked ─────────────────
  {
    const state = { executions: 0, successfulKeys: new Set() };
    const max = 3;
    const d1 = decideToolExecution(state, max, "web_fetch", { url: "https://a.com", query: "q" });
    check("first decision execute", d1.action === "execute");
    recordToolFailure(state);
    check("after failure executions=1", state.executions === 1 && state.successfulKeys.size === 0);
    const d2 = decideToolExecution(state, max, "web_fetch", { url: "https://a.com", query: "q" });
    check("failure→retry allowed", d2.action === "execute");
    recordToolSuccess(state, d2.key);
    const d3 = decideToolExecution(state, max, "web_fetch", { url: "https://a.com", query: "q" });
    check("success→retry blocked", d3.action === "skip_dup");
  }

  // ── Budget cap ─────────────────────────────────────────────────────────
  {
    const state = { executions: 0, successfulKeys: new Set() };
    const max = 3;
    for (let i = 0; i < 3; i++) {
      const d = decideToolExecution(state, max, "web_search", { query: `q${i}` });
      check(`budget exec ${i}`, d.action === "execute");
      recordToolSuccess(state, d.key);
    }
    const over = decideToolExecution(state, max, "web_search", { query: "more" });
    check("budget cap respected", over.action === "skip_cap" && state.executions === 3);
  }

  // ── Suffix length vs real retrieval budget ─────────────────────────────
  {
    const assigned = Array.from({ length: 20 }, (_, i) => i + 50);
    const suffix = buildCiteInstructionSuffix(assigned, en, "sources");
    check("worst-case suffix ≤ 700", suffix.length <= 700, `len=${suffix.length}`);
    // TOOL_RESULT_MAX_CHARS is 2500 in LlamaService; keep headroom for use-rule.
    const TOOL_RESULT_MAX_CHARS = 2500;
    check(
      "retrieval budget + suffix under tool result max",
      RETRIEVAL_BUDGET_CHARS + suffix.length < TOOL_RESULT_MAX_CHARS,
      `budget=${RETRIEVAL_BUDGET_CHARS} total=${RETRIEVAL_BUDGET_CHARS + suffix.length}`,
    );
  }

  check("canonicalize sorts keys", JSON.stringify(canonicalizeArgs({ b: 1, a: 2 })) === JSON.stringify({ a: 2, b: 1 }));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
