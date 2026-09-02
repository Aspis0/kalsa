# PIANO OPERATIVO V1 — "Beyond Memory Capacity": MoE 35B da flash su Galaxy S23 8GB

> **Brief operativo per Grok.** Data: 2026-08-03 · Progetto: Kalsa (ricerca "banda per token")
> Orchestratore: Claude (main loop) · Esecutore codice/analisi: **Grok** · Mani sul telefono: **gualt**
> **Repo di lavoro: `Kalsa/moe-experiments/`** (repo git dedicato, totalmente staccato dall'app)
> Device primario: **Samsung Galaxy S23 128GB VERGINE dedicato** (8GB RAM, Snapdragon 8 Gen 2, **UFS 3.1**, OneUI)
> Stato: piano iniziale, sostituisce integralmente il draft precedente (che era basato su Qwen3-30B-A3B)
>
> Tutti i fatti marcati [V] sono stati **verificati online il 2026-08-03** (URL in §13). Tutte le cifre
> marcate [S] sono **stime da confermare** in F0/F2. Grok NON deve fidarsi di nulla che non sia [V]:
> la prima cosa che fa è la checklist di ri-verifica in §7-F0.

---

# ⭐ STATO CORRENTE — vista compatta (2026-08-24; aggiornata 27/08)

> **26/08 sera — owner via 28/08 → ~07/09.** Piano dei 10 giorni FIRMATO:
> `docs/PLAN-10DAYS-2026-08-28.md` v2 (audit DeepSeek applicato, `a3ffca83`): QDC 8 Elite
> prima (kill-date g4) → baseline S23 plugged → ≤3 pick upstream OpenCL → ottimizzazione
> prefill q2/q3 (gate doppio) → cella crossover router su Marco1c; HVX (28c) solo sotto
> regola pre-delegata (§8: v79 sopravvive agli esperti ∧ q63 FAIL ∧ GO scritto). Bancati
> oggi: **#32 q59** (IQ4_NL FAIL, owner A), **#33 q62** (streamer di prodotto compute-bound,
> prerequisito HVX (1) OK), **#34 q64** (costante cache 3437 MiB). **27/08: #35 q63 BANCATA**
> (+ erratum q59: arm IQ4_NL non pura, 37 Q5_K): **C1 "IQ4_NL-M" PASS 5/5** (peggiore es
> +0.95 %), C2 pura FAIL 3/5 → la qualità di Q4_K_M sta nel MIX, non nel tipo base; **q67**:
> C1 carica ed esegue su HTP v75 (prova execute-op), pp512 **4.5× vs CPU**, r HTP-vs-CPU
> VOID (gate memoria Xiaomi, non misurato — al rientro v75/QDC). Prossimi: q66 APK (RAM libera), q65 scongelata. **S23 pronto** (Phase 1 prep `550f73f9`): 12 GB liberi, OLMoE Q4_K_M +
> Marco-KEXP a bordo con sha, toolchain `s3oracle` certificata 407/407 + 925/925; manca solo il
> riferimento termico plugged (giorno 1) per lockare `s23-plugged-baseline`. Xiaomi via con
> l'owner: q62 secondario e ogni cella v75 dopo il 07/09 (o QDC).
> **28/08: #36 s23-night0 BANCATA (correttezza-only, BANK-WITH-ERRATA)** — s3oracle su S23
> UNPLUGGED: MUL_MAT_ID **407/407** + MUL_MAT **925/925**, pin 11/11; la matrice speed
> unplugged è MORTA per questa trasferta (tre blocchi su tre tentativi: plateau termico
> da sveglio ≥38.8 °C vs gate 32, drain 13–15 %/h vs floor 45 %, transport adb morto
> in-run) → speed su QDC 8 Elite e/o S23 via USB al replug. Erratum chiave: la premessa
> drain dell'AMENDMENT-1 era sbagliata (7.5 vs 13–15 %/h) — il blocco autorizzato era
> aritmeticamente infinibile. QDC OPERATIVO stesso giorno: 1000 min sbloccati su QRD8750
> (8 Elite, Android 16), dry-run adb-via-SSH PASS con exec binari custom da
> /data/local/tmp. E kalsallama compila su macOS/aarch64: **10/10 test PASS inclusi i sei
> test-repack-q23k** — prima piattaforma kernel-test fuori da Windows, mattone iOS.
> **28/08 sera: #37 qdc-8elite-cpu-day0 BANCATA (BANK-WITH-ERRATA) — il primo dato 8xx.**
> 8 Elite (QRD8750/Oryon, Android 16, ~20 min di 996): correttezza CPU **MUL_MAT 1144/1144 +
> MUL_MAT_ID 812/812** (repack q2/q3 inclusi, primo run su Oryon) e OLMoE Q4_K_M CPU
> tg128 **59.1 t/s** (-t8, mediana conservativa; S23 CPU #20: 27.7 → **~2.1× device-class**,
> non A/B controllato), pp512 93.0; -t6 52.5/75.5. Numeri mid-ramp (drift −8.6% worst,
> HAL CPU 39.6→53.8 °C; battery service del rack CONGELATO → termica solo da thermalservice).
> Lettura per la decisione kernel/NPU 8xx: la CPU Oryon da sola raddoppia il decode S23 —
> l'asticella per HVX/GPU sugli 8xx si alza. Prossime: Marco-KEXP (#18), kit OpenCL per E031/
> Adreno 830.
>
> **29/08 — GOVERNOR v0: 7 step macOS CHIUSI + smoke device su 8 Elite (NON bancabile).**
> Le tre gemme LiteRT esistono nel fork (`kalsa/governor-v0` @ 1bfd144a2): commit KV
> esplicito per range (offset verbatim da state_write_data), PreparedPlan misurato
> (n_reused/split/graph_builds), capability query Direct|MirrorAndCopy|Reject; hybrid
> (KEXP-class) supportato; V-trasposta staged 1728→6 transfer. Ogni step chiuso da audit
> ostile (audit-step1..7.md; difetti veri trovati: clear() che cancellava le celle del
> peer, sei no-op silenziosi, decode non-owner metadata-invisibile, cache staged
> illimitata). **Smoke QDC 8 Elite/Adreno 830** (`scratchpad/agents/governor-v0/step8-qdc/`):
> suite governor TUTTA VERDE su device incl. LFM2.5-2.6B QAD-Q4_0 di ship, oracoli byte
> identici a macOS (269568 / 1392640 → riproducibilità cross-piattaforma); llama-bench
> smoke: **pp512 GPU 383.3 vs CPU 42.9 (8.9×), tg128 CPU 28.1 > GPU 26.3** → il routing
> per fase ha la forma giusta anche sull'830, non solo sul 740.
>
> **29/08 pomeriggio: #38 BANCATA — step 8 COMPLETO, governor v0 FINITO (8/8 step).**
> Cella cross-backend sotto prereg `ddddf077` + AMENDMENT-1: **G vince tutte e tre le
> condizioni pre-scritte in entrambi i blocchi ABBA** (ttft 1434/1470 ms ≈ 10× meglio
> di C ed entro il 3-5% di A; decode 25.3/24.2 ≥ C; commit 26-29 ms = 1.80%/1.98% del
> prefill — il gate 2% passa per 0.02 nel blocco 2 ed è prompt-length-dependent,
> dichiarato). Parte del vantaggio decode di G è TERMICO (C si autoscalda a 90-93 °C,
> G arriva al decode più fresco — effetto reale del design, bancato come tale).
> Erratum strumentazione QDC: il gruppo `Cached` di dumpsys thermalservice è CONGELATO
> sul rack — ogni cella futura legge `Current temperatures from HAL:` + Thermal Status.
> Registro #38 + ALIVE riga 21.
>
> **30/08: #39 BANCATA (audit GLM FIX → APPLY al re-audit)** — kernel MoE q2/q3
> CORRETTI su Adreno 830 al primo run: MUL_MAT 925/925 eseguiti + 545 skip,
> MUL_MAT_ID 407/407 + 405 skip (dichiarati). Claim ristretta dall'audit: il path
> MUL_MAT semplice q2/q3 non viene MAI eseguito (26/26 capability skip); il path
> MoE passa 10/14 con tutte le shape realistiche OK. Registro #39 + ALIVE riga 22.
> Prossima cella QDC già preregistrata: speed KEXP A-vs-C su 830 (`3af32c18`,
> qdc-8elite-speed-kexp) — parte alla prossima sessione con l'owner in chat (2FA).
>
> **30/08: #40 BANCATA (audit GLM fresco FIX → APPLY)** — decision table KEXP su
> Adreno 830 (sessione 792790): **GPU vince prefill 2.56×, CPU vince decode 1.24×**.
> Serie generazionale completa, ogni gen un verdetto diverso: 740 CPU-sempre →
> 750 GPU-prefill/pari → 830 GPU-prefill/CPU-decode. Registro #40 + ALIVE riga 23.
> Trappola scoperta e messa a verbale: `/vendor/lib64` nel LD_LIBRARY_PATH =
> fallback CPU silenzioso etichettato OpenCL (sessione 792778 VOID). ~800 min QDC
> residui. Prossimo QDC candidato (prereg da scrivere): governor su modello più
> grosso (LFM2.5-8B-A1B).
>
> **30/08 sera: #41 BANCATA (audit GLM fresco FIX → APPLY al re-audit)** — governor
> v0 sul modello 3× più grosso, LFM2.5-8B-A1B (lfm2moe), Adreno 830 (sessione
> 793164, prereg `166f9ccf`): **G = WIN per la regola pre-scritta** (tiene il
> prefill GPU — 2496 ms, perfino sotto A — e il decode CPU al 95.5% nel pairing
> più stretto) e il **commit scala PULITO: 0.83–0.89% del prefill** (vs ~1.9% sul
> 2.6B — su questa famiglia hybrid il commit CRESCE PIÙ LENTO del prefill).
> Co-headline onesta: su questo 8B l'arm migliore in assoluto è A (decode GPU
> 2.0–2.1× il CPU a n_threads=1; ttft entro l'1%) → con #38 e #40 è la prova che
> il routing è per-device E per-modello, e la smentita di uno split fisso
> GPU-prefill/CPU-decode. Registro #41 + ALIVE riga 24.
>
> **30/08 notte: #42 BANCATA (audit GLM fresco FIX → APPLY al re-audit)** — PRIMO
> run del VLM di famiglia: LFM2.5-VL-3B (backbone del 2.6B di ship + SigLIP2
> 400M) su Adreno 830, sessione 793229, prereg `6642824d`+A1 `20f2a259`.
> Decision table a TRE fasi: **encode visione → CPU (la GPU perde 1.67× per
> buchi kernel CLIP OpenCL, lista op agli atti); prefill → GPU 4.0×; decode →
> CPU 1.28×**. Composizione per-fase ipotetica batte il miglior arm statico
> 1.13× (e 1.4× i puri) — QUARTO punto dati per il router per-device E
> per-modello E per-fase. Determinismo: output byte-identici intra-arm 9/9.
> mtmd-cli patchato per i timing (556118a08). Registro #42 + ALIVE riga 25.
>
> **31/08: #43 BANCATA (audit GLM fresco #8 FIX → APPLY)** — **NPU v79 day-0
> sull'8 Elite: il lane ESISTE e vola.** Skel v79 buildato su Mac (container
> Docker ufficiale, zero login — idea dell'owner) si carica nel cDSP al primo
> colpo. Probe velocità sul MODELLO DI SHIP (2.6B QAD-Q4_0): **prefill NPU
> 1512 t/s = 7.2× CPU; decode CPU 38.5 = 1.64× NPU** — lo split per-fase sul
> TERZO motore. Correttezza: test-backend-ops boccia MA censimento 362/362 =
> giudice avvelenato solo in accoppiata HTP (control GPUOpenCL 407/407);
> 36 INTERNAL-ERROR veri (defect list v79 aperta); smoke testuale coerente.
> Sessione 793389 (coda 11.5h, login web rotto → host Connect via owner).
> Registro #43 + ALIVE riga 26. ~700 min QDC.
> ⛔ **LAB FISICO GIÙ**: S23 spento 28/08 (drain sotto carica debole, mai enumerato su USB),
> Jelly spento 28/08 23:04 (shutdown ordinato, campagna ciswire ferma a R4/c1-A/turn 4,
> checkpoint salvo) — 29/08 ~10:00 su ordine owner smantellati watcher+harness+cron; il
> Mac senza watcher si è ADDORMENTATO 4h (clamshell vince su `sleep 0`) → LaunchAgent
> `com.kalsa.keepawake` (caffeinate, KeepAlive, testato) ora tiene l'accesso remoto vivo.
> Si riparte al rientro owner (~07/09). Fino ad allora: QDC (~950 min) + CI dal 1/09.
>
> **1/09 — CI operativo:** `ci/android-bench` probe gratuito **PASS** (run
> `33457714894`, 8m53s, `ubuntu-latest`); `CI (cann)` disabilitata a livello
> repository (`gh workflow disable`) e YAML dispatch-only (`3cfe5ddab`).
> **`kalsa/governor-v0` PUSHED** `88e88a1cf..cff0a4a75` (Aspis0/kalsallama);
> il push non ha riacceso cann (nessun run nuovo). ALIVE riga 27.
>
> **1/09 — ERRATUM `Aspis0/kalsa` (pubblico), branch `feat/moe-stream`.** Non è
> una cella. L'orchestratore ha cancellato `origin/feat/moe-stream` senza
> classificarlo prima (247 commit non in `origin/main`, branch di lavoro
> streaming/CisWire, mai mergiato; `main` non ne dipende). Al restore ha
> pushato HEAD locale `cb238a3` invece del tip origin `ee524f3`, pubblicando
> `ARCHITECTURE.md` (i `.md` di architettura non vanno su GitHub). Force-push
> indietro a `ee524f3`: il branch pubblico è di nuovo quel tip;
> `ARCHITECTURE.md` non è sul branch. Residuo: `cb238a3` resta raggiungibile
> per SHA via API GitHub finché non fa GC. Locale `feat/moe-stream` ahead 5
> (`ARCHITECTURE.md` + 4 commit CisWire). La fuga preesistente su `ee524f3`
> (nomi `Aspis0/kalsallama` e `Aspis0/kalsa-forkbigmoeonedge` in docs del
> branch) è di nuovo in chiaro perché il branch è di nuovo pubblico;
> `origin/main` resta pulito. Non toccare ALIVE: niente misura, niente riga.
>
> **1/09 notte — QDC login OK, sessione NON aperta (minuti).** Browser Paseo
> visibile, home `qdc.qualcomm.com/home`. Catalogo: QRD8750 **746 min remaining,
> Unavailable** (stesso pool di #43). Chiave SSH `kalsa-mac` presente. Nessun
> click su New Interactive Session. Prossimo blocco del piano = Session 1 D
> residuo: *v79 sopravvive a MUL_MAT_ID su OLMoE all-Q4_0?* Il GGUF q55
> (`43379486…`, 3.93 GB) non è su questo Mac (solo Q4_K_M). Prereg in
> `scratchpad/agents/qdc-8elite-npu-v79-experts/` prima di qualsiasi coda.
> Audit ostile del prereg: **FIX** (2 bloccanti: `GGML_HEXAGON_VERBOSE=1`
> obbligatorio per la riga execute-op; load-fail ≠ DOES-NOT-SURVIVE). Edit
> applicati, re-audit **APPLY** (`1ab98822` + coda AUDIT). GGUF requant PC sha
> `9d0b90c6…`. Re-audit **APPLY**. Tentativo coda: form New Session aperto,
> login ancora valida (`/home` Welcome). Click Mobile sul wizard **non
> resta selected** (aria-pressed false); Next senza device = rischio minuti
> sul silicio sbagliato → **nessuna sessione creata**. 746 min intatti.
> **IN CODA:** sessione `npu-v79-experts-44` job **795454**, QRD8750 Android 16,
> status **Submitted** (Started N/A, minuti Pending). Cap 20 min, SSH+mirror,
> chiave `kalsa-mac`. Billing parte a Running. URL
> `qdc.qualcomm.com/reports/job/interactive/795454`.
> **795454 Completed 07:17, 20m usati, cella VUOTA:** Started 06:57, Ended 07:17,
> Job Logs 0 items, adb locale vuoto. Il cap è scattato senza Connect/misure.
> Q1–Q3 non girati. Non riaccodare in automatico.
>
> **1/09 ~10:52 — job 795870 `npu-v79-experts-44b` (riaccoda CON watcher).**
> QRD8750 / 8 Elite / Android 16, cap 20 min, SSH+mirror, chiave `kalsa-mac`.
> Submitted 10:52:36, Running 10:54:15. Connect fatto, tunnel
> `~/.ssh/qdc_ed25519` `-L 6037:sa799939.sa.svc.cluster.local:5037`
> (Jelly 5037 intatto). adb `f25c433a`. Kit 556118a08 pushato 9.4 MB/s.
> Q1 in corso (`q1_run.sh` → `raw/`). Watcher scheduler
> `01a05d5e942b7090a54eab6b0bfb49e9`. Non aprire una seconda sessione.
> Quota catalogo al submit: 726 min. URL
> `qdc.qualcomm.com/reports/job/interactive/795870`.
>
> **1/09 11:07 — Q1/Q2 SURVIVES (audit mimo FIX→APPLY).** Job 795870 Ended 11:07:21.
> On-device sha = host `9d0b90c6…`. `Hexagon Arch version v79`.
> **48** righe `HTP0 execute-op MUL_MAT_ID` su `ffn_*_exps` (16 layer ×
> gate/up/down). `EXIT=0`. GATE_PASS. Q3 `-r 3` non girato (sessione chiusa
> per non bruciare il cap). Numero rumoroso dal r=1 verbose: pp512
> **845.9 t/s** (jsonl `avg_ts=845.885502`, un sample). Non confrontare con
> #43 1512 (modello diverso) né q55 PPL. `--list-devices` fallito (script
> senza `LD_LIBRARY_PATH`); Q1 con env ok. REPORT in
> `scratchpad/agents/qdc-8elite-npu-v79-experts/REPORT.md`. Session 1 D
> non chiusa: patched-judge + Qwen dense restano OPEN. HVX 28c frozen.
>
> **1/09 11:14 — job 795871 Canceled, 0 min.** Stesso nome/ora di 795870
> (doppio Create Session). Era ancora Submitted; mail “ready” = il pool
> stava per assegnare il device. Cancellato prima di Running. Non
> riaccodare. I dati stanno su 795870.
>
> **1/09 — cell #45 PREREG on disk, Connect ARMED before submit.**
> `scratchpad/agents/qdc-8elite-npu-v79-d-rest/` — Q_ops (score-judge, not
> kit rebuild) + #44 Q3 OLMoE r=3 no-verbose + Qwen3.5-4B Q4_0 requant
> `f1635f9c…` / 2543899808 B. Watcher `01a05dc941897282b87dbbada4ccba1a`.
> Name `npu-v79-d-rest-45`, 20 min, QRD8750 only. Nessuna sessione creata
> finché questo blocco è scritto. Non aprire un secondo job.
> **Connect path:** Marco fa wizard+Connect; `connect.sh` alza il tunnel 6037
> e lancia `d_run.sh`. Watcher `01a05dc941897282b87dbbada4ccba1a` resta armato.
> Lenovo `marcolenovo.lan` / 192.168.1.234: ARP ok, SSH :22 timeout; Mac sshd
> non in ascolto su 22.
>
> **1/09 14:06 — job 796061 Completed, raw ON GIT (`9df8ae6b` ops mid-run,
> `de36a2cf` full).** QRD8750, ~19 min wall, DONE elapsed=468s. Tutti e tre
> gli arm sul disco: ops MUL_MAT/ID, Q3 OLMoE r=3, Qwen3.5-4B Q4_0 N+C.
> Sha match. Pre-audit: OLMoE pp512 NPU **862.6** vs CPU **199.9**; Qwen
> pp512 NPU **355.0** vs CPU **107.1**, tg128 NPU **8.62** vs CPU **19.63**.
> Ops EXIT=1 (judge still poisoned; MUL_MAT real_internal=36). Report/audit
> PENDING. QDC Job Logs non sono la copia di verità — git sì.
>
> **1/09 sera — #45 REPORT+AUDIT (mimo, parent erratum EXIT).** Q_ops FAIL
> patched-correct (OK=0; MUL_MAT 36 INTERNAL-ERROR). Q3 OLMoE pp512 NPU
> 862.6 / CPU 199.9 = 4.32×. Qwen3.5-4B Q4_0 pp512 355.0/107.1 = 3.32×,
> tg128 8.62/19.63 (CPU 2.28× decode). Session 1 D OPEN on correctness,
> dense speed measured. ALIVE riga 29. Evidence
> `scratchpad/agents/qdc-8elite-npu-v79-d-rest/`.
>
> **1/09 notte — #46 + #47 BANCATE: SESSION 1 D CHIUDE SULLA CORRETTEZZA.** La NPU v79
> calcola giusto contro la CPU. **#46** (`qdc-8elite-npu-v79-judge`, job 796233, ~33 min,
> REPORT Luna + audit ostile Fable APPLY): kit `93e9592fa` col giudice riparato (port q32
> `GGML_TEST_PLAIN_HOST=1` + propagazione errore DSP → `GGML_STATUS_FAILED` +
> `llama-perplexity`; audit mimo APPLY×2). Giudice ON: `judge_nonfinite=0`,
> `recopy_lines=executed`; **MUL_MAT_ID 301/301 PASS** (era 0/301 tutto veleno in
> #43/#45). Controllo (giudice OFF): 301 CPU-nonfinite dal raw diretto → il veleno è vero
> e la riparazione è vera (il census frozen lo sotto-conta a 60, bug header-glue in
> `FINDINGS-reviewer.md`; il raw soddisfa la condizione 301). MUL_MAT 37 FAIL = **36
> errori DSP INTERNAL-ERROR** (propagazione kit 36:36, `test-backend-ops.cpp:1850` forza
> il FAIL) **+ 1 vero NaN numerico** (`q4_0 m=2880`, HTP0=nan vs CPU=−12.34). PPL misurate
> ma VOID (avevo tolto il `-v`). **#47** (`qdc-8elite-npu-v79-ppl-v`, job 796297, ~11 min,
> REPORT Fable + audit ostile mimo APPLY): stesso kit, PPL HTP-vs-CPU 32 chunk CON `-v`.
> **Ship 40.2720/40.2837 = r −0.029 % PASS** (10648 execute-op MUL_MAT); **OLMoE
> 9.0620/9.0562 = r +0.064 % PASS** (3024 execute-op MUL_MAT_ID = 1008×3 su ffn esperti).
> Cross-check: PPL con `-v` identiche a #46; CPU riusate. Lista difetti 36 DSP + 1 NaN
> aperta come hardening. ALIVE righe 30-31. **Census adottato 2/09 (adjudicazione mimo
> fresco, `CENSUS-ADJUDICATION.md`, ADOPT-con-demozione)**: `census.awk` = ex headerfix
> (accettazione 5 log pinnata); la versione del bank #46 archiviata come
> `census.awk.frozen-46`; nelle prereg future lo split per categoria è "reported, not
> binding" — il conteggio difetti vincolante viene dai due grep (INTERNAL-ERROR /
> graph_compute-failed) + garanzia di codice. Erratum #45 (append-only, riga 29 NON
> riscritta): col tool adottato lo split storico 34/36 diventerebbe 58/12 — i 36 test
> INTERNAL-ERROR di #45 erano doppio-difettosi (CPU=nan E errore DSP insieme). Login/wizard/Connect/End QDC fatti
> dall'orchestratore dal browser Paseo (senza 2FA). Quota ~646 min.
>
> **1/09 sera — Lenovo RECUPERATO (ops, non cella).** Il PC era in Modern Standby
> (rientrava in <1 min da ogni risveglio; nessuna contromisura software teneva);
> riavvio autorizzato dall'owner in chat con BitLocker TPM-only verificato,
> `PlatformAoAcOverride=0` → `powercfg /a`: nessuno stato di sleep disponibile.
> Accesso: `gualt` + `~/.ssh/qdc_ed25519` (il "nessuna chiave autorizzata" del 29/08
> era chiave sbagliata da parte mia). Dettagli in memoria `lenovo-remote-access`.
>
> **1/09 sera — KIT NPU v79 v2 PRONTO, cella #46 in preregistrazione.** Fork branch
> `kalsa/npu-judge-v79` @ **93e9592fa** (local, non pushato): port della patch
> giudice q32 (`GGML_TEST_PLAIN_HOST=1` → reference ricopiato via get/set),
> `ggml-hexagon.cpp` flush_pending: dsp-rsp non-OK → `error_count` di sessione →
> `graph_compute` ritorna `GGML_STATUS_FAILED` (prima: log + `// TODO: handle
> errors`, fill random confrontato), compare del giudice controlla lo status,
> DUMP per-elemento spento; `llama-perplexity` aggiunto al kit. Build incrementale
> nel container ufficiale (nessuno skel ricompilato). Audit ostile mimo
> `AUDIT-KIT.md` APPLY + re-audit APPLY (una sua REFUTED: lo scanner Q4_1 leggeva
> già d e m). Kit `~/kalsa-qdc/npu-v79-cell/npu-kit-93e9592fa.tgz` (24 file,
> checksum OK, self-line esclusa). PREREG #46
> `scratchpad/agents/qdc-8elite-npu-v79-judge/` (ops con giudice vero + PPL
> HTP-vs-CPU 32 chunk sul modello di ship e su OLMoE, gate r ≤ 2 % come q55;
> corpus `wiki.test.raw` scaricato, sha = q43) sotto audit GLM. Nessuna sessione
> QDC finché non è APPLY; Connect = owner.
>
> **2/09 — DESK DIFETTI v79 CHIUSO SU CARTA: fix classe A committato, tre giudici
> in disaccordo risolti sul raw.** REPORT desk (grok,
> `scratchpad/agents/v79-defect-desk/`): classe A = contratto HMX host/DSP,
> classe B = 1 NaN q4_0 m=2880. Audit mimo **FIX** (4 MAJOR) → arbitrato Fable →
> **dissenso del writer accolto**: il "controesempio" F1 (`q4_0 m=576,n=512,k=576`
> INTERNAL-ERROR pur 32-allineata) era un misread da interleave pty — la lista
> finale `Failing tests:` (raw #46 `:2533-2570`, immune all'interleave) ha 37
> test e m=576 NON c'è; l'attribuzione la inchioda `blocks=256`=8192/32 (è del
> test m=1,n=2048,k=8192). **Il meccanismo %32 copre 36/36**; anche il "LARGE
> shape m=576" del REPORT #43 era lo stesso misread (erratum). Due errori veri
> però restano A VERBALE: l'audit F8 sbaglia l'aritmetica q8_0 (1024+128=1152>1088:
> stessa struttura 64-validi+64-pad di q4_0, costanti `matmul-ops.h:23-32`,
> `hmx-mm-kernels-tiled.h:48/442`) e il mio arbitrato aveva avallato F1
> (ERRATUM in `ARBITRATION.md`). Classe B genuinamente APERTA (né overflow fp16
> né scale-pad stabilite) → si discrimina SU DEVICE. **Fix classe A committato**:
> kalsallama `kalsa/npu-judge-v79` @ `736ddd206` (gate HMX su `src0->ne[1]%32`
> logico = contratto DSP, fallback HVX, 2 righe, compile-unverified → Docker);
> F12: le shape HMX dei modelli veri (#47, dims nelle righe execute-op) sono
> TUTTE %32-allineate → fix inerte su ship/OLMoE. Bozza cella **#48 rev-1**
> (`qdc-8elite-npu-v79-fixA-48/PREREG-DRAFT.md`, ~12 min): verifica fix
> (36→0 INTERNAL-ERROR, FAIL 37→1) + discriminazione B (determinismo ×3, k=1024,
> q8_0, n=64) — **da mostrare all'owner prima di accodare**. **AUDIT-2 (GLM)
> arrivato: FIX tutto-MINOR, il nucleo regge alla ri-derivazione indipendente**
> (F1 riconfermata per eliminazione; 3 siti DSP `n%32`; k già coperto; no
> regression). Sette MINOR applicati: due miei (retraction note in ARBITRATION +
> ERRATUM-2 su #43: lì m=576 fallì DAVVERO col giudice avvelenato `:1365`
> `CPU=nan`, i "36" di #43 e #46 sono insiemi diversi) e cinque di grok (rev-3:
> pin kit → tip `153fdbafd`, `:1826` è di q4_1 non q4_0, path F12 espliciti,
> secondo caller `is_mergeable_mul_mat :3488` documentato + clausola morta,
> classe B terzo candidato VTCM layout undercount non escluso). In più
> **`GGML_TEST_EXTRA_MM` aggiunto** a test-backend-ops (Luna `153fdbafd`, smoke
> A/B/C verdi su build CPU macOS, audit mimo APPLY zero difetti): shape probe a
> runtime per la #48. Branch `kalsa/npu-judge-v79` = `93e9592fa → 736ddd206 →
> 153fdbafd`, ogni commit col suo audit. DESK CHIUSO. Nessuna sessione QDC
> creata; prossimi: build Docker kit dal tip + ok owner sulla #48.
>
> **2/09 ~05:30 — CELLA #48 IN CODA: job 796621 `npu-v79-fixA-48`.** Owner ok in
> chat ("Ok vai"). Kit v3 `npu-kit-153fdbafd.tgz` (sha `e7ff4cd8…`, 22/24 file
> byte-identici al kit v2 certificato; sostituiti solo test-backend-ops +
> libggml-hexagon.so, build incrementale container exit 0, llvm-strip NDK).
> Prereg audit mimo **APPLY zero blocker** (quoting EXTRA sicuro, gate decidibili,
> timing stretto ma con over() graceful). QRD8750 645 min al submit, Available
> Now. Sessione: 20 min cap, SSH+mirror, chiave kalsa-mac, nessun package.
> Submitted 05:30:25. URL `qdc.qualcomm.com/reports/job/interactive/796621`.
> Non aprire un secondo job. Connect → connect.sh (tunnel 6037) → d_run.sh
> (R1 census+EXTRA, R2 ripetizione, R3 MUL_MAT_ID).
>
> **2/09 05:40 — #48 ESEGUITA E CHIUSA: driver DONE in 42 s, ~4 min fatturati
> (Started 05:36:29, Ended 05:40:09, End Session dell'orchestratore), la cella
> più economica della campagna. ~641 min residui.** Esito (verificato dal
> parse FIFO dell'orchestratore, 0 header spaiati, `ANALYSIS-orchestrator.md`):
> **GATE 1 PASS — INTERNAL-ERROR 36 → 0** su R1/R2/R3; 34/36 ex-IE ora OK via
> HVX; le 2 restanti (`q4_0 1/2048/8192`, `q8_0 6/4096/5120`) → "not
> supported" con meccanismo tracciato nel codice (supported_mul_mat:2875 →
> precompute:2589 sceglie HVX → VTCM > 8 MB → rifiuto pulito a monte al posto
> dell'errore runtime; erano già rotte in #46, non è regressione). **GATE 2
> PASS** (diff per-shape #46→R1: esattamente 40 cambi = 34 FAIL→OK + 2 FAIL→NS
> + 6 extra; nessun ex-OK degradato; controllo m=576 invariato OK). **GATE 3
> PASS: MUL_MAT_ID 301/301** giudice-on. **Classe B, discriminazione ricca**:
> in ENTRAMBI i run fallisce solo la PRIMA esecuzione della shape
> (NaN a **index 354** in R1 e R2 con dati d'input DIVERSI — CPU 3.17 vs 8.47;
> in #46 su binario diverso era index 305), le 3 repliche in coda passano;
> k=1024 OK, n=64 OK, q8_0 OK — slot fisso per binario, trigger al primo
> tocco, warm-up che maschera → **famiglia memoria-non-inizializzata favorita,
> overflow fp16 doppiamente sfavorito**; confound d'ordine (extra a fine
> census) dichiarato. REPORT delegato a Luna (d0618f8e), poi audit ostile e
> bank ALIVE riga 32.
>
> **2/09 — #48 BANCATA (ALIVE riga 32).** REPORT Luna (con 2 dissensi fondati
> contro l'ANALYSIS dell'orchestratore, errata accettati) + audit ostile mimo
> **APPLY, 0 blocker** (10 finding tutti CONFIRMED; 1 MAJOR = trappola census
> m=1,n=64 da mettere a verbale → addendum nel REPORT; 1 MINOR = lettera del
> gate 1 muta su IE→NS → addendum nel PREREG per le celle future; la catena
> VTCM/HVX delle 2 NS giudicata FORZATA dal codice, la lettura dei gate onesta).
> Nota canale: GLM/openrouter morto 3 volte per "Upstream idle timeout" (anche
> su sola scrittura) → audit ruotato su mimo fresco; Reviewer Math da tenere
> d'occhio. Il branch `kalsa/npu-judge-v79` (tip `153fdbafd`) resta locale, MAI
> pushato. Restano aperti: cella discriminante finale classe B (probe in testa
> al census + pad-zeroing, ~5 min, da preregistrare) e upstream del fix. ~641
> min QDC.
>
> **2/09 — PLAN AVANTI su due binari (lab giù, QDC su).** (1) **Cella #49**
> (classe B root-cause): bozza prereg scritta
> (`qdc-8elite-npu-v79-clsB-49/PREREG-DRAFT.md`) — probe a processo freddo
> (`GGML_TEST_EXTRA_MM_FIRST`) + skel diagnostico `HTP_ZERO_TILE_PAD`; scoperta
> architetturale verificata dall'orchestratore: il repack host impacchetta a
> stride 576 CONTIGUO (`repack_q4_0_tiled` :457-505), quindi il pad 64 B vive
> SOLO in VTCM (DMA 576→slot 640) → il probe è DSP-side, dual-skel nel kit.
> Luna d67db23e sta preparando i due change. (2) **Phase 2 prep FATTA**
> (`phase2-opencl-upstream-audit/CANDIDATES.md`): 40 commit upstream OpenCL dal
> merge-base, 3 pick raccomandati per 740/750 (`e8f19cc0ad70` q4_K/q5_K uint
> loads ~2× su E031.41; `43d87ff2dd0e` bounds/tiling image Adreno;
> `60addddf3c56` barrier FA multi-subgroup), #26476 GIÀ locale come
> `5c7e16fa6` (non ri-pickare), **flag: `43d87ff2dd0e` rende parzialmente
> obsoleto il redirect Q4_K di `dcd0a7607`** (riferimenti locali verificati su
> disco). I pick aspettano i gate S23 (~7/09). GLM/openrouter instabile oggi
> (3 timeout) — audit su mimo.
>
> **2/09 ~12:00 — #49 PRONTA AL LANCIO, QDC IN MANUTENZIONE.** Prep commit
> `ca82efa8b` (EXTRA_MM_FIRST prepend + HTP_ZERO_TILE_PAD guarded): audit
> ostile mimo **APPLY** (`clsB-49/AUDIT-PREP.md`, 13 check; unico MAJOR =
> fallback overflow pre-v75 in `dma_queue_push` che ritorna l'ULTIMA riga —
> codice MORTO su v79, verificato dall'orchestratore su `hex-dma.h` ramo
> `#else // HVX_ARCH >= 75` sempre 2D). `test-backend-ops` ARM ricompilato al
> tip nel container (il kit v3 era fermo a 153fdbafd) + llvm-strip →
> `06297299…`; **kit v4 assemblato**: `npu-kit-49.tgz` (`2f03e3a8…`, 44 file),
> `lib/` = skel stock CERTIFICATO `37131e07…` (stesso di #43-#48), `lib-zeropad/`
> = `398879cc…`, SHA256SUMS su tutte e tre le dir, record in
> `clsB-49/raw/kit_sha_host.txt`. PREREG rev-1 FINAL, ok owner in chat. Al
> momento dell'accodamento **qdc.qualcomm.com è in manutenzione** ("We'll be
> back shortly", tutte le rotte SPA → nginx 404): poll ogni 5 min sulla rotta
> report; wizard appena il portale torna su.
>
> **2/09 12:20 — #49 ESEGUITA E CHIUSA (job 797032, ~4 min fatturati, driver
> DONE in 64 s). RISULTATO A SORPRESA: il NaN classe B NON si riproduce in
> nessuna delle 4 run** — r1/r2 stock (skel certificato `37131e07`, attivo
> verificato on-device) e r3/r4 zeropad (`398879cc`): tutte
> `INTERNAL-ERROR=0 nan_diags=0 544/544`, failing list vuote, gate termici
> 8/8 PASS, EXIT=0 ×4. Prepend verificato (prime 4 eval = la shape, riga 28).
> Lettura onesta: in #48 la PRIMA esecuzione in-process era a metà censo
> (VTCM sporca) e NaN-ava; in #49 con FIRST=1 la prima esecuzione è a
> processo FREDDO e passa → **il trigger richiede stato sporco da op
> precedenti** (griglia caso 3 raffinato); l'occorrenza censo passa perché
> scaldata dai probe (masking atteso). **T1-vs-T2 resta APERTO** (stock
> pulito ⇒ il discriminatore zeropad non ha avuto segnale); bancabile: il
> non-repro a freddo + **zeropad skel SAFE (zero regressioni)**. Difetto di
> design ammesso: FIRST=1 su TUTTE le run ⇒ nessuna replica la condizione di
> riproduzione di #48; confound binario host (l'indice era binario-dipendente).
> Follow-up proposto: cella #50 stile-#48 (EXTRA appesa, NO FIRST) su stock +
> zeropad = vero discriminatore contro un NaN vivo. REPORT Luna in volo.
>
> **2/09 12:42 — #50 ESEGUITA E CHIUSA (job 797063, ~3.5 min, driver DONE
> 68 s): VERDETTO GRIGLIA CASO 2 — T1 REFUTATA, T2 PROMOSSA.** Owner ok in
> chat ("Ok approvo cella 50"); prep auditata mimo APPLY. Replica esatta #48
> (binario `5cf3565b`, EXTRA appesa, judge on): il NaN È TORNATO VIVO su
> stock (545/546 ×2) **e PERSISTE sulla skel zeropad** (545/546 ×2, skel
> attive verificate on-device) → **zerare il pad [576,640) NON cura: la
> scale-pad non-init NON è la causa (unica)**. Fatto nuovo: indici NaN ora
> INSTABILI run-per-run — stock 388/353 (non più 354!), zeropad 359/334,
> device f25c433a → la lettura "slot fisso del binario" di #46/#48 cade;
> lo slot avvelenato si muove con lo stato di sessione. IE=0 ovunque,
> unico fail = l'occorrenza censo della shape (F-8 rispettato). REPORT
> Luna + audit mimo in coda; bank righe 33 (#49) e 34 (#50) a valle.
>
> **2/09 ~13:15 — CLASSE B PARCHEGGIATA da known-defect documentato (decisione
> owner in chat).** Valutazione: reale-ma-contenuto — memoria non-init a causa
> ignota nel path HMX q4_0, MA entrambi i modelli veri passano la cert PPL #47
> proprio nella condizione trigger; la shape incriminata è solo del censo
> sintetico. **Regola di contenimento ora vincolante: nessun modello va su NPU
> senza cert PPL stile #47 su quel modello+quant** (becca la classe B su ogni
> geometria futura). Il desk di strumentazione DSP resta post-window e
> OPZIONALE: si riapre solo se un gate di cert fallisce. Righe ALIVE 30-34 =
> pista di evidenza completa. Il piano 10 giorni riprende dai binari aperti.
>
> **2/09 sera — `npu_fit` SU CARTA, AUDITATO (docs/NPU-FIT-MODEL.md +
> .AUDIT.md).** Il blocco che il governor design v2.1 elencava per accendere
> la lane R2: catena decisionale HMX/HVX/NS trascritta dal codice con quote,
> formule VTCM complete (gruppi A/B/C, clamp min/max_f32, chunk search),
> 4 esempi svolti a mano — **il totale dell'esempio ship (4.128.768 B) matcha
> cifra-per-cifra il vtcm loggato dal device in #47**: auto-validazione su
> shape reale. Set di accettazione = i 34+2+1 verdetti device di #48. Audit a
> staffetta (GLM sez. 1 aritmetica tutta CONFIRMED, poi canale morto ×2 oggi
> → mimo sez. 2-5): APPLY con 3 fix testuali applicati (F1 thread count, F4
> ramo prefetch `src1_nrows≤4`, F5 conteggio op fuse: 10.648 righe = 10.694
> op con MUL_MAT+ADD/doppie/triple srotolate — riconciliato al pezzo).
> Restano aperti gli input app-side (censo shape per modello) — §5 dello spec.

> La cronaca integrale è in **PLAN-archive.md** (spostata verbatim il 20/08,
> niente è andato perso). Regola invariata: ogni verdetto nuovo si appende QUI;
> quando questa vista supera ~300 righe, si archivia di nuovo.

## Dove siamo, in una frase

**LA MAPPA A TRE MOTORI È COMPLETA E MISURATA PER GENERAZIONE** (dettaglio:
`docs/ALIVE.md` §8). Le campagne chiuse, in ordine: (1) **GPU/Adreno** — i
kernel MoE OpenCL che upstream aveva spento: 4+1 miscompile E031 dissezionati
al bit e fixati + kernel q2_K/q3_K scritti da zero (esistono solo da noi),
407/407 su DUE compiler (740+750); decision table onesta: CPU vince il decode
ovunque, GPU = cool-mode su KEXP (740) o parità+prefill 2.5× (750). (2) **CPU
repack q2_K/q3_K v1** (#29) — residenza 6.6× dove il device sfratta, consolidato
su kalsallama `main`, **bug di produzione 3D fixato e mergiato 24/08
(`a0cabca6b`)**: arm di accettazione 464s sbloccato lato app. (3) **NPU/HTP**
— campagna 22–24/08: prefill-only ovunque (decode 0.37–0.63×, mai vinto);
denso/ibrido 3.5×/3.19× (v73/v75); **B′ Q8_0-trunk: gate PPL multilingue PASS
5/5 (meglio del control su OGNI lingua, +1.95% size, decisione owner strada
(a))**, tronco-su-NPU 1.46× (Marco/v75) con **primo J/token: 0.86× vs CPU**;
**PRIMA MONDIALE: esperti MoE eseguiti su NPU — pp512 686 t/s = 4.82× su v75**
(miglior rapporto NPU della campagna); v73 muore sui grafi MoE per due difetti
skel caratterizzati → **policy F6 owner-confirmed: esperti-su-NPU = v75-class
only**. Asse B comportamentale Marco-B′: **FAIL DEFINITIVO (q52, 24/08)** — col
sampler di PRODUZIONE (temp .7/topk 40/topp .95/minp .05) B′ degenera su
long_it_04 in 4 seed su 10 nell'escalation preregistrata (control 0/10;
totale sul prompt 5/23 vs 0/23), audit indipendente DeepSeek BANK-CLEAN
(420/420 righe ri-derivate identiche) → **il tronco di lineup RESTA Q5_K/Q6_K;
KEXP-Q8 non procede; B′ = variante da laboratorio NPU** con asterisco quality:
le corsie router tronco-B′ (R4/R7) ora devono un gate loop oltre alla
correttezza numerica. Metodo: PPL 5/5 e giudice cieco 6:1 non vedevano la
coda degenerativa; il gate loop sì. Per l'app: sweep -ngl bancato — costo GPU ≈ **750 MiB fissi + 1.0×byte**,
mmap invisibile a MemAvailable, copie GPU invisibili a RSS (il loro fit-gate
ora ha i numeri).

## Il capitolo del fix Adreno (nome interno: "trans4"), chiuso 19–20/08

| Difetto | Meccanismo | Fix | Verifica device |
|---|---|---|---|
| convert-READ | load `ushort8` disallineati | byte-wise, `9dc1ec0cb` (ago) | il −55% storico |
| restore-READ "R" | alias `as_ushort8` su registro privato (block-even) | shift/mask uint, `eaec5d884` | 5 tipi FAIL→PASS, f1/f2 chiuso |
| convert-WRITE "P" | rivettorizzazione byte-lane→short con shift aritmetici (gate: bit7 del byte pari) | path qs in uint scalare end-to-end, `f63746555` | raw 0, roundtrip 0 su 4 fill × 5 tipi × 2 arm |

- **Perché il test bocciava tutto**: `test-backend-ops` costruisce il giudice CPU
  copiando i pesi DALLA GPU via `get_tensor` → il restore rotto avvelenava
  qualunque giudice. Provato end-to-end con calibrazione f1/f2 a due punti.
- **e2e PASS ≠ fedeltà** (giudice e GPU condividono lo storage): la fedeltà la
  provano SOLO gli zeri del roundtrip e del raw readback.
- **La medicina Adreno è UNA**: uint scalare end-to-end, mai corsie uchar/short
  nel dataflow — la forma dell'espressione non cura nulla (tentativo #1, zero
  effetto). Upstream ha spento A6X/A7X intere "for now"; noi l'abbiamo dissezionato.
- **Smoke di produzione (20/08): IMMUNE DIMOSTRATO** — zero dispatch trans4 nel
  motore vero (shim con controllo positivo obbligato: il primo shim era cieco),
  zero path trans4-moe, output 64-token byte-identico col .so tutto-rotto.
- **KEXP = esperti Q2_K+Q3_K, tronco Q5_K/Q6_K** (verificato al gguf): la lineup
  di produzione non entra MAI nel perimetro trans4. Il fix è load-bearing per
  gpt-oss (MXFP4) e per i quant narrow su Adreno in generale.
- **Salvataggio**: tag `kalsakernel-v1` (`eaec5d884`) e `kalsakernel-v2`
  (`f63746555`), branch head `55f43a574` (shim smoke), bundle in `backups/`
  pushato su Aspis0/kalsa-moe-experiments.
- Report chiave: `scratchpad/agents/{oracle-consumer, retrial-s23, maxrecall-tracer,
  maxrecall-claims, maxrecall-puzzle, defectP-experiment, defectP-probe,
  defectP-fix2-verify, bmoe-smoke}/REPORT.md`; log grezzi con sha per-run in
  `results/oracle_consumer_s23/{run*, roundtrip, retrial, defectP*, bmoe_smoke}/`.

## Il capitolo K2 (chiuso 20/08 notte, tag `kalsakernel-v3` = `c1bb48d32`)

- **Difetto**: q4_K 0/80 + q5_K 0/4 su MUL_MAT_ID (GEMV e GEMM insieme), ERR
  spazzatura 0.57–0.96; q6_K 3/3 passa sullo stesso path (differenziale reale,
  verificato non-vacuo); il dense q4_K passa → solo il path MoE.
- **Quarto SITO di miscompilazione E031** (causa radice distinta dalle tre
  precedenti NON stabilita — wording vincolante dal MAX RECALL): le maschere
  **letterali** in `get_scale_min_k4`. Nei kernel dense Qualcomm le passava già
  come argomenti — il dodge era load-bearing e non l'hanno portato nei MoE.
- **Fix**: maschere come kernel args nei 4 kernel moe q4_K/q5_K + guardia ILA
  sul GEMM q4_K (il binario `_ila` ha la firma vecchia). Trasformazione
  semanticamente identica → FAIL→PASS è prova di miscompile (H5 morta); il
  trigger preciso (letterali vs forma ABI/programma) NON è isolato — dummy-arg
  test opzionale in coda. Innocenza del mask-then-shift qui provata da
  P1-da-solo (il null di P2 era non-diagnostico).
- **Verifica**: MUL_MAT_ID **391/391 su tutti i tipi**, dense 915/925 invariato
  (10 q6_K flat pre-esistenti → cherry-pick upstream #26476 candidato),
  roundtrip 0. `-cl-opt-disable` NON compila su E031 (err -6, commento in-tree
  corretto). SIGSEGV della suite piena = harness/OOM, PAD isolato passa
  anche pre-fix (nota aperta, fuori perimetro).
- MAX RECALL 3 angoli: forense CLEAN (gap E2/E3b chiuso coi summary estratti
  on-device), commit-review BANK, epistemico sound-with-rewording (applicati).
- Evidenza: `scratchpad/agents/k2-fix/REPORT.md`,
  `results/oracle_consumer_s23/k2_phase1/` (MANIFEST con sha per-run);
  bundle `backups/kalsakernel-v3.bundle`; outer commit `d265854e`.

## Il capitolo qk23 (chiuso 21/08 sera, tag `kalsakernel-v4` = `ec7235af`)

- **Capacità NUOVA, non riparazione**: kernel MoE MUL_MAT_ID q2_K/q3_K per
  Adreno — upstream non li ha per nessuna generazione (fallback CPU ovunque).
  Con questi, gli **esperti KEXP (Q2_K+Q3_K) girano su GPU per la prima volta**.
- **Metodo (un giorno, zero sessioni device sprecate)**: DESIGN triple-audited
  (2 pass Luna + verifica formale Free coder) PRIMA del codice → storage con
  biiezioni **certificate all'oracolo** contro il riferimento CPU (nfail=0,
  max_abs=0, inclusi superblocchi dispari e metà alta hmask — la rete che al
  trans4 mancava) → kernel col pattern **barrier-safe** (tutte le lane a tutte
  le barrier, load clampati, store predicati) → `supports_op` per ultimo.
- **Verifica**: MUL_MAT_ID **401/401** (baseline 391 intatta + 8 casi nuovi + 2
  discriminatori GEMM m=96), dense invariato, roundtrip/oracle puliti anche su
  const00/hmask16 (harness ora stampa `fill=`), smoke LFM2.5 `-ngl 99`
  `n_cpu_moe=0` con tutti e 4 i kernel nuovi in dispatch (controllo positivo) e
  output coerente; tg64 15.09 t/s = smoke di funzione, NON claim di velocità.
- **Scoperta collaterale (5° difetto, review-found)**: i cloni q4/q5/q6 hanno
  early-return prima della barrier + OOB GEMM su shape `%32 && !%64` (dormiente:
  ogni shape attuale è %64). q2/q3 nascono immuni (m=96 device-proven su GEMV e
  GEMM); port di famiglia = coda #13.
- Medicina rispettata dal giorno uno: maschere come argomenti, shift-first,
  uint scalare, niente alias privati. Commit `dcc8eecec` (S1+S2) → `f700bf30`
  (S3+S4) → `2217d61a`/`8f70ba394` (test) → `ec7235af` (cleanup, tag v4).
- Evidenza: `scratchpad/agents/qk23-kernels/{DESIGN.md,REPORT.md}`,
  `results/qk23_s23/` (MANIFEST con sha per-run), bundle
  `backups/kalsakernel-v4.bundle`, outer `b28d5759`.

## Voce #3 chiusa (21/08 pomeriggio): cherry-pick upstream #26476

- **Fatto**: cherry-pick di `6503355df` (PR #26476: q6_K flat dense dequant
  SCALARE + flag `ADRENO_OLD_COMPILER`) su `kalsa/kernel-s3-repack` →
  commit `5c7e16fa6` (sopra v4, nessun tag). Un solo conflitto: adattata la
  firma vecchia di `build_program_from_source`, opzioni q6k intatte.
- **Verifica S23 (staccato, 80%)**: dense MUL_MAT **925/925** — i 10 q6_K
  flat FAIL storici chiusi; MUL_MAT_ID **401/401 invariato**; sha256
  on-device nei run header = build PC (`b9d99fa8…`). Zero FAIL.
- **Audit ostile (Free coder), verdetto BANK**: diff-of-diffs byte-identico
  fuori dall'adattamento documentato; arg 0..17 contigui, un solo sito di
  build/dispatch; path senza flag == parent (ifdef-strip meccanico);
  perimetro 2 file, medicina nostra intoccata; evidenza genuina (sha log
  ricalcolati). **F1 CONFIRMED (ereditato upstream, perf-only)**: il gate a
  `ggml-opencl.cpp:6019` non ha la guardia `gpu_family != ADRENO` che i gate
  q4_0 hanno → su Intel `q6_k_flat_old_compiler` è true e paga il 13–20%;
  correttezza preservata. F3 PLAUSIBLE latente: parser senza ramo E17.
- Evidenza: `scratchpad/agents/q6k-cherry/REPORT.md`,
  `scratchpad/agents/q6k-cherry-audit/REPORT.md`,
  `results/q6k_cherry_s23/MANIFEST.md`; bundle
  `backups/kalsakernel-v4-plus-26476.bundle`.

## Sessione device 21/08 sera: OLMoE N≥5 SHIP + KEXP 1.81× (voci #10 e #14)

- **OLMoE confermativa (PREREG v1.2, emendata pre-analisi N≥10→N≥5): SHIP.**
  5/5 blocchi ABBA completi, tutti cool-start, zero esclusioni, zero wall.
  Mediana tg512 **A (esperti GPU) 16.36 vs B (esperti CPU) 10.53 = 1.553×**,
  picco termico mediano A 38.4 ≤ B 38.95 °C (più veloce E più fresco). Tutti
  e 7 i criteri ship verificati dal grezzo. Pin congelati rispettati
  (`d2030f23`/`2ed2e48a`, ngl=16, -t 4, -fa off). Claim scopato: S23+OLMoE,
  modello in RAM, N≥5 v1.2.
- **KEXP #14 (esplorativa, NON ship)**: LFM2.5-8B-A1B-KEXP (`b07c8087…`),
  build v4+#26476 (`b9d99fa8`), 2 blocchi ABBA: mediana tg512
  **A 13.74 vs B 7.58 = 1.81×**, A più fresco (37.25 vs 38.2 picco mediano).
  Gli esperti Q2/Q3 sui NOSTRI kernel a -ngl 99, sustained. NOTA: B =
  tronco-GPU/esperti-CPU, NON baseline CPU-pura — l'arm C (-ngl 0, "quello
  che upstream dà oggi") non è mai stato misurato: serve per la frase da
  dossier. Decadimento intra-blocco arm A ~24% (prima-A fredda vs seconda-A
  calda; B piatto) — fisiologico ma da discutere nella prereg KEXP.
- **Mellum2 (esplorativa)**: load sanity ngl=2/ncmoe99 VIVE, tg 0.2227 (primo
  numero GPU Mellum2); cella esperti-GPU ngl=2 UCCISA dall'harness a ~75 min
  mentre calcolava (rc=143, no jsonl, no wall/cliff — errore ammesso +
  Dozing mid-cell): NESSUN datapoint strumentale, classe ~0.15 t/s solo come
  inferenza wall-clock. Verdetto: esperti-GPU non viable in streaming — la
  valvola GPU rende quando il modello sta in RAM, coerente con l'oomwall.
- **Audit ostile (Free coder): BANK.** 28/28 tg512 csv=jsonl (sha-unici,
  test_time nelle finestre iso), mediane esatte, gate tutti verdi, ABBA e
  timestamp monotoni, zero celle nascoste, v1.2 provata pre-dati dal
  session.log. Igiene applicata: 39.0→38.95, pausa KEXP ricollocata in
  `results/kexp_speed_s23/pauses/`, nota F10 (kill+Dozing) a verbale;
  prossima sessione: archiviare il raw delle probe, cap wall-clock
  pre-dichiarato per celle esplorative.
- Evidenza: `results/olmoe_gpu_moe_s23/n10/` (runs.csv, jsonl, MANIFEST),
  `results/kexp_speed_s23/`, report `scratchpad/agents/n10-kexp-session/`,
  audit `scratchpad/agents/n10-kexp-audit/REPORT.md`.

## Sessione ship #18 (22/08 notte): A/B REPLICA, A/C REFUTED — la CPU pura vince

- **Protocollo**: PREREG_KEXP_N5 v1.2 (lock `618323c` citato nel session.log,
  criterio 11). 5 blocchi palindromi A,B,C,C,B,A completi (1,2,3,5,6), tutti
  cool-start; blocco 4 buttato intero da regola 7 (B5 Dozing a wake_post,
  rc=0 archiviato, escluso). Zero SIGTERM, zero wall, pin v1.2 rispettati
  (`no_repack=true` su ogni cella contata, sha per-cella).
- **Mediani (n=10/arm, ricalcolati da orchestratore E auditor, esatti)**:
  A (`-ngl 99`) **14.252** t/s picco 37.2°C · B (`-ngl 99 -ncmoe 99`)
  **7.904** picco 39.4 · C (`-ngl 0`) **17.553** picco 39.95.
- **A/B = 1.803 ≥ 1.50 PASS** (+ A più fredda di 2.2°C): il claim
  "esperti-GPU battono esperti-CPU a parità di offload" replica l'esplorativa
  1.81 sotto prereg — secondo dataset concorde.
- **A/C = 0.812 < 1.20 → REFUTE della frase dossier "vs product default"**:
  la CPU pura è PIÙ VELOCE della GPU piena su LFM2.5-KEXP (A1B: ~1B attivi,
  l'8Gen2 a 4t macina i GEMV piccoli meglio di quanto la GPU ammortizzi il
  dispatch). Il pacchetto confermativo NON shippa (criterio 4). Branch
  verbatim da prereg, nessun branch-shopping (audit).
- **B è il peggiore dei tre** (ping-pong per-layer del mezzo-offload) e
  **il repack stock non aiuta la CPU** su questa ricetta (arm D post-bag,
  n=2 descrittivo: 16.48/15.51 — MAI citarlo come "gap upstream vero" senza
  i caveat hot-state, monito audit).
- **Lettura prodotto**: su LFM2.5-KEXP/S23 la config veloce è CPU pura; la
  GPU piena è la modalità FRESCA (−19% velocità, −2.75°C sul picco). Il
  claim OLMoE SHIP resta valido (scopato A-vs-B); se anche su OLMoE la C
  batta A è la domanda aperta → coda #20.
- **Audit (Free coder): BANK** — 36/36 csv↔jsonl, C attaccata e sopravvissuta
  (n_gpu_layers=0, wall coerente, firma termica da CPU vera, corroborazione
  D), esclusione blocco 4 da manuale, cool-start legali fino al bordo 35.0.
  Minori: compressione "20-31%" del decay nel summary (report giusti),
  true/True misto in una colonna csv, caveat D nel dossier.
- Evidenza: `results/kexp_speed_s23/n5/` (runs.csv, cells, probes, block
  meta), `scratchpad/agents/kexp-n5-session/REPORT.md`,
  `scratchpad/agents/kexp-n5-audit/REPORT.md`.

## Sessione #20 + #6-lite (22/08 pomeriggio): il verdetto C è unanime; prime card S23 validabili

- **#20 OLMoE arm C (cella di decisione, 3 blocchi A,C,C,A, 12/12, tutti
  cool-start, build head, audit BANK-with-corrections)**: mediane
  **A(-ngl16) 20.034 vs C(-ngl0) 27.685, A/C 0.724** — **C batte A in OGNI
  cella di OGNI blocco**; decisione invariante sotto pruning (coolest-only
  0.809, drop-block-3 0.769; il bias quadratico del palindromo deprime A =
  anti-conservativo, verificato). **Framing vincolante (erratum audit): su
  OLMoE la GPU piena è "più lenta a quasi-parità termica"** (gap mediano
  0.45°C, picchi max identici 38.5) — NON "cool mode": quello resta solo
  KEXP (2.75°C). Cross-build binding: mai confrontare con i numeri n10
  (stesso arm nominale si è mosso ~22% tra build). Il claim OLMoE SHIP
  1.553× resta valido nel suo scope (A vs B a pari ngl).
- **Sintesi dossier a valle di #18+#20**: sui MoE small-active (A1B/1B-7B)
  la CPU pura vince SEMPRE in velocità sulla GPU piena; il mezzo-offload
  (B) è il peggiore; il valore dei nostri kernel = path GPU unico
  funzionante (Vulkan morto), 1.8× sull'expert placement a pari offload, e
  modalità fresca reale solo su KEXP. Niente "GPU default candidate".
- **#6-lite lineup absolutes (audit BANK-with-corrections)**: PRIMO set di
  card S23 **validabili** — gate cpuset funzionante e letto sul PID del
  binario (cpuset `/`, 0-7, bits 8; lo storico 0-2/nproc=3 non c'è più):
  **Marco1c-KEXP t4 8.199** (modello a bordo 6.4G KEXP ≠ card 8.82
  i1-Q4_K_M: non comparabile), **CalaQwen t4 k6d1.0-no-renorm 6.810**
  (default corrente: PIÙ VELOCE della card vecchia 5.86 k6d065),
  **Mellum2 t2 5.098** (≈card 5.151). Metrica: decode tok/s a EOS
  (n_gen 122/224/222 — da stampare accanto alle card), TTFT escluso by
  construction, spread 2.1/7.5/4.3%. Correzioni da applicare al prossimo
  giro: enforcement (non solo detect) del gate lato binario.
- Evidenza: `results/olmoe_gpu_moe_s23/armC/`, `results/lineup_abs_s23/`,
  report+audit in `scratchpad/agents/{olmoe-armC,lineup-abs,armC-lineup-audit}/`.

## Sessione #16 — Xiaomi 14 / Adreno 750 (22/08 sera, staccato 98→94%, audit Luna BANK-w-corrections)

Compilatore 750: **E031.45.02.25** (S23: E031.41.03.62 — riferimento storico, non
nei raw S23). Tre verdetti:

1. **I kernel MoE TRASFERISCONO: MUL_MAT_ID 407/407** col compilatore nuovo
   (q4_K 82, q5_K 6, q2/q3/q6_K 5 ciascuno, narrow+mxfp4 tutti OK, discriminatori
   m=96 / n_mats=64+k=2304 PASS, rc=0). Il cuore della campagna vale su A7X
   con DUE compiler diversi.
2. **Il compilatore NUOVO rompe un path che il vecchio passava**: MUL_MAT dense
   **905/925** — 20 FAIL tutti f16/bf16×f32 m=128 n=1 k=1056 k_v=2112, e la
   correzione d'audit: falliscono i casi **nr≠[1,1]**, passano TUTTI gli
   nr=[1,1] (ogni bs testato) e i f32×f32. Set di fail deterministico tra run
   (ERR 0.10–0.19, valori non bit-identici per RNG dei tensori). È un difetto
   inedito di E031.45 su path upstream (f16 batched), non tocca i nostri
   kernel — oro per il dossier #8 ("ogni E031 rompe cose diverse").
   Attribuzione al compilatore = ipotesi forte, non isolata formalmente.
3. **A/B/C KEXP (ESPLORATIVA: N=3, tg128, celle in Doze — non confermativa)**:
   A tg **24.47** / B **7.40** / C **24.28**; pp128 A **87.4** / B 40.6 / C 39.6.
   **Sul 750 il verdetto S23 "C vince sempre" NON trasferisce**: decode
   A/C = 1.008 (parità) e prefill A = 2.21× C. B peggiore: confermato ovunque.
   Controllo Doze: C schermo-acceso 23.68 ≈ bag 24.28 (Doze non spiega la
   parità; houji non tiene lo schermo sveglio, wake_post=Dozing su tutte).
4. Prefill dense Qwen3.5-2B (head): GPU **invariata** (181.5 ≈ 181.7 storico);
   è la CPU head a essere ~4× agosto → rapporti onesti **1.43×/1.73×**
   (vs CPU repack) e **2.62×/3.18×** (vs CPU `-nr`). Il 5.77× storico era
   una baseline CPU debole, non una GPU migliore.

5. **Fase d (stessa sera, audit Luna BANK-w-corrections):** (a) **conferma A/C
   su LFM-KEXP a N=5** — 10 celle ACACACACAC, 10/10 rc=0, TUTTE Awake, gguf
   hashato on-device (correzione audit applicata): **A/C decode 0.992,
   prefill 2.477**. La parità decode sul 750 non è più esplorativa: è un
   numero con protocollo. (b) **Marco-KEXP 6.385G sul 750: fit-gate
   FAIL-HARD** — lo smoke `-ngl 99` restituisce perfino jsonl valido
   (pp16 20.4, tg8 23.9) e il device subisce un **kernel reboot** poco dopo
   (uptime 1 min al reconnect; il nesso causale e il timing "~3 min" sono
   inferenza, a verbale). MAI più full-GPU su questo GGUF/750. Arm A/B
   cancellati; riga C sopravvissuta (N=3, spread ~12%, caveat): **tg 28.2 /
   pp 41.8** — Marco in RAM sul 750 fa ~3.4× l'S23 (8.2, dove NON sta in
   RAM: il fit domina qualunque ottimizzazione. Nota: il primo "crash"
   osservato dall'owner era thrashing con uptime ancora 6 giorni; il reboot
   vero è successivo — disentangled nel report).

Gap di provenance a verbale (audit, fasi b/c — CORRETTO in fase d): hash gguf
lato device non registrato in b/c; i prossimi harness lo hashano on-device
(fase d già conforme). Evidenza `results/xiaomi750_validation/`, report
`scratchpad/agents/q16-xiaomi/`, audit `scratchpad/agents/q16-xiaomi-audit/`.
Follow-up naturali: #22-bis chiuso di fatto (Marco-750: C-only, fit-gate
FAIL-hard per la GPU), segnalazione upstream del cluster f16 (dossier #8).

## LA SPIEGAZIONE SEMPLICE (per non fraintendersi mai più, 22/08)

Tre configurazioni sul KEXP (S23, misurate):

| | t/s | note |
|---|---:|---|
| CPU pura | **17.5** | la più veloce, sempre |
| GPU coi NOSTRI kernel (tutto su GPU) | 14.25 | −19%, ma **−2.75°C** |
| GPU SENZA i nostri kernel (= mezzo offload forzato) | 7.9 | −55%, e più calda di A |

- Il **1.8× non è "GPU batte CPU"**: è il rapporto tra riga 2 e riga 3 —
  quanto i kernel migliorano la *modalità GPU*, che senza di loro è
  inguardabile (chi offloada un KEXP senza kernel q2/q3 finisce FORZATO
  nella riga 3).
- Regola utente: **velocità → CPU pura; fresco (KEXP) → GPU**, che coi
  kernel costa −19% invece di −55%. Su OLMoE la GPU non dà nemmeno il
  fresco (parità termica): solo più lenta.
- **Streaming (modelli che non stanno in RAM)**: la GPU è irrilevante
  (0.216 vs 0.223 same-harness); conta solo la ricetta (5.10).
- **Prefill dense**: su 750 ri-misurato 22/08 coi kernel a posto: GPU
  invariata ma CPU head 4× più veloce di agosto → onesto **1.43×** (vs CPU
  repack) / **2.62×** (vs CPU -nr) a pp128, cresce a pp512. Su 740 il
  misurato resta 1.12× (lane K-G, non vale).
- **⚠️ La regola "velocità → CPU pura" è del 740/S23**: sul **750** la #16
  dà **parità decode (A/C 0.992, N=5 con protocollo) e prefill A=2.48×**
  sul KEXP — sul 750-class la GPU piena coi nostri kernel è candidata
  default per i modelli che ci stanno. Limite duro: il fit — Marco 6.4G
  full-GPU sul 750 = kernel reboot (fit-gate FAIL-hard), e in RAM su CPU fa
  comunque 28.2 t/s (3.4× l'S23 dove non sta in RAM).
- **NPU (HTP)**: bocciata con evidenza (carica 0.67 MiB di pesi = non
  carica il modello; PowerInfer-2 chiuso). Fisica: il decode è
  DRAM-bound, l'NPU non ha banda sua. Termometro `nspss-*` già leggibile
  se mai si riaprisse.

## Fatti operativi correnti

- **Lignaggio engine — CONSOLIDATO 22/08 sera (decisione gualt: "opzione A")**:
  il fork llama.cpp ha ora una casa GitHub propria, **`Aspis0/kalsallama`**
  (privato): tutti i branch pushati (`kalsa/kernel-s3-repack` head `1882bf8cd`,
  più s1/s2, `mmap-prefetch-opt`, mld-gemv-m1, q6k-dispatch-fix, split-trunk-gpu,
  master) + tag v1–v4. Checkout locale: `BigMoeOnEdge/third_party/llama.cpp`,
  origin = kalsallama, pre-push hook riscritto **allow-list solo
  `github.com/Aspis0/*`** (testato: terzi exit 1, Aspis0 exit 0; in più le
  credenziali Aspis0 prendono 403 sui repo terzi). `.gitmodules` di BigMoeOnEdge
  ora punta a kalsallama (commit `9f2584f`, pushato): **il rischio
  "`submodule sync` resuscita Helldez" è morto**. DUE lignaggi legittimi,
  entrambi in kalsallama: `kernel-s3-repack` (GPU/Adreno) e
  `mmap-prefetch-opt` (hook CPU expert-ready `5236140e5`, quello che la patch
  llama.rn dell'app rispecchia con prefisso `lm_` — il nome
  "bmoe/expert-ready-hook" citato nei commenti dell'app NON esiste, va
  corretto). La copia vendored `kalsa-engine/` è stata ELIMINATA dopo verifica
  di zero contenuto unico (llama.cpp byte-identico a `e5605f3bd`, 18 Kotlin
  hash-identici a drop-policy-s2); i suoi bundle sono in
  `backups/engine-bundles/`. Mappa ruoli in `docs/ENGINE.md`. Banner
  "kalsallama" nel version string: ancora da introdurre.
- **.so correnti**: kalsakernel-v2 pulito = `2032b7c7…`; build smoke con shim
  dormiente (head) = post-`55f43a574`. Sempre sha256 on-device prima di ogni run.
- **S23**: 21G liberi su /data, `LFM2.5-8B-A1B-KEXP.gguf` a bordo, wireless adb
  (`adb-R3CW406P8CV-…`) funzionante, USB da autorizzare al popup.
- **Provider (20/08 notte)**: grok torna ~19:00; opencode-go (GLM/mimo/v4-flash)
  a tetto 5h (reset ~00:45); quota free qwen-model-studio-sg esaurita (kimi,
  qwen3.7/3.8); codex Luna/Sol vivi. La lista profili è legge.
- **BigMoeOnEdge**: working tree SPORCO con WIP non nostro (cli/main.cpp,
  session.cpp…) su `kalsa/drop-policy-s2` — non committare, non stashare.

## Coda aperta (in ordine)

| # | Cosa | Chi/quando |
|---|---|---|
| ~~1~~ | ~~**K2**: q4_K/q5_K MUL_MAT_ID compute~~ → **CHIUSO 20/08 notte** (kalsakernel-v3, vedi capitolo sopra) | fatto |
| ~~2~~ | ~~Supporto q2_K/q3_K MoE su GPU~~ → **CHIUSO 21/08 sera** (kalsakernel-v4, vedi capitolo qk23: KEXP experts su GPU, 401/401) | fatto |
| ~~3~~ | ~~Cherry-pick upstream **#26476**~~ → **CHIUSO 21/08 pomeriggio** (`5c7e16fa6`, dense 925/925, MoE 401/401 invariato, audit BANK — vedi sezione sopra) | fatto |
| ~~4~~ | ~~Cosmetici cvt.cl + port uniformità~~ → **CHIUSO 22/08 con esito misto**: commenti fixati (`1882bf8cd`, audit: ora dicono il vero — l'offset-4 era la bugia). **Port di uniformità RESPINTO dall'audit e scartato** (commit droppato): equivalenza piena falsa (vale solo sotto l'invariante maschere dell'engine, controesempio ABI agli atti) E medicina non raggiunta (alias `qv_bytes` e lane uchar qh sopravvissuti = terzo stile misto). Su codice device-proven un mezzo-port è peggio del debito. Se mai si rifà: spec vincolante in `scratchpad/agents/cvt-hygiene-audit/REPORT.md` (pattern canonico q3/q5_1, zero alias, zero uchar, equivalenza dichiarata sotto invariante). Nota F4: copie generate stantie fuori dall'albero git = rischio deploy, verificare rigenerazione a ogni build | fatto |
| ~~5~~ | ~~LANE_MOD equidistribution check~~ → **CHIUSO 22/08: BIASED by construction** (3 classi di falso-tag, 2 silenziose; MAI scattato sui 76 casi d'archivio, tutti n_bad=0). Audit: BIASED confermato, gate gap-equality UTILE MA INSUFFICIENTE (manca unioni threshold-boundary e slot-dependent). Vincoli sessione-2 (erratum nel report): LANE_MOD = hint mai verdetto; gate solo come hardening; canale di decisione = dump grezzi (bad-row/tabella residui, OBBLIGO di raccolta). `scratchpad/agents/lane-mod-check/` | fatto |
| 6 | ~~assoluti lineup~~ **fatti 22/08** (#6-lite, card validabili col gate cpuset — vedi capitolo). RESTANO: celle cache S23 (sweep 1500/2000/4000) + enforcement del gate lato binario (oggi detect-only, correzione audit) + card Marco1c sul modello i1-Q4_K_M vero se lo si rimette a bordo | sessione device dedicata |
| 7 | Gap ~70% kernel_kf vs lineup binary | da investigare |
| 8 | **Pubblicazione del fix Adreno** (dossier aggiornato 22/08: 3 miscompile trans4 al bit + 4° sito K2 device-verified + **5° difetto FIXATO e device-VERIFIED** (407/407) + repack-killer 8GB + kernel MoE q2/q3 inediti + **SHIP pre-registrato 1.553× OLMoE** + KEXP 1.81× esplorativo + **Vulkan su A740 = zero K-quant eseguibili** (supports_op bugiardo, SIGABRT su createComputePipeline: il nostro path OpenCL è l'UNICA GPU funzionante per MoE quantizzati su S23); gate A6X/A7X ancora attivo upstream). **Contesto mercato (owner, 22/08)**: su Mali i backend generici buttano il silicio (<3% ALU util in prefill vs ~20% Adreno, arXiv 2410.03613) → la lane Adreno-only è quella dove i kernel pagano; 8xx: correttezza via cloud farm, niente hardware fisico per ora — `docs/research-adreno-vs-mali-8xx-2026-08.md` | decisione owner |
| ~~9~~ | ~~Muro GPU-MoE su S23~~ → **RISOLTO 21/08 (oomwall)**: era il **REPACK ARM di default di llama-bench** (~6.5GB posix_memalign anonimi su Mellum2 Q4_K_M; CPU-only, GPU innocente — coppia W4/W4c a una variabile; produzione strutturalmente immune, use_extra_bufts=false). `results/oomwall_s23/` | fatto |
| ~~10~~ | ~~Cella pre-registrata GPU-esperti OLMoE~~ → **CHIUSO 21/08 sera: SHIP 1.553×** (N≥5 v1.2, audit BANK — vedi sezione sessione device) | fatto |
| ~~11~~ | ~~Flag llama-bench + guardia FA~~ → **CHIUSO 21/08 notte (PC-side)**: `-nr/--no-repack` canonico (alias nascosto `--no-extra-bufts`, tutti i formati output, dedup permutazioni) + reject FLASH_ATTN in supports_op (mappa 1:1, carve-out A7X intatto, guardia backend_ctx). Commit `815b8edc2`+`b5ef768af`+`c77fe1354`, audit BANK→LOCK. Smoke device del flag nella sessione di verifica #13 | fatto |
| 12 | Opzionali bassa priorità: dummy-arg attribution test (isola il trigger C1); triage SIGSEGV harness full-suite; stessa classe di crash del ne01==0 su `ne11==0`/`ne20==0` (nota audit #17, host-side) | quando capita |
| ~~13~~ | ~~barrier-safe port q4/q5/q6~~ → **CHIUSO 22/08 notte: device-VERIFIED** — MUL_MAT_ID **407/407** (baseline 401 sottoinsieme passante + 6 discriminatori m=96), controllo positivo 10/10 coi kernel nuovi in dispatch (no `_ila`, no fallback CPU), dense 925/925 invariato, residuo ILA **risolto** (bin kernels compilati out, guardia host inattiva), smoke `-nr`/alias PASS (run (a) repack-on SKIPpata per headroom: 4.53GiB vs 3.92+2). Unico residuo: edge `ne01==0` (condiviso coi q2/q3, non ammissibile nei test %32 — annotato in #17). Evidenza `results/barrier_verify_s23/` | fatto |
| ~~14~~ | ~~Cella velocità KEXP-su-GPU~~ → **CHIUSO 21/08 sera (esplorativa): 1.81×** A/B su LFM2.5-KEXP (vedi sezione sessione device); per la ship serve #18 | fatto |
| ~~15~~ | ~~Vulkan vs OpenCL su S23~~ → **CHIUSO 22/08 notte (plugged-exploratory): RAPPORTO NON STIMABILE — Vulkan non esegue NESSUN K-quant su A740.** Il backend si alza (fp16=1, warp=64, shmem 32K, no matrix cores), f16 242/242, ma OGNI pipeline K-quant (mul_mat q4_K, matmul_id subgroup q2/q3/q4_K) muore in `createComputePipeline ErrorUnknown` → eccezione vk::SystemError non catturata → SIGABRT; `supports_op` dichiara SUPPORTED (mente: nessun check filtra questi shader sul driver Qualcomm). llama-bench OLMoE -ngl 99 abort in llama_decode. Speed cell V/O impossibile: un arm è morto. **Asimmetria da dossier: sullo stesso device/head, OpenCL coi NOSTRI kernel fa 407/407.** Doppia classe upstream-worthy: supports_op bugiardo + crash non gestito (stessa famiglia del nostro fix FA map::at). Evidenza `results/vulkan_vs_opencl_s23/` | fatto |
| ~~16~~ | ~~Validazione Xiaomi/Adreno 750~~ → **CHIUSO 22/08 sera (audit Luna BANK-w-corrections)**: **MUL_MAT_ID 407/407 col compilatore nuovo E031.45.02.25** (i kernel MoE trasferiscono su tutta la famiglia A7X) MA **MUL_MAT dense 905/925**: 20 FAIL f16/bf16 batched nr≠[1,1] (k=1056/k_v=2112, set deterministico) = difetto inedito di E031.45 su path upstream. A/B/C esplorativa: **sul 750 A≈C decode (1.008) + A=2.21× prefill** — "C vince sempre" era un fatto del 740, non della famiglia; B peggiore ovunque. Prefill dense: 5.77× storico → onesto 1.43×/2.62× (CPU head 4× più veloce, GPU invariata). Vedi capitolo | fatto |
| 24 | **Governor termico TRI-ENGINE (design study)** — direttiva gualt 22/08 sera: **NPU-prefill / CPU-decode / GPU-cool**. (1) NPU per gli spike compute-bound (leggere documenti/pagine, TTFT, embeddings): NON richiede switch — lo scheduler llama.cpp manda il prefill all'HTP e il decode ricade su CPU nello stesso processo (è così che nasce il 461 tok/s upstream); (2) CPU = decode re dello streaming; (3) GPU su soglia skin temp = cool-mode (740) o parità (750); lo switch del DECODE resta reload (mmap, secondi) → isteresi + costo switch da misurare + J/token veri (charge_counter). Bonus termico: tre domini di silicio (nspss-* leggibile) = calore distribuito nelle sessioni lunghe. Vincolo quant: HTP solo Q4_0-family → per KEXP serve doppia-quant del tronco o kernel HVX (28c). Prima il design su carta, poi il prototipo. **DESIGN STUDY FATTO 26/08 notte: `docs/GOVERNOR-TRI-ENGINE-DESIGN.md` v2.1** (audit DeepSeek: v1 2 BLOCKER + 14 MAJOR → v2 17/17 fixati → v2.1 3 residui fixati; `docs/GOVERNOR-TRI-ENGINE-DESIGN.AUDIT.md`). Contenuto: costanti misurate per generazione (velocità/engine, pendenze termiche — design slope 3.6 °C/min da q53c, tabella ΔT per prompt q58, costi di switch: prefill→CPU gratis nello stesso processo, switch decode = reload), macchina a stati FAST/WARM/COOLMODE/CRITICAL/LOWBAT su temperatura batteria (unico sensore leggibile su S23 e houji) con isteresi, **soglie RELATIVE a T_idle misurato da attaccato** (uscita CRITICAL mai sotto T_idle+1: niente deadlock; cap 42 sotto KILL 43), **regola di ammissione pre-turno** (T_now + ΔT_tabella(size, engine) ≤ 39.5, fuori tabella/oversize/GPU-prefill → rifiuto o chunking: il governor previene il kill del watchdog invece di subirlo), regime "hot-plugged = CPU-only, cool-mode collassato" dichiarato, break-even cool-mode con i priori bancati (throttle solo ≥ 38 °C nel record), composizione col router v0.2 → LaunchConfig v0.3 (`decode_engine ∈ {cpu, gpu_coolmode}`, golden test), corsie invariate; **oggi NESSUNA corsia NPU è ON** (R2 certified ma OFF, R3 caratterizzazione 10 chunk, R6/R7 hard OFF). Celle mancanti G1–G5 pronte da prereg (G1 curva di throttle CPU su S23 attaccato = la più preziosa; G5 NPU solo scollegato, post-finestra, regola INCIDENT_THERMAL). Prototipo: dopo G1 + crossover (piano 10 giorni §6). | design fatto (v2.1, auditato); prototipo dopo G1 |
| ~~17~~ | ~~guardia gpu_family + parser + ne01==0~~ → **CHIUSO 22/08**: commit `dc3870579` (guardia ADRENO sul gate q6, parità coi gate q4_0, prova d'ordinamento init→build-opts→dispatch), `8e0063d2a` (fallback `UNKNOWN_COMPILER` esplicito; E17 NON classificato — nessuna semantica documentata in-tree, scelta onesta; rename obbligato per collisione enum), `7686ca6fc` (guard `ne01==0` al choke point `ggml_cl_mul_mat_id`, copre tutti i 10+ kernel). Audit: codice pulito, BLOCK solo su igiene storia → filter-branch, alberi ripuliti, diff finale vuoto. **Regressione device PASS**: 407/407 + 925/925, gate ancora TRUE su E031 (canary #26476 verdi), err bit-identici a barrier-verify. Evidenza `results/q17_verify_s23/` | fatto |
| ~~18~~ | ~~Cella ship KEXP~~ → **CHIUSO 22/08 notte, verdetto misto (audit BANK)**: **A/B 1.803 PASS** (replica prereg'd dell'1.81, A più fredda) ma **A/C 0.812 REFUTED** — la CPU pura batte la GPU piena su LFM2.5-KEXP (17.55 vs 14.25 t/s): pacchetto NON shippa, refute a verbale. Vedi capitolo sessione #18 | fatto |
| ~~20~~ | ~~Arm C su OLMoE~~ → **CHIUSO 22/08: C batte A in ogni cella (A/C 0.724)**, decisione invariante ai pruning, audit BANK-w-corrections. Framing dossier deciso: niente "GPU default candidate"; su OLMoE "più lenta a quasi-parità termica", cool-mode solo KEXP. Vedi capitolo sessione #20 | fatto |
| 19 | Opzionale: perché Mellum2 esperti-GPU a ngl=2 è <0.11 t/s (peggio di metà dell'arm CPU — upload esperti per-token?): strumentazione dedicata, solo se vale un capitolo | quando capita |
| 22 | **Tabella A/B/C su Marco1c-KEXP** (6.4G, classe LFM2.5: PUÒ starci in RAM) — preflight di fit (smoke ngl99 con -nr; metriche giuste per fase — lezione app-Claude 23/08 con correzione: **PRE-load la metrica giusta È MemAvailable** [diventa invalida solo A MODELLO CARICATO, quando conta le pagine mmap del modello stesso come headroom]; **a processo vivo si diagnostica con MemFree+RssAnon/RssFile+majflt** [mai gate su MemFree pre-load: il kernel lo tiene deliberatamente vicino a zero, 0.08–0.53 GB su telefono sano]), poi 3 blocchi palindromi A/B/C stesso protocollo #18/#20. Completa la decision table col modello del prodotto; se non sta in RAM, chiudere con "streaming-only, tabella non applicabile" | prossima sessione device staccata |
| ~~23~~ | ~~Baseline same-harness streaming~~ → **CHIUSO 22/08 sera**: Mellum2 `-ngl 0 -nr` llama-bench mmap = **0.216 t/s** (plugged dichiarato, rc=0, jsonl verificato) vs 0.223 del tronco-GPU parziale same-harness: **in streaming la GPU non muove la lancetta (±3%)** — il 23× fino al 5.10 di prodotto è tutto della ricetta (harness diverso, mai dividere attraverso harness). `results/mellum2_cpu_baseline_s23/` | fatto |
| 25 | **Rilettura "proposte pazze" d'archivio** (interesse gualt 22/08: NPU, roba images, ecc.): passare PLAN-archive.md + vecchi doc e curare una shortlist delle idee esotiche accantonate, ciascuna con verdetto d'epoca, criteri di riapertura e cosa è cambiato da allora. **Direttive owner 22/08 sera da integrare**: (a) NPU non per decode (morta, 0.67MiB) ma per SPIKE compute-bound: TTFT/prefill del prompt, embeddings del research mode, encoder vision, draft/classifier piccoli — "NPU coprocessore ausiliario dentro engine MoE-streaming CPU" = lane inedita (AI Hub fa 690 tok/s prefill: il silicio c'è); (b) "AI-ISP per immagini" si traduce in "encoder vision su HTP" (ISP vero = inaccessibile ai terzi). Deliverable: un doc, zero device | Explorer + arbitrato owner |
| 26 | **Gate Mali "datate" (mercato Africa/SEA — direttiva owner 22/08: "mercato mondiale non sfruttato da nessuno")**: il paper dà <3% ALU util su Mali con kernel generici = gap NEL KERNEL, attaccabile; ma decode resta memory-bound (premio realistico: prefill + cool-mode + CPU libera, lezione-750) e le Mali low-end hanno ALU piccole in assoluto. **GATE ESEGUITO 22/08 sera (Jelly, plugged-dichiarato, 0 disconnect): porta CHIUSA sullo stack attuale, ma per DUE serrature software, non per il silicio.** (1) Vulkan si alza (Mali-G57 MC2, fp16, warp 16) ma OGNI execute = SIGSEGV al primo alloc: il backend richiede `vkGetBufferDeviceAddress` e il driver G57 non lo espone (pfn NULL, `ggml_vk_create_buffer:3233`); firma DIVERSA dall'Adreno (che era SIGABRT su createComputePipeline); `supports_op` mente di nuovo (808/808 dichiarati, 0 eseguibili — terzo caso, dossier). BDA-free path = lavoro upstream serio. (2) OpenCL: driver ARM OpenCL 3.0 presente(!) ma il backend scarta a `GPU_FAMILY::UNKNOWN` (allowlist Adreno/Intel) — il matmul non è MAI partito, quindi il <3% ALU del paper resta NON testato sul nostro stack. **GATE 2 ESEGUITO 22/08 notte (patch allowlist env-gated `GGML_OPENCL_ALLOW_UNKNOWN_GPU`, branch `kalsa/mali-probe` @ 1882bf8cd, pushato su kalsallama, NEVER MERGE): LO STACK È VIVO — f32 MUL_MAT 202/202 corretto su Mali-G57.** I quant NON compilano per ragione mondana: kernel 1d chiusi in `#ifdef INTEL_GPU/ADRENO_GPU` senza `#else` (N_SIMDGROUP/N_DST/N_SIMDWIDTH indefinite su Mali) + load `half*` senza vload_half; f16 12 OK poi SIGABRT (kernel specializzato NULL); q2/q3 not-claimed. Prefill non ancora misurabile (gguf on-device tutti quant). **GATE 3 ESEGUITO 22/08 notte (commit `435eacf36` su mali-probe, never-merge): verdetto (c) con perla.** Le patch di portabilità (`#else` warp-16 su 30 mul_mv*.cl + vload_half) COMPILANO tutto, ma i dense 1d quant muoiono per ragioni architetturali: **Mali non ha `sub_group_shuffle_xor`** (SIGILL 132 su q4_0/q8_0/q6_K) e q4_K prende CL_INVALID_WORK_GROUP_SIZE. Però **MUL_MAT_ID q8_0 = 75/75 OK: un matmul MoE quantizzato GIRA su Mali**. q2/q3: kernel solo-Adreno, not claimed. llama-bench skip (nessun gguf q8_0 a bordo). **Verdetto complessivo 3 gates: stack Mali VIVO (f32 + q8_0-MoE), ma il path di prodotto (Q4_K/Q4_0) richiede kernel Mali-tuned = progetto vero, decisione owner.** **Ricetta Qwen per il progetto (ANSWER.md consult): i kernel MUL_MAT_ID sono shuffle-free by construction → generalizzare QUELLO stile al dense in 4 stadi (full-dot senza collettive → riduzione local-memory 16-lane, lane-0 seriale con 2 barrier → sub_group_reduce_add SOLO dopo probe-kernel di dispatch → tile+repack Mali-style); q4_K -54 = reqd_work_group_size hardcoded Adreno vs warp 16, fix con query/clamp; partire da q4_0/q8_0 (i K-quant su kernel generici mobili sono spesso PIÙ LENTI: dequant ALU-heavy + spill); decode/short-prefill plausibile con kernel generici, prefill competitivo richiede specializzazione ML-Drift-style.** **GATE 4 ESEGUITO 22/08 notte (Jelly plugged, audit Luna BANK-w-corrections): GPU < CPU su TUTTI i 20 casi verdi (max 0.962×), mai ≥2×.** f32 GEMM 1024×128×1024: GPU 7.81 vs CPU 32.76 GFLOPS (**0.238×**); f32 GEMV 0.86×; q8_0-MoE 128e sweep n=1→512: GPU piatta 20.66–22.25 (non scala col batch) vs CPU 8-thread 21.48→69.52 (**0.962×→0.320×**) — il caso migliore GPU è il decode n=1, il prefill-like è 0.3×. Achieved-GFLOPS = 6.1% (f32 GEMM) / 16.1–17.4% (q8_0) di un picco fp32 **ASSUNTO e non misurato** 128 GFLOPS (clock illeggibile nel probe archiviato; NON è ALU-occupancy misurata; il "<3%" del paper era fp16 MLC, mai citarlo come misura nostra). Caveat Luna: termica solo pre/post (35.5→58.4 °C), CPU runs dopo GPU runs, outlier CPU 32e n8 CV 18%. **Misura diretta: il path OpenCL generico non batte MAI la CPU same-device; "kernel Mali-tuned obbligatori" è l'inferenza.** Scope futuro #26 se il progetto apre: stadi 1-2 ricetta Qwen su q4_0/q8_0 dense → prefill end-to-end → CELLA TERMICA sostenuta (interesse owner: sul Jelly il cool-mode vale più della velocità — è il device che muore di caldo). Evidenza `results/mali_gate_jelly/raw{2,3,4}/` + raw4, audit in REPORT.md §G4.7. **DECISIONE OWNER 22/08 notte: GPU Mali PARCHEGGIATA su G57-class — serve hardware più recente.** Ricerca generazionale (websearch, `scratchpad/agents/q26e-mali-generation-research/REPORT.md`): **il salto è Valhall gen-3 (G610/G710)** — primo raddoppio FP32/core (4×16 FMA lane), picco GPU 5–11× la CPU same-SoC vs 1.8× del G57; ancora meglio G615/G720 (secondo raddoppio + matrix-multiply, unica evidenza LLM pubblicata: ML Drift ~791 tok/s prefill su G715/G720). Mercato: G610/G615 MC6 già a $220–350 (Infinix GT 20 Pro, POCO X6 Pro ~$249, POCO X7 Pro G720), fascia volume $100–180 Africa/SEA resta G57 per tutto il 2026. **Criterio di riapertura: un device G610 MC6 o G615 MC6 in mano (es. POCO X6 Pro), poi ricetta Qwen 4 stadi** | parcheggiato — riapre con device G610/G615 |
| 27 | **Gate expert-packing (#14 della shortlist q25)** — riordino esperti nel GGUF per co-attivazione (ricerca originale, tutto in casa: route-traces esistenti + riscrittore GGUF PC-side). **CHIUSO 22/08 notte: MORTO col numero.** Xiaomi/UFS 4.0: 1.33×; **S23/UFS 3.1 (gate decisionale, staccato 83%, sha ok): seq/random = 1.058×** — a blocchi da 0.94MB le letture random non costano quasi nulla su NESSUNA delle due generazioni UFS. La premessa del packing (random reads care) è falsa alla nostra taglia di blocco; le 85.5 ri-letture/token si attaccano con cache/drop, non col layout. Evidenza `results/io_gate/{xiaomi_ufs4,s23_ufs31}/` | fatto |
| 28d | **SESSIONE S23 q31 (22/08 notte, staccato 83→80%, audit PENDING): LA PORTA È APERTA ANCHE SU v73 + IL PRIMO NUMERO DI PREFILL.** (1) OneUI retail concede il PD (v73, hwinfo identico al v75; nota: error 0x14 sull'URI senza _session=0, sessione comunque aperta); (2) MUL_MAT **identico** al Xiaomi (firme dei fail matchate caso per caso): 486 OK / 70 FAIL / 1007 skip; **correzione audit: 44/70 FAIL sono `CPU=nan`** su entrambi i device → per quei 44 il **GIUDICE del harness è rotto, HTP innocente**. **Consulto Qwen 22/08 notte (`scratchpad/agents/consult-qwen-nan-mali/ANSWER.md`): sospetto primario = POISONING DA BUFFER ARM-REPACK nel reference CPU** (classe nota upstream: acceleratore finito, reference NaN, solo quant, solo aarch64), NON fast-math (l'accumulo dotprod/i8mm è intero). Esperimento discriminante #1: loggare/forzare il buffer type del reference (plain host vs *REPACK*); verificare se 3f545be predata il fix upstream del reference-buffer. Gli altri 26 fail da classificare; (3) **pp512 Qwen3.5-4B-Q4_0, nseq=1 (audit BANK-w-corr): HTP mediana 84.0 (84.0/87.0/76.3) vs CPU mediana 24.1 (22.6/26.1/24.1) ≈ 3.5×** (avg 3.40×), con prova scheduler CONFERMATA dall'audit (`HTP0-REPACK 1787 MiB`, `execute-op → HTP0|hmx-tiled`); la trappola "senza `--no-host 1` fallback CPU silente" è riportata dall'operatore ma senza raw dedicato (da provare nella cella dedicata). Caveat: 4B HYBRID (51 split, GDN/SSM su CPU) — il ref upstream 461 è un 2B denso; su transformer puro il rapporto sale. Ops: /data S23 ~6.1G liberi (nota operatore, senza raw df; il 21G del PLAN è stale). Evidenza `results/htp_smoke/s23_v73/`, audit `scratchpad/agents/q31-s23-audit/` | cella prefill dedicata (con raw del fallback) |
| 28b | **SMOKE HTP su Xiaomi retail (22/08 sera, ~1 min device): REGISTRA+DICHIARA — la porta è APERTA.** FastRPC concede il PD su houji/v75, skel caricato (`hwinfo: threads 4, hvx 4, hmx 1, vtcm 8 MB`), ADD 73/75 (2 f16 epsilon), MUL_MAT f16/f32 **486 OK**; quantizzati (q4_0/q4_1/q8_0/mxfp4/iq4_nl) 70 FAIL ma spesso **`CPU=nan` vs HTP finito → GIUDICE CPU SOSPETTO** (stessa classe del giudice avvelenato Adreno — isolare prima di incolpare l'HTP); q*_K = not-supported (skip, come atteso). Prossimi: (a) isolare i NaN del giudice (PC/device, riproducibile), (b) prefill pp512 nseq=1 con Qwen3.5-4B-Q4_0 (finestra device ~30 min), (c) direttiva owner: **governor tri-engine** NPU-prefill/CPU-decode/GPU-cool in #24 + valutare kernel HVX per K-quant (vedi 28c). Evidenza `results/htp_smoke/xiaomi_v75/`. **Baseline pre-patch del giudice CATTURATA 22/08 notte (finestra 10 min, unplugged 53%): tutti i 70 fail riprodotti in verbose pieno (HTP0 finito, CPU nan/inf; q4_0 15, q4_1 14, q8_0 16, mxfp4 13, iq4_nl 12; sha == manifest q30) → `results/htp_judge/xiaomi_v75_baseline/`**. **ESPERIMENTO GIUDICE quasi chiuso (22/08 notte)**: (1) q32 desk (`scratchpad/agents/q32-npu-judge-exp/REPORT.md`): upstream NON ha fix post-3f545be; **meccanismo tracciato nel codice: con HOSTBUF=1 il buffer HTP è `is_host` → graph_copy fa memcpy dei byte GIÀ TILED nel tensore CPU saltando l'unpack di get_tensor → il reference legge tile come block_q4_0 → scale NaN** (NON è CPU_REPACK: in questo harness gli extra-buft non possono comparire). Patch: log cpu_buft+nan_scales + env `GGML_TEST_PLAIN_HOST=1` (ricopia via get/set con unpack); binari v8.7 (Snapdragon, sha 92511f27) e v8.2 senza i8mm (Jelly/generic, sha 94552313). (2) **Discriminatore Jelly (CPU-only MediaTek, unplugged, round 2 dopo un SIGILL da -march i8mm al round 1): 194/194 PASS stock E plain-host, cpu_buft sempre "CPU", zero CPU_REPACK → la teoria REPACK di Qwen PERDE, la teoria memcpy-tiled REGGE** (`results/htp_judge/jelly_cpu_discriminator/`). **(3) SENTENZA ESEGUITA su Xiaomi 23/08 (AC plugged dichiarato, audit Luna BANK-w-corr, `results/htp_judge/xiaomi_v75_sentence/`): la classe NaN era TUTTA del giudice — con `PLAIN_HOST=1` i contatori nan/inf_scales del reference si azzerano su tutti i 106 tensori loggati e 0/70 → 34/70 pass** (stock A: 46 NaN + 11 inf + 13 ERR; cpu_buft sempre "CPU" liscio, mai REPACK; nan_scales>0 su 56/70, scan euristico incompleto su q4_1). **RESTANO 36 FAIL numerici — TUTTI a n≥5** (ERR 56–150 su tutti e 5 i tipi + 2 outlier giganti n=2048 q4_0=2572 / n=4096 q8_0=1677), tutti già FAIL in baseline: **ipotesi difetto HTP batch reale, NON ancora stabilita** (l'audit avverte: il plain-host non prova che i buffer lato HTP siano canonici). Prossimo: classificazione desk dei 36 (metrica ERR, shape, confronto upstream), poi eventuale replica S23. **(4) Trappola fallback: NON riprodotta su houji/v75** — con e senza `--no-host` entrambi rc=0, 109.5–117.7 t/s classe HTP, execute-op HTP0 nei -v stderr di ENTRAMBI (`results/htp_fallback/xiaomi_v75/`); **RI-TEST S23 ESEGUITO 23/08 notte (unplugged 100%, sha match, HOSTBUF=1 come q31): TRAP REFUTED-EVERYWHERE** — anche su v73 il run senza `--no-host` è classe-HTP (128.4 t/s vs 117.1 con flag, execute-op identico in entrambi); l'inferenza q31 era sbagliata (i suoi 78–92 t/s si sovrapponevano all'HTP 84, non al CPU 24). `--no-host` NON necessario sotto HOSTBUF=1. Caveat nuovo: v73 prefill 117–128 t/s in questa sessione vs mediana 84 della cella bancata → **varianza tra sessioni alta su v73, da caratterizzare prima di citare assoluti** (`results/htp_fallback/s23_v73/`). **(5) Deploy completato**: gguf Qwen3.5-4B-Q4_0 (sha 298fcb5f, 21.6 MB/s) + trio llama-bench a bordo; **data point prefill houji plugged: 116.8 t/s pp512** (non-cella). Cella bancabile alla prima finestra Xiaomi STACCATA ≥40%. **(6) CLASSIFICAZIONE 36 RESIDUI CHIUSA (desk q35, audit Luna BANK-w-corr, 23/08): NON è un errore numerico — il kernel HMX non gira mai su quei casi.** Catena provata file/riga: n≥5 instrada su HMX (`hmx-tiled`); l'host calcola l'eligibility con `ne01_padded = round_up(m,32)` ma il DSP riceve la m originale; `hmx_mm_2d_f32` rifiuta m%32≠0 → `INTERNAL-ERROR`; **l'host logga e IGNORA (`ggml-hexagon.cpp:1591-1594`, `TODO: handle errors`) → l'output confrontato è il fill random mai toccato** (da cui NMSE 56–2572, 10⁵–10⁶× la soglia 5e-4). Tutti e 36 riconciliati 1:1 (36 righe INTERNAL-ERROR esatte; m=16/1/6 mai multipli di 32; outlier n=2048/4096 stessa classe, kernel mai partito); HMX passa dove m%32=0. **Quindi: HTP mai colta in errore di calcolo — il "difetto batch" era un contratto host/DSP rotto nel harness corpus + error-swallowing. QUEL swallowing è un difetto di robustezza vero (status non propagato) da fixare nel fork/upstream, anche se le shape m=1/6/16 sono artificiali del test.** **Controprova ESEGUITA 23/08 (audit mimo BANK pulito): lo stesso caso q4_0 m=16 n=8 che falliva via hmx-tiled (ERR 88.75) passa 1/1 rc=0 forzato su HVX con `MM_SELECT=2` — classificazione q35 confermata anche in positivo** (`results/htp_judge/xiaomi_v75_counterproof/`). **(7) CELLA PREFILL BANCABILE ESEGUITA 23/08 (houji unplugged 100% su tutte e 5 le probe, audit mimo BANK-w-corr): pp512 HTP mediana 165.4 t/s (range 150.3–170.3, 3 rep processo, cooldown 61s tra le HTP) vs CPU same-harness 51.9 → 3.19× (range 2.89–3.28×)**, scheduler proof 448 execute-op hmx-tiled + HTP0-REPACK 1787 MiB. Correzioni a verbale: CPU rep partita 1s dopo la rep3 (stesso stato termico, wording NOTES impreciso); HOSTBUF=1 qui vs unset sulla cella S23 (unica differenza flag); citare sempre mediana+range. **Confronto v73→v75: ~2× assoluto HTP (84→165), ratio simile (3.49→3.19) perché la CPU migliora più dell'HTP (2.15× vs 1.97×) sul SoC nuovo.** Caveat invariati: 4B ibrido GDN/SSM-on-CPU 51 split, nseq=1, singolo device. Evidenza `results/htp_prefill/xiaomi_v75/cell1/` (+AUDIT-CORRECTIONS.md) | fix error-propagation quando si apre il capitolo HVX/HTP; decisione #28c coi numeri |
| 28c | **Kernel HVX K-quant per HTP (domanda owner 22/08: "non possiamo scrivere un kernel HTP per KEXP?")** — SÌ in principio: il backend è open, l'SDK è in casa, i formati K li conosciamo al bit; sarebbe il capitolo-fotocopia della campagna Adreno (kernel che upstream non ha per NESSUN target: il maintainer dichiara Q4_K_M non supportato). Costi onesti: ISA nuova (HVX intrinsics), debugging DSP più duro (FARF, no gdb comodo), e il valore è tutto nel PREFILL (il decode resta CPU). Alternativa economica intermedia: tronco in doppia quant (Q4_0 per HTP accanto a KEXP) = zero kernel, costo RAM da misurare. Ordine consigliato: prima (a)+(b) di 28b coi quant esistenti, poi decidere kernel vs doppia-quant coi numeri. **ESPERIMENTO B′ ESEGUITO (q36, 23/08, PC-only, doppia review interna 0-REFUTED): il tronco di Marco è MINUSCOLO — 228 MB su 6.4 GB** → costo B′ irrisorio: tronco Q8_0 = +124 MB (+1.9%), IQ4_NL/Q4_0 = −41 MB (−0.65%), esperti byte-identici (sha d84c4b43). **MA la qualità dal requant Q5K/Q6K→X è compromessa** (doppia quantizzazione: sul factual q1 il baseline risponde giusto, Q8_0-trunk LOOPA 300 token, IQ4_NL/Q4_0 sbagliano; instruction-following regge ovunque) → **i 3 gguf from-KEXP NON si spediscono; B′ va rifatto dalla sorgente Q8_0 (18.36 GB, sha 3287457a, da riscaricare — decisione owner)**. NPU desk: attn Q/K/V/O passa i predicati HTP per tutti e 3 i tipi; token_embd tied [1024,151936] FAIL_DIM (ne[1]>32768) → la testa resta comunque CPU, nessun F32 extra necessario. Report `scratchpad/agents/q36-trunk-requant/`. **B′ FROM-SOURCE MULTI-MODELLO ESEGUITO (q37, 23/08, 3 modelli, doppia review interna 0-REFUTED, cleanup 67GB fatto): (1) la quota-tronco NON generalizza — Marco 3.57% ma OLMoE 12.2% e LFM2.5 15.2% (il "tronco minuscolo" era Marco-specifico); costo B′: Q8_0 +1.95/+6.7/+7.6%, IQ4_NL/Q4_0 −0.65/−2.2/−3.1% (NEGATIVO!). (2) NPU desk: attn PASS sui 3 tipi semplici per tutti e 3 i modelli (control Q5_K FAIL_TYPE, LM head FAIL_DIM ovunque = resta CPU comunque). (3) Qualità from-source: il collapse q36 NON si ripete (era la doppia quant, confermato) MA la suite a prompt-singoli non discrimina in modo credibile: su Marco Q8_0 sbaglia il factual che Q4_0 azzecca (ordinamento qualità implausibile = rumore), IQ4_NL/Q4_0 falliscono il filtro codice; OLMoE/LFM sotto il pavimento della suite. NESSUN tipo vince entrambi i gate.** Igiene: esperti byte-identici, sha Marco == KEXP shippato. **GATE PERPLEXITY ESEGUITO (q41, 23/08 notte, criterio PRE-REGISTRATO ≤+0.5%, review math 0-REFUTED): FAIL SECCO** — control Q5_K PPL 9.5915±0.071 (wikitext 584 chunk; primo baseline PPL misurato della lineup), **IQ4_NL-trunk +4.273%**, Q4_0-trunk +8.060%; corpus IT secondario stessa classifica (+3.4/+7.0%). Il tronco è il 3.6% dei byte ma regge molta più qualità del suo peso: **B′ a 4 bit è MORTO. Restano per la NPU-su-KEXP: (a) Q8_0-trunk — NON testato dal gate (solo +1.95% di size su Marco, atteso quasi-lossless: È il candidato residuo, costa ~1h di PPL), (b) road A kernel HVX (settimane), (c) niente NPU per la lineup (la NPU serve i modelli Q4_0-nativi, già misurata 3.2×). **GATE Q8_0-TRUNK ESEGUITO (q43, 24/08, PRIMO gate multilingue della nuova regola owner, prereg lockata `e6910b3f` pre-download, doppio audit: math DeepSeek CLEAN sulla misura 9/9 + 2 cifre ops di prosa corrette; doc mimo BANK-w-corrections applicate): PASS 5/5 — wiki −1.084%, IT −0.573%, ES −0.605%, FR −0.662%, ZH −1.341%: il tronco Q8_0 è MIGLIORE del control su ogni corpus, a +1.948% di size (esperti byte-identici `d84c4b43…`, gguf vincitore sha `bd63fc0f…` CONSERVATO). Contrasto q41 stesso wiki: IQ4_NL +4.27, Q4_0 +8.06, Q8_0 −1.08. Caveat a verbale: PPL-only (asse comportamentale #30 ancora dovuto), Wikipedia-only, singolo binario/macchina. DECISIONE OWNER 24/08: (a) — B′ Q8_0-trunk VIVO; (b) HVX accantonata per KEXP (resta possibile per altri fini), (c) superata: NPU = modelli Q4_0-nativi + KEXP via tronco Q8_0. Prossimo gradino (a): smoke HTP device del tronco Q8_0 su Marco-B′ (prima finestra Xiaomi; /data S23 in realtà 22G liberi — nota 6.1G stale) + certificazione #30 asse B prima della lineup. Evidenza `scratchpad/agents/q43-q8trunk-ppl-gate/`. **SMOKE S23/v73 TENTATO (q44 fase 2, notte 23–24/08, ordine owner, REGISTRA+DICHIARA): MORTO DI FIT, non di difetto** — load_all_data materializza gli esperti in buffer CPU **anon** 5995.65 MiB + CPU_REPACK 157.65 + HTP0 28.25 + HTP0-REPACK 178.50 = 6360 MiB su MemTotal 7074 MiB → LMK due volte, 0 execute-op, nessun rc. Il pezzo visibile è GIUSTO: `init-tensor` attn Q/K/V/O su HTP0 = lo split del design si forma (tronco→NPU, esperti→CPU). Verdetto: **Marco-B′ su NPU = classe Xiaomi/12GB**; su S23 la strada B′ vale solo per KEXP più piccoli. gguf `bd63fc0f` lasciato a bordo S23 (sha on-device verificata); prossima finestra Xiaomi = smoke vero. Evidenza `results/htp_smoke/s23_v73_bprime/`. **SMOKE LFM-B′ SU S23 RIUSCITO (q46, 24/08, unplugged 82→80%, spot-check orchestratore sui raw): il PRIMO KEXP-class che GENERA con tronco su NPU** — LFM-B′ cotto from-source (Q8_0-trunk 3.58 GB sha `38a93d71…`, esperti byte-identici al control), fit 3672 MiB su 7074, rc=0 su (a)(b)(c), **execute-op HTP0 provato: 228 matmul attn q8_0 hmx-tiled (i 6 layer attn), router su HTP0, esperti su CPU (0 su HTP) = lo split del design gira**. Esplorativo same-harness: pp512 HTP 58.4 vs CPU 51.1 (+14%), tg128 10.6 vs 17.0 (CPU vince il decode, atteso). **Lettura onesta: su LFM il premio prefill del tronco-su-NPU è modesto (+14%) perché solo 6/24 layer sono attn e il grosso del compute prefill sta negli esperti (CPU)** — il valore di B′ dipende dalla quota-compute del tronco per architettura; il premio grande possibile è esperti-su-NPU (probe q48 OLMoE-Q4_0). Evidenza `results/htp_smoke/s23_v73_lfm_bprime/`, `scratchpad/agents/q46-lfm-bprime-smoke/`. **SMOKE MARCO-B′ SU XIAOMI/v75 PASS con numeri (24/08, unplugged, execute-op proof 252×/classe attn q8_0 hmx-tiled, esperti 0 su HTP, fit 6360/12GB): same-harness HTP vs CPU = pp512 27.84 vs 19.12 = 1.46×, tg128 3.61 vs 6.45 = 0.56× (CPU rumorosa 3.95/8.94), e PRIMA MISURA ENERGIA a lavoro appaiato: J/token HTP 0.561 vs CPU 0.652 = 0.86× (dumpsys charge counter, bracket processo intero, caveat load+init inclusi, counter grosso) — l'intuizione owner "il ping-pong può pagare in termica/batteria" ha il primo numero a favore. Premio prefill B′ per architettura: Marco 1.46×, LFM 1.14×.** **PROBE q48 ESPERTI-SU-NPU (S23/v73, 24/08): DISPATCH PROOF STORICA MA PATH IMMATURO** — 48 MUL_MAT_ID `ffn_*_exps` q4_0 ESEGUITI su HTP0 (hmx-tiled, VTCM 6.1/8MB, supports_op mai no, 3.6GiB esperti su HTP0-REPACK = split inverso di B′) a pp16; MA la coda DSP muore sotto carico: pp512 E decode = `dspqueue_read failed 0x2e` → abort (riprodotto 3×, tombstone + crash_context salvati, INTERNAL-ERROR 0, correttezza NON provata — classe q35 su m%32). CPU ref rumorosa (39/100 su due load). Nessun numero HTP. Discriminatore v75 in coda sullo Xiaomi: se regge = difetto v73; se muore = path MUL_MAT_ID HTP rotto sotto carico ovunque (segnalazione upstream, dossier #8). Evidenza `results/htp_smoke/xiaomi_v75_bprime/`, `results/htp_probe/s23_v73_olmoe_q40/`, `scratchpad/agents/q48-olmoe-q40-npu/`. **DISCRIMINATORE v75 ESEGUITO (24/08, houji unplugged 89%, stesso gguf/binario, rc=0 ovunque, 0 dspqueue/INTERNAL-ERROR/tombstone): IL v75 SOPRAVVIVE — il crash 0x2e è SPECIFICO v73, non un difetto generale del path. E IL PRIMO NUMERO PREFILL MoE-ESPERTI-SU-NPU DELLA STORIA: pp512 HTP 686.2 vs CPU same-harness 142.2 = 4.82× (432 MUL_MAT_ID execute-op su ffn_*_exps, 3.6 GiB esperti su HTP0-REPACK; tg128 0.63× = decode resta CPU, coerente ovunque). Il miglior rapporto NPU della campagna (4B ibrido: 3.19×). J/token non misurabile (finestre troppo corte per il counter — perché è troppo veloce). Caveat: esplorativo, correttezza non ancora provata formalmente (0 INTERNAL-ERROR è necessario ma non sufficiente; serve gate testo/PPL device HTP-vs-CPU). CONSEGUENZA STRATEGICA da decidere con l'owner: il premio esperti-su-NPU (4.82×) ≫ premio tronco-solo B′ (1.14–1.46×) → la strada (b) kernel HVX K-quant MUL_MAT_ID, accantonata quando B′ è passato, viene RIPREZZATA dal mercato: è l'unica via per portare il 4.82×-class sui KEXP (esperti K-quant); per i MoE Q4_0-nativi la lane è GIÀ aperta su v75-class. v73: segnalazione upstream candidata (tombstone+context agli atti). Evidenza `results/htp_probe/xiaomi_v75_olmoe_q40/`. **CONFOUND HOSTBUF CHIUSO (24/08, S23 unplugged 77%): il v73 muore SEMPRE su questo grafo** — HOSTBUF=1+--no-host identico (48 execute-op poi 0x2e), e MM_SELECT=2 (HVX puro) muore PRIMA di qualsiasi expert, su `ffn_gate_inp` f32 → non è HMX-specific, non è flag-specific: è lo stack v73 che non regge la FORMA del grafo MoE (il 4B denso su v73 girava intero) — direttiva owner: hardening v73 (coda DSP + path mmap/anon) = capitolo aperto, diagnosi in corso. Evidenza `results/htp_probe/s23_v73_olmoe_q40/hostbuf1/`. **DIAGNOSI 0x2e CHIUSA (q50, 24/08, logcat su un repro + conteggio grafi): 0x2e = AEE_EINTERRUPTED perché IL PD cDSP CRASHA — `CDSP0 CRASHED thread htp-main, TLBMISS RW, Bad VA 0x0, op_binary+0x5B9C` in libggml-htp-v73.so = NULL deref nel skel v73 su op binarie (ADD di view del routing MoE; `binary-ops.c:860` senza NULL-check). Il denso non entra in quel path (129 ADD nel flush MoE vs ~9); il v75 esegue lo STESSO pacchetto (407 op/252 tensor/3.12 GiB identici) e vive. Refutate: timeout, packet-size, coda piena (HVX muore a 27 op/186 MiB), HOSTBUF, HMX-only. Fix candidati: F1 patch skel op_binary (fix di causa, serve build SDK Hexagon), F2 op binarie off-HTP su v73 via supports_op (economico; variante F2b da provare: binarie su CPU MA MUL_MAT_ID su HTP), F6 policy v75-only interim. Upstream-worthy (crash nel loro skel, evidenza completa). `scratchpad/agents/q50-v73-dspqueue-diagnosis/DIAGNOSIS.md`. **F2b ESEGUITO (q51, 24/08, patch host env-gated GGML_HEXAGON_NO_BINARY, build 3f545be -j4 LOW, pin intatti): il guard FUNZIONA (0 op binarie su HTP, 42 MUL_MAT_ID esperti ancora dispatchati) MA v73 muore comunque — 0x2e a blk.13 su un batch da 8 op (MUL_MAT_ID+SWIGLU). ERRATUM q50: il NULL-deref op_binary è UN difetto reale ma NON il solo blocco — la "CONFERMATA" era sovradichiarata (sufficienza refutata). Logcat sotto guardia (24/08 sera): **DIFFERENT-DEFECT — il crash non è più op_binary ma `qurt_exit()` deliberato in `fastrpc_shell_unsigned_3` (`htp_iface_stop+0x12E8`, error 0x108), NESSUN handler nominato nello stack** → F1 "patcha l'handler" non ha un bersaglio: non è bounded. **VERDETTO CAPITOLO (proposta F6 all'owner): MoE-esperti-su-NPU = v75-class only; il v73 tiene il resto del menu NPU (denso/ibrido 3.5× q31 + B′-tronco q46, entrambi device-proven). Due meccanismi di morte v73 caratterizzati (NULL-deref op_binary + qurt_exit iface) = segnalazione upstream ricca, dossier #8.** Patch `scratchpad/agents/q51-f2b-v73-guard/PATCH.diff`, raw `results/htp_probe/s23_v73_olmoe_q40/f2b/` (+logcat_repro/). **F6 CONFERMATA DALL'OWNER 24/08: policy definitiva — MoE-esperti-su-NPU = v75-class only; su v73 il menu NPU resta denso/ibrido 3.5× + B′-tronco (device-proven). Il capitolo skel v73 si riapre solo su domanda di prodotto esplicita (stima 1–2 settimane a esito incerto, rischio muro firmware). Resta in coda: segnalazione upstream coi due meccanismi caratterizzati.** **GATE CORRETTEZZA v73 ESEGUITO (q53, 24/08 sera, S23 unplugged 72→21%, prereg `7ec4c231`, audit mimo BANK-with-corrections applicate): FAIL — TERZA firma di morte v73**: il braccio HTP della perplexity LFM-B′ (tronco-su-NPU, 1667 execute-op provati = corsia genuinamente su NPU) muore ai chunk 2-3 con `dspqueue_write 0x1` in flush_batch (vs read 0x2e q50 e qurt_exit q51; distinzione audit-CONFIRMED), CPU-ref pulito 32.49±0.67 su 32/32 → r=NaN = FAIL alla lettera (arbitrato FAIL-vs-VOID a verbale nel REPORT; conseguenza identica: corsia v73 tronco-NPU NON certificata). Lettura "muore sotto batch-2048 sostenuto" PLAUSIBLE non provata (pp512 q46 passava; 2 chunk riusciti prima del crash): discriminatore -b 512 in coda come cella nuova. Lane 2 (ibrido Qwen, era a bordo) INTERROTTA a 8/32 chunk da disconnect adb (valori sani 7.9-9.8), completabile in ~40 min alla prossima finestra; secondario 5-prompt non disponibile (llama-cli non cross-compila al pin, 2 tentativi). **Conseguenza ledger router: R6+R7 OFF — su v73 NESSUNA corsia NPU è oggi certificabile; con q52 la strada B′ è ferma su entrambi gli assi; il menu NPU vivo è v75-class (a sua volta da certificare, q55/Xiaomi)** | CHIUSO (F6 owner-confirmed). **Upstream report BOZZA PRONTA 25/08** (`docs/upstream-v73-hexagon-report.md`, audit fedeltà mimo 49/49 claim confermate, 1 correzione applicata, 1 refutata dagli hunk della patch) — **DECISIONE OWNER 25/08: NON SI INVIA, capitolo chiuso (il doc resta in repo come dossier interno)**; **q53b ESEGUITO (25/08, S23 unplugged 95%, audit mimo BANK-CLEAN): DIES-512** — stessa firma `dspqueue_write 0x1` a `-b 512` dopo 9/32 chunk (vs 2-3 a 2048; 59k execute-op provati): la morte NON è batch-bound; "sopravvive di più a batch piccolo → stato accumulato" resta PLAUSIBLE (n=1/braccio). Numerica: Δ chunk-1 +1.48% tra batch = tiling/precisione mista HTP, non drift. **INCIDENTE TERMICO (25/08 ~04:00 UTC): lane 2 (ibrido Qwen intero su NPU, PPL sostenuta) interrotta DUE volte da "adb offline" (8/32 e 4/32; al secondo drop ping vivo, adbd morto) e poi il device trovato BOLLENTE, SPENTO, NON RIPARTE** — vedi `scratchpad/agents/q53-v73-npu-correctness/INCIDENT_THERMAL.md`. Buco harness nostro: temperatura solo pre/post braccio, nessun watchdog intra-run. **REGOLA NUOVA: ogni run device >2 min sotto watchdog termico on-device (poll 10 s, KILL a 43 °C, max temp nel manifest); run NPU v73 sostenuti OFF fino a decisione owner, cap 10 min.** Lane 2 CHIUSA-INCOMPLETA per sempre in questa forma; R6 hard OFF (incidente), R7 hard OFF (q53/q53b). **S23 RIACCESO (25/08 notte, q56 Luna): boot reason `shutdown,lpm` = spegnimento pulito da protezione OS, non kernel panic; integrità file 100% (anche i gguf); /data 93%.** Costruito e validato il **watchdog termico on-device** (`scratchpad/agents/q56-thermal-watchdog/`: test kill-path PASS, pass-through PASS, CPU-only ≤2 min); audit ostile mimo SAFE-with-fixes (2 HIGH: finestra 2-5 s senza guardia all'avvio + vitalità del guard non verificata; hard-cap 380 che ombreggia la soglia documentata) → **fix in corso, ri-validazione device PENDING (device freddo ≥50%)**. **Log lane 2 RECUPERATO dal device: il run HTP era andato a fine dopo la caduta di adb — 32/32 chunk, PPL 8.5179±0.125, 55.730 execute-op, mtime 04:14:45Z (28 min dopo il drop)** → braccio HTP della lane 2 COMPLETO senza nuovi run NPU. **q53c (prereg `931c9e85`, owner ok NPU-post-watchdog ma scelta zero-NPU): CPU-ref ucciso dal guard a 38.3 °C al chunk 1** (la CPU a -t 8 sul 4B supera 38 °C in ~2 min: su questo device convalescente non c'è spazio per run lunghi) → r8/r32 N/A, ma **chunk 1: HTP 7.9075 vs CPU 7.9064 = +0.014%** — primo indizio diretto che la NPU v73 calcola gli stessi numeri della CPU su questo grafo (1 chunk, non gate). Batteria 54→49%: lavoro device chiuso per la notte. **SESSIONE 3 (25/08 pomeriggio, S23 100% scollegato, audit mimo BANK-CLEAN): guard ri-validato T1–T5 (dopo un bug di parser trovato al primo run vero: `level` mancante contato come guasto sensore; e un falso stop mio su un warning benigno di fit). CPU-ref lane 2: ucciso dal guard a 43.4 °C al chunk ~7 → 32-chunk IRRAGGIUNGIBILE scollegato; chunk 1-2 CPU 7.9064/9.4097 vs HTP 7.9075/9.4123 = **NPU = CPU entro +0.03% (2 chunk, 4096 token) — la v73 calcola giusto sui grafi che girano**. q57 Arm A (ibrido intero su HTP0, prereg `a4999d53`): ucciso dal guard a 41.4 °C dopo 2 chunk, 5.995 execute-op, 33/33 offloaded, **pendenza 2.33 °C/min, 40 °C in 3.75 min** vs CPU-ref 1.38 °C/min (start diverso di 2.8 °C, non a parità perfetta): il carico NPU sostenuto scalda ~1.7× più in fretta — la fisica dell'incidente. Nessuna firma di crash. **Verdetto NPU v73 (owner Q 'non si può proprio usare?'): correttezza OK, MoE/B′ morte per firmware, carico sostenuto insostenibile — resta candidata SOLO come spike di prefill sui densi/ibridi; decide l'energia per prompt (bracci B/C q57), non la pendenza**. **BRACCI B/C ESEGUITI (25/08, S23 scollegato 88→82%, B-C-C-B, audit mimo BANK-w-corr applicate): pp512 spike sotto guard — NPU 88.3/90.6 t/s vs CPU 32.8/27.4 (≈3×, esplorativo), 1764 execute-op (B) / 0 offload (C); ΔT per arm (2 pass × 512) NPU +1.2/+0.6 °C vs CPU +2.5/+2.0 → 0.45 vs 1.125 °C per pass: a parità di lavoro la NPU lascia MENO CALORE PER PROMPT (metrica giusta: gradi per prompt, non gradi al secondo). Energia via charge counter INCONCLUDENTE (B1 169 J vs B2 897 J per lavoro identico = contatore inutilizzabile a questa scala; non citare). Deviazione: gate cool-start 32 °C invece di 30 (device a riposo ~31, autorizzata dall'orchestratore). Quadro NPU v73 completo: corretta (2 chunk), instabile su MoE/B′ (firmware), brucia se sostenuta (2.33 °C/min), **conveniente come spike di prefill** (3× e meno calore per prompt). Router: R6 riapribile SOLO come corsia a budget di tempo (prefill breve) — cella dedicata + decisione owner**. **q58 SPIKE SWEEP ESEGUITO (25/08, S23 scollegato 81→68%, 16/16 run sotto guard, NPU/CPU/CPU/NPU per taglia, audit mimo BANK-w-corr applicate): ΔT per processo NPU 0.5/0.0/1.1/2.2 °C vs CPU 1.9/3.25/3.25/5.15 a n=128/512/1024/2048; t/s NPU 75/127/105/88 vs CPU 22/19/26/25; solo-prompt (deconfuso dal load) NPU 1.7 s vs CPU 12.3 s a 128, 23.2 vs 81.6 a 2048 → a spike la NPU v73 è 3-5× più veloce E lascia 2.5-4× meno calore per prompt a OGNI taglia. Derivazioni congelate: **N_max(NPU) = 512 token** (a 1024 la media è 1.1 °C), **soglia termica 39.5 °C**. Fatto per l'app: `thermalservice` su S23 NON espone headroom numerico (status 0, solo soglie statiche) → la policy legge la temperatura batteria. Numeri del ledger router per la corsia spike R6 (ancora OFF finché non c'è la cella app-side)**. **DECISIONE OWNER 25/08 sera: progetto kernel HVX K-quant FERMO** finché non sono decisi (1) lo streaming/UFS (q60b S23 in corso; poi read_bytes per prefill sullo Xiaomi UFS 4.0) e (2) il dato 8xx (assaggio su 8 Elite via QDC: CPU Oryon/Adreno nuovo potrebbero cambiare il verdetto). Scope tecnico chiarito a verbale: i kernel esperti (MUL_MAT_ID Q2/Q3_K) valgono SOLO v75+ (su v73 i grafi MoE muoiono per firmware); su v73 il denso K-quant è marginale e coperto da IQ4_NL (q59) — **AGGIORNAMENTO 26/08: q59 NON passa (IQ4_NL +1.39 % es / +1.02 % zh contro gate +1.0 %, vedi #32): nessun denso HTP-readable spedisce senza decisione owner; la copertura "densi in IQ4_NL" NON è più data per scontata.** **q60 AMDAHL GATE 'NPU per MoE STREAMING' (25/08, Jelly 8 GB/UFS 2.2, Marco Q4_K_M 10.5 GB su 5.5 disponibili, sotto guard, audit math DeepSeek BANK-BLOCKED sul mapping, misura valida): quota calcolo pp512 0.78 MA I/O e calcolo si sovrappongono (readahead) → il tetto vero è wall/max(pavimento I/O, calcolo/k): wall 23.2 s = pavimento I/O 22.3 s (8.4 GB letti per OGNI prefill a 361-376 MB/s) → headroom NPU 1.0-1.8×, perdita con k≤4; il tiling per esperto verso l'HTP = seconda passata sugli stessi 8.4 GB. VERDETTO: NO-GO su classe 8 GB/UFS 2.2 (regola della prereg sbagliata — errore dell'orchestratore, verbalizzato). Porta aperta solo v75+UFS 4.0: una misura di read_bytes per prefill sullo Xiaomi decide; prerequisito di design: repack MB/s ≥ stream MB/s**. **q60b S23/UFS 3.1 ESEGUITA (25/08 sera, Marco-B′ 6.5 GB su 4.7 disponibili, sotto guard, audit math DeepSeek BANK-w-corr applicate, numeri riprodotti bit-per-bit): headroom NPU self-consistente ≈ 1.0× (flash-bound) — 12 GB letti per pp512 (1.8× il modello: la cache tiene ≤1.5 GB), calcolo utente 25% del tempo, stallo I/O 53-77%; il moltiplicatore di rilettura cresce col batch (0.9×→3.7× a 2048 → regime thrash 100-150 MB/s). Cross-device (Jelly UFS 2.2 + S23 UFS 3.1): lo streaming prefill è I/O+page-fault-bound, un acceleratore di matmul non muove il wall. ESTRAPOLAZIONE UFS 4.0 dall'audit (io_gate Xiaomi 2046 MB/s seq): pp512 ≈ 2.5-3× (1.6-4.1×) se la NPU azzera il calcolo utente → la porta v75 è reale; misura decisiva definita: pp512×3+pp2048 a freddo sullo Xiaomi con read_bytes per lancio + split utime/stime + finestra sampler vs wall. Design: solo double-buffering per layer può contenere il thrash**. **q61 XIAOMI/UFS 4.0 ESEGUITA (notte 25→26/08, braccio BORDERLINE Marco-B′ 6.5 GB = 0.57× MemTotal: nessun MoE ≥1.2× RAM disponibile — CalaQwen KEXP è 13.4 GB, sotto la soglia di 13.7 che avevo fissato; sotto guard, T1/T2 PASS sul device, audit math DeepSeek BANK-w-corr applicate): le tabelle headroom di Luna erano un ARTEFATTO di unità (CPU-secondi vs wall) + tautologia del floor self-consistent → 'settling statement' RITIRATO. Corretto: headroom pp512 utente-solo k=2 = 1.27-2.21× (mediana 1.74) = banda 'decisione owner' della prereg. FATTO FISICO: lo stesso file si carica a 1.82-1.85 GB/s in prefetch ma si rilegge a 193-427 MB/s in eval → il limite è il PATTERN a page-fault di mmap, non il flash (S23→Xiaomi +10% su un flash 4.76× più veloce). L'estrapolazione UFS 4.0 di q60b è REFUTATA. Ciò che NESSUNA delle tre celle misura: lo streamer di PRODOTTO (BigMoeOnEdge, blocchi ~1 MiB organizzati). PREREQUISITO HVX (1) NON ancora deciso: la misura vera = quota calcolo del prefill sotto lo streamer di prodotto sullo Xiaomi con CalaQwen KEXP (13.4 > 11.4 GB RAM = streaming vero) — cella nuova, go owner**. **q55 PART A ESEGUITA (notte 25→26/08, Xiaomi v75 scollegato 74→59%, sotto guard, prereg `b549f32e`, audit math DeepSeek BANK-w-corr applicate): PRIMA CERTIFICAZIONE DI CORRETTEZZA DELLA CORSIA 4.82× — OLMoE all-Q4_0, perplexity 32 chunk: HTP0 8.9214 vs CPU 8.9233, r = −0.02% (|r| 96× dentro le barre, correlazione per chunk 0.9999), con TUTTO il forward su HTP0 (28.659 execute-op: 3.024 MUL_MAT_ID esperti, attenzione inclusa) e KV storage su host (`-nkvo`, deviazione documentata: la KV da 256 MB a ctx 2048 non si mappa via fastrpc — limite host da segnare per il router: ctx lunghi su NPU richiedono KV su host). Scope certificato: forward HTP0 ≡ CPU per OLMoE/-nkvo/v75; non certificati: no-nkvo, Qwen, altri ctx. Ledger router: R2 'correctness certified (32 chunk, v75, -nkvo)' — resta OFF finché mancano cella spike app-side e modello memoria HTP. **PART B + QWEN ESEGUITI (26/08 mattina, audit mimo BANK-CLEAN): spike pp512 OLMoE su v75 in B-C-C-B — NPU 581/805 t/s (primo campione) vs CPU 52.6/53.1 (jsonl avg 70), ΔT NPU 0.0/1.0 °C vs CPU 0.4/0.0, MAX ≤32.1 °C: sul 750 lo spike è quasi gratis per entrambi e la NPU è ~8-11× (esplorativo; il 52 vs 142 t/s CPU di q48 NON è isolato: flag diversi -n 0/-t 8 vs -n 128, env Hexagon). Qwen3.5-4B-Q4_0 ibrido su HTP0 (-nkvo): arm HTP fermato dal cap 10 min a 12/32, CPU-ref dal floor batteria a 10/32 → chunk comune 10: **r10 = +0.109%** (r8 +0.136%) = PASS come CARATTERIZZAZIONE a 10 chunk della corsia densa/ibrida R3 su v75 (non certificazione a 32). thermalservice houji: nessun headroom numerico (come S23) → policy su temperatura batteria anche qui. Sessione chiusa a 44%/34.9 °C, nessun processo residuo. Falso stop 'cdsp' documentato (regola esatta in memoria)** |
| 28e | **CELLA DECODE NPU + sonda nseq (23/08, houji unplugged 68→66%, esplorativa-bancabile, raw verificati dall'orchestratore): STORIA PREFILL-ONLY CONFERMATA COI NUMERI.** tg128: HTP 4.09/4.85 t/s (gira davvero su HTP0, hvx-tiled n=1 — non è fallback, è proprio lento) vs CPU 11.94 → **decode NPU = 0.37× CPU** (secondo rep CPU 1.69 = outlier da throttle sospetto, wall ~102s, flaggato; il verdetto usa l'11.94, e regge comunque la direzione). Con prefill 3.19× e decode 0.37×, il governor #24 ha la sua tabella: **NPU=prefill/spike, CPU=decode, GPU=cool-mode — tutti e tre i ruoli ora device-verified.** Sonda nseq>1: NON eseguibile — llama-bench @3f545be non ha `-np` (rc=1 provato); evidenza desk dal kernel: `src1->ne[2]!=1 → return false // no broadcasting` + harness `nr=[2,1] → not supported [HTP0]` → il fallback CPU su batch multipli resta atteso da sorgente, non misurato. Evidenza `results/htp_decode/xiaomi_v75/`, `results/htp_nseq/xiaomi_v75/`. Jelly: pulito kalsajudge (~125 MiB), kalsa26 intatto | fatto |
| 28 | **Track NPU-spike (da desk research q25, GO due binari)** — fatti: backend Hexagon upstream costruisce skel **v73** (S23 in scope), quant supportati SOLO Q4_0/Q4_1/Q8_0/IQ4_NL/MXFP4 (**K-quant NO** → mai i nostri KEXP su HTP), riferimento upstream #26094: **461 tok/s prefill v73** (2B Q4_0 pp512, caveat nseq≠1→fallback CPU silente), VTCM 8MB = scratchpad non limite-modello, MiniLM embeddings ~1-2ms su target HTP. Gate raffinati: (1) build ggml-hexagon rev-pinned (serve Hexagon SDK CE 6.6+, possibile login Qualcomm) + smoke Q4_0 con prova scheduler che i nodi stanno su HTP; (2) pp512 nseq=1 su v73 E v75 separati + shape reale; (3) handover CPU↔HTP warm/cold misurato. NO-GO esperti-su-NPU generici. `scratchpad/agents/q25-npu-vision-feasibility/` | PC-prep poi finestre device |
| 29 | **Repack ARM e ricetta KEXP (finding dell'app-Claude 23/08, VERIFICATO nel nostro fork `repack.cpp:4627-4665`)**: su ARM q2_K si repacka solo con AVX-512/RISC-V (nessun ramo NEON) e q3_K non ha traits affatto → **gli esperti KEXP restano mmap file-backed e sfrattabili**, solo il tronco q5_K/q6_K va in anon. In-app su S23: LFM2.5-8B-A1B-KEXP collassa 11.1→0.4 t/s dal turno 13 (majflt 81k→535k), RssAnon 0.61/3.33 GB — artefatto rimosso dal loro catalogo. **Lettura nostra: la ricetta è regime-bound, non sbagliata** — (a) per modelli che STANNO in RAM con margine: serve residency (mlock/no-mmap oggi, o kernel repack NEON q2_K/q3_K scritti da noi = capitolo-fotocopia, upstream li ha solo x86/RISC-V); (b) per modelli >RAM: è il regime del motore streaming, dove il repack è OFF by design (BigMoeOnEdge hard rule #2: lo streamer rebinda al layout nativo) e il nostro io_gate dice che le letture organizzate a blocchi ~1MB sono quasi gratis (1.058×) — il loro collasso è fault-storm 4KB, non streaming organizzato; il route-trace LFM2.5 dava 93.5% cache-hit esperti → bounded cache regge. **Discriminatore economico da passargli: use_mlock=true su quel modello — se il collasso sparisce era tutta eviction (fix = mlock policy o kernel repack); se muore di LMK non ci sta con margine e nessun kernel lo salva → streaming.** Decisione owner eventuale: scrivere i kernel repack NEON q2_K/q3_K (valore anche upstream-wide). **DISCRIMINATORE ESEGUITO dall'app (23/08, S23 scollegato, 16/16 turni, unico delta il flag): COLLASSO SPARITO. Con `use_mmap=false` (mlock NON eseguibile su retail: RLIMIT_MEMLOCK 64MB soft+hard e llama.cpp fallisce con solo warning — trappola a verbale): 21.27→15.67 t/s monotono vs 11.06→0.41 bimodale col collasso dal turno 11; piano 464s vs 3055s (6.6×), 338 vs 904 mAh (2.7×), nessun kill; RssAnon 3.35/RssFile 0.07 vs 0.60/2.62.** Era TUTTA eviction: la ricetta è regime-bound e recuperabile, il blocco ha nome e cognome (q2_K/q3_K senza repack ARM). **Correzione app 23/08 sera: no-mmap NON è mitigazione shippabile in generale** — i tipi ≥4bpw con repack (Q4_K_M, Q4_0/QAD) hanno GIÀ i pesi in anon (misurato: arm C/D perdono 52%/71% di RssFile in conversazione SENZA collassare: erano pagine duplicate) → lì il flag compra zero e costa ~25s di load; serve SOLO ai tipi sub-4bpw senza repack, cioè le ricette nate per telefoni stretti di memoria, e chiede 3.35 GB di anon non recuperabile — la tensione che rende **il kernel #29 l'unica risposta spedibile** (residenza selettiva senza rinunciare a mmap + GEMM dotprod/i8mm più veloci). **CONTROLLO A DUE TELEFONI (app, 23/08 sera, predizione pre-registrata): stesso arm KEXP sul Jelly NON sfratta mai (RssFile piatto 3.396 GB, 117 majflt vs 534.715 del S23) e no-mmap lì fa ZERO (1.006×, 903s vs 898s) → 6.6× dove sfratta, nulla dove non sfratta: esclusi "anon più veloce", artefatti di load-order e code-path. Quindi #29 NON è interruttore globale: ship gate su condizione di margine MISURATA (~0.7 GB di MemTotal separa i due telefoni; plausibile, non misurato).** Correzioni misura (sostituiscono le precedenti): majflt per-turno DENTRO un arm traccia bene il collasso, è il confronto cumulativo TRA arm backed diversamente che non vale; la "bimodalità" 18–21/8–11 era LUNGHEZZA di generazione (corr(tok/s,tokens) negativa in ogni arm), solo il crollo 0.4–1.0 è sfratto; RLIMIT_MEMLOCK è per-device (S23 64MB hard, Jelly unlimited) e va letto da /proc/<app-pid>/limits, mai da shell adb/run-as; il degrado da crescita contesto (~1/3 in 16 turni, tutti gli arm) NON è recuperabile da #29 — mai valutare il kernel su un decay% totale | **GATE SUPERATO 23/08 notte: (a) ricerca deep q38 (BANK: ik_llama _R4 1.7-1.8× su NEON = precedente forte; gap upstream economico non tecnico; trappola 3D supports_op/compute al pin) + (b) consulto Qwen (8×4 dotprod first, Q2 size-neutral 672B, Q3 912B MAI int8, cache selettiva evitabile a budget) + (c) DESIGN DOC `docs/design-repack-q23k.md` scritto e DOPPIO-AUDITATO: mimo BANK (fedeltà fonti, trappole, coerenza) + Reviewer Math/DeepSeek MATH-CLEAN (ogni byte/bpw/overflow ricalcolato; margini int32 512×/1092×; l'unico errore numerico trovato era nell'audit di mimo, non nel doc — la regola "matematica a DeepSeek" paga subito). Branch: `kalsa/repack-q23k` su kalsallama, dal pin 1882bf8cd. **M0 CHIUSA 23/08 notte (4 commit, HEAD cef64aa4c, audit mimo PASS-with-fixes applicati): traits interni Q2_K_8x4 (672 B) / Q3_K_8x4 (912 B), packer scalari BIT-EXACT vs reference (verificato riga-per-riga, incluso round-trip scale 6-bit q3_K + hmask), gates neon+dotprod+shape, guardia 3D attiva, sizing dal trait con slice 64 B e padding azzerato, lifecycle extra pulito; API leak nell'header pubblico ritirata in header interno. Test host x86 PASS. **M1 CHIUSA (audit DeepSeek PASS pulito): oracolo dequant bit-identical fp32 vs nativo su 36 shape × pattern/random/edge, polarità hmask verificata, indipendenza a tre vie. M2 CHIUSA (audit DeepSeek PASS-w-fixes): GEMV NEON dotprod per entrambi i tipi GIRA SUL JELLY (A76 dotprod-only = target v1 esatto) — 108/108 vs oracolo, pin geometria e=2/t=1 offset 3360 confermato a mano, thread bit-identical, margini int32 294×/1100× come da design. Fix in corso: thread-test Q3 + RECINZIONE dell'hazard trovato dall'audit (op rifiutato su tensore repackato → path nativo legge i tile come layout nativo = garbage silente, classe #26537: ora fallisce LOUD + negative-graph test). **M3 CHIUSA (audit DeepSeek PASS, fix test-only): GEMM 8×4 entrambi i tipi sul Jelly — 252/252 + grafo M=1..9 + stress M=33 + thread bit-identical; accoppiamento bsum-colonna DIMOSTRATO algebricamente (indice reader = inverso esatto dell'indice quantizzatore); policy tail esatta (M%4 GEMM + code GEMV); fence recintato ai soli traits q23k, upstream intatto. Fix ordinato: n_threads=1 nel test negativo (longjmp cross-thread = UB test-only). **INPUT APP 23/08 notte (banked): (a) ORACOLO-TETTO per la v1 — l'arm armB-kexp-nommap è il limite superiore del kernel sullo stesso telefono/modello/piano: 464s totali, 21.27→15.67 t/s, 16/16 turni (vs 3055s mmap); il test di accettazione v1 è girare l'arm identico col kernel e confrontare con 464s (1h, decide se l'ottimizzazione GEMV è post-v1 o path critico). Forma del 6.6×: wall-clock sull'intero piano; per-turno va da 1.9× a 38× — il premio è evitare il collasso, non velocizzare un turno sano. (b) ⛔ IL GATE CONDIZIONALE OGGI NON È CALCOLABILE: il loro stimatore (estimateModelNonEvictableMiB, repack:false) sbaglia di 11× in direzione pericolosa (249 MiB stimati vs 2.70 GB RssAnon misurati) — richiesta esplicita: esporre dal lato kernel la dimensione del working set residente per ricetta (noi la SAPPIAMO esatta: ggml_repack_q23k_8x4_nbytes) = deliverable v1.5. (c) Il kernel NON riapre l'artefatto LFM2.5-8B-A1B-KEXP (bocciato di QUALITÀ: +0.0705 macro bpb, lingua sbagliata 1/3 delle volte — nessuna velocità lo tocca); il valore del kernel è più largo: ogni q2_K/q3_K su ARM. (d) Correzione NOSTRA da mandargli: il "1.5× sulla GEMV" va sospeso — l'audit MAX RECALL ha mostrato che i 51µs includevano un repack completo per iterazione nel loop temporizzato (kernel-only = 6µs); il bench va rifatto con repack hoistato prima di dichiarare gap.** **ARM E APP (23/08 notte, banked): streaming 21× su S23/8B-Q4_K_M** — l'arm mmap muore al turno 7 (0.26–0.29 t/s, 1.74M majflt, RssFile 2.43 GB = THRASHING: la premessa "l'8B ci sta in 8 GB" era falsa su quel telefono, il modello NON è nel regime fits), streaming 5.2–6.6 t/s, 6.189 majflt, 16/16, batteria 0.75 vs 5.7 punti/turno. Conseguenze per noi: **(1) v1.5 RIPRIORIZZATA — l'accounting API non è più uno sblocco ma una GENERALIZZAZIONE**: l'app ha il predicato per quella entry dalla costante misurata (picco RssAnon 2.750.692 kB @ ctx 8192) e rifiuta lo streaming ai modelli senza misura (assenza=informazione); la nostra API serve per qualunque gguf/ricetta senza girare un arm per modello. **(2) Avvertimento a specchio sul bench (adottato): il numero di prodotto non è il kernel isolato ma kernel + ammortamento del packing sui token serviti prima dell'eviction** — se il buffer sopravvive alla sessione il packing è rumore, se viene sfrattato si ripaga: il bench rifatto deve riportare kernel-only, costo packing E break-even di ammortamento. **(3) Il 21× NON è commensurabile col nostro oracolo 464s** (modello e meccanismo diversi — streaming vs residenza): il decisore v1 resta l'arm 464s, invariato.** **M4 CHIUSA (audit DeepSeek PASS-w-fixes): il path esperti 3D è REALE sul Jelly — dispatch MUL_MAT_ID via nb[2] packed, 72/72 kernel+grafo + broadcast + thread bit-identical; convenzione ids e semantica dst verificate CONTRO IL NATIVO al pin (non self-consistent), riuso attivazione = formula nativa, catena oracolo ancorata a M1. Finding M3-era da fixare (in corso): il ramo 2-D MUL_MAT accettava RHS batched 3-D calcolando solo il batch 0 = silent-wrong sui batch ≥1 → supports_op ora richiede src1 ne[2]==ne[3]==1 + nb densi. **M5 CHIUSA. MAX RECALL 3/3 COMPLETO sul diff cumulativo v1**: pass 1 (DeepSeek, matematica) PASS zero bug numerici, contratto bsum brute-forced contro il produttore; pass 2 (mimo, struttura) PASS-w-fixes, 13/17 decisioni CONFIRMED, nulla trapelato, API pulita, 4 staleness doc (applicati), lista debito 10 voci; pass 3 (grok occhi-freddi) **ha pagato: 2 HIGH confermati che gli specialisti non avevano visto** — (a) n_as==1 repackato ma rifiutato al dispatch (ggml_n_dims([K,N,1])==2) → fence abort, fix = gate su ne[2]/ne[3] non n_dims; (b) UB da downcast nel fence su extra alieni (KleidiAI/AMX senza slot name() in vtable, secondo call-site su OGNI op) → fix = pointer-equality sui static; più MED (null-checks supports_op, decline delle view su tensori tiled, nbytes ibrido documentato) e un REFUTED prezioso (block_q8_K.d è float anche upstream — nessuna divergenza). Fix finali in corso (+ bench a 3 numeri: kernel-only, costo packing, break-even ammortamento). **V1 FORMALMENTE CHIUSA (23/08 notte, push verde `9890d1054` su kalsa/repack-q23k):** tutti i fix del max recall applicati e device-verified (n_as==1 PASS su Jelly, fence a pointer-equality — la riscrittura è la prova per KleidiAI, null-checks, view abortite, wart nbytes documentato). **Bench finale a tre numeri (Jelly): native 3µs / repack 5µs compute-only, packing 43µs una tantum — verdetto onesto a verbale: "repack is not faster per call; value is residency only"** (l'ottimizzazione GEMV per pareggiare il nativo è materiale post-v1; il premio resta il 6.6× di residenza dove il device sfratta, arm 464s come esame). Suite M0–M5 verdi host+Jelly, sha host==device. STOP v2/cache/i8mm. **INTEGRAZIONE DECISA DALL'OWNER 23/08 notte ("un solo kernel sul main") ED ESEGUITA: kalsallama `main` @ 9890d1054 = IL kernel** — git ha provato che i "due lignaggi" erano una catena lineare unica (hook mmap → s1 fuse → s2 → s3 Adreno q2/q3 → repack v1), quindi main le contiene TUTTE; 7 puntatori ridondanti cancellati (commit tutti raggiungibili, zero perdita), default branch GitHub = main; restano solo main, master (upstream), mali-probe (never merge), mld-gemv-m1 (unico, decisione owner). **I submodule (app + BigMoeOnEdge) devono puntare a kalsallama main** — l'app compilava il vendorizzato con pin vecchio su ramo senza kernel GPU (3 disallineamenti, tutti risolti da main). Correzione protocollo dal richiamo owner: **il gate qualità asse-B è MULTILINGUE d'ora in poi** (il FAIL IQ4_NL regge a fortiori: crollato già sull'inglese). Restano per l'owner: arm 464s, v1.5 API working-set, upstream PR a stadi. **BUG PRODUZIONE FIXATO E MERGIATO (q47, 24/08, kalsallama main 9890d1054→`a0cabca6b`, review DeepSeek BANK-w-fixes applicati, device-verified Jelly)**: crash SIGABRT in-app al load dei KEXP (report app 24/08) = `ggml_nbytes` IBRIDO — init_tensor pubblicava gli stride packed prima dei dati, il loader passava i byte nativi, assert `:5339` sul primo tensore 3D con slice non 64-allineata (il Q3 912B; il Q2 di LFM è allineato e ingannava — moriva il Q3 successivo senza log). Fix: nb[] resta nativo fino al pack (packer unico scrittore) + **BONUS: fusione MoE FFN/GEMV che macinava vec_dot nativo su byte tiled = silent-garbage, gate generalizzato a TUTTI i trait tiled (anche upstream q4/5/6_K 8x4, latenti)** + death-test padded + test loader reale (il buco che M0–M5 non coprivano) + SKIP 77 anti-vacuità x86. Jelly: pre-fix abort riprodotto, post-fix 44×q2+22×q3 repack, generazione sana, -nr coerente, M5 A/B PASS. **App: rebuild APK dal main nuovo; arm 464s SBLOCCATO** |
| 30 | **PROTOCOLLO DI CERTIFICAZIONE RICETTA (direttiva owner 23/08 notte): la ricetta KEXP è un TEMPLATE — ogni modello che la indossa (Marco, CalaQwen, futuri) va certificato su DUE ASSI INDIPENDENTI prima di entrare in lineup: (A) leggibilità kernel** — geometrie dei tensori esperti vs i gate repack #29 (ne0%256, ne1%8), predicati NPU del tronco (attn ne0%32, ne1≤32768), compat streaming-engine; **(B) qualità del quantizzato from-source** — perplexity + gate comportamentali (LFM2.5 è caduto QUI: +0.07 bpb, lingua sbagliata ⅓ — leggibilità perfetta, qualità no). Mai certificare un asse e dedurre l'altro. **Stato matrice: Marco A✅(M5 byte reali) B✅ per il CONTROL (PPL baseline 9.5915±0.071 wikitext, q41 — il KEXP attuale è il riferimento; le varianti tronco-4bit bocciate); **Marco-B′ asse B: FAIL v1 (q49, 24/08, gate (i) alla lettera)** — 60 prompt multilingue freschi, prereg congelata pre-generazione, giudice cieco mimo: (iii) B′ PREFERITO 6:1 (53/60 TIE, control_pref 0.143), (ii) PASS (unico flag = falso del detector, spagnolo corretto in entrambi), MA (i) FAIL: 2 loop B′ di cui UNA degenerazione vera solo sua (`code_en_05`, temp-0 greedy) + macchia registrata (caratteri cinesi in un trap spagnolo). Quadro completo: PPL 5/5 meglio + preferenza cieca per B′, ma differenza comportamentale reale al greedy. **CELLA v2 ESEGUITA (q52, 24/08 sera, APPROVATA owner, prereg lockata `1a1c9a19` col sampler di PRODUZIONE estratto dall'app con file:line — temp 0.7/topk 40/topp 0.95/minp 0.05, penalty OFF, n1024; 400 gen appaiate 60 prompt × 3 seed + loop-proni × 10 seed, runner detached blindato dopo incidente console-kill a 50 run, 2 retry riusciti): FAIL DEFINITIVO** — base L_B=2 vs L_C=1 → ramo escalation preregistrato (solo `long_it_04`, unico eccesso per-prompt; `code_en_05` pari 1-1 = loop-prone il PROMPT, non il tronco), **escalation seeds 301-310: B′ degenera 4/10, control 0/10** (elenchi infiniti "Dott. Bianchi" fino al cap, verificati a mano dall'orchestratore su s303; totale sul prompt B′ 5/23 vs 0/23). Audit indipendente pre-bank DeepSeek **BANK-CLEAN**: detector conforme alla lettera, 420/420 righe ri-derivate identiche, 4 righe killer tutte degenerazioni genuine, control appaiati puliti. **Conseguenza (frozen in prereg): tronco lineup RESTA Q5_K/Q6_K, KEXP-Q8 NON procede, B′ = variante lab per corsia NPU con asterisco quality (le corsie router tronco-B′ devono un gate loop oltre alla correttezza)**. Metodo a verbale: PPL migliore 5/5 + giudice cieco 6:1 PRO B′ convivono con una coda degenerativa 4/10 — i primi due strumenti non la vedono, il gate loop sì. `scratchpad/agents/q52-axisB-v2/{PREREG,REPORT,REVIEW_MATH}.md`; CalaQwen A✅ CERTIFIED-with-exceptions (q42, 23/08 notte: 120/120 esperti PASS gate repack — 0% byte esperti nativi; tronco a ricetta + output.weight Q4_K da pin cook; IQ4_NL passa le geometrie attn; embd/output FAIL_DIM vocab 248320 untied = testa su CPU come Marco; streaming: 256 esperti × 40/40 layer uniformi + shexp 2D + GDN/SSM su 30/40) B❌(costo: sorgente ~70GB, decisione owner); LFM2.5 A✅ B❌→fuori.** I futuri modelli entrano nella matrice alla nascita | protocollo permanente |
| 21 | Opzionale diagnostica: config inversa di B (tronco CPU + esperti GPU via `--override-tensor 'ffn_.*_exps'→GPU, -ngl 0`) — scompone il crollo di B (7.9): se inversa≈B dominano gli attraversamenti per-layer, se inversa≫B conta chi esegue gli esperti. 2 blocchi esplorativi, nessun valore di prodotto (config dominata sulla carta: stessi crossing di B + esperti sul processore perdente) | quando capita |
| 31 | **Sweep -ngl {¼,½,¾,full} su LFM-KEXP/S23 + accounting memoria GPU (richiesta app-Claude 24/08, accolta)**: quando/se lo sweep si fa (graduatoria concordata: DIETRO l'arm 464s), ogni punto -ngl cattura oltre a t/s e °C: (1) `MemAvailable` pre-load E **campionato DURANTE la generazione** (loop di sampling — le probe pre/post sono cieche: verificato sui raw #16/#18, il post è a processo morto); (2) `VmRSS/RssAnon/RssFile` del processo agli stessi istanti; (3) file size GGUF, layer totali, layer effettivamente su GPU (dal log llama). Scopo app: costante "MiB di sistema per MiB di peso offloadato" per il fit-gate GPU (`memoryEstimate.ts` conta i pesi come evictable — falso sotto offload: allocazioni driver/CL non recuperabili e invisibili all'RSS; lmkd uccide senza eccezione, il gate è l'unica difesa). Forma stimatore suggerita: fixed_overhead + Σ(byte tensori offloadati)×k + KV(ctx, layer attn offloadati)×k′ — predittore in BYTE non in layer (LFM ibrido conv/attn = layer eterogenei); converge con la v1.5 accounting API di #29 (esporre anche byte per-layer). Datum S23 ngl=99 (MemAvailable 4.02→0.583 GB): **ATTRIBUITO dall'app (24/08, loro `docs/HARNESS_FINDINGS.md` §7.18, 19/08): Qwen3.5-4B DENSO Q4_K_M 2.83 GB + proiettore vision F16 672 MB = 3.502 GB file, caduta 3.437 GB → k≈0.98 (~1:1)** — la nostra prima ipotesi LFM-KEXP era aritmeticamente plausibile e SBAGLIATA (i 672 MB che quadravano erano il proiettore, non KV+runtime; monito metodo a verbale). Resta sanity check, NON calibrazione: VmSwap +1 GB inquina il delta, ctx non registrato (quota KV non separabile), modello denso = niente sul caso esperti. La richiesta di sweep resta intera. Sinergia arm-464s: il protocollo già logga RssAnon/RssFile/VmSwap per turno — aggiungere MemAvailable per turno regala all'app la serie di validazione di `MemAvailable − RssFile` come "spazio vero a modello caricato". **SWEEP ESEGUITO (q44, notte 23–24/08, PROMOSSA dall'owner, prereg lockata `2ae386ae`, S23 staccato 100→96%, T≤30.9°C, cpuset gate su ogni punto, binario #18 s3oracle sha-match, audit math DeepSeek CLEAN 0-refuted): k NON è costante** — k_set 1.74/1.43/1.27/1.05 a ngl 7/13/19/99 (N=25), incrementale 1.70→0.09 (gli ultimi 6 layer: +578 MiB tensori, +50 MiB ΔMA). Lettura affine post-hoc (dai numeri auditati): partial-offload ≈ **~750 MiB fissi (≈ prealloc Adreno, visto anche a ngl 0) + 1.0× byte offloadati**; gate conservativo candidato per l'app `800 MiB + 1.05×byte` (safe su tutti e 5 i punti, molto più stretto del moltiplicativo 1.7–2.0 a full). Payload collaterali: a ngl 0 RssFile picco 3.1 GiB con ΔMA 35 MiB (prova diretta: l'mmap non tocca MemAvailable, il cliff GPU è tutto driver e NON sta in RssAnon ~80–110 MiB); tg128 full-GPU ≈ ngl0 (13.2/13.3, esplorativo, coerente #18), pp512 25→69; KGSL per-pid illeggibile su S23. Evidenza `results/ngl_sweep_s23/`, `scratchpad/agents/q44-ngl-sweep-mem/`. Resta: validare le costanti su secondo modello/device prima di fidarsi | fatto (sweep); costanti da validare su 2° modello |
| 32 | **q59 — GATE QUANT DENSO HTP-readable (Qwen3.5-4B, PC notturna 25–26/08, prereg `f10d997b` + Amendment 1 pre-result, audit math DeepSeek BANK-w-corrections solo wording, 15/15 celle e sha ricalcolati su disco): IQ4_NL FAIL, Q4_0 FAIL → nessun denso HTP-readable spedisce, decisione owner.** Same-source (BF16 `Qwen/Qwen3.5-4B` `851bf6e8`, quantizer pinnato `e5605f3bd`), control = Q4_K_M same-source, `-c 2048 -t 8` Idle. Δ% IQ4_NL: wiki −1.16 / it +0.84 / es **+1.39** / fr +0.46 / zh **+1.02** (gate ≤ +1.0 % su 5/5 → 2 FAIL); Q4_0 +2.15…+3.36 sulle 4 lingue (FAIL 4/5); Q8_0 saltato (Amendment 1). Lettura paired per-chunk (post-hoc, NON-gating, `PAIRED.md`): IQ4_NL è peggiore del control su TUTTE e 4 le lingue in modo non-rumore (sign p ≤ 4e-3, CI 95 % esclude 0; SE 0.15–0.30 pp, 3–7× più stretta del ±err naive), upper bound ≤ +1.93 %; la posizione rispetto a +1.0 % resta irrisolta su it/es/zh (CI a cavallo); Q4_0 lower bound ≥ +1.69 % ovunque; **wiki inverte** (entrambi i candidati MIGLIORI del control, CI esclude 0 — fatto registrato, non spiegato: è il motivo per cui il gate è multilingue). Size IQ4_NL −3.4 % vs Q4_K_M same-source (−5.1 % vs shipped unsloth). Da NON confondere con q41 (tronco KEXP: IQ4_NL +4.27 %): qui è il denso, effetto 3–9× più mite (4.27 / 1.39…0.46). **Opzioni owner (`ARBITRATION.md` §3): A = resta Q4_K_M (status quo); B = IQ4_NL con asterisco qualità, MA prima gate loop comportamentale classe q52 (PPL 5/5 non vide la degenerazione di B′); C = Q4_0 fuori su ogni lettura. Raccomandazione orchestratore (non vincolante): A ora, B differita — l'unica ragione di IQ4_NL è la corsia R3 (denso/ibrido su HTP v75, 3.19–3.5×), che nel ledger è OFF finché mancano cella spike app-side e modello memoria HTP; IQ4_NL = variante da laboratorio NPU, stesso status di B′.** Secondari (Qwen3.5-2B, Gemma-4-e2b) non eseguiti (prereg: "se c'è tempo"). Evidenza `scratchpad/agents/q59-dense-quant-gate/` (REPORT, PAIRED, ARBITRATION, AUDIT_MATH, `gguf/ppl/*.{json,log}`; i gguf da 2.5–2.8 GB restano fuori git). **DECISIONE OWNER 26/08 pomeriggio: A** (resta Q4_K_M, nessuna regressione per nessuno; B = IQ4_NL puro per tutti RESPINTA: tassa qualità a tutti per un beneficio solo v75-class e oggi spento) **+ strada D aperta: q63 "IQ4_NL-M"** — ricetta HTP-readable = IQ4_NL base + Q8_0 sugli stessi tensori che Q4_K_M alza a Q6_K/Q5_K (la "M" è il mix, non il tipo base — metodo KEXP applicato al denso), stessa sorgente/quantizer/gate di q59 con riuso delle celle control; se passa 5/5 → ship per-device (solo v75-class) dopo gate loop classe q52. Se fallisce anche il mix: il denso sull'NPU aspetta HVX (28c). | fatto (gate); **owner: A**; q63 prereg in scrittura |
| 33 | **q62 — PREFILL SOTTO LO STREAMER DI PRODOTTO (`bmoe-cli --moe-stream`, binario spedito `0ac612de`, Xiaomi v75, CalaQwen KEXP 13.42 GB > 11.4 GB RAM, 26/08, GO owner, unplugged 52→50 %, guard max 31.2 °C, cpuset 0-7, prereg `ede3bc30` + Amendment 1 pre-result `d82fb3c1`; audit math DeepSeek BANK-w-corrections solo wording, REPORT byte-riproducibile): PRIMARIO 3/3 — IL PREFILL IN STREAMING È COMPUTE-BOUND, NON FLASH-BOUND.** Prompt 486 token (contati dal motore; `-n 1`, riga decode esclusa), `--cache-mb 0`, 4 lane I/O O_DIRECT: wall 38.05 / 35.81 / 32.78 s (12.8–14.8 tok/s), letture esperti 7149 MiB (6.98 GiB) per prefill. Il motore NON decompone io/compute in prefill (BMOE_PROGRESS copre solo il decode) → I/O wall dall'**io-trace** (19,542 letture, latenza per lettura): Σlat 17.8 / 17.1 / 14.3 s, modello max-lane-per-layer (4 lane parallele, overlap=0) → **I/O = 10–13 % del wall, compute ≈ 87–90 %**; robusto sotto TUTTI e tre i bound (lower Σlat/4, point max-lane, upper Σlat serializzato: quota I/O max 0.477 < 0.5 in inv2). **Headroom (wall-secondi, [[measurement-ceiling-method]]) k=2: 2.22–2.27; k=4: 4.45–4.55 (point), ≥ 2.095 anche nel bound serializzato; k=8: 8.3–9.0.** Settling rule prereg: min headroom(k=4) = 2.095 ≥ 2.0 → **lo streaming-NPU ha un tetto reale sotto lo streamer di prodotto: PREREQUISITO HVX (1) SODDISFATTO** (la decisione kernel resta dell'owner, con (2) = dato 8xx). Contrasto con q60/60b/61 (mmap page-fault, 0.2–0.4 GB/s pattern-bound): lo streamer di prodotto legge a 1.75–2.27 GB/s effettivi in prefill (1050 MiB/s in decode, contatore motore). Caveat onesti: modello max-lane PLAUSIBLE non verificato (trace senza timestamp; bracketed dal contatore decode del motore: 328 vs 334 ms), over-read sistematico +4 KiB/lettura (+1.05 %), wall che cala 38→33 s (−13.9 %, 83 % lato compute, I/O non monotona: verdetto sopravvive), sampler /proc sul pid sbagliato (cross-check fallito, dichiarato), page cache non droppabile (no root), **secondario `--cache-mb 2000` e opzionale 2048 NON eseguiti** (device via con l'owner: stasera se riattaccato, altrimenti dopo il 07/09). Attempt 1 (comando frozen incompatibile: `-r`/`--no-warmup` assenti, `-p` = testo) registrato, zero numeri usati. **APPENDICE 27/08 notte (Xiaomi staccato 68→60 %, cool-start ≤ 31.9 °C, stesso audit DeepSeek, appendix BANK-w-corrections applicate, REPORT byte-deterministico)**: secondario `--cache-mb 2000` 3/3 — wall 34.2–35.0 s, quota I/O point 0.124–0.129, headroom k=4 point 4.57–4.60 MA sotto il bound serializzato 1.94–2.02 (inv1/inv2 "mixed", margine più stretto dello studio 1.1 %): la frase "≥ 2.095 sotto OGNI bound" resta SOLO del primario; **la cache lavora in decode (−30 % byte, 288 slice servite) ma il prefill legge byte-identici** → "consistent with no measurable prefill effect" (deviazioni −8.05/−4.49/+5.85 %, dentro lo scatter ±6–14 %), come previsto dal prereg. Opzionale p2048 (n=1, esplorativo, 2033 token): wall 159.9 s, quota I/O 0.10, headroom k=4 4.45 — il quadro compute-bound scala. Deviazioni dichiarate: gate batteria 40 vs 45 nel codice (nessuna invocazione ammessa che il gate lockato avrebbe respinto), trail sha del prompt 2048 corretto (`a748f3c4`, il superato `66271b47` annotato), sampler ancora sul wrapper (nessun numero derivato ne dipende). | fatto (primario+secondario+opzionale); **decisione HVX = owner** |
| 34 | **q64 — SWEEP CACHE IN REGIME STREAMING SU S23 (26/08 notte, scollegato 90→82 %, max 31.3 °C, binario spedito `0ac612de`, Marco i1-Q4_K_M 10.5 GB > 8 GB RAM, prereg `4fc6bf4e`, audit math DeepSeek BANK-w-corrections, numeri 15/15 riderivati, REPORT byte-riproducibile) — chiude la coda #5b + resto riga 6: LA CACHE ESPERTI È DECISIVA, COSTANTE APP = 3437 MiB.** `--cache-mb` {0, 1500, 2000, 4000, auto}, quadrato latino N=3, tg128 greedy (tutte le run a EOS al token 102, testo decodificato byte-identico → finestra 9–102 identica per arm, arbitrato dichiarato): decode **1.07 / 1.76 / 1.93 / 2.84 / 2.75 t/s** (0→4000 = **2.65×**), hit rate 0 / 29 / 39 / 59 / 55 %, letture 32.9 / 20.8 / 16.6 / 8.7 / 10.0 GB per 102 token, quota I/O 0.47–0.50 → 0.38–0.40; MemAvailable pre 5.2–5.4 GB, nessun LMK. Regola frozen (C minimo entro il 5 % del migliore): auto (2.753) entro il 5 % di 4000 (2.838, soglia 2.696) e size risolta di auto 3429/3437/3524 MiB → **costante = 3437 MiB** (auto del motore è già ottima). Prefill 128/prefill_s: 11.9 → 7.8 t/s al crescere della cache MA NON stabilito come effetto cache (spread intra-arm 11.3–16.7 s, blocco 3 tutto lento, nessuna telemetria di prefill). Confronto q60b: rapporto di tasso effettivo wall-normalizzato 0.547 vs il gate O_DIRECT sequenziale 430 MB/s (non una capacità); tasso io-time-only alla costante 569–613 MB/s (1.32× il gate). Deviazioni: EOS 102, pagecache non droppabile, 3 artefatti rc=1 del wrapper (race di cattura rc, nessun impatto), 1 mismatch bookkeeping guard corretto. Evidenza `scratchpad/agents/q64-s23-stream-cache-sweep/`. | fatto; costante cache app 3437 MiB (8 GB, streaming) |
| 35 | **q63 — RICETTA “IQ4_NL-M” HTP-READABLE SU QWEN3.5-4B (road D, 26–27/08, PC notturno, lock `7477247a`, binari ricompilati ai commit pinnati con pre-check validità control/fr 7.1786 = q59 esatto, audit math DeepSeek BANK pulito — 10/10 delta riderivati ≤1e-9, paired bit-exact, es robusto al floor di arrotondamento [+0.9511, +0.9539] — / doc mimo BANK-w-corrections applicate) — C1 PASS 5/5: LA QUALITÀ DI Q4_K_M STA NEL MIX, NON NEL TIPO BASE — PRIMA QUANT DENSA HTP-READABLE CHE PASSA IL GATE.** C1 = IQ4_NL base + Q8_0 sui tensori che Q4_K_M promuove (`--tensor-type` first-match + embd/out Q8_0), 3 098 664 160 B, dump: HTP-readable PASS: Δ% vs control Q4_K_M (celle q59 riusate): wiki **−2.31**, it +0.43, es **+0.95**, fr +0.12, zh +0.62 → 5/5 ≤ +1.0 % (gate point-estimate, stesso standard del FAIL q59; onestà: il paired post-hoc NON-gating dà su es CI [+0.39, +1.51] che NON esclude la soglia — dichiarato, non gating). C2 (`--pure` IQ4_NL + Q8_0 embd/out, 2 765 741 280 B) FAIL 3/5 (it +1.31, es +1.73, zh +1.69; wiki −3.16, fr +0.84) → sono i ~37 tensori promossi a fare la qualità, non il formato base; wiki inverte su entrambi i candidati (coerente con q59, inspiegato). **ERRATUM q59 (bancato qui):** l’arm “IQ4_NL” di q59 era NON pura (37 tensori Q5_K) → NON HTP-readable; il suo FAIL resta valido come gate qualità, ma la domanda “HTP-readable” l’ha chiusa solo C1. **q67 (Xiaomi v75 ultimo giorno, lock `4b5afc37` + Amdt 1–3 `d451a1ee`/`aa697b3d`/`62e29f09`):** C1 CARICA ED ESEGUE su HTP0 (prova execute-op, sha verificati, temp piatte negli arm B) e pp512 **HTP 199.7 vs CPU 43.8 t/s ≈ 4.5×**. Trail amendment dichiarato: Amdt 1 = il comando lockato ometteva `-f` (att. 1 A1/A2 = 0 token, VOID); att. 2: A1 HTP kill guardia a 41.1 °C dopo 486 s con **20 chunk PPL validi**, poi Amdt 2 riapre il solo CPU-ref (post-risultato, deterministico) ma A2 attaccato-in-carica muore a 43.0 °C al chunk 4 (attaccato non regge PPL densa sostenuta, nemmeno CPU); Amdt 3 = owner stacca lo Xiaomi ma A2 att. 3 non parte mai (gate MemAvailable ≥ 4.0 GiB mai raggiunto in 2404 s, residenti HyperOS); Amdt 4 (FINALE) = UN reboot sanzionato, riattacco adb in 281 s, gate chiuso anche da fresco boot (3.59–3.61 GB) → **r = VOID, NON misurato** — i 20 chunk HTP di A1 restano senza riferimento CPU; gate mai abbassati, nessuna eccezione; misura al rientro v75 (post-07/09) o su QDC v79. Conseguenza: road D APERTA — ship per-device (solo v75-class) DOPO un gate loop classe q52 (lezione B′); la condizione “q63 FAIL” della regola pre-delegata HVX (§8 del piano 10 giorni) NON scatta. Evidenza `scratchpad/agents/q63-dense-htp-recipe/` + `scratchpad/agents/q67-c1-htp-v75-load/`. | fatto; C1 = candidata NPU-lab; gate loop prima di ogni ship |

## Audit upstream 20/08 (websearch, base 22b69b6e9 → master 749f688fc, 583 commit)

- **Il gate A6X/A7X è ANCORA attivo a master** e i nostri 3 miscompile restano
  NON fixati upstream; anche K2 (q4_K/q5_K MUL_MAT_ID) è intatto (kernel con
  maschere letterali e mask-then-shift ancora a master). **Il dossier resta
  inedito e pubblicabile — e K2, se lo chiudiamo, si aggiunge al dossier.**
- **Nota dossier (21/08, review S3 q2/q3, NON ancora device):** 5° difetto
  latente **upstream** nei kernel Adreno MoE q4_K/q5_K/q6_K: early-return
  `i01>=ne01` / `row>=ne01` **prima** della barrier di work-group, e GEMM
  legge `row_idx` non clampato. Dormiente su ogni shape attuale `%64==0`
  (LFM 2048, test m=512). Il gate ammette `%32`. Trovato da review, non da
  hang/OOB sul device. Port barrier-safe = coda #13, sessione sua; q2/q3
  lo adottano ora come eccezione esplicita (non toccare il baseline v3).
- Qualcomm converge a pezzetti sulla NOSTRA medicina senza la diagnosi generale:
  #25780 (q4_K/q5_K flat dense: load uint invece di ushort, workaround A7X),
  **#26476 (merged 20/08: q6_K flat dense MUL_MAT sbagliato su 642L/740/E031,
  fixato con dequant SCALARE + flag `ADRENO_OLD_COMPILER`)** — che è
  esattamente il difetto dei nostri 10 dense q6_K flat FAIL del retrial
  (fuori perimetro K2): fix candidato da cherry-pick. #26436/#26440 (open):
  stessa famiglia compiler, un-programma-per-kernel su 642L e q4_K lm-head→CPU.
- Bump submodule: 583 commit, GGUF invariato (v3), ma breaking su llama.h
  (`use_mmap`→`llama_load_mode` tocca il seam BMoE, sampler API). Vale per
  modelli nuovi/backend, NON supersede nulla di nostro. Non urgente; se si fa,
  OpenCL va mergiato selettivamente.

## Correzioni a verbale (dal MAX RECALL)

- Cella 6 retrial: media ERR **0.4158** (non 0.4325), **4/12** sotto 0.36 (non
  2/12) — arbitrate sul log grezzo; verdetto qualitativo invariato.
- I consumer non-riscritti (q4_1/q5_x/q4_K, mask-then-shift) sono PROVATI non
  miscompilati (156 casi, deviazione varrebbe 900× soglia): il port di
  uniformità è igiene, non urgenza.


## TL;DR lanes (2026-08-14)

> 🎯 **DIRETTIVA gualt (2026-08-14, aggiornata): "VOGLIO UN NOSTRO KERNEL"
> — CPU per velocità, O RAM, O GPU/SSD per temperatura/calore: la value
> proposition è che lavoreremo sempre su LLM appena uscite** (day-zero
> enablement dove upstream ha solo fallback lenti + streaming-aware paths
> che upstream non farà mai + efficienza termica). Lane vive: (1) KERNEL
> — **K-E MORTA (KE_NULL, 2026-08-14): l'i8mm non gira mai nel motore
> reale — i kernel mmla vivono solo nel path REPACK che gli esperti
> streamati bypassano (`use_extra_bufts=false` portante); decode +1.1%
> cpu, wall −2.4% = rumore, il −6.3% cpu-time era artefatto n_gen; anche
> il sustained confondato dall'ordine termico. Kill criterion rispettato.**
> **K-G MORTA (KG_KILL): il "prefill GPU 1.29×" era un artefatto
> (baseline = media con rep cold-outlier); onesto p512 1.12×, ibrido
> 1.07×; boundary 0.068 ms/tok = non sono il collo. K-F VIVA (KF_GO):
> stall = 37.3% del wall su Marco-Jelly (0.1025/0.2746, identità
> wall=compute+mgmt+stall chiude al ms), derivato dai log esistenti a
> zero minuti device; tetto layer-ahead issue-only ~36% del wall (finestra
> stretta 8-14%); il macchinario route_ahead_submit/collect/issue_for
> ESISTE già nell'engine — **🏆 KF_PROTO_WIN (2026-08-14 sera, Jelly
> Marco1c): wall 0.318→0.210 s/tok (−34.0%), tok/s 3.14→4.77 (+51.8%),
> stall 26.9%→17.2%, precision 68.3%, IDENTITY_D0=PASS (sha identici a
> drop 0); a d0 il win regge (−25.7%) quindi non è artefatto del drop;
> divergenza testo a d065 ATTESA (F2 review). Il −34% satura quasi il
> tetto derivato ~36%: il prefetch elimina anche i page-fault dentro
> "compute" (0.218→0.163). Costi onesti: ~31% byte issued sprecati,
> J/token NON misurato → serve cella energia K-F prima di promuoverlo in
> config default, e N≥10 pre-registrato per qualsiasi claim di ship.
> Branch kalsa/kf-layer-ahead @ c3e8fc4; report
> reports/moe-kernel-kf-proto.md.
> **SCOREBOARD K-F v2 (gualt, 2026-08-14 notte — tassonomia ufficiale,
> missione: tutta verde o quasi):**
> KF_MEDIAN_WIN ✅ · KF_ENERGY_NEUTRAL ✅ (pooled 1.028; mappa width:
> W2 0.976 / W4 1.008 / W6 1.125) · **KF_THERMAL ❌ sotto sustained, ED
> È FISICA** (ON sag 0.32-0.36 vs OFF 0.23: corre più forte presto,
> scalda di più, tutti convergono a ~2.5 tok/s late — K-F è un
> acceleratore di burst, non alza il rate termico; la mediana su 1000
> tok vince comunque +20%) · **KF_MEMORY: gate da RIDEFINIRE** (majflt
> non monotono e invertito vs IO — misura QUALE path legge, non il
> distress; RAM min 3.46GB, zero pressione reale; niente cold-start
> bill nello sweep) · **KF_TAIL: REGIME-SPLIT — sotto sustained la coda
> si RIBALTA: ON batte OFF a ogni width, p99 monotono 638→481 ms
> (W6); la regressione v1 era artefatto del regime tiepido. MA il
> regime prodotto chat = burst corti ≈ v1 dove ON perdeva → decide la
> cella burst (generazioni corte + pause)** · KF_ROBUST → cella
> registrata nel regime prodotto · **PARETO: ginocchio a W4 (+15.6%
> tok/s a energia pari); W6 max speed (+20%) a +12.5% J; W2
> energy-positive (−2.4%)** — candidato default W4 pending burst-test ·
> **KF_GENERAL MISURATO (Xiaomi, finestra offerta da gualt): NON
> universale — sul fast-flash l'OFF caldo VINCE (0.398 vs 0.404-0.406,
> ON −1.5/−2%): lo stall dimezza ma il compute sale uguale (interferenza
> banda DRAM). Legge di scala: il win segue la quota stall (Jelly
> 27-30% → −34%; Xiaomi 19-21% → nullo/negativo; soglia morte ~20%).
> ⇒ K-F è una leva DA DISPATCHER (ON solo dove il probe misura stall%
> alto), non un default universale — ed è la fascia che ne ha più
> bisogno a riceverla. Bonus: prima telemetria lead-time sul campo
> (late 9% con gap 8-14ms = near-miss B; inflight mai oltre width = C
> esclusa qui; W4 conferma il ginocchio anche su secondo device).
> Report: reports/moe-kernel-kf-general.md** ·
> **SONDA S23 (2026-08-15 pomeriggio, esplorativa, 8 blocchi ABBA,
> kf-bin ad104222 pins dichiarati): NULL PULITO = terza conferma della
> legge di scala.** Stall S23 ~11% in config campagna → sotto soglia
> ~20% → wall identico (0.271 vs 0.271 s/tok) con stall dimezzato
> (11%→6%) e zero danni (p99 pari, energia 1.03, sag migliore). Legge
> a 3 device: Jelly 27-30%→−34% · Xiaomi 19-21%→nullo · S23 11%→nullo.
> La regola dispatcher (ON solo con stall%>~20 misurato) è VALIDATA.
> Anomalia archiviata: la sonda gira con compute 2.5× più lento del
> ship arm B (0.24 vs 0.095 s/tok; sospetta affinity thread Termux) —
> a velocità ship lo stall share risalirebbe ~25%: eventuale cella
> futura, non blocca. Dati: results/kf_probe_s23/.
> **CELLA CONFERMATIVA JELLY (prereg 3785392) COMPLETATA 24/24 la sera
> del 15/08: VERDETTO NEGATIVO ONESTO — W=1 p=0.000977 nella DIREZIONE
> OPPOSTA: a cache calda (giornata intera di inferenza) ON = +7.1%
> (0.2056 vs 0.1920), 11/12 coppie contro, p99 423 vs 345, stutter e
> J/tok peggio. Stesso device/binario/config della cella burst-cold
> del mattino che dava −20% ALL GATES YES ⇒ È IL REGIME A DECIDERE,
> non il device. E lo stall OFF stanotte era 21-29% (SOPRA soglia 20%)
> eppure ON ha perso ⇒ lo stall% DA SOLO non basta al dispatcher:
> serve il segnale cache-fredda (majflt-rate primi token /
> time-since-last-inference). Prodotto: K-F = ACCELERATORE COLD-START
> (TTFT 12-18 vs 21-22s, p99 −17% a freddo), auto-OFF a caldo.
> 3 interruzioni Android dichiarate, 12/12 coppie intatte, 0 escluse.
> Report: results/kf_ship_jelly/REPORT.md.** ·
> **SONDA COLD XIAOMI (sera 15/08, esplorativa, fadv-verificata,
> plugged): NULL PULITO CON MECCANISMO — sul flash veloce l'--overlap
> da solo assorbe già l'IO freddo (c01 OFF cold: 0.446 s/tok di
> letture flash → stall residuo 0.048 = 8.7%). Il prefetch funziona
> (precision 78%, late 2%) ma non ha nulla da nascondere. MAPPA K-F
> COMPLETA 3 device × 2 regimi: Jelly cold WIN −20% · Jelly warm LOSS
> +7% · S23 null · Xiaomi warm null · Xiaomi cold null ⇒ K-F =
> acceleratore cold-start SOLO per device a flash lento; altrove
> l'overlap è già tutta la storia. v1 sonda = garbage da flag
> --prompt-file inesistente (usage dump, check di validità debole):
> fix grok con DONE a 3 condizioni. results/kf_cold_xiaomi/.** ·
> POLICY DISPATCHER (formula finale): K-F ON ⟺ stall% misurato alto
> E cache fredda E niente allarme termico — CPU/RAM/modello sono già
> dentro lo stall% misurato; GPU fuori scope; batteria NON è un gate
> (inversione screen-on). ·
> **SONDA CALAQWEN-35B XIAOMI (notte 15/08, esplorativa): l'ipotesi
> "modello grosso → flagship sopra soglia" è SMENTITA — stall cold
> 6.0% (vs 8.7% di Marco: il 35B legge il doppio ma computa più a
> lungo per token, il rapporto resta assorbibile), KF ON −7%. K-F
> resta spento sul fast flash ANCHE col 35B. La mappa K-F è chiusa
> definitivamente. results/kf_calaqwen_xiaomi/.** ·
> **CARD SCREEN-ON XIAOMI RIFATTE (item Doze CHIUSO): CalaQwen 4.677
> vs card 4.75 (−1.5%) · Marco 11.78 vs 10.57 (+11%, vecchio punto
> n=1 dentro lo spread n=3). Nessun collasso Doze, protocollo
> originale ritrovato (xiaomi_t4_round) e replicato con fadv cold +
> wakefulness registrata. results/card_screenon_xiaomi_v2/.** ·
> KF_SHIP ⛔ (per spedire: eventuale cella COLD pre-registrata su
> Jelly con reset fadv tra coppie + policy scritta — decisione owner).
> Report sweep: reports/moe-kernel-kf-sweep.md.
> **CELLA BURST COMPLETA 12/12 (2026-08-15 mattina, blocchi 9-12 a
> telefono freddo 26-29°C = il burst-cold mancante) — TUTTI E 4 I GATE
> YES:** ENERGY ✅ 1.005 · THERMAL ✅ (sag ON 0.069 vs OFF 0.136 — nel
> burst ON degrada METÀ, temp_max identica 43/43) · MEMORY ✅
> (majflt/tok ON 9.2 vs OFF 13.5) · **ROBUST ✅ — p99 ON 467 vs OFF
> 565 ms (−17%), stutter DIMEZZATO (0.25% vs 0.50%), max 869 vs 1142.**
> Nel burst-cold puro (b9-b12): ON 0.205-0.212 vs OFF 0.258-0.262
> s/tok (−20%), TTFT ON 12-18s vs OFF 21-22s — a freddo il prefetch
> vince ANCHE il primo token. I vecchi ❌ TAIL/ROBUST erano artefatti
> del regime corto/tiepido: nel regime prodotto la coda la vince ON.
> Bilanciamento: 4+4 blocchi a caldo (39-43°C sera) + 2+2 a freddo
> (26-29°C mattina), ABBA, arm bilanciati su entrambe le condizioni.
> Nota onestà: b12 v1 ucciso dal phantom-killer Android (screen-off
> senza wake-lock, sshd morto, orfano congelato) → re-run pulito a
> freddo; lezione: SEMPRE termux-wake-lock prima di harness lunghi.
> Dati: results/kf_burst/device_final/, analisi ANALYSIS_FINAL.md.
> **STUTTER CARATTERIZZATI (analisi per-token): tutti e 3 = ingorgo IO
> alla RIPARTENZA del burst (io_ms 2.2-2.5s aggregati nei primi token
> del blocco, stall 350-400ms; worker 1-2ms e majflt ~0 innocenti) —
> causa E (warm-up non integrato) + C locale. Fix candidati: ramp-up
> issue nei primi ~10 token, o warm-start nel prefill.**
>
> **(storico, prima tassonomia — dopo cella REALITY):**
> KF_PROTO_WIN ✅ · KF_PHYSICS_WIN ✅ · KF_SPEED_WIN ✅ ·
> KF_IDENTITY_D0_WIN ✅ · **KF_ENERGY_WIN ✅ (J/tok 0.762 vs 0.770,
> ratio 0.99)** · **KF_THERMAL_WIN ✅ debole (sag 0.054 vs 0.095, ma
> mai oltre 30°C: blocchi morti a EOS ~200 tok — serve v2 sustained
> con --ignore-eos)** · **KF_MEMORY_WIN ❌ (majflt/tok 7.2 vs 0.93 —
> ma dominato dal primo blocco ON: b3=0.15/tok, steady-state ~parità;
> rimisurare in v2)** · **KF_ROBUST_WIN ❌ — LA CODA PERDE: p99 605 ms
> vs 442, worst 1352 vs 666, stutter 1.55% vs 0.45%. La media vince
> (p50 207 vs 313) ma il p99 regredisce: da ingegnerizzare (width 6→4,
> throttle di issue) prima di qualsiasi ROBUST claim** · KF_GENERAL_WIN
> ❓ · KF_SHIP_WIN ⏳. K-F FUORI dai default finché ROBUST + ship cell
> N≥10 non passano. Report: reports/moe-kernel-kf-reality.md.
> **DIAGNOSI CODA/COLD-START (direttiva gualt, 2026-08-14 sera):**
> cold-start = majflt primo blocco ON ⇒ prefetch tardi / pagine non
> residenti al compute / warm-up non integrato / issuing iniziale troppo
> aggressivo — impatta TTFT/avvio reale. Steady-state in parità ⇒ NON è
> cache pollution continua. Metriche richieste: majflt/tok primi-N vs
> post-warmup, majflt/blocco, TTFT, first-block latency, hit rate.
> Cause candidate della coda persa: (A) width troppo alta → sweep
> width 2/3/4/6 con Pareto p50×p99×stutter×J/tok; (B) prefetch late
> vs deadline → strumentare issue_time/completion_time/first_touch_time,
> lead_time=completion−first_touch; (C) over-issuing senza backpressure
> → admission control (gated su evidenza B/C); (D) pollution da
> prefetch sprecati; (E) primo blocco non scaldato → integrare il
> prefetch nel warm-up. Esecuzione: sweep width su Jelly (cella lunga
> anti-EOS) + strumentazione lead-time nell'engine in parallelo.**
> Paniere p-value = dispatcher/config (✅ QUALITY GATE PASSED: PPL
> k6d1.0 dMacro +0.0378 / worst fr +0.0877 → **5.151 t/s È config
> prodotto certificata Mellum2-S23**) + K-F (prototipo) + libreria.
>
> 🏠 **CASA DELL'ENGINE (direttiva gualt, pomeriggio): BigMoeOnEdge È
> FINITO.** `kalsa-engine/` in questo repo = l'engine nostro (tree fuso:
> libreria kernel + split residency + fix, llama.cpp vendored al pin
> locale e5605f3; compila, ctest 13/13) + `kalsa-engine/bundles/` = tutta
> la storia git (ogni branch BigMoeOnEdge + i kalsa/* di llama.cpp come
> delta). PUSHATO su Aspis0/kalsa-moe-experiments dopo riscrittura della
> storia non pushata (5 blob >100MB filtrati in un clone bare, 159
> commit, locale allineato). Cancellazione fisica del checkout
> BigMoeOnEdge: al landing di kf-prototype e F1b (lavorano nei suoi
> worktree), previo refresh bundle.
>
> 📱 **TTFT: PREWARM_UNIVERSAL confermato** (Xiaomi 4B 1.42/2.02 s, riuso
> 98.9%, fix P0 memguard mergiato su ai-chat main b274fb9). **P1
> idle-zombie: saga review completa** — fix v1 REJECT (il probe RSS era
> insano: mmap eviction ≠ morte, falso positivo = leak+OOM), fix v2
> on-contact (ping tokenize 8s, recoverLost scopato, harness 41/41) →
> re-review MERGE_WITH_FIXES(1) (soppressione busy troppo larga) →
> fix3 (always-ping, mark solo su turno utente) → **MERGIATO su ai-chat
> main 47be749: stack TTFT ship-grade** (prewarm + P0 + P1 + breadcrumb).
> Restano: checklist verify on-device (serve HyperOS libero) e UX F4.
>
> 🔮 **SELFSPEC: F1 implementata e corretta (same-k 1.000) ma alpha live
> 0.08 vs 0.70 teacher-forced; speedup 0.22×.** Parere Qwen Max (canale
> chat.qwen.ai, `docs/qwen-max-selfspec-opinion.md`): 45% corruzione
> stato/rollback ("prefisso fantasma"), 30-35% infedeltà verify batchato
> GDN, <10% "k2 debole"; ordine operativo = fixare 2 invarianti prima di
> tunare; bomba aritmetica: iterazione ~4.94 C6 → il verify batch deve
> essere SUBLINEARE (ammortamento flash) o γ=4 è morta a prescindere.
> **F1b ESEGUITA (2026-08-14 sera) — LANE_ALIVE, ENGINE_BUG:** E1
> draft==gold 0.833 (k2 SANO, ipotesi k2-debole morta) · E2 collasso a
> 0.353 con prefisso k6→predict k2 (k-mixing tossico: state-fork gratis
> morto per fisica) · E3 0.983 identico a γ=4 e γ=1 (batching innocente,
> MA ≠1.000 = invariante Qwen violata: impurità costante di runtime,
> verify==gold 0.937 dove doveva essere 1.000). Teacher-forced sano
> (0.83) vs live 0.08 ⇒ la corruzione vive nel ciclo
> accept/reject/rollback + k-switch (il "prefisso fantasma" di Qwen, 45%
> prior → quasi certezza). **G16 (gate restore, spec gualt) ESEGUITO:
> PASS ESATTO su transformer puri** (32/32 rejection forzate
> ripristinate bitwise; purity γ=1 48/48, residuo ~1e-7 = rumore fp,
> non scala-E3). Il ciclo rollback/k-switch è PULITO sull'attenzione
> standard ⇒ **l'indiziato si restringe allo stato ricorrente GDN che
> non si riavvolge col seq_rm** (i fixture tiny non sono ibridi; il
> collasso live era sul 35B ibrido — i due prior di Qwen convergono in
> un meccanismo solo). Commit 673febe. **🎯 RIPRODOTTO SUL 35B
> (ae63c5d): restore FAIL immediato sull'ibrido — |dlogit| 14-23, top8
> 0/99 — CON e SENZA rejection (anche il normale rewind-replay del
> catch-up avvelena!), mentre lo stesso binario è bitwise-esatto sui
> transformer puri. CAUSA: seq_rm riavvolge l'attenzione ma lo stato
> ricorrente GDN NO — ogni ciclo lascia fantasmi che si compongono =
> alpha 0.70→0.08. I due prior Qwen erano UN meccanismo. FIX
> (strutturale, non tentato): checkpoint R/S del draft ctx pre-burst +
> restore al rewind via llama_state_seq_* (API pubblica, third_party
> intatto) o macchinario n_rs_seq già riservato dal design F1. Poi
> re-misura alpha live (target 0.83), POI economia (bomba 4.94·C6 in
> piedi).** Report: reports/moe-selfspec-f1b.md (+addendum).
> (3) **PPL gate Mellum COMPLETO (2026-08-14 sera): k6d065 GATE_PASS con
> dMacro −0.0086 (MEGLIO dell'ancora k8; worst zh +0.0303) → il default
> campagna è quality-certified con margine. k6d1.0 PASS confermato
> (config velocità 5.151). k4d0 GATE_FAIL (dMacro +0.099, fr +0.166) —
> il k4 "coerente a vista" non regge: via di fuga chiusa.** PC libero →
> corsa F1b E1/E2/E3 LANCIATA (longfact, 2396c56).
> **(4) TTFT: PREWARM_UNIVERSAL — Xiaomi 4B post-fix P0: 1a 1.42/2.02 s,
> riuso 1174/1187 (98.9%), prewarm 29-31 s, 1b join 26 s; fix memguard
> mergiato su ai-chat main (b274fb9, harness 27/27); P1 zombie APERTO.** Bug app P0/P1 trovati sul Xiaomi (KNOWN_ISSUES ab3b747):
> fix autorizzato via "sbrigati TTFT" (in volo). Il resto resta congelato.
>
> 📐 **DECISIONI gualt (2026-08-14):**
> **(1) Target velocità:** i MoE grandi (Mellum2/Marco/CalaQwen) su
> S23-class si ACCETTANO a **5-6 tok/s** — l'ambizione 7-9 passa a
> flagship/fasce residenti; unica via di revisione = selfspec (F1b decide).
> Sui Qwen piccoli si spera ancora: 2B = 15.9 misurato su S23, residente
> su qualsiasi RAM.
> **(3) CRITERIO DI SUCCESSO DEL KERNEL (gualt): si spedisce un kernel
> che FUNZIONA e migliora IN GENERALE (non solo velocità: sustained,
> termica, batteria, TTFT) i modelli che spediamo, in modo SIGNIFICATIVO
> — "voglio quel p-value alla fine".** Endpoint pre-registrato: A/B
> appaiato (config stock vs kernel/dispatcher) per device×modello del
> listino, ABBA interleaved N≥10 rep/braccio, metriche primarie dichiarate
> PRIMA (wall mediano, sustained late-rep, J/token, °C, TTFT), test
> appaiato (Wilcoxon) + effect size + p-value nel report finale di ship.
> Dividendi già misurati che entrano nel paniere: dispatcher/config (+37%
> Mellum-S23 t2+d1.0; +158% Marco-Xiaomi t4; dottrina screen), K-E
> termico (screening in corso), K-G TTFT (gated), layer-ahead (gated).
> **(2) Dottrina fasce:** stesso SoC ≠ stessa fascia. La fascia è la
> matrice **compute-class × RAM misurata**: più RAM a pari silicio =
> residenza per i grandi (via il termine flash dal wall: Mellum 5.15 →
> tetto ~6.5-6.75; il 46% di miss di Marco evapora; CalaQwen ammissibile
> residente a 24 GB); meno RAM = hit% e ammissibilità giù. I piccoli
> clusterizzano solo per SoC. Ad assegnare la fascia è il **probe runtime
> del dispatcher al primo avvio** (compute + budget RAM + sustained), non
> la scheda tecnica. Test di falsificazione economico quando capita: S23
> Ultra (stesso 8Gen2, 12 GB) — Marco residente vs 8.82 streamato. (free-tier: si ferma alla scala misurata; celle card
> Xiaomi, FT lane, GPU: freeze — si riaprono solo su parola di gualt).
> Design S3 del coordinatore: `docs/kernel-s3-design.md` (3 meccanismi
> ranked: Phase-D cache-ostile prima del repack; repack-at-cache-insert
> solo gate/up; braccio build i8mm — la build S23 è armv8.2, i core
> supportano armv8.6+i8mm). Selfspec F1 in volo su `kalsa/selfspec-f1`
> (k switchabile draft2/verify6, KV rollback su verify, gate = output
> identico al k6 greedy, PC-first; cella S23 dopo che S3 libera il device).

| lane | stato | numero chiave | prossimo passo |
|---|---|---|---|
| **Lineup 3 telefoni** (CalaQwen + Marco1c shippati) | S23/Jelly done (screen-on); Xiaomi era in Doze → rifare celle card screen-on | Marco1c: S23 **8.82** (t4) · Xiaomi **10.57** (t4 screen-on, sorpasso) · Jelly 3.64 (t2, ranking) · CalaQwen: S23 5.86 · Xiaomi 4.75 | celle card Xiaomi screen-on |
| **TTFT app (Kalsa)** | ✅ **v2 MERGIATO su ai-chat main** | 53.4 s → **1.40 s** (Jelly, cold+90s+send) | QA app; engine-track Q6.c per chat lunghe |
| **Kernel CPU S2/S3** (micro-esperti) | S2 corretto ma PERF_NULL; **S3 Phase 0 (2026-08-14 06:05): S3_NO_HEADROOM al gate d'onestà — REPACK delta token-model −1.5%** (`moe-mellum2-kernel-s3.md`): lo stock NON repacka gli esperti streamati (`use_extra_bufts=false` per il rebind cache) quindi S2-vs-stock era vec_dot-vs-vec_dot; il kernel REPACK sul path ID a t2 PERDE (0.52×, row-split allineato a 8 con 2 thread); i ~10ms del fuso = cache/TLB bounce gate↔up + barrier + wait-all, non REPACK. **S3b i8mm DONE (2026-08-14 mattina): S3_CLOSED_ALL_ANGLES** (§Phase 0b nel report): HAVE_MATMUL_INT8 acceso con armv8.6, kernel `q4_K_8x8` VIVO e ripara il collasso 8x4 (ID t2 949→**389 µs**, ×1.27 sul floor host 495.5) MA token-model **+0.2%÷4.0%** — vale solo su gate/up Q4_K, il down Q8_0/Q5_0 non ne beneficia (Q8_0 ID t2 ancora 0.68×, Q5_0 senza traits). **Tre assi misurati, tre volte sotto il gate 10%: vec_dot/llamafile floor, REPACK 8x4 (perde), i8mm 8x8 (vince la cella, non il token). LANE KERNEL CPU CHIUSA — il floor t2 0.148 compute / 5.151 wall È il silicio.** Eredità: branch S1+S2+fix corretti e PR-abili upstream (matcher difensivo incluso); la velocità ora passa da selfspec | **5.151 t/s k6d10 t2** in attesa solo del PPL gate | lane chiusa; resta PPL |
| **Free-tier G99** | KEXP_REGRESSION + **REAP-50 MORTO** (10.68 resident ≈ 10.60 streamed: REAP dimezza gli stored, non gli active — stesso muro ~11 GB/s); 4B dense = fondo (3.52) | ladder finale: A0 k4 **10.6** / 2B 8.04 / 4B 3.52; target 15-20 irraggiungibile su G99 | gualt: (i) A0 10.6 o (iii) no-LFM — (ii) eliminata coi dati |
| **FT tool-call + IT** (Qwen3.5-2B primo) | tutti i gate chiusi: licenza YELLOW ok, ricette GREEN ×2, Registry **FROZEN** | dataset ~20-30k, 1 epoca, 24 GB bastano | GO spike gualt → PR-0 + PR-2 |
| **Mellum2 coding-SKU** | F0 STRONG 15/20; ceiling compute → dipende dal kernel | k6d1.0 = 4.64 t/s S23; con kernel ~7-9 | PPL gates drop/k (PC, dietro selfspec) |
| **GPU Adreno** | **decode** parcheggiato su A7X (0.41× sul 740, 0.44× sul 750, dispatch-bound) · **prefill RIAPERTO 16/08** | ⚠️ **CORRETTO: prefill GPU = 5.77× sul 750** (pp128 181.65 vs 31.46, `moe-gdn-750.md:201-206`, Qwen3.5-2B **denso**), non "1.29-1.7×" come diceva questa riga. Il 740 fa 2.2×. Leva TTFT sui DENSI (per il 35B resta la Q7-landmine) | riverifica anti-artefatto poi decisione TTFT |
| **Selfspec F0** | ✅ **PASS_LANE_OPEN (2026-08-14 00:50)** — run 3 completo | **alpha pooled 0.6991** (n=1037, gate ≥0.60; k2 draft / k6 verify, entrambi i bracci drop) | F1 prototipo on-device = engine-work (loop speculativo in BigMoeOnEdge); PC LIBERO → coda PPL gates Mellum |

## Scheda prodotto (default B 2026-08-18: KEXP + k=6 + **drop 1.0 + `--drop-no-renorm`**)

> 🔄 **CAMBIO DI DEFAULT — decisione gualt 2026-08-18. Lo 0.65 è RITIRATO.**
> Non è una preferenza: **`drop 0.65` è dominato**, costa qualità *e* tempo.
> Misurato su CalaQwen, sul modello e sulla config che spediamo:
>
> | config | qualità vs d=0.0 | velocità vs d=0.0 (Jelly) | byte |
> |---|---|---|---|
> | d=0.0 (nessun drop) | — | — | — |
> | ~~d=0.65 (vecchio default)~~ | +0.91% | **+5.8% più LENTO** | −27.3% |
> | ~~d=0.65 + no-renorm~~ | +0.20% | ~+5.8% più lento | −27.3% |
> | **d=1.0 + `--drop-no-renorm`** | **+1.18%** | **−12.9%** | **−71.8%** |
>
> `d=0.65` è più lento di non droppare affatto **in tutti e tre i round**
> (+10.9 / +5.2 / +1.2%): non ha mai comprato velocità. L'unico punto che la
> compra è d=1.0, e `--drop-no-renorm` ne taglia il costo di qualità del 70%
> (da +3.96% a +1.18%) **senza cambiare quali esperti cadono, né i byte letti,
> né la velocità** (misurato: +1.1% e −1.3% fra round confrontabili, segno che
> si inverte ⇒ equivalenti).
>
> **Contro l'ancora VERA di CalaQwen** (`k8 d0` = 0.6660114, misurata 17/08):
> il nuovo default sta a **+0.0201, cioè il 50% del budget** `MACRO_PASS=0.04`.
> Il vecchio 0.65 stava a +0.0182 (46%) — quasi pari — mentre **d=1.0 col
> default renorm stava a +0.0389, il 97% del budget: passava per 0.0011.**
> È il flag a rendere d=1.0 spedibile invece che al limite del bocciato.
>
> **Qualità delle risposte verificata, non dedotta** (`results/answer_quality_calaqwen`,
> `results/answer_sanity_calaqwen`): istruzioni con vincoli verificabili
> rispettate; funzione Python **8/8 test eseguiti**; prosa italiana senza
> collasso; **15/16** sulle domande di buon senso (l'unico errore è del
> RIFERIMENTO k=8, non della candidata).

| | valore | note |
|---|---|---|
| **modello** | **KEXP** `Qwen3.6-35B-A3B-KEXP.gguf` (sha `ac44e20c…`) | IQ2_M resta riferimento storico, non cancellato |
| **config di campagna** | `-t 4 -c 4096 --moe-stream --cache-mb 2000 --dense-weights anon --overlap --io-threads 4 --ubatch 512 --n-expert-used 6 --drop-cold-experts 1.0 --drop-no-renorm` | **DEFAULT B** (gualt 2026-08-18). Sostituisce l'A del 10/08 (`drop 0.65`), ritirato perché dominato |
| ⚠️ **numeri device da rimisurare** | il cambio di default **invalida le tok/s assolute** delle celle S23/Xiaomi, misurate a `drop 0.65` | il segno è noto (−12.9% sul Jelly, byte −71.8%), gli assoluti per device no. **Non citare le vecchie tok/s per la config nuova** |
| **binario** | CAMPAIGN `1ca51420…` = prefault tri-stato + dense2 + fix KV + scorer + drop runtime | pin sha-verificato, `bin_sha256` in `runs.csv` |
| **load cold** | **~10 s** (KEXP ~12.5 GiB; storico IQ2_M 9.37 GiB) | E1 chiuso su IQ2_M; KEXP size-bound |
| **prefill per turno** | **~8-11 s COSTANTI** su 5 turni (T5: 9.34 s, n_common 1387) | prima del fix KV: 165 s al T5. Il TTFT non degrada più |
| **decode** | ⚠️ **da rimisurare col default B.** Storico a `drop 0.65`: med 5.86 tok/s (k6d065 n=200 staccato), ctrl k8d065 5.16, legacy IQ2 drop0.50 ~4.4 | griglia `moe-adopt-kexp.md` parte 3. **Quelle cifre sono del vecchio default e NON valgono per B** |
| traffico | **default B (Jelly, 12/12): read 2654.9 MiB / 200 tok, hit 84.8%** — contro 9410.3 MiB / 75.5% a d=0.0 e 6842.4 / 78.8% al vecchio 0.65 | `results/dropsweep_calaqwen_jelly`; byte identici alla cifra fra round ⇒ contabilità deterministica |
| hit esperti (decode) | **84.8% col default B** (75-83% sulle celle storiche a 0.65) | cache 2000 |
| energia | 1.0-1.4 J/token, ~40k token per carica | F4.7 (pre-KEXP, da rinfrescare se serve) |
| **qualità** | PPL decode **1.852** (k6d065); floor prodotto storico IQ2_M **2.0955** | ⚠ metro campagna ancora su corpus Dante (`corpus_subset_10k`); confronti interni OK. Corpus v2 + re-ancoraggio floor = decision gualt |
| **collo di bottiglia** | **il CALCOLO** (I/O esposto = 20% del decode; freq a regime 41% del picco) | F4.9, F5.2, F5.3-A3. Drop = solo I/O (saturo); k&lt;6 morto su KEXP |

## I 3 capitoli che contavano: TUTTI CHIUSI

1. ✅ **Prefill incrementale** (fork `2c675a5`): history grezza + `preserve_thinking=true`.
   T5 165→9.3 s (−94%). Vincolo permanente: memoria ibrida attention+SSM → niente rollback
   parziale KV (edit/regenerate = ri-prefill completo). Report: `moe-kv-reuse-fix.md`.
2. ✅ **Loader E1**: prefault tri-stato (−51%) + dense2 (memcpy+drop mmap) = 21.05→9.37 GiB.
   Residuo chiuso per esperimento (mincore: il reclaim avviene DURANTE il warm-up).
   Report: `moe-dense2.md`, `moe-adopt-dense2.md`.
3. ✅ **Metro PPL sul decode-path** (`--ppl-decode`, fork `d408e03`, Δ=0 esatto vs prefill
   a ubatch=1) **+ prima leva lossy ADOTTATA**: `--drop-cold-experts 0.50` — poi k6d065
   come default prodotto. Report: `moe-dropcold.md`, `moe-adopt-kexp.md`.

## Chiuso di fresco (2026-08-11/12)

| ramo | verdetto | report |
|---|---|---|
| **LiteRT fail-fast S23 (porta-740)** | **F0/F1 PASS su Gemma E2B** (GPU ~26.8 vs CPU size-matched 9.7, ~2.76×, unplugged) **ma FAIL su Qwen 1.5B** (GPU ~18.7 vs CPU 25.8, 0.73×): il win GPU è **size/stack-dependent**, non universale. Kernel-spike nel fork: solo se ROI prodotto; NON riaprire OpenCL llama vanilla (K2/K5 restano validi) | `moe-litert-f0-f1.md`, `moe-litert-qwen.md` |
| **LiteRT twin classi prodotto 2B/4B (S23, unplugged)** | **GPU non misurabile via Gallery**: 2B BLOCKED (nessun bundle ufficiale ~2B, famiglia Qwen litert = 0.5/0.6/1.5/4B; import non ufficiale rigettato), 4B **NO GPU OPTION** (`qwen3_4b_mixed_int4.litertlm` offre solo CPU; Gallery CPU 5.3-5.7 vs llama-bench 8.38 — llama.cpp CPU vince pure). **Twin CPU misurati**: Qwen3.5-2B Q4 tg256 **18.10**, 4B **8.38**. Curva CPU: 1.5B 25.8 → 2B 18.1 → 3B 9.7 → 4B 8.38 | `moe-litert-product-classes.md` |
| **shortlist velocità C (k=5)** | **DONE_NO_VIVE** — k5d065 PPL 2.456, k5d000 2.307, entrambe > floor 2.0955; speed skip | `moe-shortlist-velocita.md` |
| shortlist A (drop-by-weight) / B (top-p) | **archiviate per meccanismo** (drop non salta matmul; B senza route rows utili) | mandate `shortlist-velocita.md` |
| **italiano Marco prosa moderna** | **MISURATO** (Wikipedia Caffè v2): Marco bpb 0.750 &lt; Qwen 0.769; T2c **PASS** 5/5 | `moe-trial-marco-it-v2.md`, `quality_gates.json` |
| knee drop-cold IQ2 k=8 | **eseguito** (0.65 candidato, 0.80 archived PPL) — pre-KEXP; non riaprire come leva k6 senza fatto nuovo | `moe-knee-dropcold.md` |
| GPU OpenCL Adreno / ik kernels | **chiusi** (ricerca + spike) | `research-adreno-opencl.md`, spike S1 |

## Deciso e CHIUSO (non riaprire senza un fatto nuovo)

| ramo | verdetto | perché |
|---|---|---|
| politiche di cache | **vuoto** | nessuna batte LRU sul carico vero; Belady−LRU = 6.37 pt |
| **taglia cache** | **2000, ottimo misurato** | incorniciata: 1500 −15%, 3000/3500 −62/−68% (thrash → RescueParty) |
| **ubatch** | **512** | 2048: prefill −15.5% E buffer 4× |
| prefetch cross-layer | **morto** | Recall@8 19.2%, extra-fetch 274%; predittore 87-91% varrebbe +3.1% |
| MTP / speculazione | **morto, con letteratura** | 0.00% ammortizzo byte; 3 meccanismi indipendenti. Riapertura solo NPU/GPU verify + acceptance ≥60% |
| **k ridotto (lossy) su KEXP** | **morto (confermato)** | k5d000 +0.45 vs k6d065, sotto floor; k5d065 peggio. Decode CPU: k=6 è il pavimento qualità |
| drop-cold estremi | **morti come leva compute** | drop = solo I/O (remap top expert); I/O già saturo d065→d080 +0.15% speed |
| ri-quantizzazione 1c esperti | **pareggia** | guadagno calcolo ≈ penale byte |
| kernel IQ2 a mano | **rinviato / NO-GO su 8 Gen 2** | ik g_IQ2 0.719 &lt; 1.20 |

## Aperto, e cosa serve per chiuderlo

| domanda | stato | chi sblocca |
|---|---|---|
| **✅ Marco FASE 1: CHIUSA, PASS PIENO** (`results/marco_phase1/VERDICT.md`) | **Qualità full multi5 3/3 PASS**: A1 k8d065 ΔMacro **+0.0040** (drop quasi gratis a k=8); A3 k6d050 **+0.0095**; A2 k6d065 **+0.0182** (peggiore ma in gate; peggior lingua zh +0.033 vs soglia +0.10). **Speed S23 PASS su entrambe le leve**: A2 1.303× decode, −34.4% MiB/tok, hit +3.2pt. **Per PROTOCOL: transfer runtime SUFFICIENTE** → k/drop di campagna adottabili su Marco senza requant. **CONFERMA CROSS-SILICIO (Jelly Mali/G99, Grok#2 gualt, 2026-08-12 notte): A2 1.17× decode, MiB/tok −35.6%, hit +4.3pt — la riduzione byte è IDENTICA all'S23 (−34.4%), il moltiplicatore velocità scala col silicio (1.30× Adreno / 1.17× Mali).** Scelta cella prodotto (gualt): **A2** = speed misurata + qualità peggiore-ma-in-gate; **A3** = metà del costo qualità ma speed device non misurata; A1 = qualità ~gratis, leva solo-I/O. **Fase 2 MarcoKEXP resta l'upgrade di REGIME I/O** (KEXP stesso device: 30.7 MiB/tok e hit 80.7% vs 126.2/36.7 di Marco A2 → batteria e sostenuto) — GO gualt separato. Report di fase in scrittura | gualt: scelta cella + decisione Fase 2 |
| **✅ MarcoKEXP (FASE 2): QUALITÀ PASS + SPEED 1.62× — decisione ship matura** | Qualità (Grok#2): 1c e cons PASS full; la tassa è il requant (~+0.03 bpb it/en), il drop aggiunge ~+0.01. **Speed S23 (ABBA same-session): Marco-1c 8.819 tok/s vs Marco-Q4 5.442 = 1.62×; MiB/tok 126→51.5 (−59%, bar ≤60 PASS); hit 36.7→53.5 (+16.8pt, sotto il +20)**. Non è ancora regime KEXP-35B (31/81) ma **Marco-1c è ora il modello grande più VELOCE del listino** (8.8 vs 5.7 di CalaQwen). **🚢 SHIPPATO (gualt 2026-08-13): lineup grandi = CalaQwen + Marco1c.** Originale Q4KM + cons + sorgente Q8 CANCELLATI (PC −35 GB; device cleanup in corso). Scheda listino 3-telefoni: celle Jelly-Marco1c misurate (Grok#2); **Xiaomi-Marco1c DONE (2026-08-13 notte, staccato 72→68%): t6 med 4.101 t/s / 51.5 MiB/tok / hit 53.5%** — regime I/O IDENTICO a S23/Jelly alla cifra (51.5/53.5); sustained hot 6.84 (nessun collasso stile CalaQwen: il cold paga il DONTNEED, non c'è throttle — temp 33-35°C). **MA t4 = 8.577 t/s (2.1×, compute 0.048 vs 0.116 s/tok): la card rule "cpu_capacity≥50% → t6" STRANGOLA SM8650 su Marco1c** (CalaQwen invece è thread-flat — è un effetto per-modello, Marco è compute-heavy, CalaQwen flash-bound). Round chiuso: **Marco1c t4 screen-ON = 10.574 t/s, sopra l'S23 (8.82)** — il flagship sorpassa il 2023 appena config e schermo sono giusti; ginocchio t4>t5(9.25)>t6 | rebase card t4/screen-on: gualt |
| **⚠⚠ SCHEDA FLAGSHIP CalaQwen (Xiaomi 14): regime IDENTICO, decode DIMEZZATO** (`moe-calaqwen-xiaomi.md`, retry con extm OFF + pin campagna linkato) | **t6 med 2.55 tok/s / 30.4 MiB/tok / hit 80.75%** vs S23 5.86/30.7/80.7. Due fatti enormi: (1) **il regime streaming è INDIPENDENTE dal silicio** (30.4/80.7 ≈ identici) — la macchina KEXP trasferisce perfettamente; (2) **il decode del flagship 2024 è LA METÀ del 2023**: prima cella fredda 4.02 poi crollo a 2.3-2.7 = throttle/scheduler HyperOS sostenuto (majflt ~0: lo swap è morto, confermato — era la Memory Extension). Lezioni prodotto: perf NON prevedibile dalla gen del silicio; serve probe runtime (RAM E sustained-perf). **PERF-MODE HYPEROS: NULL su CalaQwen (2026-08-13 notte)** — speed_mode+screen_game_mode+gb_boosting: med 2.475 vs 2.55 = 0.97× (su Marco1c invece 1.52×, 4.11→6.25 — side observation). **ROUND t4+SCREEN CHIUSO (2026-08-13 notte, §"t4 + screen round" nel report, `results/xiaomi_t4_round/`): VERDETTO SCREEN — il "flagship dimezzato" era un artefatto Doze.** 2×2 fact: CalaQwen t6 screen-ON med **4.750** (vs 2.55 campagna screen-off, +86%), t4 screen-ON 4.580 (~flat vs t6, anche in campagna era flat), t4 sustained REGGE 4.392 (zero collasso; flash I/O stabile ~0.20 s/tok vs il 0.22→0.50 del Doze). Il numero prodotto vero del Xiaomi 14 su CalaQwen è **~4.75, NON 2.55** — sopra il floor S23 non sotto la metà. Su Marco1c invece le leve sono DUE: thread (t6 4.11 → t4 8.58 screen-off, CalaQwen non ne risente) + screen (+23% a t4 → **10.574**, compute 0.041, flash 425 MiB/s = sopra l'S23 8.82, primo sorpasso flagship). Ginocchio t4 > t5 (9.25) > t6. Lezione doppia: (1) mWakefulness in colonna runs.csv d'ora in poi, (2) probe runtime per-SoC su thread. **Question chiusa (gualt 2026-08-13): S23 e Jelly erano SCREEN-ON in campagna** → i listini S23/Jelly sono già in condizione prodotto, nessun rebase; era solo lo Xiaomi in Doze. Confronto apples-to-apples finale: Marco1c Xiaomi 10.57 vs S23 8.82 (1.20×, sorpasso vero); CalaQwen Xiaomi 4.75 vs S23 5.86 = ancora 0.81× (residuo flash-bound da capire, ma non più "dimezzato") | celle card Xiaomi da rifare screen-on (t6 CQ + t4 M1c come product cells) |
| **Free tier G99 a 15-20 tok/s — pista LFM2.5-8B-A1B: ✅ VIVA, misurata** (`moe-g99-freetier.md`) | Jelly staccato `-t 2` n=200: dense 2B **8.04** (come da fisica); **LFM2.5 k=4 10.60, k=3 12.28, k=2 14.38** (−4% dal target). `lfm2moe` supportato dal fork, `--n-expert-used` funziona; RAM ok (RSS ~5 GiB, no thrash). BW effettiva solo 10.8 GB/s su 15-17 → i tagli byte pagano ~lineari. **PROIEZIONE KEXP-experts (2-3 bit): 14.7/16.3/18.3 a k=4/3/2 → target 15-20 raggiungibile.** Pipeline PC: **A0 k4/3/2 DONE, KEXP quantizzato e VERIFICATO** (falso-FAIL del verify riparato — era enum-vs-int; ricetta rispettata al tensore: 44×q2_k gate/up, 22×q3_k down), **PPL KEXP DONE (2026-08-13 sera): tassa KEXP macro +5.7% a k4 (BPB 1.29 vs 1.22) e +5.6% a k3 (1.33 vs 1.26) — MA la tassa NON è uniforme sulle lingue: IT paga +26% PPL già a k4 (29.2→36.8) e +41% a k3 (41.2); k2 COLLASSA in entrambi i bracci (A0 macro 1.48, en 48.0; KEXP en 55.2) → celle restanti k2 ABORTITE per decisione gualt (inutili, PC liberato per selfspec; `KEXP-k2/ABORTED.txt`). DECISIONE: k4 (gualt 2026-08-13)** — k3 solo se l'A/B speed Jelly compra ≥25% E lo smoke IT regge. **RE-TEST JELLY DONE (sera): KEXP_REGRESSION + K4_FINAL — proiezione 14.7/16.3 RIFUTATA** (§KEXP re-test in `moe-g99-freetier.md`): KEXP k4 **8.83** t/s (vs A0 10.60 G99 / 9.76 stessa sessione), k3 10.27 (1.16× — non riapre). Il meccanismo previsto È successo (majflt/tok ~0, file 100% residente in page cache, load 3.9 s vs 7.9, prefill fino a 13.6 vs 8.3 = KEXP paga TTFT/load) MA il decode è **dequant-bound Q2_K/Q3_K sui 2×A76**: cpu-s/tok 0.224 vs 0.198, banda implicita 6.8 GB/s « roofline 10.8 — la proiezione assumeva il roofline Q4, che coi sub-4bit su core deboli non vale. **Lezione: su silicio debole, meno byte ≠ più decode se il dequant costa.** Target 15-20 su G99 NON raggiunto; opzioni gualt: (i) accettare A0 Q4 k4 = 10.6 come cella free-tier Jelly, (ii) candidato REAP-50, (iii) niente LFM su G99-class. **(ii) MORTA COI DATI (2026-08-14 notte, §REAP-50 in report + `results/reap50_jelly/`): pipeline completa in una notte (fetch HF 9.18 GB → primo convert safetensors→GGUF della famiglia → Q4_K_M 2.82 GB → cella Jelly) e verdetto REAP50_LOSES: k4 resident = 10.68 vs A0 streamed 10.60 (+0.8%), k3 12.20, k2 14.23 — curva IDENTICA. Residenza PROVATA (majflt 0.00/tok, 100% page cache, hot=cold) ma il decode non se ne accorge: REAP dimezza gli esperti STORED, non gli ACTIVE — stessi ~1033 MiB attivi/token, stesso muro ~11 GB/s. Il file -42% compra prefill 15.9 vs 10.0, TTFT 8.2/5.7 vs 13.3 s, load 3.36/0.90 s e headroom RAM, NON token/s. Bonus recon: la tag Apache-2.0 del repo konic è SBAGLIATA (parent LFM v1.0, i derivati ereditano); smoke qualità già debolino (tassa prune visibile). La decisione si semplifica: (i) A0 10.6 vs (iii) no-LFM-G99** — nota: REAP-50 come sostituto di A0 a pari decode per TTFT/RAM esisterebbe solo passando un quality gate che lo smoke rende improbabile. **Sfidante Ling 3.0 Tiny: NOT_BETTER** (`research-ling3tiny.md`) — arch `bailingmoe3` non mergiata (PR #26608), think-on 51k tok/task, no IT/ES/FR, proiezione Jelly ~14-16 = stessa banda; watchlist post-merge + smoke think-off, non un secondo SKU | gualt: decisione free-tier (i) 10.6 / (ii) REAP-50 / (iii) no-LFM-G99; se (ii): quality gate REAP |
| **🎯 LANE FT tool-call+IT (idea gualt 2026-08-13 sera; PIVOT gualt post-licenza): PRIMO target Qwen3.5-2B (in-app, Apache 2.0 = zero condizioni sui derivati, ed è dove vive il dolore system-prompt/tool); LFM2.5-8B-A1B SECONDO, solo se il free-tier sopravvive alla decisione (i/ii/iii). Decisione licenze (gualt): UN SOLO LFM in lineup (8B free-tier), 2.6B **NOT_ADOPTED CONFERMATO (recon DONE, `research-lfm25-26b.md`)** — nessuno shock, anzi: (1) prefill vs Qwen3.5-2B NOT_PUBLISHED e l'unico dato ARM indipendente (RK3588, SoC PIÙ forte del G99) fa ~30 tok/s prefill ≈ i nostri 28 — l'ipotesi prefill è morta sui dati; il 2-3× del marketing è vs Qwen3-4B su S25, e il predecessore 2.6B vs Qwen3-1.7B è pari in prefill e PERDE in decode; (2) **always-think non disattivabile** (il `<think>` è nel template) = tassa TTFT per risposta su telefono ~30 tok/s — killer per lo slot chat; (3) stessi problemi conv-state cache/seq_rm di llama.cpp (#16491 #19041) = stessa classe del nostro C3. Sotto-prodotti utili del recon: lista moduli Unsloth confermata per la famiglia; llama.rn 0.13.0-rc.0 (llama.cpp recente) esiste per l'upgrade engine app; IFStruct 85.5 vs 33.15 di Qwen2B (stessa leaderboard) = il tool-following LFM è vero, ma il FT nostro su Qwen copre il bisogno senza condizioni di licenza. La pipeline dati (Registry, inventario variabile, negativi) è model-agnostica: costruita una volta, applicata a Qwen subito, a LFM poi** | Doppio razionale misurato: (1) il prompt system/tool dell'app è ~1.4k token (TTFT verify: 47 s di prefill su G99) — un modello che conosce i tool Kalsa NATIVAMENTE (device_info, calc, calendar, web-search, notes) taglia il prefisso a poche centinaia di token = win TTFT strutturale su ogni telefono, cumulativo col prewarm V2-2; (2) recupero qualità IT contro la tassa KEXP (+26% PPL it a k4). **Recon EPFL DONE (`research-epfl-lfm25.md`): i "37" = PersonaPO, griglia personality Big-Five di UN team studenti CS-552, da BASE, solo EN, zero eval, zero tool-use → NESSUN candidato utile (NOISE/RESEARCH_ONLY), non toccare quei pesi.** MA due regali dall'albero HF: (1) **LLM-OS-Models Terminal-ToolBench full-SFT sul modello REASONING per tool-call JSON con tabella metrica vera (TB2-lite 52.30)** = proof-of-concept che l'SFT tool-call su LFM2.5 reasoning FUNZIONA; (2) TRL/PEFT girano sull'arch (LoRA r=16 attn-only degli studenti = ricetta da NON copiare per tool-call, ma la toolchain è provata); bonus watchlist: konic-labs REAP-50 (prune 5B, interesse RAM), noctrex MXFP4_MOE. Nessun FT IT/FR esiste sull'albero → se vogliamo l'IT migliore, il tune lo facciamo NOI. GATES in ordine: (a) licenza LFM: **YELLOW(conditions) = verde operativo con paperwork (§6 `research-epfl-lfm25.md`)** — derivati+requant permessi (requant = Object form, stessa disciplina), NO copyleft, NO AUP contenuti; condizioni VINCOLANTI: (1) revenue <$10M INCLUSI affiliati (§1 Legal Entity aggregation; sopra = §11 terminazione AUTOMATICA anche dei device già shippati → comprare da sales@liquid.ai PRIMA del cliff), (2) testo licenza lfm1.0 dentro l'app per ogni utente (§4a), (3) notice "derivato modificato di Liquid AI LFM2.5" + notices su tokenizer/config (§4b-c), (4) MAI brandizzare LFM/Liquid come nome prodotto (§7; "based on Liquid AI LFM2.5" ok), (5) MAI rilicenziare i pesi Apache/MIT (la prassi community OTel/Tini è ILLEGALE, non copiarla); (b) ricetta: **GREEN (§7)** — skeleton: base REASONING (mai Base/PersonaPO), template+tool-token NATIVI (`<|tool_call_start|>[name(arg=...)]`, NON il JSON Terminal che fa solo 77% valid), LoRA r16 α32 lr2e-4 su `q/k/v/out_proj + in_proj + w1/w2/w3` (out_proj NON o_proj — il typo è nel cookbook Liquid stesso!), esperti = nn.Parameter → servono `target_parameters` PEFT (LoRA attn-only non li tocca MAI), router MAI, train-on-response-only, **1 epoca e stop** (Terminal 2-ep regredisce), mix ~50/50 IT-chat-replay : tool-traces (anti-forgetting), `<think>` preservato (forzato IT su subset), RLVR solo dopo e solo se serve (+1.7 misurato); proof: ToolBench full-SFT 36.5→52.3 su reasoning model, (c0) **Tool Registry v1 DRAFT PRONTO** (`docs/tool-registry-v1.md`, 564 righe, contract `kalsa.tools.v1`; task report con 4 domande aperte per gualt): **15 tool** = 6 shipped (dall'app REALE: device_info, device_calc, calendar_agenda, web_search, web_fetch, document_chat — memory extract e notes oggi NON sono tool) + 9 roadmap (notes r/w, memory save/forget/recall, reminder create/list/cancel, deep_research); regole chiave: train-bytes==infer-bytes (prefisso congelato nel JSON spec), renderer per famiglia (qwen35 compact lines / lfm List-of-tools nativo / other=Gemma legacy), scritture persistenti = user-confirm, additive-only, stock Qwen INTOCCATO fino al flip atomico coi pesi FT. **Review ostile DeepSeek DONE: APPROVE_WITH_FIXES(6)** — 35 claim verificati sul codice (tutti i behavioral OK), MA 6 CONFIRMED da chiudere prima del freeze: F1 template ES/FR non specificato vs mix 25% ES+FR (due letture → byte diversi), F2 document_chat nothing-matched distinguibile solo sniffando stringa localizzata (vietato dal dispatch — serve discriminatore strutturale), F3 not_available vs permission_denied contraddittori + membership inventario con memory OFF indefinita, F4 ordine inventario mai pinnato (3 ordini diversi nel doc!), F5 inventoryHash indefinito + toolProtocol fuori dall'env-hash (= riuso KV stantio nel flip debug), F6 i 4 messaggi skip/dedup/failed-repeat (LlamaService.ts:294-302) model-visible ma non congelati. **CICLO REVIEW CHIUSO: FREEZE_OK (3 giri)** — fix r2 (F1-F18) → re-review FREEZE_BLOCKED(2) (B1 byte serviti ≠ costanti congelate: wrapper localizzato+use-rule; B2 provenance memory/notes senza meccanismo runtime) → fix r3 (tabella 8 righe caso×locale byte-esatta verificata riga per riga sul codice; `spec.provenance` con firma, in PR-3, stringhe verbatim) → **gate finale FREEZE_OK**: contratto `kalsa.tools.v1` CONGELATO, 2 micro-note in PR-0/PR-3. Otto+ bug train≠infer uccisi prima di entrare nei pesi. Domande aperte gualt — **NB (chiarito 2026-08-13): gatano i PR APP (executor roadmap), NON il training** (il modello vede solo inventario/chiamata/envelope; il dataset non dipende da queste): (1) reminder→oggetto OS, (2) skip extractMemory post memory_save + stop clearCache (=fix TTFT), (3) cap mensile deep_research (costante app). La (4) ES/FR chiusa dal freeze. **RICETTA QWEN3.5 DONE (`research-qwen35-ft-recipe.md`): RECIPE_YELLOW = via libera con 7 vincoli nello script.** Scoperte chiave: (1) il 2B è classe VLM (`Qwen3_5ForConditionalGeneration`, vision tower da FREEZARE); (2) il path nativo `tools=` di 3.5 è XML qwen3_coder, NON Hermes → **mai passare `tools=`** (conferma KD4 del registry: inventario compatto nel prefisso + gold Hermes JSON coi token riservati 248058/9); (3) trappole nomi mappate: `in_proj_qkvz/ba` sono nomi Next CANCELLATI su 3.5 (skip silenzioso), e coesistono `o_proj` (attn) E `out_proj` (GDN) — una lista con uno solo è mezzo-skip; `A_log`/`dt_bias` nn.Parameter irraggiungibili; (4) `convert_lora_to_gguf.py` ROTTO su adapter GDN (llama.cpp #21125) → merge-then-convert obbligatorio + tokenizer dal base; (5) packing OFF (DeltaNet non gestisce i boundary); bf16, NO QLoRA (sconsigliato da Unsloth su tutta la 3.5); (6) VRAM: **una 24 GB basta** (2B LoRA bf16, 5 GB @2k misurati). Skeleton bancato: r16 α32 lr 1e-4 (SWIFT official-adjacent), 1 epoca, response-only, target attn+MLP+5 GDN Linears (o all-linear+freeze vision), think 20% open / 80% empty+ignore_empty_think. **TUTTI I GATE FT CHIUSI (a licenza, b ricetta ×2 famiglie, c0 registry FROZEN)** → GO spike = parola di gualt; critical path reale: PR-0 (JSON freeze) + PR-2 (dump prefisso, app-side, gata PR-4 generatori) → dati → SFT su 24 GB; il tune insegna il FORMATO con inventario variabile per-esempio (chiama SOLO ciò che è nell'inventario runtime) + esempi NEGATIVI (tool noto ma assente → non chiamarlo, capacità non disponibile) — così feature nuove = riga in inventario, zero re-tune, e niente allucinazioni di tool assenti; (c) piano dati: traces tool-call sintetiche sul Registry + chat IT, (d) spike training + eval (multi5 PPL + harness acceptance tool-call, incl. test negativi), (e) KEXP requant sopra i pesi tunati (pipeline esistente). Nessun GO compute finché (a)+(b) non sono verdi | recon EPFL → follow-up ricetta; gualt: lista roadmap tool per Registry v1 + GO spike dopo gates a/b |
| **💪 Mellum2 coding-SKU ("pro a pagamento"): F0 PASS — STRONG 15/20** (`moe-mellum2-f0.md`) | fromdoc 5/5, review 3/3, bugfix 6/8, refactor 1/4 (debole); EN code-explain 7/7, **IT usabile** (il "en only" di HF era pessimista); PC idle 24.2 tok/s. Rischio prodotto: diff no-op dall'aspetto valido → il client deve verificare che il patch cambi codice. Appendice Metal pronta per M1 Max. **F1b S23: STREAMS_OK ma regime PESANTE — 2.944 t/s / 185.0 MiB/tok / hit 76.0%** (2 rep staccato, riga ricetta `mellum` su branch `kalsa/mellum-recipe` @ d987027, build `bmoe-cli-mellum` sha 69a35f5e, pin campagna intoccato; no shared expert, router ffn_gate_inp). La proiezione carta (92 MiB/tok) era SBAGLIATA: attivi pieni ~780 MiB/tok × 24% miss = 185 misurati. **Compute ceiling ~4.5 t/s SOSPETTO** (Marco1c computa ~3B attivi a 8.8 all-in → indiziati: build fresca con REPACK default −33%, cpuset nproc=6). **F1c griglia k (2 rep, staccato): k8 2.94 / k6 3.76 / k4 4.72 / k2 5.68 t/s** (1.93× a k=2, mai compute-bound puro; MiB/tok 185→55.5 ma hit crolla a 68.5 a k=2); **drop 0.65 a k=2: taglia I/O (→47.9) ma PERDE tok/s** (compute 0.119→0.133). Qualità k tagliato NON gatata (k=2 garbage a vista, k=4/6 coerenti). Banda KEXP+k col ceiling attuale: 3.5-8.4. **F1d VERDETTO: CEILING_REAL(mul_mat_id)** — rebuild flag-campagna identico a F1b (2.90 vs 2.94, compute 0.228 vs 0.224: i8mm/REPACK innocenti QUI); **dense 2B sullo stesso binario = 15.9 t/s** (build sana); pin sui big peggiora (oversub); forense 1 Hz: 73.9% dei tick sui LITTLE (WALT classifica i 64 micro-mul_mat_id come lavoro little) ma forzare i big non alza il tetto. **È la geometria: 64 micro-esperti (3×2304×896) ≠ GEMV denso da 2.5B** (Marco1c 8.8 = esperti più grossi e meno numerosi). Banda finale KEXP k=8: **3.5-4.4** (l'85% hit sbatte sul muro compute). **F1e (zona viva trovata): k=6 drop 1.0 = 4.638 t/s (+23.4%), PRIMA cella Mellum COMPUTE-BOUND** (flash 0.115 < compute 0.175, hit 87.6%, MiB/tok 39.2, drop 12.1% routing); k=8 d0.75 +13.7%; d0.75 a k=6 debole (coda sottile 4.5%); **io-two-wave NULL → flag chiuso**. Qualità drop NON gatata (PPL richiesta). **CONVERGENZA COL KERNEL: essendo compute-bound, se K0 conferma ≥50% recuperabile, k6d1.0+KEXP+kernel proietta ~7-9 t/s su S23** (senza kernel: KEXP ~5.2-5.7). SKU: S23-class = tier streaming; target primario iPhone Pro / flagship 12-16GB residente (M1 Max = proxy banco, non target) | K0 spike in corso su S23; gate PPL drop/k dietro selfspec |
| corpus PPL v2 di campagna (sostituire Dante sul metro floor) | in valutazione; ri-ancorare floor ≈ 3 run PPL PC (KEXP F=0, k6d065, IQ2 hist) | gualt design + PC |
| **Integrazione prodotto Kalsa** (llama.rn ↔ BigMoeOnEdge) | design doc esiste; non ricerca | gualt GO Fase 1 |
| energia J/token col drop k6d065 | opzionale F4.7-style | telefono staccato |
| **🔨 CANTIERE GDN-GPU (DECISIONE gualt 2026-08-12; ruoli: Claude design, Grok codice)** | **K0 DONE, RIBALTONE** (`moe-gdn-k0-op-inventory.md`): **i kernel GDN esistono GIÀ nel nostro pin** — upstream ha aggiunto `GATED_DELTA_NET` + `SSM_CONV` OpenCL (8ad8aef44) E i kernel MoE Adreno `MUL_MAT_ID` Q4_K/Q5_K/Q6_K. Il claim K2 del 3/8 ("ops mancanti") è STALE. Verificato dai GGUF (2026-08-12): **S_v=128 su 2B/4B/35B → dentro il gate GPU {16,32,64,128}**; dk=256 → flash-attn OK. Gap residui VERI: G4 GET_ROWS embedding quantizzato → CPU (piccolo); **Q7-LANDMINE: l'expert-ready hook dello streaming è SOLO nel loop CPU di mul_mat_id** → per il 35B gli esperti DEVONO restare su CPU (o engine da rifare); per i dense 2B/4B nessun MoE → grafo interamente GPU-abile OGGI. **K2.1 DIAGNOSI CONFIRMED → K2.2 FIX IN VOLO**. K2 (`moe-gdn-k2-e2e.md`): S23/740 FAIL_CORRECTNESS, GDN 36/36 OK, flash-attn non compila (buco driver K5), MUL_MAT_ID Q4_K rotto (73 FAIL) → esperti 35B su CPU (hook + correttezza). **K2.1 (`moe-gdn-k21-parity.md`): il garbage E2E NON era GDN/attention/stato — era SOLO l'lm_head**: tied `token_embd` Q6_K [2048×248320], il redirect large-M (`use_flat_gemv_for_large_m_q6_K`, ggml-opencl.cpp:6459) lo ruba al GEMV noshuffle Adreno (corretto sul 740) e lo dà al kernel flat (NMSE ~12). Workaround verificato: `-ot token_embd.weight=CPU` → output sano. **K2.2 FATTO** (`moe-gdn-k22-fix.md`, branch `kalsa/opencl-q6k-dispatch-fix` @ a92a51627): redirect large-M spento quando ne1%128==0 → lm_head sul noshuffle corretto; greedy GPU **token-identico** al CPU senza workaround; GDN 100%; regression tests aggiunti. **PRIMO NUMERO ONESTO 740: decode GPU 0.41× CPU (5.06 vs 12.37) = FAIL; prefill 1.29×** → sul 740 il decode GPU perde anche da corretto: lane 740-decode CHIUSA per misura (coerente con LiteRT 1.5B 0.73× e K5). Review ostile del diff IN VOLO (DeepSeek: buco soglie + path non-Adreno). K2.3 (kernel flat) deprioritizzato: con la fix nessun tensore reale dei nostri modelli lo usa più. Review PASSATA + K2.2b chiuso @ 04c5d362a. Recon Google: TECHNIQUES_ONLY (`research-google-gpu-kernels.md`). Recon 750 (`research-adreno750.md`): **750 è A7X, broadcast=false anche lì → gate Xiaomi LIKELY_FAIL; primo silicio col broadcast = 830/8 Elite (non in lab). MA LiteRT vince 1.43× a 3.8B SUL 750 con kernel subgroup-free → il port è L'UNICA via GPU per l'installed base A7X.** **🪦 M1 PORT: FAIL ONESTO, port GEMV ucciso a costo minimo** (`moe-mld-m1.md`): (a) i dequant subgroup-free MISCOMPILANO sul driver E031.41 (NMSE 0.67-0.9; stesso convert + kernel stock = PASS → è il driver, non il codice); (b) il colpo decisivo: **noshuffle è GIÀ al tetto DRAM (34-41 GB/s) sulle shape FFN dominanti** — la leva layout del paper è già spesa nei kernel esistenti; 1.4× richiederebbe 48 GB/s che non esistono. **Diagnosi in regalo**: il gap E2E (GPU 10.25 vs ~26.6 teorici al tetto) è ~60 ms/token di OVERHEAD DISPATCH/GLUE, non kernel → una continuazione seria = fused executor stile ML Drift (mesi), non kernel (settimane). Decisione gualt: parcheggiare GPU-decode su A7X (bancando: GDN-first, prefill GPU 1.3-1.7×, CPU 18.19, fix Q6_K) oppure M2-feasibility SOLO CARTA (conteggio dispatch/token da sched log + ceiling fusioni, 1 giorno) prima di chiudere | gualt: park vs M2-carta |
| **📊 TTFT (LA priorità user-facing): F0 Jelly COMPLETO — i minuti sono il RE-PREFILL (13.8 tok/s), e il riuso KV di sessione è ROTTO** (`moe-ttft-f0-jelly.md` + `kalsa-ttft-audit.md` + mandato fix `mandates/kalsa-ttft-fixes.md`) | C1: alloc KV innocuo (~5 s perfino a `-c 262144`). C2: 0.0725 s/token → finestra app 10-16k = **12-19 min** di re-prefill su G99. **C3: riuso 0%** — prefisso byte-identico riprefillato intero; causa supportata: seq_rm rifiutato su ibrido attn+SSM → wipe; binario Jelly ≠ KVFIX `ede3ac7c`. C4: transcript mutato = 2.5-3 min onesti (6+ osservati col wipe). **P0 app (keepalive/eager/compaction) reggono SENZA C3**. **C3-rerun col KVFIX (A76 fresco): FAIL di nuovo — n_common=0, non era il binario**: commit assistant non byte-fedele (re-render perde esattamente gli 8 token generati) + seq_rm che non tronca su ibrido attn+SSM → wipe. KV-reuse su questo arco = **0% finché l'engine non fixa il commit assistant** (o checkpoint SSM). **VERIFY branch fix @ 56464da su Jelly (2026-08-13, `kalsa-ttft-verify-jelly.md`): FAIL TOTALE — S1 cold 53.4 s = identico al vecchio path.** Anatomia: 6.6 s init (eager MAI partito: `runAfterInteractions` cancellato dai re-render di boot, `engine.eagerInit` mai in logcat) + 47 s prefill del prompt system/tool da ~1.4k tok a 28 tok/s (restore `.kvs` ibrido wippato nativamente: JS ok:true 1635 tok, `loadPrompt:462` n_past=0 = Q6.c, l'88% del numero, FUORI scope app). Keepalive morto su OEM-kill (processo ucciso in <5 min). Compaction default-ON non applicato agli upgrade (chiave "0" residua). ORO nel report: **in-process il prefix-reuse FUNZIONA (1407/1436, 1.8 s)** → la mossa v2 è PREWARM del prefisso system a boot (non serve Q6.c per il messaggio 1). **V2 IMPLEMENTATO E MISURATO SU JELLY (grok gualt, branch `fix/ttft-v2` @ 493336b, 11 commit): 🎯 TTFT 53.4 s → 1.40 s (scenario 1a: cold + 90 s + send, `reusing 1276/1293`).** Matrice: 1b (send immediato) 39.5 s = join sul prewarm in corso (<53 richiesto ✓); swipe-kill→relaunch→90s→send **2.48 s** (il prewarm copre la morte processo — lo scenario che il keepalive non avrebbe MAI coperto; KVDIAG onesto n_past:0); scenario 2 PARTIAL (processo morto a metà misura, ma recovery send riusa 1276/1456). Keepalive correttamente NON shippato (motivazione onesta nei docs). Design: prewarm via stesso `withEngineJob` (FIFO join), `n_predict:0` senza fallback (un token emesso avvelenerebbe il prefix-match), hash-miss→fall-through, `prewarmPrefixHash` protegge il KV chat caldo; 2 fix trovati SUL DEVICE (add_generation_prompt=false + one-char user per il jinja). Numeri PLUGGED (A/B relativo = deliverable). **Review ostile DONE: MERGE_WITH_FIXES(3)** — le racce/leak/jinja/n_predict:0 REGGONO tutti (i 17 token non riusati = coda user-line, bounded, non cresce); i 3 CONFIRMED: (5.1) prewarm su modelli DENSI distrugge il restore vero (seq_rm riesce su Gemma → chat tail cancellata + 40 s sprecati; fix = skip se kvHoldsChatSession && !hybrid), (5.4) chiave bake rematch non persona/whitespace-stabile → BAKE_FORMAT_B no-op silenzioso per utenti con persona, (5.2) **premessa migrazione compaction FALSA**: git log -S prova che l'unico writer della chiave è il toggle → ogni "0" salvato è scelta esplicita utente e la v2 la calpesterebbe (fix = "0" resta OFF, default-ON solo a chiave assente). **✅ MERGIATO SU MAIN (2026-08-13 notte)**: 3 fix landed (e599a0b skip prewarm su dense-restore reale, 601cba3 bake key = stringa persona'd della history via `bakeRematchKey` canonica, 2e6b088 "0" = OFF esplicito default-ON solo a chiave assente) + optionals (foreground gate `AppState==="active"` anti prewarm-storm OEM, telemetria `n_predict_rejected`, hash documentato identity-only). Harness tutti verdi (prefixPrewarm 4 casi dense-restore, memoryFactsTail 20/20 persona+whitespace, compactionParse, eagerKick, sessionSaveGate 24/24); smoke Jelly skippato (device non idle, fix logic-level coperti). Diff auditato dal coordinatore (incl. verifica che il foreground gate non uccida il cold-launch: il prewarm parte a fine init engine, quando AppState è già active). Merge --no-ff su ai-chat main | engine-track: Q6.c resta per cold-restore chat lunghe |
| **🪦🪦 Typeahead CalaQwen + phase-split 2B (test gualt S23 2026-08-13): DUE DEAD, entrambi su buchi ENGINE non di fisica** | **Typeahead DEAD**: prefill incrementale ricalcola tutto (527 tok: 67 s vs 64 s da zero; a pezzi = 3.5× il prefill unico) — riuso KV solo con `--chatml` (`n_common=0` senza) e manca l'API "rimpiazza prompt + prefilla delta". **Split 2B**: soffitto 0.73× (20.6 s vs 28.3 CPU su turno 490+128) SOLO con handover KV in-process; con 2 processi = 1.27× (peggio); tutto-GPU 29.2 s (peggio). Dettagli nel registro checkpoint | riapertura solo su engine-work (API delta-prefill / KV handover) |
| Jelly free-tier baseline (Qwen3.5-4B dense, llama-bench ABBA `-t 2`) | **DONE 2026-08-14** — product **3.52 tok/s** tg128 `-t 2` (median 4 ABBA decode samples; tight 3.52–3.53, one 2.09 drift). **Bottom of the G99 free-tier ladder** (below 2B 8.04 and LFM k4 10.60). UNPLUGGED 100→90%, 30→37 °C, screen Awake. Pin `36b01966` before=after. `reports/moe-jelly-freetier.md` + `results/jelly_4b_baseline/` | closed |
| REAP multilingua F0 | smoke PC PASS; phone path parziale | gualt se priorità |
| **🔧 KERNEL CPU micro-esperti (mul_mat_id batched) — GO SPIKE (gualt 2026-08-13 sera)** | Il caso F1d: Mellum2 computa 0.228 s/tok, scaling dal dense 2B predice ~0.09-0.10 → **~2.5× perso in mul_mat_id** (672 micro-GEMV/token 896-wide, sync per-op, WALT→little 74%, dequant senza pack). Design: GEMV batched per-layer (k esperti fusi), pack SIMD al cache-insert, 1 sync/layer, hint scheduler. Paga: Mellum2-S23 (4.4→6-9), TUTTO il residente (iPhone Pro/flagship = target SKU), LFM2.5-class; NON Marco1c-S23 (tetto flash). Weakness nota upstream → PR-worthy. **Gate: spike profiling 1g** — se ≥50% di 0.228 recuperabile → GO kernel (1-2 sett); se GEMV puro a tetto DRAM → chiuso col numero. **K0 DONE (2026-08-13): GO_KERNEL, recuperabile 72%** (`moe-mellum2-kernel-k0.md`): GEMV puro NON a tetto (fused Q4_K 39 GB/s, floor 0.023 = 10% di 0.228); waterfall = layout 8% + dispatch per-op 43% + tax sync/scheduler t4-vs-t2 21%; dequant <2% (non leva). Sorprese: (a) **`-t 2` batte `-t 4`: 0.181 vs 0.236 — stage 0 GRATIS, zero codice**; (b) down NON è Q4_K (Q8_0×14+Q5_0×14, già a tetto DRAM 53.5 GB/s — non impaccare); (c) mul_mat_id Q4_K = "8 GEMV in fila" (ID 557 µs ≈ 8×single 571). Design a stadi: S0 `-t 2` (5.5 t/s) → S1 pack 8 esperti Q4_K in un MUL_MAT (6.1) → S2 fusione per-layer gate+up+SiLU+down, 84→28 launch (7-9) → S3 placement solo dopo. Soffitto onesto 7-9 t/s compute; 10 t/s richiede anche KEXP/k-cut sul flash. Gate correttezza: NMSE <5e-4 + greedy n=32 token-match vs pin. **GOAL (gualt 2026-08-13): S23 wall ≥9 t/s (stretch; base onesta 7) via S0-S2 + KEXP + k6d1.0; flagship RESIDENTE 15-20 t/s (Xiaomi 14 ~10-14, 8 Elite Gen 5 15-20 — Oryon ~2× + banda ~2× + KEXP ~4.5GB in RAM). Vincolo design: kernel GEOMETRY-PARAMETERIZED (n_expert/k/d_ff/quant letti dal GGUF, zero hardcode Mellum) + autotune on-device (thread count: la U t2-vs-t4 è per-SoC; micro-bench al primo avvio, cache per device). GPU = backend separato scelto da probe, non stesso kernel.** **S1 DONE (2026-08-13, `moe-mellum2-kernel-s1.md`, branch `kalsa/kernel-s1-expert-pack` @ 93d78ab): S1_FAIL(4) MA kernel CORRETTO e al floor** — fused 231.6 µs a t=8 (2.58× vs stock), NMSE 8/8 PC+S23, greedy token-identico, no-regression su qwen3moe 256e. Il fail: on-model t=2 compute 0.182 = baseline 0.181 → **la fetta layout 0.018 del K0 era un artefatto t=8-only** (a t=2 stock=fused=tall=421 µs: 2 thread saturano già la banda del GEMV). Recuperabile rivisto (framing pulito, review esterna Qwen3.8-Max recepita): vs t=4 0.228 = ~64% (dispatch 43% + tax 21%); MA a policy t=2 la tax è già spesa → fetta azionabile = dispatch 0.097 su 0.181 ≈ **54%**; la predizione S1 6.1 t/s è morta, S2 resta la leva vera (84→28 launch, banda onesta post-S2 0.11-0.14 = 7-9). Review S2 al rientro: aggiungere greedy LUNGO n=256 ON/OFF (drift router/cache che n=32 non cattura); post-S2: sanity secondo device (Jelly 2×A76+6×A55 = geometria core diversa, testa anche l'autotune). Respinti coi dati: S1-OFF-default (neutro a t2, +0.027 a t4, substrato S2), prefetch (già rifutato su flash-saturo). S1 NON è codice sprecato: a t=4 mangia 0.027, ed è il substrato per S2 (op grasse → thread di nuovo scalabili: fused a t=8 fa 232 µs). Bonus: k6 d1.0 a t=2 compute 0.159 (vs 0.175 a t=4). Coordinatore ACCETTA FAIL(4) come "kernel buono, slice 2 t=8-only" → S2 GO. **S2 IMPLEMENTATO (2026-08-13 sera, report kernel-s2-impl): fusione backend-level dei 5 nodi MUL_MAT_ID+MUL_MAT_ID+GLU+MUL_MAT_ID+MUL in UN launch CPU** (`ggml_compute_forward_moe_swiglu_id_fused`, stadi A quantize→B tall-GEMV gate+up+SiLU→C quantize→D down+reduce, barrier interni, steal S1) — llama.cpp `74e37a625` + BigMoeOnEdge `0c54a27` su `kalsa/kernel-s2-layer-fuse` (branch VERIFICATI su disco, non pushati); matcher a 15 condizioni (n_tokens==1 only, prefill stock; K-quant gate/up; tail VIEW/ADD/CONT o partial), flag `--moe-fused-ffn` default ON + env `GGML_MOE_FUSED_FFN`; **geometry-parameterized come da vincolo gualt (zero hardcode: tutto dai tensori) + caso qwen3moe 128e nei test**; correttezza PC 7/7 (`MOE_SWIGLU_ID`, NMSE 5e-4, incl. n=2 must-NOT-fuse). **MISURA S23 round 1 (2026-08-14 notte, `reports/moe-mellum2-kernel-s2.md` + `results/kernel_s2/`): STOP onesto a CORRECTNESS_FAIL** — 7/7 backend-ops su device PASS, greedy n=32 PASS, ma **n=256 fuso ON vs OFF diverge al char 677** ("(or" vs "(and") — il check n=256 adottato dalla review esterna ha pagato. Celle gate NON partite (da mandato), pin campagna MATCH, S23 90→87%. Diagnosi da fare: **riordino FP deterministico (fisiologico per kernel fuso: cambia l'ordine di somma, NMSE in tolleranza, logit quasi-pari flippa tardi) vs RACE**; discriminante = ON-vs-ON ripetuto. Celle unofficial n=256 t4 k8: compute 0.204→0.179 (−12%, sopra il gate se fosse il gate — ma non è la griglia). **Triage determinismo + celle gate condizionali IN VOLO** (grok kernel-s2-gate: se ON==ON → DETERMINISTIC_REORDER → griglia k6d065/k6d1.0 × t2/t4/t6 stanotte con caveat "pending numerics policy"; se ON≠ON → RACE → stop e si aspetta la review). **REVIEW ADVERSARIALE DONE (01:10): MERGE_WITH_FIXES(4), ZERO BLOCKER — kernel PULITO** (report kernel-s2-review, ~2h di audit con harness compilato ad hoc): race/barrier/scratch/hook tutti REFUTED con prove (steal-counter cross-fase ok, aliasing F32-down ok, hook wait-all idempotente ok); **per i grafi di produzione l'output fuso è BIT-IDENTICO allo stock (NMSE 0.000e+00, stessa quantize, stesso ordine di somma)**. I 4 fix = buchi del MATCHER su grafi legali mai costruiti da llama.cpp (pesi ne[0]≠1 NMSE 2.07, hidden ne[1]≠1 NMSE 1.09, view duplicate NMSE 0.81, contiguità hidden pre-quantizzato) — one-liner difensivi, fix grok IN VOLO (kernel-s2-fix, non tocca l'aritmetica → i numeri gate di stanotte restano validi). Regressione: MUL_MAT_ID 798/798, MUL_MAT 1140/1140, **full CPU suite 16191/16191**. **Chiave per il drift S23: la bit-exactness è provata sui vec_dot; la build S23 ha REPACK ON → lo stock ARM accumula in ordine diverso (kernel repacked) dal fuso (vec_dot row-wise) = meccanismo che predice ON≠OFF come RIORDINO DETERMINISTICO, non race.** **GATE S23 DONE (01:35, Phase A+B in report kernel-s2-gate): DETERMINISTIC_REORDER CONFERMATO (ON==ON e OFF==OFF byte-identici, ON≠OFF stesso punto) — kernel corretto, zero race. MA il verdetto perf è S2_PERF_NULL nella sostanza (S2_PARTIAL solo per lettera: best fused 0.1585 ≤0.17): il fuso è PIÙ LENTO dello stock in OGNI coppia same-t** (k6d065 t2: OFF 0.163 vs ON 0.1735; k6d10 t2: OFF 0.148 vs ON 0.1585; retry confermati) — il path fuso bypassa i kernel REPACK/i8mm dello stock ARM e perde più del dispatch che risparmia; la fetta "dispatch 43%" del K0 era MAL ATTRIBUITA (già S1 lo suggeriva a t2). t6 = trash termico (0.45). **PEPITA: k6d10 OFF t2 = 5.151 t/s wall (MiB/tok 39.2, hit 87.6%) — NUOVO BEST Mellum2-S23, +11% su F1e 4.638, gratis (solo config t2+d1.0)**; il 7-9 via kernel-CPU è morto coi dati, opzioni: (a) chiudere la lane col numero 5.15 (quality gate d1.0 PPL resta dovuto), (b) S3 = fusione REPACK-aware (rifare il path fuso sui kernel repacked — lavoro serio, solo se gualt ci crede), (c) tenere S1+S2 come substrato corretto per silicio non-REPACK (PC?). **Fix matcher DONE (01:50, commit verificati su disco: b34df7afd + 4a3ae4e5e sopra 74e37a625): 4 predicati richiesti + tutti i minor (atomic flag, env "off", test 7→10 con F32-down/K-quant-down/negativo per-row-weights); le 3 sonde adversariali ora rigettano la fusione → ALL MATCH 0.000e+00; MOE_SWIGLU_ID 10/10 anche -t1/-t3, MUL_MAT_ID 798/798, MUL_MAT 1140/1140. Il branch è pulito e PR-able upstream a prescindere dalla decisione di lane** | gualt: (a) chiudi col 5.15 / (b) S3 repack-aware / (c) archivio (+eventuale PR upstream); PPL d1.0 in coda PC |
| **Esperimento serio sul CALCOLO** | plateau ~5.9 tok/s k6d065 su S23/CPU. **NUOVO (mandato gualt 2026-08-12): pista MoE-GPU scoped Adreno 750+** — sequenza gated (a)-(e) in candidati #1: F-0 Amdahl → riverifica upstream → MarcoKEXP come veicolo → S2 split su Xiaomi 14 → solo dopo il kernel serio (GDN/SSM per CalaQwen) | F-0 = carta; S2 dopo MarcoKEXP |

### Candidati "esperimento serio" (il collo è il calcolo a 1.39 GHz)

1. ~~**GPU Adreno 740 via OpenCL — split eterogeneo**~~ **RITIRATO 2026-08-09 dopo deep
   research** (`research-adreno-opencl.md`). Due killer, entrambi verificati alla fonte
   dal coordinatore: **K2** — `GATED_DELTA_NET` ❌ e `SSM_SCAN` ❌ sul backend OpenCL
   mainline (ops.md), e il nostro modello è ibrido su ~30/40 layer → split/sync per
   layer; **K5** — su un S23 identico al nostro (Adreno 740, driver 0676.73 senza
   subgroup broadcast) il decode OpenCL è **più lento del CPU** già misurato in campo
   (tg128: 5.9 vs 9.8 su Llama-3B, 10.8 vs 14.6 su Qwen-2B GDN, discussion #22791).
   Il +30-50% è ritirato; upper bound onesto ~+15% e solo in scenari futuri.
   Unico VERDE utile: **K1** — i nostri tensori dense sono Q5_K/Q6_K (~1.75 GiB), NON
   i-quants: se mai si riaprisse, il requant non serve. **Criteri di riapertura:**
   GDN+SSM_SCAN upstream su OpenCL **E** driver S23 con subgroup broadcast **E** un
   tg OpenCL>CPU pubblicato su 740. NPU HTP: non candidato (0.67 MiB di pesi caricati).

   **[REVISIONE 2026-08-12 — mandato gualt: MoE-GPU riaperto, scoped Adreno 750+.]**
   Il ritiro sopra resta valido PER IL 740/S23 (il claim di ricerca "35B su 8GB"
   resta CPU-only). La pista nuova è il **tier premium su flagship** (Adreno 750+,
   dove il backend OpenCL è verificato e K5 non si applica), col fatto nuovo LiteRT
   (740 GPU 2.76× con kernel giusti → K5 condanna i kernel llama.cpp, non la GPU).
   Incastro chiave scoperto rileggendo lo spike S0 Xiaomi: **il B1-STOP non era
   "GPU perde", era formato quant** (Marco i1 ha dense attention IQ2_S/IQ3_S che
   l'OpenCL backend non carica). E **Marco è `qwen3moe` NON ibrido → K2
   (GDN/SSM_SCAN) NON si applica a Marco**: con un requant dense Q4-Q8 — cioè
   esattamente **MarcoKEXP** — lo split dense-GPU/esperti-CPU su Xiaomi 14
   (Adreno 750, già in lab) si misura col backend OpenCL VANILLA, zero kernel
   custom. Sequenza gated dichiarata:
   (a) **F-0 Amdahl** (carta, 1 giorno): quota densa vs esperti del tempo decode
       per token → ceiling onesto dello split; STOP se <~1.3×;
   (b) riverifica upstream dei claim OpenCL del 2026-08-03 ("tensori MoE restano
       su CPU", ops mancanti) — hanno 5+ mesi;
   (c) **MarcoKEXP requant** (già prepped, gated su GO gualt) → doppio uso:
       Fase 2 qualità/CPU E veicolo fail-fast GPU-750;
   (d) **S2 su Xiaomi 14**: Marco(KEXP) split resto-GPU/routed-CPU, llama.cpp
       OpenCL al pin, sostenuto staccato + J/token;
   (e) SOLO se (d) vince: il "kernel serio" 750+ — GDN+SSM_SCAN (per portare
       anche KEXP/CalaQwen ibrido su GPU) ed eventuale mul_mat_id esperti —
       sinergico con lo spike F3 dense (stesse fondamenta GEMV).
   Razionale prodotto: chi paga il tier premium ha flagship (RAM 12-16, UFS4,
   750+); il bonus termico è reale (CPU oggi a 1.39 GHz = 41% del picco per
   budget termico; spostare FLOP su motore più efficiente libera anche il CPU).
2. **Integrazione prodotto in Kalsa** (llama.rn ↔ BigMoeOnEdge): non ricerca ma
   ingegneria; porta i numeri della scheda dentro l'app vera. Prerequisito per shippare
   qualunque cosa di questa campagna.
3. ~~**Kernel i-quant CPU**~~ **CHIUSO PER MISURA (2026-08-09, spike S1)**: sul
   nostro S23, ik_llama è **più lento** del nostro mainline sul decode — g_IQ2
   **0.719**, g_IQ3 0.805 (regola g<1.20 → NO-GO). Il 1.42× pubblicato su M2-Max
   si è invertito sull'8 Gen 2; il pp512 3.39× conferma che il setup era vivo
   (ik vince sul GEMM/prefill, non dove serve). Con questo, il plateau decode
   ~4.4-4.7 tok/s è il soffitto onesto del percorso flash+CPU su questo quant.
   Riapertura solo con: numeri TG > mainline pubblicati SU 8 Gen 2 o silicio
   affine, o un product-need prefill (lì ik vince 3.4×, scope port diverso).

## Regole operative imparate a caro prezzo

- **In carica i TEMPI non sono affidabili** (dispersione 25-27%). In carica si misurano
  byte, hit, PPL, output, dimensioni — tutto il deterministico.
- **Prompt byte-identici con checksum** fra fasi confrontabili; **il template chat fa parte
  del contratto** (un template che spoglia il think ha rotto il riuso KV: la re-render deve
  essere byte-identica ai kv_tokens).
- **Prima di progettare, leggere `--help` per intero**: 5 volte una funzionalità già
  presente ha ribaltato una conclusione.
- **Chiedersi su QUALE CARICO si sta misurando prima di quale opzione vince**; vale anche
  per le previsioni (metrica+traccia viaggiano insieme).
- **Mediana pooled ≠ effetto reale**: il pooling di prompt diversi gonfia i Δ (speed
  drop-cold: +6.5% pooled, +2.4-3.9% per-prompt). Dichiarare l'aggregazione prima, ma
  leggere anche la vista per-prompt nel verbale.
- **Il g di un altro silicio non è il tuo g**: ik 1.42× su M2-Max è diventato 0.72×
  (INVERTITO) sull'8 Gen 2. I numeri prior-art motivano lo spike, mai il cantiere:
  solo la misura on-device decide. (Gemello della regola "quale carico": qui è
  "quale silicio".)
- **I guardrail si cambiano per mandato, non a caldo in un retry** — anche quando la
  lettura tecnica è giusta. Firma RescueParty: MemFree ≪100 MiB **E** die 88-92 °C
  sostenuti per minuti (il telefono muore a ~90 sostenuti, non a 98).
- ~~**Budget qualità lossy CUMULATIVO**: ΔPPL ≤0.15 vs baseline originale~~
  **OBSOLETA dal 2026-08-11** (audit shortlist, MAJOR-4): superata dall'adozione
  di k6d065 (Δ+0.327 vs KEXP F=0). La regola operativa vigente è il **floor
  prodotto: PPL ≤ 2.0955** (mai peggio dell'IQ2_M shippato) — regola di gualt,
  `results/kexp_baseline/README.md`. Nei report: ΔPPL riportata sia vs F=0 sia
  vs default corrente.
- **IL DROP NON SALTA MAI IL MATMUL** (fatto di meccanismo, audit 2026-08-11,
  verificato al sorgente `router_hook.cpp:206-216`): lo slot droppato è
  ripuntato sul top expert e ricalcolato (dot duplicato by design). Drop-cold =
  leva **SOLO I/O** (i miss non letti), MAI compute — e il lato I/O è saturo
  (d065→d080: +0.15%). L'unica leva compute fork-legale è **k** (cambia gli
  slot davvero calcolati: k8→k6 = +13.6% misurato). Correzione alla dicitura
  storica "caricati/calcolati" di moe-dropcold.md e alla narrativa del
  coordinatore che per tre giorni ha attribuito al drop risparmi di GEMV.
- **Route-trace INSIEME alla misura** se andrà confrontata con una simulazione.
- **Sapere COSA C'È nel corpus prima di fidarsi del metro** (T2c 2026-08-11): il
  corpus PPL di campagna e la slice multi5 IT erano la Divina Commedia
  (Gutenberg 1012) — testo che il 35B ha MEMORIZZATO (bpb 0.27 vs 0.83 su ZH).
  Spiega i PPL 1.5-2.1 "assurdi". Confronti interni same-model: validi in
  direzione. Confronti cross-model su quella slice: NULLI. Le slice valide
  sono prosa moderna simmetrica (Wikipedia "Caffè" ×4 lingue).
- Un gate che legge da un **comando esterno fallisce aperto**, uno su **sysfs fallisce
  chiuso**.

---


> 📦 **Archivio**: le sezioni storiche del piano V1 (contesto, ruoli, stato dell'arte,
> fisica, ipotesi, roadmap F0-F9, tabella comparativa, criteri, rischi, decision tree,
> fonti) e i checkpoint fino al 2026-08-11 sono in `PLAN-archive.md`. Qui resta la
> vista viva + §8 telemetria/harness + i checkpoint recenti.

## 8. Telemetria, harness e formati (per F0.3)

### 8.1 Cosa si misura, da dove

| Metrica | Fonte | Note |
|---|---|---|
| prompt tok/s, eval tok/s, ttft | output llama.cpp (`llama_perf`/timings) | parsare, non ricopiare a mano |
| majflt, minflt | `/proc/<pid>/stat` campi 12/10 | delta pre/post run; majflt = letture da flash |
| read_bytes | `/proc/<pid>/io` | leggibile per processi propri (stesso UID) |
| RAM processo/sistema | `/proc/<pid>/status` (VmRSS), `/proc/meminfo` | prima/durante(peak)/dopo |
| temperatura | `termux-battery-status` (JSON, campo temperature) | thermal zones = SELinux-blocked, non provarci |
| hit/miss cache esperti | contatori del fork (verificare in F0.4; se assenti → patch) | metrica primaria da F4 in poi |
| stabilità | exit code, dmesg non disponibile → log lmkd indiretto (processo sparito) | annotare kill |

### 8.2 Regole di misura

- 3 run per configurazione, si riporta la mediana; run scartato se temperatura iniziale >32°C.
- Cold = post-riavvio telefono. Warm = run successivo senza riavvio. Pressure = protocollo F5.
- **[2026-08-05] Cold SENZA riavvio — meccanismo primario**: il riavvio on-demand non è
  ottenibile in autonomia (v. §2.3: nessun permesso REBOOT da Termux, adb wireless non
  sopravvive al riavvio). Il cold operativo si ottiene con `~/bin/cold_model.sh MODEL.gguf`,
  che chiama `posix_fadvise(DONTNEED)` sul file del modello (`~/bin/fadv`, sorgente
  `scripts/fadv.c`): evieta **esattamente** le pagine del file sotto test, verifica con
  `mincore` che le residenti siano 0 e **esce non-zero se non lo sono** (un run "cold" non
  può quindi essere riportato per sbaglio come tale). Verificato 2026-08-05: 153856 pagine
  residenti → 0. Rispetto al riavvio è più chirurgico ma non azzera frammentazione/lmkd/
  termica: per questo **ogni riga CSV deve registrare `MemAvailable` a inizio run** come
  covariata (`/proc/meminfo` è leggibile da Termux). Il riavvio vero resta il gold standard
  e si usa quando gualt è presente; in quel caso la nota del run dice `cold=reboot`.
- Cold+warm si misurano ENTRAMBE solo per le configurazioni promosse (la migliore di ogni
  fase → righe B, B2, C2, C3, D, E di §9); gli sweep intermedi (F2.2, F4.3) si misurano solo
  warm. In §9 le celle non misurate si riempiono con "—", mai lasciate vuote.
- Prompt fissi (short/medium/code), `--temp 0` nei run di misura (determinismo), `-n` fisso
  per confronti (64 per il 35B, 128 per i piccoli).
- **[2026-08-04, lezione F2.2] Cooldown tra run**: ≥3 min di idle E temperatura batteria
  ≤30.0°C prima di OGNI rep. La batteria è un proxy LENTO del SoC: run back-to-back
  si auto-throttlano anche con batteria a 30-31°C (misurato: stessa config 8.9 tok/s da
  fresco vs 5.9 back-to-back).
- **[2026-08-04] Sentinella anti-drift**: alla fine di ogni stage di sweep si RIPETE la
  config vincente; se devia >15% dalla sua mediana, lo stage è invalido (ordine/termica)
  e si rifà col cooldown. Nessun "best-so-far" è valido senza sentinella.
- **[2026-08-04, sera] Floor batteria**: nessun rep di misura parte con batteria <40%
  (sotto quota, Android/SoC attivano risparmi che falsano i numeri). Il runner si mette in
  attesa e segnala CHARGE_NEEDED nel log. La ricarica avviene SOLO tra una fase e l'altra
  (mai durante le misure — regola UNPLUGGED invariata); in particolare: **ricaricare a ≥80%
  tra la fine di F2 e l'inizio di F3** (F3 è la fase più energivora della campagna).
- **[2026-08-04] majflt/token si legge INSIEME a tok/s**: run con majflt alto (>50k) =
  page-cache evicted, regime memoria — si annota come tale e NON entra nella mediana di
  baseline (misurato: tok/s correla inversamente con majflt a parità di config). Le mediane
  di baseline si calcolano sui run a majflt basso; il regime alto è un dato di pressione,
  non di prestazione.

### 8.3 Schema `runs.csv`

```
run_id,date,phase,model,quant,file_gb,runtime(mainline|bigmoe|ik|custom),runtime_commit,
flags,threads,n_ctx,kv_type,n_gen,run_type(cold|warm|pressure),
prompt_id,prompt_tok_s,eval_tok_s,ttft_ms,majflt_delta,minflt_delta,read_bytes_delta,
vmrss_peak_mb,memfree_min_mb,batt_temp_start,batt_temp_end,expert_hit_rate,notes
```

### 8.4 Template report di fase (`reports/moe-f<N>.md`, in questo repo)

```
# F<N> — <titolo> — <data>
## Cosa è stato fatto (vs piano)
## Numeri chiave (tabella, riferimenti a run_id)
## Deviazioni / sorprese / bug
## Verdetto gate: PASS | PASS-CONDIZIONATO | FAIL | BLOCKED(<motivo>)
## Prossima azione proposta
DONE
```

---

## Registro checkpoint

*(voci ≤ 2026-08-11 in `PLAN-archive.md` → «Registro checkpoint (archivio)»)*

- **2026-08-30 — #40 qdc-8elite-speed-kexp: BANCATA (audit GLM fresco FIX →
  APPLY al re-audit) — decision table KEXP su Adreno 830 completa la serie
  generazionale.** Prereg `3af32c18` (locked pre-numeri). Sessione 792790,
  QRD8750/8 Elite (unit `41c5710f`, arch sun/SM8750, Android 16), modello
  Marco-Mini-Instruct-KEXP (qwen3moe 17.25B Q4_K 5.94GiB, sha verificato
  local==device), ABBA 4/4 exit 0, gate termico HAL vivo (≤44°C, status 0) su
  ogni invocazione. Mediane dei blocchi: **A(GPU ngl99) pp512 274.5, tg128 48.9;
  C(CPU ngl0) pp512 107.4, tg128 60.7**. Regola pre-scritta (mediana dei blocchi,
  soglia 5%): **GPU vince il prefill 2.56×, CPU vince il decode 1.24×** — entrambi
  ben oltre soglia. Serie ora completa e OGNI generazione dà verdetto diverso:
  740 CPU-sempre → 750 GPU-2.21×-prefill/pari-decode → 830 GPU-2.56×-prefill/
  CPU-1.24×-decode; ri-misurata per generazione, mai trasferita. È esattamente lo
  split per-fase che il governor (#38) sfrutta — tesi confermata anche sulla
  ricetta KEXP, non solo sull'LFM2.5 di ship. Onestà bancata: sessione 792778
  VOID (`/vendor/lib64` nel LD_LIBRARY_PATH bypassa il namespace sphal → driver
  Adreno fallisce il dlopen di libCB.so → fallback CPU SILENZIOSO etichettato
  OpenCL ngl99 con exit 0; numeri farlocchi = arm C vero, verificato) tenuta come
  exhibit; diagnosi iniziale sbagliata ("unità rotta") corretta a verbale.
  Evidenze scratchpad/agents/qdc-8elite-speed-kexp/ (PREREG/REPORT/AUDIT/raw).

- **2026-08-30 — #41 qdc-8elite-governor-8b: BANCATA (audit GLM fresco FIX →
  APPLY al re-audit) — il governor scala al modello 3× e il commit-tax SCENDE.**
  Prereg `166f9ccf` (locked pre-numeri). Sessione 793164, QRD8750/8 Elite (unit
  `b4bd0901` da adb devices, props sun/SM8750/Android 16), modello LFM2.5-8B-A1B
  Q4_K_M (arch lfm2moe, 5.15 GB, sha local==device), governor-bench 5c3979438
  (fail-fast anti-fallback), ordine A C C A G G, 6/6 exit 0, gate termico HAL
  vivo pre-invocazione tutti PASS (max 50.5°C/status 1), due cooldown da 1 min
  dopo eccursioni post-run a status 2 (47.1/47.5 al re-probe, archiviati).
  Mediane: **A ttft 2517.7/2518.8 ms decode 28.20/28.37 t/s; C ttft
  25122.6/26134.1 decode 13.95/13.46; G ttft 2495.8/2496.1 decode 13.32/13.33,
  commit 22.15/20.77 ms = 0.89%/0.83% del prefill** (banda pre-scritta "≤3%:
  scales cleanly"; riferimento #38 ~1.9% sul 2.6B → il commit cresce PIÙ LENTO
  del prefill: solo 6/24 blocchi attention, ~8.06 MiB/commit, primo turn
  staged-only 6.28 MiB). **G = WIN per la regola pre-scritta** (prefill: sotto
  entrambe le barre, perfino più veloce di A; decode ≥0.95×C in tutti i
  pairing, il più stretto 0.955). Co-headline vincolante: l'arm migliore in
  ASSOLUTO qui è A (decode 2.0–2.1× vs CPU a n_threads=1, caveat dichiarato) —
  con #38 (2.6B: G batte entrambi) e #40 (KEXP: CPU vince il decode) è la prova
  a tre punte che il routing va deciso per-device E per-modello; uno split
  fisso GPU-prefill/CPU-decode è sbagliato su questo 8B, e il meccanismo v0
  (commit sub-1%) è abbastanza economico da permettere QUALUNQUE scelta del
  router. Onestà bancata: citazione serial corretta dall'audit (non era nel
  getprop), rate upload 24.9 MB/s (non 23.8 decimali), re-probe termici e
  SHA256SUMS archiviati post-hoc con etichetta, "46.9" del primo draft era una
  trascrizione sbagliata (47.5 reale). governor-bench inghiotte il banner
  OpenCL → evidenza GPU via fail-fast strutturale + probe llama-bench dedicato
  (selected platform QUALCOMM/Adreno 830) + split 10× dei numeri. Evidenze
  scratchpad/agents/qdc-8elite-governor-8b/ (PREREG/REPORT/AUDIT/raw).

- **2026-08-30 — #42 qdc-8elite-vl3b: BANCATA (audit GLM fresco FIX → APPLY
  al re-audit) — il primo VLM della campagna, e la decision table guadagna la
  terza fase.** Prereg `6642824d` + AMENDMENT-1 pre-misura `20f2a259` (kit
  556118a08 = 5c3979438 + patch timing mtmd-cli; --ignore-eos; metriche
  esatte). Sessione 793229, unit `eb49fb9d` (serial NEL provenance — lezione
  #41), LFM2.5-VL-3B ufficiale LiquidAI (backbone = LFM2.5-2.6B di ship +
  SigLIP2 NaFlex 400M; gguf Q4_K_M + mmproj Q8_0, sha local==device==
  pubblicati), immagine sintetica deterministica sha 55e455a2. Ordine
  C A M / M A C / A M C, 9/9 exit 0, gate termico HAL 18/18 PASS (max 46.5°C
  status 0 — il VLM single-turn è termicamente mite). Mediane: **C enc 3915 ms
  / prefill 5752.8 / 29.07 t/s; A enc 6549 / 1445.6 / 22.64; M enc 3927 /
  1436.2 / 22.68**. Regola pre-scritta (mediane di 3, ≥5%): **encode → CPU
  (tie C/M 0.31%; la GPU perde 1.67× — il warmup elenca le op CLIP che
  OpenCL non supporta: UPSCALE/SOFT_MAX/CONT/PERMUTE/RESHAPE/MUL_MAT f32,
  bersaglio kernel concreto se mai servirà la visione GPU); prefill → GPU
  4.0× (tie A/M 0.65%); decode → CPU 1.28×**. End-to-end (REPORT-only):
  M miglior arm statico 11008 ms; composizione per-fase ipotetica
  CPU-enc+GPU-prefill+CPU-dec = 9755 ms = 1.13× sul migliore, 1.40×/1.44×
  sui puri — nessun arm statico può eseguirla: è la tesi del governor estesa
  alla terza fase, QUARTO punto dati del routing per-device/per-modello/
  per-fase (#38 G vince sul 2.6B; #40 KEXP split; #41 8B tutto-GPU; #42 VL
  three-way). Determinismo: 9/9 byte-identici intra-arm (regola di estrazione
  archiviata, hash riprodotti indipendentemente dall'auditor). Onestà bancata:
  il banner OpenCL richiesto dal prereg è filtrato dal logger di mtmd-cli
  (stesso meccanismo #41) → deviazione dichiarata, evidenza sostitutiva:
  A = 45 righe warmup backend=OpenCL in-run (prova diretta), M = SOLO
  comportamentale+probe (il primo draft diceva "A/M" — falso, beccato
  dall'audit e corretto); hash del primo draft non riproducibili → regola
  archiviata e rigenerati; A NON rilabellata "degraded" con motivazione a
  verbale (fallback op-level gridato ≠ fallback silenzioso totale della
  clausola). Actionable di prodotto: sul VL il decode CPU (29 t/s) supera il
  20 t/s di riferimento Liquid su SM8850. Evidenze
  scratchpad/agents/qdc-8elite-vl3b/ (PREREG/REPORT/AUDIT/raw).

- **2026-08-31 — #43 qdc-8elite-npu-v79: BANCATA (audit GLM fresco #8 FIX →
  APPLY al re-audit) — NPU v79 day-0: il lane esiste, e sul modello di ship
  il prefill NPU è 7.2× la CPU.** Prereg `5606d929` (lock 12h prima della
  prima misura, verificato via git dall'auditor). Sessione 793389 (coda
  11.5h su pool Unavailable — record; il login web QDC del browser headless
  si è rotto per tutta la mattina: host Connect relayato dall'owner, ops
  note). Unit `2a38935c` (sun/SM8750/Android 16 userdebug). Kit
  npu-kit-556118a08 buildato NEL CONTAINER UFFICIALE (ghcr.io/
  snapdragon-toolchain, NDK r28b + Hexagon SDK 6.6.0.0, niente login/PC —
  via indicata dall'owner; race dei 4 skel paralleli aggirata con build
  seriale). **Q1 INIT-OK**: `Hexagon Arch version v79`, sessione cDSP
  unsigned-PD, hwinfo 6 HVX + HMX + 8MB VTCM — skel nostro servito al primo
  colpo. **Q2 = "v79 defect list started"** (regola prereg applicata alla
  lettera): MUL_MAT 472/542 (70 FAIL), MUL_MAT_ID 0/301; MA il censimento
  COMPLETO dell'auditor (362/362 righe diagnostiche, zero inversioni) mostra
  HTP0 sempre finito e giudice CPU sempre nan/±inf, e il control GPUOpenCL
  contro lo STESSO giudice passa 407/407 → giudice avvelenato SOLO in
  accoppiata HTP (classe del NaN-judge Adreno già bancato); restano VERI:
  36 dspcall INTERNAL-ERROR (29 su m=16 n=4..8, 7 fuori incluso
  m=576×512×576) e 7 FAIL senza diagnostico (incluso q4_0 m=1,n=2048) non
  caratterizzati. **Q3 esplorativo, N C C N 4/4 exit 0, modello di ship**:
  N pp512 1500.4/1524.1 tg 22.6/24.3; C pp512 212.0/210.2 tg 38.6/38.4 →
  mediane N 1512.2/23.47, C 211.1/38.49 = **prefill NPU 7.2×, decode CPU
  1.64×** (flag della ricetta upstream, dichiarati NON comparabili con
  #38/#41; nessun verdetto di routing — semina la colonna NPU della
  decision table 2.6B/830). Q4: smoke reasoning-trace-only (NESSUN braccio
  ha emesso risposta finale a -n 64 — relabel imposto dall'audit), lingua
  coerente e lista pianeti corretta nel thinking N. Onestà bancata:
  deviazione binding sul gate termico CLI (gate stantio 10 min, nessun gate
  pre-C, mitigante post 48°C); "well under gate" ritrattato (pre_N2 57.6;
  post-C 61.5/63.0 = SOPRA soglia IN esecuzione — il braccio CPU si
  autoscalda oltre il gate anche qui); SHA256SUMS self-hash provato
  matematicamente (voce = sha256 della stringa vuota); primo commit di fix
  errato (solo artefatti) dichiarato e amendato. Evidenze
  scratchpad/agents/qdc-8elite-npu-v79/ (PREREG/REPORT/AUDIT/raw).

- **2026-08-30 — #39 qdc-8elite-opencl-e031: BANCATA (audit GLM ostile FIX →
  APPLY al re-audit) — i kernel MoE q2/q3 sono CORRETTI su Adreno 830, terza
  generazione GPU/compiler, al primo run.** Prereg `e14b7fe1` (locked pre-numeri:
  commit 14:44, raw mtimes 17:16-17:22; la riga "locked at e68414a9" del prereg
  nomina il commit BASE). Kit bin-gov-5c3979438-stripped su QRD8750, Android 16,
  driver OpenCL 0800.70 Compiler E031.47.18.47. test-backend-ops: **MUL_MAT
  925/925 eseguiti OK, 0 FAIL, 545 skip** (925+545=1470 righe per-caso);
  **MUL_MAT_ID 407/407 eseguiti OK, 0 FAIL, 405 skip** (407+405=812) — conteggi
  riprodotti indipendentemente dall'auditor. Claim RISTRETTA dall'audit: i
  q2_K/q3_K su MUL_MAT semplice NON sono MAI stati eseguiti (26/26 "not
  supported" — il backend li declina per capability); sul path MoE (MUL_MAT_ID,
  i nostri kernel 8x4) 10/14 casi eseguiti e TUTTI OK — tutte le shape
  realistiche (m=64/96/512, n_mats=4, n=1..32); i 4 skip sono shape piccole
  dichiarate non supportate (m=8 n_mats=3, m=16 n_mats=5). La claim bancabile:
  corretti sull'830 per ogni shape che accettano. Onestà bancata: primo
  tentativo VACUO con `-b OpenCL` (il backend si registra come **GPUOpenCL**;
  12 righe di Skipping + OK verde) tenuto in raw/ come negative exhibit per
  ENTRAMBI gli op; il "pre 37.3/32.4 °C" di una bozza è RITRATTATO
  (mis-trascrizione, nessun artefatto lo contiene); snapshot termici pre-run
  non catturati (deviazione procedurale dichiarata — correttezza non
  clock-sensitive, Thermal Status 0 a verbale in entrambi i post); exit code
  non preservati come artefatti (evidenza di completamento = firma completa
  per-caso + summary + backend OK). Evidenze
  scratchpad/agents/qdc-8elite-opencl-e031/ (PREREG/REPORT/AUDIT/raw).
- **2026-08-29 — #38 qdc-8elite-governor-crossbackend: BANCATA — il governor v0
  VINCE su 8 Elite.** Prereg `ddddf077` (locked pre-numeri) + AMENDMENT-1 `28a6c934`
  (scritto PRIMA della riesecuzione: il gate termico del run 1 leggeva il gruppo
  sensori `Cached` CONGELATO di dumpsys thermalservice — run 1 VOID per i tempi, la
  correttezza resta; il gruppo vivo è `Current temperatures from HAL:` + `Thermal
  Status`). Esecuzione orchestratore, sessione 788862 (QRD8750/Adreno 830, ~75 min),
  engine `kalsa/governor-v0` @ 5c3979438, modello di SHIP LFM2.5-2.6B QAD-Q4_0,
  ABBA 2 blocchi, r=3, cooldown ≤60 °C + status ≤1 prima di OGNI run. Mediane:
  A(GPU) ttft 1395/1394 ms, dec 23.7/23.8; C(CPU) ttft 16476/14412 ms, dec
  21.6/23.3; **G ttft 1434/1470 ms, dec 25.3/24.2, commit 26/29 ms = 1.80%/1.98%
  del prefill**. Regola pre-scritta: G PASSA tutte e tre le condizioni in ENTRAMBI
  i blocchi (TTFT ~10× meglio di C e entro 3-5% di A; decode ≥ C; commit <2%).
  Onestà bancata: il 2% passa per 0.02 punti nel blocco 2 ed è prompt-length-
  dependent (costo commit quasi fisso 11.2 MB/turno); parte del vantaggio decode di
  G è TERMICO (C si scalda da solo a 90-93 °C col proprio prefill CPU, G arriva al
  decode più fresco — effetto reale del design ma non velocità kernel); r=3, un
  device, niente 740/battery/app/KEXP. Correttezza cross-backend: test-governor-
  v0-devices PASS su GPU+CPU reali (prefill_splits=2, naive+staged entrambi
  esercitati). Evidence `scratchpad/agents/qdc-8elite-governor-crossbackend/`.

- **2026-08-28 (sera) — #37 qdc-8elite-cpu-day0: BANK-WITH-ERRATA — prima cella
  QDC, primo dato 8xx.** Prereg `f72b1b20` (locked pre-numeri), esecuzione grok su
  sessione interattiva QDC (8 Elite QRD8750 "Sun"/Oryon, Android 16, adb via tunnel
  SSH porta locale 6037 — server adb locale/Jelly mai toccato), audit ostile GLM
  `qdc-day0-bank-audit/REPORT.md`, spot-check orchestratore (righe cert, mediana t8
  tg128 ri-derivata dai 3 avg_ts, skip-record, battery stub). BANCATO: (a)
  correttezza CPU kit `a0cabca6b`: **MUL_MAT 1144/1144** (cert_mm_cpu.out:1477) +
  **MUL_MAT_ID 812/812** (cert_mmid.out:819) con `-b CPU` — il tentativo senza `-b`
  era uno skip vacuo e NON è stato contato (gestione onesta, audit-CONFIRMED); (b)
  speed OLMoE Q4_K_M (4213513024 B, sha verificata): tg128 -t8 **59.095**, pp512
  **92.996**, -t6 **52.504 / 75.514** (mediane per-invocazione, aggregatore
  conservativo ma non pre-reggato — erratum 1). PLUGGED DECLARED (e il battery
  service del rack è CONGELATO: stub 43.0 °C — erratum 3; termica vera da
  thermalservice HAL: CPU 39.6→53.8 °C, status 0→1, drift monotono −8.6% worst =
  numeri mid-ramp, erratum 2). Comparator #20 (S23 CPU tg128 27.685 unplugged,
  no_repack diverso): **~2.1× device-class**, non A/B controllato (erratum 5).
  Costo 20 min / 996. Conseguenza piano: il dato-CPU degli 8xx alza l'asticella di
  ogni investimento kernel HVX/GPU su quella classe; in coda Marco-KEXP (#18) e
  kit GGML_OPENCL=ON per la colonna E031 su Adreno 830. Evidenza
  `scratchpad/agents/qdc-8elite-cpu-day0/` + `qdc-day0-bank-audit/`.

- **2026-08-28 — #36 s23-unplugged-baseline-night0: BANK-WITH-ERRATA
  (correttezza-only).** Prereg `ecd3e983`, Amendment-1 `f90a1d5e`, audit ostile
  GLM `night0-bank-audit/REPORT.md`, verifiche orchestratore su disco. BANCATO:
  correttezza s3oracle su S23 **UNPLUGGED** — MUL_MAT_ID 407/407
  (`raw/cert_mmid.out:815`), MUL_MAT 925/925 (`raw/cert_mm.out:1473`), pin set
  11/11 verbatim, ac:false provato nei battery.pre. **NESSUN numero di velocità**:
  tre tentativi, tre morti diverse — (1) plateau 38.8–39.0 °C ×2h da sveglio
  (gate 32 irraggiungibile), (2) drain reale 13–15 %/h ≫ premessa 7.5 dell'
  Amendment-1 (blocco aritmeticamente infinibile dal 46 %), (3) transport adb
  morto ~20 s dentro la run A (refused, 10 min di retry). ERRATA (6 voci in
  `ERRATA.md`): premessa drain REFUTED, possibile jsonl orfano ON-DEVICE da
  tirare giù al replug (TODO), migrazione porta :36329→:37687 non coperta dal
  prereg, identità device asserita nei raw, gate 36.0 a margine zero, evidenza
  committata solo al bank (questo commit). Conseguenza: matrice speed unplugged
  MORTA per la trasferta → QDC 8 Elite (operativo da oggi: 1000 min su QRD8750,
  adb-via-SSH + exec binari PASS) e/o S23 plugged/USB. Bonus piattaforma:
  kalsallama su macOS/aarch64 10/10 test (incl. 6× test-repack-q23k) — prima
  piattaforma kernel-test fuori da Windows. Evidenza
  `scratchpad/agents/s23-unplugged-baseline-night0/` + `night0-bank-audit/`.

- **2026-08-14 (sera) — 🏆 KF_PROTO_WIN: il primo kernel-candidato che
  VINCE su device.** A/B Jelly Marco1c (config campagna t2 k6 d065,
  ABBA cold 2+2 + hot + coppia identità d0, batt 84→79, pin intoccato):
  **wall −34.0% (0.318→0.210 s/tok), +51.8% tok/s, IDENTITY_D0=PASS**
  (byte identici a drop 0), win presente anche a d0 (−25.7%), stall
  −58%, e il prefetch mangia pure i page-fault dentro compute
  (0.218→0.163) — quasi saturato il tetto teorico ~36%. Divergenza a
  d065 attesa (F2): l'harness corretto l'ha classificata informativa —
  il gate vecchio avrebbe urlato un falso BROKEN. Costi: ~31% issued
  sprecato (precision 68%), J/token non misurato → cella energia prima
  di ogni promozione a default; N≥10 pre-registrato prima di ogni claim
  di ship. Contesto ops: 2 false partenze (CRLF che uccide il bash
  Termux alla riga 5 con push rc=0; Termux:API morta che finge batteria
  scarica) → 2 memorie con contromisure. In parallelo: **ship A/B S23
  partita** (PREREG 12 coppie stock-vs-certified, warm-up ok, RUNNING).
  Report: reports/moe-kernel-kf-proto.md.

- **2026-08-14 (tardo pomeriggio) — 🔧 K-F: PROTOTIPO LANDATO E BLINDATO,
  in attesa solo dello stacco fisico del Jelly.** (1) **Implementazione
  consegnata**: `--kf-prefetch` issue-only su `kalsa/kf-layer-ahead`
  (b737374 feat / 2150b56 test / dfce4e8 docs), ctest 10/10, G15
  byte-identity PASS, G15b non-vacuo (325 speculati, 27% precision host).
  NB: l'orchestratore grok aveva chiuso la sessione "aspettando il coder"
  3 min prima della consegna — staffetta ripresa a mano ~2.5h dopo.
  (2) **Review ostile (DeepSeek via opencode-go; conto deepseek diretto a
  secco, 402)**: strutturalmente sano — 4 claim contrattuali CONFIRMED,
  race/leak/lifecycle REFUTED; 3 fix pre-A/B applicati e verificati
  (b2f3509 F1 telemetria CPU worker kf esposta in RunSummary/CLI/CSV;
  c3e8fc4 F2 caveat drop + F3 changelog Unreleased). **F2 ha salvato
  l'A/B da un falso BROKEN**: con d065 (config campagna!) l'identità
  byte NON regge (residency è input di apply_drop) — harness corretto:
  coppia identità a drop 0 in coda (gate vero), divergenza d065 loggata
  come ATTESA, vecchio gate hard OUTPUT_COMPARE rimosso. (3) **Runner:
  build Android canonica ok, ma BLOCKED_PLUGGED** (Jelly 100% attaccato,
  pre-check onorato, pin mai toccato). Watcher armato: all'unplug parte
  da solo push+ABBA(7 run: 2+2+hot+coppia d0) con follow per-run.
  (4) **F1b committata da coordinatore** (2396c56, 8 file +670/−10,
  protocollo E2 anti graph-reuse col pad token, RAII k-switch); corsa
  E1/E2/E3 sul 35B ACCODATA a fine PPL arms (due 35B streaming insieme
  = thrash RAM/IO). (5) P1 mergiato su ai-chat main (47be749): stack
  TTFT ship-grade (già bancato 926958f).

- **2026-08-14 (pomeriggio) — 🏭 IL GIORNO DEL FUNNEL: sei candidati
  kernel processati, la casa nuova, e il primo bollino qualità.**
  (1) **Kernel funnel**: K-E morta (i8mm non gira mai: mmla vive solo nel
  REPACK che gli esperti streamati bypassano); K-G morta (l'1.29× GPU
  prefill era una media con cold-outlier; onesto 1.12×; boundary
  innocenti 0.068 ms/tok); **K-F VIVA** (stall 37.3% del wall derivato a
  zero minuti device; prototipo issue-only in volo sul macchinario
  route_ahead già esistente); **libreria Kalsa Kernel** costruita,
  review MERGE_WITH_FIXES(7)→10/10 chiusi (geometria CABLATA, flag
  utente vincono, CI mai verde-a-vuoto). (2) **PPL GATE_PASS k6d1.0**
  (dMacro +0.0378, worst fr +0.0877) → 5.151 t/s = config prodotto
  certificata. (3) **TTFT PREWARM_UNIVERSAL** su Xiaomi-4B post fix P0
  (1.42/2.02 s, riuso 98.9%); saga P1: REJECT (probe RSS insano su
  engine mmappato — la review ha salvato da un fix che convertiva zombie
  in crash OOM) → on-contact v2 → MERGE_WITH_FIXES(1) → fix3 in volo.
  (4) **Migrazione: BigMoeOnEdge dismesso** (direttiva gualt) →
  `kalsa-engine/` nostro + bundle storia completa, pushato su
  Aspis0/kalsa-moe-experiments previa riscrittura bare-clone della
  storia (5 blob >100MB filtrati da 159 commit, groks in volo mai
  disturbati). (5) Canale Qwen Max attivato via browser: parere
  selfspec bancato (45% rollback-corruption, bomba aritmetica
  sublinearità verify). Lezione ops: `git add -A` mai più (l'APK in
  history è costata una riscrittura); pre-push scan >90MB nel protocollo.

- **2026-08-14 (mattina) — 🏁 LANE KERNEL CPU: CHIUSA SU OGNI ASSE, il
  floor è il silicio.** Arco completo S0→S3b in ~36 ore: S0 t2 (+37% vs
  t4, gratis) → S1 pack (corretto, nullo a t2) → S2 fusione (corretta,
  bit-exact, adversarial-audited, PERF_NULL: perde dai propri overhead
  cache/barrier, non dal REPACK) → S3 Phase 0 (REPACK 8x4 delta −1.5%,
  e la scoperta che NESSUNO repacka gli esperti streamati) → S3b i8mm
  (8x8 mmla ripara l'8x4: ID t2 389 µs ×1.27 sul floor, ma token-model
  +0.2÷4.0% < gate 10%). **Tre kernel diversi misurati onestamente
  sotto soglia → 0.148 s/tok compute a t2 È il floor fisico del path
  micro-esperti su S23-class.** Il prodotto della lane: config
  **k6d10 t2 = 5.151 t/s wall (+37% dal 3.76 di partenza F1c), zero
  righe di kernel nel binario di campagna**, più un branch S1+S2+fix
  upstreamabile (fusione corretta + matcher difensivo — il perf su
  altri silici resta da vedere upstream). La lane velocità passa a
  selfspec (F1 in volo, α=0.70).

- **2026-08-14 (01:40) — 🪦 REAP-50: LOSES, e la fisica era ovvia col senno
  di poi.** Pipeline intera in una notte (fetch 9.18 GB → PRIMO convert
  safetensors→GGUF della famiglia lfm2moe → Q4_K_M 2.82 GB, sha 2d027f33 →
  cella Jelly staccato 81→78%): k4 resident **10.68** vs A0 streamed
  10.60; k3 12.20 / k2 14.23 = curva A0 identica. Residenza PERFETTA
  (majflt 0.00/tok, 688795 pagine = 100% del file in cache, hot=cold) ma
  irrilevante per il decode: **REAP dimezza gli esperti STORED (32→16),
  non gli ACTIVE (k=4 restano 4 × FFN 1792)** → stessi ~1033 MiB/token →
  stesso muro ~11 GB/s del G99. Il -42% di file compra prefill 15.9 vs
  10.0 t/s, TTFT 8.2/5.7 vs 13.3 s, load 0.90 s hot — non token/s. La
  decisione free-tier si riduce a (i) A0 10.6 vs (iii) no-LFM. Lezione di
  campagna (la seconda dello stesso tipo dopo KEXP-G99): su silicio
  bandwidth-bound contano SOLO i byte attivi per token — né i byte
  totali (REAP), né i byte freddi (KEXP) spostano il decode. Bonus:
  licenza konic taggata Apache-2.0 è FALSA (LFM v1.0 ereditata).

- **2026-08-14 (01:35) — ⚖️ KERNEL S2: CORRETTO ma PERF_NULL — e la pepita
  è nella cella di controllo.** Phase A: DETERMINISTIC_REORDER provato
  (ON==ON, OFF==OFF byte-identici; ON≠OFF stesso char — è il riordino
  REPACK previsto dalla review, zero race). Phase B (gate, S23 staccato
  86→84%): **il fuso perde contro lo stock in OGNI coppia same-t**
  (k6d10 t2: 0.1585 vs 0.148; k6d065 t2: 0.1735 vs 0.163; retry
  confermati) — su ARM il path fuso row-wise bypassa i kernel REPACK/i8mm
  e restituisce più di quanto il taglio launch compri. La fetta "dispatch
  43%" del waterfall K0 era mal attribuita. Verdetto onesto:
  **S2_PERF_NULL** (la lettera direbbe PARTIAL, 0.1585 ≤ 0.17, ma OFF è
  già a 0.148). LA PEPITA: **k6d10 stock t2 = 5.151 t/s wall — nuovo best
  Mellum2-S23** (+11% su F1e 4.638), solo config, zero kernel. Arco
  S0→S2 chiuso ONESTAMENTE: S0 (t2) l'unica leva vera, S1/S2 kernel
  corretti e auditati (full suite 16191/16191) ma perf-nulli su
  ARM-REPACK. Decisione gualt: (a) chiudere col 5.15, (b) S3
  repack-aware, (c) archivio. PPL quality gate d1.0 resta dovuto (coda
  PC). I 4 fix matcher della review in volo — il branch resta PR-able.

- **2026-08-14 (00:50) — 🎯 SELFSPEC F0: PASS_LANE_OPEN, alpha pooled
  0.6991 (n=1037, gate ≥0.60).** Run 3 completo dopo i 3 bug infra della
  serata (EOS creative, --execute, sha pin): draft k=2 / verify k=6 su
  CalaQwen, 4 categorie × 2 bracci drop (d065 + d0). Il 0.5419 visto a
  metà era la sola categoria fact in corso — il pooled chiude a ~0.70.
  Con α=0.70 e γ≤4 l'aspettativa è ~2.7-2.8 token accettati per ciclo di
  verify: la matematica dello speedup dipende dal rapporto costo k2/k6
  on-device (da misurare in F1). F1 = engine-work (loop speculativo in
  BigMoeOnEdge), non carta. PC LIBERO → coda: PPL gates Mellum drop/k
  (k6d1.0 = la config su cui punta il kernel S2), da lanciare quando la
  review adversariale finisce di usare il PC. Artefatti:
  `results/selfspec_f0/acceptance/` (8 file ckpt+csv).

- **2026-08-14 (notte fonda) — 🌙 PRIMA NOTTATA A 4 LANE: S2 STOP onesto al
  n=256, Jelly 4B chiude la scala free-tier.** (1) **Kernel S2 su S23**
  (`moe-mellum2-kernel-s2.md`): 7/7 backend-ops device + greedy n=32 PASS,
  ma il check n=256 (adottato dalla review esterna Qwen3.8-Max) becca
  **fuso ON≠OFF al char 677** — celle gate non partite, da mandato. Il
  discriminante riordino-FP vs race è ON-vs-ON ripetuto: triage + gate
  condizionale in volo (kernel-s2-gate). Unofficial t4 k8: compute
  0.204→0.179 (−12%). Nel frattempo la review DeepSeek è diventata
  EMPIRICA: si è compilata `adversarial_s2.exe` e attacca il kernel in 7
  modalità — convergenza perfetta col drift. (2) **Jelly 4B dense 3.52
  t/s** tg128 `-t 2` (ABBA, staccato 100→90%): fisica rispettata (previsto
  3.59 dal rapporto pesi 2.24×); scala G99: LFM k4 10.6 / 2B 8.04 / 4B
  3.52 — il free-tier resta 2B-classe, MAI 4B dense. Riga BLOCKED chiusa
  dal grok stesso. (3) Ops: DUE falsi-morti del watcher (wrapper pwsh
  orfanato dal self-update di grok; `ps -W` inaffidabile nel bash
  background) → watcher v3 su mtime `updates.jsonl` di sessione; lezioni
  in memoria. Selfspec run 3 ancora in corso (~item 305, 8.5 t/s PC).


- **2026-08-13 (notte, tardi) — 🔍 IL "FLAGSHIP DIMEZZATO" ERA UN ARTEFATTO
  DOZE — round t4+screen Xiaomi chiuso in 25 min** (sospetto di gualt sullo
  schermo → design 2×2 thread×screen, `results/xiaomi_t4_round/`).
  CalaQwen fact: t6 screen-ON **4.750 med** vs 2.55 campagna screen-off
  (+86%), t4 flat (4.580), sustained regge (4.392) — il collasso 4.02→2.3
  era HyperOS Doze che strozza il flash I/O (0.22→0.50 s/tok; sveglio resta
  ~0.20). Marco1c: due leve indipendenti — thread (t6 4.11 → t4 8.58,
  effetto per-modello: Marco è compute-heavy, CalaQwen flash-bound e
  thread-flat) + screen (+23%) = **t4 screen-ON 10.574 t/s, PRIMO SORPASSO
  del flagship sull'S23 (8.82)**; ginocchio t4>t5>t6. Cleanup verificato
  (timeout 60 s, perf-mode 0/0/0, pin MATCH). Da stasera: colonna
  mWakefulness nei runs.csv; question aperta se anche S23/Jelly campagna
  fossero screen-off (listini conservativi ovunque?). Nel mezzo: grok
  measurement S2 scoperto MORTO AL LANCIO dopo 4 h di "in volo" fantasma
  (watcher vede solo il report; lezione bancata in memoria: verificare PID
  a ogni check di board). Kernel S2 IMPLEMENTATO e corretto (7/7 PC,
  geometry-parameterized, branch verificati); misura S23 in attesa di
  carica (46% < 55%); review ostile DeepSeek sul diff in volo.

- **2026-08-13 (notte) — 🚢📱 DOPPIO LANDING: TTFT-v2 MERGIATO su ai-chat main
  + cella Xiaomi-Marco1c con RIBALTONE t4.** (1) **TTFT-v2**: i 3 fix della
  review (dense-restore guard, bakeRematchKey canonica persona'd, compaction
  "0"=OFF esplicito) + optionals landed in 3 commit, harness tutti verdi, diff
  auditato dal coordinatore, merge --no-ff (main c407299 → merge commit). Il
  numero che shippa: cold+90s+send = **1.40 s** (era 53.4). (2) **Xiaomi 14
  Marco1c** (`reports/lineup-card.md` + `moe-calaqwen-xiaomi.md` §perf-mode,
  staccato 72→68%): t6 med **4.101** / 51.5 MiB/tok / hit 53.5% — regime I/O
  identico a S23/Jelly alla cifra; sustained hot 6.84 (NESSUN collasso:
  temp 33-35°C, era il DONTNEED non il termico); perf-mode HyperOS
  **PERF_MODE_NULL** su CalaQwen (0.97×) ma 1.52× su Marco1c. IL DATO che
  riapre tutto: **t4 = 8.577 t/s (2.1× su t6, compute 0.048 vs 0.116)** — a
  un 3% dall'S23 (8.82), con schermo spento. La card rule "cpu_capacity≥50%
  → t6" oversubscrive SM8650. Caveat di metodo scoperto da gualt: TUTTE le
  celle Xiaomi (incluso il baseline CalaQwen 2.55) girate screen-off/Doze,
  mai documentato. Round di chiusura in volo: CalaQwen t4 (mai misurata,
  può uccidere la narrativa "flagship dimezzato"), Marco1c t4 r2, cella
  screen-ON. Lezione: il thread-count di card va autotunato per-SoC — stesso
  principio dell'autotune kernel (U t2-vs-t4 per-SoC del K0).
  layout era t=8-only; il kernel è corretto, al floor, e resta il substrato
  per S2.** (`moe-mellum2-kernel-s1.md`, branch `kalsa/kernel-s1-expert-pack`
  @ 93d78ab, llama.cpp b8a78977d)

  - Costruito il virtual tall GEMV (k esperti = un GEMV logico di k×896
    righe, mappa riga→(slice,offset), ZERO memcpy — overhead 14 µs = 6% vs
    MUL_MAT contiguo). Geometry dal tensore a runtime, fallback stock di
    default, flag `--moe-fused-gemv`.
  - Gates: NMSE 8/8 PC+S23 PASS; fused 231.6 µs a t=8 PASS (stock 598 =
    trenchcoat confermato, 2.58×); greedy n=32 token-identico PASS;
    qwen3moe 256e ON/OFF match PASS. **Gate 4 FAIL: on-model t=2 compute
    0.182 ≈ baseline 0.181.**
  - **La scienza**: a t=2 stock ID = fused = tall MUL_MAT = 421 µs — due
    thread a chunk-stealing saturano già quel GEMV. Il guadagno del pack
    esiste SOLO dove i thread abbondano (t=8). Quindi: recuperabile
    rivisto ~64%; la strada è S2 (84→28 launch = la fetta dispatch 0.097),
    e con op grasse i thread tornano scalabili — lì S1 ripaga (a t=4 già
    mangia 0.027).
  - Bonus dato: k6 d1.0 a t=2 → compute 0.159 (best mai visto su Mellum).
  - Igiene perfetta: pin campagna intatto, bins solo ~/bin/kernel_s1/,
    staccato 54→52%.

- **2026-08-13 — 📊 TTFT VERIFY su Jelly: il branch fix è un FAIL TOTALE
  (S1 cold 53.4 s, identico a prima) — ma il report consegna i colpevoli
  esatti e la mossa vincente.** (`kalsa-ttft-verify-jelly.md`, grok gualt;
  mandato v2: `mandates/kalsa-ttft-fixes-v2.md`)

  - **Bug 1 (eager init MAI partito)**: il kick a boot è dentro
    `runAfterInteractions` chiuso su deps volatili — i re-render di boot
    cancellano l'handle. `engine.eagerInit` mai apparso in logcat. I 6.6 s
    di `initLlama` restano sul tap.
  - **Bug 2 (il muro, 88%)**: restore `.kvs` su modello IBRIDO = JS
    `ok:true, 1635 tok` ma nativo `loadPrompt:462` → `n_past=0`, full
    wipe (Q6.c, stessa classe del C3 engine). 47 s di re-prefill del
    prompt system/tool (~1.4k tok a 28 tok/s su G99). Era dichiarato
    fuori scope nel mandato v1 — ed era quasi tutto il numero.
  - Keepalive: il processo viene ucciso dall'OEM in <5 min — un flag
    AppState non sopravvive alla morte del processo. Non è una fix Jelly.
  - Compaction default-ON: non arriva agli upgrade (chiave "0" residua
    della vecchia install).
  - **L'ORO**: in-process il prefix-match FUNZIONA — turno 2 riusa
    1407/1436 token, prefill 1.8 s. Quindi la v2 non aspetta Q6.c:
    **prewarm a boot del prefisso system statico** (byte-identico al
    render del messaggio 1, join se l'utente manda prima della fine) →
    messaggio 1 = delta-prefill + decode ≈ 2-4 s su Jelly, quasi zero
    su S23-class. Q6.c resta necessario solo per il cold-restore delle
    chat lunghe.

- **2026-08-13 — 🔧 KERNEL K0: GO_KERNEL, il 72% dello 0.228 s/tok è
  RECUPERABILE — e lo stage 0 è gratis (`-t 2`).**
  (`moe-mellum2-kernel-k0.md`, artefatti `results/mellum2_kernel_k0/`)

  **Il gate pre-dichiarato (≥50% recuperabile) è passato con margine.**
  Waterfall dello 0.228 s/tok (k=8, S23 staccato, campaign-flag build):
  - **GEMV puro fused: 0.023 s (10%)** — pack Q4_K a 39 GB/s, SOPRA il
    tetto campagna 25. Il GEMV non è il problema: lo 0.228 è 10× il floor.
  - **Layout/scatter mul_mat_id: 0.018 s (8%)** — ID Q4_K 557 µs ≈ 8 GEMV
    singoli in fila (571): oggi mul_mat_id è "8 GEMV in un trench", zero pack.
  - **Dispatch per-op: 0.097 s (43%)** — 84 launch MoE/token + barriere.
  - **Tax sync/scheduler t=4 vs t=2: 0.047 s (21%)** — la U dei thread:
    t1 0.205 / **t2 0.181 (best)** / t4 0.236. Il 3° e 4° thread PEGGIORANO
    (occupancy 87→72%, cpu-s 0.61→1.05, WALT→little 68.8%).
  - Dequant <2% (fuso nel vec_dot, non è leva). Attn ~0.035 stimata;
    sensibilità: perfino attn 0.050 lascia 65% — il gate non si ribalta.
  - Correzione geometria dal GGUF: down NON è Q4_K (896%256≠0) →
    Q8_0×14 + Q5_0×14, GIÀ a tetto DRAM (53.5 GB/s): non impaccarlo.

  **Design a stadi (numeri attesi, gate correttezza NMSE<5e-4 + greedy match):**
  S0 `-t 2` runtime flag → 5.5 t/s compute; S1 pack 8 esperti Q4_K in un
  MUL_MAT (556→236 µs) → 6.1; S2 UNA launch per layer (84→28) → 7-9;
  S3 placement solo a op grassa. Soffitto onesto **7-9 t/s compute**;
  il wall-clock resta flash-bound finché KEXP/k-cut non paga i 183 MiB/tok.
  Igiene: pin campagna 1ca51420… intatto, tool solo in ~/bin/kernel_k0/,
  staccato 58→55%, F1e atteso finire prima di ogni cella.

- **2026-08-13 (sera tardi) — 🏭 L'ARCO MELLUM2 F1→F1e IN UN GIORNO + la
  decisione KERNEL CPU: il muro è `mul_mat_id` (fattore ~2.5× perso), spike
  di profiling GO (gualt).** (`moe-mellum2-f1-s23.md` §F1-F1e,
  `research-mellum2-paper-tuning.md`)

  **La catena dei fatti (tutti misurati, S23 staccato):**
  - F1: arch `mellum` carica, streaming bloccato da UNA riga ricetta mancante.
  - F1b: riga aggiunta (branch `kalsa/mellum-recipe`), STREAMS_OK —
    **2.944 t/s / 185.0 MiB/tok / hit 76%** a k=8 (proiezione carta 92
    MiB/tok era sbagliata 2×: attivi pieni ~780 MiB/tok × 24% miss).
  - F1c griglia k: 2.94→3.76→4.72→5.68 (k8→k2, 1.93×); drop 0.65 a k=2
    taglia I/O ma PERDE tok/s; k=2 garbage a vista, k=4/6 coerenti.
  - F1d forense: **CEILING_REAL(mul_mat_id)** — rebuild flag-campagna
    identico (i8mm/REPACK innocenti QUI); **dense 2B sullo stesso binario =
    15.9 t/s** (build sana); WALT manda 74% dei tick Mellum sui little; pin
    sui big non alza il tetto. Il muro 4.4 t/s è la GEOMETRIA: 64
    micro-esperti (3×2304×896) = 672 micro-GEMV/token.
  - F1e (drop zona-viva 0.75/1.0 + io-two-wave): IN VOLO.
  - Paper 2605.31268 = **Mellum 2 Technical Report** (JetBrains): non è un
    paper di streaming (H100/vLLM/FP8 non trasferisce); conferma MTP
    assente dai pesi; leva k confermata (loro 1.5× su H100, noi 1.93×
    I/O-bound). Matrice di tuning completa bancata: knob mai testati =
    io-two-wave, drop 0.75/1.0 (0.65 possibile zona morta), ahwb (+17.9%
    dichiarato, leva sustained).

  **LA DECISIONE (assessment Claude, GO gualt): kernel CPU nostro per la
  classe micro-esperti.** Il caso: Mellum2 computa a 0.228 s/tok ma lo
  scaling dal dense 2B (0.063 s/tok per 1.15B attivi) predice ~0.09-0.10
  → **fattore ~2.5× perso in mul_mat_id** (micro-kernel 896-wide, sync
  per-op, WALT→little, dequant senza pack). Il kernel = GEMV batched
  per-layer (8 esperti fusi), pack SIMD al cache-insert, una sync/layer,
  hint scheduler. Paga: Mellum2-S23 (tetto 4.4→6-9), TUTTI i modelli in
  scenario RESIDENTE (iPhone Pro/flagship 12-16GB, dove compute è il collo
  — posizionamento SKU corretto: iPhone-first, NON "Mac-first", M1 Max =
  solo proxy da banco), LFM2.5 e futuri MoE micro-esperti. NON paga: Marco1c
  su S23 (è al tetto flash 453 MiB/s). **Gate pre-dichiarato: spike
  profiling 1 giorno** — spaccare 0.228 in dequant/GEMV-puro/dispatch/sync/
  migrazione; se ≥50% recuperabile → GO kernel (1-2 settimane); se è GEMV
  puro al tetto DRAM → chiuso con un numero. Weakness nota di llama.cpp
  upstream → materiale da PR se funziona.

  **Infra riparata in cascata (stesso pomeriggio):** (1) verify KEXP LFM2.5
  era un FALSO FAIL (libreria gguf restituisce tipi come int, script
  confrontava "13" vs "q5_k") — file KEXP PERFETTO, fix + rilancio, ora
  RUNNING_KEXP-PPL; (2) runner selfspec moriva su flag inesistenti
  (--flash-attn/--ngl sul bmoe-cli PC) mascherati da "timeout BMOE_READY"
  — fix + waiter rilanciato in coda corretta; (3) skip-if-done aggiunto al
  loop A0 della pipeline (mai più 6h di PPL ripagate). Mandato
  ttft-verify-jelly scritto e consegnato a gualt (matrice 6 scenari
  before/after sul branch fix/ttft-load-policy, finito).

- **2026-08-13 (sera) — 🔴 C3-RERUN COL KVFIX: FAIL — non era il binario. Il
  contratto di riuso sessione multi-turn è ROTTO sull'ibrido attn+SSM, con
  meccanismo ora identificato a 8 token di precisione.** (addendum in
  `moe-ttft-f0-jelly.md`, log `results/ttft_f0_jelly/C3_kvfix/`)

  Rebuild fresco del commit KVFIX (2c675a5) per A76 (`armv8.2-a+dotprod+
  fp16`, no i8mm, installato come `bmoe-cli-kvfix` senza toccare il pin):
  T2 `n_common=0` su entrambe le rep (prefill 163.8 s, −13% vs C2). In più
  l'agente ha verificato che il sorgente del binario di campagna aveva GIÀ
  entrambe le hunk KVFIX → l'ipotesi "binario sbagliato" è refutata anche a
  livello sorgente. G-K1 (PASS, S23, prompt corto) aveva copertura
  insufficiente.

  **La firma forense**: re-render T2 = 2033 token = T1(1980) + follow-up(53)
  — mancano ESATTAMENTE gli 8 token della risposta assistant di T1 (attesi
  1988+53=2041). Quindi due guasti impilati: (a) il commit della risposta
  assistant nella history non è byte-fedele ai token generati → il re-render
  diverge a ~1980; (b) su ibrido attn+SSM `seq_rm` non può troncare la coda
  (stato ricorrente non riavvolgibile senza checkpoint) → invece di
  n_common=1980 (~97% comunque salvo!) il motore fa WIPE totale → 0%.

  **Vie di fix (engine, in ordine di costo)**: (1) commit assistant
  byte-fedele nella history di sessione — rimuove il bisogno stesso del
  troncamento, è LA fix del contratto; (2) checkpoint dello stato SSM
  (classe patch llama.rn hybrid-restore) — pesante; (3) intanto loggare
  n_common pre-fallback (oggi il wipe è una black box). Entra nella lista
  engine-work insieme a delta-prefill API e KV handover. I P0 app NON
  aspettano (leva minuti = compaction, già giustificata da C2). Citare
  SEMPRE 0% finché una cella non misura diversamente.

- **2026-08-13 (pomeriggio) — 💪 MELLUM2 F0: STRONG 15/20 — il gate coding-SKU
  è superato, e il "ROSSO multilingua" della recon è RIBALTATO dalla misura.**
  (`moe-mellum2-f0.md`)

  Suite 20 task isolati (greedy, template ufficiale, PC `-t 4` senza pestare
  la PPL LFM2.5): **15/20 = CANDIDATE_STRONG** (gate ≥14). Per famiglia:
  fromdoc **5/5**, review bug piantati **3/3**, bugfix 6/8, refactor **1/4**
  (la famiglia debole). Lingue: EN code-explain **7/7 perfetto** (era il
  kill-gate), IT 9×2+1×1 = usabile (risponde in italiano, non madrelingua),
  ES/FR tutti 2 — il tag HF "en only" era pessimista. Speed PC idle 24.2
  tok/s (i ~10 della suite erano contesi con la PPL, non regressione).
  **Rischio prodotto individuato dai fail: diff "no-op"** (05/06: patch
  dall'aspetto valido che tocca solo il docstring e lascia il bug) — un
  merge-bot cieco la applicherebbe; il client DEVE strippare i fence e
  verificare che il patch cambi codice. Refactor locali deboli = pitch "SE
  assistant", non "agente refactor autonomo" (coerente con JetBrains).
  Appendice Metal pronta da incollare per l'M1 Max di gualt (bench + smoke,
  confronto vs 24.2 PC). Prossimo gate naturale: F1 on-device S23 col
  nostro stack streaming (12B/A2.5B, file 8.07 GB → streaming obbligatorio
  su 8 GB) — GO gualt.

- **2026-08-13 (pomeriggio) — 📉📊 DOPPIO VERDETTO: Ling 3.0 Tiny NOT_BETTER
  (watchlist, non sostituisce LFM2.5) + TTFT-F0 Jelly COMPLETO: i minuti sono
  il re-prefill a 13.8 tok/s, e il riuso KV di sessione è USCITO ROTTO (C3 =
  0% salvato).** (`research-ling3tiny.md`, `moe-ttft-f0-jelly.md`)

  **Ling 3.0 Tiny (`NOT_BETTER`)**: geometria vera da config.json 7.893B/
  ~1.14B attivi decode, 128 esperti k=8, ctx nativo 131k (262k è solo YaRN),
  MIT solo su card. Thinking ibrido SPEGNIBILE (`enable_thinking:false`) MA
  zero eval pubblicate a think-off; think-on = 51k tok/task (57 min a 15
  tok/s = kill UX). **Blocco duro: arch `bailingmoe3` NON mergiata in
  llama.cpp (PR #26608 aperta)** — non entra in fabbrica. Niente IT/ES/FR
  documentate (LFM2.5 le dichiara). Q4 4.82 GB non residente in 2.5-3 GB.
  Proiezione Jelly ~14 t/s Q4 / ~16 KEXP = stessa banda di LFM2.5 misurato
  (10.6/12.3/14.4, KEXP 14.7-18.3), non sopra. Leva KEXP più debole (esperti
  ~43% dei byte attivi vs ~70% LFM). Riapertura solo dopo merge PR + smoke
  think-off (fail-fast: GGUF piccolo su fork bailingmoe3-support). AA 25 vs
  8 NON è confronto pulito (think-on vs stima). LFM2.5 resta il cavallo.

  **TTFT-F0 Jelly (C1-C4 DONE, unplugged 69→53%, mai plugged)**:
  - C1: l'alloc KV NON è i minuti — perfino `-c 262144` (3 GiB KV) carica in
    ~5 s; load 2.35-3.75 s; l'app (16k, KV q8/q4 ~78 MiB) è nella banda 2.4 s.
  - C2: LA curva dei minuti — prefill lineare 13.8 tok/s su 2×A76: 257 tok=
    21 s, 974=73 s, 1980=**147 s**; finestra app 10-16k proiettata **12-19
    min** (l'audit stimava 8-16 con slope ottimista). C2@4000 = overflow
    n_ctx 4096, non cella mancante.
  - **C3 ROTTO: riuso 0%** — T2 con prefisso byte-identico e `--chatml` ha
    riprefillato TUTTI i 2033 token (155-180 s vs ~4-5 s attesi). H1-H4
    (flag/load/harness) REFUTATE dai log; H5 SUPPORTED: re-render non
    byte-identico a kv_tokens → `llama_memory_seq_rm` a metà prefisso può
    RIFIUTARE su questo ibrido attn+SSM → session.cpp fa wipe totale
    (`n_common=0`). Indizio chiave: **il binario Jelly `36b01966` NON è il
    KVFIX `ede3ac7c`** che passò G-K1 (preserve_thinking + empty-think).
    Supera la nota trasversale del checkpoint precedente: C3 usava --chatml,
    quindi NON è il n_common=0 del typeahead — è un guasto diverso, engine.
    **Follow-up obbligatorio: C3 re-run col binario KVFIX** prima di citare
    qualsiasi % di riuso.
  - C4 (prefisso mutato): 4007 tok / 6+ min T2 — ma SOVRASTIMA l'anti-pattern
    di un intero T1 finché C3 è rotto; costo onesto isolato ~2.5-3 min.
  - Impatto fix app: **P0-1/2/3 REGGONO senza C3** (compaction ON è la leva
    dei minuti; eager init toglie i 2-4 s di load dal critical path); la
    vittoria KV-reuse resta NON VERIFICATA su entrambi i path (bmoe-cli E
    llama.rn). C5: REPACK ha branch dotprod-only 8×4 per A76 — knob TTFT
    non gratis, serve A/B ON/OFF.
  Nota infra: i 3 agent morivano ai confini di compattazione della sessione
  (4 ondate) — root cause trovata, protocollo detached a verbale
  (`background-kills-at-compaction`). Bonus: recon privacy Grok CLI
  (`research-grok-privacy.md`) — session registry cross-host per account,
  documentato nei posti sbagliati; lockdown disponibile, non applicato
  (decisione gualt: ok così).

- **2026-08-13 (pomeriggio) — 🪦🪦 DUE IDEE, DUE DEAD (test gualt su S23,
  87→81% sempre staccato, no reboot, 35B-GPU non toccato): typeahead morto
  su un BUCO API del motore; phase-split 2B ha un soffitto carino (0.73×)
  ma irraggiungibile senza handover KV in-process.**

  1. **Typeahead (CalaQwen prefilla mentre l'utente scrive): DEAD su questo
     motore.** L'idea era prefillare solo il delta a ogni pezzo di testo;
     nella realtà ogni passo ha ricalcolato TUTTO: a 527 token
     "incrementale" = 67 s vs controllo da zero 64 s; crescere a pezzi è
     costato 3.5× un prefill unico. Causa: il riuso KV parte solo con
     `--chatml` (senza, `n_common = 0`), e anche col chat template il
     protocollo attuale manderebbe un NUOVO turno, non "sostituisci quello
     che sto scrivendo". Non è fisica: è un buco API — servirebbe un
     "rimpiazza il prompt e prefilla il delta" nel motore. Rifare lo stesso
     test è tempo buttato; riapertura SOLO con quell'API engine-side.
     (Nota trasversale: `n_common=0` senza chat template è anche l'indiziato
     naturale del C3=0% riuso visto su TTFT-F0 Jelly — da verificare nel
     report in scrittura.)
  2. **2B phase-split (prefill GPU + decode CPU): soffitto reale, turno
     reale NO.** Turno onesto 490 tok prompt + 128 decode: tutto-CPU
     28.3 s; tutto-GPU 29.2 s (peggio); GPU-prefill + CPU-decode SE il KV
     si passasse = 20.6 s (0.73×, il soffitto); quello realizzabile oggi
     (due processi) = 36.0 s (1.27×, peggio). Il dividendo esiste solo con
     handover KV dentro UN processo (switch di backend a runtime) — lavoro
     engine, non flag. Lane parcheggiata con la stessa etichetta del resto
     del cantiere GPU-A7X: riapre su engine-work, non su altri run.

- **2026-08-13 (mattina) — ⚖️ K4 CHIUSO: lo split è CORRETTO ma PIÙ LENTO su
  ogni asse sul 740 — N3 FAIL (decode 0.698×, TTFT 0.59×), N4 skippata.
  Il primato resta di meccanica e correttezza, non di velocità.**

  N3 (ABBA 2 prompt, staccato 100%, guardia MemAvailable dopo il false-kill
  MemFree — post-mortem `k4_n3_false_ram_kill.md`): decode mediano split
  2.02 vs CPU 2.90; TTFT 30.4 vs 17.8 s (il load raddoppia: re-upload dei
  dense a ogni cold start); prefill ~pari (9.5 vs 9.9 — il vantaggio
  dense-GPU visto sui densi 2B/4B NON trasferisce al MoE streamato: il
  prefill è dominato dal GEMM esperti su CPU); hit/MiB ~uguali. Gate
  pre-dichiarato FAIL → N4 skip automatico. **Lane velocità split su A7X:
  CHIUSA per misura.** Asset bancati: stack correttezza GDN+split+pin
  router, residency kernel nel parent, flag prodotto `--moe-cpu-experts`,
  e il primato documentato (mai pubblicato da nessuno: 35B MoE streamato
  con tronco GPU su telefono, output byte-identico). Riaperture plausibili:
  830+/subgroup veri, o fused-executor (mesi) — parcheggiate salvo bisogno
  prodotto. Nota metodo: 2 false-kill di guardie in 2 notti (waiter 15s,
  MemFree) — la regola nuova a verbale: le guardie RAM leggono
  MemAvailable, mai MemFree sotto page-cache pressure.

- **2026-08-13 (alba) — 🌍 LA NOTTE DELLO SPLIT: il 35B streamato da flash
  gira con TRONCO SU GPU ed esperti su CPU su un telefono da 8 GB, hook
  vivo, output BYTE-IDENTICO al CPU (dopo il pin del router). Il primo
  sistema del genere che si conosca. Manca solo il verdetto velocità
  (N3/N4 armati sullo stacco).**

  Arco completo (workflow notturno di gualt + 3 task di completamento):
  1. **N0** (workflow gualt): il fork esprime già lo split SENZA patch a
     llama.cpp — esperti Q2/Q3 → `supports_op` false → CPU+hook; pin
     prodotto `--moe-cpu-experts` nel parent (@ 8958cdf). Build Android OK.
  2. **N1 PASS**: KEXP carica con 40 layer su GPU, esperti pinnati CPU,
     82 split, hook vivo — MA solo a **cache 1000 `--force-cache`**
     (ram-guard rifiuta 2000/1500; transiente MemFree 14-90 MiB in alloc
     OpenCL, poi 3-4 GiB dopo anon-drop). Costo regime: hit ~44% vs 80%.
  3. **N2 FAIL → N2b CONFIRMED → PASS col pin**: la divergenza testo era
     il ROUTER MoE su OpenCL (flip di selezione esperti su pareggi ~1e-6);
     `--override-tensor ffn_gate_inp.weight=CPU` → greedy **byte-identico**
     (sha match), hook 43.7 vs 44.0. I dense 2B/4B erano identici perché
     senza router. Patch prodotto 5 righe pronta, non applicata.
     Residuo onesto: l'hidden che entra nel router viene dal trunk GPU
     (softmax può muoversi di epsilon senza flippare il greedy).
  4. **N3/N4 armati** (waiter sullo stacco, batt ≥45%): burst ABBA con pin
     → se ≥1.10× decode o TTFT ≥1.5×, maratona sostenuta automatica.
  Nella stessa notte: curva prefill 750 completa (GPU 5.2×→7.6× che CRESCE
  con la lunghezza, 4B pp2048 86.2 vs 11.3), maratona 4B (CPU sostenuto
  vince 0.80×, legge confermata), Task B CalaQwen-flagship in corso su
  Xiaomi, MarcoKEXP gates + LFM2.5-KEXP pipeline sul PC, pulizia disco
  −82 GB. Report: `moe-k4-split.md` (in completamento con N3/N4).

- **2026-08-12 (notte fonda) — 🔒 750 CHIUSO: decode gate FAIL 0.44× (predizione
  recon CONFERMATA) — ma prefill GPU 5.77×: il dividendo GPU su A7X è il TTFT,
  ed è GRANDE.** (`moe-gdn-750.md` completo)

  Xiaomi 14 staccato, 100%: CPU tg 16.15 / GPU 7.07 (0.44×, muro A7X identico
  al 740); CPU pp 31.5 / **GPU pp 181.7 (5.77×!)** — sul 740 era 2.2×. Il 750
  ha muscolo GEMM ma non banda/dispatch per il decode. Correttezza già tutta
  PASS (incl. flat q6_K: il bug del 740 è del compiler E031.41). **Strategia
  GPU su A7X definitiva: decode morto su entrambe le gen (per misura), prefill
  vivo e grosso su entrambe → la leva prodotto è il TTFT (phase-scheduling /
  K4-split trunk-prefill su GPU)**. Nella stessa notte: maratona 2B (CPU vince
  sostenuto 10.2 vs 8.2, GPU piatta e fredda), maratona 4B in corso, pista G99
  LFM2.5 viva (14.4 a k=2, proiezione KEXP 15-20), Fase 2 requant Marco in
  corso (Grok#2), mandato K4-split notturno consegnato a gualt.

- **2026-08-12 (notte) — 🏆 FASE 1 MARCO: CHIUSA CON PASS PIENO — qualità
  3/3 full multi5 + speed entrambe le leve. Il transfer runtime della
  config di campagna su Marco è UFFICIALE: k/drop funzionano su qwen3moe
  senza requant.**

  | cella | ΔMacro bpb | peggior lingua | gate |
  |---|---|---|---|
  | A1 k8d065 | **+0.0040** | zh +0.008 | PASS |
  | A3 k6d050 | +0.0095 | zh +0.018 | PASS |
  | A2 k6d065 | +0.0182 | zh +0.033 | PASS |

  Letture: (1) il drop 0.65 a k=8 è quasi GRATIS in qualità — la penalità
  vera è del k ridotto, non del drop (coerente con l'audit "il drop non
  salta il matmul": toglie I/O, non calcolo); (2) zh è sempre la lingua
  più sensibile; (3) con lo speed gate di stamattina (A2 1.303×, −34.4%
  MiB/tok) il PROTOCOL dichiara il transfer SUFFICIENTE. Decisioni a
  gualt: cella prodotto (A2 misurata vs A3 conservativa) e GO Fase 2
  MarcoKEXP per il regime I/O (gap 4× MiB/tok e +44pt hit vs KEXP).
  Nota di processo: il run PC è sopravvissuto a uno shutdown notturno
  (resume idempotente) e ha macinato ~19 ore totali su 3 celle × 5 lingue.

- **2026-08-12 (sera) — 🧭 RECON 750: la speranza "sul 750 i subgroup ci
  sono" era FALSA — il 750 è A7X come il 740, broadcast=false anche lì.
  Il primo telefono con la feature è l'Adreno 830 (8 Elite). E LiteRT
  dimostra che si può vincere sul 750 SENZA subgroups: la via è il port
  delle tecniche ML Drift.** (`research-adreno750.md`, fonti primarie)

  1. **Il fatto che ribalta lo scoping**: driver telefonici Adreno 750
     (compiler E031.45.02.16) riportano `vector subgroup broadcast: false`
     — stessa lacuna del 740; flash-attn è declinata su TUTTA la A7X
     (SIGSEGV clBuildProgram, PR #26430); le ottimizzazioni K-quant 2026
     escludono esplicitamente A7X (regredisce, PR #26477). Primo driver
     col broadcast: 830/E031.47 (8 Elite, S25-class — device che NON
     abbiamo in lab).
  2. **Predizione per il nostro gate 750 (Q4_K_M, fork): LIKELY_FAIL** —
     740 misurato 0.56-0.74×; 750 = stessa arch + CPU più veloce; scaling
     generoso → 0.93-1.04×. Il test Xiaomi resta utile come conferma da
     10 min, ma non è più la speranza: è il controllo della predizione.
  3. **Il dato che tiene viva la GPU su A7X**: LiteRT (kernel
     subgroup-FREE) fa **1.43× a 3.8B PROPRIO sul 750** (Phi-4-mini S24U:
     GPU 10.39 vs CPU 7.28) e pareggia a 1.5B. Tradotto: sul silicio A7X
     si vince a 4B-class, ma solo con kernel stile ML Drift — che nel
     fork non esistono. **Il port delle tecniche (paper CC-BY + reference
     Apache) diventa L'UNICA via GPU per l'installed base 740+750**, non
     un'opzione tra due.
  4. **Primato confermato dalla ricerca**: nessun numero pubblicato di
     ibrido GDN corretto su GPU di telefono — il nostro E2E sul 740
     resta, a oggi, il primo conosciuto. (Vicini: Qualcomm su laptop
     X2-90; LiteRT 0.8B CPU-only; MLC su S24U senza numeri e throttled.)
  5. Nota 830: coi subgroups veri e LiteRT Qwen3-4B a 19 t/s su S25+,
     l'8 Elite è il primo TOSS_UP onesto per il path llama.cpp — ma
     richiede hardware che non possediamo (opzione da valutare: device
     830 fisico o remote lab).

- **2026-08-12 (pomeriggio) — 🔧 IL POMERIGGIO DEL FIX: K2.1 → K2.2 →
  review ostile → K2.2b → probe build CPU. Primo E2E ibrido GDN CORRETTO
  su GPU mobile (che si sappia); il 740 perde comunque il decode; e il
  probe CPU trova un tradeoff che tocca l'app Kalsa.**

  1. **K2.1** (`moe-gdn-k21-parity.md`): il garbage GPU non era GDN — era
     il kernel flat Q6_K (NMSE ~12 sul 740) che si rubava l'lm_head tied
     via redirect large-M. Bisezione ngl + isolamento `-ot`: chirurgico.
  2. **K2.2** (`moe-gdn-k22-fix.md`, branch `kalsa/opencl-q6k-dispatch-fix`):
     redirect spento quando noshuffle è legale → greedy GPU token-identico
     al CPU. **Primo numero onesto 740: tg GPU 0.41× → poi 0.56× col build
     CPU giusto. Lane decode-740 chiusa per misura.** Prefill GPU 1.29×.
  3. **Review ostile DeepSeek** (`results/gdn_gpu_k22/review_hostile.md`):
     fix corretto, zero blocker; 3 chiusure → **K2.2b @ 04c5d362a**: path
     n≥32 validato (case n=64 + greedy 62-token identico), commento falso
     corretto, twin Q4_K sistemato. Diagnostica: flat Q4_K NON rotto sul
     740 (solo Q6_K). GDN family sempre zero FAIL.
  4. **Probe build CPU** (`moe-cpu-build-gap.md`): il −46% del nostro build
     era **GGML_CPU_REPACK=ON** (pp ×2 MA tg −33% su questo device) +
     binario non-strippato (-g, 125 MB → tg −16%). Fix: REPACK=OFF + strip
     → tg 18.19 ≈ build-safe. ⚠ **ACTION ITEM prodotto: verificare i flag
     di build di llama.rn nell'app — se ha repack ON, il prodotto perde
     ~33% di decode.** Il GPU è raddoppiato pure lui col build giusto
     (5.06→10.25).
  5. Nota storica: con K2.2 siamo (a quanto risulta) i primi con un ibrido
     Gated DeltaNet end-to-end corretto su GPU mobile — LiteRT è CPU-only
     sugli ibridi, upstream aveva i kernel ma l'E2E era rotto. Sul 740 è
     corretto-ma-lento; il verdetto velocità vero è del 750 (Xiaomi,
     attesa gualt). In volo: recon riusabilità kernel Google (ML Drift).

- **2026-08-12 — ⚗️ K2 E2E: il kernel GDN è CORRETTO perfino sul 740 —
  a rompersi è tutto il resto. S23 = FAIL_CORRECTNESS (flash-attn non
  compila sul driver senza subgroup; -fa off degenerato e 0.27×);
  MUL_MAT_ID Q4_K con 73 FAIL numerici = kernel MoE Adreno del pin
  ROTTO. Xiaomi 750 non in LAN: il verdetto sulla famiglia target è
  rinviato a un'accensione fisica.**

  Report `moe-gdn-k2-e2e.md`, artefatti `results/gdn_gpu_k2/` (build
  manifest con sha, log test per op, bench JSON, battery notes; binari
  Android fuori da git). Fatti chiave: (1) build fork Android OpenCL
  riproducibile (NDK r27b, -j4, zero modifiche sorgente); (2)
  `GATED_DELTA_NET` 36/36 PASS su 740 incl. head 128 — il cuore ibrido
  su GPU È GIUSTO anche dove il driver è peggiore; (3) il muro 740 è
  flash-attn (`sub_group_shuffle_xor` assente) + una parità E2E rotta
  nel path -fa off; (4) `MUL_MAT_ID` Q4_K numericamente sbagliato →
  la regola "esperti 35B su CPU" ora ha DUE ragioni (hook streaming +
  correttezza kernel); (5) Xiaomi assente dal mdns → K2-bis su 750
  quando gualt lo accende. Disciplina: unplugged 90→80%, mai >36°C.

- **2026-08-12 — 🏁 SPEED GATE MARCO FASE 1: PASS SU ENTRAMBE LE LEVE
  (S23, staccato, cold fadvise, ABBA 2 prompt, 16 run; batt 100→92,
  temp max 39.1°C; niente SESSION_SLOW — l'anomalia 3-4× della
  fix-session NON si è ripresentata).**

  | cella | decode med | MiB/tok | hit% | TTFT |
  |---|---|---|---|---|
  | A0 (k8, no drop) | 4.122 | 192.5 | 33.5 | 13.6 |
  | **A2 (k6d065)** | **5.371** | **126.2** | 36.7 | 12.6 |
  | KEXP k6d065 (stessa sessione) | 5.696 | **30.7** | **80.7** | 19.0 |

  Gate pre-dichiarati: decode **1.303×** (≥1.15 PASS) e MiB/tok **−34.4%**
  (≤−20% PASS). Hit solo +3.2 pt: la config di campagna trasferisce su
  Marco come velocità, NON come regime di cache — gli esperti Q4_K di
  Marco (~3× i byte dei Q2/Q3 KEXP) non ci stanno in cache 2000. Il
  confronto stesso-device quantifica il premio della Fase 2 MarcoKEXP:
  4× MiB/tok e +44 pt hit di distanza. Bonus: KEXP 5.70 ≈ scheda 5.86 →
  sessione sana. Con la qualità full multi5 in arrivo dal PC, Fase 1 è
  a un passo dalla chiusura completa. Artefatti:
  `results/marco_phase1/speed_s23/` (CSV 16 righe, note, log per run).

- **2026-08-12 — 🎁 K0 CONSEGNA UN RIBALTONE: i kernel GDN che volevamo
  scrivere ESISTONO GIÀ nel nostro pin. Il cantiere passa da "scrivere
  kernel" a "verificare e integrare". E S_v=128 su tutti e tre i modelli:
  il gate GPU è già aperto.**

  Report: `moe-gdn-k0-op-inventory.md` (DeepSeek sul checkout
  `BigMoeOnEdge/third_party/llama.cpp`, pin 5236140e5 + 3 commit fork;
  ogni claim con file:line). Nota di processo: prima run impiccata a 5 min
  (CLI hung, sessione preservata), recuperata con follow-up sulla stessa
  sessione via opencode-go — zero lavoro perso.

  1. **Upstream ci ha preceduto** (e il claim K2 del 3/8 era stale):
     `GGML_OP_GATED_DELTA_NET` (kernel `gated_delta_net.cl`, S_v gate
     {16,32,64,128}) e `SSM_CONV` sono NEL pin; e ci sono i kernel MoE
     Adreno `gemm/gemv_moe_q4_k/q5_k/q6_k` per `MUL_MAT_ID`. La lezione
     "verifica online prima di agire" colpisce ancora: 5 mesi di upstream
     hanno chiuso il gap che stavamo per scavare a mano.
  2. **Verifica GGUF (coordinatore, 2026-08-12)**: ssm.state_size=128,
     conv_kernel=4, dk/dv=256 su Qwen3.5-2B, 4B e KEXP 35B → G1 e G5
     VERDI. Gap veri residui: GET_ROWS su embedding quantizzato (CPU,
     piccolo) e le euristiche Adreno MoE (nomi tensori, ne01%32).
  3. **La LANDMINE Q7**: l'`expert-ready hook` dello streaming engine
     (commit fork 5236140e5) vive SOLO nel loop CPU di `mul_mat_id` —
     se il MoE andasse su GPU il prefetch/blocking dell'engine è bypassato.
     Design obbligato per il 35B: **esperti su CPU (hook intatto),
     GDN+attn+dense su GPU**; boundary per token = attivazioni FFN
     (~KB-scala) se il GDN resta su GPU, tens-of-MB se cadesse su CPU.
  4. **Dense 2B/4B: nessun MoE → grafo interamente GPU-abile OGGI** col
     backend del fork. K2 diventa: build OpenCL Android + E2E fail-fast
     su S23 (740, dove K5 va ri-testato coi kernel Adreno nuovi del pin)
     e Xiaomi 14 (750). Il gate resta ≥1.15× vs CPU, staccato.

- **2026-08-12 — 🔨 DECISIONE: CANTIERE GDN-GPU APERTO (mandato gualt).
  Niente downgrade a Qwen3 per il free tier ("generazioni indietro, e i 3.8
  sono in arrivo"): i kernel GDN/SSM OpenCL li scriviamo NOI nel fork.
  Ruoli dichiarati: Claude design, Grok codice.**

  Razionale: il muro GDN-su-GPU è cross-stack (recon #61) — quindi
  scriverli nel NOSTRO stack (llama.cpp fork) è l'unica via che tiene i
  pesi Qwen3.5 (e domani 3.8) su GPU, conserva i K-quants e un solo
  engine llama.rn, e sblocca free E CalaQwen insieme. La velocità dei
  free è dichiarata priorità di prodotto (funnel dei pro). Fasi K0-K4
  gated (v. riga Aperto): K0 inventario op dal sorgente (in volo),
  K1 design, K2 kernel+unit test, K3 E2E 2B su S23 gate ≥1.15×,
  K4 4B/750/CalaQwen. Regole ereditate: no-subgroup baseline per il 740
  (recipe adreno-llms, riduzioni in local memory), INT8 non INT4 (HAQA),
  la misura on-device decide ogni promozione di fase.

- **2026-08-12 — 🔎 RECON PORTING LITERT (Grok web, `research-litert-porting.md`):
  il blocco GPU del free tier ha un NOME, ed è lo stesso del 35B — Gated
  DeltaNet. E il "CPU-only" del nostro import 4B era un artefatto rotto,
  non un limite dello stack.**

  1. **Scoperta architetturale**: Qwen3.5-2B/4B NON sono "Qwen3 più addestrato"
     — sono **ibridi GDN + full-attention** (`Qwen3_5ForCausalLM`), stessa
     famiglia del nostro 35B. `export_hf` non li supporta; l'unico ibrido
     first-party (litert-community Qwen3.5-0.8B, litert-lm ≥0.15) è
     **CPU-only: la GPU fallisce la full delegation sugli op GDN**. È il K2
     di LiteRT: il muro GDN-su-GPU è TRASVERSALE agli stack (llama.cpp
     OpenCL E LiteRT). Corollario strategico: chi scrive i kernel GDN una
     volta sblocca free 3.5 dense E CalaQwen ibrido, ovunque.
  2. **Qwen3-4B (non ibrido) è GPU-capable OGGI**: bundle ufficiale
     `mixed_int4` con numeri OpenCL pubblicati (S25-class decode 19.1;
     **Mali G615 10.9** — LiteRT copre anche MediaTek, cosa che il kernel
     nostro Adreno-only non farà mai). Il nostro import "CPU-only" del twin
     era quindi un file rotto/mismatch di runtime (cause tabulari nel
     report; issue #1136: DIY export 16% delegato vs 100% ufficiale).
  3. **Bivio prodotto dichiarato** (decisione gualt): (1) free tier su
     **Qwen3-4B litert** → GPU subito, spike 1 giorno zero-conversioni
     (re-download ufficiale sha-verified, Gallery + litert-lm CLI su S23,
     misura vs CPU 8.38) + quality gate vs 3.5; (2) restare Qwen3.5 →
     llama.rn CPU finché non esistono kernel GDN. RN: LiteRT-LM Kotlin
     stable, wrapper community, MediaPipe legacy; 1-3 settimane + hardening.
  4. Logistica conversioni (se mai servisse la via B): Linux ≥64 GB RAM,
     litert-lm-builder per bundle completi (spiega il nostro storico
     `TF_LITE_PREFILL_DECODE not found` = pack incompleto); qualità: nessun
     bake-off pubblico int4/int8 litert vs K-quants → serve gate nostro.

- **2026-08-12 — 🧱 TWIN CLASSI PRODOTTO (Grok su S23, unplugged, batt 57→53):
  la via zero-fork per il numero GPU 2B/4B è ESAURITA — Gallery non può
  darlo. Twin CPU misurati e curva completata.**

  1. **2B-GPU BLOCKED**: non esiste bundle `.litertlm` ufficiale ~2B Qwen
     (litert-community ha 0.5/0.6/1.5/4B); l'import non ufficiale resta
     rigettato (LTLM magic). Niente rabbit-hole conversioni, da mandato.
  2. **4B-GPU NO GPU OPTION**: `qwen3_4b_mixed_int4.litertlm` (2.7 GB,
     importato) espone SOLO CPU come accelerator in Gallery 1.0.18 — il
     chip GPU proprio non appare. Wall Gallery CPU 5.3-5.7 tok/s; nota a
     margine: llama-bench CPU fa 8.38 → **llama.cpp CPU batte LiteRT CPU
     sul 4B**.
  3. **Twin CPU (llama-bench `-t 4`, tg256, sha verificati)**: Qwen3.5-2B
     Q4_K_M **18.10** (pp128 44.13); Qwen3.5-4B Q4_K_M **8.38** (pp128
     16.91). Curva CPU per taglia: 1.5B 25.8 → 2B 18.1 → 3B-class 9.7 →
     4B 8.38. Conferma dove il CPU crolla: esattamente sulla classe del
     modello prodotto Kalsa.
  4. **Lettura di gate**: il criterio pre-dichiarato (GPU ≥1.15× same-class)
     non è verificabile né falsificabile coi bundle DI CATALOGO. L'evidenza
     pro resta per proxy (Gemma E2B 2.76×; ML Drift 26.8 su Llama-3B vs
     nostro CPU 8.38 sul 4B ≈ 2-3× potenziale). **[CORREZIONE stessa
     giornata, stop di gualt]**: la prima stesura diceva "via zero-fork
     esaurita" — FALSO: resta il **porting in proprio** (conversione
     ai-edge-torch di Qwen3.5-2B/4B + bundling litert-lm GPU-enabled), che
     dà il numero mancante senza scrivere kernel. Direttiva prodotto
     dichiarata: i free (2B/4B) DEVONO essere veloci — sono il funnel dei
     pro. Recon feasibility affidata a Grok (web); F3-fork resta la pista
     alternativa se il porting non è percorribile.
  Artefatti: `results/litert_product/` (bench JSON, dump a11y, battery
  notes), report `moe-litert-product-classes.md`. Disciplina rispettata:
  sempre staccato, mai <30% batt, mai ≥45°C.

