# Research — kernel IQ2/IQ3 veloci su CPU ARM per GEMV esperti MoE

**Data ricerca:** 2026-08-09  
**Mandato:** `mandates/research-iq2-kernels.md`  
**Scope:** SOLO ricerca (zero codice, zero telefono, zero build). Decisione GO/NO-GO spike → gualt.  
**Device di campagna:** Galaxy S23, Snapdragon 8 Gen 2 for Galaxy (1× Cortex-X3 + 2× A715 + 2× A710 + 3× A510), `-t 4`.  
**Modello:** Qwen3.6-35B-A3B UD-IQ2_M (~9.77 GB esperti IQ2_XXS/IQ3_XXS/IQ4_XS).  
**Runtime:** fork BigMoeOnEdge, submodule llama.cpp `e5605f3bd` (base campagna `5236140e5` + mmap hooks).  
**Contesto:** via GPU OpenCL ritirata (`research-adreno-opencl.md`); collo = CALCOLO (I/O esposto ~20%); GEMM/GEMV esperti ≈ 50% del calcolo → ~40% del wall decode.

Legenda claim: **[V]** = fonte primaria verificata (repo/commit/PR/paper/codice locale/dump); **[S]** = stima o aritmetica derivata. Se assente: **NON TROVATO**.

---

## K1 — Path IQ2_XXS / IQ3_XXS su ARM in ggml (oggi)

### Codice locale (submodule BigMoeOnEdge)

File: `BigMoeOnEdge/third_party/llama.cpp/ggml/src/ggml-cpu/arch/arm/quants.c`  
Hash SHA256 identico a `llama.cpp/` di root del monorepo (stesso blob). **[V]**

| Funzione | Path | Meccanismo |
|----------|------|------------|
| `ggml_vec_dot_iq2_xxs_q8_K` | `#if defined(__ARM_NEON)` ~L3631–3683 | Lookup griglia `iq2xxs_grid` (8 valori/indice) + signs `keven_signs_q2xs` + `vmulq_s8` + **`ggml_vdotq_s32`** |
| `ggml_vec_dot_iq3_xxs_q8_K` | idem ~L3864–3916 | Lookup `iq3xxs_grid` + signs + `vmulq_s8` + **`ggml_vdotq_s32`** |

**Vettorizzato davvero?** Sì sul prodotto scalare int8 e sulle scale, **no** sul dequant della griglia:

1. Indici griglia estratti da `aux8[]` / `q3[]` in modo **scalare** (indice → `vld1_s8` da tabella).
2. Signs caricati da tabella 64-bit con mask bitfield (gather da `signs64`).
3. Accumulo con `ggml_vdotq_s32` (4× int8×int8→int32 per lane NEON).
4. Scale float scalari (`sumf1/sumf2`) applicate per blocco 32.

Quindi: **dominato da gather di griglia + signs**, non da un matmul denso puro. Il “kernel lento” delle i-quant è strutturale (codebook), non “manca solo il NEON”. **[V]** codice locale.

`assert(nrc == 1)`: path `vec_dot` = **solo GEMV** (batch=1). GEMM multi-riga usa altri path `mul_mat` / repack Q4_0_4_4 ecc., non un `iq2_xxs` multi-row dedicato in mainline. **[V]**

### DotProd / i8mm / SVE2 e 8 Gen 2

| Feature | 8 Gen 2 (X3/A715/A710) | Uso in ggml per i-quant |
|---------|------------------------|-------------------------|
| **DotProd** (`vdotq_s32`, FEAT_DotProd) | **Sì** (ARMv8.4+, presente su Cortex-X3/A715) | `ggml_vdotq_s32` → macro `vdotq_s32` se `__ARM_FEATURE_DOTPROD` **[V]** `ggml-cpu-impl.h` L307–319 |
| **I8MM** (`smmla`, FEAT_I8MM) | **Sì** su X3 (TRM Cortex-X3 elenca FEAT_I8MM) **[V]** [Arm TRM](https://developer.arm.com/documentation/101593/0101/The-Cortex-X3--core/Supported-standards-and-specifications) | Usato su path **K-quant / Q4_0 GEMM multi-riga**, **non** sul `vec_dot` IQ2/IQ3_XXS (nrc=1) **[V]** quants.c (rami `#if defined(__ARM_FEATURE_MATMUL_INT8)` su Q4/Q6, assenti su IQ2_XXS) |
| **SVE2 / SME** | **No** sull’8 Gen 2; SME/SVE compaiono su gen successive (es. 8 Elite) **[S]** da leak/bench pubblici, non da TRM S23 | KleidiAI SME2 irrilevante qui |

Fallback senza DotProd (L309–315): stessa somma totale, **lane grouping diverso** — commento esplicito che non è bit-identico a `vdotq_s32` se si ispezionano le lane. Con DotProd presente (nostro device) il path nativo è attivo. **[V]**

### Mainline vs submodule: c’è un cherry-pick gratis?

- `arm/quants.c` del submodule e della copia monorepo: **byte-identici** (SHA256 uguale, 2026-08-09). **[V]**
- Ricerca PR mainline 2025–2026 che migliorino specificamente **IQ2_XXS/IQ3_XXS ARM NEON** (oltre al path già presente): **NON TROVATO** un delta “kernel IQ2 ARM 2× più veloce” upstreamato.
- Ottimizzazioni ARM recenti mainline/blog:
  - **I8MM su Q4_K/Q6_K** (Arm Community, 2025-06-27) — non i-quant.  
    Fonte: <https://developer.arm.com/community/arm-community-blogs/b/ai-blog/posts/optimize-llama-cpp-with-arm-i8mm-instruction>
  - **KleidiAI / SME2** per Q4_0 packing + matmul — non IQ2/IQ3.  
    Fonte: <https://learn.arm.com/learning-paths/mobile-graphics-and-gaming/performance_llama_cpp_sme2/kleidiai_integration/>
  - **Q4_0_4_4 / row-interleave** su ARM (competitivo vs ik per Q4_0) — non i-quant. Discussione ik #164.  
    Fonte: <https://github.com/ikawrakow/ik_llama.cpp/discussions/164> (2024-12-24)

**Conclusione K1:** non c’è un cherry-pick mainline che “regali” i kernel i-quant; il path NEON c’è già ed è gather-bound. **Verdetto: GIALLO** (base solida DotProd, ma soffitto del format è il dequant; zero free lunch upstream).

---

## K2 — Prior art: ik_llama.cpp e affini

### ik_llama.cpp (ikawrakow) — prior art centrale

- Fork MIT di llama.cpp (badge License MIT sul README). Ultimo sync mainline dichiarato ~agosto 2024; sviluppo indipendente continuo.  
  Fonte: <https://github.com/ikawrakow/ik_llama.cpp> (README, 2026-08-09) **[V]**
- Kernel CPU unificati: `ggml/src/iqk/iqk_mul_mat.cpp` (+ flash-attn iqk). File monolitico multi-migliaia di linee; build Android/Termux dichiarata funzionante (PR #336, 2025-04-21). **[V]**
- **`-rtr`**: repack runtime di tutti i tensori in RAM in formato **row-interleaved** (`*_R4` / simili) al load. Critico per le prestazioni TG e PP. **[V]** README.
- Autore **non intende upstreamare** a llama.cpp (discussion #164, 2025-01-23). **[V]**

#### Speedup PUBBLICATI su ARM_NEON (M2-Max) — densità LLaMA 7B/8B

**A) Prompt processing = GEMM (pp512)** — Jan 2025 wiki, *senza* dettagli `-rtr` nel setup script ma confronto ik vs mainline:  
Fonte: <https://github.com/ikawrakow/ik_llama.cpp/wiki/Jan-2025:-prompt-processing-performance-comparison> (2025-01-21) **[V]**

| Quant | llama.cpp t/s | ik t/s | Speedup |
|-------|---------------|--------|---------|
| IQ2_XXS | 18.96 | 90.23 | **4.76×** |
| IQ3_XXS | 13.46 | 77.43 | **5.75×** |
| IQ3_S | 11.34 | 79.66 | **7.03×** |

**B) Token generation = GEMV (tg128), con `-rtr 1`** — discussion #164, 2024-12-24, 4 thread (allineato al nostro `-t 4`):  
Fonte: <https://github.com/ikawrakow/ik_llama.cpp/discussions/164> **[V]**

| Quant | llama.cpp t/s | ik+`-rtr` t/s | Speedup |
|-------|---------------|---------------|---------|
| **IQ2_XXS** | 8.67 | 12.28 | **1.42×** |
| **IQ3_XXS** | 6.26 | 8.54 | **1.36×** |
| IQ2_XS | 9.49 | 11.12 | 1.17× |
| IQ2_M | 6.77 | 8.90 | 1.32× |
| Q2_K_S | 13.91 | 23.49 | 1.69× |
| Q4_0 | 23.89 | 23.43 | 0.98× (mainline già forte) |

**C) TG senza repack aggressivo (July 2024 wiki)** — IQ2_XXS NEON ~**1.03–1.07×** solo:  
Fonte: <https://github.com/ikawrakow/ik_llama.cpp/wiki/July-2024:-Token-generation-performance-comparison> **[V]**

| Fonte | GEMV IQ2_XXS ARM | Note |
|-------|------------------|------|
| July 2024 wiki | **~1.03–1.07×** | senza story `-rtr` completa |
| Dec 2024 #164 + `-rtr` | **~1.42×** @ 4 thr | **numero da usare per il soffitto decode** |
| Jan 2025 wiki | solo PP | GEMM 4.7× |

**Implicazione:** il grosso del premio GEMV su i-quant ARM **non** è “un loop NEON più furbo sul layout stock”, ma **layout repacked + kernel iqk**. Senza repack, il GEMV IQ2_XXS è quasi a plateau.

#### Portabilità / invasività nel nostro fork

| Aspetto | Stato |
|---------|--------|
| Licenza | MIT → legalmente portabile **[V]** |
| Superficie | `iqk_mul_mat.cpp` + dispatch mul_mat/mul_mat_id + tipi `_R4` + opzione `-rtr` = **invasivo** (fork intero, non un file) **[V]** |
| Divergenza base | ik ~sync ago 2024 vs nostro ~2026 → merge/port = **mesi-persona** se si tenta integrazione full **[S]** |
| Android | build Termux ok (PR 336) **[V]**; NON TROVATO bench IQ2_XXS TG su Snapdragon 8 Gen 2 |
| MoE | `iqk_mul_mat_moe` esiste; bug storici su `_R4` + MoE (assert `nrc_x%4==0`, fix #170) **[V]** discussion #164 |

### Altri prior art

| Progetto | Cosa copre | Rilevanza i-quant ARM GEMV |
|----------|------------|----------------------------|
| **llamafile / jart matmul** | F16/Q8_0 CPU, tile/packing | **NON TROVATO** kernel IQ2_XXS; focus PP F16/Q8. Fonte: <https://justine.lol/matmul/> (2024-03-31) |
| **KleidiAI** | Q4_0 / int4 pack + SME2/NEON matmul | **Non copre IQ2/IQ3** codebook. Fonte learning path Arm (sopra) **[V]** |
| **Arm I8MM blog** | Q4_K / Q6_K | Non i-quant **[V]** |
| **arxiv 2501.00032** (optimized 2-bit ARM) | Conferma: IQ2_S ha **alto overhead dequant** (indice + codebook) anche con kernel ottimizzati vs Q2_K | Supporta il quadro “gather-bound” **[V]** <https://arxiv.org/html/2501.00032v1> (2024-12) |

**Verdetto K2: VERDE** sul prior art (numeri ARM TG/PP pubblicati, MIT, path chiaro). **GIALLO** sul porting full-fork (invasivo). Premio decode realistico ~1.3–1.4× sul *kernel GEMV i-quant*, non 4–7× (quello è PP).

---

## K3 — Soffitto fisico: GEMV IQ2 compute-bound o memory-bound?

### Shape e byte reali (nostro GGUF)

Dump: `results/gguf_ud-iq2m_dump.txt` (F0.6, 2026-08-03). **[V]**

| Tensore | Shape (per layer) | dtype | Byte / esperto |
|---------|-------------------|-------|----------------|
| `ffn_gate_exps` | (2048, 512, 256) | IQ2_XXS (16) | 270 336 B |
| `ffn_up_exps` | (2048, 512, 256) | IQ2_XXS (16) | 270 336 B |
| `ffn_down_exps` | (512, 2048, 256) | IQ3_XXS (18) | 401 408 B |
| **Totale / esperto** (37/40 layer) | | | **942 080 B ≈ 0.898 MiB** |

GEMV decode per esperto attivo (batch=1):

- gate: **2048×512** IQ2_XXS × q8  
- up: **2048×512** IQ2_XXS × q8  
- down: **512×2048** IQ3_XXS × q8  

Naive peso esperti / token: 8 × 40 × 942 080 = **301.5 MB/token** (0% hit). **[V]** PLAN + dump.  
Traffico flash misurato con cache 2000 + drop: **~41–54 MiB/tok** (hit 75–87%). **[V]** PLAN.

### Aritmetica bandwidth vs tempo

LPDDR5X 8 Gen 2: bus 4×16-bit @ ~4200 MHz → **~67 GB/s teorici** peak.  
Fonti: <https://nanoreview.net/en/soc/qualcomm-snapdragon-8-gen-2>, cpu-monkey (67.0 GB/s). **[V]** secondarie ma coerenti; sustained mobile tipicamente 30–50% del peak **[S]**.

**Ipotesi upper-bound “solo leggere i byte esperti dalla DRAM”** (100% hit, zero compute):

\[
t_{\text{mem,exp}} = \frac{0.3015\,\text{GB}}{B_{\text{eff}}}
\]

| \(B_{\text{eff}}\) | \(t_{\text{mem,exp}}\) | tok/s se *solo* esperti e *solo* banda |
|--------------------|------------------------|----------------------------------------|
| 10 GB/s (pessimistico sustained) | 30.2 ms | 33 |
| 20 GB/s | 15.1 ms | 66 |
| 40 GB/s | 7.5 ms | 133 |

Decode campagna: **~4.4 tok/s** → **~227 ms/token**.  
Se esperti = **50% del calcolo** e calcolo ≈ 80% del wall (I/O 20%):  
tempo esperti ≈ \(0.5 \times 0.8 \times 227 \approx 91\) ms/token. **[S]** da frazioni PLAN.

91 ms per 301 MB → **~3.3 GB/s** di banda *implicita* se il tempo fosse 100% memory. Peak 67 GB/s → utilizzo **~5%**.  
**Conclusione: il GEMV esperti è COMPUTE-BOUND (dequant/griglia + aritmetica), non memory-bound.** Un kernel migliore *può* pagare; non siamo al muro della DRAM. **[S]** aritmetica + frazioni campagne **[V]**.

Coerente con arxiv 2501.00032: a basso thread count TG 2-bit è compute-bound e IQ2 codebook soffre. **[V]**

### Perché allora ik dà solo ~1.4× su TG e non 5×?

Perché il 5× è **GEMM** (pp512, molte righe, tiling `_R4`).  
Il GEMV (nrc=1) non riusa i pesi su più attivazioni: il gather di griglia resta per-elemento; il repack aiuta locality/scales/unrolling ma non trasforma il problema in matmul denso. **[V]** tabelle ik.

### Upper bound end-to-end (Amdahl)

Frazione wall decode attribuita al GEMV esperti: **f ≈ 0.4** (50% calcolo × ~80% wall non-I/O; allineato al mandato). **[S]**

\[
S_{\text{e2e}} = \frac{1}{(1-f) + f/g}
\]

| g (speedup kernel esperti) | Fonte g | \(S_{\text{e2e}}\) | Δ decode |
|----------------------------|---------|--------------------|----------|
| 1.05 | TG IQ2_XXS senza repack (July 2024) | 1.02 | **+2%** |
| **1.36** | TG IQ3_XXS +rtr @4t (#164) | 1.11 | **+11%** |
| **1.42** | TG IQ2_XXS +rtr @4t (#164) | **1.13** | **+13%** |
| 1.60 | ottimistico, non misurato su i-quant ARM TG | 1.18 | +18% |
| 2.00 | quasi-soffitto se g raddoppia solo gli esperti | 1.25 | +25% |
| 4.76 | **PP** IQ2_XXS (irrilevante al decode batch=1) | 1.43 | +43% *(non applicabile a decode)* |

**Decode premio realistico con prior art ik+repack: ~+10–15% tok/s**, non +40–50%.  
Prefill (ubatch 512): g~4–5× sugli esperti *se* portassimo iqk GEMM → potenzialmente grosso, ma **il prefill “è già a posto”** (mandato) e non è il collo campagna. **[S]**

Caveat device: numeri ik su **M2-Max** (BW e core diversi). Su 8 Gen 2 a freq termica ~41% del picco il g relativo può spostarsi; **solo uno spike on-device chiude**.

**Verdetto K3: VERDE** (c’è headroom compute; non siamo memory-capped). Soffitto e2e decode **modesto** (~+15% se g≈1.4).

---

## K4 — Repack al fill: l’angolo che solo noi abbiamo

### Perché il vecchio “repack irraggiungibile” va rivalutato

In mainline llama.cpp i buffer type/repack avvengono al load del tensore intero.  
Nel fork, gli esperti **non** stanno tutti in RAM: `ExpertStreamSource::read_slice` fa `readers_[].read(lane, j.dst, j.off, j.nbytes)` — byte grezzi flash → buffer anonymous LRU. **[V]** `core/src/moe/expert_stream_source.cpp` L324–346.

Il punto di fill è **nostro**: dopo la read (o in-line) si può trasformare IQ2_XXS stock → layout row-interleaved stile `_R4` / ik **prima** di marcare `cvalid_`. Architetturalmente **fattibile**. **[V]** codice + mandato.

### Costo repack vs riuso

| Quantità | Valore | Fonte |
|----------|--------|-------|
| Size esperto mediana | 0.942 MB | dump **[V]** |
| Hit rate decode | 75–87% (tip. ~77–79% multi-turno, ~85% sostenuto) | PLAN **[V]** |
| Cache | 2000 MB ≈ **~2120** slot esperti (0.942 MB) | PLAN **[V]** |
| Misses / token (ordine) | (1−hit)×8×40 ≈ 40–80 miss | **[S]** |

Se repack costa \(c\) volte una memcpy dell’esperto:

- A hit rate 80%: ogni esperto caricato è riusato in media **5×** prima dell’evict (ordine di grandezza; dipendenza da locality di routing). **[S]**
- Costo amortizzato ≈ \(c/5\) per uso. Se repack ≈ 2–5× memcpy (transform indici/scale, tipico) e memcpy 1 MB su DRAM mobile ≈ decimi di ms, il costo fill resta **≪** 91 ms di GEMV. **[S]**
- I/O esposto è 20%: anche un repack che raddoppi il tempo miss aggiunge frazione piccola se hit è alto. **[S]**

### Footprint

- `_R4` / row-interleave ik: in genere **stesso bpw**, layout diverso (padding eventuale a multipli di 4 righe).  
- Assert storici `nrc_x % 4 == 0` sui kernel `_R4` (discussion #164): le **righe processate** devono allineare; le nostre dim  
  - gate/up: K=512, M=2048 → 2048%4=0  
  - down: K=2048, M=512 → 512%4=0  
  → **compatibili** con tiling a 4. **[V]** shape dump + assert ik.
- Overhead footprint: tipicamente **0–piccoli %** (padding). NON TROVATO un numero ufficiale “R4 = +X% size” per IQ2_XXS; trattare come **≤ pochi percento** finché non misurato. **[S]**
- Cache 2000 MB: se +5% size → slot ~2019 invece di 2120 (−5% capacità) → hit rate in calo lieve; da misurare, non un deal-breaker a priori. **[S]**

### Rischio

- Kernel `_R4` devono vivere nel binary che fa mul_mat_id sugli esperti (oggi ggml stock).
- Senza i kernel, repack al fill è inutile (o peggio).
- Trasformazione deve essere **esatta** rispetto al dequant atteso dal kernel target (stesso codebook).

**Verdetto K4: VERDE** (angolo architetturale reale e ammortizzabile a hit 77–87%). Dipende da K2 (kernel).

---

## K5 — Numerica e gate di campagna

### Byte-identità 8/8

Kernel nuovi / ordine di riduzione diverso / `vdot` vs fallback / accumulo float parziale → **output NON bit-identico** in generale.  
ggml stesso documenta che il fallback DotProd “produces the same total sum … but with different per-lane grouping”. **[V]** `ggml-cpu-impl.h` L309.

ik e llamafile **non** promettono bit-identity vs mainline; il metro di qualità è PPL / coerenza, non memcmp dei logits. **[S]** (prassi ecosistema; NON TROVATO un flag “strict bit-identical kernels” in ik).

Impatto campagna:

| Gate | Impatto |
|------|---------|
| **G1 8/8 byte-identico** | **Si rompe** se si cambia il path matmul esperti. Va **ri-baselinato** o scisso: “8/8 solo su path scorer-off senza kernel alt” vs “qualità PPL”. Flag di prodotto, non bug del kernel. |
| **PPL decode-path, budget Δ 0.15** | Kernel **esatto in teoria** (stessa quantizzazione, solo ordine FP) → ΔPPL atteso **≈ 0** o rumore numerico ≪ 0.01. **Non consuma budget lossy** se verificato. **[S]** |
| Metro non-regressione | Nuova baseline PPL + golden short prompts; confrontare vs 2.0955 decode-path. |

### Cosa fare in pratica

1. Spike: misurare PPL decode-path ik vs nostro binary sulle **stesse** sequenze (stesso seed, greedy).  
2. Se ΔPPL < 0.02 e testo grezzo indistinguibile → accettare loss di bit-identity.  
3. Documentare nel protocollo: gate 8/8 applicabile solo a leve *lossless bit-exact* (drop-cold off, stesso binary).

**Verdetto K5: GIALLO** (gate 8/8 da ridefinire; PPL ok se kernel esatti).

---

## K6 — Costo del cantiere, onesto

### Storia: quanto è costato ad altri?

| Artefatto | Effort (evidenza) | Note |
|-----------|-------------------|------|
| iqk_mul_mat + famiglie `_R4` | **Anni-persona** di ikawrakow (fork da mid-2024, centinaia di PR quant/kernel) | Non un weekend. README + timeline PR **[V]** |
| Port I8MM Q4_K/Q6_K Arm | Paper/blog engineering team Arm, PR mirati | Scope stretto K-quant **[V]** |
| KleidiAI integration mainline | Team Arm + community, mesi | Q4_0/SME, non IQ2 **[V]** |

### Tre vie per NOI

| Via | Costo stimato | Rischio | Speedup atteso decode | Fonte g |
|-----|---------------|---------|----------------------|---------|
| **(a) Cherry-pick mainline** se già migliorato | **0.5–1 p-settimana** (verifica + build) | Basso | **~1.0×** (nulla da cogliere su IQ2 ARM) | K1 **[V]** |
| **(b) Porting kernel ik (iqk + opz. repack fill)** | **4–10 p-settimane** integrazione selettiva; **>>12** se merge full fork | Alto (divergenza 2024↔2026, MoE mul_mat_id, ABI streaming) | g_kernel **1.3–1.4×** → e2e **+10–15%** se rtr+iqk | #164 **[V]**; costo **[S]** |
| **(c) Scrittura ex-novo** kernel IQ2_XXS/IQ3_XXS NEON + layout | **6–15 p-settimane** per avvicinarsi a ik | Altissimo | Incerto; soffitto ≤ ik | storia prior art **[S]** |

**Via più corta onesta:**  
1. **Spike fail-fast (sotto)** con ik vanilla su Termux — **1–3 giorni**.  
2. Se GO: **port selettivo** solo dispatch `mul_mat`/`mul_mat_id` per IQ2_XXS/IQ3_XXS + repack al fill (non l’intero fork). **[S]**  
3. **Non** scrivere ex-novo. **Non** aspettarsi cherry-pick gratis.

**Verdetto K6: GIALLO** (via (b) selettiva ha senso *solo* se lo spike misura g≥1.25 sul GEMV delle nostre shape).

---

## Sintesi

### 1. Tabella K1–K6

| K | Domanda | Verdetto | Perché (1 riga) | Fonte primaria |
|---|---------|----------|-----------------|----------------|
| **K1** | Path ARM oggi / DotProd / cherry-pick | **GIALLO** | NEON+DotProd già attivi; gather griglia domina; mainline non regala kernel IQ2 | `arm/quants.c`, `ggml-cpu-impl.h` **[V]** |
| **K2** | Prior art ik / altri | **VERDE** | ARM TG IQ2_XXS **1.42×** con `-rtr`; PP 4.7×; MIT; KleidiAI/llamafile non coprono IQ2 | ik #164, wiki Jan/July **[V]** |
| **K3** | Compute vs memory / soffitto e2e | **VERDE** (headroom) / soffitto e2e **modesto** | ~3 GB/s impliciti vs 67 peak → compute-bound; Amdahl f=0.4 g=1.42 → **+13%** | dump+PLAN+ik **[V]/[S]** |
| **K4** | Repack al fill | **VERDE** | Fill `read_slice` nostro; hit 77–87% ammortizza; shape %4=0 | `expert_stream_source.cpp` **[V]** |
| **K5** | Numerica / gate 8/8 | **GIALLO** | Bit-identity rotta; PPL da ri-baselinare, budget lossy non toccato se esatto | ggml-cpu-impl note **[V]** |
| **K6** | Costo cantiere | **GIALLO** | Spike 1–3g; port selettivo 4–10 p-sett; full fork/ex-novo no | effort **[S]** + bench **[V]** |

**Verdetto aggregato campagna kernel: GIALLO — non ROSSO, non VERDE go-full.**  
Merita **spike fail-fast**. Non merita ancora un cantiere multi-settimana senza numeri on-device.  
Se lo spike dà g_kernel < 1.2 sulle nostre shape → **ROSSO operativo** (chiudere e non porting).

### 2. Stima end-to-end onesta

**Decode (premio campagna, batch=1, GEMV):**

```
baseline ≈ 4.4 tok/s
f_expert ≈ 0.4 del wall
g_kernel ∈ [1.05, 1.42]   # da prior art ARM; da sostituire con misura S23

S = 1 / ((1-f) + f/g)

caso base (g=1.42, #164 +rtr):  S ≈ 1.13  →  ~5.0 tok/s  (+13%)
caso deluso (g=1.15):           S ≈ 1.05  →  ~4.6 tok/s  (+5%)
caso flop   (g=1.05):           S ≈ 1.02  →  ~4.5 tok/s  (+2%)
```

**Prefill (ubatch 512, GEMM):** g potenzialmente 3–5× sugli esperti (wiki Jan 2025) → e2e prefill potenzialmente grande, ma **non è il collo** e non giustifica il cantiere da solo. **[V]/[S]**

**Non vendere il 4.7× del PP come speedup decode.**

### 3. Spike fail-fast raccomandato

**Obiettivo:** misurare g_kernel GEMV IQ2_XXS/IQ3_XXS *sulle shape vere* su S23, **prima** di toccare BigMoeOnEdge.

#### S0 — setup (giorno 0–1)

1. Termux su S23 (come build campagna).  
2. Clone `ikawrakow/ik_llama.cpp`, build CPU `cmake -B build -DGGML_NATIVE=ON` (PR 336 path Android).  
3. Build nostro `llama-bench` / binary BigMoe **senza** streaming, **oppure** usare `llama-bench` del submodule per densità di controllo.  
4. Modello di micro-bench:  
   - **Opzione A (consigliata):** estrarre/costruire GGUF toy con **un** tensore IQ2_XXS shape (2048, 512) e uno IQ3_XXS (512, 2048) — o usare un layer esportato.  
   - **Opzione B (più grezza):** LLaMA-3.1-8B IQ2_XXS denso (come ik) solo per validare che i numeri #164 si riproducono su 8 Gen 2 (±20%).  
5. Thread: **`-t 4`** (parità campagna). Thermal: idle → run → annotare die °C.

#### S1 — misure

| ID | Comando / setup | Metrica |
|----|-----------------|---------|
| M1 | mainline/submodule `llama-bench -m <IQ2_XXS> -p 0 -n 128 -t 4 -ngl 0` | tg t/s |
| M2 | ik `llama-bench ... -rtr 1` stesso modello | tg t/s |
| M3 | come M1/M2 ma `-p 512 -n 0` | pp t/s (controllo GEMM) |
| M4 | micro-bench shape (2048×512 IQ2, 512×2048 IQ3), N iter, ms/iter | ns/byte o GFLOPS-eq |
| M5 | (opz.) PPL o 32 token greedy vs binary campagna su prompt corti | Δ qualità |

#### Soglie GO / NO-GO

| Esito M2/M1 su **TG** (o M4 shape-matched) | Decisione |
|--------------------------------------------|-----------|
| **g ≥ 1.30** su IQ2_XXS @ `-t 4` | **GO** port selettivo iqk + design repack-al-fill (K4). Budget 4–8 p-sett. |
| **1.20 ≤ g < 1.30** | **GO condizionato**: solo se repack-al-fill è ≤ 1 p-sett *e* e2e stimato ≥ +8% (f misurato con profiler). |
| **g < 1.20** | **NO-GO cantiere kernel**. Chiudere. Alternativa sotto. |
| Build ik Termux fallisce / crash MoE | documentare; fallback micro-bench denso; se denso g≥1.3 ma MoE non linka → GIALLO port, non ROSSO fisica. |

**Non** iniziare porting nel fork finché S0–S1 non sono verdi.  
**Non** ottimizzare prefill in questo spike.

### 4. Se ROSSO (o NO-GO spike): alternative chiare

1. **Non** “kernel a mano ex-novo”.  
2. **Attendere upstream** solo se compare un PR mainline IQ2 ARM con numeri TG ≥1.3× — oggi **non** c’è.  
3. **Integrazione Kalsa / altre leve compute** (fuori scope di questo mandato; candidati PLAN: non GPU OpenCL, non MTP).  
4. **Riquant “più veloce da dequant”** (es. pezzi in Q4_0_4_4 / Q4_K) — PLAN già dice che requant **pareggia** (guadagno calcolo ≈ penale qualità/byte); non riaprire senza nuova evidenza.  
5. **Accettare plateau ~4.4 tok/s** come soffitto onesto del percorso flash+CPU su S23 per questo quant, e investire in leve non-compute (UX, qualità a parità speed, energy).

Non addolcire: **anche nel best case prior-art, il decode guadagna ~10–15%, non un raddoppio.** Se la campagna ha bisogno di ≥1.5× decode, **i kernel i-quant CPU non sono la leva**.

---

## Appendice A — Riferimenti primari

| # | URL | Data | Uso |
|---|-----|------|-----|
| 1 | Locale `ggml/.../arm/quants.c` (IQ2/IQ3 vec_dot) | submodule `e5605f3bd` | K1 |
| 2 | Locale `ggml-cpu-impl.h` (`ggml_vdotq_s32`) | idem | K1, K5 |
| 3 | Locale `results/gguf_ud-iq2m_dump.txt` | 2026-08-03 | shape/byte |
| 4 | Locale `core/src/moe/expert_stream_source.cpp` | fork | K4 fill |
| 5 | <https://github.com/ikawrakow/ik_llama.cpp> README | 2026-08-09 | MIT, -rtr, Android |
| 6 | <https://github.com/ikawrakow/ik_llama.cpp/discussions/164> | 2024-12-24 | ARM TG+PP +rtr |
| 7 | <https://github.com/ikawrakow/ik_llama.cpp/wiki/Jan-2025:-prompt-processing-performance-comparison> | 2025-01-21 | ARM PP i-quant |
| 8 | <https://github.com/ikawrakow/ik_llama.cpp/wiki/July-2024:-Token-generation-performance-comparison> | 2024-07 | ARM TG senza rtr story |
| 9 | <https://arxiv.org/html/2501.00032v1> | 2024-12 | overhead dequant IQ2 ARM |
| 10 | <https://developer.arm.com/community/arm-community-blogs/b/ai-blog/posts/optimize-llama-cpp-with-arm-i8mm-instruction> | 2025-06-27 | I8MM ≠ i-quant |
| 11 | <https://learn.arm.com/learning-paths/mobile-graphics-and-gaming/performance_llama_cpp_sme2/kleidiai_integration/> | 2025+ | KleidiAI Q4_0/SME2 |
| 12 | Arm Cortex-X3 TRM FEAT_I8MM | Arm docs | ISA 8 Gen 2 |
| 13 | PLAN.md (hit, MiB/tok, frazioni compute) | campagna | f, 41 MiB/tok |

## Appendice B — Micro-bench shape (copy-paste)

```
# Shape da dump UD-IQ2_M (per esperto, un layer tipico):
#   gate: IQ2_XXS  [ne0=512,  ne1=2048]   # ggml mul_mat: rows=2048, cols=512
#   up:   IQ2_XXS  [ne0=512,  ne1=2048]
#   down: IQ3_XXS  [ne0=2048, ne1=512]
# Byte: 270336 + 270336 + 401408 = 942080
#
# GEMV batch=1:
#   y_gate[2048] = W_gate[2048,512] @ x[512]
#   y_up[2048]   = W_up[2048,512]   @ x[512]
#   y_down[512]  = W_down[512,2048] @ (silu(gate)*up)
```

---

**STOP.** GO/NO-GO di gualt sul solo esito dello spike S0–S1. Nessun altro file di prodotto modificato da questo report.
