# Cell #70 — l4_y8 A/B on QDC Snapdragon 8 Gen 3 (QRD8650, correctness)

Plugged QDC device: correctness only. Evidence: `raw/session1-y8-ab-09a496d71.grep` (recon, kit sha check, legs report).

## Setup

- QDC session 877503 (job tag sa881572), device 80003b9c, SM8650, Adreno 750, OpenCL compiler E031.45.02.06.
  Session started in the portal by Haiku `eead0be2`; `connect.sh` was run by the coordinator (the delegate's auto-mode
  classifier refused it); tunnel on 6037 killed by the coordinator after DONE.
- Kit `~/kalsa-qdc/y8-kit-09a496d71.tgz`: the cell #67 binaries (governor-bench f72b761b, engine 09a496d71, skel
  v75 f88a9b96) + this cell's `run-legs.sh`; `sha256sum -c` OK on the device.
- Question: cell #67 localised the one-copy GPU leg's defect to `kqv-2`, routed to `kernel_mul_mat_f16_f32_l4_y8`.
  `GGML_OPENCL_MM_F16_FORCE_L4=1` sends that op to `kernel_mul_mat_f16_f32_l4_dr` in the same binary.

## Result

| arm | config | exit | KL mean | KL max | status |
|---|---|---|---|---|---|
| G | two-copy reference logits | 0 | - | - | - |
| L-gpu | gpu leg, baseline | 1 | 0.040665 | 0.699636 | FAIL |
| L-gpu2 | gpu leg, baseline | 1 | 0.120420 (24 compared, argmax diverged) | 0.681382 | FAIL |
| L-l4a | gpu leg, FORCE_L4=1 | 0 | 0.000010 | 0.000431 | PASS |
| L-l4b | gpu leg, FORCE_L4=1 | 0 | 0.000010 | 0.000431 | PASS |
| L-l4c | gpu leg, FORCE_L4=1 | 0 | 0.000010 | 0.000431 | PASS |

No WATCHDOG, ABORT or error lines; battery 25.0 C throughout.

## Reading

**`kernel_mul_mat_f16_f32_l4_y8` is the GPU-750 defect.** With it the leg is wrong and different run to run; routed to
`l4_dr` it is right and bit-identical across three runs (same KL to six digits), at the 8 Elite's level (0.000010 in
cell #66). Fix: keep Adreno A7X off `l4_y8` in the decode f16 chain (engine change in progress), then re-run this cell
without the env flag on the fixed bench.
