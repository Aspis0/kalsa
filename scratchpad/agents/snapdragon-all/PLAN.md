# Every Snapdragon: CPU always, NPU by runtime arch, GPU where qualified (2026-10-03)

Owner, 2026-10-03: "Per 8 elite gen 5, mi sembra un bug grosso. Perché non lo fixi? Dobbiamo poter supportare
tutti gli snapdragon, cpu, GPU e NPU" + "Fixiamo o aggiorniamo questa lista di GPU non supportate".

Evidence: QDC SM8850 (8 Elite Gen 5, Hexagon v81, Adreno 840) never loads the governor:
`gpu-prefill-incorrect-Unknown` (lab `qdc-governor-on-off-1d51f196/`). Recon luna 0fdcee00 (2026-10-03):

- App `governorInputs.ts:74-138`: closed SoC-name map -> Generation V73|V75|V79|Unknown. Unknown =
  GPU_PREFILL_CORRECT false, `laneFit` NoFit (:190), htpArchFor null -> no NPU lane, and `LlamaService.ts:2408-2415`
  also needs `governorBase.enabled` + `gpu_fit != NoFit` -> no governor at all, so no CPU-decode governor either.
- Binding: ships skels v73/v75/v79/v81; Java already accepts SM8850; `rn-governor-params.cpp:47-53,145-153` parses
  generation Unknown|NoHTP|V73|V75|V79 (no V81). `llamaGetBackendDevicesInfo` exists (RNLlamaJSI.cpp:838).
- Engine: `llama-ext.h:197-203` enum has no V81; `llama-governor-policy.cpp:272-279` NPU branch does NOT check
  generation; GPU branch (:284-299) needs V73/V75/V79 + gpu_prefill_measured. ggml-hexagon detects the arch at
  runtime (`htpdrv_get_arch`) but CLAMPS: < v73 -> v73, > v81 -> v81, query failure -> v73 (a v69 phone would load a
  v73 skel). ggml-opencl maps Adreno 840 to A8X.
- GPU qualification today: V79 = oracle PASS 4/4 on one QRD8750; V75 = owner enablement after the f32-product GEMM
  fix, raw oracle FAIL R2 (same-top 94.8 %); V73 = owner decision, never measured in-app.

## Steps (each: implement -> verify on disk -> one hostile audit -> fix -> next)

1. **Engine** (kalsallama main): ggml-hexagon registers NO HTP device when the arch is unknown (query failure),
   below v73 or not one of the built skels (73/75/79/81) - no clamping; the HTP device description carries the
   runtime arch as a `v<NN>` token; `llama_governor_generation` gains V81 (GPU unqualified until measured).
2. **Binding**: vendor bump to step 1; `rn-governor-params.cpp` accepts V81; nothing else decides HTP support.
3. **App**: Generation gains V81 (SM8850 + QRD/MRD names) with GPU_PREFILL_CORRECT false; the NPU lane's arch comes
   from the runtime HTP device (`llamaGetBackendDevicesInfo`, `v<NN>` token), not the SoC name; `laneFit` prices
   memory only (no Unknown short-circuit); the governor loads when GPU prefill is qualified OR the NPU lane is
   eligible (its fit = the memory gate); GPU stays off unless qualified. Unknown/old Snapdragon -> CPU, clean.
4. **QDC SM8850**: NPU lane correctness + speed (app answers, needle) on v81; GPU oracle on Adreno 840 (the app-shaped
   logit oracle, `logit-oracle/PREREG.md`) -> flip V81 GPU only on PASS.
5. **GPU list -> runtime self-qualification** (owner: "fixiamo o aggiorniamo"): design next, after 1-4.
