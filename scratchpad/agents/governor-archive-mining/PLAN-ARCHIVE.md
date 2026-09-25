# PLAN-archive mining for the governor — extracted evidence

Source: `archived/PLAN-archive.md` (9610 lines, read in full). Every item = label + exact `file:line` + verbatim quote. Evidence only: no opinions, no designs.

Labels: **MEASURED** (device, date, conditions as stated) · **ESTIMATED** (projection/interpolation) · **REFUTED/RETRACTED** (later withdrawn or contradicted — never cite as live) · **DECLARED BEFORE DATA** (threshold fixed before the run) · **DEAD** / **OPEN** as marked.

All line numbers below are prefixed `archived/PLAN-archive.md:`.

## Backend speed — measured tok/s per backend / device / model

Every row = one verbatim quote. Conditions (plugged/unplugged, screen, cpuset, cooldown, thermal) are quoted where the archive states them.

- **[MEASURED — S23 (SD 8 Gen 2 / Adreno 740), 2026-08-05, llama.cpp mainline mmap naive, Qwen3.6-35B UD-IQ2_M, cold+warm]** `archived/PLAN-archive.md:4600` — "Numeri: **0.10 tok/s** su tutte e tre le varianti (default, `--numa distribute`"

- **[MEASURED — same run: majflt and flash bytes per token]** `archived/PLAN-archive.md:4601` — "**~11.4M majflt** e **~9.5 GiB letti da flash per token**"

- **[MEASURED — S23, §9 table: F3 naive row]** `archived/PLAN-archive.md:4143` — "| mmap naive, mainline (F3) | 0.10 |"

- **[MEASURED — S23: same engine confined to the 3 A510 efficiency cores (background cpuset)]** `archived/PLAN-archive.md:4144` — "| BigMoeOnEdge, ma su 3 core A510 | 0.82 |"

- **[MEASURED — S23, 2026-08-06, top-app 7 cores, gate-F4 config]** `archived/PLAN-archive.md:4145` — "| BigMoeOnEdge, `top-app`, 7 core | **5.06** |"

- **[MEASURED — S23, gate F4 stage: warm median + anti-drift sentinel (unplugged protocol)]** `archived/PLAN-archive.md:4131` — "**Mediana warm 5.02, drift sentinella 1.0%** (soglia 15%) → **stage VALIDO**."

- **[MEASURED — S23: streaming engine vs naive mmap]** `archived/PLAN-archive.md:4147` — "**50× rispetto al naive**"

- **[MEASURED — S23, 2026-08-06, first BigMoeOnEdge runs]** `archived/PLAN-archive.md:4446` — "**0.93-0.97 tok/s**, ttft ~86 s"

- **[MEASURED — S23, 2026-08-06: same config after pinning to fast cores (taskset 3-7 = A715/A710/X3)]** `archived/PLAN-archive.md:4176` — "Primo run con pinning sui core veloci (`taskset 3-7`, cioè A715/A710/X3)"

- **[MEASURED — S23, 2026-08-07 F4.9 cell B, unplugged, 180 s cooldown between reps, battery 29.9→36.5 °C]** `archived/PLAN-archive.md:2910` — "| 1 (cold) | **6.07** | 0.165 | 0.124 | 0.034 | **20.6%** | **33.96** | 115 | 29.9→36.5 |"

- **[MEASURED — same cell: compute-bound verdict]** `archived/PLAN-archive.md:2914` — "`stall/decode 20.6% ≤ 25%` e `compute 0.141 ≥ 0.11`"

- **[MEASURED — S23, dense control Qwen3.5-4B Q4_K_M: burst vs 10-minute sustained (F2)]** `archived/PLAN-archive.md:4650` — "4B denso 8.90 tok/s burst / **4.68 sostenuti su 10 min**"

- **[MEASURED — S23, 2026-08-22 lineup absolutes, cpuset gate read on the binary PID (cpuset `/`, 0-7)]** `archived/PLAN-archive.md:8846` — "**Marco1c-KEXP t4 8.199**"

- **[MEASURED — same session: CalaQwen default B (k6 d1.0 + no-renorm)]** `archived/PLAN-archive.md:8847` — "**CalaQwen t4 k6d1.0-no-renorm 6.810**"

- **[MEASURED — same session: Mellum2 t2]** `archived/PLAN-archive.md:8849` — "**Mellum2 t2 5.098**"

- **[MEASURED — S23, Mellum2 k-grid (2 reps, unplugged, staccato), F1c]** `archived/PLAN-archive.md:9419` — "k8 2.94 / k6 3.76 / k4 4.72 / k2 5.68 t/s"

- **[MEASURED — S23: best Mellum2 config found (config-only, no code)]** `archived/PLAN-archive.md:9428` — "k6d10 OFF t2 = 5.151 t/s wall (MiB/tok 39.2, hit 87.6%)"

- **[MEASURED — S23, ABBA same-session: Marco-1c KEXP vs Marco-Q4 (ship cell)]** `archived/PLAN-archive.md:9415` — "Marco-1c 8.819 tok/s vs Marco-Q4 5.442 = 1.62×"

- **[MEASURED — Jelly Star (Helio G99), 2026-08-14, llama-bench ABBA -t 2, unplugged 100→90%, screen Awake]** `archived/PLAN-archive.md:9426` — "product **3.52 tok/s** tg128 `-t 2`"

- **[MEASURED — S23 / Adreno 740, 2026-08-12: GPU decode vs CPU after the Q6_K dispatch fix (GPU output now correct)]** `archived/PLAN-archive.md:9423` — "decode GPU 0.41× CPU (5.06 vs 12.37) = FAIL; prefill 1.29×"

- **[MEASURED — S23, 2026-08-22 ship cell #18 (preregistered, n=10/arm medians, cool-start): three -ngl arms on LFM2.5-KEXP]** `archived/PLAN-archive.md:8798` — "A (`-ngl 99`) **14.252** t/s picco 37.2°C · B (`-ngl 99 -ncmoe 99`)"

- **[MEASURED — same cell: partial offload (arm B) and pure CPU (arm C)]** `archived/PLAN-archive.md:8799` — "**7.904** picco 39.4 · C (`-ngl 0`) **17.553** picco 39.95."

- **[MEASURED — S23 OLMoE, preregistered N≥5 ABBA, experts on GPU vs experts on CPU, cool-start]** `archived/PLAN-archive.md:8760` — "Mediana tg512 **A (esperti GPU) 16.36 vs B (esperti CPU) 10.53 = 1.553×**"

- **[MEASURED — S23, LiteRT-LM fail-fast, unplugged (Gemma E2B bundle, size-matched CPU twin)]** `archived/PLAN-archive.md:873` — "GPU **~26.8 tok/s** vs llama-bench CPU size-matched (Llama-3.2-3B Q4_K_M)"

- **[MEASURED — same cell: ratio vs declared gate]** `archived/PLAN-archive.md:874` — "**~2.76×, gate ≥1.15× PASS**"

- **[MEASURED — S23, LiteRT second cell: Qwen2.5-1.5B, unplugged]** `archived/PLAN-archive.md:876` — "**Qwen2.5-1.5B GPU ~18.7 vs CPU twin 25.80 → 0.73× FAIL**"

- **[MEASURED — Xiaomi 14 (SD 8 Gen 3 / Adreno 750), 2026-08-18 re-verification, unplugged, interleaved cells, 5 reps per ordering: dense prefill GPU arm]** `archived/PLAN-archive.md:6007` — "| GPU pp128 | 183-188 t/s (media 186.6) | 181.65 ✅ riprodotto |"

- **[MEASURED — same cells: CPU arm of the same comparison]** `archived/PLAN-archive.md:6008` — "| **CPU pp128** | **57-62 t/s (media 58.7)** | **31.46** ❌ |"

- **[MEASURED — Xiaomi 14: true ratio at pp128 after both orderings agreed (3.10× and 3.27×)]** `archived/PLAN-archive.md:6013` — "Rapporto vero a pp128: **3.18×**"

- **[MEASURED — Xiaomi 14: ratio grows with prompt length (dense 2B / 4B)]** `archived/PLAN-archive.md:6026` — "| **1024** | **5.35×** | **6.95×** |"

- **[MEASURED (interpolated from those cells) — Xiaomi 14: TTFT at the Kalsa working point (~1.4k system prompt)]** `archived/PLAN-archive.md:6029` — "TTFT interpolato a 1400 token: 2B ~6.5 s su GPU contro ~33 s su CPU"

- **[MEASURED — Xiaomi 14, 2026-08-22 exploratory A/B/C on KEXP (N=3, tg128, cells in Doze)]** `archived/PLAN-archive.md:8874` — "A tg **24.47** / B **7.40** / C **24.28**; pp128 A **87.4** / B 40.6 / C 39.6."

- **[MEASURED — Xiaomi 14, 2026-08-22 phase d, N=5 protocol, all Awake: decode parity full-GPU vs pure-CPU on LFM-KEXP]** `archived/PLAN-archive.md:8886` — "A/C decode 0.992,"

- **[MEASURED — same cell: prefill arm A vs arm C]** `archived/PLAN-archive.md:8887` — "prefill 2.477**. La parità decode sul 750 non è più esplorativa: è un"

- **[MEASURED — Xiaomi 14, CalaQwen t6 screen-off campaign cell (2026-08-13)]** `archived/PLAN-archive.md:9416` — "**t6 med 2.55 tok/s / 30.4 MiB/tok / hit 80.75%** vs S23 5.86/30.7/80.7"

- **[MEASURED — Xiaomi 14, CalaQwen t6 screen-ON (2026-08-13 night round)]** `archived/PLAN-archive.md:9416` — "CalaQwen t6 screen-ON med **4.750** (vs 2.55 campagna screen-off, +86%)"

- **[MEASURED — Xiaomi 14, Marco1c t4 screen-off (thread lever, 2.1× vs t6)]** `archived/PLAN-archive.md:9415` — "MA t4 = 8.577 t/s (2.1×, compute 0.048 vs 0.116 s/tok)"

- **[MEASURED — Xiaomi 14, Marco1c t4 screen-ON (best flagship number found)]** `archived/PLAN-archive.md:9415` — "Marco1c t4 screen-ON = 10.574 t/s, sopra l'S23 (8.82)"

- **[MEASURED — Xiaomi 14, self-speculation arm D1 on-flash (12 valid runs, a/b/c/d ×3, n=200, unplugged 70→46%)]** `archived/PLAN-archive.md:8382` — "plain **1.654 tok/s**"

- **[MEASURED — Jelly Star / Mali-G57 MC2, 2026-08-22 gate 4 (plugged, declared): generic OpenCL path vs same-device CPU]** `archived/PLAN-archive.md:8999` — "GPU < CPU su TUTTI i 20 casi verdi (max 0.962×), mai ≥2×"

- **[MEASURED — same gate: f32 GEMM GFLOPS]** `archived/PLAN-archive.md:8999` — "f32 GEMM 1024×128×1024: GPU 7.81 vs CPU 32.76 GFLOPS (**0.238×**)"

- **[MEASURED — Jelly Star, unplugged -t 2, n=200 (G99 free-tier ladder)]** `archived/PLAN-archive.md:9417` — "**LFM2.5 k=4 10.60, k=3 12.28, k=2 14.38**"

- **[MEASURED — Jelly Star: drop sweep, d=0.0 row (cold-cache verified per run, unplugged, floor 45%)]** `archived/PLAN-archive.md:7678` — "| 0.00 | 0.1703 | 11803.1 | 50.2 | — | — |"

- **[MEASURED — Jelly Star: drop sweep d=1.00 row]** `archived/PLAN-archive.md:7681` — "| **1.00** | 0.1240 | 3712.8 | 67.1 | **−27.2% più veloce** | **−68.5%** |"

- **[MEASURED — Jelly Star: resulting throughput]** `archived/PLAN-archive.md:7689` — "(5.87 → 8.07 tok/s)."

- **[MEASURED — Jelly Star, Marco cache×drop round 1 (3 rounds/cell, unplugged)]** `archived/PLAN-archive.md:5814` — "a c1500 il drop paga **−24.8%**, a c2000 **−28.4%**"

- **[MEASURED — Xiaomi 14 / Hexagon v75, 2026-08-22 q31 cell: dense/hybrid prefill HTP vs CPU, Qwen3.5-4B Q4_0, nseq=1]** `archived/PLAN-archive.md:9001` — "HTP mediana 84.0 (84.0/87.0/76.3) vs CPU mediana 24.1 (22.6/26.1/24.1) ≈ 3.5×"

- **[MEASURED — Xiaomi 14 / v75, 2026-08-23 banked cell, unplugged 100%, 3 reps, cooldown between HTP reps]** `archived/PLAN-archive.md:9002` — "pp512 HTP mediana 165.4 t/s (range 150.3–170.3, 3 rep processo, cooldown 61s tra le HTP) vs CPU same-harness 51.9 → 3.19× (range 2.89–3.28×)"

- **[MEASURED — Xiaomi 14 / v75, 2026-08-24: MoE experts executed on NPU (OLMoE all-Q4_0), pp512]** `archived/PLAN-archive.md:9003` — "pp512 HTP 686.2 vs CPU same-harness 142.2 = 4.82×"

- **[MEASURED — same cell: decode behaviour]** `archived/PLAN-archive.md:9003` — "tg128 0.63× = decode resta CPU, coerente ovunque"

- **[MEASURED — Xiaomi 14 / v75, 2026-08-23 decode cell, unplugged 68→66%]** `archived/PLAN-archive.md:9004` — "HTP 4.09/4.85 t/s (gira davvero su HTP0, hvx-tiled n=1 — non è fallback, è proprio lento) vs CPU 11.94 → **decode NPU = 0.37× CPU**"

- **[MEASURED — Xiaomi 14 / v75, 2026-08-27 q67: first HTP-readable dense recipe (C1) pp512]** `archived/PLAN-archive.md:9013` — "pp512 **HTP 199.7 vs CPU 43.8 t/s ≈ 4.5×**"

- **[MEASURED — Xiaomi 14 / v75, Marco-B′ trunk-on-NPU smoke, unplugged, execute-op proof]** `archived/PLAN-archive.md:9003` — "pp512 27.84 vs 19.12 = 1.46×, tg128 3.61 vs 6.45 = 0.56×"

- **[MEASURED — S23 / v73, LFM-B′ trunk-on-NPU smoke, unplugged 82→80%, exploratory same-harness]** `archived/PLAN-archive.md:9003` — "pp512 HTP 58.4 vs CPU 51.1 (+14%), tg128 10.6 vs 17.0 (CPU vince il decode, atteso)"

- **[MEASURED — S23 / v73, 2026-08-25 q58 spike sweep, unplugged 81→68%, all 16 runs under thermal guard]** `archived/PLAN-archive.md:9003` — "t/s NPU 75/127/105/88 vs CPU 22/19/26/25"

- **[MEASURED — summary of the NPU campaign (v73/v75 dense-hybrid prefill ratios)]** `archived/PLAN-archive.md:8633` — "denso/ibrido 3.5×/3.19× (v73/v75)"

- **[MEASURED — S23 / v73: the '--no-host' silent-CPU-fallback trap tested and refuted (unplugged 100%, sha matched)]** `archived/PLAN-archive.md:9002` — "TRAP REFUTED-EVERYWHERE"

- **[ESTIMATED — external reference (llama.cpp issue #26094), not our measurement]** `archived/PLAN-archive.md:9005` — "461 tok/s prefill v73"

- **[MEASURED — cross-device: streaming I/O regime identical on S23 and Xiaomi 14 (same model, same hit/bytes)]** `archived/PLAN-archive.md:9416` — "il regime streaming è INDIPENDENTE dal silicio"

- **[MEASURED — S23, 2026-08-22: same-harness streaming baseline, GPU partial offload vs pure CPU (plugged, declared)]** `archived/PLAN-archive.md:8997` — "Mellum2 `-ngl 0 -nr` llama-bench mmap = **0.216 t/s**"

- **[ESTIMATED — projections, never measured on device (flagship residency target)]** `archived/PLAN-archive.md:9428` — "flagship RESIDENTE 15-20 t/s (Xiaomi 14 ~10-14, 8 Elite Gen 5 15-20"

- **[FACT — 8 Elite class has no hardware in the lab (referenced only for driver/subgroup capability)]** `archived/PLAN-archive.md:9423` — "primo silicio col broadcast = 830/8 Elite (non in lab)"

## Heat — °C rises, throttling curves, cool-down, thermal status, thermal kills

- **[MEASURED — S23, 2026-08-07 F4.9, die max sampled at 500 ms (peak occurs during model LOAD)]** `archived/PLAN-archive.md:2940` — "92.0 °C   ← PICCO"

- **[MEASURED — S23, same session, sentinel run peak]** `archived/PLAN-archive.md:2945` — "Sentinella: picco **90.3 °C**."

- **[MEASURED — S23: battery-sensor vs die gap while computing (gate had been reading the wrong sensor)]** `archived/PLAN-archive.md:2946` — "mentre il silicio stava a novanta"

- **[MEASURED — S23, F4.7 battery-curve runs: battery temperature rise per 90 s of decode]** `archived/PLAN-archive.md:3006` — "batteria +6.6 °C ogni 90 s di decode (29.9 → 36.5)"

- **[MEASURED — S23, F5.1 five-turn conversation (no cooldown): decode degradation over turns]** `archived/PLAN-archive.md:2763` — "**−26% su cinque turni**, discesa monotona, sotto 4.0 dal terzo."

- **[MEASURED — S23, F4.9 verdict on back-to-back sustained (no 180 s cooldown)]** `archived/PLAN-archive.md:2975` — "senza 180 s di cooldown fra l'uno e l'altro — è **≤ 4.6 e in calo**"

- **[MEASURED — S23, adoption card: sustained decode and its die peak]** `archived/PLAN-archive.md:1401` — "sostenuto **4.35 tok/s** a die max **79.8 °C**"

- **[MEASURED — S23, drop-0.65 speed session: sustained die median/max]** `archived/PLAN-archive.md:1291` — "Sostenuto: die mediano 68.9 °C, max 76.6"

- **[MEASURED — S23, notte9 cell 4: sustained temperature, no hard throttling]** `archived/PLAN-archive.md:1504` — "die ~68 °C in decode, max 81.8, nessun throttling hard"

- **[MEASURED — S23: throttle-curve task declared as interpretation data for every later run]** `archived/PLAN-archive.md:614` — "curva di throttling del telefono (serve per interpretare TUTTI i run successivi)."

- **[MEASURED — sysfs: prime core (Cortex-X3) frequency under load]** `archived/PLAN-archive.md:1254` — "sotto carico il big (X3) sta spesso a **864 MHz**"

- **[MEASURED — S23, 2026-08-09: RescueParty reboot (dropbox evidence)]** `archived/PLAN-archive.md:1535` — "RescueParty riavvia il device"

- **[MEASURED — S23, same event: memory-starvation signature before the reboot]** `archived/PLAN-archive.md:1529` — "**kswapd0 al 90%**"

- **[MEASURED/RECALIBRATED — S23: the 98 °C hard-stop never fired; real death point measured]** `archived/PLAN-archive.md:1571` — "98 °C non è mai scattato — il telefono muore prima, a ~90"

- **[MEASURED — S23 harness guardrails as installed after the incidents]** `archived/PLAN-archive.md:1546` — "PAUSE_THERMAL 88 °C/60 s con resume a 80, ABORT_MEM <100 MiB/10 s, HARD_STOP 98"

- **[MEASURED — S23: Android thermal status stayed 0 through the whole battery-curve campaign]** `archived/PLAN-archive.md:3522` — "`Thermal Status: 0`"

- **[MEASURED — S23: screen-off timeout expiry demotes Termux to 3 efficiency cores mid-session]** `archived/PLAN-archive.md:1607` — "Samsung declassa Termux dal cpuset top-app → `nproc=3`"

- **[MEASURED — S23 OLMoE ship cell: GPU arm peak temp ≤ CPU arm peak]** `archived/PLAN-archive.md:8761` — "picco termico mediano A 38.4 ≤ B 38.95 °C (più veloce E più fresco)"

- **[MEASURED — S23 ship cell #18: peak temperature of the full-GPU arm]** `archived/PLAN-archive.md:8798` — "t/s picco 37.2°C"

- **[MEASURED — Jelly Star, K-F sustained cell: ON runs hotter sooner (sag = thermal degradation)]** `archived/PLAN-archive.md:9083` — "ON sag 0.32-0.36 vs OFF 0.23: corre più forte presto"

- **[MEASURED — S23 / v73, q57 arm A (hybrid on NPU), guard-killed at 41.4 °C: heat slope NPU vs CPU]** `archived/PLAN-archive.md:9003` — "pendenza 2.33 °C/min, 40 °C in 3.75 min** vs CPU-ref 1.38 °C/min"

- **[MEASURED — S23 / v73, q58 spike sweep: ΔT per process vs prompt size]** `archived/PLAN-archive.md:9003` — "ΔT per processo NPU 0.5/0.0/1.1/2.2 °C vs CPU 1.9/3.25/3.25/5.15 a n=128/512/1024/2048"

- **[MEASURED — same sweep: heat per prompt (the archive's declared right metric)]** `archived/PLAN-archive.md:9003` — "0.45 vs 1.125 °C per pass: a parità di lavoro la NPU lascia MENO CALORE PER PROMPT"

- **[MEASURED — S23, 2026-08-25: thermal incident during sustained NPU PPL (device found hot, off, did not restart)]** `archived/PLAN-archive.md:9003` — "il device trovato BOLLENTE, SPENTO, NON RIPARTE"

- **[MEASURED → threshold: q58 frozen derivations]** `archived/PLAN-archive.md:9003` — "N_max(NPU) = 512 token** (a 1024 la media è 1.1 °C), **soglia termica 39.5 °C**"

- **[MEASURED — Xiaomi 14 / v75, q67: guard killed the HTP arm at 41.1 °C after 486 s]** `archived/PLAN-archive.md:9013` — "A1 HTP kill guardia a 41.1 °C dopo 486 s"

- **[MEASURED — S23: no numeric thermal headroom exposed by the OS (policy must read battery temperature)]** `archived/PLAN-archive.md:9003` — "`thermalservice` su S23 NON espone headroom numerico (status 0, solo soglie statiche)"

- **[COOL-DOWN — S23 protocol: 180 s idle + battery ≤30.0 °C before every rep]** `archived/PLAN-archive.md:3720` — "cooldown ≥180 s"

- **[COOL-DOWN — S23: a gate waiting for battery ≤30.0 °C can stall (observed)]** `archived/PLAN-archive.md:2983` — "osservati 660 s a 30.5"

- **[COOL-DOWN — Jelly: 120 s cooldown in the field, timestamped]** `archived/PLAN-archive.md:7146` — "`cooldown 120s` 11:54:06 → `COLD_RESET` 11:56:12"

- **[COOL-DOWN — Xiaomi NPU cell: 61 s between HTP reps]** `archived/PLAN-archive.md:9002` — "cooldown 61s tra le HTP"

- **[MEASURED — Jelly keepalive: screen stayed awake ~83 min (threshold was ≥60)]** `archived/PLAN-archive.md:5847` — "`mWakefulness=Awake` ininterrotto"

- **[MEASURED — Xiaomi 14: Doze (screen off) halves throughput and degrades I/O; screen-on restores it]** `archived/PLAN-archive.md:9416` — "flash I/O stabile ~0.20 s/tok vs il 0.22→0.50 del Doze"

## Energy — W, J/token, battery drain, per-response vs per-token (including retracted estimates)

- **[MEASURED — S23, 2026-08-06 F4.7: first energy measurement of the campaign (unplugged, screen on)]** `archived/PLAN-archive.md:3553` — "1.4-2.0 A a ~3.6 V = 5.2-7.1 W"

- **[MEASURED — S23, at 5.0 tok/s, screen included (declared upper bound)]** `archived/PLAN-archive.md:3555` — "**≈ 1.0-1.4 J/token**"

- **[MEASURED — S23: tokens per charge derived from that]** `archived/PLAN-archive.md:3557` — "~40 000 token generati per carica"

- **[REFUTED — S23: earlier verbal estimate withdrawn]** `archived/PLAN-archive.md:3558` — "Ritira la stima a verbale di **6 J/token**"

- **[REFUTED — 2026-08-11: 0.455 J/token was unit-mismatched; corrected −83%, still not citable until calibrated]** `archived/PLAN-archive.md:957` — "0.455 era mal convenzionato"

- **[REFUTED (earlier value) — 2026-08-11 scheda entry before the correction]** `archived/PLAN-archive.md:1057` — "energia ~0.455 J/token"

- **[MEASURED — ship A/B S23 energy medians (audit-recalculated from raw CSV)]** `archived/PLAN-archive.md:6957` — "A = 0.4214 W e B = 0.8227 W"

- **[MEASURED — S23 ship cell: sign depends on normalization (per-token vs per-response)]** `archived/PLAN-archive.md:6965` — "per TOKEN B costa +11.8%, per RISPOSTA B"

- **[MEASURED — S23 ship A/B: J/token of the fast config]** `archived/PLAN-archive.md:8576` — "J/token +11.8%"

- **[MEASURED — Xiaomi 14 replica: screen-on power baseline (raw coulomb counter)]** `archived/PLAN-archive.md:8551` — "P₀ = 0.503 W"

- **[MEASURED — S23 screen-on arithmetic: what the fast config saves when the display counts]** `archived/PLAN-archive.md:8586` — "certificata risparmia 22s schermo/risposta (4-13 J) vs +2.6 J compute"

- **[MEASURED — Xiaomi 14 / v75, Marco-B′: first NPU energy number at matched work (dumpsys charge counter, whole-process bracket)]** `archived/PLAN-archive.md:8635` — "primo J/token: 0.86× vs CPU"

- **[MEASURED (negative) — S23 / v73, q57: charge counter unusable at this scale]** `archived/PLAN-archive.md:9003` — "Energia via charge counter INCONCLUDENTE (B1 169 J vs B2 897 J per lavoro identico"

- **[MEASURED — S23 battery-performance curve: flat 32%→17%, then a step below 13%]** `archived/PLAN-archive.md:3519` — "poi uno scalino di −5.0% sotto il 13% (media 4.665)."

- **[MEASURED — S23, in-app KEXP session vs mmap collapse (app-side harness)]** `archived/PLAN-archive.md:9006` — "464s vs 3055s (6.6×), 338 vs 904 mAh (2.7×)"

- **[MEASURED — Jelly in-app arm: battery points per turn (streaming vs mmap)]** `archived/PLAN-archive.md:9006` — "batteria 0.75 vs 5.7 punti/turno"

- **[MEASURED — K-F energy scoreboard (S23/Jelly cells): pooled energy ratio]** `archived/PLAN-archive.md:9081` — "KF_ENERGY_NEUTRAL ✅ (pooled 1.028"

## Routing decisions — split experiments and per-device / per-model conclusions

- **[CONCLUSION (measured basis) — 2026-08-18: drop/cache choice is per-DEVICE]** `archived/PLAN-archive.md:6837` — "Quindi la scelta drop/cache va decisa PER DEVICE"

- **[MEASURED — same replication: Jelly vs S23 drop effect at cache 1500]** `archived/PLAN-archive.md:6825` — "| 1500 | **−25%** | ≈ **−5%** |"

- **[MEASURED — same replication: at cache 4000 the sign flips on Jelly but not on S23]** `archived/PLAN-archive.md:6827` — "| 4000 | **+15% (fa danno)** | ≈ **−4% (aiuta ancora)** |"

- **[MEASURED — device-independent part of that replication (hit rate and bytes identical)]** `archived/PLAN-archive.md:6829` — "hit rate a d=0 **identici** (39.5 /"

- **[CONCLUSION (measured basis) — RAM→cache→hit→drop-sign law]** `archived/PLAN-archive.md:6846` — "**più RAM → cache grande → hit alto → il drop fa danno →"

- **[CONCLUSION — 2026-08-17: same flag, same level, opposite outcome across models ⇒ per-MODEL]** `archived/PLAN-archive.md:5992` — "La config è per-modello, come diceva gualt."

- **[MEASURED (quality axis) — Marco d=1.0 costs far more macro bpb than CalaQwen (same flag)]** `archived/PLAN-archive.md:5991` — "sta al 50% del budget, su Marco al 122%"

- **[MEASURED — K-F law across three devices (basis of the dispatcher rule)]** `archived/PLAN-archive.md:9113` — "a 3 device: Jelly 27-30%→−34% · Xiaomi 19-21%→nullo · S23 11%→nullo."

- **[MEASURED — dispatcher rule validated on those three]** `archived/PLAN-archive.md:9114` — "La regola dispatcher (ON solo con stall%>~20 misurato) è VALIDATA."

- **[CONCLUSION (measured) — drop pays only when the stall share repays its fixed compute tax]** `archived/PLAN-archive.md:7522` — "il break-even lo fissa la quota di stall, non il livello di"

- **[MEASURED — NPU/CPU/GPU role table from measured decode/prefill ratios]** `archived/PLAN-archive.md:9004` — "NPU=prefill/spike, CPU=decode, GPU=cool-mode — tutti e tre i ruoli ora device-verified."

- **[MEASURED — S23 -ngl sweep (q44, unplugged 100→96%, cpuset gate, N=25): offload factor is not constant]** `archived/PLAN-archive.md:9009` — "k_set 1.74/1.43/1.27/1.05 a ngl 7/13/19/99 (N=25)"

- **[MEASURED — same sweep: GPU memory cost model]** `archived/PLAN-archive.md:9009` — "partial-offload ≈ **~750 MiB fissi (≈ prealloc Adreno, visto anche a ngl 0) + 1.0× byte offloadati**"

- **[MEASURED — app-side fit-gate constant from the same sweep]** `archived/PLAN-archive.md:8647` — "sweep -ngl bancato — costo GPU ≈ **750 MiB fissi + 1.0×byte**"

- **[CONSTRAINT (source-verified) — 35B streaming experts cannot move to GPU at all]** `archived/PLAN-archive.md:9423` — "Q7-LANDMINE: l'expert-ready hook dello streaming è SOLO nel loop CPU di mul_mat_id"

- **[MEASURED — S23: user-facing rule after cells #18/#20 (740-class)]** `archived/PLAN-archive.md:8920` — "Regola utente: **velocità → CPU pura; fresco (KEXP) → GPU**"

- **[MEASURED — but that rule does NOT transfer to Adreno 750 (2026-08-22, N=5 protocol)]** `archived/PLAN-archive.md:8929` — "La regola "velocità → CPU pura" è del 740/S23"

- **[MEASURED — same: 750 parity on decode]** `archived/PLAN-archive.md:8887` — "parità decode sul 750 non è più esplorativa"

- **[MEASURED — thread count must be per-SoC AND per-model (Xiaomi, Marco1c vs CalaQwen)]** `archived/PLAN-archive.md:9415` — "STRANGOLA SM8650 su Marco1c"

- **[MEASURED — same cell: thread knee]** `archived/PLAN-archive.md:9415` — "ginocchio t4>t5(9.25)>t6"

- **[MEASURED — screen state changes the verdict (Xiaomi): the "halved flagship" was a Doze artifact]** `archived/PLAN-archive.md:9416` — "il "flagship dimezzato" era un artefatto Doze"

- **[MEASURED — half offload (arm B) is the worst of the three on S23]** `archived/PLAN-archive.md:8808` — "**B è il peggiore dei tre** (ping-pong per-layer del mezzo-offload)"

- **[MEASURED — -ngl arms REFUTE "GPU beats product default" on S23 LFM2.5-KEXP]** `archived/PLAN-archive.md:8803` — "A/C = 0.812 < 1.20 → REFUTE della frase dossier"

- **[MEASURED — OLMoE decision cell (2026-08-22): pure CPU beats full GPU]** `archived/PLAN-archive.md:8829` — "A(-ngl16) 20.034 vs C(-ngl0) 27.685, A/C 0.724"

- **[POLICY (owner-confirmed from measurements) — MoE experts on NPU = v75-class only]** `archived/PLAN-archive.md:9003` — "esperti-su-NPU = v75-class only"

- **[MEASURED — ubatch is also a cache lever (S23, same RAM)]** `archived/PLAN-archive.md:2363` — "+1500 MB in UBATCH (512→2048)   →  +9.9 punti di hit"

- **[MEASURED — KEXP expert-placement ratio (S23 ship cell, preregistered)]** `archived/PLAN-archive.md:8800` — "A/B = 1.803 ≥ 1.50 PASS"

- **[MEASURED — NPU lane ledger status at the end of the archive (nothing ON)]** `archived/PLAN-archive.md:8991` — "oggi NESSUNA corsia NPU è ON"

## Thresholds — where each number came from (measured / declared-before-data / retracted)

- **[DECLARED BEFORE DATA — Gate F4 (2026-08-04, before any 35B streaming run)]** `archived/PLAN-archive.md:670` — "x ≥ 3 tok/s → PASS pieno"

- **[DECLARED BEFORE DATA — Gate F4 conditional band]** `archived/PLAN-archive.md:671` — "1.5 ≤ x < 3 tok/s **e x ≥ 3× il naive di riferimento** → PASS condizionato"

- **[DECLARED BEFORE DATA — Gate F4 stop rule]** `archived/PLAN-archive.md:673` — "x < 1.5 tok/s (oppure x < 3× il naive) dopo lo sweep → STOP del binario B su S23"

- **[DECLARED BEFORE DATA — Gate F6 (MTP/speculation)]** `archived/PLAN-archive.md:710` — "MTP "conviene" se eval tok/s netti ≥ **+10%**"

- **[MEASURED/OPERATIONAL — run admission: battery ≤32 °C at start]** `archived/PLAN-archive.md:587` — "temperatura batteria ≤32°C a inizio run"

- **[OPERATIONAL — measurement never under active charging]** `archived/PLAN-archive.md:586` — "Numeri di performance MAI sotto carica attiva (throttling diverso) e MAI con telefono caldo"

- **[OPERATIONAL (protocol) — battery floor for comparable runs]** `archived/PLAN-archive.md:9578` — "nessun rep di misura parte con batteria <40%"

- **[OPERATIONAL (protocol) — majflt covariate cut-off]** `archived/PLAN-archive.md:9583` — "run con majflt alto (>50k)"

- **[MEASURED — anti-drift sentinel tolerance]** `archived/PLAN-archive.md:4131` — "drift sentinella 1.0%** (soglia 15%)"

- **[RETRACTED → replaced — PPL budget Δ0.15 declared obsolete; live rule is the floor]** `archived/PLAN-archive.md:980` — "regola budget Δ0.15 marcata OBSOLETA (vige il floor 2.0955)"

- **[DECLARED — quality gate macro budget]** `archived/PLAN-archive.md:5974` — "`MACRO_PASS = 0.04`"

- **[MEASURED (roofline) — hit-rate crossover where I/O stops being the bottleneck]** `archived/PLAN-archive.md:3666` — "crossover hit-rate | **h\* = 0.82**"

- **[MEASURED (roofline) — architectural ceiling with free I/O]** `archived/PLAN-archive.md:3665` — "tetto architetturale | **7.8 tok/s**"

- **[DECLARED — kernel correctness threshold (ERR)]** `archived/PLAN-archive.md:6198` — "Soglia ERR = 0.0005"

- **[DECLARED BEFORE DATA — i-quant kernel go/no-go rule]** `archived/PLAN-archive.md:1298` — "regola g<1.20 →"

- **[DECLARED BEFORE DATA — LiteRT fail-fast gate]** `archived/PLAN-archive.md:874` — "gate ≥1.15× PASS"

- **[MEASURED (from incidents) — thermal guardrails installed on S23]** `archived/PLAN-archive.md:1546` — "PAUSE_THERMAL 88 °C/60 s con resume a 80"

- **[MEASURED/RECALIBRATED — combined memory+thermal abort condition (after a false-positive class)]** `archived/PLAN-archive.md:1418` — "condizione COMBINATA"

- **[MEASURED (new rule after incident) — on-device thermal watchdog for runs >2 min]** `archived/PLAN-archive.md:9003` — "KILL a 43 °C, max temp nel manifest"

- **[MEASURED (frozen derivation) — max NPU spike chunk size and thermal threshold]** `archived/PLAN-archive.md:9003` — "soglia termica 39.5 °C"

- **[MEASURED (three devices) — prefetch dispatcher threshold]** `archived/PLAN-archive.md:9114` — "stall%>~20 misurato"

- **[FORK-DECLARED (device-verified behaviour) — cache-mb floor]** `archived/PLAN-archive.md:647` — "`--cache-mb` ha un **floor di 1500**"

- **[MEASURED — what actually decides a sane cache size (per-token cycle), not the floor]** `archived/PLAN-archive.md:6750` — "quantità vera è `token_demand_MiB` (il ciclo di un token)"

- **[MEASURED — ubatch value fixed by measurement]** `archived/PLAN-archive.md:1502` — "**512 chiuso come config di campagna e prodotto.**"

- **[DECLARED — sample-size rules for ship claims]** `archived/PLAN-archive.md:8758` — "emendata pre-analisi N≥10→N≥5"

- **[MEASURED (mechanism) — drop never skips the matmul (it is I/O-only)]** `archived/PLAN-archive.md:9511` — "IL DROP NON SALTA MAI IL MATMUL"

- **[MEASURED — battery-voltage sag region where the step appears]** `archived/PLAN-archive.md:3545` — "il PMIC di una Li-ion inizia a limitare la corrente"

## Dead ends — what died and why (measured reason)

- **[DEAD — Vulkan on Adreno 740 (2026-08-22, plugged exploratory): no K-quant pipeline executable]** `archived/PLAN-archive.md:8989` — "Vulkan non esegue NESSUN K-quant su A740"

- **[DEAD — supports_op lies on the Vulkan path (third occurrence of that bug class)]** `archived/PLAN-archive.md:8989` — "`supports_op` dichiara SUPPORTED (mente"

- **[DEAD — Mali-G57 generic path: GPU slower than CPU on every green case (plugged, 22/08)]** `archived/PLAN-archive.md:8999` — "GPU < CPU su TUTTI i 20 casi verdi (max 0.962×)"

- **[DEAD (parked) — Mali: reopening criterion is a newer device]** `archived/PLAN-archive.md:8999` — "Criterio di riapertura: un device G610 MC6 o G615 MC6 in mano"

- **[DEAD — GPU/Adreno OpenCL lane for the hybrid 35B retired 2026-08-09 after source verification]** `archived/PLAN-archive.md:1378` — "Il +30-50% del PLAN era costruito sull'ipotesi"

- **[DEAD — i-quant CPU kernels on 8 Gen 2 (measured ratio below go/no-go)]** `archived/PLAN-archive.md:9476` — "ik_llama è **più lento** del nostro mainline sul decode"

- **[DEAD — i8mm in the real engine (never runs on the streamed path)]** `archived/PLAN-archive.md:9056` — "K-E MORTA (KE_NULL, 2026-08-14): l'i8mm non gira mai nel motore"

- **[DEAD — "prefill GPU 1.29×" was an artifact of a cold-outlier baseline]** `archived/PLAN-archive.md:9061` — "il "prefill GPU 1.29×" era un artefatto"

- **[DEAD — CPU repack fused kernel: no headroom (S3_NO_HEADROOM)]** `archived/PLAN-archive.md:9318` — "S3_NO_HEADROOM al gate d'onestà"

- **[DEAD — fused FFN kernel measured slower than stock in every same-t pair]** `archived/PLAN-archive.md:9428` — "il fuso è PIÙ LENTO dello stock in OGNI coppia same-t"

- **[DEAD — speculative/MTP on bytes (break-even declared 0.56, measured 0.594)]** `archived/PLAN-archive.md:5916` — "morta sui byte (β=0.594 contro 0.56 di pareggio)"

- **[DEAD — self-speculation loses on phone flash (12 valid runs, Xiaomi)]** `archived/PLAN-archive.md:8383` — "freeze ON **γ3 0.720 (0.44×)**"

- **[DEAD — expert-major decoding (arithmetic of the union vs cache)]** `archived/PLAN-archive.md:8271` — "IDEA 1 (expert-major) — MORTA per il nostro regime"

- **[DEAD — route predictor from frozen state (economy of prefetch bytes)]** `archived/PLAN-archive.md:8284` — "IDEA 3 (predittore di route) — MORTA"

- **[DEAD — adaptive-k on router confidence (precondition absent)]** `archived/PLAN-archive.md:7780` — "IDEA 2 (k ADATTIVO SULLA CONFIDENZA DEL ROUTER) — MORTA IN UN"

- **[DEAD — cache policies: nothing beats LRU on the real load]** `archived/PLAN-archive.md:3132` — "Il ramo delle politiche di cache non è marginale: è VUOTO."

- **[DEAD — cross-layer prefetch]** `archived/PLAN-archive.md:9403` — "prefetch cross-layer | **morto** | Recall@8 19.2%"

- **[DEAD — expert packing: random vs sequential reads cost the same at 0.94 MB blocks (S23 gate, unplugged 83%)]** `archived/PLAN-archive.md:9000` — "seq/random = 1.058×"

- **[DEAD — ubatch 2048 (slower and 4× buffer)]** `archived/PLAN-archive.md:1500` — "ubatch 2048 RIGETTATO, ed era pure più lento"

- **[DEAD — reduced-k lossy lever on KEXP]** `archived/PLAN-archive.md:9405` — "**k ridotto (lossy) su KEXP** | **morto (confermato)**"

- **[DEAD — expert requant 1c (compute gain ≈ byte penalty)]** `archived/PLAN-archive.md:9407` — "ri-quantizzazione 1c esperti | **pareggia**"

- **[DEAD — REAP-50 pruning on G99 (same active bytes ⇒ same decode)]** `archived/PLAN-archive.md:9417` — "REAP50_LOSES"

- **[DEAD — 15-20 tok/s free-tier target on G99 (projection refuted by measurement)]** `archived/PLAN-archive.md:9417` — "proiezione 14.7/16.3 RIFUTATA"

- **[DEAD — typeahead and phase-split 2B (engine holes, not physics)]** `archived/PLAN-archive.md:9425` — "Typeahead DEAD"

- **[DEAD — ISP/CVP generic compute on the phone ISP (driver allow-list, SELinux neverallow)]** `archived/PLAN-archive.md:6049` — "EVA / CVP — CHIUSA COL SORGENTE DEL DRIVER"

- **[DEAD — UFS Host Performance Booster (ABI read-only, removed from mainline, wrong read size)]** `archived/PLAN-archive.md:6090` — "UFS HPB — chiusa, per tre ragioni indipendenti"

- **[DEAD — QNN as the NPU path (static graph, no public weight-update API)]** `archived/PLAN-archive.md:6142` — "La strada NON è QNN, è il backend Hexagon di llama.cpp"

- **[DEAD — NPU as a decode backend (measured 0.37× CPU)]** `archived/PLAN-archive.md:9004` — "decode NPU = 0.37× CPU"

- **[DEAD (policy) — MoE experts on Hexagon v73: three distinct death signatures characterized]** `archived/PLAN-archive.md:9003` — "TERZA firma di morte v73"

- **[DEAD — drop-by-weight / top-p shortlist levers (archived for mechanism)]** `archived/PLAN-archive.md:9391` — "archiviate per meccanismo"

- **[DEAD — Mellum2 experts-on-GPU in streaming]** `archived/PLAN-archive.md:8777` — "esperti-GPU non viable in streaming"

- **[DEAD for lineup — B′ Q8_0 trunk failed the behavioral loop gate]** `archived/PLAN-archive.md:8639` — "FAIL DEFINITIVO (q52, 24/08)"

- **[DEAD — IQ4_NL / Q4_0 as HTP-readable dense quants (quality gate)]** `archived/PLAN-archive.md:9010` — "IQ4_NL FAIL, Q4_0 FAIL"

- **[DEAD — LiteRT vanilla OpenCL llama kernels (K2/K5 remain valid)]** `archived/PLAN-archive.md:9388` — "NON riaprire OpenCL llama vanilla (K2/K5 restano validi)"

- **[DEAD — k<6 quality on the campaign model (PPL margin 6×)]** `archived/PLAN-archive.md:9405` — "k5d000 +0.45 vs k6d065, sotto floor"

## Open questions — never closed in this archive

- **[OPEN — ~70% throughput gap between two binaries at identical config (queue #7)]** `archived/PLAN-archive.md:8981` — "Gap ~70% kernel_kf vs lineup binary | da investigare"

- **[OPEN — a whole session ran 3-4× slow; cause never explained]** `archived/PLAN-archive.md:962` — "la causa (termica post-conv5? stato device?) non è spiegata"

- **[OPEN — +5.0% bytes at d=0.3 on Marco-Mini never explained (speculative prefetch ruled out)]** `archived/PLAN-archive.md:7524` — "+5.0% dei byte a d=0.3 su Marco-Mini resta un'anomalia separata e"

- **[OPEN — wiki corpus inverts both dense-quant candidates; registered, unexplained]** `archived/PLAN-archive.md:9010` — "fatto registrato, non spiegato"

- **[OPEN — does pure CPU also beat GPU on OLMoE (queue #20)]** `archived/PLAN-archive.md:8815` — "batta A è la domanda aperta → coda #20."

- **[OPEN — why Mellum2 experts-on-GPU at ngl=2 is <0.11 t/s (queue #19)]** `archived/PLAN-archive.md:8995` — "perché Mellum2 esperti-GPU a ngl=2 è <0.11 t/s"

- **[OPEN — measured cost of a CPU↔HTP handover does not exist anywhere]** `archived/PLAN-archive.md:6157` — "Costo per handover CPU↔HTP: NOT FOUND."

- **[OPEN — no 8 Elite hardware in lab]** `archived/PLAN-archive.md:9423` — "830/8 Elite (non in lab)"

- **[OPEN — energy figure not citable as a single number until shunt/charge calibration]** `archived/PLAN-archive.md:958` — "da NON citare come singolo numero fino a"

- **[OPEN — CPU throttle curve on a plugged S23 (cell G1) never run; called the most valuable missing cell]** `archived/PLAN-archive.md:8991` — "G1 curva di throttle CPU su S23 attaccato = la più preziosa"

- **[OPEN — even top-app does not expose CPUs 6-7 / the prime X3]** `archived/PLAN-archive.md:4274` — "nemmeno `top-app` dà le CPU 6 e 7"

- **[OPEN — q67 correctness ratio VOID: 20 HTP chunks with no CPU reference]** `archived/PLAN-archive.md:9013` — "r = VOID, NON misurato"

- **[OPEN — corpus v2 / re-anchoring the PPL floor (Dante corpus discovery)]** `archived/PLAN-archive.md:926` — "un corpus v2 (ri-ancorare = ~3 run PPL su PC, niente device)."

- **[OPEN — HTP multi-sequence fallback expected from source, never measured]** `archived/PLAN-archive.md:9004` — "il fallback CPU su batch multipli resta atteso da sorgente, non misurato"

- **[OPEN — K-F UX component abandoned without a decision (p99 −17%, stutter halved, TTFT 12-18 vs 21-22 s cold)]** `archived/PLAN-archive.md:7876` — "abbandonata senza decisione"

- **[OPEN — bitselect/producer round-trip puzzle (why e2e passes with a producer-violated roundtrip)]** `archived/PLAN-archive.md:5557` — "puzzle bitselect/producer-violation"

## Refuted / retracted numbers — index (never cite these as live)

- **[REFUTED 2026-08-18 — 'GPU prefill 5.77×' was a CPU-baseline artifact]** `archived/PLAN-archive.md:6003` — "Il 5.77× era un artefatto della BASELINE CPU, non della GPU."

- **[REFUTED 2026-08-06 — 'prefill GPU 1.29×' was an artifact]** `archived/PLAN-archive.md:9061` — "il "prefill GPU 1.29×" era un artefatto"

- **[REFUTED 2026-08-07 — fio 413 MiB/s replaced by iobench 1204 MiB/s on the same device]** `archived/PLAN-archive.md:3440` — "§5 del piano dice `fio: 1M = 413 MiB/s [MISURATO F2.1]`"

- **[REFUTED 2026-08-07 — '56.9% hit rate' was cumulative, not decode]** `archived/PLAN-archive.md:3631` — "Il 56.9% non è mai stato l'hit-rate del decode."

- **[REFUTED 2026-08-07 — '343 MB/token' was a counting error (shared expert included)]** `archived/PLAN-archive.md:3677` — "`343 MB/token` in Registro era mio errore"

- **[REFUTED then corrected — H2 'falsified' claim reversed (real load meets it 8.6×)]** `archived/PLAN-archive.md:2809` — "SODDISFATTA — avevo sbagliato a dichiararla falsificata"

- **[REFUTED 2026-08-17 — '46.9% of slots dropped by cold' never existed in any data]** `archived/PLAN-archive.md:6605` — "IL 46.9% NON ERA MISURATO E NON ESISTE IN NESSUN DATO DEL REPO."

- **[REFUTED 2026-08-17 — '+87% drop penalty at cache 4000' was an outlier round]** `archived/PLAN-archive.md:6718` — "il "+87%" era un OUTLIER, non il"

- **[REFUTED 2026-08-11 — c4000 '+15/+20%' was a subset of rounds; all rounds give ≈0]** `archived/PLAN-archive.md:5820` — "c4000 "+15/+20%" era un sottoinsieme (r2/r3)"

- **[REFUTED 2026-08-11 — 'byte-identical' claim false on the real I/O counter]** `archived/PLAN-archive.md:5829` — ""Byte bit-identici" è FALSO sul contatore vero"

- **[REFUTED 2026-08-11 — the c1500 speedup explanation (thermal) refuted; number kept]** `archived/PLAN-archive.md:5834` — "numero confermato, spiegazione refutata"

- **[RETIRED 2026-08-06 — all thread-sweep conclusions (14% session drift confounded them)]** `archived/PLAN-archive.md:4299` — "sul numero ottimo di thread sono **ritirate**"

- **[REFUTED 2026-08-13 — KEXP-on-G99 projection 14.7/16.3 t/s]** `archived/PLAN-archive.md:9417` — "proiezione 14.7/16.3 RIFUTATA"

- **[REFUTED 2026-08-12 — '+30-50%' GPU split expectation built on a false hypothesis]** `archived/PLAN-archive.md:1378` — "Il +30-50% del PLAN era costruito sull'ipotesi"

- **[REFUTED (reading) 2026-08-18 — 'HTP loads only 0.67 MiB' was not the proof claimed]** `archived/PLAN-archive.md:6099` — "Lo 0.67 MiB NON era la prova che credevo."

- **[REFUTED — '283 graph splits were handovers' was wrong]** `archived/PLAN-archive.md:6110` — "`graph splits = 283` non erano handover intenzionali."

- **[RETRACTED 2026-08-07 — 'the simulator overestimates 2.4×' was my error]** `archived/PLAN-archive.md:2440` — "«il simulatore sovrastima di 2.4×» era un ERRORE MIO"

- **[REFUTED 2026-08-13 — 'the flagship is halved' was a Doze artifact]** `archived/PLAN-archive.md:9416` — "il "flagship dimezzato" era un artefatto Doze"

- **[REFUTED — HyperOS perf-mode does nothing on CalaQwen (0.97×)]** `archived/PLAN-archive.md:9416` — "PERF-MODE HYPEROS: NULL su CalaQwen"

- **[REFUTED (measurement artifact) — gate number 5.06 corrected to 5.02 (warm median definition)]** `archived/PLAN-archive.md:4133` — "il numero di gate è **5.02**"

- **[REFUTED — drop does not reduce matmul work (for three days the narrative said it did)]** `archived/PLAN-archive.md:9511` — "IL DROP NON SALTA MAI IL MATMUL"

- **[REFUTED (2026-08-06) — '8× worse per active parameter' was largely a 3-core artifact]** `archived/PLAN-archive.md:4246` — "«8× peggio per parametro attivo del 4B denso»"

---

Refuted/retracted rows are reproduced only so they are never re-cited; each corrected value is quoted in the same row or in the neighbouring MEASURED row.
