# PREREG — Cell #64: bisect the v73 TLBMISS between our pin and upstream master (HDK8550)

Date: 2026-09-04 (owner away, full delegation). Owner order 4/09 11:00: **no
upstream issue, ever** — "either we fix it ourselves or we drop it". This cell
is the first step of "fix it ourselves": find which upstream hexagon commit
makes pure master die on v73 at any `-ngl`, so a fork kit can carry upstream's
mapping changes (#26501/#28202) without that death.

## Question

Cell #62 (ALIVE 45): pure upstream master 64a155d24 (`kit-upstream`) dies on
HDK8550 (Hexagon HTP v73) with a **TLBMISS RW in `op_binary+0x50E4`
(`binary_job_vector_same_shape`), Bad VA 0x0, error 0x7003** = the S23
Signature 1, at every `-ngl` incl. `-ngl 8` (24 expert ops). Our kit-v6
(kalsa/npu-judge-v79 @ca82efa8b, based on upstream 022458a28 + kalsa patches)
does NOT die that way: at `-ngl 8` it runs (#60 B-arms), at `-ngl 99` it dies
at `htp/main.c:729` `mmap_buf` (`dspqueue_read 0x2e`, mapping budget).

Which of the 23 upstream commits touching `ggml/src/ggml-hexagon` in
022458a28..64a155d24 (BISECT.md, chronological, index 1..23) first introduces
the TLBMISS death at `-ngl 8`?

## Step 0 (binding gate, NOT a bisect step)

Pure upstream 022458a28 has never been run: our kit carries kalsa patches. Build
it (`build-kit.sh 022458a28…`, v73-only kit) and run it first.
- Step 0 GOOD (`up_ngl8` exit 0 with `n_exps_htp0=24` proof) → the bisect range
  is valid; proceed.
- Step 0 BAD (TLBMISS family at `up_ngl8`) → the range is INVALID: the kalsa
  patches are what keeps our kit alive, not the pin. The bisect is replaced by a
  study of `git diff 022458a28..ca82efa8b -- ggml/src/ggml-hexagon`. No further
  sessions under this PREREG.
- Step 0 OTHER death → banked as new finding; bisect not started.

## Per-step protocol

One QDC session on HDK8550 per candidate commit (kit `npu-kit-bisect-<sha7>.tgz`
from build-kit.sh; SHA256SUMS verified on device; `.farf` 0x1F as in #62):
`d_run.sh <job> <sha7>` runs, behind the #38 thermal gate:
1. `up_ngl8` (cap 900 s): `llama-bench -m olmoe.gguf -p 16 -n 8 -r 1
   --no-warmup -dev HTP0 -v -o jsonl --mmap 0 -fa on --ubatch-size 1024 -ngl 8`
   — the bisect probe. Model: allenai OLMoE Q4_0 (sha 361e8d83…, as #59-#62).
2. `up_ngl99` (cap 900 s): same with `-ngl 99` — the mapping-question probe,
   recorded but NOT used for the bisect verdict.

Verdict per commit, from `up_ngl8` only:
- **BAD** = death in the TLBMISS family: logcat/tombstone with `TLBMISS` or
  `Bad VA` or error `0x7003`, or `dspqueue_read failed: 0x0000002e` **with**
  a DSP FARF chain showing a TLB fault rather than `HAP_mmap`/`mmap failed`
  (both are read via the `.farf` route; the raw is kept). Exit 134 alone is
  not a verdict — the signature is.
- **GOOD** = exit 0 with `n_exps_htp0 = 24` in the `-v` stderr (HTP proof;
  exit 0 without proof = METHOD-VOID, arm re-run once, then the session is
  void and the commit is re-tested next session).
- **OTHER** = any other death (e.g. `mmap failed`/`:729` at `-ngl 8`, OOM,
  driver reject). The bisect STOPS; banked as a new finding; owner question.

Bisect order: classic binary search over index 1..23 (first candidate = index
12, `990e3bfee`). Only hexagon-touching commits are candidates; the 821 other
commits in the range are a declared confound: the claim at the end is "first
BAD hexagon commit", not "the only cause". If the first BAD is index k and
index k-1 is GOOD, the culprit is `<sha of k>` under that caveat.

Session cost: ~10 min each (3.9 GB model push ~3 min + two arms). Budget cap:
**6 sessions** (step 0 + ≤5 bisect steps) ≈ 60 min of the 8 Gen 2 pool
(926 → ~865). One session at a time; End Session = ref-click End + Yes +
reload + "Ended On" within one minute.

## Binding interpretation grid (end of cell)

- G1 (CULPRIT FOUND): a first BAD index k with GOOD at k-1 (or k=1 with
  step 0 GOOD). Next: a fork kit = master 64a155d24 with commit k reverted
  (or fixed), tested at `-ngl 99` for the mapping question (#65).
- G2 (RANGE INVALID): step 0 BAD → patch-diff study instead (see above).
- G3 (NON-MONOTONIC): a GOOD after a BAD in index order (flaky death or
  multi-cause) → bisect stopped; banked; the surviving data (which commits
  are GOOD/BAD) is reported without a culprit claim.
- G4 (BUDGET OUT): 6 sessions spent without G1 → partial table banked.

## Materials / non-goals

Kits: `~/kalsa-qdc/npu-v79-cell/npu-kit-bisect-<sha7>.tgz` (v73 skel only —
v75/v79/v81 skipped, declared; the driver only loads v73). Driver:
`d_run.sh` = #62 driver with sha7 parameters and the two arms above (diff:
header, JOB/SHA7/DIR/RAW/KIT/D lines, arm list). Non-goals: perf, other
archs, v75+ boards, HOSTBUF/VMEM/MBUF variants (done in #60/#62).
