# q43 — Hostile MATH AUDIT (Q8_0-trunk multilingual PPL gate)

Auditor: independent re-computation from raw artifacts. Everything re-derived from
`logs/*.json`, `logs/*.log`, `verify_arms.json`, `corpus/*.txt`, the two GGUF files
on disk, and the q41 reuse source — **not** from REPORT.md. Format:
CONFIRMED / REFUTED per claim; final verdict at the end.

**Bottom line: all measurement claims verify. Two operations-prose runtime
figures in REPORT.md §5 are refuted (do not affect the gate verdict).**
Final verdict: **ISSUES** (minor, ops-only; the gate itself is CLEAN).

---

## 1. Per-corpus d, verdicts, overall rule (PREREG thresholds)

Recomputed `d = 100·(P_q8 − P_ctrl)/P_ctrl` from raw JSON ppl values (control-wiki
taken from the q41 reused JSON, per prereg):

| corpus | d (full precision) | REPORT value | verdict (d≤+0.5 PASS; ≤+1.0 GREY; >+1.0 FAIL) |
|---|---:|---:|---|
| wiki | −1.08429338 % | −1.084 % | **PASS** |
| it | −0.57313814 % | −0.573 % | **PASS** |
| es | −0.60477971 % | −0.605 % | **PASS** |
| fr | −0.66211816 % | −0.662 % | **PASS** |
| zh | −1.34067969 % | −1.341 % | **PASS** |

- Signs: all negative ✓. Rounding: all five match the report to 3 decimals ✓.
- Mapping: all d ≤ −0.57 %, i.e. far inside PASS; boundary semantics of the
  prereg table (≤ vs <) are correctly implemented in `_math_check.py`.
- Overall rule: `all(v==PASS)` → **PASS** ✓ (prereg: PASS ⇔ all five PASS).
- `_math_check.py` regenerated in isolation: output **byte-identical** to the
  committed `_math_check.txt` (LINES IDENTICAL: True) — the txt is generated,
  not hand-authored. The script asserts rc==0, n_chunks≥100 per corpus, and
  reads PPL from the JSONs (which themselves are parsed from the logs — see §2).

⇒ **1: CONFIRMED** (all five deltas, signs, rounding, verdict mapping, overall rule).

## 2. JSON ↔ log cross-check; rc; CMD lines

Parsed every `logs/*.log` myself. "Final estimate" lines vs JSON:

| log | Final estimate (log) | JSON ppl / ppl_err | chunks (log) | JSON n | rc |
|---|---|---|---:|---:|---:|
| control-es | 6.1510 ± 0.05993 | 6.151 / 0.05993 | 267 | 267 | 0 |
| control-fr | 6.4490 ± 0.06307 | 6.449 / 0.06307 | 259 | 259 | 0 |
| control-it | 5.9497 ± 0.05490 | 5.9497 / 0.0549 | 284 | 284 | 0 |
| control-zh | 11.0168 ± 0.11967 | 11.0168 / 0.11967 | 265 | 265 | 0 |
| q8_0-es | 6.1138 ± 0.05973 | 6.1138 / 0.05973 | 267 | 267 | 0 |
| q8_0-fr | 6.4063 ± 0.06273 | 6.4063 / 0.06273 | 259 | 259 | 0 |
| q8_0-it | 5.9156 ± 0.05476 | 5.9156 / 0.05476 | 284 | 284 | 0 |
| q8_0-wiki | 9.4875 ± 0.07073 | 9.4875 / 0.07073 | 584 | 584 | 0 |
| q8_0-zh | 10.8691 ± 0.11789 | 10.8691 / 0.11789 | 265 | 265 | 0 |

- All 9 match exactly. `ppl` values enter the JSON via `run_ppl.py` regex-parse
  of the log ("Final estimate: PPL = x +/- y") — no hand transcription path.
- Every CMD line in every log matches the locked settings verbatim:
  `-c 512 -b 512 -ub 512 -t 16 -ngl 0 --chunks -1 --ppl-stride 0`.
- Model per arm correct in all 9 (control cells → `…trunk-control.gguf`,
  q8_0 cells → `…trunk-q8_0.gguf`); rc=0 in all 9 JSONs, and the pipeline log
  (`logs/q43-pipeline.log`) shows `PY rc=0` after every one of the 11 steps
  (dl-poll ×10, cook, verify, 9 PPL cells).
- Reused control-wiki: q41 JSON rc=0 as well.

⇒ **2: CONFIRMED** (9/9 JSON values traced to log "Final estimate" lines, rc=0
everywhere, locked CMD lines, correct model per arm).

## 3. Reused control-wiki (q41)

- q41 `ppl-control-wiki.json`: ppl **9.5915**, ppl_err **0.07116**, n_chunks
  **584**, rc=0 — matches the prereg declaration exactly. Its log agrees:
  "Final estimate: PPL = 9.5915 +/- 0.07116", "over 584 chunks".
- q43 `ppl-q8_0-wiki.json` uses the **same corpus file** by path
  (`q41-ppl-gate/corpus/wikitext-2-raw/wiki.test.raw`), file_bytes 1 290 590 ==
  disk size; sha256 on disk = `173c87a53759…7dd08` == PREREG pin ✓.
- Binary reuse condition verified on disk: `llama-perplexity.exe` 10 752 B +
  `llama-perplexity-impl.dll` 342 016 B, mtime 2026-08-23 15:46 — exactly the
  values REPORT §3 quotes; the mtime predates both the q41 runs (17:15 ff.) and
  all q43 runs. Note: the prereg's "mtime/size check logged" is *not* present as
  a line in `q43-pipeline.log`; the check values are quoted in REPORT and are
  true on disk today, but there is no independent pre-run log artifact of it.
  Traceability-only nit, no measurement impact.
- Control gguf on disk (`…trunk-control.gguf`) has mtime 12:49 (predates this
  cell) — consistent with "NOT recooked, NOT overwritten"; sha256 computed
  now = `f3e2826f78c78452afa0765613875c806f1ca3976f1f59ff4e8ff85bea5782ea` ==
  REPORT/PREREG pin ✓.

⇒ **3: CONFIRMED** (with one traceability nit: binary check not separately logged).

## 4. verify_arms: delta, expert sha, tensor types

- `100·(6509642624 − 6385238912)/6385238912` recomputed =
  **1.9483016017803783 %** — byte-identical to `verify_arms.json` `delta_pct`
  and to the q36 prediction (q36 REPORT.md: +124 403 712 B, +1.948 %).
  Delta bytes 124 403 712 ✓. Note: q36's *total* row (6 509 642 560 B) is
  payload-exclusive; realized disk size 6 509 642 624 B differs by the 64 B
  GGUF header (q36's own baseline column is likewise 64 B under the disk size).
  The q43 claim is about the **delta**, which matches to the byte — the 64 B is
  a q36-table convention, not a q43 error.
- Expert sha: `verify_arms.json` **asserts** `expert_sha_match: true`,
  q8_0 `expert_sha256 = d84c4b43b24384648b1036e043973655b3092d4ebdf6cb62bb8de18f3cc2c74d`
  == control's, `all_ok: true`; and `verify_arms.py` *computes* that hash
  (name+payload of ffn_gate/up/down_exps tensors) rather than reading a stored
  string. Same value as q41's own verify_arms.json (control + both variants) —
  the "== shipped KEXP == q37/q41" chain holds.
- Tensor types: control {F32 141, Q5_K 113, Q3_K 28, Q2_K 56} → q8_0
  {F32 141, Q8_0 113, Q3_K 28, Q2_K 56}; the script's `trunk_type_bad` list is
  empty, i.e. every trunk-role tensor in the control arm exists in q8_0 with
  type Q8_0, and the tensor-name sets are equal. 56+28 = 84 expert tensors,
  113 trunk tensors ✓.

⇒ **4: CONFIRMED** (delta recomputed to full precision; sha equality asserted in
JSON and enforced by code; types consistent).

## 5. Chunk floors and cross-arm n_chunks equality

| corpus | control n | q8_0 n | equal? | ≥100? |
|---|---:|---:|---|---|
| wiki | 584 | 584 | yes | yes |
| it | 284 | 284 | yes | yes |
| es | 267 | 267 | yes | yes |
| fr | 259 | 259 | yes | yes |
| zh | 265 | 265 | yes | yes |

No cross-arm n_chunks mismatch anywhere (a mismatch would have been a finding;
there is none). Both arms processed identical chunk counts on every corpus —
a necessary condition for the paired/directional reading of the deltas.

⇒ **5: CONFIRMED**.

## 6. Corpus byte sizes: REPORT ↔ MANIFEST ↔ disk

Computed sizes and sha256 on disk for all four new corpora:

| file | disk bytes | MANIFEST | REPORT | sha256 (disk) | MANIFEST/REPORT prefix |
|---|---:|---|---|---|---|
| it.txt | 480 565 | 480,565 ✓ | 480 565 ✓ | fddf963377e1a90c…2027aac | fddf963377e1… ✓ |
| es.txt | 492 128 | 492,128 ✓ | 492 128 ✓ | 45b4bdbf62de82f8…146915 | 45b4bdbf62de… ✓ |
| fr.txt | 454 357 | 454,357 ✓ | 454 357 ✓ | c477f06d166a387f…a924f0e | c477f06d166a… ✓ |
| zh.txt | 487 776 | 487,776 ✓ | 487 776 ✓ | 234fe0fdfa878583…a5c606 | 234fe0fdfa87… ✓ |

All four match on bytes AND sha. wiki.test.raw: 1 290 590 B, sha
173c87a5… ✓. Freeze-before-use: file mtimes 20:02–20:05, MANIFEST 20:05 —
all before the first corpus PPL run (control-it, 20:51:42). Article counts in
REPORT (11 it / 12 es / 10 fr / 11 zh) match MANIFEST.

⇒ **6: CONFIRMED**.

## 7. Prose arithmetic in REPORT.md

- "+124,403,712 B" at "+1.948 % file size": ✓ (6 509 642 624 − 6 385 238 912).
- "matching the q36 prediction (+124 MB) to the byte": ✓ (see §4; the 64 B
  total-size nuance is a q36 table convention, delta matches exactly).
- "trunk carries … its 3.6 % byte share": ✓ (228 073 472 / 6 385 238 912 =
  3.57 %, same figure q36 quotes).
- q41 contrast recomputed from q41 JSONs: IQ4_NL
  `100·(10.0013−9.5915)/9.5915 = +4.272533 %` → **+4.273 %** ✓; Q4_0
  `100·(10.3646−9.5915)/9.5915 = +8.060262 %` → **+8.060 %** ✓; Q8_0 −1.084 % ✓.
- "improvement is largest on ZH and EN": ✓ (|d| 1.341 > 1.084 > 0.662 > 0.605 > 0.573).
- Gate table PPL± values in REPORT are 4-dp roundings of the JSON values: ✓.
- Source/imatrix sizes + shas in §1: ✓ (dl log: 18 356 453 952 B
  3287457af7…, 81 548 704 B f05d4d4a…; both shas match on the re-download).
- "17.2 GB" for source+imatrix: ✓ (18 438 002 656 B = 17.17 GiB).

**REFUTED prose claims (both ops/runtime, §5):**
- **"language cells 6–13 min each" — REFUTED.** Every one of the 8 language
  cells ran 16.88–23.98 min by JSON `wall_s` AND by pipeline-log wall clock
  (e.g. control-it 20:51:42→21:15:41 = 23:59; q8_0-fr 22:38:36→22:55:29 =
  16:53). No cell is in the 6–13 min range.
- **"total pipeline ~3 h 20 min" — REFUTED.** Pipeline log spans 19:39:49 →
  23:32:11 = **3 h 52 min** (3 h 56 min from dl start 19:36:09); the 9 fresh
  PPL cells alone sum to 12 595 s = **3.50 h** — already longer than the claim.
- The other §5 figures check out: download+sha 13 m 21 s ("~14 min", ✓),
  cook 596 s ≈ 10 min (✓), verify 87 s (✓, 19:59:47→20:01:14), wiki(q8)
  49 m 27 s ("49.5 min", ✓), "rc=0 everywhere" (✓), disk "145 GB at start"
  (145.29 pre-download in dl log, ✓) and "≥ 108 GB throughout" (min observed
  121.69 GB post-cook, ✓ conservative).

⇒ **7: CONFIRMED for all arithmetic claims; REFUTED for the two §5 runtime
figures (6–13 min/cell and ~3 h 20 min total).** Neither touches the gate math.

## 8. Statistical honesty

- The report makes **no statistical-significance claim anywhere** — no p-values,
  no "significantly", no formal test. Its claims are (a) the preregistered
  threshold verdict (PASS ⇔ all five d ≤ +0.5 %) and (b) directional statements
  ("better… on every corpus", "improvement largest on ZH and EN"), both true of
  the measured values.
- Noise context: within-arm SEs are 0.055–0.12 in PPL. Under a **naive
  independent-groups** read the wiki delta (−1.084 %) is only
  z = 0.104/sqrt(0.07073²+0.07116²) = 1.04 (p ≈ 0.30) and IT (−0.573 %) is
  z ≈ 0.44 — i.e. each delta alone is inside naive noise. The prereg rationale
  (and the audit instruction) is that chunk-level PPL errors on identical
  chunks are highly correlated between arms, so naive SEs overstate the
  difference; llama-perplexity does not emit per-chunk data here, and the
  report correctly does **not** fabricate a paired test it cannot run.
- What can be said honestly: 5/5 deltas negative and below the +0.5 % line with
  ≥ 0.57-pt margin on the weakest (IT); sign consistency across languages
  (sign-test p = 0.031 under independence) plus the strictly-higher-precision
  prior make PASS a robust decision under either noise model.
- **No overclaim found.** Flag for downstream documents: "better" is a
  directional, prereg-threshold verdict — do not cite q43 as demonstrating
  statistical significance of the PPL difference (e.g. "significantly lower
  PPL" would be an overclaim).

⇒ **8: CONFIRMED (no overclaim; one downstream-usage caveat recorded).**

---

## Summary table

| # | claim | verdict |
|---|---|---|
| 1 | per-corpus d (5), signs, rounding, PASS mapping, overall PASS | CONFIRMED |
| 2 | JSON ppl/err/n_chunks ↔ log "Final estimate"; rc=0; locked CMD; model per arm | CONFIRMED |
| 3 | q41 control-wiki 9.5915±0.07116/584; same corpus file path+bytes+sha in q8_0-wiki | CONFIRMED (nit: binary check not separately logged) |
| 4 | verify_arms delta +1.9483016018…%; expert sha asserted in JSON; types 113/141/56/28 | CONFIRMED |
| 5 | all corpora ≥100 chunks, n_chunks equal across arms | CONFIRMED |
| 6 | corpus bytes REPORT ↔ MANIFEST ↔ disk (4 files + wiki) | CONFIRMED |
| 7a | prose arithmetic: +124 403 712 B, +1.948 %, q36-to-the-byte, 3.6 % share, q41 +4.273/+8.060, 17.2 GB | CONFIRMED |
| 7b | "language cells 6–13 min each"; "total pipeline ~3 h 20 min" | **REFUTED** (actual 16.9–24.0 min/cell; 3 h 52 min total) |
| 8 | statistical honesty / no overclaim | CONFIRMED (caveat recorded) |

## Final verdict: **ISSUES**

The measured gate is fully verified: all five corpora PASS with deltas
−0.573 %…−1.341 %, overall PASS per the locked rule, hygiene gate asserted in
JSON and reproducible, corpora frozen before use, every PPL number traced to
raw log output. The only refuted items are two **ops/runtime figures in
REPORT.md §5** (per-cell and total wall time, both understated by roughly
1.5–2×). They do not affect any measurement, verdict, or decision, but the
report should be corrected before banking (or the §5 lines annotated as
approximate). A traceability nit (prereg-mandated binary mtime/size check not
logged as a standalone artifact) and a downstream-usage caveat (do not cite as
statistically significant) are recorded above.