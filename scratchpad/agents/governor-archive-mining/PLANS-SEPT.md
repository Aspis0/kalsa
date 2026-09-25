# PLANS-SEPT — evidence mined from the six September plan documents (governor extraction)

Scope: read-only mining of six files in `kalsa-moe-experiments/archived/`:

- `archived/PLAN-2026-09-full.md` (3163 lines)
- `archived/GOVERNOR-DEVICE-PLAN-2026-09-audited.md` (1054 lines)
- `archived/docs/PLAN-governor-in-app.md` (126 lines)
- `archived/docs/PLAN-10DAYS-2026-08-28.md` (314 lines)
- `archived/docs/PLAN-10DAYS-2026-08-28.AUDIT.md` (409 lines)
- `archived/docs/repo-audit-2026-08-28/PLAN-compact-rewrite-audit-2026-09-04.md` (59 lines)

Labels: **MEASURED** (with device / date / plugged? / thermal status where the source states it) · **ESTIMATED** · **REFUTED** (never present as live).
Quotes are verbatim (source language kept as written — mostly Italian); all surrounding text is English.
Nothing outside these six files is cited.

---

## 0. The admission table: where `{128,512,1024,2048}` × `{1.9,3.25,3.25,5.15}` °C came from

**0.1 — MEASURED (Galaxy S23, Hexagon v73; plugged state not stated; from the q58 spike-sweep guard, WARN 40 °C) — but measured on the NPU sweep, whole-process ΔT, n=2 per cell, then reused as a CPU-chunk price for GPU-capable generations.**

`archived/GOVERNOR-DEVICE-PLAN-2026-09-audited.md:185-186`

> ```c
> constexpr float k_cpu_delta_c[] = { 1.9f, 3.25f, 3.25f, 5.15f };   // llama-governor-policy.cpp:15
> constexpr uint32_t k_table_tokens[] = { 128, 512, 1024, 2048 };    // :14
> ```

`archived/GOVERNOR-DEVICE-PLAN-2026-09-audited.md:189-193` (provenance, traced with `git log -S`)

> Provenienza tracciata con `git log -S`: commit `c1bb48d32` e lo sweep
> `scratchpad/agents/q58-s23-npu-spike-sweep`. `REPORT.md:31-35` sono esattamente quei quattro valori;
> `RUN_LOG.md:5` dichiara `device=Galaxy S23 / Hexagon v73`. Sono ΔT **di processo intero** (mmap del
> modello inclusa), n=2 per cella, di uno sweep **NPU**, usati per prezzare un chunk **GPU** su V75 e
> V79. In `llama-governor-policy.cpp:200,205` non c'e' **nessun ramo per device**.

Answer to the question asked: **the four deltas were measured once, on the S23, in the q58 NPU spike sweep, as whole-process ΔT including the model mmap, n=2 per cell; they were never re-measured per device or per backend, and there is no device branch in the policy.**

**0.2 — The ceiling 39.5 °C is `k_warn_c − 0.5`, and warn/kill are the q58 harness guard's values promoted to product.**

`archived/GOVERNOR-DEVICE-PLAN-2026-09-audited.md:195-196`

> Inoltre `k_warn_c = 40.0` e `k_kill_c = 43.0` (`:10,12`) sono le soglie della **guardia
> dell'harness** q58 (`--warn-tenths 400 --kill-tenths 430`), promosse a soffitto di prodotto.

`archived/GOVERNOR-DEVICE-PLAN-2026-09-audited.md:933` (audit, code re-read)

> `llama-governor-policy.cpp:14-15` (both arrays, exact); `:10,12` `k_warn_c 40.0` / `k_kill_c 43.0` (and `k_limit_c = k_warn_c - 0.5` at `:11`); `:200,205` no device branch

**0.3 — MEASURED/ARITHMETIC (audit, boundary hand-checked): the effective admission temperatures.**

`archived/GOVERNOR-DEVICE-PLAN-2026-09-audited.md:952`

> Admission thresholds: the code rejects with `> k_limit_c`, so entry *i* is admitted iff `now_c + Δ_i ≤ 39.5`, i.e. **≤ 34.35 (2048), ≤ 36.25 (1024 and 512), ≤ 37.6 (128)** — **inclusive**, and the `table==0` escape at `:204-205` can never admit above 37.6. Hand-checked at the boundary: a 128-token prompt at exactly 37.6 stops at `table=1` and returns `Admit`; at 37.61 it returns `Wait`. All correct, and §2.2's "Sopra 37,6 °C nessun blocco della tabella passa" is correct as written.

`archived/GOVERNOR-DEVICE-PLAN-2026-09-audited.md:953`

> Note: 512 and 1024 carry the **same** ΔT (3.25), so the plan's "riduci i TOKEN per chunk" lever has only three distinct thermal steps, not four.

**0.4 — Audit correction on what the four numbers actually price (DERIVE / partially undermines the plan's own argument).**

`archived/GOVERNOR-DEVICE-PLAN-2026-09-audited.md:944`

> - `q58 REPORT.md:31-35` "sono esattamente quei quattro valori" → the four CPU mean ΔT rows are `:29 (1.900)`, `:31 (3.250)`, `:33 (3.250)`, `:35 (5.150)`; `31-35` also contains NPU rows `:32` and `:34`. Needs `27-35` or `29/31/33/35`.

`archived/GOVERNOR-DEVICE-PLAN-2026-09-audited.md:945`

> - §0.5 "usati per prezzare un chunk **GPU** su V75 e V79": the constants are the *CPU* delta in `now_c + k_cpu_delta_c[table-1] > k_limit_c`. They price the CPU alternative to a GPU chunk, not the GPU chunk. Minor, but it weakens the plan's own Rule-2 argument that these numbers are foreign.

**0.5 — The unit of the table is not intensive: °C per 1000 token varies 5.9× across the four sizes (audit, derived from the same q58 means).**

`archived/GOVERNOR-DEVICE-PLAN-2026-09-audited.md:1006`

> And the unit is wrong. From the plan's own cited source (`q58 REPORT.md`, per-size means): CPU `°C/1k tokens` = **14.844 (128), 6.348 (512), 3.174 (1024), 2.515 (2048)** — a **5.9× spread**, monotonically falling.

**0.6 — The plan's own replacement unit: °C per 1000 token, never °C/min, never whole-process ΔT with the model load inside.**

`archived/GOVERNOR-DEVICE-PLAN-2026-09-audited.md:647-650`

> **Quello che va misurato, in ogni caso, e' °C per 1000 token** — mai °C al minuto, e mai ΔT di
> processo intero con dentro il caricamento del modello, che e' l'errore che ha prodotto i valori
> q58 usati oggi.

**0.7 — External cross-check that the spike limits are banked: `N_max 512 / 39.5 °C` (q58).**

`archived/docs/PLAN-10DAYS-2026-08-28.AUDIT.md:76-77`

> N_max 512 / 39.5 °C
> (q58); cool-mode −19 %/−2.75 °C (§8 map); "B worst everywhere"; #23 "GPU moves nothing";

`archived/docs/PLAN-10DAYS-2026-08-28.md:171-172`

> - NPU: prefill-only everywhere (decode 0.37–0.63×); v73 dies on MoE graphs (3 firmware
>   signatures), dense graphs run (spike: ≤ 512 tokens / 39.5 °C); v75: experts-on-NPU R2 certified (32 chunks),

`archived/docs/PLAN-10DAYS-2026-08-28.md:281` (HVX chapter scope)

> ≤ 512 tokens, ≤ 10 min, ≤ 39.5 °C). **Not testable on v73**: `MUL_MAT_ID` (KEXP experts).

---

## 1. Heat per chunk / °C rise — measured numbers by device

### 1.1 Xiaomi 14 (SD8650 / Adreno 750 / Hexagon v75) — paired battery + SoC-zone deltas

**MEASURED (Xiaomi 14, "houji", paired runs the same evening, UNPLUGGED — `AC powered: false` confirmed by audit, thermal status not stated).**

`archived/GOVERNOR-DEVICE-PLAN-2026-09-audited.md:467-478`

> **Termica, coppie appaiate della stessa sera, staccato** —
> `results/xiaomi_ab/task_a/battery_notes.txt`, riletto dall'orchestratore:
>
> | carico | motore | batteria | zona SoC di picco |
> |---|---|---|---|
> | 2B pp512 | CPU | 27,9 → 29,0 (+1,1) | — |
> | 2B pp512 | GPU | 29,0 → 29,0 (0,0) | — |
> | 2B pp1024 | CPU | 29,0 → 31,8 (+2,8) | — |
> | 2B pp1024 | GPU | 32,2 → 31,9 (−0,3) | — |
> | 2B pp2048 | CPU | 31,9 → 35,5 (+3,6) | 47,8 → **67,1** (+19,3) |
> | 2B pp2048 | GPU | 35,5 → 35,6 (+0,1) | 49,2 → 50,6 (+1,4) |

`archived/GOVERNOR-DEVICE-PLAN-2026-09-audited.md:480` (4B, same direction, **but see REFUTED 5.4 — wrong artifact cited, cited artifact marked CONTAMINATED**)

> Il 4B da' lo stesso verso: CPU +2,4/+3,5/+1,7 a pp512/1024/2048 contro GPU +0,4/−0,7/−0,3.

**REFUTED-as-cited (audit finding 5):** `archived/GOVERNOR-DEVICE-PLAN-2026-09-audited.md:912`

> ### 5. REFUTED (wrong artifact, contaminated source, wrong night) — the 4B thermal deltas.

`:914`

> Plan: header cites `results/xiaomi_ab/task_a/battery_notes.txt` for the block, then *"Il 4B da' lo stesso verso: CPU +2,4/+3,5/+1,7 … contro GPU +0,4/−0,7/−0,3"*.

(the audit goes on: the six values are exact but come from `task_a_4b_clean/battery_notes.txt`, run started `2026-08-13T05:32:25`, not "the same evening"; the cited file's own 4B block is marked `CONTAMINATED`.)

**Audit arithmetic CONFIRMED on the 2B block** `archived/GOVERNOR-DEVICE-PLAN-2026-09-audited.md:950`

> Deltas §3.1 2B: `279→290 (+1.1)`, `290→290 (0.0)`, `290→318 (+2.8)`, `322→319 (−0.3)`, `319→355 (+3.6)`, `355→356 (+0.1)`; SoC `47812→67100 = +19.288` (plan +19.3), `49157→50600 = +1.443` (plan +1.4); `AC powered: false` throughout.

**The consequence the plan draws (fallback above 37.6 °C sends the whole turn to CPU):** `archived/GOVERNOR-DEVICE-PLAN-2026-09-audited.md:334-341`

> Sopra 37,6 °C nessun blocco della tabella passa, la decisione e' `Wait`, e il runtime:
> ```c
> // llama-governor-runtime.cpp:60-63
> LLAMA_LOG_WARN("%s: prefill admission is waiting; routing this turn to CPU\n", __func__);
> ```
> Cioe': la tabella rifiuta **perche' la CPU scalderebbe troppo**, e il ripiego manda l'intero turno
> **sulla CPU**, per giunta non spezzato. Sullo Xiaomi quella e' la strada che misura **+19,3 °C** di
> zona SoC contro **+1,4** della GPU.

### 1.2 Xiaomi 14 — NPU heat claim

**REFUTED (audit finding 3): the "+1.3 °C NPU" is the whole cell's rise, not the NPU's.**

`archived/GOVERNOR-DEVICE-PLAN-2026-09-audited.md:292` (the plan's claim)

> (3,19× la CPU, ΔT +1,3 °C).

`archived/GOVERNOR-DEVICE-PLAN-2026-09-audited.md:898-903`

> ### 3. REFUTED — the NPU "ΔT +1,3 °C" is the whole cell's rise, not the NPU's.
> … So the only derivation of +1.3 is `end − htp1_pre` = **34.2 − 32.9**, the entire cell including the CPU rep. Per-leg: three HTP reps ≈ +0.4 total; the single CPU rep +0.9.

`:902`

> Consequence: the number is used to argue the NPU is the *cool* prefill engine, while the artifact attributes three quarters of the rise to the CPU arm — and no per-engine NPU ΔT exists in the artifact.

### 1.3 Galaxy S23 (SD8550 / Adreno 740 / Hexagon v73)

**MEASURED (S23; source cells 12-13/08, plugged state not stated in this file; sustained-load plateau).**

`archived/GOVERNOR-DEVICE-PLAN-2026-09-audited.md:515-520`

> Decode GPU **−19%** di velocita' ma **−2,75 °C**, e sotto carico prolungato la CPU throttla
> **14-16%** mentre la GPU resta piatta **0-5%**.
>
> Qui la GPU perde lo scatto e vince la maratona. Per un'app di chat vera conta il sostenuto: un
> decode che parte a 17,5 tok/s e scende a 14,8 e' peggio di uno che sta a 14,2 stabile, perche' il
> secondo non fa scaldare il telefono in mano.

**The "17,5 → 14,8 tok/s" sentence is NOT in any artifact — unverified.** `archived/GOVERNOR-DEVICE-PLAN-2026-09-audited.md:957`

> So "−19% ma −2,75 °C" and "CPU throttla 14-16% mentre la GPU resta piatta 0-5%" are exact. The plan's *"parte a 17,5 tok/s e scende a 14,8"* is **not** in that artifact (segments are 12.2/10.9/10.2 and 8.2/8.2) and I found no source — see the unverified list.

Same line re-states the underlying measured running medians: `A 14.252 / C 17.553 → A/C 0.812`; peak T `A 37.200 / C 39.950`; sustained segments `CPU 12.2→10.2 = −16%`, `GPU 8.2→8.2 = 0%` (S23 2B), 4B `CPU −14%`, `GPU −5%`.

**MEASURED (S23, cool-mode evidence 12-13/08, repeated in the September plan).** `archived/PLAN-2026-09-full.md:605-607`

> (S23 12-13/08: decode GPU 38,5 °C in plateau vs CPU 42,3 in
> salita; QRD8650: +4,5 °C GPU vs +10,1 °C CPU nello stesso turno; NPU prefill 3,5×/4,8×/7,2× su
> v73/v75/v79) ma **l'app non fa nulla di tutto questo**

`archived/PLAN-2026-09-full.md:702-704`

> Evidenza cool-mode S23 (12-13/08): decode GPU 38,5 °C
> plateau vs CPU 42,3 in salita, CPU piu' efficiente per token (0,61 % vs 0,79 %/1k) con la GPU a 0,67×.
> Incident motivante: S23 10 %→1 % in 15 min col caricatore debole, 29→38 °C, spento.

**MEASURED (S23, unplugged, 17/09 — the number that "justifies the per-phase governor").** `archived/PLAN-2026-09-full.md:2584-2586`

> S23 staccato, chat semplice, nessun allegatto: **34,6 °C → 44,0 °C in 38 minuti e 6 turni**.
> Decode da 10,17 a 6,48 tok/s (**−36%**). Prefill = **53%** del tempo di calcolo (733 s contro
> 651 s di decode, di cui 153 s di prewarm). Da fermo il telefono recupera 10 °C in 25 minuti.

`archived/PLAN-2026-09-full.md:2588-2590`

> **Conseguenza da decidere:** **venti turni su un S23 a batteria non sono fisicamente possibili
> con questo modello.** Il run e' morto al turno 6 con `THERMAL GIVEUP`.

`archived/PLAN-2026-09-full.md:2596-2598` (thermal pause that does not stop the work)

> Ma un'app che genera non si raffredda: al turno 6 ha **guadagnato 1,9 °C durante il raffreddamento** (42,1 → 44,0). Una pausa che non ferma il lavoro non e' una pausa.

**MEASURED (S23, unplugged, T20C run 17/09): thermal trace.** `archived/PLAN-2026-09-full.md:2134-2136`

> The thermal trace shows
> why: battery 39.6 °C flat through turns 1-3, then 40.8 → 42.4 → 42.8 → 43.1 within four minutes,
> skin status 2 → 3, AP peaking at 59.8 °C.

**MEASURED (S23): cool-down time and battery cost per turn.** `archived/PLAN-2026-09-full.md:2449-2453`

> - *Cooling.* Battery peaked at 43.3 °C and was back to 34.4 °C with thermal status 0 after
>   **13 minutes** idle (trace in `results/t20c-thermal-2026-09-17/`). So heat is not what gates a re-run; it clears itself in a quarter of an hour.
> … about **3.7 points per turn**.

**MEASURED (S23): AP collapses before battery; battery keeps rising after a pause starts.** `archived/PLAN-2026-09-full.md:2139-2141`

> The AP collapses
> first (55.7 → 46.4 °C in 25 s) and the battery follows with a lag, so battery temperature keeps
> RISING for a minute or two after a pause begins. Any future gate must expect that overshoot.

### 1.4 Jelly Star (Helio G99 / Mali-G57 MC2)

**MEASURED (Jelly, unplugged, 19/09 01:36 EDT, thermal status 0 → 3 in 9 min).** `archived/PLAN-2026-09-full.md:1603`

> Watchdog … 01:36:05 57% 26,0 °C status 0 → 01:39 55% 28,0 → 01:42 53% 33,0 → 01:44 51% 34,0 → **01:45:08 STOP: thermal status 3** (SEVERE) → runner 73405 ucciso. Nove minuti dal lancio, batteria 57→51% (~40 punti/h sotto carico) … **1 turno sostenuto dal 57% staccato, poi status 3 in 9 minuti**

Same line, the turn's speeds (Jelly, unplugged, status 0→3, tools accidentally ON, cell later VOID by tool rule):

> Turno 1 … round 0 prompt_n 2430, promptMs 94.597 (25,7 tok/s prefill), 258 token a 6,28 tok/s; round 1 `web_search` prompt_n 116, 168 token a 5,92; round 2 `web_search` prompt_n 231, 429 token a 5,77; `timingValid: true`.

**MEASURED (Jelly).** `archived/GOVERNOR-DEVICE-PLAN-2026-09-audited.md:559-561`

> **Misurato:** `Thermal Status 3` (SEVERE) in **9 minuti** da freddo, con la batteria ancora al 51%;
> batteria 26,0 → 34,0 °C; consumo ~40 punti/ora sotto carico contro ~5 da sveglio e fermo. Il limite
> e' termico, non di carica.

**REFUTED (external, audit finding 7): "2 CU a 1100 MHz" is not the G99's clock.** `archived/GOVERNOR-DEVICE-PLAN-2026-09-audited.md:926-928`

> ### 7. PLAUSIBLE-to-REFUTED (external) — Mali-G57 MC2 ✓, but "1100 MHz" is the wrong number from the right page.
> … **1100 MHz** appears on NotebookCheck only as the *generic Mali-G57 MP2 row maximum across other SoCs*

**NOT MEASURED — no Mali tok/s exists.** `archived/GOVERNOR-DEVICE-PLAN-2026-09-audited.md:551`

> ⚠️ **Nessun tok/s esiste su questa corsia**: `llama-bench` non e' stato eseguito, sul telefono non c'è un GGUF f32 e il percorso quantizzato aborta. **Non citare un numero di prefill Mali**: non esiste.

### 1.5 8 Elite / QRD8750 (Adreno 830, Hexagon v79)

- No Adreno-830 or v79 tok/s/°C figure appears in these six files; the September plans only *schedule* the measurement: `archived/docs/PLAN-10DAYS-2026-08-28.md:184` "Target **Snapdragon 8 Elite / SM8750** (Adreno 830, Hexagon v79)" and `:201` "| B GPU speed | llama-bench A/C (pp512 + tg128, `-nr -fa off`) … | decision table 8 Elite |".
- QDC budget lines (historical): `archived/docs/repo-audit-2026-08-28/PLAN-compact-rewrite-audit-2026-09-04.md:42` — "| Budget 912/935/913/981/623 (diario 4/09) | … 912(7xx)/935(8G2)/913(8G3)/981(8sG3)/623(8E) | ✅ |".

### 1.6 Chipset-tier figures re-checked by the compact-rewrite audit (all sourced to ALIVE rows)

`archived/docs/repo-audit-2026-08-28/PLAN-compact-rewrite-audit-2026-09-04.md:30-36`

> | 732/735 prefill pp512 151.8/154.8 (cells 36, 39) | ALIVE rows 36, 39 | 151.8±1.1 / 154.8±1.3 | ✅ |
> | 740: pick = igiene (37) | ALIVE row 37 | "Δ +0.65%/−0.12%, dentro ±3% → TAKE come igiene" | ✅ |
> | 750: 284.2/23.4 (38), 291.1/23.0 (41) | ALIVE rows 38, 41 | 284.2±0.1 / 23.4±0.0; 291.11±0.56 / 23.02±0.04 | ✅ |
> | CPU decode wins all tiers (GPU 0.80–0.86×) (40) | ALIVE row 40 | "decode vince su tutti e tre i tier (GPU 0.80–0.86×)" | ✅ |

---

## 2. Speed (prefill / decode tok/s) per backend, device, model

### 2.1 Xiaomi 14 — llama-bench CPU vs GPU vs NPU

**MEASURED (Xiaomi 14, `results/xiaomi_ab/phase3_baseline`, Qwen3.5-2B Q4_K_M, CLI llama-bench, plugged state not stated).** `archived/GOVERNOR-DEVICE-PLAN-2026-09-audited.md:484-488`

> **Velocita'** — `results/xiaomi_ab/phase3_baseline/bench_{cpu,gpu_faoff}.json`, Qwen3.5-2B Q4_K_M, letto dal JSON:
>
> | fase | CPU | GPU | rapporto |
> |---|---|---|---|
> | prefill pp128 | 31,459 | **181,652** | GPU **5,77×** piu' veloce |
> | decode tg256 | **16,149** | 7,066 | GPU **2,3× piu' lenta** |

**MEASURED (rerun 18/08, interleaved) — the better-controlled prefill ratio; decode evidence is only n=2 pairs (see REFUTED 5.6).** `archived/GOVERNOR-DEVICE-PLAN-2026-09-audited.md:490-492`

> Il rerun interlacciato del 18/08 (10 ripetizioni per verso, entrambi gli ordini) conferma il verso
> del decode — GPU 17,46 vs CPU 26,50 — e **ridimensiona il prefill a 3,18×** con una baseline CPU
> migliore. Il 5,77× e' quello propagato nei doc dell'app; il 3,18× e' quello meglio controllato.

**MEASURED (Xiaomi, NPU):** `archived/GOVERNOR-DEVICE-PLAN-2026-09-audited.md:494`

> **NPU:** prefill 165,4 vs 51,9 CPU (**3,19×**, ΔT +1,3 °C); decode 4,47 vs 11,94 (**0,37×**).

(ΔT part REFUTED — see 1.2. Ratios audit-confirmed at `:950`: `165.42/51.90 = 3.1873`; `4.47/11.94 = 0.3744`.)

**Contested: both 5,77× and 3,18× are measured, and the app docs carry the worse-controlled one.** `archived/GOVERNOR-DEVICE-PLAN-2026-09-audited.md:747-748`

> - Il **"GPU prefill 5,77×"** propagato nei doc dell'app e' conteso dal rerun meglio controllato che da' **3,18×**. Entrambi misurati.

**MEASURED (Xiaomi 14, unplugged, 19/09 00:37 cable pulled by owner; LFM2.5-2.6B, in-app).** `archived/PLAN-2026-09-full.md:1599`

> curva di raffreddamento staccata (`xiaomi-cooldown-20260919.txt`, un campione/150 s): 38,5 °C cap 1824000 → 32,1 °C 2169600 → 31,9 °C 2630400 → 30,6 °C 2630400 stabile; meta' staccata dell'A/B con LFM 2.6B: prefill 87,8 tok/s (prompt_n 288, 3281 ms), decode 20,2 tok/s, prewarm restaurato 1826 e `n_common=1826` (2114−1826=288)

(same line: the plugged half of the A/B was deliberately NOT run — "la meta' attaccata va rifatta identica quando Marco riattacca (corrente e calore di ricarica sono confusi nella stessa direzione)" → the plugged/unplugged pair is still missing.)

### 2.2 Galaxy S23 / Adreno 740

**MEASURED (banked, restated + audit-verified 1:1).** `archived/docs/PLAN-10DAYS-2026-08-28.md:165-168`

> - Adreno 740 decision table (#18/#20): pure CPU wins **decode** on every model that fits in RAM (A/C 0.81 KEXP, 0.72 OLMoE); GPU value = **prefill** (S23 pp512 25→69 t/s at full offload, #31; 2.21× on 750, #16) and **cool mode** on KEXP (−19 % speed, −2.75 °C). Half offload (B) is always worst. Streaming regime: GPU moves nothing (#23).

`archived/docs/PLAN-10DAYS-2026-08-28.AUDIT.md:70-78` (verification)

> Clean (verified 1:1 against PLAN/ALIVE): A/C 0.81 KEXP (0.812, #18) and 0.72 OLMoE (0.724, #20); pp512 25→69 (#31/q44); 2.21× on 750 (#16); NPU decode 0.37–0.63× (q28e 0.37, q48 0.63); … cool-mode −19 %/−2.75 °C (§8 map); "B worst everywhere"; #23 "GPU moves nothing";

**NOT MEASURED — in-app GPU prefill on the Adreno 740.** `archived/GOVERNOR-DEVICE-PLAN-2026-09-audited.md:749`

> - Il prefill GPU sull'**S23/Adreno 740** non e' mai stato misurato in-app.

`archived/GOVERNOR-DEVICE-PLAN-2026-09-audited.md:523-524` ("Da misurare")

> **Da misurare:** il prefill GPU sul 740, dove pero' pesa il difetto f16 gia' noto (`adreno-f16-gemm-is-the-culprit`). Finche' non e' misurato, prefill GPU su questo telefono resta **non provato**, e va trattato come tale.

### 2.3 Jelly Star (CPU only)

**MEASURED (Jelly, 17/09, shipped LFM2.5-2.6B QAD-Q4_0, in-app).** `archived/PLAN-2026-09-full.md:2215`

> - LFM2.5-2.6B QAD-Q4_0 — `promptMs=65274.597 promptN=2153` → **30.3 ms/token**

**MEASURED (Jelly, 16-17/09, Qwen3.5-4B Q4_K_M, in-app).** `archived/PLAN-2026-09-full.md:2176` and `:2216`

>   promptN=2196` → **97 ms/token of prefill**, so a 4000-token conversation is over six minutes before the first token
> - Qwen3.5-4B Q4_K_M — `promptMs=214122 promptN=2196` → **97.5 ms/token**

**MEASURED (cross-device decode, one binary, 22/08) — the only committed cross-device number.** `archived/PLAN-2026-09-full.md:2218-2220`

> Do NOT read a cross-device prefill ratio out of tonight's figures: there is no in-app head-to-head on `lfm2.5-2.6b`. The committed cross-device number is decode on one binary, Jelly 2.962 vs S23 5.792 tok/s (`results/moe-stream-2026-08-22/README.md:25-26`).

**MEASURED (Jelly, cooled 36 °C, fresh chat, unplugged — the RETRACTION run; see 5.5).** `archived/PLAN-2026-09-full.md:2364-2366`

>   prewarm  {"op":"done","promptMs":95096.382,"promptN":2153}          → 44.2 ms/token
>   turn     KALSA_TELEMETRY promptMs=42395.5 prompt_n=518
>                            predictedMs=37582.6 tokensPredicted=165    → 4.39 tok/s decode

**MEASURED (Jelly): ms/token is not monotonic in prompt size.** `archived/PLAN-2026-09-full.md:2385-2387`

> Also note ms/token is NOT monotonic in prompt size: 44.2 at 2153 tokens, 81.8 at 518. Fixed per-call overhead dominates small prefills, so any per-token cost model needs both ends of the range, not a single slope.

### 2.4 NPU prefill ratios used as the governor's NPU prior (v73/v75/v79)

`archived/PLAN-2026-09-full.md:606-607`

> NPU prefill 3,5×/4,8×/7,2× su v73/v75/v79

(label: **MEASURED in the campaign cells, but NOT in-app** — see 8.2 "L'NPU non e' mai stata provata dentro l'app su nessun telefono"; the ratios themselves are quoted from cells outside these six files.)

---

## 3. Split / routing experiments and conclusions

**3.1 — Conclusion (documented rule, not a measurement): routing key must include model, device/driver, engine version, phase, context.**
`archived/PLAN-2026-09-full.md:203-205`

> Usare pochi profili misurati, con chiave:
>
> `modello/quant + dispositivo/driver + versione motore + fase + contesto`

**3.2 — "CPU decode" is a starting point, not a law per model and generation; the comparison reference CPUs were misconfigured in some early governor cells.**
`archived/PLAN-2026-09-full.md:215`

> CPU decode è un punto di partenza sostenuto da molte misure sui modelli attuali, non una legge per ogni modello e generazione. I confronti devono avere una CPU ben configurata: alcune vecchie celle del governor usavano un solo thread. Il [report 8B/830](…qdc-8elite-governor-8b/REPORT.md) esplicita questo limite.

**3.3 — "Hot phone → GPU" is not universal; each generation/model path needs its own correctness evidence.**
`archived/PLAN-2026-09-full.md:217`

> La scelta deve anche ammettere un vantaggio termico misurato quando la velocità immediata è inferiore. "Telefono caldo → GPU" non è universale: fit, modello e beneficio termico devono permetterlo. L'half-offload tronco GPU/esperti CPU resta escluso dalle ricette oggetto delle misure che ne mostrano il costo di ping-pong.

`archived/PLAN-2026-09-full.md:38`

> - The governor and corrected Adreno prefill path are measured, but each generation/model path still requires its own correctness evidence (ALIVE §9; diary 7/09).

**3.4 — Half-offload: prohibited by measurement (two independent statements).**
`archived/docs/PLAN-governor-in-app.md:7`

> … the kernel/evidence verdict says: "Half-offload is NEVER right" and explains the KEXP expert-placement consequence. … The governor design's separate prohibition is: "il mezzo-offload è l'arm B BANDITO dalle misure".

`archived/PLAN-2026-09-full.md:543`

> - Mai half-offload (ALIVE 140-145); full o niente, cool-mode solo con delta misurato.

**3.5 — The phase rule the current code violates (target policy, Xiaomi).**
`archived/GOVERNOR-DEVICE-PLAN-2026-09-audited.md:320-324`

> ## 2.1 La regola
> Non *"GPU se freddo, CPU se caldo"*. E':
> > **scegli, per ciascuna fase, il motore che minimizza il calore per token, sotto un pavimento di velocità accettabile per l'utente.**

`archived/GOVERNOR-DEVICE-PLAN-2026-09-audited.md:510-511`

> **Il punto che il codice attuale sbaglia:** quando scalda va spostato il **prefill**, non il decode, e va spostato **verso** la GPU, non via.

**3.6 — Sustained-vs-sprint conclusion for the decode phase (S23).**
`archived/GOVERNOR-DEVICE-PLAN-2026-09-audited.md:518`

> Qui la GPU perde lo scatto e vince la maratona. Per un'app di chat vera conta il sostenuto …

**3.7 — Prefill economics rule for cache reuse (new tokens, not conversation length).**
`archived/PLAN-2026-09-full.md:209-211`

> Per il prefill contare soprattutto **i token nuovi dopo il riuso della cache**, non la lunghezza totale della conversazione. La GPU è conveniente sul tempo se:
>
> `risparmio di prefill > trasferimento dello stato + eventuale inizializzazione + margine d'incertezza`

**3.8 — Owner decision 18/09: governor = CPU + GPU in M1, NPU prefill in M2 (the cooling effect is the point).**
`archived/PLAN-2026-09-full.md:603-607`

> **Decisione owner 18/09 sera — governor in M1: CPU + GPU, NPU in M2.** "GPU sul Galaxy funzionava: non andava più veloce ma raffreddava. Stessa cosa NPU per prefill. E' la cosa fondamentale che il governor debba fare." I dati lo sostengono (S23 12-13/08: decode GPU 38,5 °C in plateau vs CPU 42,3 in salita; QRD8650: +4,5 °C GPU vs +10,1 °C CPU nello stesso turno; NPU prefill 3,5×/4,8×/7,2× su v73/v75/v79) ma **l'app non fa nulla di tutto questo**

**3.9 — Two dead "cool mode" paths, corrected the same night (one path truly dead, one already working).**
`archived/PLAN-2026-09-full.md:608` (first claim) and `:620` (correction)

> e' deciso da nessuna parte (`thermalThresholds.ts` emette `preferGpuPath`, nessuno lo legge)…
> **(19/09 00:45 corresponsione)** "il cool-mode non e' deciso da nessuna parte" e' FALSO: sono due percorsi. (A) `preferGpuPath` (`thermalThresholds.ts:171,187`) e' morto davvero — zero consumatori di produzione — ma irrilevante. (B) il NATIVO decide gia' la rotta dalla temperatura con isteresi …

**3.10 — Vision adds a third phase (from the plan's own prior-art pointer; the cell itself is outside these files).**
`archived/docs/PLAN-governor-in-app.md:109` (risk list item 6)

> 6. Vision is CPU-only on Android today; govern text LLM contexts without accidentally moving the image path.

---

## 4. Thresholds and their origin

| Threshold | Origin | Evidence |
|---|---|---|
| admission ceiling 39.5 °C (= `k_warn_c − 0.5`) | q58 harness guard `--warn-tenths 400` | `GOVERNOR-DEVICE-PLAN…:195-196`, `:933` |
| `k_warn_c = 40.0`, `k_kill_c = 43.0` | q58 guard flags promoted to product | `GOVERNOR-DEVICE-PLAN…:195-196` |
| effective admission temps 34.35 / 36.25 / 37.6 °C | arithmetic of the table (inclusive) | `GOVERNOR-DEVICE-PLAN…:952` |
| battery floor 45 % (LOWBAT) | appears in two places with two different effects; **inverts the route** | `GOVERNOR-DEVICE-PLAN…:673-676` (below) |
| `critical_exit = 34.0 °C` < `warm_exit = 36.0` | inconsistent exit ladder; `k_kill_c` unreachable | `GOVERNOR-DEVICE-PLAN…:690-694` (below) |
| watchdog WARN 40 / KILL 43, poll 10 s | q56 harness | `PLAN-10DAYS…:147` |
| "WARN 40 °C" | **not in the banked record** (only poll 10 s, KILL 43; per-run abort 38.0) | `PLAN-10DAYS.AUDIT…:103-105` |
| cool-start gate ≤ 32 °C; fallback idle+3 °C hard max 36 °C | pre-committed contingency for a plugged S23 | `PLAN-10DAYS…:152-153` |
| owner stop line: thermal status ≥ 3 vs harness pause ≥ 5 / battery > 42 °C | **mismatch, open** | `PLAN-2026-09-full…:2635-2636` |
| kill at 43 °C / status 3 (T20C watchdog) | harness config | `PLAN-2026-09-full…:1599` (watchdog line) |

`archived/GOVERNOR-DEVICE-PLAN-2026-09-audited.md:673-676`

> ## 5.3 Il pavimento di batteria inverte la rotta
> `llama-governor-runtime.cpp:65-68`. `requested == CPU` produce `Admit`, che finisce su
> `prefill_route_ = GPU`. Il pavimento cambia una stringa di telemetria e nient'altro.

`archived/GOVERNOR-DEVICE-PLAN-2026-09-audited.md:690-694`

> ## 5.6 Da CRITICAL non si esce
> Il primo decode dopo essere entrati in CRITICAL latcha `failed`; il recupero a `llama-governor-policy.cpp:118-121` e' irraggiungibile. E `critical_exit = 34,0 °C` e' **piu' freddo** di `warm_exit = 36,0`: uscire dallo stato peggiore richiede un telefono piu' freddo che uscire da quello mite. `k_kill_c = 43,0` e' morto per costruzione, perche' `critical_enter <= 42,0` in entrambi i rami.

`archived/docs/PLAN-10DAYS-2026-08-28.AUDIT.md:103-105`

> **1.5 — NOTE — "WARN 40 °C" is not in the banked record** (only "poll 10 s, KILL 43 °C"; q56 health shows per-run abort 38.0). Harmless, but the guard config should be banked on day 1 with the plugged profile so "re-tune guard thresholds" has a reference.

`archived/PLAN-2026-09-full.md:2635-2636`

> - **La soglia termica: la regola dell'owner dice thermal status >= 3, l'harness e' configurato a `CAMPAIGN_THERMAL_PAUSE=5` e in pratica scatta sulla batteria > 42 °C.** Le due non coincidono.

---

## 5. REFUTED / retracted / unverifiable — never present as live

### 5.1 The 19/09 hostile audit of the governor device plan (7 refuted, 2 unverifiable, 6 citation drifts)

Header — **do not use that document without the appendix**: `archived/GOVERNOR-DEVICE-PLAN-2026-09-audited.md:3-6`

> > ## UNDER AUDIT — 19/09/2026 — 7 REFUTED, 2 unverifiable, 6 citation drifts
> > **Do not use this document as a source without first reading [Appendix A](…).**

Summary rows `:37-44`:

> | 1 | REFUTED | la "Smentita a verbale" sul decode `0,992` sarebbe essa stessa l'errore: il numero sarebbe proprio dello Xiaomi 14, non della QRD8650 … |
> | 2 | REFUTED | lo stato Mali della Parte 3.3 e' superato: i gate 3 e 4 sono gia' girati, l'ipotesi "due difetti nominati' e' stata testata e smentita … |
> | 3 | REFUTED | il `+1,3 °C` dell'NPU e' la salita dell'intera cella (tre rep HTP +0,4, una rep CPU +0,9), non dell'NPU |
> | 4 | REFUTED | il censimento `Thermal Status 0 in ogni campione` e' falso: 28 campioni leggono `3`, uno dentro product-suite |
> | 5 | REFUTED | i delta termici 4B citano l'artefatto sbagliato — e quello citato e' marcato `CONTAMINATED` |
> | 6 | REFUTED | il rerun del 18/08 non ha "10 ripetizioni per verso" sul decode: sono due coppie interlacciate |
> | 7 | REFUTED (esterno) | Mali-G57 MC2 e' confermato, ma `1100 MHz` non e' la frequenza del G99 |
> | — | NON VERIFICABILI | `cpu7 a 1824000` e la baseline `gpubusy ~7,5%` non esistono in nessun artefatto: compaiono **solo in questo piano** |

**REFUTED 1 — the decode-parity "0.992" IS our Xiaomi 14, not the QRD8650 board.** `:873-884`

> ### 1. REFUTED — the "Smentita a verbale" is itself the third error. The 0.992 **is** our phone.
> `scratchpad/agents/q16-xiaomi/REPORT.md:336` — "d1 LFM A/C N=5 is the bankable 750 number: tg median A 24.155 / C 24.338, **A/C = 0.992**. pp A/C = 2.477." … Consequence: the sentence written "a verbale" to stop this error repeating is the error

**REFUTED 2 — Mali lane: gates 3 and 4 already ran, "two named defects" tested and failed, owner parked G57.** `:886-897` (quotes `q26b-mali-probe/REPORT.md` "Gate 4 — GPU ≤ CPU on green paths; Mali-tuned kernels required" and `docs/ALIVE.md:441` "OWNER DECISION 22/08: PARKED on G57-class").

**REFUTED 4 — thermalservice census.** `:905-910`

> ### 4. REFUTED — the thermal-status census is wrong: 28 samples read `3`, one of them in product-suite.
> … `1263× "Thermal Status: 0"`, **`28× "Thermal Status: 3"`, `11× "1"`, `9× "2"`** … the archive-wide version does not — and the plan's own §3.3 (`Thermal Status 3 in 9 minuti`) contradicts "in ogni campione" one page later.

**REFUTED 6 — decode rerun n: two interleaved pairs, not 10 reps per direction (prefill 3,18× stands).** `:919-924`

> ### 6. REFUTED (descriptor inflates n) — the 18/08 rerun's decode evidence.
> … Decode is headed "**### Decode (not disputed; 2 interleaved pairs)**": CPU `26.968 / 26.039` (mean 26.5035), GPU `17.413 / 17.514` (mean 17.4635). The 3.18× is correct (186.567/58.676 = 3.1796) …

**UNVERIFIABLE (do not cite):** `archived/GOVERNOR-DEVICE-PLAN-2026-09-audited.md:1041-1046`

> | claim | what would settle it |
> | `cpu7 gira a 1824000 su 3302400 — il 55%` (§1.1). `grep -rn 1824000` over the whole repo returns **only the plan**. … |
> | `gpubusy` baseline `~7,5%` a schermo acceso e app ferma (§6.1). Appears **only in the plan**; the corpus's only archived gpubusy value is `49`, already audit-flagged unevidenced … |
> | `un decode che parte a 17,5 tok/s e scende a 14,8` (§3.2) … |
> | Mali-G57 Vulkan `0,79/0,86` vs `2,44/2,29`; G99 retention `91%/95%/99,4-99,5%`; A55/A76 `1,05/4,41/6,81/5,26` and `18,0→13,7` | … none of them are in this repo, and I could not reproduce any of the four sets externally |

Closing verdict `:1054`:

> **No** — the shape (Rule 1/2/3, one selector, matrix-as-data, probes that fail closed) is sound and worth building from, but not one of the quantitative inputs it feeds to that shape is both sourced and measured above the noise floor: the ranking key in §2.1/2.3 is a ΔT difference smaller than `dumpsys`'s own quantisation …

Also `:50` (design attack): the ordering key is "un ΔT piu' piccolo della quantizzazione dello strumento".

**Note on the same document's CONFIRMED items** `:933-957` — "8-11 | CONFIRMED | tutte le altre citazioni di codice, l'intera aritmetica della Parte C, le soglie di ammissione al bordo, la cella S23" (`:46` of the header table).

### 5.2 The 10-days plan audit (VERDICT REVISE) — items that were wrong as first written

`archived/docs/PLAN-10DAYS-2026-08-28.AUDIT.md:1.2` (`:85-87`)

> **1.2 — MINOR — "the f16/bf16 batched fix seen on 750 (#16)" (§4 candidate list).** No fix is banked; #16 banks only the DEFECT (20 deterministic f16/bf16 batched FAILs on E031.45).

`archived/docs/PLAN-10DAYS-2026-08-28.AUDIT.md:90-92` (1.3 q59 erratum unverified at the time), `:96-101` (1.4 storage: the "21 GB free" figure quotes none of the banked numbers; latest banked **8.2 GB**, day-1 ENOSPC risk), `:80-84` (1.1 R3 was characterized on 10 chunks, not certified).

`archived/docs/PLAN-10DAYS-2026-08-28.AUDIT.md:103` — "WARN 40 °C" not banked (see §4 table above).

Plan-side corrections already applied in the v2 text: `archived/docs/PLAN-10DAYS-2026-08-28.md:4-6`

> **Status: v2 after DeepSeek audit (`…AUDIT.md`, VERDICT REVISE — all items applied below).**

### 5.3 The compact-rewrite audit: no facts were lost, all 14 checked figures sourced

`archived/docs/repo-audit-2026-08-28/PLAN-compact-rewrite-audit-2026-09-04.md:22`, `:44` and `:57`

> **NO LOSSES.**
> … All 14 checked figures: **14/14 sourced, 0 wrong, 0 unsourced.**
> … VERDICT: ACCEPT

### 5.4 4B thermal deltas — wrong artifact + contaminated source (see 1.1)

`archived/GOVERNOR-DEVICE-PLAN-2026-09-audited.md:912-917` — REFUTED as cited; the values are real but come from `results/xiaomi_ab/task_a_4b_clean/battery_notes.txt` (run started `2026-08-13T05:32:25`), while the cited file's 4B block is marked `CONTAMINATED … measured while the owner was using the phone`.

### 5.5 Retraction in the September plan: "the catalogue should not offer this pairing"

`archived/PLAN-2026-09-full.md:2357` (the claim) and `:2359-2360` (the retraction)

>   thinking. The catalogue should not offer this pairing.
> **RETRACTION, measured 40 minutes later on the same phone.** The sentence above — "the catalogue should not offer this pairing" — was wrong, and the test that produced it was confounded.

Reason (`:2368-2372`): in the failing run the prewarm had skipped (`kv_holds_chat`), so the turn prefilled 2666 tokens cold against the blind 180 s floor; in the passing run the prewarm paid 2153 of them. Same device, same model, opposite outcome.

### 5.6 Retraction: "the recurrent half of LFM2 cannot evict a prefix"

`archived/PLAN-2026-09-full.md:2601-2604`

> **RITRATTATA: "la meta' ricorrente di LFM2 non puo' evincere un prefisso".**
> E' la ragione scritta in `8a2579c` e `4004117` per buttare tutta la KV a ogni slide … **Vale per Mamba e RWKV. Non vale per LFM2.** Per tre settimane abbiamo applicato al nostro modello una proprieta' di un'altra famiglia.

### 5.7 Corrections that change a governor-relevant claim

- `archived/PLAN-2026-09-full.md:2563` — **the governor has never been switched on on any phone**:
  > - **Il governor non e' mai stato acceso su un telefono.** Ora l'interruttore esiste; l'evidenza no.
- `archived/PLAN-2026-09-full.md:485` — presence ≠ enablement:
  > `GPU_PREFILL_CORRECT.V75 = true` ammette V75 nella tabella, ma **non accende da solo il governor su un'installazione pulita**. `readGovernorEnabled()` … restituisce false se il valore non è impostato.
- `archived/GOVERNOR-DEVICE-PLAN-2026-09-audited.md:142` — the S23 governor is off **by table, not by measurement**:
  > (`V73: false`, commento: *"never measured in-app"*), e sullo Xiaomi e' acceso senza che nulla sia stato verificato a runtime.
- `archived/PLAN-2026-09-full.md:2235-2237` — "the prefill EMA is read by `documentChatStrategy` alone" was **false**: > three consumers, two of which can ABORT work — `documentChatStrategy.ts:35` … `LlamaService.ts:3671` … `LlamaService.ts:5046` … The accurate claim is narrower: the EMA is never PERSISTED, so it is empty at first launch and unavailable to catalogue admission.
- `archived/GOVERNOR-DEVICE-PLAN-2026-09-audited.md:7-11` — parking:
  > **Park status: open owner decision.** This document records the 19/09 owner order to set the governor aside. A memory dated 20/09 claims the condition for that order has fallen and the work can resume, but no document on disk records an un-park.
  and `:22`: *"metti da parte il governor perche senza un kalsallama funzionante non ha senso"*.

---

## 6. Energy / battery per token, and why the battery axis is untrusted

**6.1 — MEASURED (S23 / Adreno 740): GPU arm cooler but ~30 % more battery per token; conclusion explicitly not transferable to newer device classes.**
`archived/docs/PLAN-governor-in-app.md:70`

> Do not encode "GPU is greener" as a rule: the S23/Adreno 740 GPU arm was cooler but used 30% more battery per token, and the evidence explicitly does not transfer that conclusion to the newer device class. Battery is an input to the governor, not a performance promise. `kalsa/docs/HARNESS_FINDINGS.md:3110-3140`.

**6.2 — Energy tooling state (18/09): the charge-counter instrument was withdrawn.**
`archived/PLAN-2026-09-full.md:697-700`

> misura DONE sul Jelly, core placement CHIUSO NEGATIVO, asse motore CPU/GPU/NPU APERTO, **S23 bloccato dalla shell** (Samsung nega corrente/tensione a adb: sull'S23 i joule si leggono solo da dentro l'app), joule assoluti relativi alla sessione, strumento charge-counter RITIRATO (5,3× di dispersione a lavoro identico).

**6.3 — MEASURED energy-framework variance (16/09): ABBA + thermal gate + per-session idle floor required.**
`archived/PLAN-2026-09-full.md:2049-2053`

> Read future measurements with ABBA ordering, a thermal gate, and a per-session idle floor: cold-to-warm decode time changed **+26–52%**, joules/token **−6 to +7%**, and between-run energy spread was **2-7%**, not 0.68%. Android ggml affinity controls were inert; only thread count was effective, while external `taskset` worked. S23 shell fuel-gauge reads are permission-denied/empty; future high-rate energy work needs app-side `BatteryManager` coordination.

**6.4 — Battery drain rates.**
- S23 unplugged T20C: `archived/PLAN-2026-09-full.md:2451-2453` — "The run went 91% → 80% in 20 minutes for two completed turns plus a partial — about **3.7 points per turn**."
- S23 with two DSP daemons burning CPU: `archived/PLAN-2026-09-full.md:1187-1189` — "TIME+ 1997/2004 min (33 h di CPU a testa) … Effetti: AP 51,8 °C e status 2 a riposo, batteria 100% → 70% in 2 ore a schermo spento".
- Jelly under load: `archived/PLAN-2026-09-full.md:1603` — "~40 punti/h sotto carico"; idle awake "~5,1 punti/h sveglio a riposo" (`:1599`).
- Motivating incident: `archived/PLAN-2026-09-full.md:704` — "Incidente motivante: S23 10 %→1 % in 15 min col caricatore debole, 29→38 °C, spento."
- 10-days/measurement rule: `PLAN-2026-09-full.md:396-398` — "Le prove energetiche finali avvengono senza ricarica e senza registrazione video continua … riportare l'incertezza e non pubblicare joule/token inventati o autonomie estrapolate da pochi minuti."

---

## 7. Measurement hazards recorded against every number on a given phone

- **S23: two DSP daemons at 100 % of a core, with the app NOT running.** `archived/PLAN-2026-09-full.md:1185-1189`:
  > Telefono scollegato, Dozing, `pidof com.kalsa` vuoto: `cdsprpcd` (pid 2273) e `adsprpcd` (pid 2272) a 99,6% CPU ciascuno … Effetti: AP 51,8 °C e status 2 a riposo … spiega il pavimento a 47 °C sul cavo, i tetti di frequenza "load-driven" del decode (il carico erano loro)
  and `:1469-1470`:
  > ogni tok/s o numero termico preso sull'S23 da ora porta un fondo di ~14-16% di un core e va scritto accanto al numero
  (Earlier plan text said `adsprpcd`/`cdsprpcd` "girano al 100% di un core senza l'app, con 33 h di CPU accumulate" — `GOVERNOR-DEVICE-PLAN…:526-527`; the audit could not reproduce it from artifacts at the time: `:1046`.)
- **Xiaomi: OS thermal status is blind; the only real signal is `scaling_max_freq`.** `GOVERNOR-DEVICE-PLAN…:221-227`:
  > Sullo Xiaomi `scaling_max_freq` e' **l'unico posto dove lo strozzamento si vede**. `dumpsys thermalservice` riporta `Thermal Status 0` in *ogni* campione dell'archivio … Nel frattempo cpu7 gira a **1824000** su **3302400** di hw max — il 55%.
  (the "1824000" figure itself is UNVERIFIABLE — see 5.1; but the in-app decode slowdown with an unchanged thermal status is MEASURED: `PLAN-2026-09-full.md:1573` "Decode 1,11 → 0,32 tok/s con `cpu7 scaling_max` 1824000→1708800 (hw_max 3302400) e Thermal Status 0: sullo Xiaomi lo strumento e' `scaling_max_freq`, ogni tok/s lo porta accanto.")
- **`gpubusy` is global, not per-process; baseline 7,5 % unverified.** `GOVERNOR-DEVICE-PLAN…:708` and audit `:1041`.
- **Never benchmark while charging; plugged/unplugged pairs do not exist yet.** `GOVERNOR-DEVICE-PLAN…:728` "3. **Xiaomi, coppia attaccato/staccato a parita' di lavoro.** Mai fatta su nessun telefono."
- **In-app vs CLI:** "Nessuna misura GPU in-app sullo Xiaomi, ne' prefill ne' decode: tutti i numeri GPU sono da `llama-bench` a riga di comando" (`GOVERNOR-DEVICE-PLAN…:740-741`).
- **Batteryless QDC boards have no battery temperature** → bench thermo source required, else no governor on QDC: `docs/PLAN-governor-in-app.md:66-68`:
  > **S5 therefore needs a declared bench-only thermo source, or it cannot exercise governor mode on QDC at all** … The bench override `kalsa.bench.thermo` … every `KALSA_GOVERNOR` line carries `thermo_source: "bench-skin"` so a QDC number can never be mistaken for a BatteryManager one.
- **Plugged S23 idle temperature may be 35–41 °C, which would invalidate every A/B cell** (ESTIMATED, external, NOT VERIFIED): `PLAN-10DAYS…:152` and `PLAN-10DAYS.AUDIT…:3.1` (`:155-163`):
  > A plugged S23 idling at 32–35 °C (plausible: wireless-charging reports of 40–41 °C battery … — NOT VERIFIED as a distribution) invalidates every A/B cell in Phases 3–4.

---

## 8. Planned governor steps that were never done, dead ends, and why

### 8.1 The device-plan measurement cells (all still owed as of 19/09)

`archived/GOVERNOR-DEVICE-PLAN-2026-09-audited.md:718-730`

> ## 6.2 Le celle, in ordine
> 1. **Xiaomi, sonda governor con l'APK riparato.** Obiettivo: *il governor si aggancia, si' o no*. …
> 2. **Xiaomi, ΔT per cella isolata** a 128/512/1024/2048 token, per motore, partendo ogni volta dalla stessa temperatura di riposo. E' la misura che oggi manca e che serve a sostituire la costante S23.
> 3. **Xiaomi, coppia attaccato/staccato a parita' di lavoro.** Mai fatta su nessun telefono.
> 4. **S23, prefill GPU sul 740**, col fondo `adsprpcd` dichiarato accanto.
> 5. **Jelly**, solo dopo la ricerca online …

Cell 1 was attempted and **failed**: `archived/PLAN-2026-09-full.md:1578`

> - **M1 (3) — sonda governor sullo Xiaomi (V75, LFM2.5-2.6B, chiave "1"): SIGABRT nel load, e la causa e' un kernel OpenCL del fork che NON COMPILA.** … `KALSA_NATIVE error lm_ggml_opencl: kernel compile error (err=-11)` … `get_scale_min_k4(j, sc, &sv, &mn)` … `build_program_from_source_ex` (`ggml-opencl.cpp:1295-1299`) con `fatal` fa **`exit(1)`** … **in questo APK ogni load con governor (= init del backend OpenCL) muore, su ogni telefono e ogni quant** … M1 (3) non e' dimostrabile stanotte su nessun telefono

### 8.2 The "empty boxes" list (things the plan admits are missing)

`archived/GOVERNOR-DEVICE-PLAN-2026-09-audited.md:738-751`

> # Parte 7 — Le caselle vuote, dette prima di riempire
> - **Nessuna misura GPU in-app sullo Xiaomi** … fino al 19/09 abortiva.
> - **Nessuna coppia attaccato/staccato a parita' di lavoro**, su nessun telefono.
> - **Nessun ΔT per cella isolata** a 128/512/1024/2048 sullo Xiaomi: le celle del 18/08 hanno un solo campione di bordo e la sua posizione nella cella non e' documentata.
> - Non sappiamo se il cap a **2630400** sullo Xiaomi sia il riposo del vendor o ancora raffreddamento.
> - Il **"GPU prefill 5,77×"** … conteso dal rerun … **3,18×**. Entrambi misurati.
> - Il prefill GPU sull'**S23/Adreno 740** non e' mai stato misurato in-app.
> - L'**NPU** non e' mai stata provata dentro l'app su nessun telefono.

### 8.3 Defects that must be fixed before any measurement (5.1–5.6), all CONFIRMED by audit

`archived/GOVERNOR-DEVICE-PLAN-2026-09-audited.md:654-694`

> # Parte 5 — I difetti da riparare prima di misurare
> Owner, 19/09: *"testare un governor rotto non ha senso"*.
> ## 5.1 Il ripiego su CPU sopra 37,6 °C … la tabella rifiuta per calore e il ripiego e' il motore piu' caldo, non spezzato.
> ## 5.2 Il caricabatterie avvelena il governor … `plugged = true` ⟹ profilo `Invalid` ⟹ `Abort` ⟹ `failed = true`, che e' appiccicoso …
> ## 5.3 Il pavimento di batteria inverte la rotta …
> ## 5.4 Corsie irraggiungibili … `select_decode` richiede **tredici** clausole simultanee … La corsia "scalda → sposto il decode su GPU per raffreddare" **non e' raggiungibile su nessun telefono**. Stessa cosa per `GPU_COOLMODE` nel prefill … e per la corsia NPU (il loader lancia).
> ## 5.5 Un prompt di 129, 257 o 385 token tronca la risposta …
> ## 5.6 Da CRITICAL non si esce …

NPU lane is closed by construction: `:289-291`

> L'NPU e' quindi **fuori dal governor per costruzione**, pur essendo — sullo Xiaomi — il motore di prefill piu' veloce e piu' freddo che abbiamo misurato (3,19× la CPU, ΔT +1,3 °C).

(the "ΔT +1,3 °C" in that same sentence is REFUTED — 1.2; the speed ratio is not.)

### 8.4 Work order that was never executed (Parte 9), and the re-verification that is still owed

`archived/GOVERNOR-DEVICE-PLAN-2026-09-audited.md:770-782` — nine steps: fix 5.1/5.2/5.3 → real GPU probe → runtime proof on the Xiaomi → ΔT per cell on the Xiaomi → the other three probes + capability record → per-device calibration → the shape refactor (Parte 2b) → 5.4/5.5/5.6 absorbed by the refactor → S23 and Jelly.

`archived/GOVERNOR-DEVICE-PLAN-2026-09-audited.md:14-18`

> > **Pending re-verification.** The audit's findings below have not been re-read on the artefacts. That work is a separate cell; its record goes to `scratchpad/agents/governor-audit-recheck/REPORT.md`. Until that report exists, do not cite a number from this document as established.

### 8.5 10-days plan phases that did not run as scoped

- **Phase 4 crossover cell (the router cell) was both under-budgeted and on the wrong model.** `PLAN-10DAYS.AUDIT…:6.1` (`:248-257`): "the crossover is measured on the WRONG model … LFM2.5-KEXP is **quality-rejected from the product catalog**"; grid estimate `:251` "the analytic crossover for pp512 is g* ≈ 900–1000 tokens — far outside g ∈ {64, 256}".
- **Phase 4 cannot fit the device budget (BLOCKER).** `PLAN-10DAYS.AUDIT…:8.1` (`:331-338`): "Phase 4(a) full grid = … **13–20 h** … Total ≈ 16–23 h vs 3–6 h."
- **The profiler for OpenCL kernels does not exist upstream.** `PLAN-10DAYS.AUDIT…:5.1` (`:217-224`): "§5's first step silently becomes 'write a profiler', and Phase 3 loses a day."
- **HVX K-quant chapter was made conditional and then frozen** by pre-delegated GO rules: `PLAN-10DAYS…:266-275` ("Conditional chapter — HVX … ONLY AFTER Phase 0", gates (1) q62 ✓ (2) v79 datum (3) q63 FAILS (4) owner GO), plus audit finding 7.1 (`:281`) adding the q63 gate.
- **QDC kill-date rule** `PLAN-10DAYS…:187`: "if no SM8750 interactive session can be obtained by **day 4**, Phase 0 is closed as 'not obtained' … and 28c stays frozen."
- **Storage ledger/drop-chain requirement** (day-1 ENOSPC risk): `PLAN-10DAYS.AUDIT…:1.4`.
- **Per-pick cap ≤3 OpenCL picks; ggml-cpu picks must be gated host-side first** (`PLAN-10DAYS.AUDIT…:180` (4.1), `:202` (4.3)).

### 8.6 Governor-in-app steps S1–S7 (plan; evidence of completion is outside these six files)

`archived/docs/PLAN-governor-in-app.md:88-104` — S1 rebase/build, S2 two-context session, S3 JSI params + thermo, S4 LlamaService wiring, **S5 QDC A/B cell** (acceptance: token-ID equality first, then `TTFT <= CPU/3`, `decode >= CPU`, zero lmkd kills; `:96`), S6 fit gate with `800 MiB + 1.05×offloaded` GPU term, S7 thermal loop.
`:96` also records the only TTFT figure available as prior art:

> it reports roughly 10x TTFT improvement in one QDC governor cell but is not this llama.rn integration

Assumptions stated at `archived/docs/PLAN-governor-in-app.md:27`: "**Assumption:** initially disable parallel slots and speculative/MTP decode until their active-context audit passes".
Constraint at `:70` (battery, see 6.1) and RAM arithmetic at `:81-83` (two-context lower bound `3,538.1 MiB`, upper `4,034.1 MiB`, `800 MiB + 1.05*1,520.06 = 2,396.1 MiB` reserve).

### 8.7 Dead ends recorded in the September plan

- **Governor mode disables session save/restore** (why two halves of the plan cannot be on at once): `archived/PLAN-2026-09-full.md:3054-3058`:
  > **Governor e persistenza di sessione si escludono.** `jsi/JSISession.h:48-50` e `:173-175` lanciano su save e load col governor acceso … Oggi non morde (governor OFF di default e sulla fascia high), ma le due meta' del piano termico non possono stare accese insieme.
- **Thermal-pause + idle-dispose loop makes cooling recompute** (`:2694-2699`): "`FOREGROUND_IDLE_DISPOSE_MS = 180_000`, mentre i raffreddamenti termici durano **300–360 s**. Quindi ogni pausa garantisce uno scarico … prewarm a **71,9 s / 40,4 s / 40,3 s** per gli stessi 1832 token — **152 s di prewarm in 30 minuti di run**."
- **Core placement (decode on small cores) was REFUTED in normal operation**: `archived/PLAN-2026-09-full.md:2624-2626`:
  > Il pilota del 16/09 ha chiuso il core placement in esercizio normale (decode sugli A55 = 5,0–5,3x, +402% contro una regola che tollera +25%). Quella refutazione **non** copre il caso di oggi: durante una pausa termica il budget di latenza e' infinito.
  and `:2628-2629` (owner correction): "un mezzo tentativo su questo e' gia' stato fatto. Non e' 'mai misurato' come avevo scritto. Prima di riproporlo, trovare quel tentativo e leggere cosa faceva e perche' si e' fermato."
- **Decision "KV over Governor" (17/09)** with the reasoning recorded: `archived/PLAN-2026-09-full.md:2726-2728`:
  > Scelta presa e motivata: **KV e non Governor**, perche' le leve del Governor sono gia' refutate dalle nostre misure (core placement +402%, decode NPU, Adreno f16) mentre il prefill e' il **53%** del tempo di calcolo …

---

## 9. Open questions left in these documents (for the governor specifically)

`archived/GOVERNOR-DEVICE-PLAN-2026-09-audited.md:754-762`

> # Parte 8 — Domande aperte per l'owner
> 1. **Il pavimento di velocita'.** Sotto quanti tok/s in decode una risposta diventa inaccettabile? …
> 2. **Cosa vede l'utente quando il telefono e' troppo caldo.** Oggi: un'eccezione. … e' una scelta di prodotto.
> 3. **La calibrazione (Parte 4):** tabella spedita, primo avvio, o apprendimento continuo.
> 4. **L'NPU rientra in M1 o resta in M2?** …
> 5. **Il Jelly e' un target o un caso limite?** …

Calibration options and their prices: `:627-645` (shipped table / first-run calibration / continuous learning; recommendation "(c) con (a) come valore iniziale").

Owner-facing decisions recorded in the September plan (`archived/PLAN-2026-09-full.md:2633-2641`):

> - La soglia di ammissione del catalogo (rinviata dall'owner il 17/09).
> - **La soglia termica: … Le due non coincidono.**
> - `WINDOW_RESERVE_TOKENS` = 2048 contro un budget di risposta di 512 …
> - `n_ctx` 8192 → 16384: **~+52 MiB** (KV a **6656 byte/token** …). ⚠️ La prima stesura diceva **+239 MB** a 29,2 KB/token: sbagliata …
> - **Se un test di accettazione da 20 turni a batteria sia il test giusto**, dato il budget termico.

Plus `:2561`:

> - **q4_K non e' MAI stato misurato**, ne' in fedelta' ne' in costo, pur essendo la quantizzazione spedita in fascia high.

And the admission-threshold shape question that the audit says must replace the current key (`GOVERNOR-DEVICE-PLAN…:1054`, closing line): rank engines by "°C above the current idle baseline per *chunk*, keyed on `(engine, phase, chunk-size class, model class, plug state)`, with forced exploration and a dwell/hysteresis ratchet".

---

## 10. One-line answers to the questions asked

1. **Where the deltas came from:** commit `c1bb48d32`, sweep `scratchpad/agents/q58-s23-npu-spike-sweep`, `REPORT.md:29/31/33/35` = CPU mean ΔT 1.900/3.250/3.250/5.150; `RUN_LOG.md:5` device = Galaxy S23 / Hexagon v73 (`GOVERNOR-DEVICE-PLAN…:185-193`, `:944`).
2. **Were they measured?** Yes — but as **whole-process ΔT including the model mmap, n=2 per cell, in an NPU spike sweep**, then reused as the CPU-chunk price in a policy with **no device branch**, applied to V75/V79 as well (`:189-193`).
3. **Which backend?** The measurement arm was **NPU (v73)**; the constant prices the **CPU** alternative (`k_cpu_delta_c` in `now_c + Δ > k_limit_c`, `:945`); the GPU chunk itself has **no measured ΔT anywhere in these documents**.
4. **Ceiling 39.5 °C** = q58 harness `--warn-tenths 400` minus 0.5 (`:195-196`, `:933`); effective admission limits 34.35/36.25/37.6 °C inclusive, and 512/1024 share one ΔT so only three distinct steps exist (`:952-953`).
5. **Never measured anywhere in these six files:** in-app GPU prefill on Adreno 740, any in-app NPU run, any plugged-vs-unplugged pair at equal work, any isolated ΔT-per-cell on the Xiaomi, any Mali tok/s, any 8 Elite figure.
