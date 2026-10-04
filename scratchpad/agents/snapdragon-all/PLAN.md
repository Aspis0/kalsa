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

## Progress

- 2026-10-03 step 1 DONE: engine main `0917c6933` (1ca434ae5 no-skel-no-device, d31061926 V81, 0917c6933 the
  GGML_HEXAGON_ARCH override goes through the same skel check + WARN no longer prints an unread arch). Audit
  space-bunny 9ec5d8e8 (hung 3.5 h on a whole-filesystem grep, cancelled, report salvaged). Rejected: the hardcoded
  CDSP_DOMAIN_ID arch query (pre-existing, reads v75/v79 right on QDC); no host test for the hexagon logic (needs
  the SDK; step 4 is the check). Compiled locally in ghcr.io/snapdragon-toolchain/arm64-android:v0.7 (amd64
  emulation), ggml-hexagon EXIT=0: GitHub Actions minutes on Aspis0 are OUT (the snapdragon CI never started).
- 2026-10-03 step 2 DONE (unpushed): binding `697b6971` vendor bump + four skels rebuilt locally, `42af2e08` V81
  parser/types. Gates: assert-htp-skels / assert-kalsa-vendor / assert-rnllama-sources EXIT=0, params test 13/13.
- Step 2b (GLM f6df2c40): a lane that does not resolve must clear npu_lane_enabled (else the engine says NPU while
  the prefill context sits on the default GPU - an unqualified Adreno 840 on V81); backend_devices_info gains
  `description` ("Hexagon v<NN>") so the app can read the runtime arch.
- Step 3 inputs: SM8850 = ro.soc.model SM8850, board.platform / product.model "canoe" (QDC logs).
- 2026-10-03 step 2 PUSHED: binding feat/governor-platform-status e3ee58d7 (697b6971 vendor+skels, 42af2e08 V81,
  e6bc1fbe unresolved lane off in the policy, 37b05a60 device description, e3ee58d7 test comment). Audit luna
  f718f7ec: 1 fixed (comment), rest pre-existing/bench -> BACKLOG-LOW-PRIORITY.
- 2026-10-03 step 3 PUSHED: app main ac04c939 (0cf38a79 GLM: V81 SM8850/CANOE GPU false, htpRuntimeArch.ts,
  laneFit memory-only, enabled = force || gpu-qualified || lane; 300609e5 pin kalsa.rn e3ee58d7 + kalsallama.pin
  0917c693, cast removed; ac04c939 keep only a read arch). Audit luna b044597d: first-read race REFUTED (loadNative
  sets ADSP_LIBRARY_PATH before JSI), memoized null FIXED, bench paths -> backlog. Gates: provenance EXIT=0, tsc 0,
  jest targeted, apk.yml harness block EXIT=0.
- APK run 37135421002 (debuggable, ac04c939) building -> S23 v73 regression check, then step 4 QDC SM8850.
- 2026-10-03 S23 v73 regression check PASS on APK 37135421002 (ac04c939): production defaults, NPU lane auto
  opens on the runtime arch, prefill 707.7/703.9/703.2 short (ref 706.7), 654.1 long (ref 661.4), 4/4 correct,
  0 crashes - `s23-every-snapdragon-ac04c939/REPORT.md`. Next: step 4 QDC SM8850 (v81 NPU + Adreno 840 oracle).
- 2026-10-03 step 4 DONE (QDC SM8850 session 864730, 60.3 min, card 940 -> 850; Sonnet agent 387ebd8e, lab
  929eb3b9, verified on disk): Part A PASS - 8 Elite Gen 5 runs the NPU lane BY DEFAULT on v81: plan auto/Fit/HTP0,
  43/43 chunks HTP0, 0 fallbacks/crashes, prefill 1337/1334/1307 tok/s (CPU 112 on the old APK, ~12x), decode
  27.9/25.4/23.6. Part B: logit oracle on Adreno 840 FAIL R2 on both valid pairs (R1 clean; R5 still unmet, arm A
  truncated by the 48 C stop) -> V81 GPU stays OFF (owner's call under R6). Heat data (S23/8 Elite) also rank GPU
  last in prefill and decode, so the NPU-first order needs no GPU on V81.
- 2026-10-03 S23 sustained decode heat (tg1024, `s23-decode-heat-sustained/REPORT.md`): GPU 7.8 tok/s, 0.35-0.42
  battery C·s/token; NPU 21.7 tok/s, 0.15-0.17; CPU 19.9 tok/s, 0.30 (n=1, the CPU-2 arm hit thermal status 3).
  GPU decode is last on speed AND heat; NPU decode beats CPU on both when sustained. Owner question "when GPU?" ->
  only where no NPU lane is usable.
- 2026-10-03 owner: V81 GPU off, WARM keeps NPU (engine bc4fd8e8f, local, audit luna 773e9e0d), decode hops
  CPU<->NPU<->GPU incl. short GPU bursts to spread heat. S23 isolation run (`s23-gpu-host-isolation`): GPU decode
  at `-t 1` drops the CPU zone to 61-67 C (90-91 at `-t 5`) for -30 % speed; NPU at `-t 1` = 22.9 tok/s with the
  CPU at 61 C - host threads, not the accelerator, were heating the CPU. Next: thread count per backend in the
  governor + a hop prototype.
- 2026-10-03 prefill threads (`s23-prefill-host-threads`): NPU pp1024 t1 = t5 speed (892 vs 889) with CPU zones
  5-10 C cooler; GPU prefill t1 worse (-13 %, one hot core). -> STEP 1: HTP-pinned governor context at 1 host thread.
- 2026-10-03 decode-hop recon (luna 332ff775): CPU<->NPU mid-turn hop needs NO new infrastructure - two contexts,
  bidirectional llama_kv_commit (decode-to-prefill already exists, q8_0/q8_0 both sides), sampler and n_past are
  completion-owned; missing piece = per-token decode target choice + KV catch-up before each hop (today a decode
  engine change = full reload, -2). GPU as 3rd decode backend = 3rd context (~34 MiB KV @4k) and in practice a 3rd
  weight copy (GPU one-copy ~92x slower); GPU decode correctness on Adreno 740 unproven. -> STEP 2 prototype:
  CPU<->NPU every N tokens first, GPU after.
- 2026-10-03 owner vision: governor = 3-legged surfer (CPU/NPU/GPU), weight per moment, later on 2-3 legs at once by
  per-component temperature; hop code must show WHEN and WHY in one place per phase, no over-engineering.
- 2026-10-03 WARM + 1 HTP host thread SHIPPED (app 8eba7982): S23 prefill 706.8/707.7/706.7 tok/s (unchanged), WARM
  turn reports NPU (`s23-warm-1thread-8eba7982`).
- 2026-10-03 STEP 2 decode hop CPU<->NPU PUSHED behind `kalsa.bench.decode_hop` (default off): engine 32f6033c8
  (ed268d8f1 GLM + audit luna 1632b49f fixes: hop owns decode incl. COOLMODE, clock resets per completion, stats
  lifetimes, hybrid hop test), binding c3f982b5 (vendor + param + JSI stats + NPU decode-hop HTP failure attribution,
  audit luna 6f261cdd), app 3238e1bb. Host: all governor tests green on the ship model (hybrid), hop scenario greedy-
  identical. APK run 37160382939 -> S23 measurement: CPU-only vs hop N (tok/s, battery/skin area, CPU/NSP zone peaks).
- 2026-10-03 S23 in-app decode hop (`s23-decode-hop-3238e1bb`): hop works on real HTP (40 hops/turn, 17-19 ms total
  KV commit); decode 11.47/11.30 tok/s with hop vs 10.25 -> 8.09 CPU-only as the phone heats (CPU-only -21 %, hop
  -1.5 %); the only thermal status 3 was a CPU-only arm. Heat/token lower with hop in both pairs but confounded by
  hotter hop starts -> matched-start heat run still to do.
- 2026-10-03 S23 in-app zone probe (`s23-zone-probe-202a1370`, app 202a1370): the app process (untrusted_app) READS
  /sys/class/thermal - 86/95 temps, every cpu*/gpuss-*/nspss-* zone; 9 EINVAL (disabled zones, not SELinux).
  HardwarePropertiesManager: SecurityException (DEVICE_POWER) for CPU/GPU/SKIN. Per-component temperature input
  for the governor is available in-app on the S23. Jelly (MediaTek, A13): zones denied even to shell; HPM
  denied -> zone rule needs a no-zone fallback.
- 2026-10-04 S23 decode hop v1 by thermal headroom (`s23-decode-hop-auto-57e4d979`, app 57e4d979, engine bc5f0207c):
  the rule runs in-app (cpu=18/npu=4 zones, 37/37 windows by headroom, 12 ms commit/turn). Cool phone: hops almost
  every window; warm phone: 78 % of tokens on CPU (NSP nearer its 95 C trip than CPU to 108 C) -> 9.0 tok/s vs
  11.3-11.5 for the 03/10 fixed alternation; CPU arm killed at 43 C. Block-trip headroom is the wrong objective on
  the S23 (skin binds, trips never reached); v2 = NPU first, CPU only as NSP relief - owner decision.
- 2026-10-04 owner: v2 hop approved (NPU first, CPU as NSP relief) AND the GPU must be a third leg on ONE shared
  weight copy read by all three ("fondamentale"). Recon (luna a20aa92e, 3995e49a) + web research (luna 7703fab6):
  no published layout is near-native on NEON+HVX+Adreno; raw Q4_0 one-copy costs every leg (NPU 70 %, CPU 60-64 %,
  GPU GEMV ~1.75x slower). Design (`onecopy-three-legs/DESIGN.md`): the shared copy is the NPU's own tiled layout
  (32x32 tiles, rows contiguous per K pair, scales after) - NPU at two-copy speed by construction, CPU and GPU get
  tiled mat-vec readers. Step 1 running: CPU NEON tiled mat-vec vs repack 4x8 vs raw (Coder deepseek afef390d,
  `spike/onecopy-cpu-gemv`).
- 2026-10-04 one copy for three legs, S23 (`onecopy-three-legs/REPORT.md`, unplugged, 28 C): CPU mat-vec on the NPU
  tiled layout is bit-identical to repack 4x8 and runs at 0.71-0.73 of it pinned to cpu3 (0.80-0.87 on cpu3-7; raw
  0.53-0.71); gap = 96 zips/tile (M1 ablation). GPU tiled v1 correct on the real dma-buf but 0.41-0.52 of the engine
  SoA path (uncoalesced lane mapping); v2 (32 lanes per contiguous tile) running, GLM ad6bb146. Audit luna e13768da:
  3 must-fix fixed before timing. Side finding: the shipped Adreno Q4_0 decode fails fp16-denormal scales.
