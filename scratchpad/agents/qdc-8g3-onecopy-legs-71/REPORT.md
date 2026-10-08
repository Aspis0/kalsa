# Cell #71 — one-copy legs on QDC Snapdragon 8 Gen 3 (QRD8650) with the l4_y8 fix (correctness)

Plugged QDC device: correctness only, tok/s indicative. Evidence: `raw/session1-legs-e01a61cee.grep` (recon, kit sha
check, legs report).

## Setup

- QDC session 877544 (job tag sa881613), 4:00:52-4:14:05 PM EDT (13 min, ended in the portal, Completed), SM8650, Adreno 750, OpenCL compiler E031.45.02.06. Portal by Haiku
  `500c1369`; `connect.sh` run by the coordinator; tunnel on 6037 killed by the coordinator after DONE.
- Kit `~/kalsa-qdc/legs-kit-e01a61cee.tgz`: governor-bench 151be7f0 (engine e01a61cee = 09a496d71 + Adreno A7X decode
  KQV kept off `kernel_mul_mat_f16_f32_l4_y8`), skel v75 f88a9b96 (unchanged; the fix is OpenCL-only); `sha256sum -c`
  OK on the device. No env overrides (no FORCE_L4).
- Arms: the 8 Elite's cell #66 set. G = two-copy reference logits (256 tokens); L = one copy, legs hop every 32
  tokens (256); L-npu, L-gpu x3, L-cpu = each leg alone (128); A-gpu = plain OpenCL two-copy; A-j1 = HTP0 + GPU.

## Result

| arm | exit | KL mean | KL max | status | tok/s (indicative) |
|---|---|---|---|---|---|
| L (7 hops: cpu 96, gpu 64, npu 95 tokens) | 0 | 0.000017 | 0.000389 | PASS | cpu 15.0, gpu 23.1, npu 24.8 |
| L-npu | 0 | 0.000022 | 0.000434 | PASS | 24.4 |
| L-gpu | 0 | 0.000010 | 0.000431 | PASS | 23.4 |
| L-gpu2 | 0 | 0.000010 | 0.000431 | PASS | 23.3 |
| L-gpu3 | 0 | 0.000010 | 0.000431 | PASS | 23.4 |
| L-cpu | 0 | 0.000015 | 0.000366 | PASS | 14.8 |
| A-gpu | 0 | 0.000012 | 0.000510 | PASS | - |
| A-j1 | 0 | 0.000022 | 0.000434 | PASS | - |

No WATCHDOG, ABORT or error lines; battery 25.0 C throughout.

## Reading

**The SM8650 row is correct on every leg.** The GPU leg, wrong and nondeterministic before the fix (cells #67/#70, KL
0.04-0.18), now passes three times with the same KL to six digits. The fix costs no speed: cell #70's gpu leg ran
23.2-23.3 tok/s on l4_y8 and 23.4-23.5 on l4_dr. Still open for this SoC: the governor's measured gain, which
needs the real Xiaomi 14 (unplugged); QDC boards are always powered.
