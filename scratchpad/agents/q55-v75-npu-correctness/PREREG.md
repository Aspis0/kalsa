# q55 — v75 (Xiaomi) NPU correctness gate for the experts-on-NPU lane (4.82×) + spike thermal (PREREG)

**Status: LOCKED at commit time.** Owner 25/08 night: Xiaomi handed over unplugged, "stai attento".
Runs in the same session as q61, AFTER q61 and a full cooldown. The 4.82× experts-on-NPU result
(q48) was liveness + dispatch only — this cell certifies (or refutes) its numerical correctness
and measures its per-prompt heat, both under the thermal guard.

## Device / models (already on device, no pushes for this cell)
Xiaomi houji, Hexagon v75, kalsahtp v75 build (pins as q48: record shas). Models:
- OLMoE all-Q4_0 (sha `43379486…0500`, 3.93 GB) — the experts-on-NPU lane (R2).
- Qwen3.5-4B-Q4_0 (sha `298fcb5f…`, 2.58 GB) — the dense/hybrid lane (R3), if on device.
Corpus: q43 wiki (`173c87a5…`), pushed only if absent (small file).

## Guard limits (hard)
Cool-start ≤ 32.0 °C before every arm; NPU arms WARN 400 / **KILL 410**, wall cap **10 min**
(kill at cap); CPU arms WARN 400 / KILL 430; battery ≥ 45 %; unplugged declared. Any
`dspqueue`/`INTERNAL-ERROR`/`ggml_abort`/CDSP crash line or a guard kill in an NPU arm → record
and STOP the cell (no retry). The benign `common_fit_params ... abort` warning is not a stop.

## Part A — correctness (per model, OLMoE first)
HTP arm: `llama-perplexity -ngl 99 -dev HTP0 -c 2048 -b 2048 -ub 1024 -fa on --load-mode none
--chunks 32 -v` (env as q48: NDEV=1, HOSTBUF=1); execute-op proof required: ≥ 1 `MUL_MAT_ID`
execute-op on HTP0 for OLMoE (experts really on NPU), attn execute-ops for Qwen.
CPU-ref: same flags, `-ngl 0`, `--chunks 32`.
`r = PPL_HTP / PPL_CPU − 1` over the same 32 chunks. **PASS ≤ 2 %; GREY 2–5 %; FAIL > 5 % or
NaN**; proof lost → VOID for that model. If the HTP arm is guard-killed or capped before 32
chunks, use the running PPL at the last common chunk n ≥ 8 for both arms (record n) as an
8-plus-chunk characterization, not a 32-chunk certification.

## Part B — spike thermal (OLMoE, then Qwen if time/battery allow)
llama-bench `-p 512 -n 0 -r 2 --no-warmup -t 8 -fa on --load-mode none -o jsonl`, order
NPU, CPU, CPU, NPU (NPU `-ngl 99 -dev HTP0 -v`; CPU `-ngl 0`), each under the guard with battery
pre/post and `dumpsys thermalservice` pre/post (does v75/HyperOS expose numeric headroom?).
Metrics: ΔT per arm (post − pre), MAX, wall, t/s (exploratory), execute-op / offload proof.
Energy via charge counter: recorded only, flagged unreliable (q57 lesson).

## Consequence
- OLMoE PASS → the router ledger R2 gains "correctness certified (32 chunks, v75)"; still OFF
  pending the app-side spike-lane cell and the npu_fit memory model.
- FAIL/GREY → R2 stays uncertified; numbers to the owner.
- Part B numbers feed the v75 column of the spike-lane rule (N_max/threshold are per generation).

## Outputs
`RUN_LOG.md`, `manifest.json`, `raw/`, `REPORT.md` (numbers only).
