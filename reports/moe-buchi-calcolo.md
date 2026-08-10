# Report — i tre buchi nel muro del calcolo (formato, thread, termica)

**Data:** 2026-08-10  
**Mandato:** `mandates/buchi-calcolo.md`  
**Device:** Galaxy S23 (SM-S911U) · Snapdragon 8 Gen 2 · SSH `u0_a344@192.168.1.152:8022`  
**Binario CAMPAIGN:** `1ca51420476d4a979552448f1c0b5bc48a04ed2e43643543ce43fa7566bb022f` (= `CAMPAIGN.sha256`) — **INVARIATO, nessun rebuild**  
**PREFAULT:** intatto · Guardrail `74bbb4d` · floor 30%  
**Artefatti:** `results/buchi/` (PC) + `~/experiments/results/buchi/` (telefono)  
**Stato mandato:** **1a COMPLETE (GO_CONDIZIONATO) · 1b PREP in corso · 2/3 non eseguiti** — STOP ai gate

---

## Predizioni a verbale (scritte PRIMA delle misure)

File: `results/buchi/predictions.txt`

| buco | predizione a verbale |
|---|---|
| **1a formato** | `g_formato = med(Q2_K)/med(IQ2_XXS) ≥ 1.4` (soglia GO = 1.30; meccanismo dequant aritmetico vs gather, ISA-generico; atteso simile a #164 1.60× su M2-Max ma attenuato su 8 Gen 2) |
| **1b** (se GO) | decode Q2_K_XL ≥ +8% vs IQ2_M a parità drop; PPL entro +0.02 |
| **2 thread** | `-t 5/6` entro ±0 vs `-t 4` (ereditato; scheduler già usa big+mid) |
| **3 termica** | +15–25% tok/s col cooling attivo (freq da 41% del picco verso regime più alto) |

---

## Fase 0 — DOWNLOAD / PREP

### 1a model — Llama-3.2-3B Q2_K (dense, fail-fast)

| Campo | Valore |
|---|---|
| HF | `unsloth/Llama-3.2-3B-Instruct-GGUF` |
| File | `Llama-3.2-3B-Instruct-Q2_K.gguf` |
| Path telefono | `~/models/spike_iq2/` (accanto a IQ2_XXS / IQ3_XXS già presenti) |
| Size | **1 363 935 680 B** |
| **SHA-256 (= HF LFS oid)** | **`162411ff9b531cb41d1204c5b81c9a52f6d2cf061c77ea645c3750cc59e9016a`** |
| Match LFS | **SÌ** |
| Controparte i-quant | `Llama-3.2-3B-Instruct-UD-IQ2_XXS.gguf` (1 046 579 648 B, sha `71aae376…` già verificata in spike S0) |

Scelta dichiarata: **non c'erano 3B nel tree `~/experiments/models/`** (solo LFM2-8B e Qwen 4B/35B). Si riusa la famiglia dense **Llama-3.2-3B-Instruct** già sul telefono in `~/models/spike_iq2/` (stessa scelta dello spike kernel), scaricando il Q2_K accanto all'IQ2_XXS.

### 1b model — Qwen3.6-35B-A3B UD-Q2_K_XL (opportunistico, in background)

| Campo | Valore |
|---|---|
| HF | `unsloth/Qwen3.6-35B-A3B-GGUF` |
| File | `Qwen3.6-35B-A3B-UD-Q2_K_XL.gguf` |
| Path telefono | `~/experiments/models/` |
| Size attesa | **12 290 628 576 B** |
| **LFS oid atteso** | **`96b9c0af5c77a4ecaabe3983175112b5ece763261c1ece12b2494b692a70dad7`** |
| Stato a fine 1a | **IN CORSO** (~4.2 / 12.3 GB, curl `--continue-at` + retry, pid vivo, delta >0) |
| SHA a fine download | **da fare** (hook nello script di download) |

### Dump per-tensor Q2_K_XL

**Non ancora eseguito** — file incompleto. Da fare a download finito con `gguf-dump` (PC `.venv` ha `gguf-dump.exe` / `gguf` 0.19.0).  
Attesi: esperti Q2_K/Q3_K (k-quant), dense più alti; se gli esperti risultassero ancora i-quant → STOP al 1b (buco chiuso).  
Riferimento dump IQ2_M esistente: `results/gguf_ud-iq2m_dump.txt` (ffn_*_exps dtype 16/18 = i-quant).

### Binario / harness

| Item | Path / pin |
|---|---|
| CAMPAIGN | `~/src/BigMoeOnEdge/build-bmoe/cli/bmoe-cli.CAMPAIGN` sha `1ca51420…` **match** |
| ref-mainline llama-bench (1a) | `~/build/llamacpp-ref-bench/bin/llama-bench` commit `5236140e5` (stesso pin spike S1) |
| Harness 1a | `results/buchi/run_1a_formato.sh` → telefono `~/experiments/results/buchi/` |
| Cold | `~/bin/cold_model.sh` + fadv |
| Guardrail | `source lib_guardrails.sh` + `guardrail_tick` post-cella |

---

## BUCO 1a — micro-bench formato (COMPLETE, UNPLUGGED)

### Disegno

| | |
|---|---|
| Engine | **ref-mainline only** (`llama-bench` 5236140e5) — zero codice fork |
| A | Q2_K (k-quant) |
| B | IQ2_XXS (i-quant) |
| Test | tg128 (`-p 0 -n 128`) |
| Thread | `-t 4` |
| Rep | `-r 2` (llama-bench riporta media ± std) |
| Ordine | **ABBA** (A1, B1, B2, A2) |
| Cold | fadv DONTNEED prima di ogni cella |
| Preflight | UNPLUGGED, nproc≥6 (top-app), die cool ≤80°C start, floor 30% |
| Batteria | start **58%** UNPLUGGED → end **56%** UNPLUGGED · floor non toccato |
| Screen | 7200000 durante run → ripristino **1800000** |

**Nota operativa:** due harness concorrenti hanno contaminato un primo A2 orfano (11.14) prima del quartetto ABBA pulito. Il verdetto usa **solo il quartetto clean** (A1→B1→B2→A2 del harness 9152). CSV grezzo in `1a_results.csv`; CSV clean in `1a_results_clean.csv`.

### Tabella tg128 (clean ABBA)

| cell | order | quant | tg128 t/s | die °C start→end | batt % | plugged |
|---|---|---|---:|---|---:|---|
| A1 | A | Q2_K | **11.19 ± 0.46** | 59.1→78.6 | 58 | UNPLUGGED |
| B1 | B | IQ2_XXS | **8.53 ± 0.23** | 62.0→72.1 | 57 | UNPLUGGED |
| B2 | B | IQ2_XXS | **8.47 ± 0.21** | 66.4→70.1 | 57 | UNPLUGGED |
| A2 | A | Q2_K | **10.86 ± 0.44** | 58.3→72.5 | 57 | UNPLUGGED |

Raw: `results/buchi/runs/{A1_Q2_K,B1_IQ2_XXS,B2_IQ2_XXS,A2_Q2_K}.txt`

### g_formato

| | |
|---|---|
| med(Q2_K) | **11.025** (11.19, 10.86) |
| med(IQ2_XXS) | **8.500** (8.53, 8.47) |
| **g_formato** | **1.297** |
| Predizione | ≥ 1.4 |
| Soglia GO | ≥ 1.30 |
| Soglia GO condizionato | 1.15–1.30 |
| **Verdetto** | **GO_CONDIZIONATO** |

Regola mandato: *1.15–1.30 → GO condizionato (si prosegue ma con aspettative e2e ridotte a +5–10%)*.

### Lettura

- Q2_K batte IQ2_XXS sul **nostro** silicio mainline di **~+30%** decode dense tg128.
- Sotto la predizione a verbale (1.4) e **appena sotto** la soglia GO stretta (1.30): **1.297**.
- Il meccanismo "k-quant vs i-quant" **non è zero** su 8 Gen 2, ma **non** riproduce il 1.60× di #164 su M2-Max.
- Implicazione 1b: aspettative e2e sul 35B **ridotte a +5–10%** (non +8% "pieno" come candidatura aggressiva). Si prosegue al 1b perché g ≥ 1.15 e il segnale è chiaro e stabile (spread basso su entrambe le braccia).

---

## BUCO 1b — modello vero (PREP, non misurato)

| Step | Stato |
|---|---|
| Download Q2_K_XL 12.3 GB | **IN CORSO** (~4.2 GB al momento del report 1a; curl resume vivo) |
| SHA vs LFS oid `96b9c0af…` | **pending** fine download |
| Dump per-tensor (tipi esperti / dense / byte-per-esperto) | **pending** (serve file completo) |
| PPL decode-path (F=0 e F campagna 0.50/0.65) | **non partito** — ok in carica |
| Velocità A/B staccato (IQ2_M vs Q2_K_XL, stesso drop, ABBA) | **non partito** — solo da staccato |

**1b pronto ma download in corso — riprendere dopo** (stesso mandato, sessione successiva).  
Gate 1b (dichiarati ora, non toccati):

| esito | conclusione |
|---|---|
| PPL(Q2KXL, drop pari) ≤ PPL(IQ2M) + 0.02 **e** decode ≥ +8% | CANDIDATO CAMBIO MODELLO — dossier a gualt |
| PPL migliore ma decode < +8% | dossier comunque (qualità gratis) |
| PPL peggiore oltre +0.02 | buco chiuso, IQ2_M resta |
| hit% crolla >5 pp | riportare curva, decisione gualt |

Con GO_CONDIZIONATO da 1a: la soglia decode "≥ +8%" va letta con scetticismo — un +5–10% e2e sarebbe già allineato alla micro-bench.

Baseline PPL IQ2_M da dossier: **2.0955 @ F=0 · 2.1466 @ 0.50 · 2.19992 @ 0.65**.

---

## BUCO 2 — thread sweep (NON ESEGUITO)

**SKIPPED in questa sessione** (priorità 1a + prep 1b; batteria 56% e XL ancora in download).  
Predizione a verbale resta: `-t 5/6` entro ±0 vs `-t 4`.

Protocollo pronto (da mandato, invariato):

- Celle staccato ABBA-ish, cold, f45_1 n=200, 2 rep: `-t 4` (baseline), `-t 5`, `-t 6`; se `-t 6` ≥ `-t 4` → `-t 7`.
- Vincitore × sostenuto n=512.
- Metriche: eval tok/s, die curva, freq se leggibile.
- Regole: ≥ +5% **anche** sul sostenuto → candidato adozione config (gualt); solo burst → resta 4; tutto ±3% → chiuso.

---

## BUCO 3 — termica (PRONTO PER GUALT — NON ESEGUITO)

**Serve gualt FISICAMENTE.** Raffreddamento attivo: ventola puntata / piastra fredda **dietro** il telefono — **niente liquidi** vicino alle porte. Non eseguito dall'agente.

### Protocollo (copia operativa)

| | |
|---|---|
| Condizioni | (a) normale · (b) cooling attivo |
| Workload | sostenuto **n=512**, stesso prompt, stessa config campagna |
| Rep | 2 per condizione, **cold**, **staccato** |
| Ordine consigliato | a,b,b,a (ABBA termico) o a×2 poi cool-down poi b×2 con annotazione |
| Metriche | Δ tok/s, Δ freq/die (sysfs se leggibile), batt temp |
| Predizione a verbale | **+15–25%** tok/s col cooling |
| Lettura | se (b) ≫ (a): ceiling termico **quantificato** (informa cap freq / vapor chamber roadmap). se (b) ≈ (a): ceiling **non** (solo) termico — scoperta grossa |

---

## Batteria / device a fine 1a

```text
plugged: UNPLUGGED
percentage: 56
battery temperature: ~37.6 °C
nproc: 7–8 (top-app dopo promote adb)
screen_off_timeout: ripristinato 1800000
CAMPAIGN sha: 1ca51420… match
```

---

## Commit policy / adozioni

- **Un commit per blocco.** Questo report chiude il blocco **1a + Fase 0 prep**.
- **Nessuna adozione** automatica: cambio modello, thread config, cooling = **gualt**.
- **STOP ai gate.** Mai `complete_goal`.
- Non toccati: `PLAN.md`, `../ai-chat`, fork sources, PREFAULT, rebuild.

## Ripresa (prossima sessione)

1. Attendere fine download Q2_K_XL + `sha256sum` vs `96b9c0af…`.
2. Dump per-tensor → se esperti i-quant, STOP buco 1.
3. 1b PPL (in carica ok) poi velocità staccato.
4. Se batteria/tempo: buco 2 thread.
5. Buco 3 solo con gualt presente.

---

## File chiave

| path | contenuto |
|---|---|
| `results/buchi/predictions.txt` | predizioni a verbale pre-misura |
| `results/buchi/1a_results_clean.csv` | tabella clean ABBA |
| `results/buchi/1a_summary_clean.txt` | g=1.2971 GO_CONDIZIONATO |
| `results/buchi/runs/*.txt` | raw llama-bench |
| `results/buchi/run_1a_formato.sh` | harness |
| `results/buchi/1a_console.log` | flight console (include A2 orfano pre-clean) |
