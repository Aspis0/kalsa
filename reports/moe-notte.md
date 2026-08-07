# Mandato notturno F4.8 - tre celle indipendenti

HEAD di partenza: `dd14e93`. Telefono PLUGGED_AC per tutto il mandato (carica invalida i **tempi**, non perplessita ne sequenze di routing).
Priorita rispettata: C2 (feasibility) -> C3 (trace lunga) -> C1 (bake-off PC).
Nessuna riga di prestazione confrontabile scritta in runs.csv.

---

## Cella C1 - M5b: politiche non provate (solo PC)

### Setup
- Stesse 6 trace di M5 (`results/f4.8/traces/`).
- C=2000 MiB, finestra decode-only per i delta.
- Gate LRU@2000 cum: **48.054%** vs misurato 48.1 (gap -0.046 pp) - **PASS**.
- Belady-LRU decode short_bench: **17.793 pp** (90.029 - 72.236).
- Script: `scripts/analysis/m5b_policy_bakeoff.py` (stdlib+numpy, rieseguibile).
- Output: `results/f4.8/m5b/*.tsv`, `reports/moe-m5b.md`.

### Dichiarazioni di fedelta
- **ARC-2L**: T1/T2 + ghost B1/B2 size-aware (budget in **byte**). NON e l ARC a pagine unitarie di Megiddo & Modha 2003.
- **LIRS-HIR**: LIR/HIR size-aware con lir_frac=0.99. NON la LIRS stack-distance esatta di Jiang & Zhang 2002. Onesta ma semplificata.
- **SCORE-***: colonna weight del route-trace.
- **BUDGET-LAYER**: LRU indipendente per layer; budget fissi che sommano a C.

### Regola di decisione (dichiarata prima dei numeri)
- delta_dec vs LRU >= **+5.9 pp** -> IMPLEMENTA (>= 1/3 del gap Belady)
- delta_dec vs LRU < **+2.0 pp** -> ARCHIVIA
- in mezzo -> REPORT + costo implementazione

### Tabella politiche (short_bench, hit decode @ C=2000)

| policy | hit dec % | d vs LRU | frazione gap Belady | verdetto |
|---|---:|---:|---:|---|
| lru (baseline) | 72.236 | 0 | 0 | - |
| belady (oracolo) | 90.029 | +17.793 | 1.0 | oracolo |
| layer_equal | 76.084 | 3.848 | 0.216 | **IN_MEZZO** |
| layer_prop_top8 | 75.156 | 2.92 | 0.164 | **IN_MEZZO** |
| layer_prop_invH | 75.029 | 2.793 | 0.157 | **IN_MEZZO** |
| arc2l | 72.197 | -0.039 | -0.002 | **ARCHIVIA** |
| lfu | 72.119 | -0.117 | -0.007 | **ARCHIVIA** |
| score_admit_q10 | 70.928 | -1.308 | -0.074 | **ARCHIVIA** |
| score_admit_q25 | 69.453 | -2.783 | -0.156 | **ARCHIVIA** |
| score_admit_q50 | 67.598 | -4.638 | -0.261 | **ARCHIVIA** |
| score_evict | 63.633 | -8.603 | -0.484 | **ARCHIVIA** |
| lirs_hir | 42.031 | -30.205 | -1.698 | **ARCHIVIA** |

### Media su 6 trace

| policy | mean d | min | max | verdetto media |
|---|---:|---:|---:|---|
| layer_equal | 4.624 | 3.282 | 6.631 | IN_MEZZO |
| layer_prop_top8 | 3.737 | 2.305 | 6.094 | IN_MEZZO |
| layer_prop_invH | 3.706 | 2.11 | 6.084 | IN_MEZZO |
| arc2l | 0.262 | -0.157 | 0.976 | ARCHIVIA |
| lfu | 0.135 | -0.117 | 0.566 | ARCHIVIA |
| score_admit_q10 | -1.105 | -1.562 | -0.333 | ARCHIVIA |
| score_admit_q25 | -2.301 | -2.783 | -1.163 | ARCHIVIA |
| score_admit_q50 | -4.543 | -6.944 | -2.276 | ARCHIVIA |
| score_evict | -9.886 | -15.098 | -7.452 | ARCHIVIA |
| lirs_hir | -29.416 | -31.514 | -27.47 | ARCHIVIA |

### Verdetti espliciti
- **Nessuna politica raggiunge IMPLEMENTA** (+5.9 pp).
- **IN_MEZZO:** layer_equal (+3.85 short / +4.62 mean), layer_prop_top8 (+2.92 / +3.74), layer_prop_invH (+2.79 / +3.71). Catturano ~16-26% del gap Belady, non 1/3.
- **ARCHIVIA:** ARC-2L (~0), LFU (~0), SCORE-ADMIT (peggiora), SCORE-EVICT (-8.6), LIRS-HIR (-30; variante size-aware troppo aggressiva - non e la LIRS del paper).

### Meccanismo

Belady sfrutta la **distanza di riuso futura**. Sulla decode short_bench:
- n riusi: 9627; mediana dist batch-step: **80.0** (~2 token); p90: 680.0; p99: 1240.0
- frazione riuso <=1 token: **40.7%**; <=5 token: **66.6%**; <=20 token: **91.8%**
- pearson(score_router, med_reuse): **-0.2224** (debole). High-score med reuse 160.0 vs low-score 380.0.

**Perche layer_equal e la migliore online:** partizionare il budget per layer elimina la competizione cross-layer nell LRU globale. Un layer piatto (L0 H=7.57) non scaccia piu gli esperti caldi di un layer concentrato (L38 H=5.77). Guadagno = isolamento working-set per-layer, non distanza di riuso.

**Perche SCORE non cattura Belady:** weight router correla debolmente col riuso futuro (r~-0.22). Evincere/rifiutare low-score toglie residenti che torneranno presto.

**Perche ARC~LRU:** a C=2000 il ghost/frequenza non batte la recency; il working set ruota per contenuto.

**Perche LIRS-HIR collassa:** la variante size-aware con demote aggressivo non e la LIRS del paper; scarta solo *questa* implementazione.

### Partizionamento layer (short_bench, somma=2000 MiB)
- equal: 50 MiB/layer x 40.
- prop_invH: L38 85.1 ... L0 16.3 MiB.
- prop_top8: L38 91.4 ... L1 25.4 MiB.
- Curiosita: equal batte le allocazioni basate su entropia/top8.

### Costi implementazione (solo IN_MEZZO)
| policy | effort | note |
|---|---|---|
| layer_equal / layer_* | 1-2 gg | candidato se si implementa |
| arc2l | 2-4 gg | non giustificato |
| score_* | 0.5-1 gg | peggiora |

### Cosa non dice C1
- Non e qualita (PPL). Non e telefono. ARC/LIRS varianti dichiarate. Trace brevi 32 tok - vedi C3.

---

## Cella C2 - Metro di qualita / PPL (telefono) - **BLOCKED**

### Passo 1 - fattibilita (STOP qui come da mandato)

| candidato | esito | dettaglio |
|---|---|---|
| (a) bmoe-cli perplexity/logprob | **FAIL** | help senza --perplexity/--ppl/--logprob. TokenMetrics senza NLL. Nessun export logprob in progress/CSV. |
| (b) llama-perplexity | **FAIL / impraticabile** | Binario assente in build-safe2/bin (solo llama-cli/bench). CMakeFiles incompleti. Anche ricompilato: senza streaming mmap 11.5GB -> muro F3 ~0.10 tok/s. |
| (c) logprob manuali via bmoe-cli | **FAIL** | Nessuna superficie per-token log p(token). |

**Verdetto C2:** nessuna baseline PPL stasera. Mancanza di **tooling**, non di batteria/carica.

### Cosa e stato comunque preparato
- Freeze: `quality/ppl_baseline.json` con status BLOCKED + checklist di cosa manca.
- Script corpus: `scripts/quality/prepare_it_ppl_corpus.py` (Gutenberg IT + seed conversazionale, SHA256). Target dichiarato se/quando il tool esiste: **50-100k token** tokenizer-model (riduzione onesta da 500k per budget notturno 35B).
- Seed locale: `quality/corpus_it/seed_conversational_it.txt` + `manifest.json` (prose remote non scaricate: --download opzionale).

### Cosa non dice C2
- Non confronta quantizzazioni, drop-cold, ne cache lossy. Non c e un metro finche non c e logprob sotto moe-stream.

---

## Cella C3 - Trace lunga 512 token (telefono, deterministica)

### Run
- Prompt: conversazionale italiano continuo (`prompts/long_conversational_it.txt`, treno Milano-Napoli).
- Config gate: --moe-stream --cache-mb 2000 --dense-weights anon --overlap --io-threads 4 -t 4 --chatml --no-think --route-trace.
- n-predict: **512**. Detached: setsid+nohup. LD_LIBRARY_PATH = dir binario.
- preflight: nproc=7 top-app. PLUGGED_AC 56%->55% durante run, T 28.7->36.0C.
- Output: `results/f4.8/traces/long_512.route.tsv` (209600 eventi = (143 prefill + 512 decode) x 40 x 8).
- stdout runtime: hit cum **86.6%**, resident 1999.3 MiB, gen 512 tok (tempi NON confrontabili: in carica).
- Simulatore: gate LRU cum **86.582%** vs 86.6 misurato (d -0.02 pp).

### (a) Hit-rate LRU@2000 per blocchi da 64 token decode

| blocco tok | hit dec % |
|---|---:|
| 0-63 | 87.056 |
| 64-127 | 90.840 |
| 128-191 | 90.396 |
| 192-255 | 89.180 |
| 256-319 | 88.682 |
| 320-383 | 88.994 |
| 384-447 | 89.243 |
| 448-511 | 89.604 |

**Trend: piatto** (ultimo quarto - primo quarto = +0.475 pp). Non degrada lungo la generazione.

### (b) Working set vs N (esperti distinti layer x expert visti fino al token N)
- unique @64: **2944**
- unique @256: **4717**
- unique @512: **5681**
- Il working set **cresce** col contesto ma con rendimenti decrescenti (2944->4717->5681).

### (c) Divario Belady-LRU vs trace brevi
- long_512 decode: Belady **95.621%** - LRU **89.249%** = **+6.371 pp**
- media 6 trace brevi (32 tok): **+17.76 pp**
- short_bench: +17.79 pp

**Lettura:** sulle generazioni lunghe l hit LRU decode sale (~89% vs ~72% short) e il premio Belady **si riduce** (~6 pp vs ~18 pp). I numeri M5 sulle burst da 32 tok sono **pessimistici** sull hit assoluto e **ottimistici** sul premio di una politica oracolo rispetto a LRU.

### Cosa non dice C3
- Un solo prompt lungo (prosa narrativa IT). Non copre codice/ragionamento a 512 tok.
- Tempi/tok/s in carica: non confrontabili.
- Non implementa nuove policy sul telefono.

---

## Sintesi operativa

| cella | esito | azione |
|---|---|---|
| C1 | complete | nessuna policy IMPLEMENTA; layer-budget equal e IN_MEZZO (+3.8-4.6 pp) se si vuole un pezzo piccolo del gap |
| C2 | **BLOCKED** | serve logprob sotto bmoe-cli+moe-stream (o llama-perplexity streaming) |
| C3 | complete | hit LRU stabile/piatto su 512 tok; gap Belady si restringe; working set cresce sublineare |

Batteria finale: **62% PLUGGED_AC, 29.3C, nproc=7**.

## Artefatti
- `scripts/analysis/m5b_policy_bakeoff.py`
- `scripts/analysis/c3_long_trace_analysis.py`
- `scripts/quality/prepare_it_ppl_corpus.py`
- `results/f4.8/m5b/*`, `results/f4.8/c3/*`, `results/f4.8/traces/long_512.*`
- `quality/ppl_baseline.json` (BLOCKED)
- `reports/moe-m5b.md`

