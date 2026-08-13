# S23 idle ideas — typeahead + 2B phase ceiling

Date: 2026-08-13 (EDT, phone clocks `-0400`)
Device: Galaxy S23 only (`u0_a344@192.168.1.152:8022`). Xiaomi / Jelly not used.
Workspace on phone: `~/gdn_k2/idle_ideas/`
Host artifacts: `results/s23_idle_ideas/`
Audits (source of truth for interpretation): `results/s23_idle_ideas/audit_numbers.md`, `audit_scripts.md`
Raw authority: `typeahead/session.stdout.log` `BMOE_DONE` / `done_lines.jsonl`; `phase2b/cells/*/stderr.txt` `slot print_timing`. CSVs are copies.

**K4 35B GPU-prefill stays CLOSED** (`reports/moe-k4-split.md:311-326`). This campaign did **not** run 35B `-ngl 99` and must not be used to reopen it.

| Idea | Verdict |
|---|---|
| Typeahead (35B KEXP, current `--session` generate) | **DEAD** |
| 2B GPU-PP + CPU-TG phase ceiling as a measured turn | **DEAD** |

---

## 1. Device snapshot

Campaign device throughout this repo: Galaxy S23 (SM-S911U, Snapdragon 8 Gen 2 / Adreno 740, 8 GB). This run did not re-probe `getprop`. Snapshot below is **from this run's logs**, not a later SSH.

| | Typeahead (35B) | Phase2b (2B) |
|---|---|---|
| Window | 12:38:20 → 12:56:16 | 13:06:37 → 13:19:59 |
| `STATUS.txt` | `TYPEAHEAD_DONE` | `PHASE2B_DONE` |
| Model | `Qwen3.6-35B-A3B-KEXP.gguf` 13416430592 B = 12.4950246811 GiB | `Qwen3.5-2B-Q4_K_M.gguf` 1280835840 B = 1.1928713322 GiB sha `aaf42c8b…914699223` |
| Binary | `bmoe-cli.CAMPAIGN` sha `1ca51420476d4a979552448f1c0b5bc48a04ed2e43643543ce43fa7566bb022f` | `bin_fix2/llama-cli` sha `0b6be132c2476f6d0848631ecff703ad6400337c612972c2ad43da2a5a8fd8da` |
| Offload | none (CPU stream, `--cache-mb 2000`) | ngl 0 or 99, `-fa` off |
| Flags (35B) | `-t 4 -c 4096 --ubatch 512 --moe-stream --cache-mb 2000 --dense-weights anon --overlap --io-threads 4 --n-expert-used 6 --drop-cold-experts 0.65 --session --no-think --temp 0` · **no `--chatml`** · `N_PREDICT=0` | `--no-warmup`, new process per cell, KV not shared |
| READY / load | `BMOE_READY` `load_s=20.635` `arch=qwen35moe` `n_ctx=4096` `n_expert_used=6` | n/a (llama-cli cold load inside each `wall_s`) |
| Preflight | UNPLUGGED batt **86** temp **25.6** MemFree **2555428** kB MemAvail **4148904** kB | UNPLUGGED batt **82** temp **27.4** MemFree **1413968** kB |
| End | UNPLUGGED batt **83** temp **30.4** MemFree **135356** kB MemAvail **703476** kB | UNPLUGGED batt **81** temp **28.8** MemFree **2264612** kB |
| Watchdog plug | every sample UNPLUGGED except one `MISSING` during load (`watchdog.csv` ts `1786639136`) | 4 samples, all UNPLUGGED, then dead |
| Watchdog mem min | MemFree **58180** kB = 56.81640625 MiB · MemAvail **682364** kB = 666.37109375 MiB | one `mem_low_1` MemFree **215920** kB = 210.859375 MiB during CPU cell |
| After 35B load | `pre_step0_chunk0` MemFree **114348** kB = 111.66796875 MiB, MemAvail **2930948** kB | — |
| Floors actually executed | MemAvail 300000 kB + MemFree LMKD 50000 kB (`TYPEAHEAD.master.log:16`) | MemFree 300000 kB (`run_phase2b.sh`) |
| Mandate MemFree &lt; 300 MiB | **not honored** while 35B was resident (MemFree stayed under 300 MiB the whole loaded window). Run is valid under the script it executed. | CPU cell would have died if the 215920 kB dip had lasted 4 samples |
| Phone reboot | none in these logs | none |
| PC jobs / other phones | not touched | not touched |

All 15 `typeahead/batt/*.json` and all 10 `phase2b/batt/*.json` have `"plugged": "UNPLUGGED"`. Master-log pre/post snapshots match. Phase2b watchdog does **not** cover GPU / handoff (last sample 13:09:42; GPU starts 13:11:50) — coverage hole, not a plugged row. Typeahead watchdog max temp **30.6** °C. No speed row while charging. No cell at batt &lt; 45 % or temp &gt; 45 °C.

---

## 2. Typeahead

Harness: one persistent `bmoe-cli --session` process. Prefixes on disk are real (`P0 ⊂ P1 ⊂ … ⊂ P5`; step 6 = P5 with `clear_kv=true`; step5/step6 sha both `304c90ac…`). GROW2's own text: if `n_prompt` jumps to the full document, the typeahead win is gone.

Engine contract (`session.cpp`): KV prefix match runs **only if `chat_on`**. `--session` does not set `--chatml`. `n_common` stays 0. `n_prompt` is tokens prefilled **this turn**. Observed: `n_prompt == n_past` on **7/7** steps.

`n_predict=0` (`cmdline.txt`). `tokens=0`, `tok_s=0` every row. There is no generated first token. TTFT from this campaign is a category error. `load_s=20.635` is the one-time READY mmap, stamped on every DONE, **outside** every `wall_s`.

Raw `BMOE_DONE` (`typeahead/done_lines.jsonl` = `session.stdout.log`). `prefill_tps_re = n_prompt / prefill_s` recomputed here; matches BMOE `prefill_tps` at 2 dp.

| step | label | clear_kv | bytes | n_prompt | n_past | prefill_s | prefill_tps_re | BMOE t/s | wall_s | tokens |
|---:|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 0 | chunk0 | true | 360 | 74 | 74 | 17.314 | **4.2739979208** | 4.27 | 59.626 | 0 |
| 1 | grow1 | false | 817 | 171 | 171 | 23.445 | **7.2936660269** | 7.29 | 79.705 | 0 |
| 2 | grow2 | false | 1294 | 270 | 270 | 31.562 | **8.5545909638** | 8.55 | 88.814 | 0 |
| 3 | grow3 | false | 1720 | 353 | 353 | 43.977 | **8.0269231644** | 8.03 | 131.073 | 0 |
| 4 | grow4 | false | 2146 | 437 | 437 | 53.336 | **8.1933403330** | 8.19 | 174.565 | 0 |
| 5 | grow5 | false | 2580 | 527 | 527 | 67.394 | **7.8196872125** | 7.82 | 205.506 | 0 |
| 6 | control | true | 2580 | 527 | 527 | 63.648 | **8.2799145299** | 8.28 | 221.292 | 0 |

If reuse had worked, `n_prompt` would be the delta and `n_past` the full length.

| grow | delta vs previous | observed n_prompt | observed / delta |
|---|---:|---:|---:|
| grow1 | 97 | 171 | 1.7628865979 |
| grow2 | 99 | 270 | 2.7272727273 |
| grow3 | 83 | 353 | 4.2530120482 |
| grow4 | 84 | 437 | 5.2023809524 |
| grow5 | 90 | 527 | 5.8555555556 |

Sum of new tokens grow1..grow5 = **453**. Sum of `prefill_s` grow1..grow5 = **219.714 s**. Control full prefill of the same 527 tokens = **63.648 s**. They paid **219.714 / 63.648 = 3.4517×** the one-shot cost to "incrementally" type the last 453 tokens.

Honest control (same 2580 bytes, same 527 tokens):

| | grow5 (`clear_kv=false`) | control (`clear_kv=true`) | grow5 / control |
|---|---:|---:|---:|
| prefill_s | 67.394 | 63.648 | **1.0588549522** |
| n_prompt | 527 | 527 | **1.0000000000** |
| wall_s | 205.506 | 221.292 | 0.9286643891 |

On the quantity the engine defines as work this turn (`prefill_s`, `n_prompt`), the "incremental" step is **5.885 % slower** than blowing the KV (+3.746 s). The 0.929× wall ratio is **not** a typeahead win: both steps prefilled all 527 tokens. `wall_s` is 2.81×–3.48× `prefill_s` on every step (chunk0: 59.626 / 17.314 = 3.4438) — unexplained session / I/O tax, not skipped prefix tokens.

Fake "faster" ratios that are not typeahead: grow5 vs chunk0 `prefill_tps_re` = 7.8196872125 / 4.2739979208 = **1.8295954648**. That is cold-start amortization on a 7.1216216216× longer prompt (527 / 74), not KV reuse. Steps 2–6 sit at ~8 t/s full re-prefill. Cache hit stays 0.0–0.3 %.

Adding `--chatml` would not salvage this protocol: chat-append sends the whole `Pn` as a **new user turn**, not "replace the typed prefix and prefill the delta". Product typeahead needs a raw prompt-replace / prefill path that is not in this binary's session generate.

### Verdict: **DEAD**

Not LIVE (7/7 full re-prefill; grow5/control prefill **1.05885**). Not BLOCKED (run completed, control present, GROW2's own criterion fired). Dead as a product idea on the current `--session` generate path. A dedicated replace API is a different idea and was not measured.

Do not cite grow5 wall 0.93×, grow5 t/s 1.83× vs chunk0, or any `tok_s` (all zero) as a typeahead win.

---

## 3. 2B phase ceiling

Model: `Qwen3.5-2B-Q4_K_M.gguf` only. Prompt file 2352 bytes, labeled "512" tokens. Every `print_timing` counts **490** prompt tokens (490 / 512 = 0.95703125). Throughput is fine; the "512-pp" name is not.

Each cell is a **new** `llama-cli` process. `--no-warmup`. KV is not shared. Master log says so in English (`PHASE2B.master.log:24`). Probe accepted exit 0 with **no `OpenCL` / `Adreno` / `offloaded` string** (`PHASE2B.master.log:10`). ngl=99 attribution is circumstantial (PP 2.6005× vs CPU, TG 0.6466× vs CPU, 6–8× longer load). Write "ngl=99 cell", not "OpenCL confirmed".

`cells.csv` / `summary.csv` columns `pp_t_s` / `tg_t_s` are **seconds**, not tokens/s. Tokens/s below are recomputed from `print_timing` ms.

Raw `slot print_timing`:

| cell | ngl | n_predict | n_gen | prompt eval | eval |
|---|---:|---:|---:|---|---|
| CPU_512_128 | 0 | 128 | 128 | 12561.82 ms / 490 tok (39.01 t/s) | 15748.01 ms / 128 tok (8.13 t/s) |
| GPU_512_128 | 99 | 128 | 128 | 4830.56 ms / 490 tok (101.44 t/s) | 24353.32 ms / 128 tok (5.26 t/s) |
| HANDOFF_GPU_PP | 99 | 1 | 1 | 4741.57 ms / 490 tok (103.34 t/s) | **0.00 ms / 1 tok (1000000.00 t/s)** |
| HANDOFF_CPU_TG | 0 | 128 | 128 | 12109.09 ms / 490 tok (40.47 t/s) | 19165.56 ms / 128 tok (6.68 t/s) |

HANDOFF_GPU_PP `n=1`: first token is inside prompt eval; `stop processing: n_tokens = 490`; sequence never grew. Banner `Generation: 1000000.0 t/s` is llama.cpp zero-time fold. **Not a TG number.** Same pattern on the 15-token probe (1011.95 ms / 15 = 14.8238 t/s PP, eval 0.00 ms / 1).

Recomputed (ms → s and t/s):

| cell | pp_s | tg_s | pp t/s | tg t/s | decode ms/tok | wall_s | wall − compute |
|---|---:|---:|---:|---:|---:|---:|---:|
| CPU_512_128 | **12.561820** | **15.748010** | **39.0070865527** | **8.1280110947** | 123.031 | 110.215 | 81.905170 |
| GPU_512_128 | **4.830560** | **24.353320** | **101.4375144911** | **5.2559568880** | 190.260 | 216.159 | 186.975120 |
| HANDOFF_GPU_PP | **4.741570** | **0.000000** | **103.3412983463** | undefined | 0.000 | 114.460 | 109.718430 |
| HANDOFF_CPU_TG | **12.109090** | **19.165560** | **40.4654685034** | **6.6786464888** | 149.731 | 130.710 | 99.435350 |

MODEL rows in `summary.csv` (script arithmetic, not extra runs):

| row | formula | user_turn_s | notes |
|---|---|---:|---|
| MODEL_CPU | CPU pp + CPU tg | **28.309830** | measured single process |
| MODEL_GPU | GPU pp + GPU tg | **29.183880** | measured single process; **slower than CPU** |
| MODEL_GPU_PP_CPU_TG | GPU_512_128 pp + CPU_512_128 tg | **20.578570** | **composed ceiling — never a single turn** |
| HANDOFF_PAIR | wall_GPU_PP + wall_CPU_TG | walls **245.170** | two loads; KV not shared |

`MODEL_GPU_PP_CPU_TG` does **not** add GPU_TG (24.353320). Adding it would be 44.931890 s. The crime is omission, not that sum.

Cell `ms_per` = decode-only `ev_ms / n_gen` (CPU 123.031). MODEL `ms_per` = `(pp+tg)*1000 / 128` (CPU 221.171, composed 160.770). Same column name, different quantity. 160.770 vs 123.031 is not a decode win.

Ratios. `U_cpu = 28.309830`, `U_gpu = 29.183880`, `U_comp = 20.578570`.

| ratio | value | meaning |
|---|---:|---|
| U_comp / U_cpu | **0.7269054600** | arithmetic ceiling vs CPU-only |
| U_comp / U_gpu | **0.7051348210** | arithmetic ceiling vs GPU-only |
| U_gpu / U_cpu | **1.0308744348** | GPU-only user turn is slower than CPU-only |
| GPU_pp / CPU_pp | **0.3845430041** (CPU/GPU = 2.6004893843) | PP looks GPU-like |
| GPU_tg / CPU_tg | **1.5464379309** (CPU/GPU = 0.6466473565) | TG looks GPU-like (worse) |

Measured two-process "handoff" (the only attempt): CPU leg **re-prefills all 490 tokens** (12109.09 ms). Paid compute all three legs:

`4.741570 + 12.109090 + 19.165560 = 36.016220 s`

| ratio | value |
|---|---:|
| paid3 / U_cpu | **1.2722160465** (LOSS vs CPU-only) |
| paid3 / U_gpu | **1.2341134900** (LOSS vs GPU-only) |
| paid3 / U_comp | **1.7501808921** (ceiling missed by 75 %) |
| HANDOFF_PAIR walls / U_cpu | 245.170 / 28.309830 = **8.6602427496** |
| HCPU tg / CPU tg | 19.165560 / 15.748010 = **1.2170147212** |
| HCPU pp / CPU pp | 12.109090 / 12.561820 = **0.9639598402** |
| HGPU pp / GPU pp | 4.741570 / 4.830560 = **0.9815777053** |

Naive `HANDOFF_PAIR` pp+tg (4.741570 + 19.165560 = 23.907130) **hides the 12.109090 s CPU re-prefill**. Still worse than the composed 20.578570, and still not a shared-KV handoff.

### Verdict: **DEAD**

Not LIVE (composed 0.73× was never a turn; measured paid3 is **1.2722× vs CPU**; GPU-only user turn is **1.0309× vs CPU**). Not BLOCKED (four cells `rc=0`, timings parse). Dead as a product claim for two-process GPU-PP → CPU-TG. A real shared-KV handoff is engine work that this llama-cli pair cannot do; do not schedule another S23 cell of the same shape.

Do not cite `Generation: 1000000.0 t/s`, `MODEL_GPU_PP_CPU_TG` as an achieved handoff, HANDOFF_PAIR pp+tg without the 12.109 s re-prefill, or any phase2b t/s as 35B.

---

## 4. What this does NOT say about 35B decode

- Typeahead is 35B KEXP CPU-stream prefill only. `n_predict=0`, `tokens=0` on every step. **No 35B decode number exists in this directory.**
- Typeahead ~8 t/s is **full re-prefill** of 270–527 tokens, not incremental typeahead and not decode.
- Phase2b is a **different GGUF** (1.193 GiB vs 12.495 GiB, size ratio **10.4747463906**). 101.44 t/s / 103.34 t/s PP and 5.26 t/s TG are **2B** ngl=99. Citing them as 35B is fraud.
- Phase2b never loaded KEXP. Typeahead never passed `-ngl`.
- K4 already closed 35B GPU-prefill on this phone (`moe-k4-split.md:311-326`): decode median **2.901 → 2.025 t/s (0.698×)**, TTFT **17.8 → 30.4 s (0.59× worse)**, prefill **~parity** (9.0–10.0 vs 8.4–9.6 t/s). Gate FAIL. Speed lane on A7X CLOSED.
- These logs do not replace K4, must not be averaged with it, and are not a reason to rerun 35B `-ngl 99`.
- 2B ngl=99 PP being ~2.6× CPU PP does **not** transfer to streamed 35B MoE prefill (K4 already measured that: expert GEMM stays on CPU). 2B ngl=99 TG being *worse* than CPU TG is the opposite of a 35B decode argument.
- `TTFT ~= load + prefill` folded into a token that does not exist (typeahead) or into `n=1` 2B prompt-eval (HANDOFF_GPU_PP wall 114.460 s vs pp 4.741570 s) is not a 35B TTFT.

---

## 5. Next action

1. **Park typeahead.** Do not rerun the same `--session` generate of growing full prefixes. A reopen requires a raw prompt-replace / prefill-delta API, `n_common` / first-divergence logged, and acceptance `n_prompt ≈ tokens(GROWn)`. That is engine work, not another unplugged cell.
2. **Park 2B GPU-PP → CPU-TG.** Do not rerun two-process llama-cli "handoff". A reopen requires one process (or a proven KV export/import) so the CPU leg does not re-prefill 490 tokens. The composed 20.578570 s stays arithmetic until that exists.
3. **Do not rerun 35B `-ngl 99`.** K4 closed it. Nothing here reopens it.
4. Do not update `PLAN.md`. No git push. No GGUFs. No further S23 speed/thermal cells for these two ideas.

DONE
