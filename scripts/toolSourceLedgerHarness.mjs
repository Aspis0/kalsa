/**
 * Harness for src/agent/toolSourceLedger.ts (source accumulation + cite suffix).
 * Pure module — no RN, no LlamaService.
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
    path.join(projectRoot, "scripts/.build/agent/toolSourceLedger.js"),
    path.join(projectRoot, "scripts/.build/src/agent/toolSourceLedger.js"),
    path.join(projectRoot, "scripts/.build/toolSourceLedger.js"),
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
      "src/agent/toolSourceLedger.ts",
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

async function main() {
  console.log("Compiling toolSourceLedger + en/it …");
  compile();
  const ledgerPath = resolveBuilt("toolSourceLedger.js");
  const enPath = resolveBuilt("en.js");
  const { accumulateToolSources, buildCiteInstructionSuffix } = await import(
    pathToFileURL(ledgerPath).href
  );
  const { en } = await import(pathToFileURL(enPath).href);

  // ── Duplicate URL across search+fetch: first title wins, [K] = first index ──
  {
    const acc = [];
    const search = accumulateToolSources(acc, [
      { title: "First Title", url: "https://example.com/a", provider: "brave" },
      { title: "Other", url: "https://example.com/b", provider: "brave" },
    ]);
    check(
      "search assigned 1..2",
      search.assigned.join(",") === "1,2" && acc.length === 2,
    );
    const fetchDup = accumulateToolSources(acc, [
      {
        title: "FETCH SHOULD NOT WIN",
        url: "https://example.com/a",
        provider: "fetch",
      },
    ]);
    check(
      "dup URL assigned points at first index",
      fetchDup.assigned.length === 1 &&
        fetchDup.assigned[0] === 1 &&
        acc.length === 2,
      `assigned=${fetchDup.assigned}`,
    );
    check(
      "dup URL first title wins",
      acc[0].title === "First Title" && acc[0].provider === "brave",
    );
  }

  // ── URL-less sources always append ─────────────────────────────────────
  {
    const acc = [];
    const r1 = accumulateToolSources(acc, [{ title: "NoUrl A" }]);
    const r2 = accumulateToolSources(acc, [{ title: "NoUrl B" }]);
    check(
      "url-less appends both",
      acc.length === 2 &&
        r1.assigned[0] === 1 &&
        r2.assigned[0] === 2 &&
        acc[0].title === "NoUrl A" &&
        acc[1].title === "NoUrl B",
    );
  }

  // ── Fetch-after-search offsets ─────────────────────────────────────────
  {
    const acc = [];
    accumulateToolSources(acc, [
      { title: "S1", url: "https://a.example/1" },
      { title: "S2", url: "https://a.example/2" },
      { title: "S3", url: "https://a.example/3" },
      { title: "S4", url: "https://a.example/4" },
    ]);
    const fetch = accumulateToolSources(acc, [
      { title: "Page", url: "https://a.example/page", provider: "fetch" },
    ]);
    check(
      "fetch-after-search assigned [5]",
      fetch.assigned.join(",") === "5" && acc.length === 5,
    );
    const mapped = buildCiteInstructionSuffix(fetch.assigned, en);
    check(
      "fetch-after-search mapped cite",
      mapped.includes("1→[5]") &&
        mapped.includes(en.errors.webToolCiteInstructionMapped.split("{mapping}")[0].slice(0, 20)),
      mapped.slice(0, 120),
    );
  }

  // ── Byte-identical suffix for search-alone (contiguous 1..n) ───────────
  {
    const assigned = [1, 2, 3, 4];
    const suffix = buildCiteInstructionSuffix(assigned, en);
    const expected = `\n\n${en.errors.webSearchCiteInstruction}`;
    check(
      "search-alone cite byte-identical",
      suffix === expected,
      `len ${suffix.length} vs ${expected.length}`,
    );
  }

  // ── Empty assigned → empty suffix ──────────────────────────────────────
  check("empty assigned empty suffix", buildCiteInstructionSuffix([], en) === "");

  // ── Worst-case suffix length ≤ 700 ─────────────────────────────────────
  {
    // Pathological: 20 sources mapped to high indices with long mapping string
    const assigned = Array.from({ length: 20 }, (_, i) => i + 50);
    const suffix = buildCiteInstructionSuffix(assigned, en);
    check(
      "worst-case suffix ≤ 700",
      suffix.length <= 700,
      `len=${suffix.length}`,
    );
    // budget 1800 + suffix under TOOL_RESULT_MAX_CHARS 2500
    check(
      "1800 + suffix < 2500",
      1800 + suffix.length < 2500,
      `total=${1800 + suffix.length}`,
    );
  }

  // ── Empty incoming ─────────────────────────────────────────────────────
  {
    const acc = [{ title: "x", url: "https://x.com" }];
    const r = accumulateToolSources(acc, undefined);
    check("undefined incoming no-op", r.assigned.length === 0 && acc.length === 1);
    const r2 = accumulateToolSources(acc, []);
    check("empty incoming no-op", r2.assigned.length === 0 && acc.length === 1);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
