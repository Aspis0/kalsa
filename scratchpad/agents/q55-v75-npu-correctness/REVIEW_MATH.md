# q55 REVIEW_MATH — hostile pre-bank audit (read-only; first correctness certification of the experts-on-NPU lane, v75)

Audit date: 2026-08-26. Auditor: independent (hostile-mode). Scope: PREREG
(commit `b549f32e` "q55 PREREG locked"), run commit `b978152f`, `manifest.json`,
`REPORT.md`, `RUN_LOG.md`, `raw/`. All statements below were recomputed from raw
files, not from REPORT/RUN_LOG prose.

Preliminary integrity: PREREG lock commit present and is the parent of the run
commit; manifest `prereg` field = "q55 PREREG locked"; device binary source
commit `3f545beccee69d9975f466ec7e45fd9aacd8ba90` = the q48-family fork tree;
Part A flags were identical between arms except `-ngl 99 -dev HTP0 -v` (HTP) vs
`-ngl 0` (CPU); both arms carried `-nkvo -t 8 --ppl-stride 0 -fa on
--load-mode none -c 2048 -b 2048 -ub 1024 --chunks 32`.

---

## 1. PPL recomputation, chunk coverage, r, error bars — CONFIRMED

- 32/32 chunks in BOTH arms from raw stdout (`[1]…[32]` both
  `partA_olmoe_{htp_kvhost_retry,cpu_kvhost}.stdout.jsonl`), and both stderrs
  print `calculating perplexity over 32 chunks, n_ctx=2048, batch_size=2048,
  n_seq=1`.
- The printed `[i]` values are the classic-path CUMULATIVE running PPL
  (1023 tokens/chunk: `count += n_ctx - first - 1` = 2048−1024−1). Deparsed to
  per-chunk non-cumulative PPL, the final arithmetic reproduces the reported
  finals BIT-EXACTLY:
  - HTP final = exp(Σ per-chunk nll / 32736) = **8.921400** (= reported 8.9214)
  - CPU final = **8.923300** (= reported 8.9233)
  - r = 8.9214/8.9233 − 1 = **−0.000212926** (REPORT says −0.00021293 ✓)
- Per-chunk ladder identical to 4 dp between arms; per-chunk (non-cumulative)
  diffs: mean −0.00086, sd 0.0312, max |d| = 0.0781 (chunk 23, ~0.9% of PPL);
  paired t = −0.155 (df 31, ns); chunk correlation r = 0.9999. No sign drift,
  no monotone divergence — consistent with pure fp noise.
- Error bars (from the binary's own "Final estimate" lines in raw stderr):
  HTP `+/- 0.12933`, CPU `+/- 0.12926` (PPL units, 32736 tokens). Conservative
  (uncorrelated) σ_r = 0.020491 = **±2.05 %**; paired-diff SE gives ±0.55 %.
  |r| = 0.0213 % is **~96× inside the error bars**.
- Gate: 0.0213 % ≤ 2 % → **PASS** (not GREY, not FAIL). Same corpus file
  `/data/local/tmp/wiki.test.raw`, sha `173c87a5…` (matches PREREG q43 wiki;
  re-verified per arm: setup_verified lines before each arm); same
  n_ctx/batch/ubatch both arms.
- Same model sha (see pt 4).

## 2. The -nkvo deviation: which ops ran on HTP0 vs CPU — CONFIRMED, with an exact scope statement

- `-nkvo` = no-KV-offload: the 256 MiB KV cache is NOT the HTP fastrpc buffer;
  it is a host-memory (hostbuf) allocation. The K/V cache *storage* is host
  RAM; its tensors still appear as HTP0-backend views (`HTP0#cache_k_l0`).
- From the `-v` stderr of the HTP arm (28,659 `execute-op` lines; counters
  recomputed with run_q55.py's exact regexes):
  - `execute-op … MUL_MAT_ID` = **3,024** — every one is an expert matmul
    (`…ffn_{gate,up,down}_exps`, regex `MUL_MAT_ID.*ffn_.*_exps` = 3,024):
    **experts executed on HTP0**, all 16 layers. blk.0–14: 65× each; blk.15: 33×
    (all 33 "full" passes — see structure below).
  - Dense `MUL_MAT` = 5,136 — attention q/k/v fused projection
    (`attn_v×attn_k×attn_q` lines) + attn_output + norms feed, all on HTP0.
  - `FLASH_ATTN_EXT` = 1,040 (65×16) — **flash attention executes on HTP0**
    with the host-resident f16 K/V cache; `ROPE` 2,080; `GET_ROWS` 1,074
    (routing rows + `l_out` rows); `SOFT_MAX`/`ARGSORT`/`SWIGLU`/`MUL` 1,008
    each; `RMS_NORM` 4,161; `ADD` 8,112. No CPY ops; K/V store is fused into
    the HTP0 attention kernel.
  - `execute-op.*HTP0` = 28,659 = total: **every traced forward op ran on
    HTP0; zero ops traced to CPU**. CPU-side work = KV storage, hostbuf
    staging, tokenization/PP L sampling (untraced by ggml-hex).
- Graph structure (explains the 65/33/63-looking counts — NOT an execution
  bug): each 1024-token ubatch is a graph; per chunk the classic-perplexity
  path requests logits only for the second half (`batch.logits = pos ≥ 1024`),
  so llama.cpp prunes the no-logits ubatch's last-layer FFN + output
  projection (identical in both arms — same binary; the PPL uses only
  full-pass logits, and per-chunk PPL parity is the empirical proof of
  structure parity). Counts decompose exactly as
  1 setup/validation pass (2 tokens, fires at t=6.63 s BEFORE
  "tokenizing the input", i.e., pre-chunk liveness; full graph) +
  32 full passes (all 16 layers + l_out; the PPL-relevant logits) +
  32 pruned passes (blk.0–14 FFN + attention, no blk.15 FFN, no l_out):
  1+32+32 = 65 → MUL_MAT_ID 65×15 blk + 33×1 blk.15 = 3,024 ✓;
  FLASH_ATTN 65×16 = 1,040 ✓; routing GET_ROWS 33×16 + 32×15 = 1,008 ✓;
  l_out 33 ✓. Consistent.
- **Exact certified scope — read this, not more:** numerical equivalence of
  the HTP0-executed forward graph vs CPU over 32 chunks × 1023 tokens of
  wiki.test.raw for OLMoE-1B-7B-0924-Instruct-Q4_0 (sha 43379486…0500),
  n_ctx 2048, **in the -nkvo (host-KV) configuration only**, on Xiaomi houji
  v75, libggml-htp-v75.so. The experts MUL_MAT_ID, dense projections, and
  attention compute all execute on HTP0; the KV cache *storage* is host
  memory. NOT certified: the no-nkvo configuration (cannot run at n_ctx 2048 —
  see pt 3), Qwen3.5-4B, other contexts/corpora, latency, or anything inside
  Part B. The ledger entry should carry the qualifier
  "correctness certified (32 chunks, v75, **-nkvo host-KV**)".
- REPORT/manifest wording "attention K/V stay on CPU" is imprecise
  shorthand: correct = "K/V cache storage on host; attention compute
  (projections + flash-attn) executes on HTP0". Wording correction only.

## 3. First-attempt failure chain — CONFIRMED (with one historical nit)

- Attempt 1 (`partA_olmoe_htp`, `--no-host 1`): raw stderr is exactly
  `error: invalid argument: 1` (CLI parse; rc 1, 0 execute-ops) — documented
  as invalid_preflight in RUN_LOG. This is a *syntax* failure, not the mmap
  failure; the claim "first attempt failed at KV-cache fastrpc_mmap" strictly
  refers to attempt 2 (`partA_olmoe_htp_valid`).
- Attempt 2 raw stderr (all four lines match the claim exactly):
  `HTP0 buffer mapping failed : domain_id 3 size 268439552 fd 21 error 0x00000001`;
  `HTP0 failed to allocate buffer context (host): … fastrpc_mmap failed`;
  `alloc_tensor_range: failed to allocate HTP0 buffer of size 268435456`;
  `llama_init_from_model: failed to initialize the context: failed to
  allocate buffer for kv cache`. 0 execute-ops, rc 1, guard clean (27.9 °C).
- 268,435,456 B = 2048 ctx × 128 head-dim × 16 kv-heads × 2 (K+V) × 2 (f16) ×
  16 layers — exactly the n_ctx-2048 KV cache (the log's 268,439,552 = tensor +
  4 KiB page). Confirmed: the KV cache buffer, at context init, nothing else.
- Retry (`partA_olmoe_htp_kvhost_retry`) differs from attempt 2 by **-nkvo
  only** (program-level argv diff). Pre-retry probe: MemAvailable 6.82 GB
  (>5.0 GB gate), battery 74 % unplugged 27.7 °C, no processes closed, no
  device state change — arbitration rule respected (single authorized retry).

## 4. q48 lane identity — CONFIRMED

- Same gguf: sha `43379486db3178d89b338358d298ea0721d6c123e0107d91c5d6179371000500`
  (q48 analysis.json / PREP.md / pc_sha256.txt; q55 manifest + device
  re-verify). Same skel pins: libggml-htp-v75.so `46d3ac92…` (q48 REPORT);
  stub `5db18906…`, hexagon `f06aa309…` identical in both cells. Same source
  commit `3f545be…` (q48 "llama-bench @3f545be"; q55 manifest source_commit +
  Part B jsonl `build_commit 3f545bec`). Same env NDEV=1 HOSTBUF=1.
- Note for the ledger: q48's lane ran `--no-host 1` WITHOUT `-nkvo`
  (pp512/tg128, no ctx-2048 KV); q55 certifies the `-nkvo` configuration.
  The experts live on HTP0 in both; the certified correctness claim does not
  silently extend to the no-nkvo KV path (which is separately exercised,
  non-numerically, in Part B at n_ctx 512).

## 5. Thermal / guards — CONFIRMED

| arm | pre °C | max °C (guard) | ΔT battery | KILL thr | battery floor | unplugged |
|---|---:|---:|---:|---:|---:|---|
| htp (fail, CLI) | 27.9 | 27.9 | 0.0 | 410 | 74 | ✓ |
| htp_valid (fail, KV mmap) | 27.9 | 27.9 | 0.2 | 410 | 74 | ✓ |
| htp kvhost retry | 27.7 | 31.2 (MAX line) | 4.5 | 410 | 72 (≥45) | ✓ |
| cpu kvhost | 31.8 | **39.4** (MAX line @ kill 430) | 7.6 | 430 | 60 (≥45) | ✓ |
| partB npu | 31.9 | 31.9 | 0.0 | 410 | 59 (≥45) | ✓ |

- **39.4 °C is the CPU-ref arm** (guard MAX at 1787738032, kill=430; max 39.4
  < warn 40.0 — no warn, no kill). NPU arms capped at 31.2/31.9 °C. Claim
  "overall max 39.4 °C (which arm?)" → CPU arm; REPORT attributes it
  correctly per-row.
- Cool-start ≤ 32.0 °C before every arm: 27.9 / 27.9 / 27.7 / 31.8 / 31.9 ✓.
- No guard kill anywhere (guard_rc=0 ×5; no sample ≥ warn threshold; wall cap
  600 s only for NPU arms — retry 278 s, partB 18.6 s, OK; CPU arm uncapped
  per PREREG). Battery floor 45 % never approached (min 59 %). Unplugged
  declared + verified in every battery sample (plugged=false). Crash-pattern
  sweep (dspqueue|INTERNAL-ERROR|ggml_abort|Aborted|SIG) over all five
  stderrs: 0 hits.

## 6. Part B single NPU arm — CONFIRMED (exploratory, not gated)

- Raw bench jsonl: build 3f545bec, HTP backend, pp512, n_gen 0, 2 reps,
  n_batch 2048 / n_ubatch 512, flash_attn=1, **no_kv_offload=false**
  (i.e., Part B ran WITHOUT -nkvo at n_ctx 512 — the fastrpc KV path that
  Part A could not use at n_ctx 2048; it works at 512). Execute-ops: 968
  total, 96 MUL_MAT_ID = 2 reps × 16 layers × 3 experts, 32 FLASH_ATTN_EXT,
  all on HTP0.
- ΔT 0.0 °C: battery pre/post 319/319 tenths; guard trace = 14 samples all
  `319,59`, MAX 319 — internally consistent (two ~0.5–0.9 s reps produce no
  measurable heat); wall_s 0.671243 s = avg_ns/1e9 ✓.
- t/s: 581.412 is samples_ts[0] (the SLOWER rep; 512/0.8806 s). The second rep
  was 1108.53 t/s; avg_ts = 844.97 ± 372.7 (2.4× spread between reps). The
  REPORT's single "581.412000" is a true raw value but understates the mean;
  mark Part B t/s as "min-rep 581, avg 845, high variance" in the ledger.
  (Not gated; matches q48's v75 pp512 687 t/s ballpark.)

## 7. REPORT overclaim / STOPPED-status — CONFIRMED-as-written; two wording corrections

- REPORT numbers reproduce raw data in every field I could recompute (PPL,
  PPL_std, r, max_C, ΔT, proof counts, stop lines). No invented numbers.
- `status=STOPPED` is NOT misleading as written: the stop rule matched the
  literal substrings `libcdsprpc.so` (driver load) and `_dom=cdsp` (URI
  domain) in benign lines after the Part B NPU arm; REPORT/RUN_LOG quote the
  exact lines, state "no further arm or retry was started", and Part B/Qwen
  are marked incomplete. The stop is a rule false-positive (orchestrator is
  resuming), and it did not touch the gated Part A result. Cosmetic
  improvement: annotate "false positive on benign CDSP substring" in the
  status field itself.
- Corrective items (none touch the gated result):
  1. "attention K/V stay on CPU" → "K/V storage on host; ALL traced forward
     compute including flash attention on HTP0" (scope wording).
  2. Part B t/s: report min 581 / mean 845 t/s (2 reps, stddev 373).
  3. Historical nit: attempt 1 failed at CLI parse (`--no-host 1`), KV-mmap
     failure was attempt 2 ("first attempt" = first *valid* attempt).
  4. Ledger entry must carry the `-nkvo` / n_ctx-2048 / 32-chunk / OLMoE Q4_0
     qualifiers (exact scope in pt 2).

---

## FINAL LINE

**BANK-with-corrections** (list: pt 7 items 1–4 — scope wording for
"attention K/V stay on CPU", Part B t/s mean/variance, first-attempt
numbering, and the `-nkvo`-qualified ledger entry).

The gated Part A result is fully confirmed: PPL_HTP = 8.9214 vs PPL_CPU =
8.9233 over the same 32 chunks (finals re-derived exactly from raw chunk
data), r = −0.0002129 (±~2 % conservative error; ns), experts MUL_MAT_ID
3,024/3,024 on HTP0 with 28,659/28,659 traced ops on HTP0, no guard kills,
39.4 °C max on the CPU arm only, battery 74→59 % unplugged throughout, flat.
The router ledger may record **R2 experts-on-NPU correctness: PASS
(32 chunks, v75, -nkvo host-KV)** — with the qualifier, and with Part B
(spike thermal 581–1109 t/s, ΔT 0.0 °C) marked exploratory.