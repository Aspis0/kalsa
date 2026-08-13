# Hostile numbers audit — typeahead + phase2b

Date: 2026-08-13. Device: S23. Source of truth: raw `BMOE_DONE` lines and llama-cli
`slot print_timing` lines on disk. CSV is a copy, not an authority.
Independent arithmetic recomputed below from those raw fields. No number in
this note is copied from a secondary write-up.

Sibling script audit: `results/s23_idle_ideas/audit_scripts.md`. This file is
the numbers pass.

## Headline

There is no typeahead win. There is no measured GPU-PP + CPU-TG handoff win.
The only "win" in `phase2b/summary.csv` is a composed ceiling that was never
a single turn and that the only attempted handoff missed by **1.750x**.

Typeahead is 35B KEXP, `n_predict=0`, tokens=0, full re-prefill every step.
Phase2b is 2B Q4_K_M, including an `n=1` cell whose "Generation: 1000000.0 t/s"
is a llama.cpp zero-time first token folded into prompt eval. Mixing those
two campaigns is a category error. K4 already closed 35B GPU-prefill; these
logs do not reopen it.

## Models and binaries (do not mix)

| Campaign | Model | Size on disk | Binary | ngl |
|---|---|---|---|---|
| typeahead | `Qwen3.6-35B-A3B-KEXP.gguf` | 13416430592 B = 12.4950246811 GiB | `bmoe-cli.CAMPAIGN` sha `1ca51420476d4a979552448f1c0b5bc48a04ed2e43643543ce43fa7566bb022f` | none (CPU stream, `--cache-mb 2000`) |
| phase2b | `Qwen3.5-2B-Q4_K_M.gguf` | 1280835840 B = 1.1928713322 GiB | `bin_fix2/llama-cli` sha `0b6be132c2476f6d0848631ecff703ad6400337c612972c2ad43da2a5a8fd8da` | 0 or 99 |

Size ratio 35B/2B file = **10.4747463906**. Phase2b PP ~101 t/s is not a 35B number.
Typeahead prefill ~8 t/s is not a 2B number. `HANDOFF_GPU_PP` `n=1` is 2B.

READY line (35B): `BMOE_READY {"load_s":20.635,"arch":"qwen35moe","n_ctx":4096,"think_ctl":"template","n_expert_used":6}`
(`typeahead/session.stdout.log:1`, `TYPEAHEAD.master.log:20`).

Phase2b model path in every cell `cmd.txt`: `/home/gdn_k2/models/Qwen3.5-2B-Q4_K_M.gguf`.

## Sources used

- `typeahead/session.stdout.log` BMOE_DONE id=1..7 (also `done_lines.jsonl`)
- `typeahead/TYPEAHEAD.master.log`, `steps.csv`, `summary.csv`, `cmdline.txt`
- `typeahead/batt/*.json` (15 files), `typeahead/watchdog.csv`
- `phase2b/cells/*/stderr.txt` `slot print_timing` lines
- `phase2b/cells.csv`, `summary.csv`, `PHASE2B.master.log`
- `phase2b/batt/*.json` (10 files), `phase2b/watchdog.csv` (4 samples then dead)
- Engine contract: `BigMoeOnEdge/core/include/bmoe/metrics.h:108-110`,
  `core/src/engine/session.cpp:1167-1173,1629-1630`

CSV fields that match the raw lines were re-derived, not trusted.

---

# 1. Typeahead — raw BMOE_DONE and recomputed ratios

Harness: one persistent `--session` process, `N_PREDICT=0`, `--no-think`,
**no `--chatml`** (`typeahead/cmdline.txt:5-6`). Growing prefixes P0 subset P1
... subset P5; step 6 = P5 with `clear_kv=true`. GROW2 text itself says the
win is gone if `n_prompt` jumps to the full document.

Engine contract (`metrics.h:108-110`):

> `n_prompt` is the tokens actually prefilled THIS turn (the suffix after the
> reused KV prefix), and `n_past` is the total context length after the turn.

`session.cpp:1629-1630`:

```
s.n_prompt = n_prompt - (int) n_common;
s.n_past   = chat_on ? kv_tokens.size() : n_prompt + n_gen;
```

KV prefix match runs **only if `chat_on`** (`session.cpp:1167-1173`).
`--session` does not set `--chatml` (`cli/main.cpp:656-657` vs `650-651`).
`cfg.chatml` stays false, `im.chat_on` stays false, `n_common` stays 0.
The run was structurally incapable of incremental prefill.

### Raw lines (session.stdout.log)

| id | label | clear_kv | prompt_bytes | prefill_s | n_prompt | n_past | prefill_tps (BMOE) | tokens | tok_s | load_s | cache_hit_pct | wall_s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | chunk0 | true | 360 | 17.314 | 74 | 74 | 4.27 | 0 | 0.000 | 20.635 | 0.0 | 59.626 |
| 2 | grow1 | false | 817 | 23.445 | 171 | 171 | 7.29 | 0 | 0.000 | 20.635 | 0.0 | 79.705 |
| 3 | grow2 | false | 1294 | 31.562 | 270 | 270 | 8.55 | 0 | 0.000 | 20.635 | 0.0 | 88.814 |
| 4 | grow3 | false | 1720 | 43.977 | 353 | 353 | 8.03 | 0 | 0.000 | 20.635 | 0.0 | 131.073 |
| 5 | grow4 | false | 2146 | 53.336 | 437 | 437 | 8.19 | 0 | 0.000 | 20.635 | 0.0 | 174.565 |
| 6 | grow5 | false | 2580 | 67.394 | 527 | 527 | 7.82 | 0 | 0.000 | 20.635 | 0.1 | 205.506 |
| 7 | control | true | 2580 | 63.648 | 527 | 527 | 8.28 | 0 | 0.000 | 20.635 | 0.3 | 221.292 |

`tokens=0` and `tok_s=0` on every row because `n_predict=0`. There is no
generated first token. TTFT from this campaign is a category error.

`load_s=20.635` is the session load from `BMOE_READY`, copied onto every
DONE. It is not per-step work. READY is `12:39:23`; step 0 starts `12:39:27`.
Load is **outside** every `wall_s`.

### Independent recomputation

`prefill_tps_re = n_prompt / prefill_s` (this is what BMOE stores as `n_prompt / prefill_seconds`):

| step | n_prompt/prefill_s | BMOE prefill_tps | match |
|---|---|---|---|
| 0 | 74/17.314 = **4.2739979208** | 4.27 | yes (2 dp) |
| 1 | 171/23.445 = **7.2936660269** | 7.29 | yes |
| 2 | 270/31.562 = **8.5545909638** | 8.55 | yes |
| 3 | 353/43.977 = **8.0269231644** | 8.03 | yes |
| 4 | 437/53.336 = **8.1933403330** | 8.19 | yes |
| 5 | 527/67.394 = **7.8196872125** | 7.82 | yes |
| 6 | 527/63.648 = **8.2799145299** | 8.28 | yes |

CSV `prefill_tps` is a rounded copy of the raw field. Not fabricated.

If reuse worked, `n_prompt` would be the delta and `n_past` the full length.
Observed: `n_prompt == n_past` on **7/7** steps. `n_common = 0` every time.

| step | delta n_prompt vs previous | observed n_prompt | observed / delta |
|---|---|---|---|
| grow1 | 171-74 = **97** | 171 | **1.7628865979** |
| grow2 | 270-171 = **99** | 270 | **2.7272727273** |
| grow3 | 353-270 = **83** | 353 | **4.2530120482** |
| grow4 | 437-353 = **84** | 437 | **5.2023809524** |
| grow5 | 527-437 = **90** | 527 | **5.8555555556** |

Sum of new tokens grow1..grow5 = **453**. Sum of prefill_s grow1..grow5 =
**219.714 s**. Control full prefill of the same 527 tokens = **63.648 s**.
They paid **219.714 / 63.648 = 3.4517x** the one-shot cost to "incrementally"
type the last 453 tokens.

### The control comparison (the only honest typeahead test)

Same 2580 bytes, same 527 tokens:

| | grow5 (`clear_kv=false`) | control (`clear_kv=true`) | grow5/control |
|---|---|---|---|
| prefill_s | 67.394 | 63.648 | **1.0588549522** |
| wall_s | 205.506 | 221.292 | **0.9286643891** |
| n_prompt | 527 | 527 | **1.0000000000** |
| prefill_tps_re | 7.8196872125 | 8.2799145299 | 0.944416 |

On the quantity the engine defines as work this turn (`prefill_s`, `n_prompt`),
the "incremental" step is **5.885% slower** than blowing the KV and prefilling
from scratch. Absolute extra: **+3.746 s**.

`wall_s` is 0.929x (grow5 15.786 s "faster"). That is **not** a typeahead win:
`n_prompt` is the full 527 both times, so the wall gap is non-prefill overhead
jitter (expert I/O / session wait), not skipped prefix tokens. `wall_s` is
**2.81x–3.48x** `prefill_s` on every step (chunk0: 59.626/17.314 = 3.4438).
Selling wall as the typeahead metric hides a 3x unexplained tax and then
cherry-picks the one ratio that looks like a 7% win.

### Fake "faster" ratios that are not typeahead

grow5 vs chunk0 prefill_s = 67.394/17.314 = **3.8924569712** (longer prompt).
grow5 vs chunk0 n_prompt = 527/74 = **7.1216216216**.
grow5 vs chunk0 prefill_tps_re = 7.8196872125/4.2739979208 = **1.8295954648**.

The 1.83x t/s "speedup" is cold-start amortization on a 7.12x longer prompt,
not KV reuse. Step 0 is 0.233973 s/tok; steps 2–6 sit at 0.117–0.128 s/tok
(~8 t/s). That is the normal long-prefill curve.

### Load folded into a first token that does not exist

`metrics.h:108`: `TTFT ~= load_seconds + prefill_seconds`.

| step | load_s + prefill_s | wall_s | generated tokens |
|---|---|---|---|
| 0 | 20.635+17.314 = **37.949** | 59.626 | 0 |
| 1 | 20.635+23.445 = **44.080** | 79.705 | 0 |
| 5 | 20.635+67.394 = **88.029** | 205.506 | 0 |
| 6 | 20.635+63.648 = **84.283** | 221.292 | 0 |

Folding `load_s` into every step double-counts a one-time 20.635 s mmap.
Folding it into step 0 and calling the result TTFT invents a first token:
`n_predict=0`, `tokens=0`. GROW2 claims "n_predict set to one"; the harness
did not (`cmdline.txt:5 N_PREDICT=0`). The prompt text lies about the protocol.

### Plugged rows (typeahead)

All 15 `typeahead/batt/*.json` have `"plugged": "UNPLUGGED"`.
`TYPEAHEAD.master.log` pre/post lines: UNPLUGGED, batt 86→83, temp 25.6→30.4.
`typeahead/watchdog.csv`: every sample UNPLUGGED. No plugged row in this campaign.

MemFree after 35B load (`pre_step0_chunk0`): **114348 kB = 111.66796875 MiB**.
Watchdog minimum: **58180 kB = 56.81640625 MiB** (timestamp 1786639350).
Mandate text said abort if MemFree < 300 MiB sustained. The shipped script
moved the floor to MemAvailable 300000 kB + MemFree LMKD 50000 kB
(`run_typeahead.sh:20-21`). MemAvailable stayed ≥ 682364 kB. The run is
valid under the script it actually executed, not under the 300 MiB MemFree
mandate as written.

---

# 2. Phase2b — raw llama-cli eval lines and recomputed ratios

Prompt file 2352 bytes, 6 repeats, labeled "512" tokens. Actual prompt eval
count on every cell: **490 tokens**. 490/512 = **0.95703125**. The "512-pp"
name is a 22-token lie.

`--no-warmup`. Each cell is a **new process** (new load). KV is not shared.
`PHASE2B.master.log:24` says so in English.

### Raw `slot print_timing`

CPU_512_128 (`cells/CPU_512_128/stderr.txt:11-13`):

```
prompt eval time =   12561.82 ms /   490 tokens (   25.64 ms per token,    39.01 tokens per second)
       eval time =   15748.01 ms /   128 tokens (  123.03 ms per token,     8.13 tokens per second)
      total time =   28309.82 ms /   618 tokens
```

GPU_512_128 (`cells/GPU_512_128/stderr.txt:10-12`):

```
prompt eval time =    4830.56 ms /   490 tokens (    9.86 ms per token,   101.44 tokens per second)
       eval time =   24353.32 ms /   128 tokens (  190.26 ms per token,     5.26 tokens per second)
      total time =   29183.88 ms /   618 tokens
```

HANDOFF_GPU_PP (`cells/HANDOFF_GPU_PP/stderr.txt:8-10`):

```
prompt eval time =    4741.57 ms /   490 tokens (    9.68 ms per token,   103.34 tokens per second)
       eval time =       0.00 ms /     1 tokens (    0.00 ms per token, 1000000.00 tokens per second)
      total time =    4741.57 ms /   491 tokens
```

HANDOFF_CPU_TG (`cells/HANDOFF_CPU_TG/stderr.txt:11-13`):

```
prompt eval time =   12109.09 ms /   490 tokens (   24.71 ms per token,    40.47 tokens per second)
       eval time =   19165.56 ms /   128 tokens (  149.73 ms per token,     6.68 tokens per second)
      total time =   31274.64 ms /   618 tokens
```

HANDOFF_GPU_PP stdout banner: `[ Prompt: 103.3 t/s | Generation: 1000000.0 t/s ]`.
Master log copies `ui_tg=1000000.0` (`PHASE2B.master.log:27`). That is not a
throughput. `n=1` produced the last-prompt logit as the "generated" token in
**0.00 ms**. `stop processing: n_tokens = 490` — the sequence never grew.
First token is inside prompt eval. There is no GPU TG number in this cell.

### Independent recomputation (ms → s, t/s, ms/tok)

| cell | pp_s = pe_ms/1000 | tg_s = ev_ms/1000 | pp t/s = 1000/(pe_ms/490) | tg t/s = 1000/(ev_ms/n) | cell ms/tok = ev_ms/n |
|---|---|---|---|---|---|
| CPU_512_128 | **12.561820** | **15.748010** | **39.0070865527** | **8.1280110947** | **123.031328125** |
| GPU_512_128 | **4.830560** | **24.353320** | **101.4375144911** | **5.2559568880** | **190.260312500** |
| HANDOFF_GPU_PP | **4.741570** | **0.000000** | **103.3412983463** | undefined (0 ms / 1 tok) | **0.000** |
| HANDOFF_CPU_TG | **12.109090** | **19.165560** | **40.4654685034** | **6.6786464888** | **149.730937500** |

CSV `pp_t_s` / `tg_t_s` / `ms_per` match these (ms_per rounded to 3 dp).
`total time` lines: CPU 12561.82+15748.01 = **28309.83** (log prints 28309.82),
GPU 4830.56+24353.32 = **29183.88** (exact), HCPU 12109.09+19165.56 = **31274.65**
(log prints 31274.64). 0.01 ms print rounding.

Wall minus compute (load + teardown + print, `--no-warmup` new process):

| cell | wall_s | compute_s | wall − compute |
|---|---|---|---|
| CPU_512_128 | 110.215 | 28.309830 | **81.905170** |
| GPU_512_128 | 216.159 | 29.183880 | **186.975120** |
| HANDOFF_GPU_PP | 114.460 | 4.741570 | **109.718430** |
| HANDOFF_CPU_TG | 130.710 | 31.274650 | **99.435350** |

ngl=99 cells spend ~110–187 s outside print_timing. ngl=0 cells spend ~82–99 s.
Stderr "model loaded" sits at ~2:20 (GPU), ~1:48 (HANDOFF_GPU_PP), ~0:18 (CPU),
~0:13 (HANDOFF_CPU_TG) if the `M.SS.mmm.uuu` stamp is minutes.seconds — the
~6–8x longer ngl=99 load is the only circumstantial GPU-path evidence.
**No `OpenCL` / `Adreno` / `offloaded` / `n_gpu_layers` string exists in any
phase2b log.** Probe accepted exit 0 anyway (`PHASE2B.master.log:10`).

### MODEL_* rows — what the script actually added

From `run_phase2b.sh:539-598`:

| row | formula | value | ms_per = user*1000/128 |
|---|---|---|---|
| MODEL_CPU | CPU pp + CPU tg | 12.561820+15.748010 = **28.309830** | **221.170546875 → 221.171** |
| MODEL_GPU | GPU pp + GPU tg | 4.830560+24.353320 = **29.183880** | **227.999062500 → 227.999** |
| MODEL_GPU_PP_CPU_TG | GPU pp + CPU tg | 4.830560+15.748010 = **20.578570** | **160.770078125 → 160.770** |
| HANDOFF_PAIR | wall_GPU_PP + wall_CPU_TG | 114.460+130.710 = **245.170** | (blank) |

CSV matches. `MODEL_GPU_PP_CPU_TG` does **not** add GPU_TG.

`ms_per` is not the same quantity on MODEL rows and cell rows.
Cell `ms_per` = decode-only `ev_ms/n_gen` (CPU 123.031).
MODEL `ms_per` = full `(pp+tg)*1000/n_gen` (CPU 221.171).
Putting 160.770 next to 123.031 as if both were "ms/token" is a unit smash.

### Ratios that matter

Let `U_cpu = 28.309830`, `U_gpu = 29.183880`, `U_comp = 20.578570`.

| ratio | value | meaning |
|---|---|---|
| U_comp / U_cpu | **0.7269054600** | composed ceiling vs CPU-only turn |
| U_comp / U_gpu | **0.7051348210** | composed ceiling vs GPU-only turn |
| U_gpu / U_cpu | **1.0308744348** | GPU-only turn is **slower** than CPU-only |
| GPU_pp / CPU_pp | **0.3845430041** (CPU/GPU = **2.6004893843**) | PP looks GPU-like |
| GPU_tg / CPU_tg | **1.5464379309** (CPU/GPU = **0.6466473565**) | TG looks GPU-like (worse) |

The composed 0.73x is the number someone will try to sell. It is not a
measured turn. It stitches PP from a process that then spent **24.353320 s**
of GPU decode, with TG from a different cold CPU process.

### The handoff that actually ran

Two new processes, KV not shared. CPU leg **re-prefills all 490 tokens**
(12109.09 ms). That is the opposite of a handoff.

Paid compute, all three legs:

`4.741570 + 12.109090 + 19.165560 = 36.016220 s`

| ratio | value |
|---|---|
| paid3 / U_cpu | **1.2722160465** (LOSS vs CPU-only) |
| paid3 / U_gpu | **1.2341134900** (LOSS vs GPU-only) |
| paid3 / U_comp | **1.7501808921** (composed ceiling missed by 75%) |
| HANDOFF_PAIR walls / U_cpu | 245.170 / 28.309830 = **8.6602427496** |
| HANDOFF_PAIR walls / U_gpu | 245.170 / 29.183880 = **8.4008706176** |
| HCPU tg / CPU tg | 19.165560 / 15.748010 = **1.2170147212** |
| HCPU pp / CPU pp | 12.109090 / 12.561820 = **0.9639598402** |
| HGPU pp / GPU pp | 4.741570 / 4.830560 = **0.9815777053** |
| HCPU (pp+tg) / U_cpu | 31.274650 / 28.309830 = **1.1047275805** |

Naive `HANDOFF_PAIR` pp+tg (4.741570+19.165560 = **23.907130**) drops the
**12.109090 s** CPU re-prefill the CPU process actually paid. Still worse
than the composed 20.578570, and still not a shared-KV handoff.

If someone **adds GPU_TG** to the ceiling (the attack):
`4.830560 + 24.353320 + 15.748010 = 44.931890 s`.
The script did not do that. The CSV ceiling is GPU_PP+CPU_TG only.
The real crime is omission (re-prefill, two loads), not addition of GPU_TG.

### n=1 of 2B is not 35B

- Probe (`probe/bin_fix2_llama-cli/stderr.txt:8-9`): 1011.95 ms / 15 tokens =
  **14.8238 t/s** PP, eval 0.00 ms / 1 token, n_tokens at stop = 15.
  Same first-token fold. 15-token PP is not 490-token PP.
- HANDOFF_GPU_PP: 103.341 t/s PP on 490 tokens of **2B**, n=1, TG = 0 ms.
- Typeahead: **35B**, n_predict=0, ~8 t/s CPU prefill, no ngl.
- K4 35B GPU-prefill (closed, `moe-k4-split.md:311-326`) is a different
  binary/model/cell. These logs do not replace it and must not be averaged
  with it.

Citing 103 t/s, 20.578570 s, or 1000000 t/s as a 35B result is fraud.

### Plugged rows (phase2b)

All 10 `phase2b/batt/*.json` are `"plugged": "UNPLUGGED"`.
Master log pre/post: UNPLUGGED, batt 82→81, temp 27.4→28.8.

`phase2b/watchdog.csv` has **4 samples** then stops (last:
`2026-08-13T13:09:42 UNPLUGGED 82 28.0 215920 mem_low_1`).
`watchdog.log` is empty. GPU cell starts 13:11:50, handoff 13:15:45–13:19:57.
There is **no 15 s watchdog stream** over the GPU/handoff window. Plugged
status there is only the pre/post snapshots (all UNPLUGGED). Not a plugged
row; it is a coverage hole.

`mem_low_1` = 215920 kB = **210.859375 MiB** during CPU_512_128. One sample,
not the script's 4-sample abort. Phase2b still uses MemFree 300000 kB
(`run_phase2b.sh:15`). CPU cell would have died if that dip had lasted.

---

# 3. Findings (recall-biased)

### F1. Typeahead is a full re-prefill. Not a win.
**BLOCKER / CONFIRMED** — `session.stdout.log` BMOE_DONE id=1..7; `session.cpp:1167-1173`

Failure: `--session` without `--chatml` → `chat_on=false` → `n_common` forced 0
→ `n_prompt == n_past` == full document on every grow step. grow5/control
prefill = **1.0588549522**. The idea's own control says the win is gone.

Do not cite any grow-step `prefill_tps` as incremental typeahead.

### F2. Composed GPU-PP+CPU-TG ceiling is not a measured turn; measured handoff loses.
**BLOCKER / CONFIRMED** — `summary.csv:8` vs `HANDOFF_*` print_timing

`MODEL_GPU_PP_CPU_TG = 20.578570 s` is `t_pp(GPU_512_128) + t_tg(CPU_512_128)`.
The only attempted handoff paid **36.016220 s** of compute (1.750x the
ceiling) plus **245.170 s** of sequential walls (two loads). CPU-only user
turn is **28.309830 s**. GPU-only is **29.183880 s** (worse than CPU).
A real shared-KV GPU-PP→CPU-TG handoff was not run.

### F3. HANDOFF_CPU_TG re-prefills the whole 490-token prompt.
**BLOCKER / CONFIRMED** — `cells/HANDOFF_CPU_TG/stderr.txt:11`

`prompt eval time = 12109.09 ms / 490 tokens`. Notes in CSV even admit
"KV NOT shared; re-prefill paid". Any table that shows HANDOFF_PAIR as
`pp_t_s=4.741570, tg_t_s=19.165560` and invites pp+tg = 23.907130 **hides
12.109090 s**.

### F4. n=1 first token is folded into prefill; Generation 1e6 t/s is garbage.
**BLOCKER / CONFIRMED** — `HANDOFF_GPU_PP/stderr.txt:8-12`, `stdout.txt:34`

eval 0.00 ms / 1 token, total time = prompt eval, `n_tokens=490` at stop.
Same pattern on the 15-token probe. Do not use this cell as TG, TTFT-without-
qualification, or a GPU decode rate.

### F5. n=1 of 2B is not 35B. Typeahead 35B has no decode.
**BLOCKER / CONFIRMED** — model paths + `tokens=0` + `n_predict=0`

Two different GGUFs (12.495 GiB vs 1.193 GiB). Typeahead never generated a
token. Phase2b never loaded KEXP. K4 35B GPU-prefill stays the closed 35B
GPU number. These logs do not update it.

### F6. MODEL_* `ms_per` folds PP into per-token; cell `ms_per` does not.
**WARNING / CONFIRMED** — `run_phase2b.sh:559-561` vs `464-466`

CPU 221.171 vs 123.031. GPU 227.999 vs 190.260. Composed 160.770 has no
matching cell. A reader comparing 160.770 to 123.031 will invent a decode
win that is just PP amortization.

### F7. "512-pp" is 490 tokens.
**WARNING / CONFIRMED** — every print_timing ` / 490 tokens`

490/512 = 0.95703125. Throughput is fine; the label is not.

### F8. No OpenCL string; GPU attribution is circumstantial.
**WARNING / CONFIRMED** (string absent) / **PLAUSIBLE** (path is GPU)

PP 2.6005x and TG 0.6466x vs CPU, plus 6–8x longer load on ngl=99, match
the usual Adreno pattern. Probe explicitly warned it saw no OpenCL string.
Do not write "OpenCL confirmed 101 t/s". Write "ngl=99 cell, no OpenCL
banner, PP/TG signature consistent with GPU".

### F9. wall_s includes load; MODEL user_turn does not. Mixing them is a lie.
**WARNING / CONFIRMED**

HANDOFF_GPU_PP wall 114.460 vs pp 4.741570 (load leftover 109.718430).
If TTFT is reported as 114 s that is load+prefill on a cold process.
If TTFT is reported as 4.74 s that is compute-only, persistent-session
assumption, and the 1 gen token is already inside those 4.74 s.

Typeahead `wall_s` is 3x `prefill_s` with the model already loaded. Unexplained.
Do not substitute wall for prefill to manufacture a grow5-vs-control win
(0.929x wall, 1.059x prefill).

### F10. Phase2b watchdog died after `mem_low_1`; GPU/handoff have no 15 s stream.
**WARNING / CONFIRMED** — `phase2b/watchdog.csv` 4 rows, `watchdog.log` empty

Not a plugged finding. Coverage hole. Snapshots still say UNPLUGGED.

### F11. Typeahead MemFree under 300 MiB the entire loaded window.
**WARNING / CONFIRMED** — pre_step0 114348 kB, watchdog min 58180 kB

Valid only because the script abandoned the 300 MiB MemFree mandate.
Not a speed-number fabrication. Do not pretend the mandate was honored.

---

# 4. Mandated attacks — verdict

### A. Calling typeahead a win if later steps re-prefill the whole prefix
**CONFIRMED as the actual outcome, not a hypothetical.**
Every grow step re-prefilled the whole prefix (`n_prompt == n_past == full`).
grow5/control prefill **1.05885**. Any "typeahead win" claim from this CSV
is false. The 0.929 wall ratio is the only number that looks kind and it
is the wrong metric.

### B. GPU-PP+CPU-TG ceiling that adds GPU_TG
**REFUTED as written in `summary.csv`.** `MODEL_GPU_PP_CPU_TG = 4.830560 + 15.748010`.
GPU_TG (24.353320) is not in that sum. Adding it would be 44.931890.

**CONFIRMED adjacent crime:** the ceiling omits the 12.109090 s re-prefill
the only handoff paid, cherry-picks cold CPU TG (15.748010) over the TG
measured after GPU (19.165560 = 1.21701x slower), and still gets sold as
0.7269x vs CPU. Measured paid3 is **1.2722x vs CPU** (a loss).

### C. Plugged rows
**REFUTED for both campaigns' batt JSON and master-log snapshots.**
Every `plugged` field is `UNPLUGGED`. batt 86→83 (typeahead) and 82→81
(phase2b). temp ≤ 30.6 C. No speed row while charging.

Caveat: phase2b watchdog does not cover GPU/handoff; typeahead watchdog does.

### D. First-token including load folded into prefill
**CONFIRMED, two places.**

1. Typeahead: engine docs say `TTFT ~= load + prefill`; `load_s=20.635` is
   stamped on every DONE; `tokens=0` so there is no first token; step0
   load+prefill = 37.949 s, wall = 59.626 s.
2. Phase2b HANDOFF_GPU_PP / probe: `n=1` eval time 0.00 ms, first token
   inside prompt eval; wall 114.460 s vs pp 4.741570 s folds ~110 s of load
   into the process lifetime. Banner `Generation: 1000000.0 t/s`.

### E. n=1 of 2B sold as 35B
**CONFIRMED as a live footgun; not yet sold in-repo** (no report outside
these CSVs cites 20.578570 or 103.34 t/s as 35B). The two campaigns are
different GGUFs. Typeahead 35B has `n_predict=0`. Phase2b `n=1` is 2B.
Do not update K4 35B GPU-prefill with anything in this directory.

---

# 5. What may be cited (and how)

Cite only with model + ngl + what was actually timed.

**35B KEXP, bmoe-cli, CPU stream, unplugged, n_predict=0**

- Session load_s = 20.635 (once).
- Full prefill 74 tok = 17.314 s (4.2739979208 t/s), cold.
- Full prefill 527 tok = 63.648 s control / 67.394 s grow5
  (8.2799145299 / 7.8196872125 t/s).
- KV reuse did not fire. Do not call this typeahead.

**2B Q4_K_M, llama-cli, unplugged, 490-token prompt, 128 gen, --no-warmup**

- CPU ngl=0: PP 39.0070865527 t/s, TG 8.1280110947 t/s, user 28.309830 s.
- ngl=99 -fa off: PP 101.4375144911 t/s, TG 5.2559568880 t/s, user 29.183880 s.
  No OpenCL string. GPU-only user turn is slower than CPU-only.
- Composed 20.578570 s is arithmetic, not a run.
- Measured two-process "handoff" compute 36.016220 s, walls 245.170 s.

**Do not cite**

- grow5 wall 0.93x as a typeahead win
- grow5 t/s 1.83x vs chunk0 as a typeahead win
- `Generation: 1000000.0 t/s`
- `MODEL_GPU_PP_CPU_TG` as an achieved handoff
- any phase2b t/s as 35B
- any typeahead tok_s (all zero) as decode
- HANDOFF_PAIR pp+tg without the 12.109 s re-prefill
- 512-token PP (it was 490)

## Ruled out

- Fabricated CSV timings: `prefill_tps` and `pp_t_s`/`tg_t_s` recompute from
  the raw lines. The numbers are real. The story around them is not.
- Plugged contamination of the speed rows (JSON + master log).
- `MODEL_GPU_PP_CPU_TG` secretly summing GPU_TG (it does not).
- Typeahead being a 2B run (it is 35B KEXP).
- Phase2b being a 35B run (it is 2B).
