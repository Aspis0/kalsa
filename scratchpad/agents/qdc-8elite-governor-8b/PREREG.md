# PREREG — Governor v0 on a bigger model (LFM2.5-8B-A1B) — Adreno 830

Written BEFORE any measurement. The commit hash of this file is the lock id.
Nothing here has been measured at lock time; runs happen only in a future QDC
session.

## The question

Cell #38 proved the per-phase governor (G: GPU-prefill + CPU-decode, KV committed
across the boundary) beats both single-backend arms on the SHIPPING model
(LFM2.5-2.6B QAD-Q4_0, arch lfm2, commit = 1.80/1.98% of prefill). Two open
questions this cell answers:

1. **Does the win survive on a 3x-larger model of the SAME hybrid family?**
   LFM2.5-8B-A1B (arch **lfm2moe**, 24 blocks of which only 6 are attention —
   the rest shortconv; 32 experts, 4 used; 5.2 GB Q4_K_M). Same family as the
   ship model, so the governor's hybrid-commit path applies unchanged; the
   variable isolated is SIZE (+ MoE experts), not architecture.
2. **Does the commit-cost gate scale?** The governor's value proposition dies if
   the cross-boundary KV commit grows faster than prefill as the model grows.
   This cell REPORTS commit_ms / prefill_ms and tests it against the #38
   reference; it does NOT assume it stays small.

## Method (fixed)

- Tool: `governor-bench` from kit `~/kalsa-qdc/bin-gov-5c3979438-stripped`
  (engine kalsa/governor-v0 @ 5c3979438; SHA256SUMS verified on device before
  running). Fixed workload baked into the binary: **3 turns x (512 prompt + 128
  generated), seed 1234, n_ubatch 512** — identical to cell #38.
- Model: `~/kalsa-models/LFM2.5-8B-A1B-Q4_K_M.gguf` (arch lfm2moe; sha256 recorded
  local and on-device, must match).
- Arms, each one `governor-bench` invocation `> file 2>&1; echo $? > file.exit`:
  - A: `--arm A -m <model> -r 3` (single context, GPU: prefill+decode on OpenCL)
  - C: `--arm C -m <model> -r 3` (single context, CPU: prefill+decode on CPU)
  - G: `--arm G -m <model> -r 3` (governor: prefill OpenCL, decode CPU, KV commit)
- **governor-bench fail-fasts** (source line ~111): if an arm requests a non-CPU
  backend and only CPU resolves, it prints `fail-fast: no non-CPU backend
  resolved; resolved_backend=CPU` and exits non-zero. This makes the #40
  `/vendor/lib64` silent-CPU-fallback trap STRUCTURALLY impossible here — a G or A
  run that fell back to CPU aborts instead of lying. LD_LIBRARY_PATH = kit dir
  ONLY (for libomp.so), never /vendor/lib64.
- Block order **ABBA**: A C C A then G G (governor arm measured twice, between
  the ABBA blocks and after, to bracket any thermal drift — G is the arm under
  test). Actual order recorded: A C C A G G. r=3 inside each invocation; the
  binary already prints per-turn + `summary=median`.
- Thermal gate per AMENDMENT-1 of cell #38 (BINDING): before EACH invocation read
  `Current temperatures from HAL:` + `Thermal Status:` (never the frozen `Cached
  temperatures:` group); proceed only with max HAL temp <= 60 C and status <= 1,
  else cooldown. Snapshot before and after every invocation.

## Decision rule (written before the numbers)

Per-arm figure = the `summary=median` line (median over the 3x3 = 9 turns the
binary already reduces). Compare:

- **Prefill (ttft_ms), lower better**: G "keeps the GPU prefill" if
  ttft(G) <= 1.15 x ttft(A) AND ttft(G) <= 0.5 x ttft(C). (Looser than #38's
  3-5% band because a bigger model has a bigger cross-context setup; the bar is
  "clearly GPU-class, not CPU-class".)
- **Decode (decode_tps), higher better**: G "keeps the CPU decode" if
  decode_tps(G) >= 0.95 x decode_tps(C).
- **Commit overhead (REPORTED, with a pre-registered reference bar)**: report
  commit_ms and commit_ms / prefill_ms(G). Reference from #38 = ~1.9%. Pre-written
  interpretation bands: <=3% "scales cleanly"; 3-10% "scales with a visible but
  acceptable tax"; >10% "commit cost does not scale — a real limit of v0 on big
  models", banked as such. Also report commit_naive_count vs commit_staged_count
  (which KV path the bigger model exercised).
- **Overall G verdict = WIN** iff both the prefill and decode conditions hold.
  The commit band is a characterization, not a pass/fail (a WIN with a >10%
  commit tax is banked as "wins but the tax is the headline").
- Any arm whose invocation exits non-zero (incl. governor-bench fail-fast) banks
  that arm as FAILED with the log tail; the cell still banks whatever completed.
- Thermal-gate violations not cleared within 15 min of cooldown -> remaining
  invocations NOT RUN (never silently dropped).

## Upload gate

5.2 GB at the ~22 MiB/s measured in #40 projects to ~4 min. If a live probe at
~500 MB projects the full push > 45 min, declare VOID-before-start (no numbers)
and stop — there is no smaller same-family MoE fallback worth substituting.

## What this cell cannot say

- Nothing about the 2.6B ship model (that is #38) beyond citing it as the
  comparator; no claim that 8B is a shipping candidate.
- Nothing about the KEXP/qwen3moe recipe (that is #40) — different arch.
- Nothing about the 740/750 (different GPUs, not measured here).
- Nothing about sustained-load thermals beyond the gate snapshots.
- Nothing about accuracy/quality — this is latency/throughput only.
