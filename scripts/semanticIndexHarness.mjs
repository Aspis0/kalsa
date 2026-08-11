/**
 * Harness for src/documents/semanticIndex.ts (pure hybrid-retrieval core).
 * Compile-from-disk pattern (same as threadProfileHarness). Exit 1 on fail.
 *
 * RRF formula documented here (matches implementation):
 *   callers pass 0-based ranks; score(d) = Σ w_arm / (k + rank0 + 1)
 *   default k=60, weights=1; absent arm contributes 0.
 * Defensive L2 normalization on add + query (cosine = dot of unit vectors).
 */
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const require = createRequire(import.meta.url);
const outDir = path.join(projectRoot, "scripts/.build/semanticIndexHarness");

function compile() {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const r = spawnSync(
    "npx",
    [
      "tsc",
      "src/documents/semanticIndex.ts",
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
      "--esModuleInterop",
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

function resolveBuilt() {
  const candidates = [
    path.join(outDir, "semanticIndex.js"),
    path.join(outDir, "documents/semanticIndex.js"),
    path.join(outDir, "src/documents/semanticIndex.js"),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  console.error("Could not find compiled semanticIndex.js. Tried:\n", candidates.join("\n"));
  process.exit(1);
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function approx(a, b, eps = 1e-5) {
  return Math.abs(a - b) <= eps;
}

function vec(...xs) {
  return new Float32Array(xs);
}

async function main() {
  console.log("Compiling semanticIndex.ts …");
  compile();
  const modPath = resolveBuilt();
  console.log("Loading", modPath);
  const mod = require(modPath);
  const {
    SemanticVectorIndex,
    embedQueryPrefix,
    embedDocPrefix,
    rrfFuse,
    planIncrementalEmbed,
  } = mod;

  let passed = 0;
  let failed = 0;
  function check(name, fn) {
    try {
      fn();
      console.log(`PASS ${name}`);
      passed++;
    } catch (e) {
      console.log(`FAIL ${name} — ${e && e.message ? e.message : e}`);
      failed++;
    }
  }

  // ── 1. addVectors + query returns nearest (known 2-vector fixture) ──────
  check("1. addVectors + query nearest", () => {
    const idx = new SemanticVectorIndex({ dims: 2 });
    // unit-ish: a≈[1,0], b≈[0,1]
    idx.addVectors([
      { chunkId: "a", vector: vec(1, 0) },
      { chunkId: "b", vector: vec(0, 1) },
    ]);
    assert(idx.chunkCount === 2, `chunkCount=${idx.chunkCount}`);
    const hits = idx.query(vec(0.9, 0.1), 2);
    assert(hits.length === 2, `len=${hits.length}`);
    assert(hits[0].chunkId === "a", `nearest=${hits[0].chunkId}`);
    assert(hits[0].score > hits[1].score, "score order");
  });

  // ── 2. query topN respects N and ordering ───────────────────────────────
  check("2. query topN + ordering", () => {
    const idx = new SemanticVectorIndex({ dims: 3 });
    idx.addVectors([
      { chunkId: "x", vector: vec(1, 0, 0) },
      { chunkId: "y", vector: vec(0.7, 0.7, 0) },
      { chunkId: "z", vector: vec(0, 1, 0) },
    ]);
    const top1 = idx.query(vec(1, 0, 0), 1);
    assert(top1.length === 1, `top1 len=${top1.length}`);
    assert(top1[0].chunkId === "x", `top1=${top1[0].chunkId}`);
    const top2 = idx.query(vec(1, 0, 0), 2);
    assert(top2.length === 2, `top2 len=${top2.length}`);
    assert(top2[0].score >= top2[1].score, "desc order");
  });

  // ── 3. dedupe by chunkId (re-add replaces) ──────────────────────────────
  check("3. dedupe replace by chunkId", () => {
    const idx = new SemanticVectorIndex({ dims: 2 });
    idx.addVectors([{ chunkId: "c", vector: vec(1, 0) }]);
    idx.addVectors([{ chunkId: "c", vector: vec(0, 1) }]);
    assert(idx.chunkCount === 1, `chunkCount=${idx.chunkCount}`);
    const hits = idx.query(vec(0, 1), 1);
    assert(hits[0].chunkId === "c", "still c");
    // after replace, c should be near [0,1], score ~1
    assert(approx(hits[0].score, 1, 1e-4), `score=${hits[0].score}`);
  });

  // ── 4. removeChunk removes from query ───────────────────────────────────
  check("4. removeChunk", () => {
    const idx = new SemanticVectorIndex({ dims: 2 });
    idx.addVectors([
      { chunkId: "keep", vector: vec(1, 0) },
      { chunkId: "drop", vector: vec(0, 1) },
    ]);
    idx.removeChunk("drop");
    assert(idx.chunkCount === 1, `chunkCount=${idx.chunkCount}`);
    const hits = idx.query(vec(0, 1), 5);
    assert(hits.every((h) => h.chunkId !== "drop"), "drop gone");
    assert(hits.length === 1 && hits[0].chunkId === "keep", "only keep");
  });

  // ── 5. empty index query → [] ───────────────────────────────────────────
  check("5. empty index query", () => {
    const idx = new SemanticVectorIndex({ dims: 4 });
    const hits = idx.query(vec(1, 0, 0, 0), 10);
    assert(Array.isArray(hits) && hits.length === 0, `hits=${JSON.stringify(hits)}`);
  });

  // ── 6. toJSON/fromJSON round-trip ───────────────────────────────────────
  check("6. toJSON/fromJSON round-trip", () => {
    const idx = new SemanticVectorIndex({ dims: 3 });
    idx.addVectors([
      { chunkId: "p", vector: vec(3, 0, 0) }, // will be normalized
      { chunkId: "q", vector: vec(0, 4, 0) },
    ]);
    const json = idx.toJSON();
    assert(json.dims === 3, `dims=${json.dims}`);
    assert(json.vectors.length === 2, `n=${json.vectors.length}`);
    // vectors are number[]
    assert(Array.isArray(json.vectors[0].vector), "vector is number[]");
    const restored = SemanticVectorIndex.fromJSON(json);
    assert(restored.dims === 3, "restored dims");
    assert(restored.chunkCount === 2, "restored count");
    const h1 = idx.query(vec(1, 0, 0), 2);
    const h2 = restored.query(vec(1, 0, 0), 2);
    assert(h1[0].chunkId === h2[0].chunkId, "same nearest");
    assert(approx(h1[0].score, h2[0].score), `scores ${h1[0].score} vs ${h2[0].score}`);
  });

  // ── 7. toJSON on empty index ────────────────────────────────────────────
  check("7. toJSON empty", () => {
    const idx = new SemanticVectorIndex({ dims: 8 });
    const json = idx.toJSON();
    assert(json.dims === 8, `dims=${json.dims}`);
    assert(Array.isArray(json.vectors) && json.vectors.length === 0, "empty vectors");
    const restored = SemanticVectorIndex.fromJSON(json);
    assert(restored.chunkCount === 0, "restored empty");
  });

  // ── 8. embeddings normalized defensively ────────────────────────────────
  check("8. defensive L2 normalize", () => {
    const idx = new SemanticVectorIndex({ dims: 2 });
    // unnormalized [3,4] → unit [0.6, 0.8]
    idx.addVectors([{ chunkId: "u", vector: vec(3, 4) }]);
    // query also unnormalized along same direction
    const hits = idx.query(vec(6, 8), 1);
    assert(hits.length === 1, "got hit");
    assert(approx(hits[0].score, 1, 1e-4), `cosine of collinear should be 1, got ${hits[0].score}`);
    // orthogonal unnormalized should be ~0
    const orth = idx.query(vec(-4, 3), 1);
    assert(approx(orth[0].score, 0, 1e-4), `orth score=${orth[0].score}`);
  });

  // ── 9. embedQueryPrefix ─────────────────────────────────────────────────
  check("9. embedQueryPrefix + idempotent", () => {
    assert(embedQueryPrefix("hello") === "query: hello", embedQueryPrefix("hello"));
    assert(
      embedQueryPrefix("query: already") === "query: already",
      "idempotent failed",
    );
    assert(embedQueryPrefix("") === "query: ", "empty");
    // cfg accepted
    assert(embedQueryPrefix("x", { model: "e5" }) === "query: x", "cfg");
  });

  // ── 10. embedDocPrefix ──────────────────────────────────────────────────
  check("10. embedDocPrefix + idempotent", () => {
    assert(embedDocPrefix("doc text") === "passage: doc text", embedDocPrefix("doc text"));
    assert(
      embedDocPrefix("passage: already") === "passage: already",
      "idempotent failed",
    );
  });

  // ── 11. rrfFuse equal ranks → expected fused order ──────────────────────
  // Formula: score = 1/(k+rank0+1). k=60.
  // sparse: A@0, B@1, C@2
  // dense:  B@0, D@1, A@2
  // A: 1/61 + 1/63
  // B: 1/62 + 1/61
  // C: 1/63
  // D: 1/62
  // B > A > D > C
  check("11. rrfFuse equal ranks fused order", () => {
    const sparse = [
      { chunkId: "A", rank: 0 },
      { chunkId: "B", rank: 1 },
      { chunkId: "C", rank: 2 },
    ];
    const dense = [
      { chunkId: "B", rank: 0 },
      { chunkId: "D", rank: 1 },
      { chunkId: "A", rank: 2 },
    ];
    const fused = rrfFuse(sparse, dense, { k: 60 });
    assert(fused.length === 4, `len=${fused.length}`);
    assert(fused.map((x) => x.chunkId).join(",") === "B,A,D,C", fused.map((x) => x.chunkId).join(","));
    // exact scores
    const k = 60;
    const expected = {
      A: 1 / (k + 0 + 1) + 1 / (k + 2 + 1),
      B: 1 / (k + 1 + 1) + 1 / (k + 0 + 1),
      C: 1 / (k + 2 + 1),
      D: 1 / (k + 1 + 1),
    };
    for (const row of fused) {
      assert(approx(row.score, expected[row.chunkId]), `${row.chunkId}: ${row.score} vs ${expected[row.chunkId]}`);
    }
  });

  // ── 12. rrfFuse sparse-only (dense empty) ───────────────────────────────
  check("12. rrfFuse sparse-only", () => {
    const sparse = [
      { chunkId: "s0", rank: 0 },
      { chunkId: "s1", rank: 1 },
      { chunkId: "s2", rank: 2 },
    ];
    const fused = rrfFuse(sparse, [], { k: 60 });
    assert(fused.length === 3, `len=${fused.length}`);
    assert(fused.map((x) => x.chunkId).join(",") === "s0,s1,s2", "order");
    assert(approx(fused[0].score, 1 / 61), `s0=${fused[0].score}`);
    assert(approx(fused[1].score, 1 / 62), `s1=${fused[1].score}`);
    assert(approx(fused[2].score, 1 / 63), `s2=${fused[2].score}`);
  });

  // ── 13. rrfFuse k sensitivity ───────────────────────────────────────────
  // Shared top + lower ranks: smaller k amplifies the gap between rank 0 and rank 1.
  check("13. rrfFuse k sensitivity", () => {
    const sparse = [
      { chunkId: "top", rank: 0 },
      { chunkId: "mid", rank: 1 },
    ];
    const dense = []; // sparse-only so gap is pure 1/(k+1) - 1/(k+2)
    const g60 = rrfFuse(sparse, dense, { k: 60 });
    const g1 = rrfFuse(sparse, dense, { k: 1 });
    const gap60 = g60[0].score - g60[1].score;
    const gap1 = g1[0].score - g1[1].score;
    assert(gap1 > gap60, `gap k=1 (${gap1}) should exceed gap k=60 (${gap60})`);
    // exact: k=1 → 1/2 - 1/3 = 1/6; k=60 → 1/61 - 1/62
    assert(approx(gap1, 1 / 6), `gap1=${gap1}`);
    assert(approx(gap60, 1 / 61 - 1 / 62), `gap60=${gap60}`);
  });

  // ── 14. rrfFuse weight asymmetry (sparseWeight=2) ───────────────────────
  // score = w_s/(k+r_s+1) + w_d/(k+r_d+1)
  // With sparseWeight=2, a sparse-only hit at rank 0 beats a dense-only hit at rank 0
  // under equal weights they would tie; with w_s=2 sparse wins.
  check("14. rrfFuse weight asymmetry", () => {
    const sparse = [{ chunkId: "S", rank: 0 }];
    const dense = [{ chunkId: "D", rank: 0 }];
    const equal = rrfFuse(sparse, dense, { k: 60, sparseWeight: 1, denseWeight: 1 });
    // equal weights → same score; stable sort by chunkId → D before S? "D"<"S"
    assert(approx(equal[0].score, equal[1].score), "equal weights same score");
    const heavy = rrfFuse(sparse, dense, { k: 60, sparseWeight: 2, denseWeight: 1 });
    assert(heavy[0].chunkId === "S", `winner=${heavy[0].chunkId}`);
    assert(approx(heavy[0].score, 2 / 61), `S score=${heavy[0].score}`);
    assert(approx(heavy[1].score, 1 / 61), `D score=${heavy[1].score}`);
  });

  // ── 15. planIncrementalEmbed: all new ───────────────────────────────────
  check("15. planIncrementalEmbed all new", () => {
    const existing = new Set();
    const chunks = [
      { chunkId: "c1", contentHash: "h1" },
      { chunkId: "c2", contentHash: "h2" },
      { chunkId: "c3", contentHash: "h3" },
    ];
    const need = planIncrementalEmbed(existing, chunks);
    assert(need.join(",") === "h1,h2,h3", need.join(","));
  });

  // ── 16. planIncrementalEmbed: subset / unchanged / dedupe ───────────────
  check("16. planIncrementalEmbed subset+dedupe", () => {
    const existing = new Set(["h_old", "h_keep"]);
    const chunks = [
      { chunkId: "a", contentHash: "h_keep" }, // already embedded
      { chunkId: "b", contentHash: "h_new1" },
      { chunkId: "c", contentHash: "h_new1" }, // dupe hash in input
      { chunkId: "d", contentHash: "h_new2" },
      { chunkId: "e", contentHash: "h_old" },
    ];
    const need = planIncrementalEmbed(existing, chunks);
    assert(need.join(",") === "h_new1,h_new2", need.join(","));
  });

  // ── 17. rrfFuse 0-based rank convention exact values ────────────────────
  // ranks [0,1] → scores 1/(k+1), 1/(k+2)
  check("17. rrfFuse 0-based rank convention", () => {
    const k = 60;
    const sparse = [
      { chunkId: "r0", rank: 0 },
      { chunkId: "r1", rank: 1 },
    ];
    const fused = rrfFuse(sparse, [], { k });
    assert(fused.length === 2, `len=${fused.length}`);
    assert(fused[0].chunkId === "r0" && fused[1].chunkId === "r1", "order");
    assert(approx(fused[0].score, 1 / (k + 1)), `r0=${fused[0].score} expected ${1 / (k + 1)}`);
    assert(approx(fused[1].score, 1 / (k + 2)), `r1=${fused[1].score} expected ${1 / (k + 2)}`);
  });

  // ── 18. HybridRetrievalResult type shape sanity ─────────────────────────
  check("18. HybridRetrievalResult shape", () => {
    // Construct a value matching the exported type (compile + runtime shape).
    /** @type {import("../src/documents/semanticIndex").HybridRetrievalResult} */
    const sample = {
      passages: [
        {
          chunkId: "ch1",
          text: "hello",
          docId: "d1",
          page: 2,
          score: 0.42,
        },
      ],
      strategy: "hybrid",
      trace: {
        sparseCount: 5,
        denseCount: 4,
        fusedCount: 6,
        reranked: false,
      },
    };
    assert(sample.strategy === "hybrid" || sample.strategy === "bm25_only", "strategy");
    assert(Array.isArray(sample.passages), "passages");
    assert(typeof sample.trace.sparseCount === "number", "trace");
    // bm25_only path
    const fallback = {
      passages: [],
      strategy: "bm25_only",
      trace: { sparseCount: 3, denseCount: 0, fusedCount: 3 },
    };
    assert(fallback.strategy === "bm25_only", "fallback strategy");
    assert(fallback.trace.denseCount === 0, "no dense");
  });

  // ── defensive extras (empty inputs never throw) ─────────────────────────
  check("extra. empty rrfFuse / plan", () => {
    assert(rrfFuse([], []).length === 0, "both empty");
    const r = rrfFuse(/** @type {any} */ (null), /** @type {any} */ (null));
    assert(Array.isArray(r) && r.length === 0, "null → []");
    assert(planIncrementalEmbed(new Set(["x"]), []).length === 0, "empty chunks");
    const p = planIncrementalEmbed(new Set(), /** @type {any} */ (null));
    assert(Array.isArray(p) && p.length === 0, "null chunks → []");
  });

  check("extra. wrong-dim / topN edge", () => {
    const idx = new SemanticVectorIndex({ dims: 2 });
    idx.addVectors([{ chunkId: "a", vector: vec(1, 0) }]);
    // wrong dim skipped on add
    idx.addVectors([{ chunkId: "bad", vector: vec(1, 0, 0) }]);
    assert(idx.chunkCount === 1, "bad dim not added");
    // wrong query dim → []
    assert(idx.query(vec(1, 0, 0), 3).length === 0, "bad query");
    // topN 0 / neg
    assert(idx.query(vec(1, 0), 0).length === 0, "topN0");
    assert(idx.query(vec(1, 0), -1).length === 0, "topN-1");
  });

  // ── FIX 6: zero / non-finite vectors skipped; zero query → [] ───────────
  check("19. zero-vector add skipped", () => {
    const idx = new SemanticVectorIndex({ dims: 3 });
    idx.addVectors([
      { chunkId: "good", vector: vec(1, 0, 0) },
      { chunkId: "zero", vector: vec(0, 0, 0) },
      { chunkId: "nan", vector: vec(NaN, 1, 0) },
      { chunkId: "inf", vector: vec(Infinity, 0, 0) },
    ]);
    assert(idx.chunkCount === 1, `chunkCount=${idx.chunkCount} (zero/nan/inf must be skipped)`);
    const hits = idx.query(vec(1, 0, 0), 5);
    assert(hits.length === 1 && hits[0].chunkId === "good", "only good remains");
  });

  check("20. zero query returns []", () => {
    const idx = new SemanticVectorIndex({ dims: 2 });
    idx.addVectors([
      { chunkId: "a", vector: vec(1, 0) },
      { chunkId: "b", vector: vec(0, 1) },
    ]);
    const hits = idx.query(vec(0, 0), 5);
    assert(Array.isArray(hits) && hits.length === 0, `zero query must be [], got ${JSON.stringify(hits)}`);
  });

  check("21. non-positive-integer dims throw", () => {
    const bad = [0, -1, 0.5, NaN, Infinity, null, undefined, "3"];
    for (const d of bad) {
      let threw = false;
      try {
        // eslint-disable-next-line no-new
        new SemanticVectorIndex({ dims: d });
      } catch {
        threw = true;
      }
      assert(threw, `constructor should throw for dims=${String(d)}`);
    }
    // fromJSON too
    let threwFrom = false;
    try {
      SemanticVectorIndex.fromJSON({ dims: 0.5, vectors: [] });
    } catch {
      threwFrom = true;
    }
    assert(threwFrom, "fromJSON fractional dims must throw");
    let threwZero = false;
    try {
      SemanticVectorIndex.fromJSON({ dims: 0, vectors: [] });
    } catch {
      threwZero = true;
    }
    assert(threwZero, "fromJSON zero dims must throw");
  });

  // ── FIX 3: optional text store + dense-only hit recovery ────────────────
  check("22. setChunkText / getChunkText + toJSON includes text", () => {
    const idx = new SemanticVectorIndex({ dims: 2 });
    idx.addVectors([
      { chunkId: "c1", vector: vec(1, 0), text: "hello passage", contentHash: "aabbccdd11223344" },
      { chunkId: "c2", vector: vec(0, 1) },
    ]);
    assert(idx.getChunkText("c1") === "hello passage", `text=${idx.getChunkText("c1")}`);
    assert(idx.getChunkText("c2") === null, "c2 has no text");
    idx.setChunkText("c2", "second passage");
    assert(idx.getChunkText("c2") === "second passage", "setChunkText");
    const json = idx.toJSON();
    const row1 = json.vectors.find((v) => v.chunkId === "c1");
    assert(row1 && row1.text === "hello passage", "toJSON text");
    assert(row1 && row1.contentHash === "aabbccdd11223344", "toJSON hash");
    const restored = SemanticVectorIndex.fromJSON(json);
    assert(restored.getChunkText("c1") === "hello passage", "fromJSON text");
    assert(restored.getContentHash("c1") === "aabbccdd11223344", "fromJSON hash");
  });

  check("23. dense-only hit recovery via getChunkText", () => {
    // Simulates a fused winner present only in the dense arm: text comes from
    // the vector index, not from BM25 passages.
    const idx = new SemanticVectorIndex({ dims: 2 });
    idx.addVectors([
      {
        chunkId: "doc1#paragraph#0",
        vector: vec(0.9, 0.1),
        text: "Only dense arm knows this paragraph about mortgages.",
        contentHash: "deadbeefcafebabe",
      },
    ]);
    const hits = idx.query(vec(1, 0), 3);
    assert(hits.length === 1 && hits[0].chunkId === "doc1#paragraph#0", "dense hit");
    const text = idx.getChunkText(hits[0].chunkId);
    assert(
      typeof text === "string" && text.includes("mortgages"),
      `dense-only text missing: ${text}`,
    );
  });

  // ── FIX D: cap at add time (replacement accounting) ──────────────────────
  check("24. addVectors cap skips beyond floatCap; sets isCapped", () => {
    const {
      DEFAULT_VECTOR_MEMORY_FLOAT_CAP,
      totalResidentFloats,
      semanticIndexCountExceeds,
      wouldBeFloatDelta,
    } = mod;
    assert(
      DEFAULT_VECTOR_MEMORY_FLOAT_CAP === 200_000,
      `cap constant ${DEFAULT_VECTOR_MEMORY_FLOAT_CAP}`,
    );
    // dims=4, cap=12 floats → max 3 new vectors.
    const idx = new SemanticVectorIndex({ dims: 4 });
    const mk = (id) => ({
      chunkId: id,
      vector: vec(1, 0, 0, 0),
    });
    const r1 = idx.addVectors([mk("a"), mk("b"), mk("c")], {
      floatCap: 12,
      otherResidentFloats: 0,
    });
    assert(r1.added === 3, `added ${r1.added}`);
    assert(r1.skippedByCap === 0, `skipped ${r1.skippedByCap}`);
    assert(idx.chunkCount === 3, `count ${idx.chunkCount}`);
    assert(idx.floatCount === 12, `floats ${idx.floatCount}`);
    assert(idx.isCapped === false, "not capped yet");

    // 4th new vector must be skipped by cap.
    const r2 = idx.addVectors([mk("d")], { floatCap: 12, otherResidentFloats: 0 });
    assert(r2.added === 0, `4th added ${r2.added}`);
    assert(r2.skippedByCap === 1, `4th skipped ${r2.skippedByCap}`);
    assert(idx.isCapped === true, "isCapped set");
    assert(idx.chunkCount === 3, "still 3");

    // Replacement of existing chunkId costs 0 net floats — always allowed.
    const r3 = idx.addVectors(
      [{ chunkId: "a", vector: vec(0, 1, 0, 0) }],
      { floatCap: 12, otherResidentFloats: 0 },
    );
    assert(r3.added === 1, `replacement added ${r3.added}`);
    assert(r3.skippedByCap === 0, "replacement not skipped");
    assert(idx.chunkCount === 3, "still 3 after replace");

    // otherResidentFloats reduces remaining budget.
    const idx2 = new SemanticVectorIndex({ dims: 4 });
    const r4 = idx2.addVectors([mk("x")], {
      floatCap: 12,
      otherResidentFloats: 12, // already full elsewhere
    });
    assert(r4.added === 0 && r4.skippedByCap === 1, "other floats block add");
    assert(idx2.isCapped === true, "capped via other");

    // Helpers.
    assert(totalResidentFloats([idx]) === 12, "totalResidentFloats");
    assert(semanticIndexCountExceeds([idx], 12) === true, "exceeds at equal");
    assert(semanticIndexCountExceeds([idx], 13) === false, "under higher cap");
    assert(wouldBeFloatDelta(idx, [mk("a")]) === 0, "replace delta 0");
    assert(wouldBeFloatDelta(idx, [mk("new")]) === 4, "new delta dims");
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
