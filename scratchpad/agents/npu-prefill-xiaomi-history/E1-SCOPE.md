# E1 — Has an SM8650 / v75 HTP *prefill* measurement ever been made on the Xiaomi 14?

**Verdict: `SM8650/V75 NPU-PREFILL MEASUREMENT EXISTS`**

Marco is right. Not only does it exist on the retail phone, it exists in three independent
forms: a CLI 3-way cell, two `llama-bench pp512` cells, and an **in-app** session. The
coordinator's premise #1 (only SM8550/V73 has NPU prefill data) is **falsified**.

## Candidates

| # | Cell / file | Device | HTP arch | Phase | Number | Citation | Verdict |
|---|---|---|---|---|---|---|---|
| 1 | `xiaomi14-3way` | **Xiaomi 14 (real phone)** | v75 | **pp** (1010 tok) | **1447.97 ms** NPU vs 7542.59 CPU / 6855.27 GPU → 5.2× | `xiaomi14-3way/REPORT.md:18`, `:16`, `:17`, `:22` | **CONFIRMED** (test-only, CLI) |
| 2 | same cell, raw arm `A-npu-1/2` | Xiaomi 14 | v75 | pp | 1467.37 / 1428.57 ms prompt eval; 15.84 / 16.64 tok/s decode | `xiaomi14-3way/raw/REPORT_FOR_COORDINATOR.md:19-20` | CONFIRMED |
| 3 | same cell, HTP proof | Xiaomi 14 | v75 | — | `libggml-htp-v75.so` opened, HTP0 model buffer 1525.87 MiB | `xiaomi14-3way/raw/REPORT_FOR_COORDINATOR.md:9` | CONFIRMED (dispatch proof) |
| 4 | `q55-v75-npu-correctness` Part B | **Xiaomi houji** | v75 | **pp512** | NPU **581.412** / **804.845** tok/s vs CPU 52.618 / 53.106 | `q55-v75-npu-correctness/REPORT.md:10-13` | **CONFIRMED** (test-only) |
| 5 | `q67-c1-htp-v75-load` arm B | Xiaomi (v75) | v75 | **pp512** | NPU **199.685** / **201.719** tok/s vs CPU 43.805 / 45.020 | `q67-c1-htp-v75-load/REPORT.md:80-83` | **CONFIRMED** (test-only) |
| 6 | `xiaomi-g2-inapp-233486dd` | **Xiaomi 14, IN-APP** | v75 | **pp** (prefill route) | `engine_prefill NPU`, `npu_device HTP0`, 14 turns | `xiaomi-g2-inapp-233486dd/REPORT.md:3`, `:26`; `raw/governor-pacing.csv` col2 | **CONFIRMED (in-app)**, route proof only |
| 7 | `qdc-governor-on-off-1d51f196` | **QRD8650 board** (SM8650) | v75 | **pp** | ON 884.6 / 858.7 tok/s vs OFF 70.3 CPU = 12.6× | `archived/PLAN-2026-10-09-full.md:953-954` | CONFIRMED (same SoC, **not the phone**) |
| 8 | `s23-heat-arms-engine` | Galaxy S23 SM8550 | v73 | pp | P-NPU 653.98 tok/s | `s23-heat-arms-engine/REPORT.md:87` | CONFIRMED but **wrong SoC** |
| 9 | `qdc-8g3-govbench-55` / `-rerun-58` | QRD8650 | — | pp512 | 284.2 / 291.1 tok/s — **GPUOpenCL, not NPU** | `archived/ALIVE-2026-09-full.md:475`, `:478` | **REFUTED** |
| 10 | `qdc-oracle-onoff-41dc728f` | SM8850 / QRD8750 | v81 / v79 | pp | 1337 vs 216, 1159 vs 212 | `PLAN.md:327-329` | **REFUTED** (different SoC) |
| 11 | `xiaomi14-3way` arm B | Xiaomi 14 | v75 | **tg256 only** (`-p 0`) | NPU 23.33 tok/s | `xiaomi14-3way/REPORT.md:19`, `raw/commands.tsv:14-16` | PARTIAL — decode only |
| 12 | `xiaomi-endur-npu-gpu-75`, `xiaomi-legheat-76` | Xiaomi 14 | v75 | **tg only** | NPU 17.46→13.98; 16.52 tok/s | `xiaomi-endur-npu-gpu-75/REPORT.md:1`, `:28`; `xiaomi-legheat-76/REPORT.md:27-30` | PARTIAL — decode only |
| 13 | `q30-htp-smoke-xiaomi` | Xiaomi 14 | v75 | none | session opens; 486 MUL_MAT OK — no prefill | `q30-htp-smoke-xiaomi/REPORT.md` "Verdict" | REFUTED (smoke) |

## The closest thing that does exist (not needed — the answer is yes)

If one insists on a *same-kit* prefill comparison, the best is `xiaomi14-3way/REPORT.md:16-18`,
which gives CPU/GPU/NPU prefill ms on the phone in one session — a genuine 3-way. Its closest
non-Xiaomi sibling is the S23 same-kit control in the same file (`:31-33`), NPU 1550.71 ms.

## What I could not verify

- **A per-turn in-app prefill tok/s on the Xiaomi.** `xiaomi-g2-inapp-233486dd` proves the
  *route* (`engine_prefill NPU`) but `raw/governor-pacing.csv` has no prefill-token or
  prefill-ms column (only `engine_prefill`, `engine_decode`, decode token counts). If it exists
  it would be in `xiaomi-g2-inapp-233486dd/raw/` (`KALSA_GOVERNOR` lines / `telemetry-speed.csv`).
- **Whether the in-app NPU prefill ran KV on device.** `-nkvo` (KV-on-host) was used in the CLI
  cells (`xiaomi14-3way/raw/commands.tsv:6`); the in-app cell's KV type is not stated in the report.
- **Whether any prefill number exists after 2026-10-11 on the Xiaomi.** The newest Xiaomi cell,
  `xiaomi-stage0-obs-aa789620` (2026-10-15), is a learning-governor observation run; I found no
  pp number in its head section.
- `/tmp/xiaomi-3way/` full on-device logs are **not in the lab** (only `raw/` summaries) —
  `xiaomi14-3way/REPORT.md` last line.

## What falsifies the coordinator's belief (asked for explicitly)

Three ways, all cited above:

1. `xiaomi14-3way/REPORT.md:18` — prefill on HTP0/v75 **on the Xiaomi phone itself**, 5.2× CPU.
2. `xiaomi-g2-inapp-233486dd/REPORT.md:26` — the NPU prefill lane ran **in the app** on the
   Xiaomi on 2026-10-11, after the September design note said it was unwired.
3. `archived/PLAN-2026-10-09-full.md:953` — QRD8650 (**same SoC as the Xiaomi**) already had
   in-app NPU prefill at 884.6 tok/s on 2026-10-03.

Premise #2 (`npu_lane_enabled: false`, "not wired in September") is correct as of 2026-09-28 and
is not contradicted here — but it does not imply "never measured", exactly as the coordinator
suspected. The design note predates the first valid v75 NPU run by **one day**:
`xiaomi14-3way/REPORT.md:3` dates that run 2026-09-29 and calls it the "first NPU v75 run".

Note a benign coincidence: the S23 P-NPU figure and the Xiaomi CLI cell both land near 1.47 s
(`s23-heat-arms-engine/REPORT.md:87` vs `xiaomi14-3way/REPORT.md:18`) on the *same* model
(LFM2.5-2.6B Q4_0, sha `a247afd6`), which is consistent with v73 and v75 being close
(`xiaomi14-3way/REPORT.md:40`) — not a case of one device's log being read as the other's.