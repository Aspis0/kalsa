# Phase 0, items 1–2: calib-v2 + moep Super-Expert/domain patch

Date: 2026-10-01 (Mac only, $0, no pod, no cloud, **nothing uploaded to HF**).
Implements DESIGN.md §4 items 1 and 2. Item 3 (evals) is the parallel phase-0b
agent's lane — `prep/eval/` and `podprobe/30_gate.sh` untouched.

## 1. Calibration v2 — seven equal-token domains

Files (outside git): `~/kalsa-models/reap-calib-v2/{it,fr,es,en,zh,code,math}.jsonl`
+ `counts.json`, sha256 in `CALIB-V2-MANIFEST.sha256`, per-domain breakdown in
`CALIB-COUNTS-v2.json`. Tokenizer = the v1 `qwen36-meta` one (same tokenizer.json
sha as `CALIB_MANIFEST.sha256`, `5f9e4d49…`); token counts measured with it,
`add_special_tokens=False`, v1 counting convention.

| domain | rows | tokens | reused from v1 (tokens) | top-up |
|---|---:|---:|---:|---|
| it | 2,351 | 450,046 | 450,046 (sampled down from 642k) | — |
| fr | 2,214 | 450,609 | 294,844 | fineweb-2 `fra_Latn` |
| es | 2,276 | 450,405 | 253,326 | fineweb-2 `spa_Latn` |
| en | 951 | 450,238 | 136,452 | fineweb `sample-10BT` (fineweb-2 has no English) |
| zh | 1,969 | 450,556 | 435,367 | fineweb-2 `cmn_Hani` (Mandarin; no `zho_*` exists) |
| code | 585 | 450,134 | 149,112 (MBPP train + glaive toolcall, top-up only) | local sources FIRST: kalsallama C/C++ 105k / CPython stdlib 98k / engine Python 98k |
| math | 2,433 | 450,002 | 67,005 | GSM8K train (full solutions), seeded shuffle |
| **total** | **12,779** | **3,151,990** | | |

The code domain is deliberately source-code-backed (67%): the first draft let
the reused glaive toolcall dialogues take 57% of it — those are conversations
ABOUT code, not code — so the local sources now fill ~300k before any v1 row.

All seven land inside ±470k/430k (guard in `build_calib_v2.py`, exit 1 otherwise).
Reused v1 rows keep their row-level licence tags; new sources and pins:
`calib-v2/SOURCES.md`. Web rows: `language_score ≥ 0.9`, 200–12,000 chars.
Code chunks: sequential non-overlapping ~4 KB slices, 3 KB–400 KB files,
test/vendor dirs skipped, licence headers stripped, per-row provenance
`label:path#L<first>-L<last>`; engine commit `63a51b6d6…`, CPython 3.14.6
(Homebrew `python@3.14` stdlib, PSF-2.0), kalsallama MIT.

## 2. Eval-set exclusion — explicit dedup check

Builder: every candidate row screened against ban sets built from FLORES-200 dev
AND devtest (local v3 copy), GSM8K test, HumanEval, HumanEval+, MBPP test (both
configs), `corpus/postcutoff/`, `corpus/multi5/` — exact normalized full-text
match plus 13-gram word overlap (CJK: 13 consecutive characters; tokens are
lowercase alnum runs, one token per CJK char). Hits are DROPPED and counted
(`build_calib_v2.py` → `skips`):

- `ban:mbpp_test` **26** (25 in code + 1 in it — MBPP *train* rows sharing 13-grams with test prompts; real cross-split near-duplicates)
- `ban:gsm8k_test` **5** (math domain — GSM8K *train* rows vs test; template-similar problems)
- `ban:humaneval` **2**, `ban:humanevalplus` **4** (it/en/code web/aya rows quoting eval prompts — real CommonCrawl contamination)
- structural: GSM8K/MBPP pulled from train splits only; HumanEval/FLORES never a source; `dupe` 92 (incl. the 78 GSM8K-train rows already reused from v1)

Standalone re-check over the BUILT files (`calib-v2/eval_overlap_check.py`,
independent reload of all ban sets): **0 hits in all 49 cells** (7 domains × 7
sets), exit 0. Log table:

```
domain  rows       flores  gsm8k_test  humaneval  humanevalplus  mbpp_test  postcutoff  multi5
it      2351            0           0          0              0          0           0       0
fr      2214            0           0          0              0          0           0       0
es      2276            0           0          0              0          0           0       0
en       951            0           0          0              0          0           0       0
zh      1969            0           0          0              0          0           0       0
code     585            0           0          0              0          0           0       0
math    2433            0           0          0              0          0           0       0
```

v1 (`kalsa-reap-calib.jsonl`, counts, manifest) is untouched; v2 is separate.

## 3. moep patch — `patches/moep-domain-normmax.patch`

218-line diff against the pinned upstream `fdc9a3fc025236bfbc48e050e23e46d0562a5956`
(applies clean via `git apply --check`, verified on a fresh clone). Three files:

- `profiler.py`: 7th accumulator **`norm_max`** = per-expert running max of
  ‖down_proj output‖₂ over routed tokens (Super-Expert guard, arXiv:2507.23279);
  `merge_stats()` (additive stats sum, `norm_max` element-wise max);
  `write_summary()` refactored to take a tensor dict (also reports
  `max_norm_max`). `ExpertStats.save/to_cpu` removed (single caller absorbed).
- `cli.py` (`profile`): repeatable `--calib` + `--domain` — **one model load,
  one dataset pass per domain**, writing `profile_<domain>.stats.pt` +
  summary per domain and a merged `profile.stats.pt` (name kept, so
  `30_score.sh` and `run_all.sh` work unchanged). New `--device` flag
  (default `cuda:0`, pod behavior unchanged; `cpu` enables the Mac smoke).
  Single `--calib` without `--domain` behaves byte-identically to v1.
- `loader.py`: 3-line no-op guard for missing `os.posix_fadvise` (macOS) —
  no behavior change on Linux/pod.

Smoke (patched clone at `/tmp/moep-fdc9a3fc`, venv torch 2.7.1/transformers 5.16.0):
`verify/smoke_domain_profile.py /tmp/moep-fdc9a3fc` → **EXIT=0**: seven
`profile_<domain>.stats.pt` + merged `profile.stats.pt`, every accumulator
finite, `norm_max > 0` (max 15,588.8), merged sums/max/total consistent
(1,792 tokens), per-domain `domain` meta recorded; backward-compat single-file
run EXIT=0 with the v1 summary shape. Coverage==100 % is asserted only in the
pod gate (a random router on 2×128-token synth batches touches ~36 % of 128
experts — expected, noted in the driver).

Not pushed anywhere; the patch file is the only artifact. Follow-up for the
coordinator's pod session: apply the patch after `00_env.sh`'s pinned checkout
(one `git apply` line — left out of 00_env.sh deliberately, it is env plumbing
someone else owns).

## 4. Pod plumbing

- `pod/20_observe.sh`: rewritten for the domain list (`CALIB_V2_DOMAINS`,
  default `it fr es en zh code math`) — passes `--calib/--domain` pairs, then
  asserts per-domain AND merged summaries: coverage 100 %, all finite, reap
  usable, `norm_max > 0`. Stage name, `.ok` marker, offload env branch and all
  money/terminate logic unchanged.
- `pod/30_score.sh`: **unchanged** — it reads `$RUN/profile.stats.pt`, which is
  the merged seven-domain stats (REAP over all tokens; the SE guard reads
  `norm_max` from the same file in phase 1).
- Open (phase 1, needs the owner's HF call): stage+upload calib-v2
  (`stage_calib.sh` pattern, 8 files, `staging.json` with the new shas) and a
  `05_fetch_calib.sh` variant fetching `$CALIB_DIR/$d.jsonl`. NOT done here —
  no upload, no token touched.

## 5. Fix made en route — `verify/make_synth_checkpoint.py`

Its vision-tensor shapes had never been validated by an actual model load
(merger `fc1 [64,128]`/`norm [64]`, 4-D conv kernel): transformers 5.16 and the
real checkpoint (`tensor-shapes.json`) want merger `norm/fc1` over vision hidden
(32), `fc2 [out_hidden, vision_hidden]`, conv kernel `[out, in_ch, temporal, p, p]`.
Fixed to mirror the real layout; the smoke above is the first end-to-end load of
a synth checkpoint on this Mac (`accelerate==1.10.0` installed into the
reap-calib venv to match the pod pin — that was the only env change).

## Artifacts committed (explicit paths)

`calib-v2/{evalsets,sources_v2,build_calib_v2,eval_overlap_check}.py`,
`calib-v2/SOURCES.md`, `CALIB-COUNTS-v2.json`, `CALIB-V2-MANIFEST.sha256`,
`patches/moep-domain-normmax.patch`, `verify/smoke_domain_profile.py`,
`verify/make_synth_checkpoint.py` (fix), `pod/20_observe.sh`, this file.
Large data stays in `~/kalsa-models/reap-calib-v2/` (12.1 MB, per-file hashes
above); clone + smoke scratch lives in `/tmp` (ephemeral by design).
