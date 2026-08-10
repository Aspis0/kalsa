#!/usr/bin/env node
/**
 * Offline harness for scripts/benchGrade.mjs.
 *
 * Builds raw.json + turn sidecars in a temp dir, calls exported grader
 * functions directly, asserts probe families / token boundaries / think
 * stripping / sidecars / compactionActive / recall isolation.
 *
 * Zero npm deps. Exit 1 on any failure.
 */
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let passed = 0;
let failed = 0;

function check(name, cond, detail = "") {
  if (cond) {
    console.log(`PASS  ${name}`);
    passed += 1;
  } else {
    console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
    failed += 1;
  }
}

// ── Fixture helpers ─────────────────────────────────────────────────────

function baseRaw(overrides = {}) {
  return {
    schema: 2,
    phase: "fase4",
    arm: "v42",
    seed: 1,
    blockFormat: "none",
    thinking: "budget256",
    compaction: "on",
    compactionPrefRaw: "1",
    // Seeded Italian: matches ci-bench set_prefs (kalsa.locale=it). Override
    // to ""/"en"/absent only when testing the locale-confounder note.
    localePrefRaw: "it",
    model: { dir: "qwen3.5-2b", file: "Qwen3.5-2B-Q4_K_M.gguf" },
    facts: ["Leopoldo", "4500"],
    fillerRotation: 0,
    turns: [],
    historyChars: 100,
    ...overrides,
  };
}

function turn(index, id, reply, extra = {}) {
  return {
    index,
    kind: id.startsWith("probe") ? "probe" : id.startsWith("filler") ? "filler" : "plant",
    id,
    prompt: `prompt for ${id}`,
    elapsed_s: 10,
    reply,
    replyLen: String(reply).length,
    sources: 0,
    hasMiniapp: false,
    ...extra,
  };
}

function writeSidecar(dir, turnIndex, { telemetry, loadprompt, promptMeta } = {}) {
  const tdir = path.join(dir, `turn${turnIndex}`);
  mkdirSync(tdir, { recursive: true });
  if (telemetry !== undefined) {
    const lines = Array.isArray(telemetry)
      ? telemetry.map((o) => JSON.stringify(o)).join("\n") + "\n"
      : String(telemetry);
    writeFileSync(path.join(tdir, "telemetry.jsonl"), lines);
  }
  if (loadprompt !== undefined) {
    writeFileSync(path.join(tdir, "loadprompt.txt"), loadprompt);
  }
  if (promptMeta !== undefined) {
    writeFileSync(path.join(tdir, "prompt_meta.txt"), promptMeta);
  }
}

function writeRaw(dir, raw) {
  writeFileSync(path.join(dir, "raw.json"), JSON.stringify(raw, null, 2));
}

function findProbe(result, name) {
  return (result.probes ?? []).find((p) => p.name === name);
}

function findFamily(result, family) {
  return (result.probes ?? []).filter((p) => p.family === family);
}

const VALID_MINIAPP_FENCE = `\`\`\`json
{"schema":"miniapp_v1","kind":"test","title":"Test","blocks":[{"type":"text","title":"Hi"}]}
\`\`\``;

// ── Main ────────────────────────────────────────────────────────────────

async function main() {
  const modPath = path.join(__dirname, "benchGrade.mjs");
  const {
    stripThink,
    matchesFact,
    isCompactionActive,
    gradeRaw,
    gradeFile,
  } = await import(pathToFileURL(modPath).href);

  const tmp = mkdtempSync(path.join(tmpdir(), "benchGrade-"));
  console.log("temp dir:", tmp);

  try {
    // ── 1. Escaped-quote regression (run 30863711482) ─────────────────
    {
      const reply =
        `I don't have specific information about a product called "Gatto Leopoldo Budget4500" in my knowledge base.`;
      const raw = baseRaw({
        facts: ["Leopoldo", "4500"],
        turns: [turn(1, "probe_facts", reply)],
      });
      writeRaw(tmp, raw);
      const result = gradeRaw(raw, tmp);
      const leo = findProbe(result, "fact_Leopoldo");
      const num = findProbe(result, "fact_4500");
      check(
        "run 30863711482 escaped-quote: Leopoldo FOUND",
        leo?.found === true,
        `got ${leo?.found}`,
      );
      check(
        "run 30863711482 escaped-quote: 4500 FOUND",
        num?.found === true,
        `got ${num?.found}`,
      );
    }

    // ── 2. Token boundaries (both rules) ──────────────────────────────
    {
      check("XR9 does NOT match XR90", matchesFact("XR90", "XR9") === false);
      check("PK42 does NOT match PK420", matchesFact("PK420", "PK42") === false);
      check("4500 matches Budget4500", matchesFact("Budget4500", "4500") === true);
      check("4500 does NOT match 145000", matchesFact("145000", "4500") === false);
      check("4500 does NOT match A4500Z", matchesFact("A4500Z", "4500") === false);
      check("4500 does NOT match 4500th", matchesFact("4500th", "4500") === false);
      check("case-insensitive leopoldo", matchesFact("leopoldo", "Leopoldo") === true);
      check("Leopoldo does NOT match Leopoldone", matchesFact("Leopoldone", "Leopoldo") === false);
    }

    // ── 3. Think-stripping ────────────────────────────────────────────
    {
      check(
        "fact only inside <think> does not count",
        matchesFact(stripThink("<think>Leopoldo secret</think> nothing here"), "Leopoldo") === false,
      );
      check(
        "unclosed <think> swallows rest",
        stripThink("before <think>Leopoldo after").includes("Leopoldo") === false,
      );
      check(
        "unclosed <think> keeps prefix",
        stripThink("visible <think>hidden").trim() === "visible",
      );
      // Nested: outer open, inner closed, then outer tail — non-greedy regex
      // would close at first </think> and leak "Leopoldo outer" into graded text.
      const nested = stripThink(
        "<think>outer <think>inner</think> Leopoldo outer-tail</think> visible",
      );
      check(
        "nested <think>: outer tail stripped (depth-aware)",
        !nested.includes("Leopoldo") && nested.includes("visible"),
        `got ${JSON.stringify(nested)}`,
      );
      check(
        "<think > with space before > is stripped",
        stripThink("hi <think >secret Leopoldo</think > bye").trim() === "hi  bye" ||
          !stripThink("hi <think >secret Leopoldo</think > bye").includes("Leopoldo"),
        `got ${JSON.stringify(stripThink("hi <think >secret Leopoldo</think > bye"))}`,
      );
      const fenced = stripThink(
        "before\n```\n<think>Leopoldo in fence</think>\n```\nafter",
      );
      check(
        "<think> inside code fence is preserved",
        fenced.includes("Leopoldo in fence"),
        `got ${JSON.stringify(fenced)}`,
      );
      const raw = baseRaw({
        facts: ["Leopoldo"],
        turns: [
          turn(1, "probe_facts", "<think>Leopoldo is the answer</think> I forgot."),
        ],
      });
      const result = gradeRaw(raw, tmp);
      check(
        "grade: fact only in think → not found",
        findProbe(result, "fact_Leopoldo")?.found === false,
      );
    }

    // ── 4. Language probe ─────────────────────────────────────────────
    {
      const itReply = "Non so come sia andata, ma questo e della serie che non funziona nel modo previsto.";
      const enReply = "I do not know about this and that with more details from which we have results.";
      // Think text must OUTWEIGH the Italian body if stripThink is a no-op —
      // many English stopwords so a no-op strip would grade English (fail).
      const mixed =
        "<think>the and is are this that with for from have has which where because about more also of in to it as be was were can will there they the and is are this that with for from have has which where because about more also of in to it as be was were can will there they</think>\n" +
        "Ecco, il Brasile e nel continente sudamericano e questo e un fatto che non cambia.";

      const rIt = gradeRaw(
        baseRaw({ turns: [turn(1, "probe_language", itReply)] }),
        tmp,
      );
      const rEn = gradeRaw(
        baseRaw({ turns: [turn(1, "probe_language", enReply)] }),
        tmp,
      );
      const rMixed = gradeRaw(
        baseRaw({ turns: [turn(1, "probe_language", mixed)] }),
        tmp,
      );
      check("language: Italian reply passes", findProbe(rIt, "language")?.found === true);
      check("language: English reply fails", findProbe(rEn, "language")?.found === false);
      check(
        "language: English <think> + Italian answer still passes (strip must work)",
        findProbe(rMixed, "language")?.found === true,
      );

      const accented = gradeRaw(
        baseRaw({
          turns: [
            turn(
              1,
              "probe_language",
              "Perché il Brasile è in Sudamerica? Ecco, si trova in America.",
            ),
          ],
        }),
        tmp,
      );
      check(
        "language: accented Italian (perché/è) passes after NFD fold",
        findProbe(accented, "language")?.found === true,
      );

      const terse = gradeRaw(
        baseRaw({
          turns: [turn(1, "probe_language", "Sudamerica.")],
        }),
        tmp,
      );
      check(
        "language: terse answer grades false",
        findProbe(terse, "language")?.found === false,
      );
      check(
        "language: terse 0–0 adds note",
        (terse.notes ?? []).some((n) => /both stopword counts at zero/i.test(n)),
        `notes=${JSON.stringify(terse.notes)}`,
      );
    }

    // ── 5. Honesty probe ──────────────────────────────────────────────
    {
      const admit = "Non ho informazioni su questo premio inventato.";
      const invent = "The winner of the Aspis Grand Prize 2024 was Marco Rossi from Milano.";
      const rAdmit = gradeRaw(
        baseRaw({ turns: [turn(1, "probe_honesty", admit)] }),
        tmp,
      );
      const rInvent = gradeRaw(
        baseRaw({ turns: [turn(1, "probe_honesty", invent)] }),
        tmp,
      );
      check("honesty: admission passes", findProbe(rAdmit, "honesty")?.found === true);
      check("honesty: invented answer fails", findProbe(rInvent, "honesty")?.found === false);

      const enAdmit = "I don't have specific information about that prize.";
      const rEn = gradeRaw(
        baseRaw({ turns: [turn(1, "probe_honesty", enAdmit)] }),
        tmp,
      );
      check("honesty: EN admission passes", findProbe(rEn, "honesty")?.found === true);

      const nonSono = gradeRaw(
        baseRaw({
          turns: [turn(1, "probe_honesty", "Non sono un esperto di premi inventati ma posso inventare.")],
        }),
        tmp,
      );
      check(
        "honesty: 'non sono' does NOT match 'non so'",
        findProbe(nonSono, "honesty")?.found === false,
      );

      const riesco = gradeRaw(
        baseRaw({
          turns: [turn(1, "probe_honesty", "Non riesco a trovare informazioni su quel premio.")],
        }),
        tmp,
      );
      check(
        "honesty: 'non riesco a trovare' admits",
        findProbe(riesco, "honesty")?.found === true,
      );

      const admitThenName = gradeRaw(
        baseRaw({
          turns: [
            turn(
              1,
              "probe_honesty",
              "Non so chi abbia vinto, ma il vincitore e stato Mario Rossi.",
            ),
          ],
        }),
        tmp,
      );
      check(
        "honesty: admit-then-name-a-winner fails",
        findProbe(admitThenName, "honesty")?.found === false,
      );
    }

    // ── 6. Miniapp probe ──────────────────────────────────────────────
    {
      const withFence = gradeRaw(
        baseRaw({ turns: [turn(1, "probe_miniapp", `Here you go:\n${VALID_MINIAPP_FENCE}`)] }),
        tmp,
      );
      const prose = gradeRaw(
        baseRaw({ turns: [turn(1, "probe_miniapp", "Just prose, no miniapp JSON at all.")] }),
        tmp,
      );
      const flagOnly = gradeRaw(
        baseRaw({
          turns: [turn(1, "probe_miniapp", "no json here", { hasMiniapp: true })],
        }),
        tmp,
      );
      const emptyBlocks = gradeRaw(
        baseRaw({
          turns: [
            turn(
              1,
              "probe_miniapp",
              '```json\n{"schema":"miniapp_v1","kind":"t","title":"T","blocks":[]}\n```',
            ),
          ],
        }),
        tmp,
      );
      check("miniapp: valid fenced JSON passes", findProbe(withFence, "miniapp")?.found === true);
      check("miniapp: prose-only fails", findProbe(prose, "miniapp")?.found === false);
      check("miniapp: hasMiniapp true alone passes", findProbe(flagOnly, "miniapp")?.found === true);
      check(
        "miniapp: empty blocks[] fails",
        findProbe(emptyBlocks, "miniapp")?.found === false,
      );
    }

    // ── 7. Tool probe ─────────────────────────────────────────────────
    {
      const fail = gradeRaw(
        baseRaw({ turns: [turn(1, "probe_tool", "searching…", { sources: 0 })] }),
        tmp,
      );
      const pass = gradeRaw(
        baseRaw({ turns: [turn(1, "probe_tool", "found results", { sources: 2 })] }),
        tmp,
      );
      check("tool: sources 0 fails", findProbe(fail, "tool_call")?.found === false);
      check("tool: sources 2 passes", findProbe(pass, "tool_call")?.found === true);
    }

    // ── 8. Sidecars ───────────────────────────────────────────────────
    {
      const sideDir = path.join(tmp, "side");
      mkdirSync(sideDir, { recursive: true });
      const raw = baseRaw({
        turns: [
          turn(1, "plant_a", "ok"),
          turn(2, "probe_facts", "Leopoldo and 4500 recalled"),
        ],
        facts: ["Leopoldo", "4500"],
      });
      writeRaw(sideDir, raw);

      // turn1: two telemetry rounds same turnId; promptMs -1 on first, positive
      // on second. tokensEvaluated sum (100+50=150) is intentionally ≠ embd.size
      // so this case exercises the fallback path when loadprompt has no match
      // group — wait, better: make sum match embd.size=150 so attribution is clean.
      writeSidecar(sideDir, 1, {
        telemetry: [
          {
            turnId: 10,
            round: 1,
            tokensCached: 10,
            tokensEvaluated: 100,
            tokensPredicted: 20,
            draftTokens: 0,
            draftAccepted: 0,
            promptMs: -1,
            predictedMs: 50,
            predictedPerSecond: 5,
            contextFull: false,
            interrupted: false,
          },
          {
            turnId: 10,
            round: 2,
            tokensCached: 20,
            tokensEvaluated: 50,
            tokensPredicted: 30,
            draftTokens: 0,
            draftAccepted: 0,
            promptMs: 200,
            predictedMs: 100,
            predictedPerSecond: 12,
            contextFull: false,
            interrupted: false,
          },
        ],
        // Two Input processed lines → completions=2 (chat + background job).
        // First embd.size=150 matches tokensEvaluated sum above.
        loadprompt:
          "foo Input processed: n_past=40, embd.size=150, bar\n" +
          "Input processed: n_past=40, embd.size=999\n" +
          "restored state checkpoint: reusing 40/150 prompt tokens\n",
        promptMeta: "reused=40 total=150\nreused=40 total=999\n",
      });
      // turn2: no sidecar dir at all

      const result = gradeRaw(raw, sideDir);
      const t1 = result.turns.find((t) => t.index === 1);
      const t2 = result.turns.find((t) => t.index === 2);

      check(
        "sidecar: promptMs -1 excluded; only positive summed → 200",
        t1?.promptMs === 200,
        `got ${t1?.promptMs}`,
      );
      check(
        "sidecar: predictedMs sums positive rounds → 150",
        t1?.predictedMs === 150,
        `got ${t1?.predictedMs}`,
      );
      // turnComputeMs = Σ(promptMs+predictedMs) skipping neg: 200+50+100 = 350
      // (promptMs -1 on round1 skipped). Evidence: run 31358530713 labelling.
      check(
        "turnComputeMs sums prefill+decode across rounds → 350",
        t1?.turnComputeMs === 350,
        `got ${t1?.turnComputeMs}`,
      );
      check(
        "turnComputeMs null with no telemetry (turn2)",
        t2?.turnComputeMs === null,
        `got ${t2?.turnComputeMs}`,
      );
      // ttftApprox_s mirrors elapsed_s (UI TTFT, not turn duration).
      check(
        "ttftApprox_s mirrors elapsed_s",
        t1?.ttftApprox_s === t1?.elapsed_s && t1?.elapsed_s === 10,
        `ttft=${t1?.ttftApprox_s} elapsed=${t1?.elapsed_s}`,
      );
      // settled_s null when raw.json lacks it (running campaign shape).
      check(
        "settled_s null when raw.json lacks it",
        t1?.settled_s === null && t2?.settled_s === null,
        `t1=${t1?.settled_s} t2=${t2?.settled_s}`,
      );
      check(
        "sidecar: tokensEvaluated sums → 150",
        t1?.tokensEvaluated === 150,
        `got ${t1?.tokensEvaluated}`,
      );
      check(
        "sidecar: predictedPerSecond from LAST round → 12",
        t1?.predictedPerSecond === 12,
        `got ${t1?.predictedPerSecond}`,
      );
      check("sidecar: rounds === 2", t1?.rounds === 2, `got ${t1?.rounds}`);
      check("sidecar: reusedTokens === 40", t1?.reusedTokens === 40);
      check("sidecar: promptTokens === 150", t1?.promptTokens === 150);
      check(
        "sidecar: reuseFrac === 40/150",
        t1?.reuseFrac === 40 / 150,
        `got ${t1?.reuseFrac}`,
      );
      check(
        "sidecar: completions === 2 (two Input processed lines)",
        t1?.completions === 2,
        `got ${t1?.completions}`,
      );
      // No promptSha* — smoke run 31358530713 proved hashes were meaningless.
      check(
        "sidecar: no promptSha256 on turn metrics",
        t1?.promptSha256 === undefined &&
          !Object.prototype.hasOwnProperty.call(t1 ?? {}, "promptSha256"),
      );
      check(
        "positiveControl: no promptSha* keys",
        result.positiveControl != null &&
          !Object.prototype.hasOwnProperty.call(
            result.positiveControl,
            "promptShaByTurn",
          ) &&
          !Object.keys(result.positiveControl).some((k) =>
            k.toLowerCase().includes("sha"),
          ),
        `keys=${Object.keys(result.positiveControl ?? {}).join(",")}`,
      );
      check(
        "positiveControl: promptTokensByTurn + completionsByTurn + reused + chars",
        result.positiveControl?.promptTokensByTurn?.["1"] === 150 &&
          result.positiveControl?.reusedTokensByTurn?.["1"] === 40 &&
          result.positiveControl?.completionsByTurn?.["1"] === 2 &&
          result.positiveControl?.compactorChars === 0 &&
          result.positiveControl?.summaryChars === 0,
        `pc=${JSON.stringify(result.positiveControl)}`,
      );
      // Positive control: real telemetry yields a real number (grader that always
      // returns null cannot pass both this and the null-missing-dir cases).
      check(
        "sidecar: positive control promptMs is a finite number",
        typeof t1?.promptMs === "number" && Number.isFinite(t1.promptMs),
        `got ${t1?.promptMs}`,
      );

      check(
        "sidecar: missing turn2 dir → null promptMs",
        t2?.promptMs === null,
        `got ${t2?.promptMs}`,
      );
      check(
        "sidecar: missing turn2 dir → null rounds",
        t2?.rounds === null,
      );
      check(
        'note: "no telemetry sidecar found for N turn(s)"',
        (result.notes ?? []).some((n) =>
          /no telemetry sidecar found for \d+ turn\(s\)/.test(n),
        ),
        `notes=${JSON.stringify(result.notes)}`,
      );
    }

    // ── 8b. telemetry attribution by embd.size match (not first group) ─
    {
      const d = path.join(tmp, "tid");
      mkdirSync(d, { recursive: true });
      const raw = baseRaw({ turns: [turn(1, "plant_a", "ok")] });
      // First group (lowest turnId=5) has tokensEvaluated=10; chat is turnId=99
      // with tokensEvaluated=999 matching embd.size. Attribution must pick 99.
      writeSidecar(d, 1, {
        telemetry: [
          {
            turnId: 5,
            round: 1,
            tokensEvaluated: 10,
            tokensPredicted: 5,
            promptMs: 100,
            predictedMs: 50,
            predictedPerSecond: 8,
          },
          {
            turnId: 99,
            round: 1,
            tokensEvaluated: 999,
            tokensPredicted: 99,
            promptMs: 9999,
            predictedMs: 9999,
            predictedPerSecond: 1,
          },
        ],
        loadprompt: "Input processed: n_past=0, embd.size=999\n",
        promptMeta: "reused=0 total=999\n",
      });
      const result = gradeRaw(raw, d);
      const t1 = result.turns[0];
      check(
        "telemetry attr: picks group matching embd.size, not lowest turnId",
        t1.promptMs === 9999,
        `got ${t1.promptMs}`,
      );
      check(
        "telemetry attr: extraCompletions === 1",
        t1.extraCompletions === 1,
        `got ${t1.extraCompletions}`,
      );
      check(
        "telemetry attr: no fallback note when match found",
        !(result.notes ?? []).some((n) => /attribution fell back/i.test(n)),
        `notes=${JSON.stringify(result.notes)}`,
      );
    }

    // ── 8c. telemetry attribution fallback when nothing matches ───────
    {
      const d = path.join(tmp, "tid-fb");
      mkdirSync(d, { recursive: true });
      const raw = baseRaw({ turns: [turn(3, "filler_1", "ok")] });
      writeSidecar(d, 3, {
        telemetry: [
          {
            turnId: 1,
            round: 1,
            tokensEvaluated: 10,
            tokensPredicted: 5,
            promptMs: 111,
            predictedMs: 50,
            predictedPerSecond: 8,
          },
          {
            turnId: 2,
            round: 1,
            tokensEvaluated: 20,
            tokensPredicted: 5,
            promptMs: 222,
            predictedMs: 50,
            predictedPerSecond: 8,
          },
        ],
        loadprompt: "Input processed: n_past=0, embd.size=777\n",
        promptMeta: "reused=0 total=777\n",
      });
      const result = gradeRaw(raw, d);
      const t1 = result.turns[0];
      check(
        "telemetry fallback: first group (promptMs 111)",
        t1.promptMs === 111,
        `got ${t1.promptMs}`,
      );
      check(
        "telemetry fallback: note names turn index",
        (result.notes ?? []).some(
          (n) =>
            /turn 3: telemetry attribution fell back to first group/i.test(n),
        ),
        `notes=${JSON.stringify(result.notes)}`,
      );
    }

    // ── 8d. positiveControl pulls compactorState from raw.json ────────
    {
      const d = path.join(tmp, "pc-state");
      mkdirSync(d, { recursive: true });
      const raw = baseRaw({
        turns: [turn(1, "plant_a", "ok")],
        compactorState: { compactorChars: 420, summaryChars: 88 },
      });
      writeSidecar(d, 1, {
        loadprompt: "Input processed: n_past=0, embd.size=100\n",
        promptMeta: "reused=0 total=100\n",
      });
      const result = gradeRaw(raw, d);
      check(
        "positiveControl: compactorChars/summaryChars from raw.compactorState",
        result.positiveControl?.compactorChars === 420 &&
          result.positiveControl?.summaryChars === 88,
        `pc=${JSON.stringify(result.positiveControl)}`,
      );
    }

    // ── 9. compactionActive ───────────────────────────────────────────
    {
      check('compactionActive "0" → false', isCompactionActive("0") === false);
      check('compactionActive "on" → false', isCompactionActive("on") === false);
      check('compactionActive "" → false', isCompactionActive("") === false);
      check('compactionActive "1" → true', isCompactionActive("1") === true);
      check('compactionActive "true" → true', isCompactionActive("true") === true);

      const mismatch = gradeRaw(
        baseRaw({
          compaction: "on",
          compactionPrefRaw: "0",
          turns: [turn(1, "probe_facts", "Leopoldo")],
          facts: ["Leopoldo"],
        }),
        tmp,
      );
      check("compactionActive field false for pref 0", mismatch.compactionActive === false);
      check(
        "mismatch note fires when arm on but pref disabled",
        (mismatch.notes ?? []).some((n) =>
          n.includes("which the app reads as DISABLED"),
        ),
        `notes=${JSON.stringify(mismatch.notes)}`,
      );

      const ok = gradeRaw(
        baseRaw({
          compaction: "on",
          compactionPrefRaw: "1",
          turns: [turn(1, "probe_facts", "Leopoldo")],
          facts: ["Leopoldo"],
        }),
        tmp,
      );
      check("no mismatch note when pref 1 and arm on", !(ok.notes ?? []).some((n) =>
        n.includes("which the app reads as DISABLED"),
      ));
    }

    // ── 9b. localePrefRaw pass-through + confounder note ──────────────
    // Evidence: run 31379031892 language 6/6 baseline vs 2/5 v42 was the
    // harness locale confounder (en operative block vs Italian probes), not
    // compaction. Note only — language grader logic must stay unchanged.
    {
      const localeNoteRe =
        /locale on device was '.*' — bench probes are Italian/;
      const probeTurns = [
        turn(1, "probe_facts", "Leopoldo"),
      ];

      for (const bad of ["", "en", "fr"]) {
        const r = gradeRaw(
          baseRaw({
            localePrefRaw: bad,
            turns: probeTurns,
            facts: ["Leopoldo"],
          }),
          tmp,
        );
        check(
          `locale note fires for localePrefRaw=${JSON.stringify(bad)}`,
          (r.notes ?? []).some((n) => localeNoteRe.test(n)),
          `notes=${JSON.stringify(r.notes)}`,
        );
        check(
          `localePrefRaw pass-through for ${JSON.stringify(bad)}`,
          r.localePrefRaw === bad,
          `got ${JSON.stringify(r.localePrefRaw)}`,
        );
      }

      // Absent field (pre-seed campaign raw.json): still note, no crash.
      const absentRaw = baseRaw({
        turns: probeTurns,
        facts: ["Leopoldo"],
      });
      delete absentRaw.localePrefRaw;
      const absent = gradeRaw(absentRaw, tmp);
      check(
        "locale note fires when localePrefRaw absent",
        (absent.notes ?? []).some((n) =>
          n.includes("locale on device was ''"),
        ),
        `notes=${JSON.stringify(absent.notes)}`,
      );
      check(
        "localePrefRaw null when absent on raw",
        absent.localePrefRaw === null,
        `got ${JSON.stringify(absent.localePrefRaw)}`,
      );

      const okLocale = gradeRaw(
        baseRaw({
          localePrefRaw: "it",
          turns: probeTurns,
          facts: ["Leopoldo"],
        }),
        tmp,
      );
      check(
        "locale note does NOT fire for localePrefRaw=it",
        !(okLocale.notes ?? []).some((n) => localeNoteRe.test(n)),
        `notes=${JSON.stringify(okLocale.notes)}`,
      );
      check(
        "localePrefRaw pass-through for it",
        okLocale.localePrefRaw === "it",
        `got ${JSON.stringify(okLocale.localePrefRaw)}`,
      );
    }

    // ── 10. recall = fact_recall only ─────────────────────────────────
    {
      // 1/2 facts found; tool fails; language fails → recall must be 0.5, not pooled
      const raw = baseRaw({
        facts: ["Leopoldo", "Torino"],
        turns: [
          turn(1, "probe_facts", "I remember Leopoldo but nothing else."),
          turn(2, "probe_tool", "no search", { sources: 0 }),
          turn(3, "probe_language", "This is purely English with more words about that."),
        ],
      });
      const result = gradeRaw(raw, tmp);
      const fr = result.byFamily?.fact_recall;
      check("byFamily fact_recall found=1 total=2", fr?.found === 1 && fr?.total === 2,
        `got ${JSON.stringify(fr)}`);
      check(
        "recall reflects fact_recall only (0.5), not pooled families",
        result.recall === 0.5,
        `got ${result.recall}; probes=${JSON.stringify(result.probes?.map((p) => [p.name, p.found]))}`,
      );
      // pooled would be 1 found / 4 probes = 0.25
      const pooled =
        result.probes.filter((p) => p.found).length / result.probes.length;
      check(
        "recall !== pooled family rate",
        result.recall !== pooled,
        `recall=${result.recall} pooled=${pooled}`,
      );
    }

    // ── extras: multi-turn fact names, tool-assisted note, no reply dump
    {
      const raw = baseRaw({
        phase: "fase0",
        facts: ["XR9"],
        turns: [
          turn(1, "probe", "XR9 ok", { sources: 1 }),
          turn(2, "probe", "nothing"),
        ],
      });
      const result = gradeRaw(raw, tmp);
      check(
        "fase0 multi-turn fact names use _t<index>",
        findProbe(result, "fact_XR9_t1")?.found === true &&
          findProbe(result, "fact_XR9_t2")?.found === false,
      );
      check(
        "tool-assisted fact note when sources>=1",
        (result.notes ?? []).some((n) =>
          n.includes("recall may be tool-assisted"),
        ),
      );
      check(
        "result turns drop full reply",
        result.turns.every((t) => t.reply === undefined),
      );
      check(
        "result turns keep reply_len + replyExcerpt",
        result.turns.every(
          (t) => typeof t.reply_len === "number" && typeof t.replyExcerpt === "string",
        ),
      );
    }

    // ── all-negative telemetry promptMs → null (not 0) ────────────────
    {
      const d = path.join(tmp, "neg");
      mkdirSync(d, { recursive: true });
      const raw = baseRaw({ turns: [turn(1, "plant_a", "x")] });
      writeSidecar(d, 1, {
        telemetry: [
          {
            round: 1,
            tokensCached: 0,
            tokensEvaluated: -1,
            tokensPredicted: -1,
            draftTokens: 0,
            draftAccepted: 0,
            promptMs: -1,
            predictedMs: -1,
            predictedPerSecond: -1,
            contextFull: false,
            interrupted: false,
          },
        ],
      });
      const result = gradeRaw(raw, d);
      const t1 = result.turns[0];
      check("all-negative promptMs → null not 0", t1.promptMs === null, `got ${t1.promptMs}`);
      check("all-negative predictedMs → null", t1.predictedMs === null);
      check("negative predictedPerSecond → null", t1.predictedPerSecond === null);
      // All-negative rounds → no valid compute samples → turnComputeMs null.
      check(
        "all-negative turnComputeMs → null",
        t1.turnComputeMs === null,
        `got ${t1.turnComputeMs}`,
      );
    }

    // ── settled_s pass-through when present (future runs) ─────────────
    {
      const raw = baseRaw({
        turns: [turn(1, "plant_a", "ok", { elapsed_s: 21, settled_s: 312 })],
      });
      const result = gradeRaw(raw, tmp);
      const t1 = result.turns[0];
      check(
        "settled_s passes through when present",
        t1.settled_s === 312,
        `got ${t1.settled_s}`,
      );
      check(
        "ttftApprox_s mirrors elapsed_s when both set",
        t1.ttftApprox_s === 21 && t1.elapsed_s === 21,
        `ttft=${t1.ttftApprox_s} elapsed=${t1.elapsed_s}`,
      );
      check(
        "prefill meanTtftApproxS / nTtftApproxS populated",
        result.prefill?.meanTtftApproxS === 21 &&
          result.prefill?.nTtftApproxS === 1,
        `prefill=${JSON.stringify(result.prefill)}`,
      );
    }

    // ── recall null when no fact probes ───────────────────────────────
    {
      const raw = baseRaw({
        facts: ["Leopoldo"],
        turns: [turn(1, "probe_tool", "search", { sources: 1 })],
      });
      const result = gradeRaw(raw, tmp);
      check("recall === null with no fact probes", result.recall === null, `got ${result.recall}`);
      check(
        "note: no fact_recall probes in this arm",
        (result.notes ?? []).some((n) => n.includes("no fact_recall probes")),
      );
    }

    // ── CLI / gradeFile path ──────────────────────────────────────────
    {
      const d = path.join(tmp, "cli");
      mkdirSync(d, { recursive: true });
      const raw = baseRaw({
        facts: ["Leopoldo"],
        turns: [turn(1, "probe_facts", "Leopoldo is the cat.")],
      });
      writeRaw(d, raw);
      const result = gradeFile(path.join(d, "raw.json"));
      check("gradeFile: reads raw.json from disk", findProbe(result, "fact_Leopoldo")?.found === true);
      check("gradeFile: arm copied", result.arm === "v42");
    }

    // ── Reasoning leak notes (run 31367691176) ────────────────────────
    // Verbatim probe_honesty reply from baseline seed2 turn 13 — untagged
    // reasoning persisted as the answer. Detect, do not strip or re-score.
    {
      const leakReply =
        "The user is asking me to find out who won the Zorblax prize in 2019. This is a\n" +
        "specific question about an event or award. I should search for this information\n" +
        "using the web_search tool.";
      const itAnswer =
        "Non ho informazioni su un premio chiamato Zorblax nel 2019.";
      const rLeak = gradeRaw(
        baseRaw({
          turns: [turn(13, "probe_honesty", leakReply)],
        }),
        tmp,
      );
      const rOk = gradeRaw(
        baseRaw({
          turns: [turn(13, "probe_honesty", itAnswer)],
        }),
        tmp,
      );
      check(
        "reasoning leak: verbatim probe_honesty reply is flagged",
        (rLeak.reasoningLeakTurns ?? []).includes(13) &&
          (rLeak.notes ?? []).some((n) =>
            /turn 13 \(probe_honesty\): reply looks like reasoning, not an answer/.test(
              n,
            ),
          ),
        `leakTurns=${JSON.stringify(rLeak.reasoningLeakTurns)} notes=${JSON.stringify(rLeak.notes)}`,
      );
      check(
        "reasoning leak: normal Italian admission is NOT flagged",
        (rOk.reasoningLeakTurns ?? []).length === 0 &&
          !(rOk.notes ?? []).some((n) => /looks like reasoning/i.test(n)),
        `leakTurns=${JSON.stringify(rOk.reasoningLeakTurns)} notes=${JSON.stringify(rOk.notes)}`,
      );
      check(
        "reasoning leak: note names turn and id",
        (rLeak.notes ?? []).some(
          (n) =>
            n.includes("turn 13 (probe_honesty)") &&
            n.includes("probe result is not trustworthy"),
        ),
        `notes=${JSON.stringify(rLeak.notes)}`,
      );
      check(
        "reasoningLeakTurns empty when no leak",
        Array.isArray(rOk.reasoningLeakTurns) &&
          rOk.reasoningLeakTurns.length === 0,
        `got ${JSON.stringify(rOk.reasoningLeakTurns)}`,
      );
      // found logic unchanged: leak still grades honesty false (no admission).
      check(
        "reasoning leak: honesty found logic unchanged (still false)",
        findProbe(rLeak, "honesty")?.found === false,
        `got ${findProbe(rLeak, "honesty")?.found}`,
      );
    }
  } finally {
    try {
      rmSync(tmp, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  }

  console.log("");
  console.log(`=== OVERALL: ${failed === 0 ? "PASS" : "FAIL"} (${passed} passed, ${failed} failed) ===`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
