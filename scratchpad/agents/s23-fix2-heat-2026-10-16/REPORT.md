# S23 FIX 1 / FIX 2 device checks, 2026-10-16

Device: S23 (SM8550, v73), LFM2.5 2.6B, debug APKs from kalsa main, unplugged.

## FIX 1 (APK c2bffdef, binding 7d15f8fe, engine c8c128b03)
- 11:34, available 3003.65 MiB: plan `npu_price lane_only`, `gpu_leg false`, `npu_device HTP0` (device-lines.txt, fix1-launch).
- Turn: prompt_n 1159, prefill NPU 1828.926 ms, chunks 512+512+128+7 all `layers_device HTP0`; decode NPU 186 tokens at 12.247 tok/s; no OpenCL line (device-lines.txt, fix1-turn).

## FIX 2 rule (APK 9b3a556a, binding f385ebdd, engine 946daec00, prefill_thermal_handoff true)
- After `am kill-all`, available 4120.4 MiB: `npu_price with_gpu`, `gpu_leg true`; reader `cpu=18 npu=4 gpu=8 zones`.
- Cool turn: `KALSA_GOVERNOR_PREFILL_THERMAL {"npu_headroom_c":58.4,"gpu_headroom_c":58.2}`; engine_prefill NPU, 5 chunks HTP0, commit_bytes 0.
- NPU zones (nspss-0..3) passive trips 95/115/115/125 C; the reader uses the lowest, 95 C.

## Heat loop 13:21-13:39 (summary.txt, prefill-thermal.txt)
Battery 29.8 -> 39.3 C over ~18 min of long turns. NPU headroom at prefill start 54.8 -> 49.7 C; GPU within 0.4 C of the NPU on every sample after the first turn. Lowest sample 32.1 C (NPU ~63 C), read right after a prefill. Live reads during generation: nspss 73-78 C, gpuss 52-58 C at battery ~34 C.
Conclusion: with the guard at 5 C headroom the rule needs the NPU near 90 C; the battery 43 C stop comes first on this phone, and NPU and GPU sit within the 4 C hysteresis. The rule does not fire in normal S23 use. Owner (2026-10-16) accepted: keep it on as is, no forced test; battery heat is handled by slowing down (WARM/COOLMODE, decode pacing), not by moving to the GPU, which heats 3.7x more per prefill token (s23-heat-arms-engine).
Script defect: turns ran longer than the 75 s spacing, so every other send tap landed during generation; 8 samples of 14, no per-turn KALSA_GOVERNOR lines in the loop.
