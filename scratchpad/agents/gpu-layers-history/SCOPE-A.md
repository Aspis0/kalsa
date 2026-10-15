# SCOPE A - living documents: GPU layer-count history

Explorer A, 2026-10-15. Read-only sweep of `PLAN.md`, `docs/ALIVE.md`, root
`BACKLOG-LOW-PRIORITY.md`, `scratchpad/BACKLOG-LOW-PRIORITY.md`, `scratchpad/HANDOVER-GOVERNOR-*.md`.
Not read (other scopes): `archived/`, `scratchpad/agents/**`, `results/`, `reports/`, `analysis/`.

## Bottom line

The living documents contain **no record of the GPU at an intermediate layer count**. Every GPU
placement recorded is all-or-nothing: `n_gpu_layers 99` (whole model) or 0 / CPU. The "fewer layers on
the GPU" idea that the owner remembers is, in this scope, represented only obliquely by the
**three-legs** axis (whole weight copy shared by NPU+GPU+CPU, governor hops decode between legs) -
which is a different axis from layer count. The one place a memory-fit refusal is recorded in the
living documents is backlog item A2.

## Evidence table

| candidate experiment or decision | file:line | verbatim quote | date | device | plugged/unplugged/QDC | numbers |
|---|---|---|---|---|---|---|
| Only `n_gpu_layers` value in scope: full offload, flagged as WASTE, not as a tunable | `scratchpad/BACKLOG-LOW-PRIORITY.md:46-47` | "Binding loads the prefill model at n_gpu_layers 99 even when the lane did not resolve and the policy can only pick\n  CPU (rn-llama.cpp ~:235): wasted GPU memory on a double-failure path (HTP0 seen by the app, unresolved at load)." | 2026-10-03 (section header `scratchpad/BACKLOG-LOW-PRIORITY.md:45`, "Every-Snapdragon governor (2026-10-03, session 1d714246...)") | not stated | not stated | `n_gpu_layers 99`; binding site `rn-llama.cpp ~:235` |
| **Memory-fit refusal** `gpu_fit === "NoFit"` - the app refuses EVERY governor load | `BACKLOG-LOW-PRIORITY.md:107-109` | "A2 (P2, audit of app c5898702, 2026-10-11) `LlamaService.ts:2521` refuses every governor load with `gpu_fit === \"NoFit\"`,\n  although `buildGovernorParams` can enable the governor on the NPU lane's own fit (`governorInputs.ts:360-370`, whose\n  comment promises a lane-only load). A device whose GPU does not fit but whose NPU lane does falls to CPU." | 2026-10-11 | any (device-agnostic app path) | n/a | app `c5898702`; `LlamaService.ts:2521`; `governorInputs.ts:360-370` |
| Fit gate is ESTIMATE-based, and low-RAM phones are guarded only by it | `PLAN.md:145-146` | "Blast radius: Mali/MediaTek/unknown SoCs and iOS never load the governor; low-RAM phones are\n  guarded only by its estimate-based fit; V75 enablement rests on one board plus the Xiaomi lab." | undated in place (context: V75/rule-v3 block, 2026-10-09) | generic low-RAM | n/a | none |
| The Xiaomi/Qwen fit-gate analysis exists but is OWNER-SUSPENDED | `PLAN.md:386-388` | "Owner-suspended: vision lazy loading (mmproj eager); ciswire window counted in characters;\n  catalog gate threshold. Records: `analysis/XIAOMI-QWEN-FITGATE-AND-CISWIRE-TOKEN-OVERFLOW-2026-09-20.md`,\n  `archived/PLAN-2026-09-full.md:682`." | 2026-09-20 record | Xiaomi 14 | n/a | none in the living text |
| The fit-gate analysis is still listed as "in force" | `docs/ALIVE.md:93` | "Xiaomi/Qwen fit-gate + token overflow" (row "Analysis records still in force") | - | Xiaomi 14 | n/a | none |
| GPU leg = a whole leg over ONE shared copy, not a layer subset | `PLAN.md:110` | "One weight copy read by NPU, GPU and CPU; the governor hops decode between legs." | workstream front | all | n/a | none |
| GPU leg measured as a leg on the Xiaomi (leg-level, not layer-level) | `PLAN.md:129-131` | "Xiaomi 14 real phone, unplugged (cells `xiaomi-endur-npu-gpu-75`, `xiaomi-legheat-76`): GPU\n  19.7-21.3 tok/s but ~3.2 C skin per 1k tokens; NPU 14-17.5 tok/s at ~1.1 (8192 tokens, never\n  reached 43 C); CPU 14.7 tok/s at ~7.3. Load steps ~5/11/26 C (npu/gpu/cpu; npu/gpu lower bounds)." | 2026-10-09 area | Xiaomi 14 | **unplugged** | GPU 19.7-21.3 tok/s; NPU 14-17.5; CPU 14.7; skin 3.2 / 1.1 / 7.3 C per 1k tok |
| Same, restated in ALIVE | `docs/ALIVE.md:87` | "Xiaomi 14 endurance (unplugged, to skin 43): NPU alone ~7.5-8k tokens vs CPU alone ~1.5k (~1.0 vs ~5.4 C skin per 1k tokens); GPU leg excluded then (pre-fix)" | - | Xiaomi 14 | **unplugged** | NPU 7.5-8k tok; CPU ~1.5k tok |
| Governor "loses" to the single legs -> no partial/GPU-budget rationale recorded | `PLAN.md:119-124` | "Governor vs single legs, S23 endurance to skin 43 C, unplugged: round 3 headroom governor\n  LOST (2785 tokens vs NPU-alone 6051, GPU-alone 5506;\n  `step5-s23/raw/session26-vsleg3-fbf33176c.grep`). Round 4, rule v3 HEAT_RANK: TIES NPU alone\n  (449/420 s vs 453/431 s, same 6144 tokens..." + "its value is\n  cross-device robustness ... and SoCs where the NPU trips." | 2026-10-08 area | S23 | **unplugged** | 2785 vs 6051 vs 5506 tokens; 449/420 s vs 453/431 s, 6144 tokens |
| Only `-ngl` in scope is a DESKTOP server run with 0 layers, not a phone sweep | `scratchpad/HANDOVER-GOVERNOR-2026-10-01.md:40` | "...the manifest sent to kalsa-brain, which repins and re-runs the Lenovo cross-device MTP repro). Remaining: The engine worktree `~/Projects/kalsallama-v115` ... can be removed after the release is verified." (same line 21 records M1 `-ngl 0` at 124 tok/s vs v1.1.4 SIGILL) | 2026-10-01 | Mac M1 Max / desktop server | n/a | `-ngl 0`; 124 tok/s vs SIGILL |
| GPU-leg prefill as a binary fallback (on/off), never a partial split | `PLAN.md:372-374` | "2026-10-11: V81 GPU prefill is the fallback when the NPU lane is off (app `df359450`, engine `f1f612388`).\n  Verified on the SM8850 the same evening (`qdc-v81-fallback-df359450`, 4 turns): lane off -> prefill GPU\n  295 tok/s, decode CPU, no fallback, no crash...; defaults -> prefill NPU 1342 tok/s;\n  governor OFF -> CPU 224 tok/s." | 2026-10-11 | SM8850 **QDC** | plugged ("indicative" per ALIVE) | GPU 295 / NPU 1342 / CPU 224 tok/s prefill |
| Tied-output invariant (J(1)) that constrains GPU compute placement | `scratchpad/HANDOVER-GOVERNOR-2026-10-05.md:26` and `:53-54` | "2. **Tied output route = J(1)** (owner decision): one flat Q6_K `token_embd` in `HTP0-HOST-W`; the GPU leg reads it in" ... "J(1) consequence: NPU decode on the shared\n   copy REQUIRES the OpenCL HOST leg admitted - the table must refuse NPU-shared decode where it is not (R2)." | 2026-10-05 | S23 / lab | lab | none |
| SM8650 (Xiaomi) legs row NOT shipped - a shipped-config reversal about GPU on the Xiaomi | `PLAN.md:153-158` | "SM8650 row NOT shipped (audit P1): the engine's TILE32 gate admits only Adreno 740 / E031.41\n  outside lab builds (`ggml-opencl-tile32-facts.cpp`), so the row (binding `84ac0d57`, unpushed,\n  values from cells 75/76) would load one-copy, fail the J(1) fence and reload two-copy on every\n  Xiaomi load." | 2026-10-09 | Xiaomi 14 | n/a | binding `84ac0d57` |
| Prewarm + governor-refusal coupling recorded (no layer counts) | `BACKLOG-LOW-PRIORITY.md:29-31` | "A4 (P2, audit of A1 fix `45d3989d`, 2026-10-09) `staticPrefixSnapshot.ts:165/225` (prewarm snapshot load/save) still\n  maps the governor refusal to `load_error` / `save_error` in `KALSA_PREWARM`; no data loss (load deletes nothing, save\n  only its tmp)." | 2026-10-09 | generic | n/a | none |
| Reading the executing device is per-layer telemetry (`layers_device`) - the only "layers" token in ALIVE | `docs/ALIVE.md:115-117` | "Read the executing device from `layers_device`, never from the per-chunk `actual` or the\n  per-turn `engine_prefill` label: lane-on, those named \"gpu\" while HTP0 executed" | - | S23 | n/a | none |

## Per-question verdicts

1. Partial GPU offload / intermediate layer count / degradation ladder -
   **NO EVIDENCE FOUND.** The only `n_gpu_layers` in scope is the all-on value `99`
   (`scratchpad/BACKLOG-LOW-PRIORITY.md:46`), recorded as wasted memory, and every other GPU placement
   in the living documents is binary (GPU prefill vs NPU vs CPU, e.g. `PLAN.md:372-374`); "layers"
   appears once in `docs/ALIVE.md:115` as `layers_device` telemetry, not a layer count.
2. Memory-fit refusal - **EVIDENCE EXISTS (`BACKLOG-LOW-PRIORITY.md:107-109`)** plus the estimate
   caveat at `PLAN.md:146`; the prescribed response recorded there is *lane-only enablement*
   (`governorInputs.ts:360-370`), i.e. fall through to CPU when only the GPU does not fit - **no
   record of reducing the GPU layer count as a response**.
3. Rule forbidding / forbids-adjacent partial GPU offload - **NO EVIDENCE FOUND.** No living-document
   rule names layer-count reduction; the adjacent invariants are leg-shaped, not layer-shaped: the
   one-copy three-legs contract (`PLAN.md:110`), the J(1) tied-output fence (`scratchpad/HANDOVER-GOVERNOR-2026-10-05.md:26`,
   `:53-54`), the TILE32 Adreno gate (`PLAN.md:153-158`) and the `offload_op`/HOST-op admission notes
   (`scratchpad/HANDOVER-GOVERNOR-2026-10-05.md:45-46`).
4. GPU memory footprint per layer, measured or estimated - **NO EVIDENCE FOUND.** The only
   memory numbers in scope are system RAM and Hexagon buffers: one-copy vs two-copy RAM 2.51 GB vs
   4.06 GB in-app (`PLAN.md:138`), RSS 2.4 GB vs 3.9 GB (`docs/ALIVE.md:28`), "~0.9 GB MemAvailable"
   (`docs/ALIVE.md:33`), mbuf caps 512 MiB / 1 GiB (`BACKLOG-LOW-PRIORITY.md:5`), "HTP0 compute
   buffer 129 MiB" (`scratchpad/HANDOVER-GOVERNOR-2026-10-01.md:28`). No per-layer GPU figure, no
   estimate formula, and `required_mib` / `available_mib` appear **nowhere** in my scope.
5. Superseded / reversed about GPU layers - **WEAK / ADJACENT ONLY.** The one real reversal is
   about the Xiaomi GPU row being withheld, not about layer counts: `PLAN.md:153-158` (row NOT
   shipped, would "fail the J(1) fence and reload two-copy on every Xiaomi load") over the earlier
   in-app Xiaomi claim at `PLAN.md:134-135`. A stale *comment* was also corrected
   (`scratchpad/BACKLOG-LOW-PRIORITY.md:270`: "F4 P3: the comment says the 740 is \"untested\"; say
   \"not A/B'd\" (the S23 GPU leg has passing KL runs on record)"). Nothing in scope shows a partial
   GPU offload being tried and then dropped.

## What I could NOT verify

- Whether the "GPU at different layer counts" test the owner remembers exists at all: my scope holds
  no such record, and the likely homes (`archived/`, `scratchpad/agents/**`, `results/`, `reports/`,
  `analysis/`) belong to scopes B-D. **I cannot confirm or refute it from the living documents.**
- The incident numbers (`gpu_fit: NoFit`, `available_mib 3004.93`,
  `required_mib_without_repack 3385.06`, `n_gpu_layers = 0`, 1760-token prewarm 2.0 s -> 109.4 s)
  appear in **no** file of my scope - today's incident is not yet written into PLAN/ALIVE/backlogs.
  The closest record is the generic A2 `NoFit` refusal (2026-10-11), which predates it.
- The current status of A2 (fixed vs still open) cannot be determined: the root backlog carries no
  RESOLVED marker on it, unlike A4 at `BACKLOG-LOW-PRIORITY.md:112`.
- Device / power state for the `n_gpu_layers 99` and `NoFit` rows: neither line states a device or a
  plugged/unplugged condition. ALIVE's rule (`docs/ALIVE.md:110-114`) says heat/speed claims are
  only valid unplugged - these rows carry no such claim, but they also carry no state.
- `analysis/XIAOMI-QWEN-FITGATE-AND-CISWIRE-TOKEN-OVERFLOW-2026-09-20.md` is referenced twice
  (`PLAN.md:387`, `PLAN.md:394`) and listed "still in force" (`docs/ALIVE.md:93`); its contents are
  out of my scope, and it is the single most likely home of the fit-gate method and any numbers.

## Files I expected to exist but did not

- None in my scope. All four target document groups were present. Note for the sweep: `PLAN.md` is
  now **405 lines**, not the 388 quoted in the brief - it was edited after the brief was written.