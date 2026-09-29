# Xiaomi 14 (SM8650 / 8 Gen 3, Hexagon v75, Adreno 750) - CPU vs GPU vs NPU, 2026-09-29

First valid measurement on 8 Gen 3 and first NPU v75 run (QDC QRD8650 never produced a valid arm).
Owner's personal phone, lent for the night: CLI only, own `/data/local/tmp` dir removed after,
stay-on restored, app untouched. Device run by luna `55fa2667`; coordinator re-read the prompt-eval,
eval and tg256 lines and the v75 session line in the raw logs.

Kit: `/Users/marco/kalsa-qdc/f25-v75-kit` - one build of engine f25f0c1c5 (GLM `390ab7bf`), static
`llama-bench`/`llama-completion`, skels v73/v75/v79/v81 (qaic outputs transplanted from the same
commit's 2026-09-26 build; provenance file in the kit). v75 skel `215a2fbf...d6d5`. Model: ship
LFM2.5-2.6B Q4_0 (`a247afd6...0b03`). Unplugged, thermal status 0 throughout (544 samples), battery
>= 57 %, battery max 33.5 C, skin max 36.6 C.

| measure | Xiaomi 14 (new kit) | S23 (old shared-lib kit) |
|---|---|---|
| A prefill 1010 tok, CPU, ms (median of 2) | 7542.59 | 10389.45 |
| A prefill GPU/OpenCL, ms | 6855.27 | 7326.37 |
| A prefill NPU/HTP, ms | **1447.97** | 1558.10 |
| A decode 126 tok, CPU / GPU / NPU tok/s | 27.53 / 13.26 / 16.24 | 21.14 / 11.18 / 12.96 |
| B tg256 CPU / GPU / NPU, median of 3 | 29.21 / 15.49 / 23.33 | 22.13 / 14.03 / 22.09 |

Reading: on the 8 Gen 3 the NPU prefills 5.2x faster than CPU and 4.7x faster than OpenCL; decode
is fastest on CPU (29 tok/s), NPU second (23), OpenCL last. Same picture as the S23, with a stronger
CPU. The CPU frequency cap dropped during B (P2/P5 2.63 -> 2.32 GHz, P7 2.17 -> 1.94 GHz) while
Android thermal status stayed 0 - the known Xiaomi trap; B's later arms ran capped.

## Same-kit S23 control (luna `de2374d8`, 2026-09-29, unplugged; lines re-read by the coordinator)

| measure | Xiaomi 14 | S23, same kit | S23, old kit |
|---|---|---|---|
| A prefill CPU ms | 7542.59 | 10640.55 warm (19710.51 cold 1st) | 10389.45 |
| A prefill GPU ms | 6855.27 | 7318.33 | 7326.37 |
| A prefill NPU ms | 1447.97 | 1550.71 | 1558.10 |
| A decode CPU / GPU / NPU tok/s | 27.53 / 13.26 / 16.24 | 20.66 / 12.62 / 15.10 | 21.14 / 11.18 / 12.96 |
| B tg256 CPU / GPU / NPU | 29.21 / 15.49 / 23.33 | 14.89 (10.95-21.28) / 13.41 / 22.12 | 22.13 / 14.03 / 22.09 |

The kit is not a confound: on the S23 the new kit reproduces the old one on GPU and NPU. The S23
CPU decode in B is throttled (battery up to 38.8 C, thermal status 1; reps 14.89 / 10.95 / 21.28),
so the S23 B-CPU column is heat, not engine. Same-kit Xiaomi vs S23: CPU prefill 1.41x faster,
GPU and NPU prefill only ~1.07x faster; the NPU v73 and v75 are close on this model.

Caveat: kits differ (static new kit vs the S23's shared-lib kit). `--list-devices` does not list CPU on
this build; the CPU route was proven with `-dev none -ngl 0`. Raw summaries in `raw/`; full logs in
`/tmp/xiaomi-3way/` (not in the lab).
