/**
 * Harness for src/engine/thinkStream.ts (Qwen3.5 think-tag stream cleaner +
 * round-end arbitration).
 *
 * Covers:
 *  - leading closed / truncated think blocks
 *  - split tags across deltas
 *  - FIELD degenerate multi-open loop
 *  - exactly one mid-text literal unclosed open (kept verbatim at finalize)
 *  - mid-text closed pair strip
 *  - trailing partial <thi (F4)
 *  - partial-close-then-open adjacency (F6)
 *  - multi-round state reset
 *
 * Exit 1 on any failure.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "../..");

function compile() {
  const r = spawnSync(
    "npx",
    [
      "tsc",
      "src/engine/thinkStream.ts",
      "src/engine/toolCallParser.ts",
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

function resolveBuilt() {
  const candidates = [
    path.join(projectRoot, "scripts/.build/thinkStream.js"),
    path.join(projectRoot, "scripts/.build/engine/thinkStream.js"),
    path.join(projectRoot, "scripts/.build/src/engine/thinkStream.js"),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  console.error("Could not find compiled thinkStream.js. Tried:\n", candidates.join("\n"));
  process.exit(1);
}

/** Feed deltas through cleanDelta; return { stream, final } with finalize(raw). */
function runRound(createCleaner, deltas, rawFull) {
  const cleaner = createCleaner();
  let stream = "";
  for (const d of deltas) {
    stream += cleaner.cleanDelta(d);
  }
  const raw = rawFull !== undefined ? rawFull : deltas.join("");
  const final = cleaner.finalize(raw);
  return { stream, final };
}

async function main() {
  console.log("Compiling thinkStream.ts …");
  compile();
  const modPath = resolveBuilt();
  console.log("Loading", modPath);
  const mod = await import(`${pathToFileURL(modPath).href}?t=${Date.now()}`);
  const { createThinkStreamCleaner, THINK_OPEN, THINK_CLOSE } = mod;

  const results = [];
  const check = (label, cond, detail) => {
    results.push({ label, pass: Boolean(cond), detail });
  };

  // ── 1. Leading closed think block ──────────────────────────────────────
  {
    const raw = "\n\n  <think>\nreasoning\n</think>\nHello world";
    const { stream, final } = runRound(createThinkStreamCleaner, [raw]);
    check("leading closed: final has reply", final.includes("Hello world"), JSON.stringify(final));
    check(
      "leading closed: no think tags in final",
      !final.includes(THINK_OPEN) && !final.includes(THINK_CLOSE),
      JSON.stringify(final),
    );
    // Leading whitespace before <think> is consumed; the \n after </think> is content.
    check(
      "leading closed: exact final is post-close body (leading ws stripped)",
      final === "\nHello world",
      JSON.stringify(final),
    );
    check(
      "leading closed: stream has reply, no think",
      stream.includes("Hello world") && !stream.includes(THINK_OPEN),
      JSON.stringify(stream),
    );
  }

  // ── 2. Leading truncated think → empty final (not whitespace-only) ─────
  {
    const deltas = ["\n\n", "  ", "<think>", "co"];
    const { stream, final } = runRound(createThinkStreamCleaner, deltas);
    check("leading truncated: stream empty", stream === "", JSON.stringify(stream));
    check("leading truncated: final empty (not ws-only)", final === "", JSON.stringify(final));
  }

  // ── 3. Split tags across deltas ────────────────────────────────────────
  {
    const deltas = ["Hi ", "<th", "ink>", "secret", "</th", "ink>", " bye"];
    const raw = deltas.join("");
    const { stream, final } = runRound(createThinkStreamCleaner, deltas, raw);
    check(
      "split tags: stream has Hi + bye, no think content",
      stream.includes("Hi") && stream.includes("bye") && !stream.includes("secret") && !stream.includes(THINK_OPEN),
      JSON.stringify(stream),
    );
    check(
      "split tags: final clean",
      final.includes("Hi") && final.includes("bye") && !final.includes("secret") && !final.includes(THINK_OPEN),
      JSON.stringify(final),
    );
  }

  // ── 4. FIELD degenerate: ≥2 unclosed bare <think> ──────────────────────
  {
    // Interleaved answer prefixes + bare opens, no closes (field bug shape).
    const raw =
      "Answer: yes\n<think>\nAnswer: yes\n<think>\nAnswer: yes\n<think>\nAnswer: yes";
    const deltas = raw.split(/(?=<think>)/); // rough chunking
    const { final } = runRound(createThinkStreamCleaner, deltas.length > 1 ? deltas : [raw], raw);
    check(
      "FIELD degenerate: no <think> in final",
      !final.includes(THINK_OPEN) && !final.includes(THINK_CLOSE),
      JSON.stringify(final),
    );
    check(
      "FIELD degenerate: strip from first open (no duplicated-prefix garbage after)",
      final === "Answer: yes\n",
      JSON.stringify(final),
    );
  }

  // ── 5. Exactly one mid-text literal unclosed <think> → keep verbatim ───
  {
    const raw = "Use the <think> tag to reason.";
    const { stream, final } = runRound(createThinkStreamCleaner, [raw]);
    check(
      "single mid-text unclosed: final preserves tag verbatim",
      final === raw,
      JSON.stringify(final),
    );
    // Stream is conservative: holds after open (pop-in at finalize is designed).
    check(
      "single mid-text unclosed: stream holds after open (prefix only)",
      stream === "Use the " && !stream.includes(THINK_OPEN),
      JSON.stringify(stream),
    );
  }

  // ── 5b. Single bare trailing open (truncation) → strip from open ───────
  {
    const raw = "Answer: yes\n<think>";
    const { stream, final } = runRound(createThinkStreamCleaner, [raw]);
    check(
      "trailing bare open: final strips open (truncation, not literal)",
      final === "Answer: yes\n" && !final.includes(THINK_OPEN),
      JSON.stringify(final),
    );
    check(
      "trailing bare open: stream holds after open",
      stream === "Answer: yes\n" && !stream.includes(THINK_OPEN),
      JSON.stringify(stream),
    );
  }
  {
    const raw = "Answer: yes\n<think>   \n";
    const { final } = runRound(createThinkStreamCleaner, [raw]);
    check(
      "trailing open + ws only: final strips open",
      final === "Answer: yes\n" && !final.includes(THINK_OPEN),
      JSON.stringify(final),
    );
  }

  // ── 6. Mid-text closed pair → stripped ─────────────────────────────────
  {
    const raw = "Before <think>hidden</think> after";
    const { stream, final } = runRound(createThinkStreamCleaner, [raw]);
    check(
      "mid-text closed: stripped in final",
      final === "Before  after" || final === "Before after",
      JSON.stringify(final),
    );
    check(
      "mid-text closed: no tags in final",
      !final.includes(THINK_OPEN) && !final.includes(THINK_CLOSE) && !final.includes("hidden"),
      JSON.stringify(final),
    );
    check(
      "mid-text closed: stream clean",
      stream.includes("Before") && stream.includes("after") && !stream.includes("hidden"),
      JSON.stringify(stream),
    );
  }

  // ── 7. Trailing partial <thi at round end (F4) ─────────────────────────
  {
    const deltas = ["hello", "<thi"];
    const raw = "hello<thi";
    const { stream, final } = runRound(createThinkStreamCleaner, deltas, raw);
    check("F4 partial open: stream is hello", stream === "hello", JSON.stringify(stream));
    check("F4 partial open: final has no <thi", final === "hello" && !final.includes("<thi"), JSON.stringify(final));
  }

  // ── 8. Partial close then open adjacency (F6) ──────────────────────────
  {
    const deltas = ["abc", "</th", "<think>", "def", "ghi"];
    // No close ever — ≥1 unclosed; with only one open, finalize keeps from open
    // (body after open is non-ws → literal-style keep). Stream must not leak "</th".
    const raw = deltas.join("");
    const { stream, final } = runRound(createThinkStreamCleaner, deltas, raw);
    check("F6: stream has no </th leak", !stream.includes("</th"), JSON.stringify(stream));
    check("F6: stream prefix is abc", stream === "abc", JSON.stringify(stream));
    check(
      "F6: stream does not show think body",
      !stream.includes("def") && !stream.includes("ghi"),
      JSON.stringify(stream),
    );
    // Single unclosed open + non-ws body after it → indistinguishable from a
    // literal mention ("Use <think> tags"), so finalize keeps it VERBATIM
    // (accepted pop-in). Stream stayed clean ("abc"); final is the raw text.
    // The </th is likewise not swept (would corrupt real HTML </th>/</thead>).
    check("F6: final keeps verbatim (literal-mention policy)", final === raw, JSON.stringify(final));
  }

  // ── 8b. Partial close BEFORE a *closed* think pair (F3 with-close) ─────
  // Documented trade-off: the closed pair IS stripped (no think leak), but the
  // detached "</th" fragment is NOT swept mid-string (see arbitrateThinkTags).
  {
    const raw = "x</th<think>y</think>z";
    const { stream, final } = runRound(createThinkStreamCleaner, [raw]);
    check("F3 with-close single: stream clean", stream === "xz", JSON.stringify(stream));
    check(
      "F3 with-close single: pair stripped, no full think tags",
      final === "x</thz" && !final.includes(THINK_OPEN) && !final.includes(THINK_CLOSE),
      JSON.stringify(final),
    );
  }

  // ── 8c. Real HTML close tags must survive finalize (no </th eating) ───────
  {
    for (const [name, raw] of [
      ["th", "Row: <th>Name</th> done"],
      ["thead", "Table <thead>head</thead> end"],
      ["bare th close", "cell</th>"],
    ]) {
      const { final } = runRound(createThinkStreamCleaner, [raw]);
      check(`HTML ${name} preserved verbatim`, final === raw, JSON.stringify(final));
    }
  }

  // ── 9. Multiple rounds: state resets ───────────────────────────────────
  {
    const c1 = createThinkStreamCleaner();
    // Round 1: enter think and leave mid-block
    let s1 = c1.cleanDelta("<think>secret");
    const f1 = c1.finalize("<think>secret");
    check("round1: stream empty inside think", s1 === "", JSON.stringify(s1));
    check("round1: final empty (leading truncated)", f1 === "", JSON.stringify(f1));

    // Fresh cleaner for round 2 (LlamaService creates a new instance per round)
    const c2 = createThinkStreamCleaner();
    let s2 = c2.cleanDelta("plain answer");
    const f2 = c2.finalize("plain answer");
    check("round2: stream is plain (no stale insideThink)", s2 === "plain answer", JSON.stringify(s2));
    check("round2: final is plain", f2 === "plain answer", JSON.stringify(f2));
  }

  // ── 10. Split open only: <th + ink> mid-text closed ────────────────────
  {
    const deltas = ["x", "<th", "ink>", "y", "</th", "ink>", "z"];
    const raw = deltas.join("");
    const { final } = runRound(createThinkStreamCleaner, deltas, raw);
    check(
      "split open/close mid-text: final is xz-ish without y",
      final === "xz" || final === "x z" || (final.includes("x") && final.includes("z") && !final.includes("y") && !final.includes(THINK_OPEN)),
      JSON.stringify(final),
    );
  }

  // Report
  let failed = 0;
  for (const r of results) {
    const mark = r.pass ? "PASS" : "FAIL";
    if (!r.pass) failed += 1;
    console.log(`${mark}: ${r.label}${r.detail !== undefined && !r.pass ? " — " + r.detail : ""}`);
  }
  console.log(`\n${results.length - failed}/${results.length} passed`);
  if (failed > 0) process.exit(1);
  console.log("thinkStripperHarness: OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
