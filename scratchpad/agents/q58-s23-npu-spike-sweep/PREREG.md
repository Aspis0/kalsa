# q58 — S23/v73 NPU prefill SPIKE sweep under guard: heat per prompt vs prompt size (PREREG)

**Status: LOCKED at commit time.** Owner 25/08: NPU prefill "a spike, sempre" and it must be
"super sicuro per gli user" → this cell produces the numbers behind the spike rule
(N_max tokens, thermal threshold) for the router v1.

## Question
On the S23 (v73), for a dense/hybrid HTP-readable model (Qwen3.5-4B-Q4_0, already on device,
sha `298fcb5f…`), how much heat does ONE prefill of n tokens leave, NPU vs CPU, for
n ∈ {128, 512, 1024, 2048}? Which n keeps the NPU spike under +1.0 °C per prompt?

## Arms (kalsahtp llama-bench, `-n 0 -r 2 --no-warmup -t 8 -fa on --load-mode none -o jsonl`)
- NPU: `-ngl 99 -dev HTP0` (env NDEV=1, HOSTBUF=1 as q53 lane 2), `-v` for execute-op proof
- CPU: `-ngl 0`
- Prompt sizes: `-p 128 | 512 | 1024 | 2048`. Order per size: NPU, CPU, CPU, NPU (ABBA-lite),
  sizes ascending. 16 runs total. Every run under the thermal guard
  (NPU WARN 400 / KILL 410; CPU WARN 400 / KILL 430), cool-start ≤ 32.0 °C before each run
  (poll 60 s), battery ≥ 45 %, unplugged declared.
- Extra capture per run (recorded): `dumpsys thermalservice` (thermal status, headroom if
  exposed) before/after — this is what the app would read via PowerManager.

## Metrics per run (from guard CSV + battery pre/post + jsonl)
ΔT_prompt = post − pre battery temp (°C); MAX temp; wall; pp t/s; execute-op count (NPU) /
offloaded 0/33 (CPU); °C per 1k tokens.

## Frozen derivations (no gate, characterization)
- N_max(NPU) = largest n whose mean ΔT_prompt over its 2 NPU runs ≤ 1.0 °C.
- Thermal-threshold candidate = 40.0 °C − max over sizes ≤ N_max of ΔT_prompt (the start
  temperature above which one more NPU spike could cross 40 °C).
- Table NPU vs CPU: °C per 1k tokens and seconds per 1k tokens, per size.

## Stop rule
Real crash only (rc ≥ 128 not from the guard; `ggml_abort`/`GGML_ASSERT`/`dspqueue`/
`INTERNAL-ERROR`/`Aborted`/`CDSP`) or a guard kill → record, stop. The benign
`common_fit_params ... abort` warning is NOT a stop.

## Outputs
`RUN_LOG.md`, `manifest.json`, `raw/`, `REPORT.md` (numbers only, N_max and threshold stated).
