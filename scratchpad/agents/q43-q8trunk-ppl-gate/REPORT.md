# q43 — Marco B′ Q8_0-trunk: pre-registered MULTILINGUAL perplexity gate

PC-only. No device. Criterion, arms, corpora shape and thresholds locked in
`PREREG.md` at outer commit `e6910b3f` **before** source re-download, before cook,
before any PPL run. First gate run under the owner rule "quality gates are ALWAYS
multilingual" (23/08).

**Verdict: PASS on all five corpora — overall PASS.** The Q8_0 trunk is *better*
than the shipped KEXP control (Q5_K/Q6_K trunk) on every corpus, d from −0.57 %
to −1.34 %, at **+1.948 % file size** (+124,403,712 B). **B′ is alive**: the last
surviving NPU-on-KEXP trunk candidate passes the quality gate that killed the
4-bit trunks (q41: IQ4_NL +4.27 %, Q4_0 +8.06 %).

---

## 1. Arms

| arm | file | bytes | sha256 |
|---|---|---:|---|
| control | `q37…/gguf/marco/Marco-Mini-Instruct-KEXP-fromsrc-trunk-control.gguf` (reused, not recooked) | 6 385 238 912 | `f3e2826f78c78452afa0765613875c806f1ca3976f1f59ff4e8ff85bea5782ea` |
| q8_0 | `…-trunk-q8_0.gguf`, cooked this cell (`cook_model.py marco q8_0`) | 6 509 642 624 | `bd63fc0f21a8c3aab4b7531ee30aa37f8e6320dfb65e85de74a9056e2feeb419` |

Source re-download (resume-safe `dl_marco.ps1`, detached): `Marco-Mini-Instruct.Q8_0.gguf`
18 356 453 952 B sha `3287457af7…` MATCH, imatrix 81 548 704 B sha `f05d4d4a…` MATCH
(`logs/dl-q37-marco.log`, status OK).

**Hygiene gate (blocking) PASS** (`verify_arms.txt`): expert region sha256
`d84c4b43b24384648b1036e043973655b3092d4ebdf6cb62bb8de18f3cc2c74d` — byte-identical
control == q8_0 == shipped KEXP == q37/q41; all 113 trunk tensors Q8_0 (F32 141
unchanged, experts 56×Q2_K + 28×Q3_K); delta +1.948 % — matching the q36 prediction
(+124 MB) to the byte.

## 2. Corpora

| corpus | file | bytes | sha256 | chunks |
|---|---|---:|---|---:|
| EN (wiki) | q41 `wiki.test.raw` (reused) | 1 290 590 | `173c87a53759…` | 584 |
| IT | `corpus/it.txt` (new, 11 Wikipedia articles) | 480 565 | `fddf963377e1…` | 284 |
| ES | `corpus/es.txt` (12 articles) | 492 128 | `45b4bdbf62de…` | 267 |
| FR | `corpus/fr.txt` (10 articles) | 454 357 | `c477f06d166a…` | 259 |
| ZH | `corpus/zh.txt` (11 articles) | 487 776 | `234fe0fdfa87…` | 265 |

The four language corpora were built and frozen (full shas + ordered article lists in
`corpus/MANIFEST.md`) before the first PPL run; the pipeline gates on their presence
plus a 60 s settle before launching PPL. All corpora ≥ 100 chunks (prereg floor);
q41's 26-chunk `multi5/it.txt` was NOT reused.

## 3. Binary and settings

`build-llama-pc/bin/llama-perplexity.exe` — same binary as q41 (stub 10 752 B +
`llama-perplexity-impl.dll` 342 016 B, mtime 2026-08-23 15:46): the prereg reuse
condition holds, so **control-wiki is reused from q41** (9.5915 ± 0.07116, 584
chunks, math-reviewed 0-REFUTED) and was not re-run. All other 9 cells ran fresh,
sequentially, one process at a time (`pipeline.ps1`, detached; status file trail):

```
llama-perplexity -m MODEL -f FILE -c 512 -b 512 -ub 512 -t 16 -ngl 0 --chunks -1 --ppl-stride 0
```

## 4. Gate table (per-corpus d, thresholds PASS ≤ +0.5 % < GREY ≤ +1.0 % < FAIL)

From `logs/ppl-*.json`; arithmetic in `_math_check.py` → `_math_check.txt`.

| corpus | control PPL ± | q8_0 PPL ± | d | verdict |
|---|---:|---:|---:|---|
| EN wiki | 9.5915 ± 0.0712 (q41) | 9.4875 ± 0.0707 | **−1.084 %** | PASS |
| IT | 5.9497 ± 0.0549 | 5.9156 ± 0.0548 | **−0.573 %** | PASS |
| ES | 6.1510 ± 0.0599 | 6.1138 ± 0.0597 | **−0.605 %** | PASS |
| FR | 6.4490 ± 0.0631 | 6.4063 ± 0.0627 | **−0.662 %** | PASS |
| ZH | 11.0168 ± 0.1197 | 10.8691 ± 0.1179 | **−1.341 %** | PASS |

**OVERALL: PASS** (prereg: PASS iff all five PASS). Direction consistent with a
strictly-higher-precision trunk; the improvement is largest on ZH and EN.
Contrast with q41 on the same wiki corpus: IQ4_NL +4.273 %, Q4_0 +8.060 %,
Q8_0 **−1.084 %** — the trunk carries far more quality than its 3.6 % byte share,
and Q8_0 is on the right side of it.

## 5. Runtime / ops

- Wall (corrected per REVIEW_MATH — first draft underestimated): download+sha
  ~14 min; cook 10 min; verify 87 s; PPL wiki(q8) 49.5 min; language cells
  **16.9–24.0 min each**; 9 PPL cells sum 3.50 h; **total pipeline 3 h 52 min**
  (19:39:49 → 23:32:11), rc=0 everywhere.
- Binary reuse condition (stub 10 752 B + impl dll 342 016 B, mtime 15:46) was
  checked in-session BEFORE launch; no standalone pre-run log artifact exists
  (audit note) — values re-verified on disk by both auditors.
- Disk: 145 GB free at start, ≥ 108 GB throughout (guard 40 GB never approached).
- Corpora built by a delegated agent (fetch script + MANIFEST in `corpus/`),
  content spot-checked by the orchestrator in all four languages.

## 6. Deviation from prereg (declared)

PREREG's cleanup clause ("delete source + q8_0 variant per q41 pattern") was written
for the FAIL outcome. With PASS, the **q8_0 variant is the surviving ship candidate
and is KEPT** (sha above); source + imatrix (17.2 GB, re-downloadable, sha-pinned)
are deleted after bank. Cleanup is outside the measurement protocol; no measured
number is affected.

## 7. Caveats (added per REVIEW_DOC audit, pre-bank)

- **Single binary, single machine** (F6.1): all PPL cells ran on one PC CPU build
  (`build-llama-pc`, VS 2022, one host). No cross-binary or on-device PPL replication.
- **Control-wiki temporal gap** (F6.2): the reused control-wiki cell was measured in
  q41 (~2 h before this cell's runs, same binary/corpus/settings). Determinism of the
  CPU PPL path makes drift implausible, but the two arms of the wiki row were not
  measured back-to-back like the language rows.
- **What this gate does NOT prove** (F6.4): PPL equivalence only. No behavioral /
  instruction-following gates (LFM2.5 failed #30 axis B on behavior with clean
  leggibility — the axes are independent), no device performance, no HTP dispatch
  proof. Lineup entry still requires the full #30 matrix.
- **Wikipedia-only domain** (F3.4): the four language corpora are Wikipedia prose
  (the EN gate is wikitext too). No code, dialogue, or informal-register text.
- **No independent corpus verification** (F6.3): corpora were built by a delegated
  agent and spot-checked by the same orchestrator that ran the gate; shas freeze
  content but no second party audited article selection.
- Script provenance (F1.3): cell scripts/artifacts enter git at the bank commit;
  during the run only PREREG.md was tracked.

## 8. What this decides (#28c)

Road (a) is alive: **Q8_0-trunk B′ passes the multilingual PPL gate at +1.95 % size**.
NPU relevance: Q8_0 is an HTP-supported type (attn Q/K/V/O passed the HTP predicates
for Marco in q36/q37 desk checks; LM head stays CPU regardless, FAIL_DIM). The
remaining #28c decision for the owner is now (a) with a green gate vs (b) HVX
kernels (weeks) vs (c) no NPU for the lineup — with (a) no longer blocked by quality.
Next hurdle for (a) if chosen: device smoke (HTP trunk offload with this GGUF) and
the #30 axis-A/B certification discipline before any lineup entry.

## Trace

| claim | file |
|---|---|
| criterion + lock | `PREREG.md` (outer commit `e6910b3f`) |
| download | `logs/dl-q37-marco.log`, `DL_MARCO_STATUS.txt` |
| cook | `q37…/logs/cook-marco.log` |
| hygiene | `verify_arms.{py,json,txt}` |
| corpora | `corpus/MANIFEST.md`, `corpus/fetch_corpora.py` |
| PPL raw | `logs/ppl-{arm}-{corpus}.{log,json}` |
| arithmetic | `_math_check.{py,txt}` |
| pipeline trail | `pipeline.ps1`, `PIPELINE_STATUS.txt`, `logs/q43-pipeline.log` (repo `logs/`) |
