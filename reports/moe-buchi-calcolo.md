# Report — i tre buchi nel muro del calcolo (formato, thread, termica)

**Data:** 2026-08-10  
**Mandato:** `mandates/buchi-calcolo.md`  
**Device:** Galaxy S23 (SM-S911U) · Snapdragon 8 Gen 2 · SSH `u0_a344@192.168.1.152:8022`  
**Binario CAMPAIGN:** `1ca51420476d4a979552448f1c0b5bc48a04ed2e43643543ce43fa7566bb022f` (= `CAMPAIGN.sha256`) — **INVARIATO, nessun rebuild**  
**PREFAULT:** intatto · Guardrail `74bbb4d` · floor 30%  
**Artefatti:** `results/buchi/` (PC) + `~/experiments/results/buchi/` (telefono)  
**Stato mandato:** **1a COMPLETE (GO_CONDIZIONATO) · 1b CHIUSO (esperti i-quant) · 2 COMPLETE (RESTA_4) · 3 non eseguito** — STOP ai gate

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

## BUCO 2 — thread sweep (COMPLETE, UNPLUGGED)

**Data run:** 2026-08-10 09:50–10:02 (EDT)  
**Condizioni:** **piene** — UNPLUGGED **100%→94%**, die start ~47–55°C, nproc 6–8 (top-app). Timing **pienamente citabili** (non i 39% marginali inizialmente previsti; gualt ha poi caricato al 100% prima del go).  
**Predizione a verbale (pre-misura):** `-t 5/6` entro ±0 vs `-t 4`.  
**Drop F dichiarato:** `--drop-cold-experts 0.65` (valore campagna post speed-065).  
**Binario:** CAMPAIGN `1ca51420…` match. Prompt `f45_1_esplicativo` sha `bc5c1e58…` match.  
**Harness:** `results/buchi/run_2_thread_sweep.sh` → telefono `~/experiments/results/buchi/thread/`  
**Artefatti PC:** `results/buchi/thread/`

### Disegno

| | |
|---|---|
| Prompt | f45_1_esplicativo, n=200 burst / n=512 sostenuto |
| Config fissa | `-c 4096 --temp 0 --chatml --no-think --moe-stream --cache-mb 2000 --dense-weights anon --overlap --io-threads 4 --ubatch 512 --n-expert-used 8 --drop-cold-experts 0.65` |
| Variabile | `-t ∈ {4,5,6}` (e 7 se med t6 ≥ med t4) |
| Ordine burst | ABBA-ish termico: t4r1 → t5r1 → t6r1 → t6r2 → t5r2 → t4r2 |
| Cold | fadv DONTNEED prima di ogni cella |
| Preflight | UNPLUGGED, nproc≥6, die ≤80°C start, floor 30% |
| Freq | sysfs leggibile: `/sys/devices/system/cpu/cpu{0,4,7}/cpufreq/scaling_cur_freq` (little/mid/big) |

### Tabella burst n=200 (eval tok/s)

| cell | -t | eval tok/s | prefill | hit% | die max °C | wall s | batt s→e | freq start (kHz cpu0/4/7) |
|---|---:|---:|---:|---:|---:|---:|---|---|
| t4r1 | 4 | **5.611** | 10.9 | 82.4 | 92.0 | 59 | 100→100 | 1017/2803/864 |
| t5r1 | 5 | **4.360** | 11.0 | 82.1 | 90.8 | 67 | 100→99 | 1017/2803/864 |
| t6r1 | 6 | **3.367** | 10.8 | 82.2 | 90.8 | 81 | 99→98 | 1017/1401/864 |
| t6r2 | 6 | **3.522** | 10.7 | 82.2 | 89.9 | 80 | 98→97 | 1017/1286/2342 |
| t5r2 | 5 | **3.599** | 9.8 | 82.1 | 89.9 | 80 | 97→97 | 1017/1920/864 |
| t4r2 | 4 | **4.751** | 9.8 | 82.4 | 84.3 | 65 | 96→96 | 1017/1920/864 |

### Mediane burst vs baseline -t 4

| -t | vals | mediana | Δ vs t4 | die max |
|---:|---|---:|---:|---:|
| **4** | 5.611, 4.751 | **5.181** | 0% | 92.0 |
| **5** | 4.360, 3.599 | **3.980** | **−23.2%** | 90.8 |
| **6** | 3.367, 3.522 | **3.445** | **−33.5%** | 90.8 |

**t7:** NO (med t6 3.445 ≪ med t4 5.181).  
**Vincitore burst:** `-t 4`.

### Sostenuto n=512 (solo vincitore = t4)

| cell | -t | eval tok/s | hit% | die max °C | wall s | batt s→e |
|---|---:|---:|---:|---:|---:|---|
| sost_t4_r1 | 4 | **4.341** | 84.8 | 81.0 | 87 | 96→95 |
| sost_t4_r2 | 4 | **4.364** | 84.8 | 90.3 | 86 | 95→94 |
| **med t4 sostenuto** | 4 | **4.353** | 84.8 | 90.3 | — | — |

Nessun altro `-t` sul sostenuto: nessuno ha battuto t4 sul burst (≥+5%); la regola «vincitore × sostenuto» fissa t4. Il verdetto non richiede confronto sostenuto multi-t: la regressione burst è già −23%/−33%.

### Freq (sysfs)

Leggibile. Pattern tipico sotto carico: little ~1.0–2.0 GHz, mid ~1.2–2.8 GHz, big spesso throttle a **864 kHz** (ceiling termico già noto). Non c'è evidenza che `-t 5/6` reclutino gli A510 in modo utile: il decode peggiora in modo monotono col thread count (allineato a llama.rn prefill −32% a 6 thread).

### Verdetto (regole mandato)

| regola | esito |
|---|---|
| un -t batte 4 di ≥+5% **anche** sul sostenuto | **NO** — nessuno batte 4 sul burst |
| vince solo sul burst ma perde sul sostenuto | n/a |
| tutto entro ±3% | **NO** — t5/t6 sono −23%/−33% (fuori banda in peggio) |

**Verdetto: RESTA_4 (e anzi 4 è strettamente migliore).**  
Non «chiuso ±3%»: la predizione «±0» è **falsificata in direzione opposta** — più thread **danneggiano** il decode, non sono neutri. Adozione config: **nessuna** (resta `-t 4`). Gate a gualt: nessuna proposta di cambio.

### Batteria / device

```text
plugged: UNPLUGGED (tutto il run)
batt: 100% → 94%
die max observed: 92.0 C (t4r1; sotto HARD 98; guardrail ABORT_MEM combinato non scattato)
nproc: 6–8
screen_off_timeout: 7200000 durante → ripristino 1800000
CAMPAIGN sha: 1ca51420… match
wall totale: ~13 min
```

**Nota condizioni:** report usa **«condizioni piene: UNPLUGGED 100%»** (misura `termux-battery-status` a preflight). La nota «timing marginali a 39%» del briefing iniziale è **superata** dal rifornimento pre-go di gualt.

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

1. ~~1a~~ DONE (g=1.297 GO_CONDIZIONATO).
2. ~~1b~~ CHIUSO (Q2_K_XL esperti 100% i-quant).
3. ~~2 thread~~ DONE — **RESTA_4** (t5 −23%, t6 −34% burst).
4. **Buco 3 solo con gualt presente** (cooling fisico).

---

## File chiave

| path | contenuto |
|---|---|
| `results/buchi/predictions.txt` | predizioni a verbale pre-misura |
| `results/buchi/1a_results_clean.csv` | tabella clean ABBA |
| `results/buchi/1a_summary_clean.txt` | g=1.2971 GO_CONDIZIONATO |
| `results/buchi/runs/*.txt` | raw llama-bench |
| `results/buchi/run_1a_formato.sh` | harness 1a |
| `results/buchi/1a_console.log` | flight console (include A2 orfano pre-clean) |
| `results/buchi/run_2_thread_sweep.sh` | harness buco 2 |
| `results/buchi/thread/runs.csv` | celle burst+sostenuto |
| `results/buchi/thread/summary.txt` | verdetto RESTA_4 |
| `results/buchi/thread/flight.log` | flight recorder |
| `results/buchi/thread/runs/*.summary.txt` | per-cella |

---

## 1b — dump per-tensor del Q2_K_XL: BUCO CHIUSO ALLA RADICE

**File**: `models/Qwen3.6-35B-A3B-UD-Q2_K_XL.gguf` (12 290 628 576 B, sha `96b9c0af5c77a4ecaabe3983175112…` = LFS oid ✓, download completo 2026-08-10).

**Dump per-tensor (reader gguf, PC):**
- Esperti (`blk.N.ffn_{gate,up,down}_exps.weight`, 120 tensor = 40 layer × 3): **gate 39× IQ2_XS + 1× IQ3_XXS; up 39× IQ2_XS + 1× IQ3_XXS; down 36× IQ3_XXS + 4× IQ4_XS** — **TUTTI i-quant, ZERO k-quant**.
- Dense (non-expert): Q5_K 157, Q6_K 93, Q4_K 1 (output), Q8_0 1, F32 361.
- Geometria: qwen35moe, 40 layer, 256 esperti, expert_ffn=512, expert_shared_ffn=512, ssm presente (Qwen3.6 ibrida).

**Verdetto (regola del mandato 1b: "se gli esperti risultassero ancora i-quant → STOP, buco chiuso, riportare"):**
Il "Q2_K_XL" di Unsloth è un **mix i-quant per gli esperti** (IQ2_XS/IQ3_XXS) + k-quant solo per il denso. Il collo di bottiglia che il buco 1 voleva aggredire (gather sul codebook i-quant degli esperti in decode) **NON cambia**: resta gather i-quant. Il kernel speedup k-quant NON si compra con questo file. **1b CHIUSO** — nessuna PPL/velocità da misurare (il candidato non esiste). IQ2_M resta il modello di campagna.

**Nota**: il nome "Q2_K_XL" è branding Unsloth, non descrizione dei tipi esperti. Lezione per la caccia ai file: il dump per-tensor va fatto PRIMA di scaricare 12 GB.
