# Research — LLM decode su Adreno 740/7xx con kernel custom (senza path Qualcomm “nuovo”)

**Data ricerca:** 2026-08-11  
**Mandato:** `mandates/research-adreno740-custom.md`  
**Scope:** SOLO ricerca web (+ lettura read-only del contesto locale già noto). Zero codice, zero telefono, zero build.  
**Device di campagna:** Galaxy S23, Snapdragon 8 Gen 2, Adreno 740, 8 GB, OpenCL driver **0676.73** (subgroup broadcast = false).  
**Domanda decisiva:** esiste un caso **misurato** in cui, su Adreno 7xx / 8 Gen 2, il **decode** (tg, non prefill) di un LLM ≥1B batte la **CPU dello stesso SoC** con kernel diversi da quelli “Adreno-ottimizzati ma subgroup-dipendenti” di llama.cpp OpenCL?

Legenda claim: **[V]** = fonte primaria (paper/repo/issue con hardware identificato, URL+data); **[S]** = stima/proxy cross-source; **NON TROVATO** se manca evidenza.

---

## Contesto che teniamo fermo (già noto in campagna)

Da `reports/research-adreno-opencl.md` e discussion **ggml-org/llama.cpp #22791** (2026, Galaxy S23 SM-S911B, Adreno 740, driver OpenCL 0676.73, build b9071): **[V]**

| Modello | Backend | pp512 (t/s) | **tg128 (t/s)** |
|---------|---------|-------------|-----------------|
| Llama 3.2 3B Q4_K_M | CPU 6 thr | 30.5 | **9.8** |
| stesso | OpenCL -ngl 99 | 14.5 | **5.9** |
| Qwen 3.5 2B Q4_K_M (GDN) | CPU | 25.6 | **14.6** |
| stesso | OpenCL | 42.8 | **10.8** |

Log: `vector subgroup broadcast support: false` → path GEMM Adreno-ottimizzato di llama.cpp degrada.  
**Decode OpenCL < CPU** su entrambi i modelli. Il subgroup broadcast è un **requisito del kernel llama.cpp**, non del silicio.  
Fonte: <https://github.com/ggml-org/llama.cpp/discussions/22791>

---

## Pista 1 — MLC-LLM / TVM

### Cosa fa
MLC-LLM (TVM Relax) genera e autotuna kernel OpenCL per Adreno; quant tipica community/Qualcomm: **q4f16_0**. Contributi Qualcomm GRT Bangalore (IWOCL 2025). Tecniche dichiarate: schedule Adreno-aware, BYOC/OpenCLML offload per layer critici (in progress), zero-copy/mmap del KV cache da oggetti OpenCL. **[V]**

### Numeri DECODE su Adreno 7xx / 8 Gen 2
| Device / GPU | Modello | Decode (tok/s) | Prefill/encode | Fonte |
|--------------|---------|----------------|----------------|-------|
| **Adreno 740 esplicito** | — | **NON TROVATO** (tabella IWOCL 2025: solo 8 Gen 3 e 8 Elite) | — | IWOCL 2025 PDF |
| Snapdragon **8 Gen 3** (Adreno 750 class) | gemma-2b-it | **14.77** | 244.7 tok/s encode@256 | IWOCL 2025 |
| 8 Gen 3 | Phi-3-mini-4k | **22.6** | 145.5 | IWOCL 2025 |
| 8 Gen 3 | Meta-Llama-3-8B | **11.1** | 80.5 | IWOCL 2025 |
| 8 Gen 3 | DeepSeek-R1-Distill-Qwen-1.5B | **22.2** | 232 | IWOCL 2025 |
| Arm Mali (Vivo X100) Llama3.2 3B | MLC q4f16 | prefill 89.2 / decode **11.2** (citato in ML Drift come baseline, non Adreno) | — | arXiv:2505.00232 |

Fonte IWOCL 2025: <https://www.iwocl.org/wp-content/uploads/iwocl-2025-siva-rama-krishna-reddy-b-deep-learning.pdf> (crawl 2026-08-11)

### vs CPU stesso SoC
**NON TROVATO** in IWOCL 2025 (solo numeri GPU).  
Studio COTS mobile (arXiv:2410.03613, aggiornamenti 2025–2026): su GPU MLC-LLM, *“the decode speed on the GPU is quite similar to that on the CPU”*; prefill sì 3–4×. Su Snapdragon **8+ Gen 1** (Adreno 730), Llama3.2-3B ≈ **4× prefill**, decode non rivendicato come win. **[V]**  
<https://arxiv.org/html/2410.03613v2>

Paper MNN-LLM (arXiv:2506.10443, Xiaomi 14 = 8 Gen 3): per Qwen2-1.5B, MLC-LLM GPU decode ≈ **25 / 19.5 / 11.9** tok/s (prompt 64/256/1024) — confrontabile con MNN GPU, **sotto** MNN CPU (~53). **[V]**

### Driver / tecnica / licenza / porting
| Campo | Valore |
|-------|--------|
| Driver | OpenCL system (stesso stack Samsung/QC; nessuna claim su subgroup broadcast) |
| Tecnica | TVM autotune + schedule Adreno, texture/buffer layouts, quant q4f16 |
| Licenza | Apache-2.0 (mlc-ai/mlc-llm, Apache TVM) |
| Porting verso noi | **Altissimo** — runtime diverso da llama.cpp; non riusa i nostri GGUF MoE streaming BigMoeOnEdge. Costo = riscrivere campagna su MLC o esportare subgraph, non un patch kernel. Policy AGENTS: fork locale se si tocca llama; qui si esce dallo stack. |

### Verdetto pista 1
Kernel custom **esistono** e girano su Adreno 7xx-class. **Decode su 740: NON TROVATO.** Su 750/8 Gen 3 decode assoluto ok (11–23 tok/s su 1.5–8B) ma **non** c’è prova controllata GPU > CPU decode; le fonti più oneste dicono decode ≈ CPU.

---

## Pista 2 — ML Drift (arXiv:2505.00232, Google LiteRT GPU)

### Cosa fa
Framework GPU (estensione del lineage TFLite GPU / LiteRT “ML Drift”): **tensor virtualization** (logical tensor ↔ texture/buffer multipli), coordinate translation a codegen, layout 4-channel (PHWC4-like), weight layout OHWI riorganizzati, **stage-aware** (prefill = conv/int8 path; decode = FC fused quant-in-kernel), operator fusion, KV cache layout conv-compatibile. Backend primario Android: **OpenCL**. **Non** dipende dal path “subgroup broadcast” di llama.cpp. **[V]**  
Paper: <https://arxiv.org/abs/2505.00232> (1 May 2025); PDF estratto 2026-08-11.

### Numeri DECODE su **Adreno 740** (S23 Ultra 8 GB) — Table 2 paper **[V]**

| Modello | Quant ML Drift | Prefill (tok/s) | **Decode (tok/s)** |
|---------|----------------|-----------------|---------------------|
| Gemma 2B | q8 | 1120 | **20.4** |
| Gemma 2B | **8/4/4** (int8 attn, int4 emb/FFN) | 1150 | **38.1** |
| Gemma2 2B | q8 | 1010 | **18.3** |
| Gemma2 2B | 8/4/4 | 1040 | **32.4** |
| **Llama 3.2 3B** | q8 | 720 | **15.4** |
| **Llama 3.2 3B** | **8/4/4** | 741 | **26.8** |
| Llama 3.1 8B | q8 | — | **OOM** |
| Llama 3.1 8B | 8/4/4 | 325 | **10.7** |

Contesto bench: 1024 prefill + 256 gen, no speculative, no flash-attn, sync CPU/GPU per token. Device: Samsung **S23 Ultra**, Adreno **740**, 8 GB.

### vs CPU stesso SoC
Il paper **non** pubblica una colonna CPU sul 740. Confronta con **altri engine GPU** (llama.cpp bench tool, MLC Chat) su Adreno 830 e con Qualcomm AI Hub (+29% generation su Llama 3.2 3B 8/4/4). **[V]**

**Proxy cross-source [S]** (stesso silicio Adreno 740 / 8 Gen 2, device affini S23 vs S23 Ultra):

| Stack | Device | Modello | Decode |
|-------|--------|---------|--------|
| ML Drift OpenCL | S23 Ultra 740 | Llama 3.2 3B 8/4/4 | **26.8** **[V]** |
| llama.cpp CPU | S23 740 (#22791) | Llama 3.2 3B Q4_K_M | **9.8** **[V]** |
| llama.cpp OpenCL | S23 740 (#22791) | stesso | **5.9** **[V]** |

→ ML Drift GPU è **~2.7×** il CPU llama.cpp e **~4.5×** l’OpenCL llama.cpp, ma quant (8/4/4 vs Q4_K_M) e runtime differiscono: **non è un A/B controllato**. Resta la **migliore evidenza pubblica** che kernel diversi sbloccano decode assoluto alto sul 740.

### Driver / tecnica / licenza / porting
| Campo | Valore |
|-------|--------|
| Driver | OpenCL di sistema (paper non logga 0676.73; S23 Ultra stock) |
| Tecnica | Texture/buffer 4-ch, tensor virtualization, stage-aware GEMM/FC, weight layout G·S_O·O4·…, **no** dipendenza dichiarata da subgroup broadcast |
| Licenza | LiteRT / LiteRT-LM Apache-2.0 (github.com/google-ai-edge/LiteRT, LiteRT-LM). Completeness del source dei kernel GPU: issue community su open-sourcing kernel (2026) — runtime sì; verificare snapshot kernel se si vuole fork |
| Porting verso noi | **Estremo** se si vuole *dentro* llama.cpp (riscrivere MUL_MAT Adreno senza subgroup + layout pesi). **Medio-alto** se si abbandona llama per LiteRT-LM (perde streaming MoE BigMoe, GGUF path, hybrid GDN). Policy AGENTS = fork locale llama se si patchano kernel. |

### Verdetto pista 2
**Migliore pista.** Decode ≥1B su Adreno 740 **misurato e alto**. GPU > CPU **plausibile e forte via proxy**, non certificato same-bench. Dimostra che il collo non è “il 740 non sa fare decode”, ma “il kernel sbagliato / il feature flag sbagliato”.

---

## Pista 3 — MNN / MNN-LLM (Alibaba)

### Cosa fa
MNN + MNN-LLM: backend OpenCL mobile, loop tiling hardware-driven, reorder dati, quant mista, DRAM-Flash hybrid per embedding. Apache-2.0. **[V]**  
Paper: <https://arxiv.org/abs/2506.10443> (2025).

### Numeri DECODE — **non 740**; Xiaomi 14 = **Snapdragon 8 Gen 3 / Adreno 750** **[V]**

Dalla Figure 5 (prompt 64 / 256 / 1024), valori estratti dal PDF:

| Modello | Device path | MNN-LLM | llama.cpp | MLC-LLM |
|---------|-------------|---------|-----------|---------|
| Qwen2-1.5B | **CPU** 4 thr | **53.6 / 52.5 / 45.7** | 30.1 / 26.4 / 22.1 | 9.3 / 8.7 / 6.5 |
| Qwen2-1.5B | **GPU OpenCL** | **26.9 / 26.3 / 20.9** | 4.4 / 4.3 / 3.3 | 25.0 / 19.5 / 11.9 |
| Qwen2-7B | CPU | 13.0 / 11.8 / 10.1 | 6.4 / 5.9 / 4.3 | 1.6 / 1.8 / 1.1 |
| Qwen2-7B | GPU OpenCL | **8.9 / 7.7 / 7.0** | 1.6 / 1.4 / 1.2 | 10.4 / 9.0 / — |
| Llama3-8B | CPU | 11.2 / 10.3 / 9.0 | 6.0 / 5.5 / 5.0 | 1.3 / 1.3 / 1.1 |
| Llama3-8B | GPU OpenCL | **9.2 / 9.4 / 7.9** | 1.3 / 1.3 / 1.3 | 9.6 / 9.2 / 7.0 |

### vs CPU stesso SoC
**GPU decode < CPU decode** su **tutti** i modelli MNN-LLM testati, **stesso framework, stesso device**.  
Esempio killer: Qwen2-1.5B MNN CPU **53.6** vs MNN GPU **26.9** (~0.5×).  
Prefill GPU a volte migliore; la metrica decisiva (decode) **refuta** “GPU batte CPU” *dentro* MNN su Adreno 750.

### Decode su Adreno 740
**NON TROVATO.**

### Porting
Licenza Apache-2.0. Porting nel nostro stack llama = **non praticabile** (altro IR/runtime). Utile come **contro-prova di regime**: anche kernel OpenCL maturi non battono un CPU ARM forte sul decode memory-bound.

---

## Pista 4 — CLBlast (+ vecchio backend llama.cpp)

### Stato
- Backend **CLBlast** di llama.cpp: **rimosso** (era pre-2024; sostituito dal backend OpenCL Qualcomm/ggml nativo). **[V]** issue/discussion storiche (#5621 Android clblast build 2024; #7768 “until it was removed”).
- CLBlast ha database di tuning per molte GPU inclusa Adreno in generale, ma **nessun** bench LLM decode tg su Adreno 740/7xx con LLM ≥1B trovato nel 2025–2026. **NON TROVATO.**
- Report community storici: CLBlast spesso **più lento** del CPU su iGPU (anche non-Adreno) per offload layer decode. **[V]** discussion #1950 (pattern generale iGPU).

### Verdetto pista 4
Mortua per la campagna. Nessun “rimesso sotto un LLM di recente” con numeri 7xx.

---

## Pista 5 — Vulkan su Adreno 740

### Ops
Vulkan in llama.cpp ha copertura ops **migliore** di OpenCL per hybrid (es. `GATED_DELTA_NET` ✅ vs OpenCL ❌ — già in research-adreno-opencl K2). **[V]** ops.md.

### Stabilità / correttezza su Adreno mobile
| Evento | Hardware | Esito | Data | Fonte |
|--------|----------|-------|------|-------|
| #6713 load fail | Adreno 740 | Closed 2024-05 (vecchio) | 2024 | github.com/ggml-org/llama.cpp/issues/6713 |
| #16881 gibberish | Adreno **732** (7+ Gen 3), Vulkan | Output garbage con -ngl>0; CPU ok; **closed stale** 2025-12 senza fix confermato | Oct 2025 → Dec 2025 | issues/16881 |
| Commenti community | Adreno generico | “old Qualcomm issue, they still haven't fixed it” | 2025 | #16881 thread |
| #22791 | S23 740 | Usa OpenCL, non Vulkan; non confuta Vulkan | 2026 | discussions/22791 |

### Numeri decode Vulkan corretto+veloce su 740 (2025–2026)
**NON TROVATO.** Nessun llama-bench tg Vulkan > CPU su Adreno 740 con output non-gibberish e driver stock 2025–2026.

### Subgroup Vulkan vs OpenCL
I driver Vulkan e OpenCL sono **separati**. In teoria le subgroup ops Vulkan *potrebbero* esistere dove manca `cl_khr_subgroup` broadcast. **Evidenza empirica su 740 che questo sblocchi decode LLM corretto e veloce: NON TROVATO.**

### Verdetto pista 5
Ancora **ROSSA** per S23: correttezza non affidabile; performance decode non dimostrata. IWOCL 2025 (Qualcomm MLC) dice esplicitamente che Vulkan TVM “not efficient enough for Adreno” e lo mettono in roadmap, non shipping. **[V]**

---

## Pista 6 — Kernel custom community (cinesi / indie)

| Progetto | Cosa | Decode 7xx ≥1B | GPU>CPU? | Note |
|----------|------|----------------|----------|------|
| **mllm** (UbiquitousLearning) | CPU+OpenCL+QNN mobile | **NON TROVATO** numeri 740 decode vs CPU | — | Citato in PLAN; scala diversa |
| **InferLLM / fastllm** | Mobile CN | Figure MNN: fastllm GPU spesso assente (“X”) o debole | — | arXiv:2506.10443 |
| **Hand-written OpenCL Adreno 6xx** (Reddit r/OpenCL, May 2026) | Kernel a mano, 6 small LM fp16 su mid-range 2020 | Snippet: “Decode tokens/sec on six small language models…” — **testi completi/numeri non recuperabili** (403 Reddit); **hardware = Adreno 6xx, non 7xx**; modelli “small” (soglia ≥1B non verificata) | NON TROVATO | <https://www.reddit.com/r/OpenCL/comments/1t76qr0/...> |
| **PowerInfer-2** | Hetero phone | 11.68 tok/s claim Mixtral-class | N/A (non pure GPU) | Codice Android **chiuso** (issues 2024–2026) |
| **HeteroInfer** (arXiv:2501.14794) | OpenCL+QNN su **8 Gen 3** | Prefill focus; decode non 740 | — | Industriale, non drop-in |

### Verdetto pista 6
Nessun repo community con **GEMM OpenCL no-subgroup + numeri LLM decode su Adreno 740** che chiuda la tesi in modo [V]. La scena cinese (MNN/mllm) è attiva ma o non pubblica 740 o mostra GPU ≤ CPU sul decode.

---

## Pista 7 — Aggiornamento driver OpenCL/Vulkan su S23/OneUI (senza root)

| Via | Cosa copre | OpenCL 0676.73 → nuovo? | Root? | Esito ricerca |
|-----|------------|-------------------------|-------|---------------|
| **Update OneUI/Samsung** | System driver blob | Solo se Samsung lo spinge in OTA | No | **NON TROVATO** changelog OneUI che porti subgroup broadcast OpenCL o bump 0676.x documentato per LLM su S23 |
| **APK Qualcomm “Adreno driver” gaming** | Tipicamente **Vulkan/GLES** per giochi | **Non** sostituisce in modo documentato `libOpenCL.so` di sistema per process generici | A volte no | Adreno Tools / sideload: XDA 2022+ per **Vulkan/GL per-app**; **NON TROVATO** path supportato per OpenCL LLM system-wide |
| **Adreno Tools** (bylaws / emulazione) | Hook per-app Vulkan/GL | OpenCL: **NON TROVATO** | No | <https://www.xda-developers.com/adreno-tools-update-android-graphics-drivers/> |
| **Magisk / KernelSU modules** | Blob GPU completi | Possibile in teoria | **Sì** | Fuori policy campagna “senza root”; rischio brick |
| **GSI / custom ROM** | Driver tree diverso | Possibile | Unlock | Fuori scope S23 stock |

### Verdetto pista 7
Per S23 stock **senza root**, il driver OpenCL **0676.73 è di fatto capolinea** rispetto a ciò che serve al path llama.cpp Adreno (subgroup broadcast). Nessuna via [V] documentata per aggiornarlo “da APK” come i driver gaming Vulkan.  
Implicazione: **non contare su un OTA che salvi il GEMM subgroup-dependent**; o cambi kernel (no-subgroup) o cambi engine.

---

## Sintesi 1 — Tabella piste

| Pista | Decode tok/s su Adreno **7xx** | vs CPU stesso SoC | Driver | Tecnica kernel | Licenza | Costo porting → nostro stack |
|-------|-------------------------------|-------------------|--------|----------------|---------|------------------------------|
| **1 MLC-LLM/TVM** | 740: **NON TROVATO**; 750/8g3: ~11–23 (1.5–8B) **[V]** | Decode ≈ CPU (COTS) / < CPU (MNN fig.) **[V]** | OpenCL stock | Autotune TVM, q4f16 | Apache-2.0 | **Altissimo** (exit llama) |
| **2 ML Drift / LiteRT** | **740: 10.7–38.1** (1B–8B range; 3B=26.8) **[V]** | Proxy GPU≫CPU llama **[S]**; same-bench CPU **NON TROVATO** | OpenCL stock | Texture virtualization, stage-aware FC/conv, layout 4-ch | Apache-2.0 (LiteRT) | **Estremo** in-llama; **alto** se switch engine |
| **3 MNN-LLM** | 740: **NON TROVATO**; 750: 7–27 (1.5–8B) **[V]** | **GPU < CPU** same eng. **[V]** | OpenCL | Tiling + reorder OpenCL | Apache-2.0 | **Altissimo** |
| **4 CLBlast** | **NON TROVATO** 7xx LLM | Storicamente iGPU ≤ CPU | OpenCL | GEMM generico tuned | Apache-2.0 | N/A (rimosso da llama) |
| **5 Vulkan llama** | **NON TROVATO** tg corretto su 740 | N/A (gibberish risk) | Vulkan stock (separato) | Shader ggml-vulkan | MIT llama | Medio wiring; **alto** rischio correttezza |
| **6 Community custom** | 740 ≥1B: **NON TROVATO** [V] | — | var | var | var | — |
| **7 Driver update** | N/A | N/A | 0676.73 **capolinea no-root** **[S/V]** | — | — | — |
| *Baseline nota* llama OpenCL | 740: **5.9–10.8** tg **[V]** | **GPU < CPU** **[V]** | 0676.73 no subgroup | Adreno GEMM + fallback | MIT | 0 (già misurato) |
| *Baseline nota* llama CPU | 740: **9.8–14.6** tg **[V]** | — | — | NEON/i8mm | MIT | baseline campagna |

---

## Sintesi 2 — Verdetto sulla tesi di gualt

### Formulazione
> Qualcuno ha già fatto kernel custom che fanno andare gli LLM sulla GPU dei vecchi Adreno, aggirando il problema subgroup; e c’è evidenza misurata che su Adreno 740 il **decode** possa battere la CPU con kernel diversi?

### Verdetto: **PARZIALE** (non PROVATA al 100%, non REFUTATA)

**Cosa è PROVATO [V]:**
1. Il collasso OpenCL di llama.cpp sul S23 **non è “il 740 non sa fare LLM”**: ML Drift su **Adreno 740** pubblica decode **15–38 tok/s** su modelli 2–3B e **10.7** su Llama 3.1 8B 8/4/4 — ordini di grandezza sopra il path degradato llama OpenCL (5.9).
2. Esistono stack OpenCL maturi (ML Drift, MLC, MNN) con kernel **non** basati sul subgroup-broadcast path di llama.cpp.
3. Prefill GPU > CPU è facile e ripetuto; **non** decide la campagna.

**Cosa è SOLO PARZIALE / proxy [S]:**
1. **GPU > CPU decode ≥1B sullo stesso SoC in un unico protocollo di misura**: **non trovato** come riga esplicita su Adreno 740. Il miglior ponte è ML Drift 26.8 (3B) vs llama.cpp CPU 9.8 (#22791) — **fonti diverse, quant diverse**.
2. Contro-evidenza strong [V] su **Adreno 750** (MNN-LLM): stesso engine, GPU decode **peggio** del CPU su 1.5B/7B/8B. Regime memory-bound: una CPU ARM ben ottimizzata (i8mm/sdot) resta formidabile.

**Cosa REFUTA versioni deboli della tesi:**
- “Basta accendere OpenCL in llama.cpp mainline sul 740” → **REFUTATA** (#22791).
- “Basta aggiornare il driver senza root” → **REFUTATA** allo stato delle fonti (capolinea 0676.73).
- “Vulkan risolve perché le subgroup ci sono” → **NON supportata** da misure 740 corrette.

### Pista migliore
**ML Drift / LiteRT-LM (pista 2)** — unici numeri **decode [V] su Adreno 740** alti su modelli ≥1B, con tecnica kernel esplicita e open-source lineage.

### Implicazione per la porta S23 della campagna
- **Non** riaprire lo spike “`-ngl` OpenCL mainline + stream MoE” sperando +30–50%: K5 locale + #22791 restano validi **per llama.cpp OpenCL**.
- La porta “kernel diversi” è **tecnicamente aperta in natura**, ma **chiusa in pratica per il nostro stack** finché il costo è (a) riscrivere MUL_MAT Adreno no-subgroup **dentro un fork llama** (manutenzione permanente, policy AGENTS) **oppure** (b) abbandonare llama/BigMoe per LiteRT — incompatibile con Qwen3.6 hybrid MoE streaming attuale.
- La fisica del regime batch=1 decode (memory bandwidth bound) **non** è smentita: MNN mostra che anche con GPU “buona” il CPU può vincere. ML Drift mostra che il *gap di implementazione* di llama.cpp sul 740 è enorme; non che la GPU abbia un free lunch termico/energetico sul MoE 35B-A3B.

---

## Sintesi 3 — Fail-fast se si volesse **comunque** inseguire la pista migliore

**Obiettivo del gate:** non “integrare LiteRT in produzione”, ma **uccidere o validare in 1–2 giorni device** se un kernel path diverso batte il **nostro** CPU baseline sul **nostro** silicio.

| Step | Azione | GO se… | NO-GO se… | Tempo | Nota policy |
|------|--------|--------|-----------|-------|-------------|
| **F0** | Su S23: installare app/demo **LiteRT-LM** o binary ufficiale ML Drift / Google Edge; stesso modello denso piccolo (Llama 3.2 3B o Gemma 2B) | App gira, Adreno 740 selezionato | Crash OpenCL / no GPU | 0.5 d | Zero fork |
| **F1** | Misurare **decode tok/s** (completion, non solo TTFT) sustained ≥60 s | tg ≥ **1.15×** del `llama-bench` CPU **stesso device** su modello size-matched | tg ≤ CPU o thermal collapse sotto CPU | 0.5 d | Quant può differire: loggare MB pesi e bpw |
| **F2** | Se F1 GO: profilo **solo** (systrace/snapdragon profiler) — bandwidth vs ALU; confermare no-subgroup path | Kernel bound da BW DRAM, non da fallback stupido | Tempo perso in sync/copy | 0.5 d | Informativo |
| **F3** | **Solo se F1 GO e gualt accetta costo:** spike fork llama locale — un GEMM Q4_K/Q5_K **local-memory tiling, no subgroup broadcast**, microbench vs CPU su 1 layer | tg matmul ≥ 1.2× CPU su shapes attention/FFN del nostro dense | ≤ CPU dopo 1–2 d di kernel | 2–5 d | **Fork llama obbligatorio** (AGENTS); stima manutenzione: ogni merge upstream OpenCL = rebase del GEMM custom |
| **F4** | **Non fare** finché F3 non GO: wiring `-ngl` + streamer MoE + GDN | — | — | settimane | K2 hybrid ops restano killer separato |

**Costo manutenzione (se F3 diventa prodotto):**
- Fork permanente di `ggml-opencl` Adreno kernels.
- Ogni upgrade Qualcomm OpenCL.md / binary kernel lib X2 **non** copre 740.
- Nessun beneficio automatico dal lavoro QC su 750/830/840.
- Stima: **giorni** per un spike matmul; **settimane** per feature-complete quant (Q5_K/Q6_K) + regolarizzazione numerica; **continuo** per non divergere da upstream.

**Raccomandazione di ricerca (allineata a PLAN STATO CORRENTE):**  
Non riaprire la GPU come trunk della campagna MoE su S23 **solo** perché ML Drift dimostra numeri alti su 2–3B dense. Quella evidenza **PARZIALE** giustifica al massimo un **fail-fast F0–F1 di un giorno** se si vuole un kill empirico; **non** giustifica un porting kernel nel fork BigMoeOnEdge senza un F1 che batta il CPU **sul telefono nostro** con margine e modello ≥1B.

---

## Fonti primarie (URL + data accesso/pubblicazione)

| ID | Fonte | Data |
|----|-------|------|
| ML Drift paper | https://arxiv.org/abs/2505.00232 · PDF https://arxiv.org/pdf/2505.00232 | 2025-05-01; fetch 2026-08-11 |
| MNN-LLM paper | https://arxiv.org/abs/2506.10443 | 2025-06; fetch 2026-08-11 |
| COTS mobile LLM study | https://arxiv.org/abs/2410.03613 | 2024–2026 revs |
| IWOCL 2025 MLC/TVM Adreno | https://www.iwocl.org/wp-content/uploads/iwocl-2025-siva-rama-krishna-reddy-b-deep-learning.pdf | 2025; fetch 2026-08-11 |
| llama.cpp #22791 S23 OpenCL | https://github.com/ggml-org/llama.cpp/discussions/22791 | 2026 |
| llama.cpp #16881 Vulkan gibberish | https://github.com/ggml-org/llama.cpp/issues/16881 | 2025-10 → closed stale 2025-12 |
| llama.cpp #6713 Vulkan 740 | https://github.com/ggml-org/llama.cpp/issues/6713 | 2024 |
| OPENCL.md | https://github.com/ggml-org/llama.cpp/blob/master/docs/backend/OPENCL.md | crawl 2026-08 |
| LiteRT / ML Drift product | https://github.com/google-ai-edge/LiteRT · https://developers.googleblog.com/litert-maximum-performance-simplified/ | 2025–2026 |
| Qualcomm OpenCL llama blog | https://www.qualcomm.com/developer/blog/2024/11/introducing-new-opn-cl-gpu-backend-llama-cpp-for-qualcomm-adreno-gpu | 2024-11 / 2025-02 |
| Adreno Tools (no-root GL/VK) | https://www.xda-developers.com/adreno-tools-update-android-graphics-drivers/ | 2022 |
| Contesto locale | `reports/research-adreno-opencl.md`, `PLAN.md` STATO CORRENTE | 2026-08 |

---

## One-liner per gualt

**I kernel giusti su Adreno 740 esistono (ML Drift: fino a ~27 tok/s decode su Llama 3.2 3B); il path llama.cpp OpenCL sul nostro driver no. La tesi “GPU può battere CPU in decode sul 740” è PARZIALE (proxy forte, A/B same-bench assente) e non ripaga un fork GEMM nella campagna MoE finché un fail-fast di un giorno sul telefono non batte il nostro CPU baseline con margine.**
