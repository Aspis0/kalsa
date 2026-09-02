# REPORT — cell #47 (job 796297), PPL HTP-vs-CPU on v79 WITH the execute-op witness

Writer: Claude Fable (drove and verified the cell under the owner's 1/09 direct-work
window). Hostile audit pending from a different model. Numbers only; every claim quoted
from `raw/`.

## Session

- Job **796297** `npu-v79-ppl-v-47`, QRD8750 / Snapdragon 8 Elite / Android 16, serial
  `b4bd0901` (`raw/serial.txt:1`; `raw/provenance.txt`). Submitted 10:03:08 PM, Running
  10:04:24 PM, Ended 10:15:34 PM (page clock, `raw/running.txt:1`); driver T0
  `2026-09-02T02:07:02Z`, `DONE elapsed=466` (`raw/done.txt:1`). Cap 25 min set at
  creation; ~11 min billed.
- Kit `npu-kit-93e9592fa.tgz`, SHA256SUMS verified on device, OK count = manifest lines
  (`raw/kit_verify.txt`). Backend `HTP0`, `Hexagon Arch version v79` (`raw/list_devices.txt`).
- Device shas match host for all three files (`raw/sha_ship.gguf.txt`, `raw/sha_olmoe.gguf.txt`,
  `raw/sha_wiki.test.raw.txt`): ship `a247afd6…`, OLMoE `9d0b90c6…`, corpus `173c87a5…`.

## Arms (both HTP, `-v`, filtered on-device)

Flags `-c 2048 -b 2048 -ub 1024 -fa on --chunks 32 -t 8 -v`, `GGML_HEXAGON_VERBOSE=1`.

| model | PPL_HTP(#47) | PPL_CPU(#46, reused) | r | execute-op proof | EXIT |
|---|---|---|---|---|---|
| ship 2.6B QAD-Q4_0 | **40.2720** ± 0.87472 | 40.2837 ± 0.87513 | **−0.029 %** | 10648 `MUL_MAT` | 0 |
| OLMoE all-Q4_0 | **9.0620** ± 0.13192 | 9.0562 ± 0.13172 | **+0.064 %** | 3024 `MUL_MAT_ID` | 0 |

Sources: `raw/ppl_summary.txt:1-6`; final lines `raw/ppl_ship_htp.dev.txt` /
`raw/ppl_olmoe_htp.dev.txt`; CPU denominators verbatim from
`../qdc-8elite-npu-v79-judge/raw/ppl_ship_cpu.txt` (40.2837) and
`raw/ppl_olmoe_cpu.txt` (9.0562), both EXIT=0 in #46.

**r ship = 40.2720/40.2837 − 1 = −0.029 % → PASS (≤ 2 %). r OLMoE = 9.0620/9.0562 − 1
= +0.064 % → PASS.**

## Execute-op proof (the whole point of #47)

- Ship: **10648** `HTP0 execute-op MUL_MAT` lines; the model is dense/hybrid — the first
  ops are `blk.0.shortconv.in_proj.weight`, `blk.0.shortconv.out_proj.weight`
  (`raw/ppl_ship_htp.dev.txt`, sampled). No `MUL_MAT_ID` (0), correct for a non-MoE model.
- OLMoE: **3024** `HTP0 execute-op MUL_MAT_ID` lines, split exactly **1008 / 1008 / 1008**
  across `ffn_gate_exps` / `ffn_up_exps` / `ffn_down_exps` (`grep 'execute-op MUL_MAT_ID'
  | grep -o 'ffn_[a-z]*_exps' | sort | uniq -c`). The experts ran on HTP0. 3024 equals
  q55's certified v75 expert count exactly (`../q55-v75-npu-correctness/REPORT.md`,
  `expert_mul_mat_id: 3024`) — same graph, same dispatch, now on v79.
- Both arms therefore satisfy the prereg's execute-op requirement → certification is not
  METHOD-VOID (unlike #46). Ship additionally shows 0 `MUL_MAT_ID`; OLMoE shows 5136
  dense `MUL_MAT` alongside its 3024 expert `MUL_MAT_ID`.

## Cross-check (`-v` did not change the numerics)

PPL_HTP(#47) = PPL_HTP(#46) to the printed precision for both models: ship
40.2720 = 40.2720, OLMoE 9.0620 = 9.0620 (#46 `../qdc-8elite-npu-v79-judge/raw/ppl_ship_htp.txt`
/ `ppl_olmoe_htp.txt`). The per-chunk `[32]` running estimate equals the Final estimate
in both (`[32]40.2720`, `[32]9.0620`) → 32-chunk closure condition met, no n < 32
deviation. The verbose flag added logging only.

## Thermal / method

Gates before each arm from the live HAL group; both HTP arms passed pre-gates (ship 41.0
°C, OLMoE 42.8 °C, status 0). Post-arm snapshots are `GATE_FAIL` by the 60 °C threshold
(ship 68.3 °C, OLMoE 60.2 °C, status 0) — an in-run prefill excursion, the #43/#46 CPU/HTP
pattern; the prereg gate is pre-invocation only, both runs completed EXIT=0, no validity
impact (disclosed per the #47 audit MINOR). Filtered logs are 282 773 / 219 143 lines (a few MB) —
the on-device `grep -E` (no GNU `--line-buffered`, toybox-safe) kept every witness and
discarded the multi-GB raw, so device storage stayed clear after the 5.5 GB of models.
No crash signatures. `EXIT=` is the binding rc (both 0).

## Verdict

- Ship = **PASS** (certified: r −0.029 %, proof present, cross-check identical).
- OLMoE = **PASS** (certified: r +0.064 %, 3024 expert MUL_MAT_ID on HTP, cross-check identical).
- Combined with #46 (judge repaired raw-confirmed; MUL_MAT_ID 301/301 patched-correct):
  **Session 1 D CLOSES on correctness.** The v79 NPU forward pass is numerically correct
  vs CPU on the ship model and on the experts-on-NPU lane, on the campaign's wikitext
  corpus at 32 chunks, prefill. The #46 ops defect list (36 DSP INTERNAL-ERROR + 1 numeric
  NaN on q4_0 m=2880) stays open as its own hardening item; it does not block the
  certification (those shapes are not exercised by these two models' forward pass — the
  proof lines show the models use m∈{shortconv, expert} shapes that ran clean).

## What this cell cannot say

Nothing about decode/tg correctness (PPL is prefill-only); nothing about other context
lengths or batch geometries; nothing about v73/v75; nothing about KEXP (Q2/Q3_K) experts;
nothing about speed (t/s not measured here); no governor/app claim.
