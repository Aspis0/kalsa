# DESIGN DRAFT — per-phase governor: thermal/backend routing (device × model × phase)

Status: draft, 2026-09-27. Written from the raw cells and engine sources; nothing here is
committed code. Engine read at `kalsallama-wt-oom` branch `kalsa-opencl-upload-oom-throw`
@ f25f0c1c5; binding at `llama.rn-kalsa` branch `kalsarn-governor-engine`; app at
`kalsa-wt-iroh`. Experiments repo @ 5c2d3fad. All quoted numbers are from the files named.

## 1. What the engine governor does TODAY

**Structure.** The governor owns two contexts over (potentially) two models:
`ctx_prefill` and `ctx_decode`, created from separate `llama_context_params`
(`src/llama-governor.cpp:38-47`); the constructor *requires* independent KV caches —
"governor contexts must have independent KV caches" (`src/llama-governor.cpp:34-36`).
A turn's batch is a prefill when `batch.n_tokens > 1`, else decode
(`src/llama-governor.cpp:254`). Phases: `phase {None, Prefill, Decode}`
(`src/llama-governor.h:65`), plus the prefill sub-route latch
`prefill_route {Undecided, GPU, CPU}` (`src/llama-governor.h:68`).

**Backend choice per phase.**
- Prefill: `prefill_engine()` (`src/llama-governor-policy.cpp:174-225`) returns CPU on any
  safety failure (invalid schema/profile, CRITICAL, LOWBAT, `:185-188`); honours the bench
  override (CPU `:194-199`, GPU only if `gpu_fit == Fit`, `:200-206`); then the measured rule:
  GPU prefill for V73/V75/V79 when `gpu_fit == Fit && gpu_prefill_measured` (`:214-219`,
  ALIVE #38 cited at `:210-211`); V73+MoE cool-only lane `:220-223`; else CPU.
- Decode: `select_decode()` (`src/llama-governor-policy.cpp:322-350`) is CPU unless a
  V73+MoE COOLMODE lane passes six gates (`cool_delta_measured`, `kexp_cool_scope`,
  `cool_pays`, reload budget, 60-min flip window `:9, :330-336`); a change of decode engine
  returns `requires_reload` and the runtime refuses with −2 ("decode engine change requires a
  full context reload", `src/llama-governor-runtime.cpp:187-190`). NPU is never selected:
  "Deferred: v0.2 never selects this lane" (`src/llama-ext.h:194`); the app sends
  `npu_lane_enabled: false` (`src/engine/governorInputs.ts:207`).
- **Split phases across backends: already working.** The GPU route executes prefill on
  `ctx_prefill` (an ngl-99 context) while decode always runs on `ctx_decode` (ngl 0):
  `src/llama-governor.cpp:269-271`. The binding loads TWO models to make this real:
  `load_governor_models` sets `prefill_params.n_gpu_layers = 99; decode_params.n_gpu_layers = 0`
  and calls `common_init_from_params` twice (`cpp/rn-llama.cpp:75-93, 112-127` in
  llama.rn-kalsa). The app confirms the shape: `nGpuLayers: { prefill: 99, decode: 0 }`
  (`src/engine/LlamaService.ts:2692-2700`). KV crosses between the sides per phase change via
  `commit_side` → `llama_kv_commit_with_stats` (`src/llama-governor.cpp:283-293, 113-147`), and
  a CPU-routed prefill catches its conversation prefix up to the decode side
  (`src/llama-governor.cpp:303-312`). So today's S23 production shape is *already* a
  two-backend session: OpenCL prefill + CPU decode. What does not exist: HTP in either lane.

**Thermal policy.** Owner decision 2026-09-25 in the source: pause at 43 °C, kill at 44 °C —
`k_warn_c = 43.0f`, `k_limit_c = k_warn_c - 0.5f` (admission ceiling 42.5), `k_kill_c = 44.0f`
(`src/llama-governor-policy.cpp:10-17`). CRITICAL (≥ kill, or the profile's critical line)
turns prefill admission into `Abort` → sticky `fail()` (`src/llama-governor-policy.cpp:85-87`,
`:242-249`; `src/llama-governor-runtime.cpp:80-82`) and decode into −2/fail
(`src/llama-governor-runtime.cpp:179-183`). Pause is the flow-control −2 with the warn log,
never a failure (`src/llama-governor-runtime.cpp:83-88`).

**Admission deltas.** Chunk rows {128, 512, 1024, 2048} tokens with heat deltas
{1.9, 3.25, 3.25, 5.15} °C; a row is admitted while `now_c + delta ≤ 42.5`
(`src/llama-governor-policy.cpp:19-20, 266-271`). Below 43 °C the smallest row always passes
(owner floor 2026-09-24, `:263-268`). The code states these deltas are "unmeasured defaults
(40051f8ae) applied to CPU and GPU prefill alike" (`:260-262`) — one table, no per-backend or
per-device split.

**Router tests** (`tests/test-governor-v02-router.cpp`): pin the ledger (NPU stays off,
prefill_token_cap 512 only when `npu_lane_enabled`, `:37-48`), NPU-admission stamping
(`:50-52`), LOWBAT → CPU / plugged → GPU prefill (`:56-82`), and the COOLMODE decode
relaunch with `requires_reload` (`:85-97`). No test exercises HTP as a context device.

## 2. Candidate S23 routing: prefill on HTP, decode on CPU

**Measured (single turns, engine f25f0c1c5, LFM2.5-2.6B Q4_0, prompt 1010, 126 decode, −t 5;
`qdc-heat-3way/raw/s23-3way-6/results.tsv`):**

| backend | prefill ms (cold / warm) | decode tok/s | proof |
|---|---|---|---|
| CPU | 19026.97 / 10389.45 | 21.15 / 21.12 | `cpu_no_offload off=0/31` |
| GPU (OpenCL) | 7347.20 / 7326.37 | 11.26 / 11.10 | `62 assigns, 15 kernels, off=31/31` |
| NPU (HTP0 v73) | 1668.22 / 1558.10 | 13.01 / 12.91 | `htp_ops=1398 arch=v73 off=31/31` |

HTP prefill is 4.4–4.7× faster than OpenCL and 6–12× faster than CPU on this model; CPU decode
is the fastest decoder (21 vs 13/11). The direction "HTP prefill, CPU decode" is what the
table says. Decode inside the HTP arm was measured with the same `-nkvo` single-context CLI
run; it is not a governor decode-lane number.

**Memory.** Weight buffers per load log (`raw/s23-3way-6/*.load.log`):
- CPU layout: `CPU 206.07 + CPU_REPACK 1511.20` MiB (`t1cpu.load.log:7028-7029`);
- HTP layout: `CPU 205.08 + HTP0 1525.87` MiB (`t3npu.load.log:12289-12290`);
- OpenCL layout: `CPU 205.08 + CPU_REPACK 205.08 + OpenCL 1307.20` MiB (`t2gpu.load.log:1771-1773`).
Compute: HTP arm reserves `HTP0 516.00 + CPU 32.03` MiB (`t3npu.load.log:10925-10926`); GPU arm
`OpenCL 142.04 + CPU 516.00` (`t2gpu.load.log`); CPU-only 528.03 (`t1cpu.load.log`). KV is 32 MiB
per context (`t3npu.load.log:12609`).

**Is this two weight copies? Yes — and it already is today.** The governor loads two models
(two `common_init_from_params` calls, `cpp/rn-llama.cpp:112-127`), so the 1511 MiB CPU_REPACK
copy and the accelerator copy coexist by construction. The app's lane price says the same:
"the ship model's CPU_REPACK buffer was ~1511 MiB for its 1520 MiB Q4_0 file"
(`src/engine/governorInputs.ts:88-91`), and the 8 GB S23 lane is priced at
"4358.70 MiB required with repack vs 2998.06 without" (`:168-169`). INFERRED from the log
numbers: swapping the prefill model's device from OpenCL to HTP0 is roughly memory-neutral —
weights 1730.95 vs 1717.36 MiB (+13.6), compute 548.03 vs 658.04 MiB (−110) — so an
HTP-prefill governor session stays near the existing ~4.4–4.7 GiB two-copy footprint
(simple sum of the buffers above; not a device measurement).

**KV handoff.** Already the load-bearing path: per phase change `commit_side` copies
[src.watermark, end) into the other side after `llama_kv_route_query` accepts the pair
(`src/llama-governor.cpp:83-152`); the query rejects mismatched memory kinds, returns
MirrorAndCopy for hybrid caches (LFM2.5 is hybrid) and Direct only for shared cells
(`src/llama-kv-commit.cpp:290-313`). Rewinds go through `trim_sequence`, which clears a side
wholesale when the hybrid window refuses a partial rollback (`src/llama-governor.cpp:210-225`).
INFERRED: an HTP prefill context must keep its attention cache on host (the `-nkvo` /
`offload_kqv=false` shape measured in the CLI, `qdc-heat-3way/REPORT.md:18`) for the route
query to see compatible caches; that compatibility has never been exercised with an HTP side.

**Feasibility verdict.** Feasible in the S23's memory (same two-copy class as the shipping
OpenCL lane). Engine/binding changes needed: (a) the binding's `load_governor_models`
hardcodes the prefill lane to ngl 99 with no device selection (`cpp/rn-llama.cpp:75-80`) — it
needs a per-lane device (`HTP0`) and `no_kv_offload` for that context; (b) the policy's NPU
lane must be reachable (`src/llama-ext.h:194` defers it; `prefill_engine` has no NPU branch,
`src/llama-governor-policy.cpp:174-225`; admission already stamps a requested NPU engine,
`:308`); (c) the app must send `npu_lane_enabled` + fit data for the HTP copy
(`src/engine/governorInputs.ts:207` hardcodes false). The HTP skels already ship in the app:
`libggml-htp-v73/v75/v79/v81.so` are packaged as assets by the binding's gradle
(`android/build.gradle:19-66`; `bin/arm64-v8a/` holds all four).

## 3. What the tables CANNOT decide yet

**Heat.** The turns were 16–29 s — "Skin deltas ~1 C (turns are 16–29 s: too short for a heat
verdict)" (`scratchpad/COORDINATOR-STATE.md:132`). The 3-way skin rises: CPU arms mean +1.25 °C,
NPU arms 0.00, GPU contrast +0.9/−0.2 (`qdc-heat-3way/REPORT.md:1004-1006`) — n=2 per arm, no
steady state. QDC per-backend pairs exist but are single-turn app rows: QRD8650 forced-128
CPU−GPU deltas +1.315/+0.549/−0.827/−0.276, "the sign follows which arm got the cold board"
(`qdc-heat-per-backend/REPORT.md:1142-1144`); QRD8750 forced-127 four pairs all CPU-hotter,
+0.349…+0.884 (`:1385-1392`); the night rows are confounded by unequal decode (CPU 96 vs GPU 42
tokens, `:932-934`). The unmeasured quantity is **per-backend sustained °C per 1000 tokens and
the throttled throughput at steady state** — exactly what the admission delta table and the
heat-ordered selector need (`analysis/GOVERNOR-DEVICE-PLAN.md:322-334`). The one banked per-1k
number is CPU-vs-NPU on the S23 from the q58 sweep: "NPU runs measured 0-1.1 °C/1k tokens vs
CPU 3.2-14.8" (`npu-spec-verify/REPORT.md:67-70`), never reproduced and method-contaminated per
the device plan (`GOVERNOR-DEVICE-PLAN.md:546-560`).

**Minimal next measurement (decides the S23 heat row):** sustained arm per backend on the S23,
unplugged, tools off, `persist.traced.enable=0`, model/prompt as in s23-3way-6:
loop the fixed turn (1010-token prompt + 126 forced decode, `--no-conversation`, `-t 5`)
back-to-back for 12–15 min per arm (≈ 15–20 turns warm; the cold-load phase stays outside the
window as in the 3-way kit), order C/G/N balanced across sessions. Record at 1 Hz: HAL skin,
battery temp, thermal status; per turn: prefill_ms, decode tok/s, route proof (htp_ops /
kernels / no_offload); per minute: tok/s decay vs minute 1; skin vs cumulative tokens (the
slope is the table entry, °C/1k tokens); time-to-first throttle. Stop at skin 44 °C or
thermal status ≥ 2. Deliverable: `heat_per_1k_c[device][model][phase][engine]` + `tok_s_at_steady`
— enough to fill one routing-table row and to replace the guessed 1.9–5.15 °C deltas for
this device. Everything else (Jelly: Mali parked by owner decision, no accelerator,
`GOVERNOR-DEVICE-PLAN.md:489-510`; Xiaomi 14: only a 2B-cell battery-temp HTP prefill point,
165.42 vs 51.90 tok/s, whole-cell ΔT +1.3 with HTP +0.4, `:447-449`) stays unmeasured per phase.

## 4. Routing-table format and home

Follow the device plan's Rule 1/2 — "Device identity never enters a decision … The matrix is
data, not control flow" (`analysis/GOVERNOR-DEVICE-PLAN.md:60-79`). One row per
`(device signature, model signature, phase)`; the device signature is the probe cache key the
plan already defines (socModel + GPU driver + app versionCode, `:81-83`).

```
// shipped asset (JSON), one record per device × model:
{
  "device":  { "soc": "SM8550", "gpu_driver": "...", "hexagon": "v73" },
  "model":   { "id": "lfm2.5-2.6b", "quant": "Q4_0", "kind": "Hybrid", "size_bytes": 1593894944 },
  "phases": {
    "prefill": { "rank": ["HTP0", "GPUOpenCL", "CPU"],
                 "entries": [ { "engine": "HTP0",      "tok_s": 6.0,  "heat_per_1k_c": null,
                                "fit_mib": 2290, "correct": "bench", "measured": "s23-3way-6 2026-09-27" },
                              { "engine": "GPUOpenCL", "tok_s": 1.4, "heat_per_1k_c": null, ... },
                              { "engine": "CPU",       "tok_s": 0.05, "heat_per_1k_c": null, ... } ] },
    "decode":  { "rank": ["CPU"], "entries": [ { "engine": "CPU", "tok_s": 21.1, ... } ] },
    "admission_deltas_c": { "prefill": { "128": null, "512": null, "1024": null, "2048": null } }
  }
}
```
`tok_s` normalized per phase (prefill = 1000/prefill_ms). `null` = unmeasured → the entry is
excluded from ranking until §3's arm fills it, but keeps its measured speed.

**Home: the app owns the table, the engine owns the selector.** Today every input the policy
consumes is already assembled app-side (`buildGovernorParams`, `src/engine/governorInputs.ts:183-212`)
and the load-side memory fit lives app-side too (`lanePrice`/`gpuFit`, `:82-181`). The table
becomes the data source for those builders; the engine's `llama_governor_params` gains the
per-phase engine rank/deltas already implied by its schema (generation/model_kind/gpu_fit/npu_fit
fields, `src/llama-ext.h:234-253`) instead of new `if (device)` branches. The device plan's
acceptance criterion stands: adding a phone touches one data file, zero decision files.

**Fail-safe default when a row is missing:** CPU-only, both phases, with the existing
safety preemption intact. This is today's behaviour from three independent directions: unknown
generation → governor disabled (`src/engine/governorInputs.ts:25, 191`); invalid schema or
profile → CPU ("safety preempts", `src/llama-governor-policy.cpp:185-188`); decode → CPU unless
every cool-lane gate passes (`:337-339`). Probes fail closed (`GOVERNOR-DEVICE-PLAN.md:83-84`).

## 5. Risks and unverified items

1. **HTP correctness in-app is unproven.** "correctness OK" exists only at bench level
   (`COORDINATOR-STATE.md:113`); the 3-way CLI arms never compared logits/text across backends.
   The V75 in-app history (oracle FAIL on R2 raw, `governorInputs.ts:15-25`) is the cautionary
   shape; the logit-oracle protocol should gate an HTP lane exactly as it gated OpenCL.
2. **KV route with an HTP side has never run.** MirrorAndCopy for hybrid caches is proven
   CPU↔OpenCL only; `-nkvo` keeps attention on host (INFERRED compatible), but
   `llama_kv_commit_access::compatible` for an HTP-side context pair is unverified (I did not
   trace it), and the 516 MiB HTP compute buffer was measured at `-c 2048 -b 2048` — the app's
   n_batch will change it.
3. **The decode side of the HTP arm is not a lane number.** 13 tok/s was measured inside a
   single-context CLI run; a governor decode lane stays CPU (21 tok/s) — that part needs no new
   measurement for speed, only for heat.
4. **Sustained heat is the open gate.** Every routing decision that claims "cooler" rests on
   16–29 s turns (§3); the QDC battery sensors are stubs, so skin is the only usable channel
   there (`qdc-heat-per-backend/REPORT.md:954-956`).
5. **Speculative lanes are refuted, not pending.** DSpark loses on the S23 at 59 % acceptance
   (A0 23.63/23.50 vs B4 21.14, C4 9.51; `spec-dspark-gpu-draft/raw/s23-dspark-5/results.tsv`,
   `COORDINATOR-STATE.md:142-147`); NPU-as-verifier is killed on speed at v73 and v79 (CPU
   K=4 = 1.24–1.42× one step vs HTP 1.81–1.82×; `npu-spec-verify/REPORT.md:161-171, 214-225`).
   Routing design should not budget for them.
6. **Could not verify from here:** whether the app runtime extracts the packaged HTP skels and
   sets `ADSP_LIBRARY_PATH` (gradle packages the assets; the extraction path is untraced);
   whether `ContextParams` can carry a per-context device list at all (the binding derives both
   lanes from one `owner.params`, `cpp/rn-llama.cpp:75-80`); mmproj still disables the governor
   (`!options.mmprojPath`, `src/engine/LlamaService.ts:2439`) — pending owner decision since
   `COORDINATOR-STATE.md:31-34`; and all devices except the S23 lack any per-phase heat row.
