/**
 * Harness for src/context/retrievalLoop.ts (+ retriever.ts primitives).
 * Compiles with tsc, runs named PASS/FAIL contracts, exit 0 only if all pass.
 */
import { spawnSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  runMutationMatrix,
  wordSetContainedAt,
} from "./retrievalLoopMutations.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

function compile() {
  const r = spawnSync(
    "npx",
    [
      "tsc",
      "src/context/retriever.ts",
      "src/context/retrievalLoop.ts",
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

function resolveBuilt(name) {
  const candidates = [
    path.join(projectRoot, `scripts/.build/${name}.js`),
    path.join(projectRoot, `scripts/.build/context/${name}.js`),
    path.join(projectRoot, `scripts/.build/src/context/${name}.js`),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  console.error(`Could not find compiled ${name}.js. Tried:\n`, candidates.join("\n"));
  process.exit(1);
}

/**
 * Mixed IT/EN fixture corpus (8 docs). Designed so harness contracts are
 * independently controllable: single-fact docs for no-trigger, multi-topic
 * docs for coverage residual, dilute sentences for too-few, etc.
 */
function buildCorpus() {
  /** @type {{ docId: string; title?: string; text: string }[]} */
  return [
    {
      docId: "readme",
      title: "Project README",
      text: [
        "Kalsa AI Chat is a local-first mobile assistant built with Expo and llama.rn.",
        "The default model runs fully offline on device with optional cloud fallback.",
        "Install dependencies with npm install, then start the Metro bundler.",
        "Context compaction keeps long conversations inside the model window.",
      ].join(" "),
    },
    {
      docId: "recipe",
      title: "Tiramisù classico",
      text: [
        "Ingredienti: mascarpone, uova, zucchero, savoiardi e caffè espresso.",
        "Montare i tuorli con lo zucchero, unire il mascarpone, poi gli albumi montati a neve.",
        "Bagnare i savoiardi nel caffè e alternare strati di crema.",
        "Lasciar riposare in frigo almeno tre ore prima di servire.",
      ].join(" "),
    },
    {
      docId: "meeting",
      title: "Meeting notes 12 Mar",
      text: [
        "Presenti: Sofia, Marco, Giulia. Agenda: sprint review e budget.",
        "Si decide di congelare le feature freeze entro venerdì.",
        "Il budget del team resta fissato a quattromila euro per il trimestre.",
        "Prossima sync martedì alle undici in sala B.",
      ].join(" "),
    },
    {
      // Topic A: short punctuated sentences (visible to sentence index).
      // Topic B: planted past the 300-char sentence cap inside a run-on paragraph
      // so sentence-level round 1 cannot see ZEPHYR-9147; paragraph index can
      // (paragraph windows allow up to 600 chars, no mid-window period before the plant).
      docId: "spec",
      title: "Product spec",
      text: [
        "The authentication module uses secure token rotation every hour. ",
        "Login screens support biometric unlock on compatible devices. ",
        "Session cookies expire after twelve hours of inactivity. ",
        "Refresh tokens are stored in the encrypted device keystore. ",
        "Password reset flows send a one-time code by email only. ",
        "Multi-factor prompts appear when risk signals exceed the threshold.",
        "\n\n",
        // Run-on paragraph (no '.' before the plant). First ≥320 chars are filler
        // so segmentSentences caps the only "sentence" before ZEPHYR-9147.
        "Deployment appendix for operations when operators enable the experimental ",
        "canary lane across staging regions the freeze window checklist requires ",
        "extra review from the release managers before any traffic shift happens ",
        "and the release train documentation must also mention secondary regions ",
        "and only then the distinctive rollout codename ZEPHYR-9147 is activated ",
        "with a dedicated telemetry dashboard filter after canary promotion completes",
      ].join(""),
    },
    {
      docId: "travel",
      title: "Travel preferences",
      text: [
        "Preferisco viaggiare in treno quando il percorso è sotto le sei ore.",
        "L'aereo resta un'opzione solo per tratte intercontinentali.",
        "Il posto finestrino aiuta a lavorare senza distrazioni.",
      ].join(" "),
    },
    {
      docId: "design",
      title: "Design system notes",
      text: [
        "We decided on the blue color scheme for primary actions.",
        "Secondary buttons use a neutral gray with a one-pixel border.",
        "Spacing follows an eight-point grid across mobile layouts.",
      ].join(" "),
    },
    {
      docId: "finance",
      title: "Finance memo",
      text: [
        "Il codice sconto promozionale per i trial è SAVE20.",
        "Applicarlo solo ai clienti nuovi di questa settimana.",
        "Il tetto di spesa marketing non deve superare il piano approvato.",
      ].join(" "),
    },
    {
      docId: "emptyish",
      title: "Almost empty",
      text: "ok\n\n\n\n  \n\n",
    },
  ];
}

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function totalChars(passages) {
  return passages.reduce((s, p) => s + String(p.text).length, 0);
}

function jaccardWords(a, b) {
  const setA = new Set(String(a).split(/\s+/).filter(Boolean));
  const setB = new Set(String(b).split(/\s+/).filter(Boolean));
  if (setA.size === 0 && setB.size === 0) return 0;
  let inter = 0;
  for (const w of setA) {
    if (setB.has(w)) inter++;
  }
  const union = setA.size + setB.size - inter;
  if (union === 0) return 0;
  return inter / union;
}

function padDoc(i, targetLen = 1000) {
  const core = `Document number ${i} discusses routine operational notes about weather coffee meetings and generic project status without durable secrets. `;
  let s = `Title block ${i}. ${core}`;
  while (s.length < targetLen) {
    s += `Filler paragraph ${i} section ${s.length}: more routine words about process updates and weekly summaries. `;
  }
  // Plant a unique retrievable phrase near the end of every 10th doc
  if (i % 10 === 0) {
    s += ` Unique marker ALPHA-${i} appears here for retrieval probes.`;
  }
  return s.slice(0, targetLen + 80);
}

async function main() {
  console.log("Compiling retriever.ts + retrievalLoop.ts …");
  compile();
  const loopPath = resolveBuilt("retrievalLoop");
  const retrieverPath = resolveBuilt("retriever");
  console.log("Loading", loopPath);
  const mod = await import(pathToFileURL(loopPath).href);
  const retMod = await import(pathToFileURL(retrieverPath).href);
  const { DocRetrieverIndex, runRetrievalLoop } = mod;
  const { normalize, containmentForm, isTextuallyContained } = retMod;
  if (typeof DocRetrieverIndex !== "function") {
    console.error("DocRetrieverIndex not exported");
    process.exit(1);
  }
  if (typeof runRetrievalLoop !== "function") {
    console.error("runRetrievalLoop not exported");
    process.exit(1);
  }
  if (typeof normalize !== "function") {
    console.error("normalize not exported from retriever");
    process.exit(1);
  }
  if (typeof containmentForm !== "function" || typeof isTextuallyContained !== "function") {
    console.error("containmentForm/isTextuallyContained not exported from retriever");
    process.exit(1);
  }

  const results = [];
  const record = (name, pass, detail = "") => {
    results.push({ name, pass, detail });
    console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
  };

  const corpus = buildCorpus();
  const index = new DocRetrieverIndex();
  index.append(corpus);
  console.log(`Corpus docs: ${corpus.length}, chunks: ${index.chunkCount}\n`);

  // -------------------------------------------------------------------------
  // 1. No-trigger: fully answered by sentence-level round 1
  // -------------------------------------------------------------------------
  {
    const q = "come si chiama il codice sconto promozionale trial?";
    const res = runRetrievalLoop(index, q, {
      maxRounds: 2,
      topNPerRound: 4,
      coverageThreshold: 0.5,
      minPassagesFloor: 1,
    });
    const texts = res.passages.map((p) => p.text).join(" ");
    const hasFact = /SAVE20/i.test(texts);
    const ok =
      res.trace.roundsRun === 1 &&
      res.trace.triggeredSecondRound === false &&
      res.trace.triggerReason === null &&
      res.trace.residualQuery === null &&
      hasFact;
    record(
      "1 no-trigger (sentence suffices)",
      ok,
      `rounds=${res.trace.roundsRun} trig=${res.trace.triggeredSecondRound} SAVE20=${hasFact}`,
    );
  }

  // -------------------------------------------------------------------------
  // 2. Coverage trigger: two-topic query; topic B only past sentence 300-cap
  // -------------------------------------------------------------------------
  {
    // Topic A = authentication (sentence-visible); topic B = ZEPHYR-9147 (only in
    // paragraph past the 300-char sentence truncation point).
    const q =
      "How does authentication token rotation work and what is the ZEPHYR-9147 canary rollout codename?";
    const res = runRetrievalLoop(index, q, {
      maxRounds: 2,
      topNPerRound: 4,
      coverageThreshold: 0.75,
      minPassagesFloor: 1,
      budgetChars: 2500,
      maxCharsPerPassage: 500,
    });
    const residual = res.trace.residualQuery ?? "";
    const residualHasB = /zephyr|9147|canary|rollout|codename/i.test(residual);
    // Strong topic-A content words should be covered by round-1 auth sentences
    const residualHasStrongA =
      /\bauthentication\b/i.test(residual) && /\btoken\b/i.test(residual);
    // F6: punctuation stripped — residual must not keep trailing '?'
    const residualHasPunct = /\?/.test(residual);
    const texts = res.passages.map((p) => p.text).join(" ");
    const hasB = /ZEPHYR-9147/i.test(texts);
    const ok =
      res.trace.triggeredSecondRound === true &&
      res.trace.triggerReason === "coverage_below_threshold" &&
      res.trace.roundsRun === 2 &&
      residualHasB &&
      !residualHasStrongA &&
      !residualHasPunct &&
      hasB;
    record(
      "2 coverage trigger + residual + topic B",
      ok,
      `reason=${res.trace.triggerReason} residual="${residual.slice(0, 100)}" hasB=${hasB} residualB=${residualHasB} residualStrongA=${residualHasStrongA} punct=${residualHasPunct}`,
    );
  }

  // -------------------------------------------------------------------------
  // 3. Too-few trigger: few hits, all content words covered → residual = full query
  // -------------------------------------------------------------------------
  {
    // Single distinctive content word fully covered by one finance sentence,
    // but minPassagesFloor forces a second round with the full query reused.
    const q = "SAVE20";
    const res = runRetrievalLoop(index, q, {
      maxRounds: 2,
      topNPerRound: 2,
      minPassagesFloor: 5,
      coverageThreshold: 0.1,
    });
    const residual = res.trace.residualQuery ?? "";
    const ok =
      res.trace.triggeredSecondRound === true &&
      res.trace.triggerReason === "too_few_passages" &&
      residual.length > 0 &&
      /save20/i.test(residual);
    record(
      "3 too-few trigger reuses full query",
      ok,
      `reason=${res.trace.triggerReason} residual="${residual.slice(0, 80)}" n=${res.passages.length} rounds=${res.trace.roundsRun}`,
    );
  }

  // -------------------------------------------------------------------------
  // 4. Exclusion: unique chunkIds; round-2 ids never selected in round 1
  // -------------------------------------------------------------------------
  {
    const q =
      "authentication token rotation biometric unlock ZEPHYR-9147 canary lane telemetry";
    const res = runRetrievalLoop(index, q, {
      maxRounds: 2,
      topNPerRound: 4,
      coverageThreshold: 0.9,
      minPassagesFloor: 1,
      budgetChars: 3000,
      maxCharsPerPassage: 350,
    });
    const ids = res.passages.map((p) => p.chunkId);
    const unique = new Set(ids).size === ids.length;
    const r1Ids = new Set(
      res.passages.filter((p) => p.round === 1).map((p) => p.chunkId),
    );
    const r2 = res.passages.filter((p) => p.round === 2);
    const noOverlap = r2.every((p) => !r1Ids.has(p.chunkId));
    const r2AreParagraph = r2.every((p) => p.granularity === "paragraph");
    // Stronger: call retrieveRound twice manually if available
    let manualOk = true;
    if (typeof index.retrieveRound === "function") {
      const excl = new Set();
      const a = index.retrieveRound(q, "sentence", excl, {
        topN: 4,
        maxChars: 300,
        round: 1,
      });
      for (const p of a) excl.add(p.chunkId);
      const b = index.retrieveRound(q, "paragraph", excl, {
        topN: 4,
        maxChars: 300,
        round: 2,
      });
      for (const p of b) {
        // b must not return any round-1 chunkId
        if (a.some((x) => x.chunkId === p.chunkId)) manualOk = false;
      }
    }
    // F11: actually assert r2AreParagraph
    const ok = unique && noOverlap && r2AreParagraph && manualOk;
    record(
      "4 exclusion (unique chunkIds across rounds)",
      ok,
      `unique=${unique} noOverlap=${noOverlap} r2para=${r2AreParagraph} manual=${manualOk} n=${ids.length}`,
    );
  }

  // -------------------------------------------------------------------------
  // 5. Replacement / budget (normalize-aware pairwise Jaccard)
  // -------------------------------------------------------------------------
  {
    const q = "project expo llama offline model budget team euro blue color scheme";
    const budget = 400;
    const res = runRetrievalLoop(index, q, {
      maxRounds: 2,
      topNPerRound: 4,
      budgetChars: budget,
      maxCharsPerPassage: 200,
      coverageThreshold: 0.99,
      minPassagesFloor: 1,
    });
    const chars = totalChars(res.passages);
    const withinBudget = chars <= budget;
    // Pairwise Jaccard on normalize()d text (accent-fold consistent with merge)
    let maxJac = 0;
    for (let i = 0; i < res.passages.length; i++) {
      for (let j = i + 1; j < res.passages.length; j++) {
        const jac = jaccardWords(
          normalize(res.passages[i].text),
          normalize(res.passages[j].text),
        );
        if (jac > maxJac) maxJac = jac;
      }
    }
    const noDup = maxJac < 0.7;
    const ok = withinBudget && noDup;
    record(
      "5 budget + Jaccard dedup",
      ok,
      `chars=${chars}≤${budget} maxJac=${maxJac.toFixed(3)} n=${res.passages.length}`,
    );
  }

  // -------------------------------------------------------------------------
  // 6. Hard cap
  // -------------------------------------------------------------------------
  {
    const q = "ZEPHYR-9147 canary authentication token rotation biometric";
    const hi = runRetrievalLoop(index, q, {
      maxRounds: 99,
      topNPerRound: 3,
      coverageThreshold: 0.99,
      minPassagesFloor: 10,
      budgetChars: 2500,
    });
    const zero = runRetrievalLoop(index, q, {
      maxRounds: 0,
      topNPerRound: 3,
      coverageThreshold: 0.99,
      minPassagesFloor: 10,
    });
    const neg = runRetrievalLoop(index, q, {
      maxRounds: -5,
      topNPerRound: 3,
    });
    const ok =
      hi.trace.roundsRun <= 3 &&
      zero.trace.roundsRun === 1 &&
      neg.trace.roundsRun === 1;
    record(
      "6 hard cap maxRounds (99→≤3, 0/neg→1)",
      ok,
      `hi=${hi.trace.roundsRun} zero=${zero.trace.roundsRun} neg=${neg.trace.roundsRun}`,
    );
  }

  // -------------------------------------------------------------------------
  // 7. Relevance gate
  // -------------------------------------------------------------------------
  {
    // Rare letter combos (not English-like) → no shared content n-grams with corpus.
    // (Pseudo-English tokens still leak via char 3-grams into normal prose.)
    const q = "qqzzxxvv qqzzxxww jjxqzvvx zzzqqqxxx";
    const res = runRetrievalLoop(index, q, {
      maxRounds: 2,
      topNPerRound: 4,
      minPassagesFloor: 2,
      coverageThreshold: 0.5,
    });
    // May attempt 2 rounds (too_few / coverage) but nothing must leak through the gate
    const empty = res.passages.length === 0;
    const ok = empty && res.trace.roundsRun >= 1;
    record(
      "7 relevance gate (unrelated → [])",
      ok,
      `n=${res.passages.length} rounds=${res.trace.roundsRun}`,
    );
  }

  // -------------------------------------------------------------------------
  // 8. Determinism
  // -------------------------------------------------------------------------
  {
    const q = "Preferisco viaggiare in treno o blue color scheme?";
    const a = runRetrievalLoop(index, q, {
      maxRounds: 2,
      topNPerRound: 4,
      budgetChars: 800,
    });
    const b = runRetrievalLoop(index, q, {
      maxRounds: 2,
      topNPerRound: 4,
      budgetChars: 800,
    });
    const ok = deepEqual(a, b);
    record("8 determinism (two identical calls)", ok);
  }

  // -------------------------------------------------------------------------
  // 9. Defensive
  // -------------------------------------------------------------------------
  {
    let threw = false;
    const cases = [];
    try {
      cases.push(runRetrievalLoop(index, null));
      cases.push(runRetrievalLoop(index, undefined));
      cases.push(runRetrievalLoop(index, ""));
      cases.push(runRetrievalLoop(index, "   "));
      const emptyIdx = new DocRetrieverIndex();
      cases.push(runRetrievalLoop(emptyIdx, "hello world test"));
      emptyIdx.append(null);
      emptyIdx.append(undefined);
      emptyIdx.append([]);
      emptyIdx.append([
        { docId: "x", text: "" },
        { docId: "y", text: null },
        { docId: "z" },
        null,
      ]);
      cases.push(runRetrievalLoop(emptyIdx, "anything at all here"));
      const idx2 = new DocRetrieverIndex();
      idx2.append([{ docId: "ok", text: "Il gatto di Marco si chiama Leopoldo davvero." }]);
      cases.push(runRetrievalLoop(idx2, "come si chiama il gatto?"));
    } catch (e) {
      threw = true;
      console.error("  defensive threw:", e);
    }
    const emptyOk = cases.slice(0, 6).every(
      (r) => Array.isArray(r.passages) && r.passages.length === 0 && r.trace.roundsRun === 0,
    );
    const last = cases[cases.length - 1];
    const lastOk = last && Array.isArray(last.passages);
    record(
      "9 defensive (null/empty/bad docs)",
      !threw && emptyOk && lastOk,
      `threw=${threw} emptyOk=${emptyOk}`,
    );
  }

  // -------------------------------------------------------------------------
  // 10. Perf: 100 docs × ~1 KB, 30 loop runs, avg ≤ 100 ms (F10)
  // -------------------------------------------------------------------------
  {
    const big = new DocRetrieverIndex();
    const docs = [];
    for (let i = 0; i < 100; i++) {
      docs.push({ docId: `d${i}`, text: padDoc(i, 1000) });
    }
    const tBuild0 = performance.now();
    big.append(docs);
    const buildMs = performance.now() - tBuild0;

    const perfQ = "Unique marker ALPHA-20 operational notes project status";
    // warmup
    for (let i = 0; i < 3; i++) {
      runRetrievalLoop(big, perfQ, { maxRounds: 2, topNPerRound: 4 });
    }
    const times = [];
    for (let i = 0; i < 30; i++) {
      const t0 = performance.now();
      runRetrievalLoop(big, perfQ, { maxRounds: 2, topNPerRound: 4 });
      times.push(performance.now() - t0);
    }
    times.sort((x, y) => x - y);
    const avg = times.reduce((s, x) => s + x, 0) / times.length;
    const p95 = times[Math.min(times.length - 1, Math.floor(times.length * 0.95))];
    const ok = avg <= 100;
    record(
      "10 perf avg ≤ 100ms @ 100×1KB ×30",
      ok,
      `avg ${avg.toFixed(3)} ms, p95 ${p95.toFixed(3)} ms, build ${buildMs.toFixed(1)} ms, chunks=${big.chunkCount}`,
    );
  }

  // -------------------------------------------------------------------------
  // 11. Round-2 survival under tight budget (regression for F2 RRF merge)
  // -------------------------------------------------------------------------
  {
    // Topic A: many auth sentences (fill R1). Topic B: QUORUM-7721 planted past
    // the 300-char sentence cap inside a run-on paragraph whose PREFIX is pure
    // lorem (so R1 never selects a Jaccard-near prefix of the same chunk).
    // RRF fusion (not raw BM25) lets the residual paragraph survive a ~2-slot budget.
    const idx11 = new DocRetrieverIndex();
    const fillerSentences = [];
    for (let i = 0; i < 8; i++) {
      fillerSentences.push(
        `Authentication token rotation detail number ${i} covers secure keystore storage and biometric unlock flows for mobile clients.`,
      );
    }
    // No periods: one sentence for segmentSentences, truncated at 300 to lorem only.
    let paraPad = "";
    while (paraPad.length < 320) {
      paraPad +=
        "lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ";
    }
    const plant =
      "the distinctive quorum marker QUORUM-7721 is activated with a dedicated telemetry filter uniquely";
    const para = paraPad + plant;
    const plantAt = para.indexOf("QUORUM-7721");
    if (plantAt < 300) {
      throw new Error(`fixture 11: plant at ${plantAt} not past 300`);
    }
    const maxChars = plantAt + "QUORUM-7721".length + 30;
    if (maxChars > 600) {
      throw new Error("fixture 11: maxChars too large for one paragraph window");
    }
    // Tight: room for ~2 passages (one R1 auth + one R2 residual paragraph)
    const budget = maxChars + 150;
    idx11.append([
      {
        docId: "auth-heavy",
        text: fillerSentences.join(" ") + "\n\n" + para,
      },
    ]);
    const q =
      "authentication token rotation biometric unlock and the QUORUM-7721 marker";
    const res = runRetrievalLoop(idx11, q, {
      maxRounds: 2,
      topNPerRound: 3,
      maxCharsPerPassage: maxChars,
      budgetChars: budget,
      coverageThreshold: 0.85,
      minPassagesFloor: 1,
    });
    const hasR2 = res.passages.some(
      (p) => p.round === 2 && /QUORUM-7721/i.test(p.text),
    );
    const trig = res.trace.triggeredSecondRound === true;
    const ok = trig && hasR2;
    record(
      "11 round-2 survival under tight budget",
      ok,
      `trig=${trig} hasR2=${hasR2} rounds=${res.trace.roundsRun} n=${res.passages.length} maxChars=${maxChars} budget=${budget} residual="${(res.trace.residualQuery ?? "").slice(0, 60)}"`,
    );
  }

  // -------------------------------------------------------------------------
  // 12. Truncation honesty (regression for F1 delivered-text coverage)
  // -------------------------------------------------------------------------
  {
    // Only matching chunk is long; plant HIDDENWORD-991 beyond maxCharsPerPassage.
    // Delivered text must NOT claim coverage; residual must include the word.
    const idx12 = new DocRetrieverIndex();
    const pad = "alpha beta gamma delta epsilon zeta eta theta iota kappa ".repeat(8);
    // Ensure the unique term sits past maxChars=120
    const body =
      pad.slice(0, 140) +
      " the secret plant is HIDDENWORD-991 and nothing else mentions it here";
    idx12.append([
      {
        docId: "trunc-doc",
        // One long run-on so sentence path also truncates; paragraph keeps full ≤600
        text: body,
      },
    ]);
    const maxChars = 120;
    const termPos = body.indexOf("HIDDENWORD-991");
    if (termPos < maxChars) {
      throw new Error(`fixture 12: plant at ${termPos} not past maxChars ${maxChars}`);
    }
    const q = "where is HIDDENWORD-991 documented?";
    const res = runRetrievalLoop(idx12, q, {
      maxRounds: 2,
      topNPerRound: 4,
      maxCharsPerPassage: maxChars,
      budgetChars: 2000,
      coverageThreshold: 0.99,
      minPassagesFloor: 1,
    });
    // After round 1 (and cumulatively if only truncated text), coverage must be < 1
    // and residual must carry the truncated term.
    const cov0 = res.trace.coverageByRound[0];
    const residual = res.trace.residualQuery ?? "";
    const residualHasTerm = /hiddenword-991/i.test(residual);
    // Also: none of the DELIVERED round-1 texts should contain the term
    const r1Texts = res.passages
      .filter((p) => p.round === 1)
      .map((p) => p.text)
      .join(" ");
    // Round 1 may or may not be in final merge; check via a direct retrieveRound
    let deliveredHasTerm = false;
    if (typeof idx12.retrieveRound === "function") {
      const r1 = idx12.retrieveRound(q, "sentence", new Set(), {
        topN: 4,
        maxChars,
        round: 1,
      });
      deliveredHasTerm = r1.some((p) => /HIDDENWORD-991/i.test(p.text));
    }
    const covHonest = typeof cov0 === "number" && cov0 < 1;
    const ok = covHonest && residualHasTerm && !deliveredHasTerm;
    record(
      "12 truncation honesty (delivered coverage)",
      ok,
      `cov0=${cov0} residualHas=${residualHasTerm} deliveredHas=${deliveredHasTerm} residual="${residual.slice(0, 80)}"`,
    );
  }

  // -------------------------------------------------------------------------
  // 13. Normalize-aware dedup (accent variants must collapse)
  // -------------------------------------------------------------------------
  {
    const idx13 = new DocRetrieverIndex();
    idx13.append([
      {
        docId: "accent-a",
        text: "Il motivo principale e perche il sistema deve restare offline sempre durante i test di rete.",
      },
      {
        docId: "accent-b",
        text: "Il motivo principale e perché il sistema deve restare offline sempre durante i test di rete.",
      },
    ]);
    const q = "perche il sistema deve restare offline durante i test?";
    const res = runRetrievalLoop(idx13, q, {
      maxRounds: 2,
      topNPerRound: 4,
      budgetChars: 2000,
      maxCharsPerPassage: 400,
      coverageThreshold: 0.99,
      minPassagesFloor: 1,
    });
    let maxJac = 0;
    for (let i = 0; i < res.passages.length; i++) {
      for (let j = i + 1; j < res.passages.length; j++) {
        const jac = jaccardWords(
          normalize(res.passages[i].text),
          normalize(res.passages[j].text),
        );
        if (jac > maxJac) maxJac = jac;
      }
    }
    // After normalize, perche/perché collapse → near-identical → merge keeps ≤1
    const noDupPair = maxJac < 0.7;
    const ok =
      res.passages.length >= 1 &&
      (res.passages.length === 1 || noDupPair) &&
      noDupPair;
    record(
      "13 normalize-aware accent dedup",
      ok,
      `n=${res.passages.length} maxJac=${maxJac.toFixed(3)}`,
    );
  }

  // -------------------------------------------------------------------------
  // 14. Post-merge coverage honesty (regression for R1)
  // -------------------------------------------------------------------------
  {
    // Four short sentences with DISTINCT vocab, each uniquely carrying one
    // queried term. Budget sized to fit only 3 passages → the dropped term
    // must NOT be claimed covered by the final coverage entry, and must appear
    // in the residual (or round 2 must fire).
    const docs = [
      {
        docId: "u0",
        term: "ALPHAQ-1111",
        text: "Shipping checklist requires the ALPHAQ-1111 seal before any crate leaves the dock.",
      },
      {
        docId: "u1",
        term: "BETAQ-2222",
        text: "Kitchen inventory lists the spice jar BETAQ-2222 next to the saffron tin only.",
      },
      {
        docId: "u2",
        term: "GAMMAQ-3333",
        text: "Orchestra score marks the flute solo GAMMAQ-3333 at measure forty-two sharp.",
      },
      {
        docId: "u3",
        term: "DELTAQ-4444",
        text: "Geology survey found the rare mineral DELTAQ-4444 under the basalt shelf layer.",
      },
    ];
    const terms = docs.map((d) => d.term);
    const idx14 = new DocRetrieverIndex();
    idx14.append(docs.map(({ docId, text }) => ({ docId, text })));
    // Fixed passage size; budget fits exactly 3 full passages.
    const maxChars = 90;
    const budget = maxChars * 3;
    const q = terms.join(" ");
    const res = runRetrievalLoop(idx14, q, {
      maxRounds: 2,
      topNPerRound: 4,
      maxCharsPerPassage: maxChars,
      budgetChars: budget,
      coverageThreshold: 0.99,
      minPassagesFloor: 1,
    });
    const finalCov =
      res.trace.coverageByRound[res.trace.coverageByRound.length - 1];
    const keptText = res.passages.map((p) => p.text).join(" ");
    const missing = terms.filter((t) => !new RegExp(t, "i").test(keptText));
    const residual = res.trace.residualQuery ?? "";
    const covIncomplete = typeof finalCov === "number" && finalCov < 1;
    const hasMissing = missing.length >= 1;
    const residualHasMissing =
      missing.length > 0 &&
      missing.some((t) => residual.toLowerCase().includes(t.toLowerCase()));
    const trigCoverage =
      res.trace.triggeredSecondRound === true &&
      res.trace.triggerReason === "coverage_below_threshold";
    // Budget should keep up to 3 of the 4 distinct carriers
    const withinBudget =
      res.passages.length <= 3 && totalChars(res.passages) <= budget;
    const keptThreeish = res.passages.length >= 2 && res.passages.length <= 3;
    const ok =
      covIncomplete &&
      hasMissing &&
      withinBudget &&
      keptThreeish &&
      (residualHasMissing || trigCoverage);
    record(
      "14 post-merge coverage honesty (budget drops term)",
      ok,
      `finalCov=${finalCov} missing=${missing.join(",")} residual="${residual.slice(0, 80)}" trig=${res.trace.triggerReason} n=${res.passages.length}`,
    );
  }

  // -------------------------------------------------------------------------
  // 15+. Textual containment: predicate unit contracts + loop contracts
  // -------------------------------------------------------------------------
  {
    function countSubstr(hay, needle) {
      if (!needle) return 0;
      let n = 0;
      let from = 0;
      while (true) {
        const at = hay.indexOf(needle, from);
        if (at < 0) break;
        n++;
        from = at + 1;
      }
      return n;
    }

    const CORE =
      "Noam proposed scaled dot-product attention, multi-head";
    const FINGERPRINT = "Noam proposed scaled dot-product attention";
    if (FINGERPRINT.length < 40) {
      throw new Error("fixture containment: fingerprint must be ≥40 chars");
    }
    const sentenceUnit =
      CORE + " attention mechanisms reshaped neural machine translation.";
    const paraBody =
      "The transformer architecture redesigns every aspect of this work. " +
      sentenceUnit +
      " Further residual stream details and layer-norm recipes made deep stacks trainable at scale with warmup schedules.";
    const topicB =
      "Separately the canary lane ZEPHYR-CONTAIN-42 routes telemetry exclusively through the blue filter.";
    const containDoc = {
      docId: "contain-attn",
      text: paraBody + "\n\n" + topicB,
    };
    const forceR2 = {
      maxRounds: 2,
      topNPerRound: 4,
      maxCharsPerPassage: 500,
      coverageThreshold: 0.95,
      minPassagesFloor: 10,
    };
    const containQ =
      "Noam proposed scaled dot-product attention multi-head ZEPHYR-CONTAIN-42";

    // ---- 15. PREDICATE unit contracts (loop-independent; gate the metric) ----
    {
      const notPairs = [
        [
          "the dose was not increased",
          "the dose was increased and the patient was not monitored",
        ],
        [
          "revenue grew in 2024",
          "revenue did not grow in 2024 although costs grew",
        ],
        [
          "Rome is the capital of Italy",
          "Paris is the capital of France and Rome is a city in Italy",
        ],
        [
          "The model is accurate",
          "The model is not accurate in edge cases",
        ],
      ];
      let notOk = true;
      const notDetails = [];
      for (const [a, b] of notPairs) {
        const na = normalize(a);
        const nb = normalize(b);
        const got = isTextuallyContained(na, nb);
        // wordSetContainedAt lives in the harness only (test material).
        const wordSetWould = wordSetContainedAt(na, nb, 0.9);
        if (got !== false) notOk = false;
        notDetails.push(
          `${JSON.stringify(a).slice(0, 32)} got=${got} ws=${wordSetWould}`,
        );
      }

      const paraNoFinalDot = paraBody.replace(
        "neural machine translation.",
        "neural machine translation",
      );
      const nSent = normalize(sentenceUnit);
      const nPara = normalize(paraBody);
      const nParaNoDot = normalize(paraNoFinalDot);
      const yesReal = isTextuallyContained(nSent, nPara) === true;
      const yesNoDot = isTextuallyContained(nSent, nParaNoDot) === true;
      const yesIdent = isTextuallyContained(nSent, nSent) === true;
      const rawIncludesNoDot = nParaNoDot.includes(nSent);
      const formSavesPunct = !rawIncludesNoDot && yesNoDot;
      const formStrips =
        /[.,]/.test(nSent) && !/[.,]/.test(containmentForm(nSent));
      const yesOk =
        yesReal && yesNoDot && yesIdent && formStrips && formSavesPunct;

      record(
        "15a predicate: NOT contained (negation/reorder pairs)",
        notOk,
        notDetails.join(" | "),
      );
      record(
        "15b predicate: IS contained (real + punct-stripped + identity)",
        yesOk,
        `real=${yesReal} noDot=${yesNoDot} ident=${yesIdent} formSavesPunct=${formSavesPunct} strips=${formStrips}`,
      );
    }

    // ---- 16. Loop: sentence ⊂ paragraph dedups once as paragraph ----
    {
      const idx = new DocRetrieverIndex();
      idx.append([containDoc]);
      const res = runRetrievalLoop(idx, containQ, {
        ...forceR2,
        budgetChars: 2500,
      });
      const delivered = res.passages.map((p) => p.text).join("\n");
      const hits = countSubstr(delivered, FINGERPRINT);
      const carriers = res.passages.filter((p) => p.text.includes(FINGERPRINT));
      const ok =
        hits === 1 &&
        carriers.length === 1 &&
        carriers[0].granularity === "paragraph" &&
        /every aspect of this work/i.test(carriers[0].text) &&
        res.trace.roundsRun === 2;
      const res2 = runRetrievalLoop(idx, containQ, {
        ...forceR2,
        budgetChars: 2500,
      });
      const det = deepEqual(res, res2);
      record(
        "16 loop: sentence⊂paragraph deduped once as paragraph",
        ok && det,
        `hits=${hits} gran=${carriers[0]?.granularity ?? "-"} n=${res.passages.length} det=${det}`,
      );
    }

    // ---- 17. Demotion: replaced subset re-emitted from retrieveRound ----
    // Short scores higher, long textually supersets it → replace + demote.
    // Catches demotion_off (n drops to 1).
    {
      const short = "Noam proposed scaled attention heads.";
      const long =
        "Noam proposed scaled attention heads and residual streams for deep stacks at scale.";
      const idx = new DocRetrieverIndex();
      idx.append([{ docId: "demote-doc", text: short + " " + long }]);
      const r = idx.retrieveRound(
        "Noam proposed scaled attention heads",
        "sentence",
        new Set(),
        { topN: 4, maxChars: 300, round: 1 },
      );
      const hasShort = r.some((p) =>
        /^Noam proposed scaled attention heads\.?$/i.test(p.text.trim()),
      );
      const hasLong = r.some((p) => /residual streams/i.test(p.text));
      // rankInRound must be score-ordered
      let rankOk = true;
      const byRank = r.slice().sort((a, b) => a.rankInRound - b.rankInRound);
      for (let j = 1; j < byRank.length; j++) {
        if (byRank[j].score > byRank[j - 1].score + 1e-12) rankOk = false;
      }
      const ok = r.length === 2 && hasShort && hasLong && rankOk;
      record(
        "17 demotion: retrieveRound re-emits replaced subset (n=2)",
        ok,
        `n=${r.length} hasShort=${hasShort} hasLong=${hasLong} rankOk=${rankOk}`,
      );
    }

    // ---- 18. MARKER-77 not dropped by longer near-overlap (word-set catcher) ----
    {
      const short =
        "alpha beta gamma delta epsilon zeta eta theta iota MARKER-77 protocol.";
      const longer =
        "alpha beta gamma delta epsilon zeta eta theta iota protocol requires cold storage ambient monitoring and review.";
      const idx = new DocRetrieverIndex();
      idx.append([
        { docId: "mark-short", text: short },
        { docId: "mark-long", text: longer },
      ]);
      const res = runRetrievalLoop(
        idx,
        "alpha beta MARKER-77 protocol storage monitoring",
        {
          maxRounds: 2,
          topNPerRound: 4,
          budgetChars: 2000,
          maxCharsPerPassage: 400,
          coverageThreshold: 0.5,
          minPassagesFloor: 1,
        },
      );
      const hasMarker = /MARKER-77/i.test(
        res.passages.map((p) => p.text).join(" "),
      );
      record(
        "18 loop: MARKER-77 not dropped by longer near-overlap",
        hasMarker,
        `hasMarker=${hasMarker} n=${res.passages.length}`,
      );
    }

    // ---- 19. Negation: standalone affirmative passage (not only span-in-paragraph) ----
    // Word-set collapses the short affirmative into the longer negated sentence;
    // a paragraph that carries BOTH clauses does NOT satisfy standalone.
    // This is the honest loop-level word-set discriminator for the audit fixture.
    {
      const idx = new DocRetrieverIndex();
      idx.append([
        {
          docId: "neg-model",
          text:
            "The model is accurate. The model is not accurate in edge cases. Additional notes on evaluation protocols follow.",
        },
      ]);
      const res = runRetrievalLoop(idx, "is the model accurate");
      const texts = res.passages.map((p) => p.text);
      const hasStandaloneAffirmative = texts.some(
        (t) =>
          /the model is accurate/i.test(t) && !/not accurate/i.test(t),
      );
      const hasNegative = texts.some((t) => /not accurate/i.test(t));
      record(
        "19 loop: negation keeps standalone affirmative passage",
        hasStandaloneAffirmative && hasNegative,
        `standaloneAff=${hasStandaloneAffirmative} neg=${hasNegative} n=${res.passages.length} texts=${JSON.stringify(texts)}`,
      );
    }

    // ---- Mutation matrix (temp-dir patch; no production seam) ----
    try {
      const matrixRows = await runMutationMatrix(mod, retMod);
      const wordset = matrixRows.find((r) => r.name === "wordset");
      const baseline = matrixRows.find((r) => r.name === "BASELINE");
      const matrixOk =
        baseline &&
        wordset &&
        baseline["15a"] &&
        baseline["18"] &&
        baseline["19"] &&
        !wordset["15a"] &&
        !wordset["18"] &&
        !wordset["19"];
      record(
        "20 mutation matrix: wordset turns 15a/18/19 red (no src seam)",
        matrixOk,
        `baseline=${baseline ? "ok" : "missing"} wordset15a=${wordset?.["15a"]} wordset18=${wordset?.["18"]} wordset19=${wordset?.["19"]}`,
      );
      try {
        const outPath =
          "C:/Users/gualt/AppData/Local/Temp/claude/C--Users-gualt-Desktop-Kalsa/8e332d1a-fdb9-4976-a152-34e44d9d40c0/scratchpad/agents/impl-containment/mutation-matrix.txt";
        writeFileSync(
          outPath,
          matrixRows
            .map((r) =>
              [
                r.name,
                r["15a"] ? "PASS" : "FAIL",
                r["18"] ? "PASS" : "FAIL",
                r["19"] ? "PASS" : "FAIL",
              ].join("\t"),
            )
            .join("\n") + "\n",
          "utf8",
        );
      } catch (e) {
        console.log("(matrix file write skipped)", e.message);
      }
    } catch (e) {
      record("20 mutation matrix: wordset turns 15a/18/19 red (no src seam)", false, String(e));
      console.error(e);
    }
  }

  const allPass = results.every((r) => r.pass);
  console.log("\n=== Summary ===");
  for (const r of results) {
    console.log(`  ${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.detail ? " — " + r.detail : ""}`);
  }
  console.log(`\n=== OVERALL: ${allPass ? "PASS" : "FAIL"} ===`);
  process.exit(allPass ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
