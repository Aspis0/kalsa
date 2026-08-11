# Research: pruning/sparsità MoE orientata alla VELOCITÀ (decode CPU edge)

**Data ricerca:** 2026-08-11  
**Mandato:** `mandates/research-speed-pruning.md`  
**Scope:** solo ricerca web + contesto locale read-only. Niente build, niente device.  
**Domanda:** cosa riduce i **FLOP attivi per token** o accelera il decode MoE su CPU/ARM edge, senza pretraining pesante (LoRA-light RunPod ok).

**Metodo citazioni:** `[V]` = fonte primaria (arXiv / GitHub / HF) con URL e data di pubblicazione/versione consultata.  
**NON TROVATO** dove manca evidenza primaria applicabile.

---

## 0. Contesto numerico nostro (Amdahl — numeri da usare)

Fonte locale (non web): `PLAN.md` STATO CORRENTE, `reports/moe-adopt-kexp.md`.

| grandezza | valore | note |
|---|---|---|
| modello campagna | KEXP qwen35moe, 256 exp, k=6, drop-cold 0.65 | opzione A 2026-08-10 |
| decode med | **5.86 tok/s** (k6d065, n=200 staccato) | ctrl k8d065: 5.16 |
| PPL decode | **1.852** (k6d065); floor storico 2.0955 | budget ΔPPL cumulativo ≤0.15 vs baseline **originale** (non vs k6) |
| collo | **compute-bound** | I/O esposto ≈ **20%** del decode wall |
| frazione GEMV/GEMM esperti | ≈ **40% wall** | GEMM esperti 50.5% del compute × ~80% compute/decode ≈ 40% |
| drop-cold attuale | miss-only: drop se MISS ∧ weight < thr ∧ non-top | residenti **sempre** calcolati |
| chiusi | REAP pool (+0–5%), ik (g<1), OpenCL S23, prefetch cross-layer, k statico ≤5 storico (ΔPPL grosso su IQ2) | non riaprire senza fatto nuovo |

### Formula Amdahl esplicita

Sia \(f\) la frazione di wall time del pezzo che acceleriamo, \(g\) il speedup su quel pezzo:

\[
S_{\text{e2e}} = \frac{1}{1 - f + f/g}, \qquad
\Delta\% = (S_{\text{e2e}} - 1)\times 100
\]

**Default:** \(f_{\text{exp}} = 0.40\) (GEMV esperti sul wall).  
Altri pezzi: I/O 0.20, non-esperto (att + shared + router + overhead) ≈ 0.40.

Esempi di riferimento:

| leva su esperti | \(g\) | \(S_{\text{e2e}}\) | tok/s atteso da 5.86 |
|---|---|---|---|
| k 6→5 (−16.7% FLOP esperti) | 6/5 = 1.20 | 1.071 | **6.28** (+7.1%) |
| k_eff 6→4.5 (−25%) | 1.333 | 1.111 | **6.51** (+11.1%) |
| k_eff 6→4 (−33%) | 1.50 | 1.143 | **6.70** (+14.3%) |
| −20% FLOP solo su esperti (compress/sparse) | 1.25 | 1.087 | **6.37** (+8.7%) |
| −50% FLOP esperti (sparse kernel ideale) | 2.0 | 1.250 | **7.33** (+25%) |
| solo I/O −50% (f=0.20) | 2.0 | 1.111 | **6.51** (+11%) — **non** è il collo |

**Regola d’oro:** su questo silicio, leve che tagliano solo I/O o solo il pool offline valgono poco se non riducono i matmul attivi. Leve che richiedono kernel sparse custom su IQ2/ARM hanno \(g_{\text{reale}}\) spesso ≪ \(g_{\text{ideale}}\).

---

## 1. Aree di ricerca (7)

### 1.1 k dinamico / expert-skipping adattivo

**Meccanismo.** Invece di top-\(k\) fisso, il numero di esperti attivi \(k_t\) dipende dal token (e a volte dal layer): soglia su probabilità router, top-p cumulativo, sensitivity, o un propositor di \(k\).

| variante | training? | FLOP attivi? | tooling | fonte |
|---|---|---|---|---|
| **Top-p / cumulative threshold** (MoE-Dynamic) | training-from-scratch + reg entropy nel paper; **a inferenza** la regola top-p è applicabile one-shot su modello top-k pretrain | sì, \(k\) medio ↓ | nessuna lib edge; patch router | [V] Huang et al. ACL 2024, arXiv:2403.07652 (2024-03-12) https://arxiv.org/abs/2403.07652 |
| **AdapMoE sensitivity gating** | **no finetune** del modello: offline Fisher/sensitivity su calib + soglia \(T\); −25% esperti attivi, 1.35× e2e **su GPU offload Mixtral** | sì | [V] GitHub PKU-SEC-Lab/AdapMoE | [V] Zhong et al. ICCAD’24, arXiv:2408.10284 (2024-08-19) https://arxiv.org/abs/2408.10284 |
| **Ada-K** | **sì, light**: solo proiezione \(W_p\) (~M params) + PPO; 1.22× su Qwen1.5-MoE-A2.7B (report secondario HF blog 2026-02-26 citando ICLR’25) | sì | paper ICLR’25 Ada-k routing | [V] Yue et al. ICLR 2025 “Ada-k routing” (cit. survey HF; paper conference) — arXiv search: Ada-k routing Boosting efficiency MoE |
| **DynMoE top-any** | **sì** (training completo con soglie θ) | sì, +11% thr put | [V] github.com/LINs-lab/DynMoE | [V] Guo et al. ICLR 2025 https://github.com/LINs-lab/DynMoE |
| **Null / zero-computation experts** (AdaMoE, MoE++, ZEDA) | **sì** (pretrain o post-train distill) | sì (null slot non calcola) | ZEDA: [V] github.com/TsinghuaC3I/ZEDA | [V] Zeng et al. EMNLP’24 AdaMoE; [V] Jin et al. ICLR’25 MoE++; [V] Lv et al. arXiv:2605.18643 (2026) ZEDA https://arxiv.org/abs/2605.18643 |
| **Score-only threshold (no Fisher)** | **no** training; soglia euristica su \(w_i\) | sì | patch 10–50 LOC sul top-k | prior art discusso in AdapMoE §2 come “Adap-gating” con **degradazione accuracy** se naive |

**Cosa funziona SENZA retraining (applicabile a noi)?**

1. **Soglia su peso router / top-p cumulativo** sui logits già prodotti dal router — zero training.  
   - AdapMoE dimostra che la soglia **score-only** degrada più della soglia **sensitivity** (layer-aware via Fisher offline).  
   - Fisher offline: forward+grad su set di calibrazione (GPU RunPod poche ore), **non** è LoRA del modello intero.  
2. **NON** Ada-K / DynMoE / null-experts **senza** adattamento: richiedono training o architettura diversa.

**ΔPPL / qualità riportati (letteratura, non nostri metri):**

- AdapMoE: “without accuracy degradation” su MMLU/ARC a ~24% single-expert activation su Mixtral top-2 quant 4-bit [V] arXiv:2408.10284.  
- MoE-Dynamic (top-p, trained): ~+1.7% task score e ~+5% thr put vs fixed-k [V] arXiv:2403.07652.  
- ZEDA: −50% expert FLOP, ~1.20× e2e, perdita marginale su 11 bench, Qwen3-30B-A3B [V] arXiv:2605.18643.  
- **ΔPPL numerico su qwen35moe / KEXP: NON TROVATO** in letteratura.

**Applicabilità qwen35moe/qwen3moe:** alta per threshold/top-p (stesso API top-k). Shared expert resta sempre-on (architettura Qwen).  
**Stima e2e nostra:** se \(k_{\text{eff}}\) medio scende 6→4.5 (−25% come AdapMoE): **+11%** wall → ~6.5 tok/s.  
**Attenzione:** il 1.35× di AdapMoE è su sistema **I/O-bound offload GPU** — il loro guadagno mescola meno load + meno compute. Da noi solo la parte compute conta → ceiling ~+11% non +35%.

**Costo:** patch fork + sweep soglia su PPL-decode device; opzionale calib Fisher su RunPod A100 ~ore, non settimane.

**Verdetto fattibilità nostra:** **VERDE** (threshold/top-p/sensitivity offline).

---

### 1.2 Drop-by-weight runtime (anche su HIT di cache)

**Meccanismo (nostra variante candidata).** Oggi `--drop-cold-experts` droppa solo se **MISS** ∧ weight basso ∧ non-top.  
**Drop-by-weight** = stessa soglia (o più aggressiva) **anche se l’esperto è residente**: si salta il GEMV, si ricalcola la somma pesata (renorm).

**Prior art:**

| pezzo | cosa dice | fonte |
|---|---|---|
| AdapMoE adaptive gating | riduce \(k\) per token/layer in base a sensitivity e score; indipendente da cache | [V] arXiv:2408.10284 |
| MoE-Dynamic top-p | attiva finché Σp ≥ p_thr | [V] arXiv:2403.07652 |
| Expert offloading systems (es. mixed-precision offload) | soglia \(T_2\) per **skip** esperti a bassa importanza su miss | [V] arXiv:2411.01433 (mixed precision expert offloading) — skip lato load, non pure compute-bound |
| BigMoeOnEdge drop-cold | miss-only (nostro stato) | locale |

**Curve qualità tipiche (letteratura):**

- Score-only aggressivo → crollo accuracy (AdapMoE confronta esplicitamente).  
- Sensitivity-calibrated ~−25% activation a parity accuracy (Mixtral).  
- **Curve PPL vs thr su qwen35moe: NON TROVATO** fuori dai nostri esperimenti drop-cold miss-only.

**Riduce FLOP attivi?** **Sì** — è esattamente l’obiettivo (a differenza del drop-cold che su hit-rate 76–80% droppa poco compute: solo miss leggeri).

**Calcolo rough nostro:** a hit 78%, drop-cold 0.65 droppa ~5% delle selezioni (griglia speed).  
Drop-by-weight può droppare anche i ~78% hit se weight basso → potenziale 3–5× più skip di matmul rispetto a miss-only, a parità di thr.

**Stima e2e:**  
- se skip medio 1/6 esperti: \(g=1.2\) → **+7%** (~6.3 t/s)  
- se skip medio 1.5/6: \(g=1.33\) → **+11%** (~6.5 t/s)  
Gate qualità: ΔPPL decode ≤ budget cumulativo (leggere `PLAN`: ≤0.15 vs baseline **originale**, k6d065 ha già speso parte del budget — verificare headroom vs floor 2.0955: 1.852→max ~2.09 lascia ~0.24 di slack **vs floor prodotto**, ma il budget di campagna cumulativo va riletto prima di stackare leve).

**Training:** no.  
**Tooling:** estensione 1 flag del fork esistente.  
**Verdetto:** **VERDE** — massima densità valore/effort.

---

### 1.3 Expert merging (MC-SMoE e famiglia)

**Meccanismo.** Allinea permutazioni neuronali, raggruppa esperti simili via routing logits, media pesata per frequenza di attivazione (M-SMoE); poi low-rank + sparse sui merged (MC-SMoE).

| | M-SMoE | MC-SMoE |
|---|---|---|
| pool | ↓ fino ~60% memoria | ↓ fino ~80% |
| FLOP attivi a \(k\) fisso | **invariati** (stesso \(k\), esperti più “densi”) | **−~20% FLOP** dopo compress | 
| training | post-merge **finetune + KD** per qualità piena; zero-shot possibile ma peggiore | idem + decomposizione |
| riduce \(k\)? | **no** di per sé | no |

[V] Li et al. “Merge, Then Compress…”, arXiv:2310.01334 (2023-10), https://arxiv.org/abs/2310.01334 · code https://github.com/UNITES-Lab/MC-SMoE  
Risultati tipici: switch-base-32, memory −60–80%, TFLOPs 4.65→3.83 (−18%), task score entro ~1 pt dopo KD.

**Applicabilità:** teorica su 256 esperti Qwen, ma:

1. Merge offline su GGUF IQ2/KEXP: tooling **NON TROVATO** per GGUF MoE streaming.  
2. Senza sparse/low-rank post-merge, **nessun guadagno decode** sul nostro Amdahl (stesso \(k\)).  
3. Con compress −20% FLOP esperti: \(f=0.40\times0.20=0.08\) → \(S\approx1.04\) (**+4%**) se il kernel usa la forma compressa — **kernel IQ2+lowrank su ARM: NON TROVATO**.

**Costo RunPod:** calib routing + merge + KD/LoRA su 35B MoE = **giorni–settimane** multi-GPU, non “LoRA-light weekend”.  
**Verdetto:** **ROSSO** per velocità e2e ora; **GIALLO** solo se obiettivo futuro è footprint flash/pool (già coperto da REAP con +0–5% speed).

---

### 1.4 Pruning strutturato DENTRO gli esperti (Wanda/SparseGPT-style, one-shot)

**Meccanismo.** Pruna pesi FFN di ogni esperto con metrica \(|W|\cdot\|x\|\) (Wanda) o Hessian (SparseGPT); MoE-Pruner moltiplica anche i **router weights**.

[V] MoE-Pruner, arXiv:2410.12013 (2024-10-15) https://arxiv.org/abs/2410.12013  
- One-shot, no weight update.  
- Mixtral-8×7B WikiText PPL @50% sparse: dense 3.84 → MoE-Pruner **4.68** / Wanda 4.97 / SparseGPT 4.99.  
- “99% performance” **dopo** expert-wise KD — one-shot nudo **non** è free.  
- 2:4 semi-structured: peggioramento PPL più grosso ma accelerabile su GPU Ampere+.

**A 2–3 bpw (nostro regime IQ2 ~2.4 bpw esperti):**  
**NON TROVATO** paper che dimostri Wanda/SparseGPT *sopra* quantizzazione i-quant già aggressiva su MoE edge.  
Rischio: doppia sparsità (peso zero + quant low-bit) → collasso o guadagno nullo perché il kernel IQ2 non salta gli zeri non strutturati.

**Riduce FLOP attivi?** Solo con **kernel sparse**. Su CPU ARM + GGUF i-quant: sparse unstructured ≈ **nessun speedup** (spesso slowdown). 2:4 su Adreno/CPU: **NON TROVATO** path maturo in llama.cpp per esperti MoE.

**Stima e2e onesta:** \(g_{\text{reale}}\approx 1.0\)–1.05 senza kernel → **+0–2%**. Con kernel ideale 50%: +25% teorico — **non realistico** sul nostro stack in settimane.

**Costo:** calib GPU + export GGUF custom + eventuale KD.  
**Verdetto:** **ROSSO** (one-shot senza kernel non paga velocità; con healing diventa progetto grande).

---

### 1.5 Sparsità di attivazione runtime DENTRO gli esperti attivi (≠ predittore cross-layer)

**Meccanismo.** Dopo (o prima) del matmul, azzera attivazioni a bassa magnitudine e salta canali di peso (Deja Vu su ReLU; CATS/TEAL su SwiGLU training-free).

| metodo | ReLU-free? | training? | speedup reportato | fonte |
|---|---|---|---|---|
| Deja Vu | no (ReLU OPT) | predittore aux | ~2× OPT-175B GPU | [V] Liu et al. 2023 |
| CATS | sì (gate SiLU thr) | free o finetune | ~25% model-wide sparse | Lee et al. 2024 (cit. TEAL) |
| **TEAL** | sì, magnitude su **tutte** le matrici | **training-free** calib soglie | 40–50% sparse, **1.53–1.8×** decode GPU | [V] arXiv:2408.14690 (2024-08), https://arxiv.org/abs/2408.14690 · https://github.com/FasterDecoding/TEAL |
| ReLUfication / ProSparse | forza ReLU | **pretrain continuo** 10¹¹ token | alta sparse | Mirzadeh/Song et al. |

**Su SwiGLU:** sì, TEAL/CATS funzionano training-free su LLaMA/Mistral.  
**Su MoE esperti:** **NON TROVATO** paper TEAL-inside-MoE-experts su 256-exp edge; in teoria applicabile a gate/up/down di ogni esperto attivo.

**Perché da noi è debole:**

1. Intermediate expert dim **512** (gguf-dump) — sparse GEMV su 512 con overhead mask su CPU spesso non ripaga sotto ~50–60% sparse.  
2. Pesi già IQ2: kernel sparse+quant **assente** nel fork.  
3. TEAL speedup è **memory-bound GPU decode**; noi siamo **compute-bound CPU** con I/O 20% — il modello di guadagno non si trasferisce 1:1.  
4. Prefetch cross-layer neuron-level già **morto** (Recall@8 19%); questa è *intra*-expert, diversa, ma condivide il problema kernel.

**Stima e2e:** senza kernel, **~0%**. Con kernel magico 40% sparse solo su half del GEMV esperti: \(f\approx0.16\), \(g=1.4\) → \(S\approx1.05\) (**+5%**).  
**Verdetto:** **ROSSO** ora; riaprire solo se esiste sparse-IQ GEMV ARM misurato g>1.15.

---

### 1.6 Layer-level: Mixture-of-Depths, layer skip, early exit

| metodo | training? | note | fonte |
|---|---|---|---|
| Mixture-of-Depths | **sì** (router per layer, train) | token salta FFN | Raposo et al. 2024 arXiv:2404.02258 |
| LayerSkip | **sì** (layer dropout + early exit loss; cont. pretrain) | early exit + self-speculative | [V] arXiv:2404.16710 (2024-04) |
| Early exit naive su checkpoint stock | **no** | qualità tipicamente crolla | letteratura consensa: senza training non regge |

**Senza training è mai regato?**  
Evidenza primaria di early-exit/MoD **training-free** su MoE LLM a qualità produttiva: **NON TROVATO**.  
LayerSkip e MoD richiedono ricette di training esplicite.

**Stima e2e se 25% layer FFN skippati (post-train ideale):** frazione esperti skippata ~0.25×0.40 = 0.10 → \(S\approx1.05\) (**+5%**) se residual path corretto; su ibrido GDN+attention Qwen3.6 i layer non sono omogenei → rischio alto.

**Costo:** cont. pretrain / distill multi-GPU = fuori scope “LoRA-light”.  
**Verdetto:** **ROSSO**.

---

### 1.7 Router tricks & survey edge 2025–2026

**Shared-expert-only fast path.**  
Qwen35moe ha **1 shared + k routed**. Idea: token “facili” → solo shared (o shared + top-1).  

- Architetturalmente sensata (DeepSeek/Qwen shared path).  
- **ZEDA** (2026): inietta zero-experts + self-distill post-train → −50% expert FLOP, ~1.20× su Qwen3-30B-A3B [V] arXiv:2605.18643.  
- Heuristica training-free “se entropy router alta → k=0 routed”: **NON TROVATO** paper con ΔPPL accettabile su modelli stock.

**Stima e2e se 20% token solo-shared (k_routed=0):** risparmio \(0.20\times0.40=0.08\) → **+8.7%** se qualità tiene.

**Altri edge MoE 2025–26 (cenni, non leve compute pure):**

- **Fate** offload edge [V] arXiv:2502.12224 — I/O/offload, non il nostro collo.  
- **AdapMoE** — già §1.1.  
- Survey dinamici: HF blog Spico 2026-02-26 (secondario) cataloga threshold / proposer / null-experts.

**Verdetto shared-only training-free:** **GIALLO** (spike euristico barato; aspettativa qualità bassa).  
**Verdetto ZEDA-style:** **GIALLO** (paga FLOP, ma serve distill RunPod su 30B-class — ordine giorni multi-GPU, non free).

---

## 2. Tabella tecniche × criteri

Legenda verdetto: **VERDE** = fail-fast ≤1–2 sett, fit fork CPU + metro PPL; **GIALLO** = possibile ma dipendenze/kernel/training; **ROSSO** = non batte costo o non riduce compute attivo sul nostro silicio.

| # | tecnica | ↓ FLOP attivi? | training | tooling pubblico | qwen35/3moe | stima e2e (Amdahl \(f{=}0.4\)) | costo nostro | verdetto |
|---|---|---|---|---|---|---|---|---|
| 1a | top-p / thr router training-free | sì | no (+calib opz.) | patch | sì | +7–11% se \(k_{\text{eff}}\) 5–4.5 | ore–giorni device | **VERDE** |
| 1b | AdapMoE sensitivity | sì | offline Fisher only | GitHub GPU-centric | sì in principio | +11% (non 1.35×) | 1–3 g RunPod + port | **GIALLO** |
| 1c | Ada-K / DynMoE / null-exp train | sì | sì light–full | paper code | sì | +10–20% lit. | giorni–sett. | **GIALLO** |
| 2 | **drop-by-weight (hit+miss)** | **sì** | **no** | **fork flag** | **sì** | **+7–14%** | **1–3 g** | **VERDE** |
| 3 | MC-SMoE merge | no (solo pool) | FT+KD | UNITES-Lab | difficile GGUF | ~0% speed | alto | **ROSSO** |
| 3b | MC-SMoE + compress | sì ~20% exp | FT+KD | idem | kernel? | ~+4% se kernel | molto alto | **ROSSO** |
| 4 | Wanda/MoE-Pruner 50% | solo con sparse ker | one-shot; KD per recovery | paper | sì teorico | ~0% senza ker | medio | **ROSSO** |
| 5 | TEAL/CATS act-sparse in expert | sì teorico | calib free | TEAL GPU Triton | SwiGLU ok | ~0–5% CPU IQ2 | alto (kernel) | **ROSSO** |
| 6 | MoD / LayerSkip / early exit | sì se train | **sì** | limitato | ibrido rischioso | +5% ideale | alto | **ROSSO** |
| 7a | shared-only euristico | sì | no | patch | sì (ha shared) | +5–9% se 15–20% token | basso | **GIALLO** |
| 7b | ZEDA post-train dynamic | sì −50% exp FLOP | self-distill | TsinghuaC3I/ZEDA | Qwen3-30B affine | ~+15–20% teor. su f=0.4→0.2 | multi-GPU | **GIALLO** |
| — | k statico 5 (già in faretra) | sì | no | flag | sì | **+7%** | ore | **VERDE** ma qualità da ri-misurare su KEXP |
| — | drop-cold miss-only (posseduto) | poco (hit alti) | no | flag | sì | già in baseline | — | **adottato** |
| — | REAP pool prune | no/poco | one-shot | nostro | sì | +0–5% | fatto | **chiuso** |

---

## 3. Shortlist 1–3 + disegni fail-fast

### Shortlist A — Drop-by-weight (estende drop-cold agli HIT)  ★ priorità 1

**Perché.** Unica leva che (1) attacca direttamente \(f_{\text{exp}}=0.40\), (2) riusa scorer/thr già in binario, (3) non dipende da kernel nuovi, (4) è strettamente più forte del miss-only a hit 76–80%.

**Disegno fail-fast**

| | |
|---|---|
| **dove** | S23, bin CAMPAIGN, KEXP, cfg base **k=6 drop-cold off o 0** (isolare la leva), poi stack su d065 |
| **cosa** | nuovo flag es. `--drop-by-weight F` o estendere drop-cold con `drop_resident=true`: drop se weight < thr ∧ non-top, **indipendente da residency** |
| **celle** | thr ∈ {0.5, 0.65, 0.80} × (1/k) come drop-cold; n_token PPL-decode corpus_subset; speed n=200 staccato 2 prompt × 2 rep |
| **gate GO** | (1) med tok/s ≥ **+5%** vs k6d065 (≈6.15); (2) PPL ≤ **min(floor 2.0955, budget cumulativo campagna)**; (3) nessuna regressione output smoke |
| **gate NO-GO** | Δspeed < 3% **oppure** PPL > floor **oppure** thr che droppa >40% slot senza +speed (overhead renorm) |
| **costo** | 1–2 g implement + 0.5 g misura device |
| **Amdahl target** | \(k_{\text{eff}}\approx 5\) → +7% |

### Shortlist B — k dinamico training-free (top-p / max-k + thr)  ★ priorità 2

**Perché.** Complementare ad A: invece di thr assoluto, top-p cumulativo (Huang) o “primo esperto se \((1-\alpha)^2 S_{\ell} \le T\)” (AdapMoE semplificato). Meglio del k=5 statico se la massa di probabilità è speso nei top-1/2 su molti token.

**Disegno fail-fast**

| | |
|---|---|
| **dove** | stesso device; **solo host-side simulazione prima** se c’è `--route-trace`: replay thr/top-p su trace esistenti → stima \(k_{\text{eff}}\) e proxy qualità **senza** rebuild (se il metro PPL richiede forward vero, skip a on-device) |
| **cosa** | `k_max=6`, attiva esperti ordinati finché Σw ≥ p con p∈{0.85,0.90,0.95} **oppure** skip slot se w < τ·w₁ |
| **gate GO** | \(k_{\text{eff}} \le 5.2\) **e** PPL entro budget **e** speed ≥ k6d065 +4% |
| **gate NO-GO** | \(k_{\text{eff}}\) non scende (<3% skip) **o** PPL rompe prima che speed paghi |
| **costo** | 1 g patch + 1 g misura; opz. Fisher calib RunPod se score-only fallisce (AdapMoE) |
| **Amdahl** | come tabella §0 |

### Shortlist C — k=5 statico (già in faretra)  ★ priorità 0.5 / controllo

**Perché.** Costo quasi zero (`--n-expert-used 5`). Storicamente **morto** su IQ2 (ΔPPL +2.56); su **KEXP** non è stato ri-grigliato come cella speed ufficiale (griglia aveva k6/k7/k8). Serve come **baseline onesta** contro A/B: se k=5 statico ha già +7% a PPL viva, A/B devono batterlo in **pareto** (stessa speed, PPL migliore — o stessa PPL, speed migliore).

**Disegno fail-fast**

| | |
|---|---|
| **dove** | S23 KEXP k=5 drop 0.65 e drop 0 |
| **gate GO qualità** | PPL ≤ floor 2.0955 (e budget campagna) |
| **gate GO speed** | med ≥ 6.15 (+5%) |
| **NO-GO** | PPL morta come storico → non adottare; resta solo controllo per A/B |
| **costo** | <0.5 g (solo misura) |

### Non in shortlist (esplicitamente)

- MC-SMoE, Wanda/TEAL senza kernel ARM, MoD/LayerSkip, REAP (già chiuso), OpenCL, ik.

### Se serve un “piano B” post shortlist (non shortlist ora)

**ZEDA / Ada-K LoRA-light** su RunPod se A+B+C non battono il pareto. Aspettativa letteratura: −30–50% expert FLOP a qualità tenuta **dopo** distill — costo multi-giorno, non fail-fast device.

---

## 4. Onestà finale

**Nulla nella letteratura 2024–2026 dimostra un free lunch che batta chiaramente la coppia “k ridotto (statico o dinamico) + drop-by-weight” sul nostro vincolo (CPU ARM, GGUF i-quant, compute-bound, no pretrain, metro PPL).**

- I grandi numeri pubblicati (AdapMoE 1.35×, TEAL 1.5–1.8×, ZEDA 1.20×) vivono su **GPU**, spesso **I/O-bound offload**, o richiedono **distill/kernel** che qui non abbiamo.  
- Trasposti con Amdahl \(f=0.40\), il ceiling onesto di leve “meno esperti attivi” è **+7–15%** decode, non +30–50%.  
- Merge/pool-prune e sparsità peso **non** riducono i FLOP attivi senza compress+kernel.  
- Activation sparsity SwiGLU **esiste** training-free (TEAL) ma **non** è pratica sul nostro path IQ2/CPU a expert_ffn=512.

**Conclusione operativa:**

1. **Eseguire C (k=5) + A (drop-by-weight) + B (top-p/thr)** in quest’ordine di costo.  
2. Adottare la frontiera di pareto su (tok/s, PPL); se A o B dominano k=5 statico, bene — è il valore del dinamico.  
3. Se **nessuna** passa i gate, **non** aprire cantieri MC-SMoE/Wanda/TEAL/MoD: il soffitto decode resta ~5.9–6.3 tok/s onesto finché non cambia silicio, quant+kernel, o si investe in ZEDA-scale distill.  
4. **Sì: a oggi la coppia già in faretra “k=5 + drop-by-weight” è la scommessa corretta**; il resto è o già falsificato (REAP, ik, OpenCL) o troppo costoso per il Δ atteso.

---

## 5. Riferimenti primari (checklist)

| id | titolo / artefatto | URL | data |
|---|---|---|---|
| [V] | AdapMoE | https://arxiv.org/abs/2408.10284 | 2024-08-19 |
| [V] | AdapMoE code | https://github.com/PKU-SEC-Lab/AdapMoE | consultato 2026-08-11 |
| [V] | Harder Tasks Need More Experts (top-p) | https://arxiv.org/abs/2403.07652 | 2024-03-12 |
| [V] | DynMoE | https://github.com/LINs-lab/DynMoE | ICLR 2025 |
| [V] | MC-SMoE | https://arxiv.org/abs/2310.01334 | 2023-10 |
| [V] | MC-SMoE code | https://github.com/UNITES-Lab/MC-SMoE | consultato 2026-08-11 |
| [V] | MoE-Pruner | https://arxiv.org/abs/2410.12013 | 2024-10-15 |
| [V] | TEAL | https://arxiv.org/abs/2408.14690 | 2024-08 |
| [V] | TEAL code | https://github.com/FasterDecoding/TEAL | consultato 2026-08-11 |
| [V] | LayerSkip | https://arxiv.org/abs/2404.16710 | 2024-04 |
| [V] | ZEDA | https://arxiv.org/abs/2605.18643 | 2026 |
| [V] | ZEDA code | https://github.com/TsinghuaC3I/ZEDA | consultato 2026-08-11 |
| [V] | Fate (edge offload) | https://arxiv.org/abs/2502.12224 | 2025-02 |
| locale | KEXP adopt / speed | `reports/moe-adopt-kexp.md` | 2026-08-10 |
| locale | STATO CORRENTE | `PLAN.md` | 2026-08-10 |

**Secondari (non [V] per claim quantitativi):** HF blog Spico dynamic routing 2026-02-26 (survey didattico).

---

*Fine report. STOP.*
