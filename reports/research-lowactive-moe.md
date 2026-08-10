# DEEP RESEARCH — MoE low-active 2026 come candidati campagna "Beyond Memory"

**Data ricerca:** 2026-08-10  
**Mandato:** `mandates/research-lowactive-moe.md`  
**Scope:** solo ricerca (zero build, zero device).  
**Baseline campagna (STATO CORRENTE 2026-08-09):** Qwen3.6-35B-A3B (KEXP path), decode ~**4.4–4.5 tok/s** su S23, attivo ~3B, streaming BigMoeOnEdge obbligatorio, PPL IT decode-path baseline **2.0955** (floor KEXP **≤2.0955**).  
**Target prodotto dichiarato:** **15–20 tok/s** su S23 → attivo **≤2.5B** come condizione necessaria (non sufficiente).  
**Vincolo campagna:** totale che **non** entra in 8 GB a 2–4 bpw (lo streaming resta il punto).  
**Vincolo Kalsa:** multimodalità pesa (Qwen la dava via mmproj).

### Legenda verdetti cella
| simbolo | significato |
|---|---|
| **VERDE** | evidenza primaria a favore; nessun veto ovvio |
| **GIALLO** | usabile con rischio/gap noto |
| **ROSSO** | veto o gap bloccante per trial/campagna |
| **[V]** | verificato da fonte primaria (URL + data) |
| **[S]** | stima non misurata sul nostro banco |
| **NON TROVATO** | evidenza assente dopo ricerca |

### Contesto stack locale (read-only)

Nel submodule `BigMoeOnEdge/third_party/llama.cpp/src/llama-arch.cpp` risultano tra le altre:

| arch GGUF | enum | rilevanza |
|---|---|---|
| `qwen35moe` | `LLM_ARCH_QWEN35MOE` | campagna attuale (Qwen3.6) |
| `qwen3moe` | `LLM_ARCH_QWEN3MOE` | Marco-Mini e backbone SenseNova LLM |
| `lfm2` / `lfm2moe` | `LLM_ARCH_LFM2` / `LFM2MOE` | LFM2-8B (floor) e LFM2-24B |
| `mellum` | `LLM_ARCH_MELLUM` | Mellum2 |

**Assenti** nel submodule: `neo_chat` / NEO-unify, `vaetki`, arch moondream nativa.

---

## 0. Matrice comparativa (candidati × criteri)

Candidati lista gualt + **1 pari-classe emerso** (Marco-Mini).  
Riferimento floor: **LFM2-8B-A1B** (già sul telefono; arch `lfm2moe`).

### 0.1 SenseNova U1-A3B-MoT

| criterio | evidenza | verdetto |
|---|---|---|
| **1. Arch llama.cpp** | Model card: arch `NEOChatModel` / `neo_chat`; LLM interno `Qwen3MoeForCausalLM` / `qwen3_moe` (128 exp, top-8, 48 layer, h=2048). [V] https://huggingface.co/sensenova/SenseNova-U1-A3B-MoT (card + `config.json`, release note 2026-05-10). Paper: 30B-A3B MoE baseline [V] https://arxiv.org/abs/2605.12500 (2026-05). **`neo_chat` NON in `llama-arch.cpp` locale.** GGUF community (ComfyUI/diffusers path) ≠ support llama.cpp. | **ROSSO** |
| **2. Attivo/totale** | Paper abstract: mixture-of-experts **(30B-A3B)** understanding baseline. [V] arxiv 2605.12500. Config: `num_experts=128`, `num_experts_per_tok=8`, `gen_num_experts=32`, `moe_intermediate_size=768`, `num_hidden_layers=48`. [V] config.json HF 2026. Medium secondario: understanding ~30B / generation ~8B, ~3B attivi. [S per split gen] | **GIALLO** (A3B al limite target ≤2.5B; card dice A3B) |
| **3. Footprint** | BF16 multi-shard ~16 file (somma pezzi ≈ **77.5 GB** grezzi da tree API 2026-08-10). Community GGUF `smthem/SenseNova-U1-A3B-MoT-SFT-gguf` **Q4_K_S = 26 433 076 544 B (~24.6 GiB)** — **>8 GB**, streaming necessario se mai runnable. [V] HF tree API 2026-08-10. | **GIALLO** (size ok per campagna; stack no) |
| **4. Italiano** | Card multilingua non elenca IT esplicitamente; focus EN/ZH showcase. Benchmark IT **NON TROVATO**. Tokenizer = Qwen-family vocab 151936 (compatibile Qwen) ma fertilità IT **NON TROVATO**. | **GIALLO** |
| **5. Multimodalità** | Nativa unificata understanding+generation (NEO-unify, no VE/VAE). [V] model card + paper. **llama.cpp/mmproj: NON TROVATO** (path transformers/LightLLM/ComfyUI). | **ROSSO** per nostro stack |
| **6. Velocità ARM** | Numeri smartphone/ARM **NON TROVATI**. Stima: attivo ~3B ≈ classe Qwen A3B → **~4–5 tok/s** su S23 flash+CPU [S], lontano da 15–20. | **GIALLO** |
| **7. Licenza / pesi** | **Apache 2.0** [V] card. BF16 su HF. imatrix **NON TROVATO**. | **VERDE** |
| **8. Qualità** | Vendor benchmarks (understanding/generation). Indipendenti IT **NON TROVATI**. | **GIALLO** |

**Sintesi riga:** veto arch/runtime. Non trialabile sul fork senza porting NEO-unify.

---

### 0.2 JetBrains Mellum2-12B-A2.5B-Thinking

| criterio | evidenza | verdetto |
|---|---|---|
| **1. Arch llama.cpp** | `model_type: mellum`, arch `MellumForCausalLM`. [V] config.json HF. Mainline PR **#23966** (merge note GitHub ~2026-06-02). Submodule locale: `LLM_ARCH_MELLUM` + `models/mellum.cpp` (SWA/ISWA). Hybrid **sliding_window=1024** + full attention 3:1. | **VERDE** |
| **2. Attivo/totale** | **12B total / 2.5B active**; 64 experts, **8 activated/token**; 28 layer; h=2304; moe_int=896. [V] model card + blog 2026-06-01 https://huggingface.co/blog/JetBrains/mellum2-launch + https://huggingface.co/JetBrains/Mellum2-12B-A2.5B-Thinking | **VERDE** (≤2.5B) |
| **3. Footprint** | Official Q4_K_M: **8 071 295 040 B** (~7.52 GiB) sha LFS `489cf0d7…7173ccb`. [V] HF paths-info 2026-08-10. bartowski Q4_K_M: **8 167 160 160 B**. IQ2_M bartowski: **5 096 223 072 B** (entra in 8 GB). **Q4 ~8 GB = bordo 8 GB RAM** — rischio thrash (vedi LFM2-8B in campagna), **non** è il caso “oltre memoria” chiaro. | **GIALLO** (campagna streaming debole) |
| **4. Italiano** | Tag HF: **`en` only**. Code-first + NL/code mix. Benchmark IT **NON TROVATO**. Vocab 98 304. Fertilizzazione IT: **NON TROVATO** (presunta terza classe). | **ROSSO** per prodotto IT |
| **5. Multimodalità** | Esplicitamente text+code only. [V] blog. | **ROSSO** per Kalsa vision |
| **6. Velocità ARM** | Vendor: “>2× faster inference” vs similar size (desktop/server, non S23). [V] blog. Su S23 [S]: attivo 2.5B vs ~3B → ≈ **+15–20%** se compute-bound → **~5.2–5.5 tok/s** con streaming; se entra in RAM e no thrash, potenzialmente più alto ma **NON TROVATO** su mobile. Ancora ≪15–20. | **GIALLO** |
| **7. Licenza / pesi** | **Apache 2.0** [V]. BF16 5 shard ~24.3B params tensor. Official + bartowski GGUF (imatrix). | **VERDE** |
| **8. Qualità** | Self-reported: LiveCodeBench v6 69.9, AIME 58.4, MMLU-Redux 86.2, GPQA-D 57.6. [V] card. vs Qwen3.5-9B misto. IT/chat general **NON TROVATO** indipendente. | **GIALLO** |

**Sintesi riga:** ottimo per **trial velocità/arch** (stack ready), debole come successore campagna (IT, MM, footprint borderline).

---

### 0.3 moondream/moondream3.1-9B-A2B

| criterio | evidenza | verdetto |
|---|---|---|
| **1. Arch llama.cpp** | VLM MoE custom; runtime primario **Photon** (pip `moondream`). [V] https://huggingface.co/moondream/moondream3.1-9B-A2B. Arch GGUF llama.cpp **NON TROVATA** nel submodule. Preview arch: 24 layer, MoE 64/8, h=2048 (blog Moondream 3). | **ROSSO** |
| **2. Attivo/totale** | **9B total / 2B active**. [V] model card. | **VERDE** |
| **3. Footprint** | `model.safetensors` **10 505 269 576 B** (mixed F32/BF16/F8). [V] tree API. A 2–4 bpw **entrerà** in 8 GB → **non** modello “beyond memory”. | **ROSSO** per vincolo campagna |
| **4. Italiano** | Vision skills (caption/detect/point/query). Chat general IT **NON TROVATO**. | **ROSSO** |
| **5. Multimodalità** | Vision-native (ragione d’essere). Non via mmproj llama.cpp. | **GIALLO** (MM sì, stack no) |
| **6. Velocità ARM** | Benchmark Photon Jetson/GPU vendor. CPU S23 **NON TROVATO**. | **GIALLO** |
| **7. Licenza / pesi** | **Moondream Model License** (not Apache). [V] card → moondream.ai/licenses. BF16/F8 weights. | **GIALLO** |
| **8. Qualità** | SoTA visual reasoning (vendor). Indipendenti text-IT **NON TROVATI**. | n/a per text campaign |

**Sintesi riga:** fuori scope campagna text MoE streaming.

---

### 0.4 nc-ai-consortium/VAETKI-20B-A2B

| criterio | evidenza | verdetto |
|---|---|---|
| **1. Arch llama.cpp** | `model_type: vaetki`, `VaetkiForCausalLM`, auto_map custom; MLA-like (`kv_lora_rank`, `q_lora_rank`) + SWA 512. [V] config.json. **`vaetki` assente** da `llama-arch.cpp` locale. GGUF **NON TROVATO**. | **ROSSO** |
| **2. Attivo/totale** | **19.64B total / 2.2B activated**; 24 layer; 128 experts; 8 activated; +1 shared; vocab 126k/137k. [V] https://huggingface.co/nc-ai-consortium/VAETKI-20B-A2B | **VERDE** |
| **3. Footprint** | 8× safetensors BF16 ≈ **39.2 GB**. A ~3 bpw ≈ **7–8 GB** [S] — borderline/streaming. GGUF size reale **NON TROVATO**. | **GIALLO** |
| **4. Italiano** | Lingue dichiarate: **Korean, English, Chinese, Japanese**. [V] card. **IT assente**. | **ROSSO** |
| **5. Multimodalità** | Text LM (esiste linea VAETKI-VL separata, non questo ckpt). | **ROSSO** |
| **6. Velocità ARM** | **NON TROVATO**. [S] ~2.2B active → leggermente sopra LFM2-24B class. | **GIALLO** |
| **7. Licenza / pesi** | **MIT** (repo) + Model License note. [V] card. BF16. | **VERDE** |
| **8. Qualità** | Sezione eval card: **“to be updated”**. [V] | **ROSSO** |

**Sintesi riga:** KR-first, no arch, no GGUF → non trialabile ora.

---

### 0.5 LiquidAI/LFM2-24B-A2B (+ floor LFM2-8B-A1B)

| criterio | evidenza | verdetto |
|---|---|---|
| **1. Arch llama.cpp** | `model_type: lfm2_moe`, arch `Lfm2MoeForCausalLM`. [V] config.json. Day-zero llama.cpp [V] https://www.liquid.ai/blog/lfm2-24b-a2b (2026-02) + official GGUF. Locale: `LLM_ARCH_LFM2MOE` + `models/lfm2moe.cpp`. **Ibrida conv (short conv) + full_attention** ~3:1 (30 conv + 10 attn su 40 layer). Vincolo noto campagna: hybrid → **niente rollback KV parziale** (stessa famiglia di lezione attention+SSM su Qwen3.6). | **VERDE** (con caveat hybrid) |
| **2. Attivo/totale** | **24B total / 2.3B active**; 64 experts; **top-4**; 2 dense layers; h=2048; moe_int=1536; vocab 65536. [V] card + config + blog. Floor 8B-A1B: **8.3B / 1.5B**, 32 exp. [V] stessa card comparativa. | **VERDE** |
| **3. Footprint** | Official GGUF [V] tree API 2026-08-10: Q4_K_M **14 415 473 952 B** (sha LFS `eb4d2d4d…025cf58f2`); Q4_0 13.47 GB; IQ2_M bartowski **7 738 953 632 B** (bordo 8 GB). **Q4 >8 GB → streaming necessario** (campagna coerente). Floor 8B Q4_K_M **5 044 779 712 B**. | **VERDE** (Q4/Q5) |
| **4. Italiano** | Lingue ufficiali 24B: **EN, AR, ZH, FR, DE, JA, KO, ES, PT** — **IT non in lista**. [V] card HF. Paper LFM2 (dense family) menziona IT come “additional base support” nel mix multilingual [V] arxiv 2511.23404 — quindi **terza classe**, non prima. | **GIALLO/ROSSO** per metro IT |
| **5. Multimodalità** | Text instruct. Esistono LFM2-VL separati (non questo ckpt). mmproj per 24B-A2B **NON TROVATO**. | **ROSSO** |
| **6. Velocità ARM** | Vendor decode alti su AMD Ryzen AI Max+ 395 (desktop), non S23. [V] blog. Sul nostro S23: LFM2-8B ha avuto **thrash** su 8 GB in F2 (PLAN). Stima decode flash+CPU con streaming e 2.3B active: se compute-bound come KEXP, **~5–7 tok/s** [S] (conv hybrid può aiutare prefill/decode vs pure attn; **non** dimostra 15–20). | **GIALLO** |
| **7. Licenza / pesi** | **LFM Open License v1.0**: commercial free se revenue azienda **&lt; $10M USD/anno**. [V] https://www.liquid.ai/lfm-license + LICENSE su HF. **Non Apache.** BF16 monolitico ~47.7 GB; GGUF ufficiali + bartowski imatrix. | **GIALLO** (gate revenue) |
| **8. Qualità** | Vendor family scaling; Marco paper riporta LFM2-24B-A2B avg EN 66.7 e multilingua debole vs Marco. [V] arxiv 2604.25578. Qualità IT **NON TROVATA**. | **GIALLO** |

**Floor LFM2-8B-A1B:** stesso stack, in-RAM in teoria, già misurato problematico su 8 GB (thrash). Resta **controllo arch**, non successore campagna.

**Sintesi riga:** miglior fit **stack+streaming+attivo** tra la lista gualt; debole su IT e MM; licenza gated.

---

### 0.6 (estensione pari-classe) ATH-MaaS / AIDC-AI **Marco-Mini-Instruct** 17.3B-A0.86B

| criterio | evidenza | verdetto |
|---|---|---|
| **1. Arch llama.cpp** | `model_type: qwen3_moe`, `Qwen3MoeForCausalLM`. [V] config.json. GGUF mradermacher arch `qwen3moe`. Locale: `LLM_ARCH_QWEN3MOE` presente. **Non** hybrid GDN (più semplice di `qwen35moe`). | **VERDE** |
| **2. Attivo/totale** | **17.3B total / 0.86B active** (5%); 256 experts; top-8; 28 layer; **h=1024**; moe_int=768. [V] https://huggingface.co/ATH-MaaS/Marco-Mini-Instruct + config + paper arxiv 2604.25578 (2026-04). | **VERDE** (attivo ≪2.5B — unico vicino al target 15–20 [S]) |
| **3. Footprint** | mradermacher i1-GGUF [V] tree 2026-08-10: Q4_K_M **10 505 424 704 B**; IQ2_M **5 695 505 216 B**; Q3_K_M **8 291 340 096 B**. Q4 **>8 GB** → streaming sì; IQ2 entra in RAM (controllo). | **VERDE** |
| **4. Italiano** | Tag HF espliciti includono **`it`**. [V] model API tags (en, zh, ar, de, es, fr, ko, ja, pt, tr, id, **it**, nl, pl, ru, …). Multilingual-first paper. | **VERDE** (dichiarato; qualità da misurare) |
| **5. Multimodalità** | Text only. | **ROSSO** per MM prodotto |
| **6. Velocità ARM** | Attivo 0.86B + h=1024: se decode ~lineare in FLOP attivi vs KEXP ~3B@h2048, ordine di grandezza **×3–×5** → **~12–20 tok/s** [S] **solo se** I/O streaming non ridiventa collo (expert piccoli aiutano). **Unico candidato con ipotesi onesta verso 15–20.** | **VERDE** (ipotetico) |
| **7. Licenza / pesi** | **Apache 2.0** [V]. BF16 su HF. GGUF community imatrix (mradermacher). | **VERDE** |
| **8. Qualità** | Paper: SOTA efficiency multilingua; batte LFM2-24B su multi/cultural. [V] arxiv 2604.25578. **Caveat:** upcycled da Qwen3-0.6B; qualità assoluta vs Qwen3.6-35B-A3B su IT **da misurare** (atteso gap su reasoning/chat profondi). | **GIALLO** |

**Sintesi riga:** miglior **candidatura trial** qualità-IT×velocità attesa tra i low-active 2026 trovati; non sostituisce MM.

---

## 1. Tabella riassuntiva verdetti

| Candidato | Arch | Attivo | Footprint stream | IT | MM | Speed path | Licenza | Qualità | **Trial?** |
|---|---|---|---|---|---|---|---|---|---|
| SenseNova U1-A3B-MoT | ROSSO | GIALLO | GIALLO | GIALLO | ROSSO | GIALLO | VERDE | GIALLO | **NO** |
| Mellum2-12B-A2.5B | VERDE | VERDE | GIALLO | ROSSO | ROSSO | GIALLO | VERDE | GIALLO | **controllo velocità** |
| moondream3.1-9B-A2B | ROSSO | VERDE | ROSSO | ROSSO | GIALLO | GIALLO | GIALLO | n/a | **NO** |
| VAETKI-20B-A2B | ROSSO | VERDE | GIALLO | ROSSO | ROSSO | GIALLO | VERDE | ROSSO | **NO** |
| LFM2-24B-A2B | VERDE | VERDE | VERDE | GIALLO | ROSSO | GIALLO | GIALLO | GIALLO | **Sì (2°)** |
| LFM2-8B-A1B (floor) | VERDE | VERDE | ROSSO (in-RAM) | GIALLO | ROSSO | GIALLO | GIALLO | GIALLO | controllo |
| **Marco-Mini 17B-A0.86B** | VERDE | VERDE | VERDE | VERDE | ROSSO | VERDE* | VERDE | GIALLO | **Sì (1°)** |

\*stima [S], da confutare sul banco.

---

## 2. Shortlist trial (1–2) + file da scaricare

### Scelta e motivazione

**Primary: Marco-Mini-Instruct (17.3B / 0.86B)**  
- Unico con **IT dichiarato** + **attivo &lt;1B** + **arch già nel submodule** (`qwen3moe`) + GGUF ready + Apache-2.0.  
- Unica ipotesi realistica verso **15–20 tok/s** sul path flash+CPU [S].  
- Rischio: gap qualità vs KEXP/Qwen3.6; no multimodalità.

**Secondary: LFM2-24B-A2B Q4_K_M (24B / 2.3B)**  
- Fit massimo col nostro stack (stessa famiglia del floor LFM2-8B; `lfm2moe` collaudato in tree).  
- Streaming chiaramente necessario (14.4 GB).  
- Serve a separare “effetto arch hybrid Liquid” da “effetto sparsità Marco”.  
- Rischio: IT terza classe; licenza LFM1.0; attivo 2.3B **non** basta da solo per 15–20 [S].

**Non in shortlist ma opzionale smoke:** Mellum2 Q4_K_M come controllo “2.5B active / SWA / code” — solo se c’è banda disco; **non** come successore prodotto IT.

### File esatti da scaricare

#### A) Marco-Mini — trial primario

| # | repo | file | size (byte) | sha256 LFS (oid) | note |
|---|---|---|---|---|---|
| A1 | `mradermacher/Marco-Mini-Instruct-i1-GGUF` | `Marco-Mini-Instruct.i1-Q4_K_M.gguf` | **10 505 424 704** | **NON TROVATO in questa passata** (size da tree API 2026-08-10; ricalcolare `sha256sum` a download) | target streaming |
| A2 | stesso | `Marco-Mini-Instruct.i1-IQ2_M.gguf` | **5 695 505 216** | NON TROVATO qui | controllo in-RAM / sanity |
| A3 | `ATH-MaaS/Marco-Mini-Instruct` o `AIDC-AI/Marco-Mini-Instruct` | tokenizer + `config.json` | config 1000 B | — | per tokenizzare corpus IT col **loro** tokenizer |

Fonte pesi: https://huggingface.co/mradermacher/Marco-Mini-Instruct-i1-GGUF  
Upstream: https://huggingface.co/ATH-MaaS/Marco-Mini-Instruct  

#### B) LFM2-24B-A2B — trial secondario

| # | repo | file | size (byte) | sha256 LFS | note |
|---|---|---|---|---|---|
| B1 | `LiquidAI/LFM2-24B-A2B-GGUF` | `LFM2-24B-A2B-Q4_K_M.gguf` | **14 415 473 952** | `eb4d2d4d4e61b795726c2f526c4434ca6bc725ad7a783691b58681f025cf58f2` [V] HF paths-info 2026-08-10 | preferire official |
| B2 (alt) | `bartowski/LiquidAI_LFM2-24B-A2B-GGUF` | `LiquidAI_LFM2-24B-A2B-Q4_K_M.gguf` | **14 435 422 112** | `7beb97b1278d4ebe6ea565b1f969d586b4d14b526384900080ea6088525b7a35` | imatrix |
| B3 (alt low) | `bartowski/LiquidAI_LFM2-24B-A2B-GGUF` | `LiquidAI_LFM2-24B-A2B-IQ2_M.gguf` | **7 738 953 632** | `0fbee4a4a61c495fe3f1e5f1d6b2086d690b2bfad3be9099400dfa79be63ddc6` | bordo 8 GB; thrash risk |

Tokenizer: incluso nel GGUF; per PPL offline usare `LiquidAI/LFM2-24B-A2B` tokenizer.json.

#### C) Mellum2 — solo se si vuole controllo (non obbligatorio)

| # | repo | file | size | sha256 LFS |
|---|---|---|---|---|
| C1 | `JetBrains/Mellum2-12B-A2.5B-Thinking-GGUF-Q4_K_M` | `Mellum2-12B-A2.5B-Thinking-Q4_K_M.gguf` | **8 071 295 040** | `489cf0d7ca86ef4683e34e2efe8a46a9b52573bfe994a6ad9c86bf57c7173ccb` |

#### D) Floor già noto

| # | repo | file | size |
|---|---|---|---|
| D1 | `LiquidAI/LFM2-8B-A1B-GGUF` | `LFM2-8B-A1B-Q4_K_M.gguf` | **5 044 779 712** |

**BF16 per recipe quant custom:**  
- LFM2-24B: `LiquidAI/LFM2-24B-A2B` monolitico **47 688 305 784 B** [V].  
- Marco: multi-shard su ATH-MaaS/AIDC-AI (size pezzi: verificare a download; tree non enumerato pezzo-per-pezzo in questa passata oltre config).  
- imatrix: bartowski/mradermacher espongono `*imatrix.gguf`.

---

## 3. Disegno TRIAL fail-fast (banco esistente)

### 3.1 Principio metro: **non confrontare PPL grezze cross-tokenizer**

Le PPL autoregressive **non** sono confrontabili tra tokenizer diversi (stesso testo → N token diversi → PPL diversa a parità di bits).

**Normalizzazione obbligatoria:**

1. Corpus IT di campagna = **byte-identico** per tutti i candidati.  
2. Per ogni modello \(m\): tokenizzare col tokenizer di \(m\); calcolare  
   - `ppl_m` (decode-path, flag `--ppl-decode` se supportato dall’arch),  
   - **`bpb_m = (Σ −log2 p(token)) / N_bytes`** (bits-per-byte sul corpus).  
3. Gate qualità:  
   - **primario:** `bpb_candidate ≤ bpb_KEXP + ε` con ε da fissare (proposta: **+0.05 bpb** [S] finché non c’è calibrazione);  
   - **secondario (solo intra-modello):** ΔPPL vs baseline *dello stesso* file (drop-cold, k, quant) con budget lossy **cumulativo 0.15** già in vigore.  
4. **Non** usare PPL KEXP 2.0955 come numero assoluto su Marco/LFM2.

### 3.2 Celle harness (ordine fail-fast)

| step | cella | cosa misura | abort se |
|---|---|---|---|
| **T0** | Arch discovery / load smoke | `llama-cli` o binario CAMPAIGN: load GGUF, 16 token gen, log `general.architecture` | arch unknown / crash → **STOP candidato** |
| **T1** | Streaming smoke fork | `--moe-stream --cache-mb 2000 --dense-weights anon` (o default campagna se applicabile), 1 prompt corto | OOM/RescueParty o 0 hit esperti anomalo → STOP o riduci cache |
| **T2** | PPL decode-path IT | stesso subset 10k (o subset smoke 2k) del metro; report **bpb + ppl + n_tokens** | bpb ≫ KEXP (proposta fail: **+0.15 bpb**) → **NO-GO qualità** |
| **T3** | Velocità n=200 ABBA | vs **KEXP** (stesso protocollo die/charge rules: **non in carica** per tempi) | se tok/s &lt; KEXP × 1.15 e attivo doveva vincere → STOP “non vale dossier” |
| **T4** | (solo survivor) griglia corta | 1 punto drop-cold F=0.50 + k default; n=200 | Δbpb fuori budget |
| **T5** | (opz.) LFM2-8B floor | stessa griglia velocità **senza** stream se entra | separa MoE-in-RAM vs stream |

**ABBA:** A=KEXP, B=candidato; sequenza A-B-B-A (o B-A-A-B) per cancellare drift termico; mediana per-prompt, non solo pooled.

**Template chat:** parte del contratto (byte-identico tra run dello stesso modello). Non condividere template KEXP su Marco/LFM2.

### 3.3 Criteri go/no-go verso “cambio modello di campagna”

Un candidato **merita dossier di adozione** solo se **tutti**:

1. T0–T1 verdi sul fork BigMoeOnEdge.  
2. **bpb IT** non peggiore di KEXP oltre ε (T2).  
3. Decode **≥ 1.3× KEXP** a parità protocollo (T3) — soglia minima per ripagare il costo di cambio; ambizione prodotto resta 15–20.  
4. Accettazione esplicita: **perdita multimodalità** (nessun candidato shortlist ha mmproj Qwen-class).  
5. Licenza ok per Kalsa (Marco Apache = ok; LFM1.0 = check revenue).

Se fallisce (1) o (2) → scartare. Se passa (1–2) ma manca (3) → tenere come curiosità, **non** sostituire KEXP.

---

## 4. Onestà strategica (rispetto a KEXP + griglia + REAP-IT)

### 4.1 Nessun candidato della lista gualt batte in modo chiaro il percorso attuale

| asse | KEXP (Qwen3.6-35B-A3B) | best of list gualt | Marco (estensione) |
|---|---|---|---|
| Velocità attesa S23 | ~4.4 tok/s misurati | LFM2-24B ~5–7 [S]; Mellum ~5–6 [S] | **~12–20 [S]** se I/O ok |
| Qualità IT | metro esistente, forte | LFM2/Mellum **deboli o ignoti** | dichiarata, **da misurare** |
| Multimodalità | mmproj path noto | **nessuno** trialabile | no |
| Streaming story | sì (11–12 GB+) | LFM2-24B sì; Mellum debole | Q4 sì |
| Costo cambio | 0 (già adottato) | dossier intero + rischio IT | dossier intero |

**Conclusione onesta:**

1. **Sulla lista gualt pura:** nessuno è un successore credibile di Qwen3.6-KEXP per **qualità-IT × multimodalità × velocità**. LFM2-24B è al massimo un **esperimento arch/streaming** (stesso stack, attivo un filo più basso), non un upgrade prodotto.  
2. **Marco-Mini** è l’unica estensione pari-classe che può **giustificare un trial** se l’obiettivo prioritario diventa **velocità verso 15–20 tok/s** accettando: (a) possibile regressione qualità vs KEXP, (b) **zero vision**.  
3. **Il target 15–20 tok/s non è raggiunto da “solo meno active params” nella classe 2–2.5B** sul path misurato (scaling grezzo da 3B@4.5 tok/s → 2.3B ≈ 5.9 tok/s [S]). Serve **attivo ≪1B e/o dims più strette** (Marco) **oppure** altro silicio/backend (già chiusi: OpenCL, ik IQ2).  
4. **Cambiare modello costa un dossier intero e si fa una volta sola.** Default razionale oggi: **restare su KEXP + leve lossy (drop knee, REAP-IT calibrato sul dominio)** per qualità; aprire un trial Marco **solo** se gualt prioritizza esplicitamente il salto di velocità a scapito di MM e del metro PPL già calibrato.

### 4.2 Cosa non fare

- Non scaricare SenseNova/VAETKI/moondream “sperando” in un porting.  
- Non confrontare PPL grezze KEXP vs Marco.  
- Non interpretare i tok/s vendor desktop (Ryzen AI Max, H100) come proxy S23.  
- Non adottare LFM2-24B in prodotto senza clearance **LFM Open License** (soglia $10M).

---

## 5. Fonti primarie (indice)

| fonte | data | uso |
|---|---|---|
| https://huggingface.co/sensenova/SenseNova-U1-A3B-MoT (+ config.json) | 2026-05 / fetch 2026-08-10 | SenseNova |
| https://arxiv.org/abs/2605.12500 | 2026-05 | SenseNova paper |
| https://huggingface.co/JetBrains/Mellum2-12B-A2.5B-Thinking | fetch 2026-08-10 | Mellum |
| https://huggingface.co/blog/JetBrains/mellum2-launch | 2026-06-01 | Mellum |
| https://github.com/ggml-org/llama.cpp/pull/23966 | ~2026-06 | Mellum arch |
| https://huggingface.co/moondream/moondream3.1-9B-A2B | fetch 2026-08-10 | Moondream |
| https://huggingface.co/nc-ai-consortium/VAETKI-20B-A2B (+ config) | fetch 2026-08-10 | VAETKI |
| https://huggingface.co/LiquidAI/LFM2-24B-A2B (+ config, GGUF tree) | fetch 2026-08-10 | LFM2-24B |
| https://www.liquid.ai/blog/lfm2-24b-a2b | 2026-02 | LFM2-24B |
| https://www.liquid.ai/lfm-license | fetch 2026-08-10 | licenza LFM |
| https://arxiv.org/abs/2511.23404 | 2025-11 | LFM2 paper (IT base support) |
| https://huggingface.co/ATH-MaaS/Marco-Mini-Instruct | fetch 2026-08-10 | Marco |
| https://arxiv.org/html/2604.25578v1 | 2026-04 | Marco-MoE paper |
| HF tree/paths-info API sizes+sha | 2026-08-10 | footprint file |
| Locale: `PLAN.md` STATO CORRENTE; `llama-arch.cpp`; `models/{lfm2moe,mellum}.cpp` | 2026-08-09/10 | stack |

---

## 6. Raccomandazione operativa (non decisione)

| priorità gualt | azione |
|---|---|
| Qualità IT + MM + continuità campagna | **Nessun cambio modello.** Procedere KEXP + knee drop + REAP-IT. |
| Velocità verso 15–20, IT dichiarato, no MM | **Trial T0–T3 su Marco-Mini Q4_K_M** (fail-fast). |
| Validare solo lo stack hybrid Liquid a totale grosso | **Trial corto LFM2-24B Q4_K_M** (T0–T1–T3), senza aspettative IT. |

**STOP — la scelta modello è di gualt.**
