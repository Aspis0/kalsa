# ALIVE-2026-09-full.md — mined for the Kalsa governor

Source: `/Users/marco/Projects/kalsa-moe-experiments/archived/ALIVE-2026-09-full.md` (7773 lines, read in full).
All `file:line` references below point at that file. Quotes are verbatim (source language preserved).

Labels:
- **MEASURED** = a number produced by a run, with device / date / plugged-state / thermal status noted where the source states them.
- **ESTIMATED** = derived, extrapolated, prior, single-replica, or pre-written-but-unverified.
- **REFUTED** = later measurement or audit invalidated it. Never present as live.

---

## 1. BACKEND SPEED — PREFILL

### 1.1 Per device × backend (CLI, llama-bench class)

- **MEASURED (Xiaomi 14 / Adreno 750-class, 2026-08-12, unplugged 100%)** — `archived/ALIVE-2026-09-full.md:602-604`:
  > "Xiaomi 14 staccato, 100%: CPU tg 16.15 / GPU 7.07 (0.44×, muro A7X identico\n  al 740); CPU pp 31.5 / **GPU pp 181.7 (5.77×!)** — sul 740 era 2.2×."
  Later weakened: `:409` — "the historical 5.77× was a weak CPU baseline" (honest ratio 1.43× CPU-repack / 2.62× CPU -nr). **The 5.77× is REFUTED as a ratio; the 181.7 t/s GPU absolute stands.** (K-G 1.29× → honest 1.12 % at `:328`.)

- **MEASURED (Xiaomi 14 / Adreno 750, #16 + phase d, 22/08, audit BANK)** — `:402-404` and `:413`:
  > "exploratory A/B/C (N=3, tg128, cells in Doze) on the same KEXP gguf gives decode **A 24.47 ≈ C 24.28** (A/C 1.008 vs 0.812 on S23) and **prefill A = 2.21× C**."
  > "**decode A/C 0.992, prefill 2.477**" (N=5 clean protocol, 10/10 cells, all Awake).

- **MEASURED (QRD8650 / Adreno 750, 3/09, live-HAL gate ≤44 °C status 0, plugged QDC)** — `:475`:
  > "Ship 2.6B QAD-Q4_0: **GPU -fa 0 pp512 284.2±0.1 / tg128 23.4±0.0** (1.87× il 732, ~17× la CPU di questa build) vs CPU pure 16.3/11.6"
  Re-run `:478`: "GPU pp512 **291.11±0.56** (+2.4% vs 284.18) / tg128 **23.02±0.04**" → "i numeri 750 di #55 CONFERMATI come costanti router (pp 284-291, tg 23.0-23.4)".

- **MEASURED (QRD7675 / Adreno 732, 3/09)** — `:473`:
  > "**GPU -ngl 99 -fa 0 pp512 151.8±1.1 t/s, tg128 17.3±0.0** vs CPU pure (-dev none) 13.8/10.3"
  Caveat banked in same row: "CPU number is build-suspect (no -march flags in kit…)" → the CPU side of that ratio was replaced by `:477`.

- **MEASURED (QRD8635 / Adreno 735, 3/09)** — `:476`:
  > "Ship 2.6B QAD-Q4_0: **GPU pp512 154.8±1.3 / tg128 16.5±0.0** vs CPU pure 14.9/11.3 … **Mappa GPU del giorno (ship Q4_0, -fa 0): 732 → 151.8 | 735 → 154.8 | 750 → 284.2**"

- **MEASURED (HDK8550 / Adreno 740, 3/09, S23-class board, ABBA, per-arm thermal gate)** — `:474`:
  > "base pp 84.09/tg 16.04 vs picks pp 84.64/tg 16.02 → **Δ +0.65%/−0.12%, dentro ±3%**" (LFM2.5-2.6B Q4_K_M).

- **MEASURED / CPU numbers RETRACTED then replaced (3/09, kit `GGML_CPU_ARM_ARCH=armv8.7-a+dotprod+i8mm+fp16`, -t 4, taskset top-4)** — `:477`:
  > "**7675: pp 95.2/tg 20.0 · 8635: pp 97.1/tg 20.5 · 8650: pp 99.0±12.8/tg 28.6** — la build zoppa del mattino sottostimava ×6.1-6.9 il prefill (G3 refutata ovunque, caveat saldato, vecchi numeri CPU RITIRATI)."

- **MEASURED (QRD8750 / 8 Elite, 30/08, Marco-KEXP 17.25B Q4_K 5.94 GiB, ABBA r=3, live-HAL gate ≤44 °C)** — `:460`:
  > "Block medians: A(GPU ngl99) pp512 **274.5** tg128 **48.9**; C(CPU ngl0) pp512 **107.4** tg128 **60.7**. Pre-written rule (block medians, >=5% win): **GPU prefill 2.56x, CPU decode 1.24x**"

- **MEASURED (QRD8750 / 8 Elite, 28/08, OLMoE Q4_K_M, mid-ramp, HAL CPU 39.6→53.8 °C, status 0→1)** — `:457`:
  > "Speed OLMoE Q4_K_M: tg128 **59.1 t/s** (-t8…); pp512 93.0; -t6 52.5/75.5."

- **MEASURED (dense 750-class GPU prefill vs prompt length, 08/2026)** — `:301-306`:
  > "The corrected pp128 ratio is **3.18×** (orderings 3.10×/3.27×); prompt ratios at pp 128/512/1024/2048 are 2B **3.18×/3.95×/5.35×/6.69×** and 4B **4.17×/5.70×/6.95×/6.46×**. At ~1.4k prompt: 2B **~6.5 s vs ~33 s**; 4B **~16 s vs ~108 s**. CPU outliers were 29.5 and 18.8 t/s at 38–40 °C; GPU held 216.7 and 212.2. `-fa on` crashes (exit 134); decode remains **0.66×** (17.5 vs 26.5)."

- **MEASURED (S23 / Adreno 740, GPU prefill dead)** — `:184`:
  > "Dense: GPU decode always loses (0.41× on 740); GPU prefill wins big only on 750-class (3.2–7×, §2), not on 740 (K-G dead)."
  `:328`: "K-G's 1.29× was a 740 cold-outlier artifact, honest 1.12 %".

### 1.2 NPU / HTP prefill

- **MEASURED (S23 / Hexagon v73, Qwen3.5-4B-Q4_0, pp512 nseq=1, unplugged, execute-op proof)** — `:446`:
  > "HTP median 84.0 vs CPU 24.1 tok/s ≈ 3.5× (avg 3.40×…)"

- **MEASURED (Xiaomi 14 / Hexagon v75, 23/08, houji unplugged 100%, audit BANK-w-corr)** — `:446`:
  > "**BANKABLE PREFILL CELL EXECUTED 23/08 (houji unplugged 100%, …): pp512 HTP median 165.4 t/s (range 150-170, 3 reps) vs same-harness CPU 51.9 = 3.19x (range 2.89-3.28x), 448 hmx-tiled execute-ops proof. v73→v75: ~2x absolute HTP (84→165)**"

- **MEASURED (Xiaomi / v75, OLMoE all-Q4_0 experts on NPU)** — `:448`:
  > "**v75/houji: SURVIVES — pp512 686 t/s vs CPU 142 = 4.82×, the best NPU ratio of the campaign** (dense-hybrid 4B was 3.19×); tg 0.63× (decode stays CPU, consistent everywhere)."
  Correctness later certified `:448` (q55): "OLMoE 32-chunk PPL HTP0 8.9214 vs CPU 8.9233 (r −0.02 %)".

- **MEASURED (8 Elite / Hexagon v79, 31/08, ship model LFM2.5-2.6B QAD-Q4_0, exploratory N C C N)** — `:463`:
  > "**N pp512 1512.2 / tg 23.47; C pp512 211.1 / tg 38.49 = NPU prefill 7.2x, CPU decode 1.64x**"

- **MEASURED (8 Elite v79, 1/09, r=3)** — `:466`:
  > "Q3 OLMoE Q4_0 r=3 no-verbose: pp512 NPU **862.6** vs CPU **199.9 = 4.32×** … Qwen3.5-4B Q4_0 …: pp512 **355.0 / 107.1 = 3.32×**, tg128 **8.62 / 19.63** (CPU wins decode 2.28×)."

- **MEASURED (v75 spike, 26/08)** — `:448`: "v75 spike pp512 NPU 581–805 t/s vs CPU 52–70, ΔT ≤ 1.0 °C on every arm".

### 1.3 In-app (governor) prefill, GPU vs CPU, same turn

- **MEASURED (8 Elite QRD8750, 5/09, S5b run 4-6, unplugged, FAST)** — `:486`:
  > "GPU 3200.7 ms vs CPU 5945.2 ms → B/A 0.538 (1.86×)"; run 6 `:2365`: "A1/B1 0,568, A3/B3 0,540 → mediana 0,554 = **1,81×** in PASS-1 esplorativo; strict NOT MET".

- **MEASURED (QRD8650 / 750, 5/09, governor forced, 925 new tokens)** — `:488`:
  > "A1 CPU TTFT 8504,8 ms vs B1 GPU 4294,9 ms → B/A 0,505 (**1,98×**) … Oracolo strict FAIL dall'indice 7". *Oracle FAIL → DESCRITTIVO, not endpoint-passing.*

- **MEASURED (QRD7675 / 732, 6/09, forced)** — `:489`: "GPU prefill 7,42 s vs CPU 11,77 s → B/A 0,631 (1,59×) … mediana delle 2 coppie stesso-turno 0,613 (**1,63×**)".
- **MEASURED (QRD8635 / 735, 6/09, forced)** — `:491`: "coppie stesso-turno 0,592 e 0,570, mediana 0,581 (GPU 6,88-6,93 s vs CPU 11,62-12,16 s su 925 token) … **1,72×**".
- **MEASURED (QRD8650 / 750, 7/09, AFTER the f32-product fix, `gemm-f32-ship`)** — `:493`:
  > "prefill da 925 token, `engine_prefill=GPU` verificato nei route facts, CPU 7,599 s vs GPU 6,119 s = **1,242×** contro 1,78× pre-fix. Previsione pre-registrata 1,17× (intervallo 1,05-1,30): dentro. E il costo misurato al banco predice il tempo in-app entro il 2 %".

- **MEASURED (8 Elite, in-app prewarm 1024 tokens, timer fixed)** — `:3193`:
  > "prewarm 1024 token: A CPU 6.60/6.77/6.82 s vs B GPU 4.06/4.32 s (1.6×)."
  **OPEN**: `:3912` — "il vantaggio GPU sta nel prefill grande … ma il fork #38 misurava ~10× su 512 token senza cache: prossima cella = prefill grande SENZA prewarm nell'app." (1.6× vs ~10× never reconciled.)

- **MEASURED (Jelly / G99, 16/09, unplugged, LFM2.5-2.6B-Q4_K_M)** — `:5557-5561`:
  > "**Jelly: prefill is compute, not page-in. Hypothesis REFUTED by measurement.** … run 1 cold cache **890 s wall, `[ Prompt: 3.6 t/s ]`** … The rate FALLS with length (5.0 t/s at 66 tokens → 3.6 t/s at ~4096) … (a) **a 4096-token prompt costs a quarter of an hour before the first token** — a product ceiling on this tier, not a curve to refine".

- **MEASURED (Jelly, temperature matters more than model)** — `:3999` (product-suite diary): "LFM prefill 34 tok/s a 30 °C contro 15,9 misurato a caldo stamattina → ogni numero di prefill sul Jelly va letto con la temperatura accanto."

---

## 2. BACKEND SPEED — DECODE

### 2.1 The generational verdict series (per-generation, never transferred)

- **MEASURED summary (S23/740, Xiaomi/750, 8 Elite/830)** — `:460`:
  > "The three GPU generations now each give a DIFFERENT verdict, re-measured never transferred: **740 CPU-always -> 750 GPU-2.21x-prefill/tie-decode -> 830 GPU-2.56x-prefill/CPU-1.24x-decode**."

- **MEASURED (S23 / Adreno 740, 2026-08-22, unplugged, prereg v1.2)** — `:149-154` (decision table, verbatim):
  ```
  | config | KEXP 8B-A1B | OLMoE 1B-7B | thermal |
  | C — all CPU (`-ngl 0`) | **17.55** 🥇 | **27.69** 🥇 | hottest on KEXP (40.0 peak); parity on OLMoE |
  | A — all GPU | 14.25 (−19%) | 20.03 (−28%) | KEXP **−2.75°C** (real cool mode); OLMoE −0.45°C (parity) |
  | B — trunk GPU, experts CPU | 7.90 ❌ worst | 10.53 ❌ worst (n10 build) | hotter than A |
  ```

- **MEASURED (8 Elite governor, LFM2.5-2.6B, 29/08, ABBA 2 blocks, r=3, cooldown ≤60 °C status ≤1)** — `:458`:
  > "Medians: A(GPU) ttft 1395/1394 ms, dec 23.7/23.8; C(CPU) ttft 16476/14412 ms, dec 21.6/23.3; **G ttft 1434/1470 ms, dec 25.3/24.2, commit 26/29 ms = 1.80%/1.98% del prefill**"

- **MEASURED (8 Elite, LFM2.5-8B-A1B Q4_K_M, 30/08, order A C C A G G, 6/6 exit 0)** — `:461`:
  > "Medians: A ttft **2517.7/2518.8 ms** decode **28.20/28.37**; C ttft 25122.6/26134.1 decode 13.95/13.46; G ttft **2495.8/2496.1** decode **13.32/13.33**, commit **22.15/20.77 ms = 0.89%/0.83% of prefill** … Binding co-headline: the best single arm HERE is A (GPU decode 2.0-2.1x the 1-thread CPU, caveat banked)"

- **MEASURED (three new tiers, CPU-tuned build, 3/09)** — `:477`:
  > "**G2 decode = CPU VINCE su tutti e tre i tier (GPU a 0.80-0.86×)** — il pattern S23 dell'owner si ripete (scoped: 3 punti single-session, non replicati)"

- **MEASURED (8 Elite in-app, S5 run 6-7, oracle PASS)** — `:485`:
  > "Decode: mediane turni 2-4 A 28.53 vs B 28.33 tok/s — parità entro l'1%, formalmente sotto il "≥" della regola bloccata"

- **MEASURED (in-app decode penalties, GPU-prefill turns)** — 750 `:488` "decode 18,9 (B) vs 21,2 (A)"; 732 `:489` "Decode B −12%"; 735 `:491` "decode B −11,1% / −6,0% (media −8,7%)".

- **REFUTED as a mechanism (8 Elite governor, S5)** — `:458`: "parte del vantaggio decode di G è TERMICO (C si scalda da solo a 90-93 °C col proprio prefill CPU, G arriva al decode più fresco — effetto reale del design ma non velocità kernel)". I.e. part of G's decode edge is heat, not kernel speed — MEASURED interpretation.

### 2.2 NPU / HTP decode — refuted everywhere

- **MEASURED (Xiaomi/v75, 23/08, unplugged, exploratory)** — `:446`:
  > "DECODE CELL (23/08, unplugged, exploratory): HTP tg128 4.1-4.9 t/s vs CPU 11.9 = **0.37x — NPU decode not competitive even though it really runs on HTP0 (hvx-tiled): prefill-only role CONFIRMED with numbers**"
- **MEASURED (v75 experts)** — `:448`: "tg 0.63× (decode stays CPU, consistent everywhere)".
- **MEASURED (S23/v73 → HDK8550 reference, 4/09)** — `:480`: "`-ngl 8 tg128` VIVE (2688 dispatch = PRIMO decode NPU v73 mai registrato)" — it runs; speed not the question.
- **MEASURED (QRD8650/v75, shipped LFM2.5-2.6B, 7/09, `npu-decode-kv`, thermal gate declared but not applied)** — `:495`:
  > "Tre bracci pre-registrati: **A CPU 17,68 ± 4,17**; **B NPU con `-nkvo`** (KV sull'host) **15,08 ± 0,55**; **C NPU con KV su HTP0 13,37 ± 0,25**. C/A = 0,756 (soglia "opzione viva" ≥ 1,0: no); C/B = 0,887 … **Il meccanismo è l'opposto di quello ipotizzato**: con la KV sul DSP l'attenzione si sposta sull'NPU … quindi `-nkvo` non era un handicap su questo grafo: teneva l'attenzione sulla CPU, dove va più veloce."
  Caveats in same row: "il braccio A è rumoroso (±4,17) e il gate termico era dichiarato ma non applicato dal driver … quindi **C/B è il rapporto solido e C/A il più debole**."

### 2.3 Product-lineup decode (context for governor budgets)

- **MEASURED (lineup, screen-on and unplugged unless noted)** — `:348-363`:
  > "| **CalaQwen** 35B-A3B KEXP | **6.810** t/s (t4…) | **4.75** t/s (t6) | — | … | Qwen3.5-2B dense | 15.9 t/s | — | 8.04 t/s (t2) | | Qwen3.5-4B dense | 8.38 t/s | — | 3.52 t/s (t2) | … | LFM2.5-8B-A1B | — | — | 10.60 (k4) / 12.28 (k3) / 14.38 (k2) |"
- **MEASURED (Jelly / G99, 13/09, thermal status 3)** — `:14`: "LFM 2.6B on the Jelly CPU-only is non-viable (SEVERE at only 39 °C, 7/15 turns no-turn-end, battery 85→44 %)".
- **MEASURED (S23, 19/09, unplugged)** — `:14`: "S23 CPU-only throttles to unusable under sustained load (max 44.5 °C, 117→438 s/turn)".
- **MEASURED (measurement noise)** — `:369`: "Consecutive-run variance was **±50 %** (3.99 → 8.27 t/s); speed claims need ABBA pairs."

---

## 3. SPLIT / ROUTING EXPERIMENTS AND THEIR CONCLUSIONS

### 3.1 The per-device AND per-model proof (the "line ~461" core)

- **MEASURED (8 Elite, cell #41, 30/08, prereg + hostile audit)** — `:461`:
  > "Binding co-headline: the best single arm HERE is A (GPU decode 2.0-2.1x the 1-thread CPU, caveat banked) - with #38 (2.6B: G beats both) and #40 (KEXP: CPU wins decode) this is the three-point proof that **routing must be per-device AND per-model**; a hardcoded GPU-prefill/CPU-decode split is wrong on this 8B, and v0's sub-1% commit makes ANY router choice affordable."
  Three points, in order: (1) `:458` #38, LFM2.5-2.6B on 8 Elite: **G beats both single-backend arms** (TTFT ~10× better than CPU, within 3-5% of pure GPU, decode ≥ CPU); (2) `:460` #40, KEXP on 8 Elite: **GPU wins prefill 2.56×, CPU wins decode 1.24×**; (3) `:461` #41, LFM2.5-8B on 8 Elite: **all-GPU A is the best single arm** (decode 2.0-2.1× the 1-thread CPU) → a fixed GPU-prefill/CPU-decode split is wrong there.

- **MEASURED (4th data point — VLM, 8 Elite, cell #42)** — `:462`:
  > "Pre-written rule (median of 3, >=5%): **vision encode → CPU** (GPU loses 1.67x…); **prefill → GPU 4.0x**; **decode → CPU 1.28x**. E2E (report-only): best static arm M 11008 ms; hypothetical per-phase composition 9755 ms = **1.13x over the best static arm**, 1.40x/1.44x over pure arms - no static arm can execute it"

- **MEASURED (governor commit tax across model sizes)** — `:458` "commit 26/29 ms = 1.80%/1.98% of prefill" (2.6B, pre-written <2% gate, passes by 0.02 in block 2) and `:461` "commit 22.15/20.77 ms = 0.89%/0.83% of prefill" (8B) → "commit grows SLOWER than prefill: 6/24 attention blocks, ~8.06 MiB/commit".

### 3.2 GPU-prefill + CPU-decode splits that FAILED

- **REFUTED (K4 split on S23/Adreno 740, 2026-08-13, N3 ABBA 2 prompts, unplugged 100%)** — `:1138-1140`:
  > "K4 CHIUSO: lo split è CORRETTO ma PIÙ LENTO su ogni asse sul 740 — N3 FAIL (decode 0.698×, TTFT 0.59×), N4 skippata."
  > "decode mediano split 2.02 vs CPU 2.90; TTFT 30.4 vs 17.8 s (il load raddoppia: re-upload dei dense a ogni cold start); prefill ~pari (9.5 vs 9.9 …) … **Lane velocità split su A7X: CHIUSA per misura.**"

- **REFUTED as-implementable (2B phase-split, 2026-08-13, honest 490-token turn)** — `:1130-1136`:
  > "tutto-CPU 28.3 s; tutto-GPU 29.2 s (peggio); GPU-prefill + CPU-decode SE il KV si passasse = 20.6 s (0.73×, il soffitto); quello realizzabile oggi (due processi) = 36.0 s (1.27×, peggio). Il dividendo esiste solo con handover KV dentro UN processo (switch di backend a runtime) — lavoro engine, non flag."

- **MEASURED (35B streamed, trunk GPU + experts CPU, byte-identical output; speed verdict)** — `:1158+` and N3 verdict at `:1138`: correctness proven, speed FAIL. Same class as `:166-176`: "Prefill (K-G lane): honest 1.12×, hybrid 1.07× — killed, not worth the complexity."

### 3.3 -ngl variants / half-offload

- **REFUTED ("GPU beats product-default" on KEXP S23)** — `:126-133`:
  > "arm C (`-ngl 0`, pure CPU, -nr) measured for the first time: **17.553 t/s — FASTER than full-GPU A (14.252)**. A/C = 0.812 < 1.20 → the "GPU vs product-default" dossier sentence is **refuted** on this model … the GPU's honest product role here is the COOL mode (−19% speed, −2.75°C peak). Two more facts: hybrid B (trunk-GPU/experts-CPU) is the WORST arm (7.90 — per-layer ping-pong)"
- **REFUTED ("GPU default candidate" on OLMoE S23)** — `:437` (queue row) and narrative `:137-146`: "OLMoE arm C … CLOSED 22/08: yes, C wins every cell (A/C 0.724) — "GPU default candidate" retired".
- **MEASURED rule (S23)** — `:180-187`:
  > "Rules: want speed → pure CPU, always. Want cool on KEXP → all-GPU (−19% speed, −2.75°C). **Half-offload is NEVER right**"
- **MEASURED (streaming regime, Mellum2, same-harness, n=16)** — `:168-172`:
  > "pure CPU `-ngl 0 -nr` **0.216** t/s (plugged, declared; level flat, no mem cliff) vs trunk-GPU partial `-ngl 2 -ncmoe 99` **0.223** (unplugged) — **GPU placement moves nothing in the streaming regime (±3%)** … the wall is flash bandwidth; GPU is irrelevant to it; the recipe is everything."
- **MEASURED (experts-on-GPU vs experts-on-CPU at equal offload, S23, unplugged, ABBA×2, 21/08)** — `:84-86`:
  > "burst decode **27.5 vs 12.7 tok/s (2.17×)**, sustained **15.3 vs 10.3 (~1.5×)**, and the GPU arm runs COOLER (CPU arm hits 40.2°C). On this device class, when the model fits in RAM, GPU experts are a candidate default"

### 3.4 Vulkan

- **DEAD END / MEASURED (Adreno 740, 2026-08-22)** — `:208-211`:
  > "**Vulkan on Adreno 740 … the "backend of the future" runs NO K-quants at all.** It initializes, passes f16 (242/242), then every K-quant pipeline (q4_K dense, q2/q3/q4_K MoE) dies at `createComputePipeline ErrorUnknown` → uncaught vk::SystemError → SIGABRT, while `supports_op` reports SUPPORTED. Same device, same day: OpenCL with our kernels passes 407/407."
  Standing rule `:187`: "Vulkan is not an option anywhere on this hardware (dies on all K-quants)."

### 3.5 NPU/HTP lanes, including -ngl variants

- **MEASURED (v73 offload budget, HDK8550 reference, 4/09, cell #43)** — `:480`:
  > "`-ngl 8` VIVE (proof 189), `-ngl 12` VIVE (297, 2.48 GiB vivi sul DSP), `-ngl 8 tg128` VIVE (2688 dispatch = PRIMO decode NPU v73 mai registrato); `-ngl 99` MUORE con MBUF=512 e con VMEM=1800 (entrambi :729, proof 48) … **F6 RIFORMULATA: su v73 experts-on-NPU è viabile con pesi residenti ≤ ~2.5 GiB verificati e senza churn; a 3.6 GiB muore in QUESTO build a prescindere da MBUF/VMEM.**"
- **DEAD END (v73 sustained NPU)** — `:448`: "q57: full-on-NPU hybrid prefill heats the S23 at 2.33 °C/min (40 °C in 3.75 min; CPU-ref 1.38 °C/min, not same-start) — sustained NPU load is thermally unusable on this device".
- **DEAD END / policy (owner-confirmed)** — `:448`: "policy F6, OWNER-CONFIRMED 24/08: MoE-experts-on-NPU is v75-class-only"; "Router R6/R7 OFF", "R6 hard OFF (incident), R7 hard OFF (q53/q53b)".
- **REFUTED (full NPU offload on v73 kills the device)** — `:448`: "THERMAL INCIDENT 25/08: … the S23 dropped off adb twice … and was then found very hot, powered off and not booting — device DOWN, hardware state unknown."
- **MEASURED (tri-engine roles, all three device-verified)** — `:446`:
  > "The tri-engine governor (#24) now has all three roles device-verified: **NPU=prefill 3.19x, CPU=decode, GPU=cool-mode.**"

### 3.6 In-app governor behaviour (routing actually executed)

- **MEASURED (S5 run 3, QRD8650/750, 6/09, APK ac4820d; first end-to-end governor turns)** — `:485`:
  > "B×4: `engine_prefill GPU`, `engine_decode CPU`, `commit_bytes 9.2 MB / 10.5 ms`, thermal FAST, prewarm GPU 5.2 s (1024 token) … oracolo FAIL — i 32 id greedy divergono al token 14 … decode: mediana B turni 2-4 = 21.9 vs A 24.4 tok/s"
- **MEASURED (thermal degradation path works end-to-end, S5 run 5, APK 0265333)** — `:485`:
  > "a skin 38.5 °C (WARM) la policy dice Wait, il runtime instrada l'intero turno su CPU e lo COMPLETA (`engine_prefill CPU`, `cpu:2+13`, 337.6 ms, decode 22.1, commit 0) — e quel turno PASSA l'oracolo (ids = A)"
- **DEFECT FOUND BY MEASUREMENT (Wait must degrade, not block)** — `:2835-2838`:
  > "la policy ha risposto `admit_prefill: prefill admission is waiting for a safe tabled chunk` → nessun prefill GPU, prewarm `skip eval-failed` … turno senza telemetria → il driver ha abortito (gate B). **Finding di prodotto (S7):** il "Wait" della policy deve degradare a prefill CPU (l'`engine=CPUFallback` dell'ammissione non è consumato dal runtime, delta 3), non bloccare il turno."
  Related: `:2614` "`CPUFallback` di `admit_prefill` non è mai consumato dal runtime".
- **MEASURED (correctness gate per generation, 8 Elite run 6)** — `:485`:
  > "**ORACOLO PASS 4/4 — B1-B3 con prefill GPU (`2+13`, commit 9.2 MB) token-identici a A, B4 degradato a CPU a 38.1 °C WARM e PASS** → la divergenza è confinata … all'Adreno 750; sul 750 la policy resta CPU-prefill via gate di correttezza per generazione (app f98a9fa, `gpu-prefill-incorrect-V75`, override `kalsa.bench.governor_force`)"
- **DEAD END (governor never turns on for high tier)** — `:492`:
  > "`forced:true`: il lever di banco `kalsa.bench.governor_force` era applicato e NON BASTA. Le due cause … **(1)** `src/engine/governorInputs.ts:82-83` … `if (typeof kv !== "number" …) return "NoFit"`, e la entry `qwen3.5-4b` in `ModelRegistry.ts:187` **omette apposta** quel campo … ⇒ `gpu_fit` = NoFit **su qualunque device, sempre** … **(2)** … il governor si aggancia solo se `governorBase.gpu_fit !== "NoFit" && !options.mmprojPath && !streamExperts` ⇒ **qualunque modello con testa vision disabilita il governor**."
- **DEAD END (governor inert by allowlist on mid-tier)** — `:487`:
  > "sul QRD7675 il governor v0.3 è INERTE per allowlist (`Unknown`→CPU): B≡A per design … `GPU_PREFILL_CORRECT={V79:true, V75:false, V73:false, Unknown:false}` + `generationFor()` senza SM7675/SM8635 … ⇒ **su QRD7675, QRD8635 e HDK8550 (dense) non esiste una B in-app; solo QRD8650 (V75) è misurabile con `kalsa.bench.governor_force=1`**"
- **CRITICAL STATE FACT (flag existed, no switch)** — `:3547-3549`:
  > "**Correzione a verbale: "V75 acceso" era FALSO** — `V75:true` è una riga di tabella, il governor parte solo con `kalsa.governor.enabled=1` in AsyncStorage, che nessun file dell'app scrive (solo il driver QDC): installazione pulita = CPU-only ovunque. **Presente ≠ abilitato ≠ eseguito**"
  and `:5584-5602`: "The per-phase governor is fully built and fully wired, and could never turn on. … `src/engine/governorRuntime.ts:3 export const GOVERNOR_ENABLED_KEY = "kalsa.governor.enabled";` … referenced nowhere else but its own test, **no writer anywhere in the app**" (switch added 16/09, default stays OFF).
- **INCOMPATIBILITY (governor vs session persistence)** — `:6291`: "**The governor and session persistence are mutually exclusive today.** `jsi/JSISession.h:48-50` and `:173-175` throw on both save and load while the governor is on … a save would serialize a non-deterministic one of the two."

---

## 4. HEAT

- **MEASURED (S23, GPU vs CPU arms)** — `:85-86`: "the GPU arm runs COOLER (CPU arm hits 40.2°C)"; `:126`: "GPU arm cooler by 2.2°C"; `:149-154`: KEXP all-CPU "40.0 peak", all-GPU "−2.75°C (real cool mode)", OLMoE "−0.45°C (parity)"; prereg cell "peak 38.4 vs 38.95" (SHIP 1.553×, `:117`).
- **MEASURED (8 Elite, CPU prefill self-heats its own decode)** — `:458`: "C si scalda da solo a 90-93 °C col proprio prefill CPU, G arriva al decode più fresco".
- **MEASURED (v73 NPU heat rates, S23, 25/08, guarded)** — `:448`: "q57: full-on-NPU hybrid prefill heats the S23 at **2.33 °C/min** (40 °C in 3.75 min; CPU-ref 1.38 °C/min, not same-start)".
- **MEASURED (heat per prompt, NPU vs CPU, S23, 25/08, B-C-C-B under guard)** — `:448`:
  > "heat per 2×512-token pass NPU +0.6/+1.2 °C vs CPU +2.0/+2.5 → **0.45 vs 1.125 °C per pass**: as a prefill SPIKE the v73 NPU is ~3× faster AND leaves less heat per prompt"
- **MEASURED (spike sweep, S23, 16 guarded runs, 25/08)** — `:448`:
  > "NPU v73 beats CPU at every prompt size — 3–5× faster and **2.5–4× less heat per prompt** (per-process ΔT 0.5/0.0/1.1/2.2 vs 1.9/3.25/3.25/5.15 °C at 128/512/1024/2048; prompt-only 1.7 vs 12.3 s at 128, 23.2 vs 81.6 s at 2048)."
- **MEASURED (v75/750-class NPU is thermally free)** — `:448`: "v75 spike pp512 NPU 581–805 t/s vs CPU 52–70, **ΔT ≤ 1.0 °C on every arm** — the 750-class is where the NPU pays for free thermally".
- **MEASURED (same turn, in-app, 750 after f32 fix, 7/09)** — `:493`: "Termica dello stesso turno: **GPU +4,5 °C contro CPU +10,1 °C di skin**."
- **MEASURED (in-app skin trajectories and cool-downs)** — 750 `:488` "skin B1 37,0→47,4 °C, A1 30,5→43,2"; 732 `:489` "skin B 37→45-47 °C, cooldown B2 810 s"; 735 `:491` "skin B 37→45-46,5 °C, cooldown B2 600 s"; 8 Elite `:486` "Turni GPU finiscono a 44.6-45.3 °C vs CPU 41.4; dopo GPU la skin in 600 s si ferma a 36.3-37,7 → 4 VOID(hot) col target 36.0".
- **MEASURED (cool-down probe, 8 Elite board at rest, 6/09, 16 samples/30 s)** — `:2227`: "42,5 → 36,0 in ~3,5 min, poi ~0,5 °C/min".
- **MEASURED (turn cost while typing, 8 Elite)** — `:2225` (run 3 abort): "60 s di digitazione + prefill CPU da 900 token + 280 token di decode scaldano ~9,5 °C" → post-turn skin 42,5 °C from 33,1, rule `<42` aborted the run (`:2225`).
- **MEASURED (T20C thermal budget, S23 unplugged, 17/09)** — `:5866-5881`:
  > "| start | 34.6 °C, 89 %, thermal status 0 | | 6 turns / 38 min later | **44.0 °C** (the owner's hard stop) | | 25 min idle, app stopped | 34.0 °C, status 0 |" … "At turn 6 the phone **gained 1.9 °C during its cooldown** (42.1 → 44.0). A pause that does not stop the work is not a pause." … "**Twenty turns on an unplugged S23 are not thermally possible with this model.**"
- **MEASURED (where the heat/time goes in a chat)** — `:5894-5897`:
  > "prefill vs decode: 733s prefill (153s of it prewarm) / 651s decode (prefill 53%) … decode tok/s round 0, first -> last: **10.17 -> 6.48 (-36%)** … re-prefill after a KALSA_WINDOW_SLIDE that cleared the KV: 4954 tok in 207s"
- **MEASURED (S23 sustained CPU-only)** — `:14`: "S23 CPU-only throttles to unusable under sustained load (max 44.5 °C, 117→438 s/turn)".
- **MEASURED (thermal incident, 25/08)** — `:448`: "the S23 dropped off adb twice … found very hot, powered off and not booting … New rule: on-device watchdog on every run > 2 min (poll 10 s, kill at 43 °C)".
- **MEASURED (watchdog stop, MTP run)** — `:49-50`: "the thermal watchdog stopped the run (AP 57.9 °C, battery 41.7 °C against a 43 °C kill) before a second decode completed."
- **MEASURED (thermal status vs frequency, 8 Gen 2)** — `:29-33` (see §7 for the "status lags reality" reading).
- **MEASURED (idle-dispose feedback loop: cooling costs a reload)** — `:6060-6074`:
  > "`FOREGROUND_IDLE_DISPOSE_MS = 180_000`. Harness thermal cooldowns run **300–360 s**. Every cooldown therefore guarantees an unload … **152 s of prewarm in a 30-minute run, for the same 1832 tokens, three times.** The cooldown produces the compute that reheats the phone."
  Same block: "the spread: 71.9 s vs 40.3 s for **identical** work — 1.78x, thermal throttling."

---

## 5. ENERGY / BATTERY

- **MEASURED (first J/token datum, single replica — ESTIMATED weight)** — `:447` and `:537`:
  > "**Numbers landed 24/08**: Marco-B′ on houji same-harness pp512 **1.46×** (27.8 vs 19.1) + first matched-work energy J/token **0.86×**; LFM-B′ on S23 pp512 1.14×"
  > "5. **Energy, first datum:** NPU arm 0.86× J/token at matched work (single replica; the #24 sustained cell will confirm or kill it)." — the confirming cell never ran; treat as single-replica ESTIMATED.
- **DO NOT CITE (explicitly inconclusive)** — `:448`: "charge-counter energy inconclusive (**5.3× spread on identical work — do not cite**)."
- **MEASURED (S23, 13/09, unplugged 28.2 min, brightness dark, 6 turns)** — `:4864` and `:4909`:
  > "unplugged drain 53→40% in 28 min at brightness=1, peak 42.9°C"
  > "Battery 53→40% (−13) in 28.2 min; decode current_now mean/peak −970/−2914"
- **MEASURED (batterystats split, same run)** — `:4936+`: "Discharge **484 mAh** … Screen on 99.8%. Estimated: CPU **529 mAh**, screen **44 mAh** (~9% at dark). `com.kalsa.app` u0a347: **195 mAh CPU + 44 mAh screen**; proc **58m 34s user** in 28m wall (~2.1 cores). UID **1000 system 325 mAh CPU bg** — larger than the app; **attribution OPEN**." Units flagged: "`dumpsys current now` −1692..−2914 is almost certainly **mA** … Use charge-counter as ground truth."
- **MEASURED (S23 comparison across models)** — `:4185`: "**89 → 86 %, cioè −0,6 punti per domanda contro −4,8 del 9/09**" — but `:583` marks it: "The S23 battery reproduction is **PARTIAL** and not paired: 9/09 was MiniCPM5 Q4_K_M, while 10/09 was shipped LFM."
- **REFUTED (idle drain premise)** — `:456`: "real idle drain 13–15 %/h (Amendment-1's 7.5 %/h premise **REFUTED** → the authorized block was arithmetically unfinishable from 46 %)".
- **MEASURED (energy instrument, S23, 16/09)** — `:5490`:
  > "use ABBA ordering, thermal gate, per-session idle floor; **cold-to-warm decode time +26–52%, joules/token −6 to +7%, between-run spread 2–7% (not 0.68%)**; Android ggml affinity controls inert, thread count effective, external `taskset` works; **S23 shell fuel-gauge reads are permission-denied/empty and future high-rate energy needs app-side `BatteryManager`**."
- **MEASURED (Jelly, 13/09)** — `:14`: "battery 85→44 %" over the LFM 2.6B CPU-only run (thermal status 3).
- **DEAD END (core placement as a normal-mode lever)** — `:5960-5961`:
  > "`docs/CORE-PLACEMENT-PILOT-2026-09-16.md` closed core placement for **normal operation**: decode on the A55 cores costs **5.0–5.3x (+402 % against a rule tolerating +25 %)**."
- **OPEN (little cores during a thermal pause)** — `:5963-5966`: "A third exists and is unmeasured: **keep generating on the little cores during the pause.** 5x slower costs nothing when the alternative is a full stop" — immediately corrected `:5969`: "⚠️ **Correction, owner 17/09:** a half-attempt at this already exists. Do not call it untouched and do not propose it again before finding that attempt and reading why it stopped."

---

## 6. THRESHOLDS — WHERE EACH NUMBER CAME FROM

### 6.1 Fork policy (pre-written, not derived from a Kalsa measurement)

- **ESTIMATED (governor v0.2 policy)** — `:3868-3871`:
  > "policy con **soglie 38/39.5/42/43 °C, floor batteria 25 %, isteresi, budget flip 1 h** (`src/llama-governor-policy.cpp`); GPU_COOLMODE; NPU lane **deferita** (`llama-ext.h:149`)."
  Observed firing in-app: `:485` "a skin 38.14 °C (+0.92 °C/min, soglia 38.0) `admit_prefill … waiting for a safe tabled chunk`" and `:485` run 5 "a B3 (38.53 °C, stato WARM) la policy ha detto Wait". Design note `:493`: "target termico **invariato a 37,0** perché sopra ~38 °C il governor degrada il turno a prefill CPU e la B misurerebbe la CPU."

### 6.2 Thresholds derived from measurements

- **MEASURED-derived (NPU spike lane)** — `:448`: "Spike-lane parameters: **N_max = 512 tokens, thermal threshold 39.5 °C**; the S23 thermalservice exposes no numeric headroom → the app must poll battery temperature." (from q57/q58 heat-per-prompt data).
- **MEASURED-derived (watchdog)** — `:448`: "on-device watchdog on every run > 2 min (**poll 10 s, kill at 43 °C**)" — born from the 25/08 dead-device incident; also `:49-50` "43 °C kill".
- **MEASURED (owner hard stop)** — `:5872`: "44.0 °C (the owner's hard stop)".
- **MEASURED-derived (bench cooldown targets in S5b)** — `:2324`: "`cool_target_for_arm` (A 38,5 / B 37,0), cap 900 s" and later `:493`: "tetto di **attesa** 900 → 1500 s" because "con il nuovo tetto il cooldown ha chiuso a 36,96 °C in **1200 s**".
- **MEASURED (thermal gates used in cells)** — `:460`: "live-HAL thermal gate <=44C status 0 on every invocation"; `:458`: "cooldown ≤60 °C + status ≤1 before OGNI run"; `:456`: "awake thermal plateau 38.8–39.0 °C vs the locked 32 °C gate" (32 °C gate unreachable → unplugged matrix died).
- **ESTIMATED / candidate (GPU fit gate)** — `:449`:
  > "**k (MemAvailable cost per offloaded weight byte) is NOT a constant**: k_set 1.74→1.05 from ngl 7 to full (N=25, LFM2.5-KEXP, S23), incremental k collapses 1.70→0.09. Post-hoc affine reading: partial offload ≈ **~750 MiB fixed (Adreno prealloc, present even at ngl 0) + ~1.0× offloaded bytes**; candidate conservative gate for the app **`800 MiB + 1.05×bytes`** (safe on all 5 measured points) … Constants need a second model/device before shipping"
- **MEASURED-derived (governor gates, pre-written)** — `:458` "pre-written <2% gate: PASS both blocks, by 0.02 in block 2" (commit tax); `:461` "pre-written band "<=3%: scales cleanly"" and "CPU decode >=0.95xC, tightest 0.955"; `:460` ">=5% win".
- **ESTIMATED then WRONG (in-app speed priors)** — `:489`/`:2348`: "i priori CLI (732 11×, 750 17,4×, 735 10,4×) usano CPU RITIRATE da ALIVE #57/#58 (mid-tier 1,59×, 750 2,87-2,94×) → bande 3-4× troppo ottimiste" and "il prior 1,59× … con lo sconto in-app dà parità". Actual in-app results (1,63×/1,72×) **falsified the parity prior**: `:489` "Prior sbagliato: assumeva lo sconto in-app 0,6 sul 1,6× CLI (riga 40); in-app il 732 tiene il 1,6× intero." → the prior is **REFUTED**.
- **MEASURED-derived (correctness bands)** — `:487`: "banda di parità pre-registrata 1.01–1.05"; `:488`: "Banda pre-registrata 0,55-0,58"; `:489`: "soglia 0,85 che per PREREG riapre la policy V73 mid-tier".
- **App-side runtime thresholds (shipped)** — `:4079-4080`: "`stallWatchdog.ts` (**gap 10 s o <0,5 tok/s dopo 30 s**, armato al primo token, reset per round), `prefillDeadline.ts` (**5× tempo EMA, floor 90 s**, senza EMA non sorveglia…)"; later retuned `:5112`: "stall **gap 45s**, rate after 8 tokens"; `:5468`: "no rate-stall at gapMs<1000; **floor 0.2 tok/s**"; floors elsewhere: "no-EMA prefill min 90s", "cap 900s".
- **App-side lifecycle thresholds** — `:6060`: "`FOREGROUND_IDLE_DISPOSE_MS = 180_000`" + `:4082` "grazia di 45 s in background" (`disposeEngine` after 45 s of background grace).
- **App-side EMA thresholds** — `:4103`: "`thinkingBudgets.ts` sceglie `extended` (LFM 1024) con **decode misurato ≥ 5 tok/s**, altrimenti `short` (512)"; `:4317`: "above the 5 tok/s extended threshold". Document prefill budget `:3921`: "`full_context` solo se il documento sta nel budget di prefill del telefono (**tok/s misurati × 20 s**, EMA per modello, **fallback 800 token** finché non c'è un campione)".

---

## 7. NUMBERS REFUTED OR RETRACTED (never present as live)

1. **REFUTED — "GPU beats the product default" on KEXP S23.** `:128`: "measured for the first time: **17.553 t/s — FASTER than full-GPU A (14.252)**. A/C = 0.812 < 1.20 → … **refuted** on this model".
2. **REFUTED — "GPU default candidate".** `:437`/`:146`: "CLOSED 22/08: yes, C wins every cell (A/C 0.724) — "GPU default candidate" retired" / ""GPU default candidate" is retired".
3. **REFUTED — historical 750 prefill ratio 5.77×.** `:409`: "the historical 5.77× was a weak CPU baseline" (honest 1.43×/2.62×).
4. **REFUTED — K-G "1.29×" GPU prefill on 740.** `:328`: "K-G's 1.29× was a 740 cold-outlier artifact, honest 1.12 %".
5. **REFUTED — mid-tier "GPU ≈ 11× CPU" prior.** `:477` retires it: "vecchi numeri CPU RITIRATI", replaced by CPU-tuned pp 95.2/97.1/99.0 → GPU prefill only 1.59× mid-tier.
6. **REFUTED — in-app parity prior on 732/735.** `:489` (see §6.2): in-app holds the full 1.6×, no 0.6 discount.
7. **REFUTED — "paying for fidelity makes GPU prefill ~parity (~1.16×/1.13×/1.07×)".** `:3516` (7/09 note): "la direzione è giusta ma la stima era troppo forte: **1,24× è un vantaggio reale**, non parità." (actual post-fix in-app 1.242× on 750, `:493`).
8. **REFUTED — Amendment-1 idle drain 7.5 %/h.** `:456`: "real idle drain 13–15 %/h … premise **REFUTED**".
9. **REFUTED — "V75 GPU prefill is enabled in production".** `:3547-3549`: "'V75 acceso' era FALSO … **Presente ≠ abilitato ≠ eseguito**".
10. **REFUTED — 4 GB / 32-bit HTP VA ceiling hypothesis.** `:495`: "`ggml-hex: HTP0 measured max vmem 3489660928` = **3328 MiB = 3,25 GiB** … **Questo refuta l'ipotesi 4 GB/32-bit dell'orchestratore**".
11. **REFUTED — "UFS 4.0 makes NPU streaming prefill pay (pp512 ≈ 2.5–3×)".** `:448` (q61): "the UFS 4.0 extrapolation is **REFUTED** — the same file prefetches at 1.8 GB/s but the eval page-fault pattern re-reads at 190–430 MB/s: mmap streaming is pattern-bound, faster flash does not help".
12. **REFUTED — per-mapping VA limit (H2) as the v73 NPU death cause.** `:480`: "Grid G1b; H2 (limite per-mappatura) **REFUTATA**".
13. **REFUTED — NPU decode as a battery mechanism.** `:495`: "cade il meccanismo su cui poggiava la tesi "NPU per la batteria in decode"" (C/A 0.756, threshold ≥1.0).
14. **REFUTED — charge-counter energy on v73.** `:448`: "5.3× spread on identical work — **do not cite**".
15. **RETRACTED — "KV costs 29.2 KB/token; 8192→16384 = +239 MB".** `:5902`: "KV does NOT cost 29.2 KB/token and 8192 → 16384 is NOT +239 MB … **6656 bytes/token**, already quantized … 8192 → 16384 is **~+52 MiB**".
16. **RETRACTED — "LFM2's recurrent half cannot evict a prefix".** `:5916`: "### RETRACTED: "LFM2's recurrent half cannot evict a prefix"" (it is true of Mamba/RWKV, not LFM2; receptive field derived ≈44 tokens).
17. **REFUTED — Mali as a GPU option (G57).** `:445`: "Gate 4 … **GPU < CPU on all 20 green cases, max 0.962×** — f32 GEMM 0.238× (7.81 vs 32.76 GFLOPS), q8_0-MoE flat 20.7–22.2 GFLOPS while the 8-thread CPU scales 21.5→69.5 with batch (0.962×→0.320×)" + `:3914`: "PARKED per decisione owner 22/08".
18. **REFUTED — attention/compiler-flags/f16-accumulator/operand-storage as the GPU prefill divergence cause.** `:497`: "l'attenzione NON è la causa"; `:496`: "strict identico a stock alla sesta cifra … i flag matematici non c'entrano"; "`acc` non ripara (0,4610 contro 0,4538)"; `:494`: "Lettura 3 del PREREG: l'operando come è memorizzato NON è il residuo". Only the f16 **product** moved KLD: `:496`: "0,4538 → 0,004736" (95.8×).
19. **REFUTED — "compiler version explains the 750 20-FAIL family".** `:490` region (audit #20): "la mia ipotesi compilatore è **REFUTATA** — nei raw del 732 … compaiono sia .02.06 sia .02.16 e passa comunque → il discriminante è la GPU 750".
20. **REFUTED — "T1 (VTCM scale-pad uninit) causes the v79 Class B NaN".** `:471`: "**T1 REFUTED: zeroing the VTCM scale-pad does NOT cure the Class B NaN**".
21. **REFUTED — upstream descriptor type-check fix as Class B cause.** `:472`: "**Upstream descriptor type-check fix REFUTED** … `NaN present in ALL FOUR arms` … refuted".
22. **REFUTED — "budget/thinking cap and quantization explain MiniCPM5 failures"** (product-side, but rules out two levers): `:567` "budget REFUTED as the cause"; `:568` "quantisation REFUTED as the cause".
23. **RETRACTED claim (governor thermal size not interpretable)** — `:485`: "dimensione termica NON interpretabile (driver leggeva la skin cached 31.4, la HAL viva 29.3→40.0 °C; fixato per il run 4)" — S5 runs 1-3 thermal columns are void; and `:458`: "run 1 VOID (thermal gate read dumpsys's frozen `Cached` group…)".
24. **VOID sessions that must never be quoted as data** — `:460`: "session 792778 VOID (… SILENT CPU fallback labeled OpenCL ngl99 exit 0, its numbers matched arm C…)"; `:456`: "three attempts, three distinct deaths"; `:485` runs 1-2 VOID; `:487` run 7a-7d harness deaths.

---

## 8. DEAD ENDS (tested, killed, with the number)

- **Typeahead / prefill-while-typing** — `:1116-1123`: "a 527 token "incrementale" = 67 s vs controllo da zero 64 s; crescere a pezzi è costato 3.5× un prefill unico … Non è fisica: è un buco API" → DEAD on this engine; reopens only with an engine API.
- **K4 split (trunk-GPU / experts-CPU speed) on A7X** — `:1140`: "**Lane velocità split su A7X: CHIUSA per misura.**"
- **GPU decode dense, all Adreno** — `:328`: "K-E never runs; K-G's 1.29× …; decode 0.41× CPU on 740 and 0.44× on 750."
- **Vulkan on Adreno** — `:208-211`, `:187` (see §3.4).
- **Mali G57 GPU** — `:445`, `:3914` (parked until a G610/G615 device exists, `:445` "Reopen when a G610/G615 MC6 device is in hand").
- **NPU sustained on v73** — `:448` (2.33 °C/min; thermal incident; R6 hard OFF).
- **NPU experts on v73** — `:479` "`dspqueue_read failed: 0x2e` dopo 48 dispatch esperti … la morte è dello **stack HTP v73**"; `:480` VA allocation failure at `htp/main.c:729`; `:482` upstream kit "MUORE su v73 a QUALSIASI taglia"; `:484` bisect culprit `0a50d9909` = upstream #26049.
- **NPU decode** — `:495` (see §2.2).
- **NPU for streaming-MoE** — `:448` (q60/q60b): "NPU-for-STREAMING-MoE is a NO-GO on 8 GB/UFS 2.2"; "self-consistent NPU headroom ≈ 1.0×, flash + page-fault bound".
- **K-F cold-start prefetch** — `:323`: "closed: Jelly warm +7.1 % against (p=0.000977); Jelly cold +4.3 % against, p=0.0635 null".
- **Frozen Draft as speed** — `:309-313`: "Alive as correction/RAM saving, dead as speed".
- **Self-speculative decoding / Draft-by-drop / F6 cheap certification** — `:324-326`: "Draft-by-drop | dead: assumed draft cost 0.2×, measured 0.91×"; "Self-speculative decoding for BYTES | closed: 0.31× PC, 0.44× phone".
- **Core placement (A55) in normal operation** — `:5960-5961`: "5.0–5.3x (+402 % against a rule tolerating +25 %)".
- **Speed matrix unplugged on S23** — `:456`: "No speed numbers: three attempts, three distinct deaths … Speed moves to QDC 8 Elite".
- **In-app q4_K / high-tier governor measurement** — `:492`: "NOT MET, negativo ma solido: nessuna misura di fedeltà q4_K; per misurarlo serve un veicolo con pesi q4_K + NESSUN mmproj + `kvBytesPerToken` non nulo — oggi nessuna entry del catalogo lo è."
- **Governor speed cell on mid-tier without forcing** — `:487`: "QRD8635/HDK8550 PARCHEGGIATI per l'owner (nessuna B possibile senza estendere la policy)".

---

## 9. OPEN QUESTIONS — NEVER CLOSED

1. **1.6× in-app prewarm vs ~10× fork cell (#38) on GPU prefill.** `:3912`: "il vantaggio GPU sta nel prefill grande … ma il fork #38 misurava ~10× su 512 token senza cache: prossima cella = prefill grande SENZA prewarm nell'app." Also `:3018` and `:3028-3029`: "prewarm GPU 4.06 s … la cifra GPU vs CPU comparabile è il prewarm a 1024 token: B GPU 4.06/4.30 s vs A CPU 6.6-6.8 s (≈1.6×; il #38 del fork su prompt 512 senza cache dava ~10×: differenza da spiegare)".
2. **Cold, randomized measurement of the f32-fix prefill cost.** `:494`: "la lettura di validità pre-registrata FALLISCE (5,71 °C di escursione contro 2 ammessi) … quindi il debito non è formalmente chiuso" (`mul` ≈ 0.659× is indicative only).
3. **732 / 735 / 8 Elite never re-measured with the f32-product fix; in-app oracle still expects FAIL on them.** `:493` (accepted risks): "n=1 coppia su un board e un'unità; **q4_K non misurato** … 732/735/8 Elite non rifatti; V73 resta false".
4. **Root cause of the Adreno 750 f16/bf16 batched MUL_MAT defect.** `:490`: "la causa radice sul 750 resta inspiegata"; the gate is a workaround; `GPU_PREFILL_CORRECT.V75` stayed false until the owner flipped it on effect size (`:493`/`:3532`).
5. **Residual ~5× fidelity gap on GPU prefill (tile geometry / summation order).** `:494`: "restano due soli sospetti, entrambi strutturali e non misurati — la **geometria del tile** … e l'**ordine di somma**."
6. **Prompt-length crossover router on Marco1c** — `:453` (10-day plan): "→ router prompt-length crossover on Marco1c" — queued, never reported in this file.
7. **In-app NPU lane cells (S6 RAM, S7 thermal loop) never opened.** `:2340`: "NPU in-app: non è cella numerata (S6 RAM, S7 termico) → da aprire dopo."
8. **Little-core decode during thermal pauses** — `:5963-5969`: unmeasured, and `:5969` warns a prior half-attempt exists and must be read first.
9. **Screen on/off effect** — `:49-50`: "The owner's screen-on/screen-off question is still open".
10. **Whether the 750 stays allowlist-OFF in production** — `:488` region: "Per l'owner: il 750 resta in allowlist OFF nell'app (correttezza), quindi in produzione il governor vi instrada CPU pur avendo 2× di prefill disponibile — decidere se il difetto kernel va cacciato o se il 750 resta CPU."
11. **Energy attribution** — `:4936`: "UID **1000 system 325 mAh CPU bg** — larger than the app; **attribution OPEN**"; `:5490`: high-rate energy "needs app-side `BatteryManager`".
12. **NPU nseq>1 / multi-sequence prefill** — `:446`: "nseq>1 probe not executable at this pin … multi-seq fallback expected from source, unmeasured".
13. **Correctness cells owed**: `:448` "Correctness gate (text/PPL device HTP-vs-CPU) still owed" (later closed for v75 OLMoE only); `:466` "Session 1 D OPEN on correctness" (closed by `:468` for v79 ship model + OLMoE only).
14. **Whether the governor's commit/KV handover holds at scale** — the only in-app numbers are `:458`/`:461` (26-29 ms, 20.77-22.15 ms); multi-turn in-app handover under thermal load never re-measured after run 7.
15. **`promptMs`/TTFT comparability** — fixed `:485`/`:3193`, but "il 44 s del run 3 vs 335 ms del run 4 in A non è determinabile dai log" (`:485`) remains unresolved for historical rows.

---

## 10. ONE-LINE CARRY (what the archive most wants the governor to know)

- `:461` "routing must be per-device AND per-model" (three-point proof, 8 Elite, MEASURED 29-30/08).
- `:524-527` "Decode is DRAM-bound → the CPU wins it on every generation, always. NPU decode 0.37–0.63×, GPU loses (740) or at best ties (750). No exception found." / "Prefill is compute-bound → accelerators pay there. v75 ranking: experts-on-NPU 4.82× > dense-NPU 3.2× > GPU 2.48× > trunk-NPU (B′) 1.46×."
- `:533-535` "Memory decides before speed. NPU path materializes everything anon …; GPU costs ~750 MiB fixed + 1:1 driver-side invisible to RSS (q44); CPU+mmap is the only elastic-residency engine".
- `:29-33` "Frequency ceilings follow load, not the declared thermal status. Under decode the platform clamps `scaling_max_freq` to 59% on the big cores; within 60-70 s of stopping the app they are back to 100% … while Thermal Status is still 2" — thermal *status* lags real clocks; the governor must not trust status alone.
- `:14` "gate the catalog on sustained thermal/compute, not GB".
- `:2838` the Wait state must degrade to CPU prefill, never block the turn.
- `:3549` "Presente ≠ abilitato ≠ eseguito" — a routing table row is not a running governor.
