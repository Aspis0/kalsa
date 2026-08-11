# Research — pruning/sparsità MoE orientata alla VELOCITÀ (compute attivo)

**Data ricerca:** 2026-08-11  
**Mandato:** `mandates/research-speed-pruning.md`  
**Scope:** SOLO ricerca web (zero build, zero device).  
**Campagna:** "Beyond Memory" — decode compute-bound su Galaxy S23.  
**Modelli di riferimento:** CalaQwen / KEXP (`qwen35moe`, 256 exp / k=6 / drop 0.65) ~5.2–5.86 tok/s; Marco (`qwen3moe`, 256/top-8) in valutazione.

Legenda claim: **[V]** = fonte primaria (arXiv / GitHub / HF) con URL+data; **[S]** = stima/aritmetica da fonti [V] + numeri campagna; **NON TROVATO** se assente.

---

## 0. Numeri campagna usati per Amdahl (fonte locale, non web)

Da `PLAN.md` STATO CORRENTE e `reports/moe-adopt-kexp.md` (2026-08-10):

| Grandezza | Valore | Nota |
|-----------|--------|------|
| Decode mediano (k6d065) | **5.86 tok/s** | staccato unplugged, n=200 |
| PPL decode k6d065 | **1.852** | floor prodotto storico 2.0955 |
| PPL k8d065 (ctrl) | 1.565 | −25% GEMV top-k vs k=8 |
| Hit cache @ drop 0.65 | ~76–80% | cache 2000 MiB |
| Collo | **CALCOLO** | I/O esposto ≈ 20% del decode |
| GEMV esperti (frazione wall) | **~40%** | mandato + F4.9/F5.x |
| Budget qualità lossy | ΔPPL ≤ 0.15 **cumulativo** vs baseline | regola operativa |
| k statico ridotto | già morto (k6 ΔPPL +0.94 su IQ2 storico; k5/k4 peggio) | ma su KEXP k6 è vivo |
| drop-cold | miss-only (cost-aware) | **non** scarta hit-in-cache |
| REAP pool-pruning | +0–5% velocità, non paga | chiuso |
| OpenCL / ik kernels | morti su nostro silicio | non riaprire |

### Formula Amdahl (esplicita)

Sia \(f = 0.40\) la frazione wall del GEMV esperti, \(r\) la frazione di compute esperti **rimanente** dopo la leva:

\[
S_{\mathrm{e2e}} = \frac{1}{(1-f) + f\cdot r} = \frac{1}{0.60 + 0.40\cdot r}
\]

\[
\Delta\%_{\mathrm{tok/s}} \approx (S_{\mathrm{e2e}} - 1)\times 100
\]

| Leva (r) | \(S_{\mathrm{e2e}}\) | Δ tok/s atteso [S] | Note |
|----------|----------------------|---------------------|------|
| k: 6→5 (r=5/6≈0.833) | 1.072 | **+7.2%** | solo se qualità regge |
| −25% expert-act (r=0.75) | 1.111 | **+11.1%** | AdapMoE-class |
| −33% expert-act (r=0.67) | 1.149 | **+14.9%** | k≈4 media |
| up/down 50% sparse, gate dense (r≈0.67) | 1.149 | **+14.9%** teorico | overhead sparse kernel CPU |
| up/down 85% sparse (r≈0.43) | 1.293 | **+29%** teorico | paper GPU 1.2× e2e; CPU TBD |
| layer skip 20% layer (se f_layer≈0.7 del wall non-I/O) | — | **NON TROVATO** su MoE edge | richiede training di solito |

**Caveat duro:** su ARM/CPU, sparse GEMV (gather neuron / mask) spesso **non** realizza lo speedup teorico (irregular access, no Tensor-core-like path). Le stime [S] sopra sono upper bound Amdahl sul **compute** esperti; il realised g su 8 Gen 2 va misurato.

---

## 1. k dinamico / expert-skipping adattivo

### 1.1 Meccanismo

Invece di top-k fisso per ogni token/layer, si attiva un numero variabile di esperti in base a:
- distribuzione dei router scores (confidence / gap top1–top2 / entropy);
- sensitivity di layer (Hessian/Fisher approssimato);
- k statico ma **per-layer** diverso (non per-token).

### 1.2 Prior art primaria

| Metodo | Anno | Training? | Cosa fa | FLOP attivi? | Tooling |
|--------|------|-----------|---------|--------------|---------|
| **NAEE** dynamic skip | ACL 2024 | No (calibrazione) | Se \(w_{e1}/w_{e0} < \beta\) (mediana calib), skip del 2° expert (top-2) | Sì | [V] arXiv:2402.14800 · GitHub `lucky-lance/expert_sparsity` |
| **AdapMoE** sensitivity gating | ICCAD 2024 | Offline calib + opzionale pred gate 1ª layer | Taylor/Fisher: se \((1-\alpha)^2 \sum\mathrm{diag}(F) \le T\) → 1 solo expert; −25% expert-act, 1.35× su offloading Mixtral | Sì (edge offload) | [V] arXiv:2408.10284 · GitHub `PKU-SEC-Lab/AdapMoE` |
| **LExI** | Sep 2025 | No (data-free, solo pesi) | k **statico ma diverso per layer** | Sì (meno expert GEMV) | [V] arXiv:2509.02753 |
| **DynMoE** Top-Any | ICLR 2025 | Sì (training-time) | gate che sceglie quanti esperti per token | Sì | [V] arXiv via OpenReview; GitHub `LINs-lab/DynMoE` |
| **Ada-K** | 2025 | Fine-tune leggero (~3M param, 1.58h su Qwen1.5-MoE) | proiezione → distribuzione su k; a inferenza argmax k; 1.22× speedup riportato | Sì | [V] overview HF blog Spico 2026-02-26 citando Yue et al. 2025; OpenReview "Ada-K Routing" |
| **AdaMoE** null experts | EMNLP Findings 2024 | Fine-tune | top-k fisso ma slot possono essere null (0 FLOP) | Sì (attivi reali variabili) | [V] arXiv:2406.13233 |
| **Harder Task Needs More Experts** (Top-P-like) | ACL 2024 | Training | k da confidence | Sì | [V] arXiv:2403.07652 |

### 1.3 Senza retraining: cosa regge?

**Sì, senza retraining (solo calibrazione / data-free):**

1. **NAEE dynamic skipping** [V] arXiv:2402.14800 (v2 HTML 2024-05-30): policy inference-time su Mixtral top-2; \(\beta\) = mediana \(w_{e1}/w_{e0}\) su calib set → skip ~50% dei secondi expert. Limitazione esplicita in LExI: *“highly tailored to the dataset and cannot work beyond top-k=2”* [V] arXiv:2509.02753.
2. **AdapMoE sensitivity gating** [V] arXiv:2408.10284: offline Fisher su sample set; soglia T unica; −25% activated experts a accuracy MMLU/ARC tenuta su Mixtral-8x7B/22B 4-bit. **Non** richiede fine-tune del modello (pred gate 1ª layer opzionale, hidden×N_exp).
3. **LExI** [V] arXiv:2509.02753 (2025-09-02): data-free, solo pesi → k per layer. Claim: su GPU/vLLM il pruning di pool migliora memoria ma **poco** il throughput; variare k per layer dà efficiency reale. Esempio: Qwen1.5-MoE stesso throughput H100 con +10% accuracy vs expert pruning tradizionale.

**Con training / fine-tune:**

- DynMoE, Ada-K, AdaMoE null experts: servono training o almeno FT del router / moduli extra.

### 1.4 Δ qualità riportati

| Metodo | Δ qualità | Fonte |
|--------|-----------|-------|
| AdapMoE @ ~24% single-expert ratio | “without accuracy degradation” su MMLU/ARC (figure 7 paper) | [V] 2408.10284 |
| NAEE skip | plug-and-play; degrada se \(\beta\) aggressivo | [V] 2402.14800 |
| LExI | “negligible accuracy loss”; better accuracy@iso-throughput vs prune | [V] 2509.02753 |
| Ada-K su Qwen1.5-MoE | 1.22× speedup (FT 2.95M param) | [V] HF blog citazione Yue 2025 |
| DynMoE | supera baseline a iso-o-meno compute (training) | [V] ICLR 2025 |

**ΔPPL numerici esatti su Qwen3.5/3.6-35B-A3B:** **NON TROVATO** (nessun paper misura il nostro GGUF/path).

### 1.5 Applicabilità a qwen35moe / qwen3moe + stima e2e

- Architettura: 256 experts, k∈{6,8}, shared expert, SwiGLU — **compatibile** con score-threshold e sensitivity gating (generalizzano oltre top-2 se si ordina per peso e si taglia una coda).
- NAEE top-2-only: **parziale** (noi siamo top-6/8): serve generalizzare a “skip i bottom-m del top-k se peso sotto soglia”.
- LExI: applicabile (assegna k_ℓ per layer, es. early layers k alto / late k basso) — allinea a osservazione AdapMoE che early layers sono più sensibili.
- Stima e2e se media expert-act −25% (r=0.75): **+11% tok/s** [S] Amdahl; realised su CPU streaming probabilmente **+5–10%** se il path GEMV è davvero 40%.
- Costo: calibrazione offline su PC (minuti–ore, un pass forward su corpus 1–10k token) — **non** RunPod training. Implementazione: fork CPU, ~flag `--dynamic-k` o soglia su router logits già presenti.

### 1.6 Verdetto area 1

**GIALLO → VERDE se generalizziamo drop-by-weight (area 2) + LExI-static per-layer.**  
DynMoE/Ada-K: GIALLO (serve FT leggero RunPod).  
AdaMoE null experts: ROSSO senza retrain (modifica architettura router).

---

## 2. Drop-by-weight runtime (variante candidata nostra)

### 2.1 Definizione nostra

Oggi: `--drop-cold-experts` scarta solo expert **miss** costosi (I/O).  
Candidata: scartare esperti **marginali per router weight** anche se **già in cache** → riduce **GEMV**, non solo miss.

### 2.2 Prior art (è quasi 1:1 con adaptive gating)

| Prior art | Equivalenza | Soglia tipica | Qualità |
|-----------|-------------|---------------|---------|
| NAEE dynamic skip | gap ratio top2/top1 | mediana calib per layer | plug-and-play |
| Adap-gating (Li 2023, citato in AdapMoE) | solo score α | euristico | accuracy peggiore di sensitivity |
| AdapMoE sensitivity | \((1-\alpha)^2 \times\) layer Fisher | T su val set | migliore di score-only |
| Intra-expert paper §3.2 | router-weight neuron budget | r0:r1:r2 | +0–2 pt accuracy se budget→top experts | [V] arXiv:2605.08575 |

**Nessun paper usa il nome “drop-by-weight”**, ma il meccanismo è standard “token-aware expert skipping” / “adaptive gating”.

### 2.3 Curve qualità (letteratura)

- Score-only aggressivo: AdapMoE mostra collasso accuracy prima del sensitivity-based (fig. 7) [V] 2408.10284.
- Sensitivity: fino a ~25% riduzione expert-act a iso-accuracy MMLU/ARC su Mixtral [V].
- Su top-k>2: **NON TROVATO** paper con curve PPL complete per k=6/8 Qwen-style; si deve misurare.

### 2.4 Stima e2e sui nostri numeri

Ipotesi fail-fast: su ogni token, tra i k=6 selezionati, drop gli ultimi m se \(w_i / w_0 < \tau\) (o se massa cumulativa top-j ≥ ρ).

| Scenario [S] | m medio droppato | r | Δ tok/s Amdahl |
|--------------|------------------|---|----------------|
| τ blando (drop 0.5 expert medio) | 0.5/6 | 0.917 | **+3.4%** |
| τ medio (1.0/6) | 1/6 | 0.833 | **+7.2%** |
| τ aggressivo (1.5/6) | 1.5/6 | 0.75 | **+11.1%** |

Interazione con drop-cold miss-only: **ortogonale e componibile** (uno taglia I/O miss, l’altro taglia compute hit).  
Rischio qualità: budget ΔPPL cumulativo 0.15 — su KEXP k6d065 siamo già a PPL 1.852 (+0.33 vs 1.52 k8); margine fino a floor 2.0955 c’è, ma la regola campagna è stretta sul baseline originale.

### 2.5 Costo / tooling

- **Zero training.** Calibrazione τ (o ρ) su `corpus_subset_10k` + metro `--ppl-decode`.
- Implementazione: nel path post-router del fork, prima del GEMV, mask out expert con peso basso; **anche se residenti in cache**.
- Effort: piccolo (ore–1–2 giorni fork), zero RunPod.

### 2.6 Verdetto area 2

**VERDE** — massima priorità fail-fast. È la freccia già in faretra; la letteratura la valida come AdapMoE/NAEE-class senza retrain.

---

## 3. Expert merging (MC-SMoE e famiglia)

### 3.1 Meccanismo

Cluster di esperti “simili” (router logits / activation centroid / output similarity) → media pesata (o subspace merge) → **pool più piccolo**.  
Effetto primario: **memoria / storage / cache footprint**.  
Effetto secondario su FLOP: solo se si riduce anche k o se il merge collassa esperti che sarebbero co-attivati (raro: co-attivazione ≠ similarità routing).

### 3.2 Prior art

| Metodo | Training? | One-shot? | Note | Fonte |
|--------|-----------|-----------|------|-------|
| **M-SMoE / MC-SMoE** | spesso + recovery FT | merge sì; quality recovery spesso no | cluster su router policy + weight matching + freq-weighted avg | [V] arXiv:2310.01334 · GitHub `UNITES-Lab/MC-SMoE` |
| **HC-SMoE** | task-agnostic, no FT dichiarato | hierarchical clustering su activation vectors | batte frequency/output prune su MC-QA | [V] citato in REAP html 2510.13999v2; Chen et al. 2024/2025 |
| **Sub-MoE** | no FT (opz +FT) | SVD subspace merge | riduce parameter conflict; AAAI-era 2025 | [V] arXiv:2506.23266 |
| **EEP** | evolutionary fusion | — | — | citato secondario |
| **REAP** (confronto) | one-shot prune | — | **pruning batte merging** su generative @50% | [V] arXiv:2510.13999 |

### 3.3 Riduce i FLOP attivi?

**Parzialmente / spesso no in modo diretto.**  
- Pool 256→128: se k resta 6, i FLOP per token **restano ~uguali** (6 expert GEMV).  
- Beneficio reale nostro: hit rate cache ↑, miss I/O ↓ — ma siamo **compute-bound** (I/O solo 20%) → ceiling ~+5% e2e se si azzerasse l’I/O, allineato a “REAP +0–5% non paga”.  
- Se merge + si abbassa k perché il router ha meno scelte distinte: possibile ma **NON TROVATO** claim pulito “merge ⇒ k↓ automatico”.

### 3.4 Applicabilità + costo

- One-shot merge su GGUF streaming: **tooling parziale** (HF/PyTorch MC-SMoE/Sub-MoE); pipeline verso GGUF IQ2 + fork stream **non standard**.
- RunPod: merge one-shot su Q8/BF16 35B = ore su 1×A100-class per calib+merge; recovery LoRA se serve = decine di GPU-h.
- Per velocità decode CPU: **scarso ROI** dato compute-bound + k fisso.

### 3.5 Verdetto area 3

**ROSSO per speed-first** (ripete lezione REAP).  
**GIALLO** solo se obiettivo diventa footprint flash/cache, non tok/s.

---

## 4. Pruning strutturato DENTRO gli esperti (Wanda/SparseGPT-style one-shot)

### 4.1 Meccanismo

Sparsità sui **pesi** FFN di ogni expert (non sul pool): Wanda = |W|⊙||X||; SparseGPT = Hessian update; MoE-Pruner aggiunge router weights al criterio.

### 4.2 Prior art MoE

| Metodo | One-shot? | Healing? | Risultati chiave | Fonte |
|--------|-----------|----------|------------------|-------|
| **MoE-Pruner** | Sì (no weight update in prune step) | opz. expert-wise KD | batte SparseGPT/Wanda su Mixtral-8x7B/22B; recovery con KD multi-GPU | [V] arXiv:2410.12013 (2024-10-15) |
| **MoE-I²** | inter-expert prune + intra low-rank | search genetico layer-wise | compressione size + un po’ compute | [V] arXiv:2411.01016 |
| Wanda / SparseGPT generici | Sì | spesso FT | su dense LLM; su MoE inferiori a MoE-Pruner | [V] citati in 2410.12013 |

### 4.3 A 2–3 bpw regge?

I nostri esperti sono già ~**2.4 bpw** effettivi (IQ2_XXS/IQ3_XXS) [V locale F0.6].  
Letteratura MoE-Pruner lavora tipicamente su **BF16/FP16 o quant post-hoc moderata**, non su i-quant 2-bit già aggressivi.

**A 50% weight-sparsity sopra IQ2:** **NON TROVATO** risultato pubblico su Qwen3.5-35B-A3B / Mixtral IQ2.  
Aspettativa onesta [S]: a 2–3 bpw la qualità è già sul ginocchio; ulteriore 50% unstructured sparsity **senza healing** rischia collasso PPL; con healing (KD) serve multi-GPU pesante (paper: 2×8 H100, 3 epoch).

### 4.4 FLOP attivi a inferenza?

Unstructured sparsity **non accelera** GEMV CPU/llama.cpp senza kernel sparse dedicati (e i-quant sparse è un incubo).  
Structured (N:M, canale, low-rank MoE-I²): può ridurre matmul se il runtime supporta — **mainline/fork nostro: NON TROVATO supporto sparse-expert structured decode**.

### 4.5 Verdetto area 4

**ROSSO** per campagna edge one-shot no-heal a 2 bpw.  
**GIALLO** solo se: (a) si riparte da Q4/Q5 expert, (b) structured sparsity + kernel, (c) budget RunPod KD — fuori scope “LoRA-light”.

---

## 5. Sparsità di attivazione runtime DENTRO gli esperti attivi

### 5.1 Distinzione critica

- **Chiuso in campagna:** predittore **cross-layer** prefetch (Recall@8 19%).  
- **Questa area:** neuron-level **dentro** l’expert già selezionato (gate→mask→skip up/down), stile Deja Vu / PowerInfer / CATS / TEAL, ma su SwiGLU MoE.

### 5.2 SwiGLU: esiste qualcosa di praticabile?

**Sì — evidenza forte 2025–2026, incluso sul nostro stesso modello famiglia.**

| Metodo | Training? | SwiGLU? | Risultato | Fonte |
|--------|-----------|---------|-----------|-------|
| **CATS** | opz. light | Sì (gate thresh → sparse up/down) | sparsifica Gate-MLP | [V] arXiv:2404.08763 · GitHub `ScalingIntelligence/CATS` |
| **TEAL** | No | Sì (magnitude su hidden) | 40–50% model-wide act-sparsity; 1.53–1.8× single-batch decode (GPU kernels) | [V] arXiv:2408.14690 · GitHub `FasterDecoding/TEAL` |
| **Intra-expert MoE sparsity (Park et al.)** | No | Sì | **fino a 90%** sparsity intra-expert a 95% score retention; **Qwen3.5-35B-A3B cutoff ~84.5%**; MoE layer 1.5–2.5×, e2e **1.2×** su vLLM GPU | [V] arXiv:2605.08575 (2026-05-09) |
| Deja Vu / PowerInfer | predittori / ReLU-oriented | storico ReLU; PowerInfer-2 smartphone ma **codice Android pubblico limitato** | — | [V] Deja Vu ICML 2023; PowerInfer arXiv:2312.12456 |

### 5.3 Dettaglio oro: arXiv:2605.08575 su Qwen3.5-35B-A3B

- Stesso stack architetturale del nostro target (256E, top-8, shared, FFN dim 512) [V].
- Sparsity **senza modificare pesi né activation function**: rank neuron per |activation| post-SwiGLU, zero bottom-p.
- Shared expert: **non toccare** (alto impatto accuracy); routed: sparsi.
- Istogramma expert0/layer0: ~55% attivazioni già ~0; coda lunga.
- Implementazione vLLM: gate dense + mask O(n) threshold + fused sparse up-down; batch size decode piccolo = sweet spot.
- e2e GPU: **1.1–1.2×** (Amdahl: MoE ~45% wall nel loro setup → coerente).

### 5.4 Stima e2e sui NOSTRI numeri

Ammesso 70% sparse su up+down (conservativo vs 84% paper), gate dense:

\[
r_{\mathrm{expert}} \approx \tfrac13 + \tfrac23\cdot 0.30 = 0.533
\]
\[
S = 1/(0.60 + 0.40\cdot 0.533) = 1.235 \;\Rightarrow\; +23.5\%\ \mathrm{[S]\ teorico}
\]

**Realised su Snapdragon 8 Gen 2 / llama.cpp IQ2:** **NON TROVATO**.  
Rischi: (1) kernel sparse su i-quant non esistono; (2) dequant+gather può costare più del dense IQ2 GEMV; (3) expert FFN dim=512 è piccolo → overhead mask alto.  
**Ipotesi onesta [S]:** g realistico **0.9–1.15×** finché non c’è un kernel sparse i-quant; a FP16/Q4 su GPU mobile sarebbe un altro discorso (e OpenCL è morto per noi).

### 5.5 Costo

- Calibrazione threshold: un pass, no training [V] 2605.08575.  
- Porting: **alto** (kernel CPU o quant path nel fork).  
- RunPod: non necessario per la misura accuracy offline (PyTorch); sì se si vuole prototipare kernel CUDA di riferimento.

### 5.6 Verdetto area 5

**GIALLO** (scientificamente VERDE su GPU/vLLM e sul nostro modello; **ingegneristicamente rischioso** su CPU IQ2 edge).  
Fail-fast: prima misurare **PPL vs sparsity** in offline PyTorch/HF sul Qwen3.5-35B (o proxy), **senza** kernel; se il ginocchio è ≥50% a ΔPPL budget, solo allora investire kernel.

---

## 6. Layer-level: mixture-of-depths, layer skip, early exit

### 6.1 Prior art

| Metodo | Training? | MoE-specific? | Inference-only regge? | Fonte |
|--------|-----------|---------------|----------------------|-------|
| **LayerSkip** | Sì (layer dropout + early-exit loss) | No (dense Llama) | No senza recipe di training | [V] arXiv:2404.16710 · Meta |
| **Mixture-of-Depths** (Raposo et al.) | Training | No | No | classico 2024 |
| **PoLar** program-of-layers | predictor leggero (~2M) FT | testato anche Qwen1.5-MoE | predictor train, base frozen | [V] arXiv:2606.06574 (2026-06) |
| Early exit classico | di solito head per layer o shared head + train | — | senza train: collasso | survey |

### 6.2 Senza training su MoE: ha mai reggiuto?

**Essenzialmente no per speedup utile.**  
- LayerSkip richiede continual pretrain / recipe dedicata [V] 2404.16710.  
- PoLar: training-free *existence* di programmi skip/loop, ma per usarli serve un predictor addestrato [V] 2606.06574.  
- Skip grezzo di layer N su modello pretrain **senza** early-exit training: **NON TROVATO** paper MoE che mostri ΔPPL accettabile a ≥20% layer skip.

### 6.3 Stima e2e

Se magicamente si skippasse 20% dei layer MoE (r_layer_compute≈0.8 sul 80% non-I/O):

\[
S \approx 1/(0.20 + 0.80\cdot 0.8) = 1.19 \;\Rightarrow\; +19\%\ \mathrm{[S]}
\]

Ma qualità: attesa catastrofica senza training → **non spendibile**.

### 6.4 Verdetto area 6

**ROSSO** per vincolo no-pretraining / solo LoRA-light.  
PoLar-predictor: **GIALLO costoso** (FT predictor su RunPod, integrazione fork non banale, hybrid GDN layers complicano lo skip).

---

## 7. Router tricks e edge MoE 2025–2026

### 7.1 Fast-path shared-expert-only per token “facili”

Idea: se router confidente o entropia bassa, esegui **solo shared expert** (skip tutti i routed).

Evidenza correlata:
- Shared expert ha impatto per-neuron **molto più alto** dei routed [V] 2605.08575 §3.2.  
- AdapMoE/NAEE riducono routed count ma **non** documentano path “shared-only” esplicito su Qwen3.5.  
- AdaMoE/MoE++/LongCat: **null / zero-computation experts** nel pool di routing (serve train) [V] 2406.13233, MoE++ ICLR 2025 arXiv:2410.07348.

**Shared-only fast-path one-shot su Qwen35:** **NON TROVATO** come tecnica pubblicata con numeri.  
Plausibile come estremo del drop-by-weight (k_eff=0 routed) ma qualità da misurare; shared alone su token difficili degrada.

### 7.2 Altri router / edge acceleration 2025–2026

| Idea | Training | Speed? | Note |
|------|----------|--------|------|
| LExI layer-adaptive k | No | Sì compute | [V] 2509.02753 |
| AdapMoE full system | calib | 1.35× (offload-bound!) | noi non siamo offload-GPU-bound allo stesso modo |
| Intra-expert act sparsity | No | 1.2× e2e GPU | [V] 2605.08575 |
| BEAM binary expert masks | train | dynamic | [V] arXiv:2605.14438 |
| ProbMoE | train | — | [V] 2606.01509 |
| Survey inference opt MoE | — | panoramica | ACM 2026 survey (MC-SMoE, HC-SMoE citati) |

### 7.3 Verdetto area 7

**GIALLO:** LExI e drop-by-weight sono le uniche router-side **subito** actionable.  
Shared-only: esperimento gratis da accorpare al drop-by-weight (τ estremo) ma non come feature separata prioritaria.

---

## 8. Tabella sintesi × criteri

Criteri: **FLOP attivi↓**, **training**, **tooling pubblico**, **qwen35/3moe**, **e2e [S] su nostri numeri**, **costo**, **verdetto fattibilità nostra** (fork CPU + metro PPL + RunPod LoRA-light ok).

| # | Tecnica | FLOP↓ | Training | Tooling | Applic. Qwen* | e2e Δ tok/s [S] | Costo | Verdetto |
|---|---------|-------|----------|---------|---------------|-----------------|-------|----------|
| 1a | Drop-by-weight / NAEE-like skip | Sì | No (calib) | paper+idea; da implementare | Alta (k=6/8) | +3–11% | basso (giorni fork) | **VERDE** |
| 1b | AdapMoE sensitivity gate | Sì | Offline Fisher | GitHub AdapMoE (CUDA/edge) | Media (port) | +8–12% | medio | **GIALLO** |
| 1c | LExI k per layer | Sì | No data-free | paper 2025 | Alta | +5–12% (se avg k↓) | basso–medio | **VERDE** |
| 1d | Ada-K / DynMoE | Sì | FT / train | parziale | Media | +10–20% lit. | RunPod FT | **GIALLO** |
| 1e | AdaMoE null experts | Sì | FT arch | paper | Bassa w/o retrain | — | alto | **ROSSO** |
| 2 | Drop-by-weight (nostra def.) | Sì | No | nostro fork | Nativa | +3–11% | basso | **VERDE** |
| 3 | Expert merging MC/HC/Sub-MoE | Debole se k fisso | one-shot ±FT | GitHub MC-SMoE, Sub-MoE | Media (GGUF hard) | ~0–5% (I/O) | medio–alto | **ROSSO** speed |
| 4 | Wanda/SparseGPT/MoE-Pruner weight | Teorico | one-shot; heal costoso | paper | Bassa @2bpw | ~0 senza kernel | alto heal | **ROSSO** |
| 5a | Intra-expert act sparsity (2605.08575) | Sì | No | vLLM patch paper; no llama.cpp | **Alta** (stesso modello) | teor +15–25%; real CPU **?** | alto kernel | **GIALLO** |
| 5b | TEAL/CATS dense-style | Sì | No / light | GitHub TEAL/CATS | Media | GPU 1.5–1.8× lit. | alto port | **GIALLO** |
| 6 | Layer skip / MoD / LayerSkip | Sì | **Sì** | LayerSkip Meta | Bassa w/o train | — | pretrain | **ROSSO** |
| 6b | PoLar predictor | Sì | FT 2M | paper 2026 | Media | TBD | medio RunPod | **GIALLO** |
| 7 | Shared-only easy tokens | Sì estremo | No | — | Da misurare | +α se frazione easy alta | basso trial | **GIALLO** |
| — | k statico=5 | Sì | No | già nel fork | Nativa | +7% Amdahl | zero | **GIALLO*** |
| — | k6 + drop-cold (status quo) | parziale | No | vivo | Nativa | baseline 5.86 | — | **LIVE** |

\*k=5 statico: storicamente **morto** su IQ2 (ΔPPL); su KEXP non ricalibrato in griglia adopt — va rimisurato ma non è “gratis qualità”.

---

## 9. Shortlist 1–3 + disegni fail-fast

### Shortlist

1. **Drop-by-weight runtime** (estensione drop-cold → anche cache-hit) ± soglia per-layer  
2. **LExI-style k statico per layer** (profilo k_ℓ data-free o da calib PPL)  
3. **Intra-expert activation sparsity — solo misura qualità offline** (gate go/no-go kernel)

*(Merging, weight-prune 2bpw, layer-skip train-free: esclusi dalla shortlist.)*

---

### FF-1 — Drop-by-weight (priorità 1)

| Campo | Valore |
|-------|--------|
| **Ipotesi** | Tra i top-k router, i expert con peso relativo basso contribuiscono poco: skipparli riduce GEMV a ΔPPL ≤ budget |
| **Implementazione min** | Post-`top-k`, mask se \(w_i < \tau \cdot w_{(1)}\) **oppure** se massa cumulativa top-j ≥ ρ; applicare **anche se expert in cache**; log `n_dropped_weight` |
| **Dove gira** | S23, bin CAMPAIGN, KEXP, cfg base k6d065 |
| **Metro** | `--ppl-decode` corpus_subset_10k; speed n=200 staccato unplugged (stesso protocollo kexp grid) |
| **Griglia τ/ρ** | 3–5 punti (blando→aggressivo) + cella control |
| **Gate GO** | ΔPPL ≤ 0.08 vs k6d065 **e** Δ tok/s ≥ +4% mediano per-prompt (non solo pooled) |
| **Gate NO-GO** | ΔPPL > 0.10 **oppure** speed < +2% (rumore) |
| **Costo** | 0 RunPod; ~0.5–1 giorno fork + 1 sessione telefono (~2–3 h wall PPL+speed) |
| **Abort** | se a τ che dà +4% speed già PPL > floor 2.0955 |

---

### FF-2 — LExI-like k per layer (priorità 2)

| Campo | Valore |
|-------|--------|
| **Ipotesi** | Layer non equi-sensibili: assegnare k alto agli early / basso ai late riduce avg experts/token a iso-PPL meglio di k globale |
| **Implementazione min** | Tabella `k[layer]` (40 entry) da: (a) euristica monotona, o (b) greedy calib offline su proxy loss; flag `--n-expert-used-per-layer` |
| **Vincolo** | media_k ≈ 5.0–5.5 per confrontare con k=5 flat |
| **Metro** | stesso PPL decode + speed |
| **Gate GO** | PPL ≤ PPL(k=5 flat) − 0.05 **e** speed ≥ speed(k=5) − 1% |
| **Gate NO-GO** | non batte k=5 flat su Pareto PPL–speed |
| **Costo** | 1–2 giorni fork + calib PC; 1 sessione phone |
| **Nota** | se FF-1 già dà +8% a budget, FF-2 può essere **composito** (k_ℓ max + drop-by-weight) |

---

### FF-3 — Intra-expert act sparsity qualità-only (priorità 3, no kernel finché gate)

| Campo | Valore |
|-------|--------|
| **Ipotesi** | Come [V] 2605.08575, Qwen3.5-35B regge ~70–85% sparsity routed-neuron a ~95% score; sul **nostro** path quant+decode serve curva PPL |
| **Implementazione min** | Script HF/PyTorch (PC o RunPod 1×GPU): forward con mask bottom-p \|act\| su expert routed; **non** serve S23 |
| **Punti p** | 0, 30, 50, 70, 85% |
| **Metro** | PPL o bpb su stesso corpus; opz. subset task |
| **Gate GO kernel** | a p≥50%, ΔPPL ≤ 0.10 vs dense-act **sullo stesso checkpoint quant** |
| **Gate NO-GO** | già a p=30% ΔPPL > 0.15 → abbandonare path kernel CPU |
| **Costo** | 0–1 giorno script; RunPod opz. ~\$ pochi se non entra in VRAM locale |
| **Se GO** | spike kernel CPU separato (settimane) — **non** automatico |

---

## 10. Onestà finale

### Cosa batte davvero “k=5 + drop-by-weight”?

**Quasi nulla di pronto e one-shot** batte la coppia:

1. **Drop-by-weight** (calcolo) — validato in letteratura come NAEE/AdapMoE adaptive gating, zero retrain, effort basso, Amdahl +3–11%.  
2. **k ridotto** (statico o LExI per-layer) — Amdahl +7% da 6→5; LExI può dare lo stesso compute medio con **migliore** PPL di un k=5 piatto.

**Intra-expert activation sparsity** è l’unica leva 2026 con claim **forte e sul nostro modello** (+1.2× e2e GPU, fino a 84% sparsity) [V] 2605.08575 — ma sul **nostro** stack (CPU, IQ2, llama.cpp stream) il realised speedup è **non dimostrato** e il costo kernel è un ordine di grandezza sopra drop-by-weight. Va trattata come **opzione di ricerca secondaria** dopo il fail-fast qualità.

**Non spendere** (ripetizione lezioni campagna):
- expert merging / REAP-style pool prune per la velocità;
- Wanda dentro expert a 2 bpw senza heal;
- layer skip train-free;
- null-expert / DynMoE full train;
- OpenCL / ik (già chiusi).

### Raccomandazione operativa

```
Ordine:  FF-1 drop-by-weight  →  (se margine qualità) FF-2 LExI k_ℓ
         →  FF-3 curva act-sparsity offline
         →  solo se FF-3 GO: design kernel (mandato separato)
```

Se FF-1 a budget qualità non supera **+4% tok/s**, la campagna compute ha un soffitto strutturale vicino al plateau attuale (~5.9 tok/s): le leve residue o sono **training-heavy** o **kernel-heavy**, non “un flag e una soglia”.

---

## 11. Fonti primarie (URL + data accesso concettuale 2026-08-11)

| ID | Risorsa | URL | Data paper/ver |
|----|---------|-----|----------------|
| V1 | AdapMoE | https://arxiv.org/abs/2408.10284 | 2024-08-19; ICCAD’24 |
| V2 | AdapMoE code | https://github.com/PKU-SEC-Lab/AdapMoE | crawl 2026 |
| V3 | NAEE | https://arxiv.org/abs/2402.14800 | 2024-02; ACL 2024 |
| V4 | NAEE code | https://github.com/lucky-lance/expert_sparsity | — |
| V5 | LExI | https://arxiv.org/abs/2509.02753 | 2025-09-02 |
| V6 | DynMoE | https://github.com/LINs-lab/DynMoE · ICLR 2025 | 2025 |
| V7 | AdaMoE null | https://arxiv.org/abs/2406.13233 | 2024-06-19 |
| V8 | MC-SMoE | https://arxiv.org/abs/2310.01334 · https://github.com/UNITES-Lab/MC-SMoE | 2023/ICLR’24 |
| V9 | Sub-MoE | https://arxiv.org/html/2506.23266v1 | 2025-06-29 |
| V10 | MoE-Pruner | https://arxiv.org/abs/2410.12013 | 2024-10-15 |
| V11 | MoE-I² | https://arxiv.org/abs/2411.01016 | 2024-11-01 |
| V12 | REAP | https://arxiv.org/html/2510.13999v2 | 2025/2026 |
| V13 | Intra-expert MoE sparsity | https://arxiv.org/abs/2605.08575 | 2026-05-09 |
| V14 | CATS | https://arxiv.org/abs/2404.08763 · https://github.com/ScalingIntelligence/CATS | 2024-04 |
| V15 | TEAL | https://arxiv.org/abs/2408.14690 · https://github.com/FasterDecoding/TEAL | 2024-08 |
| V16 | LayerSkip | https://arxiv.org/abs/2404.16710 | 2024-04 |
| V17 | PoLar | https://arxiv.org/html/2606.06574v1 | 2026-06-04 |
| V18 | MoE++ | https://arxiv.org/abs/2410.07348 · https://github.com/SkyworkAI/MoE-plus-plus | ICLR 2025 |
| V19 | Harder Tasks Need More Experts | https://arxiv.org/abs/2403.07652 | 2024-03 |
| V20 | Ada-K overview | https://huggingface.co/blog/Spico/dynamic-routing | 2026-02-26 |

**Locale (Amdahl inputs, non web):** `PLAN.md` STATO CORRENTE; `reports/moe-adopt-kexp.md`; mandato numeri GEMV~40% / I/O~20%.

---

*Fine report. STOP.*
