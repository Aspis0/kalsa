# F5.6 — La scala lossy (k e drop) sul metro PPL — 2026-08-08

**Stato:** COMPLETE (scala k misurata; drop BLOCKED per incompatibilità col protocollo baseline).  
**Device:** Samsung S23 (SM-S911U), PLUGGED_AC, batteria 24–27 %.  
**Modello:** `Qwen3.6-35B-A3B-UD-IQ2_M.gguf` (11 522 702 304 B).  
**Binario:** bmoe-cli sha256 `5c95cb5f…` (stesso di F5.5-A).  
**Marca:** **F5.6 IN-CARICA** — PPL e logprob per posizione; nessun verdetto di velocità.

## 1. Contesto

F5.5-A ha congelato il metro teacher-forced su part1+part2 del corpus italiano
(`PPL_k8 = 2.779` su 68 175 token). Restava da misurare, **un solo parametro
alla volta**, cosa fa la scala lossy sulla qualità:

- `--n-expert-used k` con k ∈ {8, 6, 5, 4}
- `--drop-cold-experts F` con F ∈ {0.5, 1.0}

Soglie **dichiarate prima dei numeri** (non spostate a posteriori):

| ΔPPL vs k8 | verdetto |
|---|---|
| ≤ 0.05 | candidabile |
| 0.05 < Δ ≤ 0.15 | solo con lettura umana |
| > 0.15 | archiviata |

Metrica che decide fra varianti: **ΔPPL / (% traffico risparmiato vs k8)**.

## 2. Setup

Config **identica** alla baseline PPL di F5.5-A (cache 0, un solo flag diverso):

```
-t 4 -c 4096 --moe-stream --cache-mb 0 --dense-weights anon
--overlap --io-threads 4 --ubatch 512
--n-expert-used <k>
--ppl-file mixed_it.part1.txt --ppl-csv <variant>/per_token.csv
```

| pezzo | valore |
|---|---|
| sottoinsieme | `mixed_it.part1.txt` (stesso split F5.5-A) |
| n_tokens / n_scored | 34 012 / **34 003** |
| corpus sha256 | `8f7042252f01642bddfaa80278012f8f68345498f411cbb851d3f6ca587d2cb2` |
| binary sha256 | `5c95cb5fe2cc97f3b7a0ae4245ccca4975236b2a29f1be393d9e33ca055f059d` |
| batch PPL effettivo | 16 (cap MoE in `Session::perplexity`) |
| die max osservata | ~71 °C (HARD STOP 98 °C mai raggiunto) |
| k8 | riuso baseline part1 F5.5-A (config byte-identica) |
| k6 / k5 / k4 | run fresche su telefono, cold_model pre-start |

CSV per posizione: `pos,token_id,logprob`. Token_id **identici** fra k8/k6/k5/k4
(assert in analisi) → confronti appaiati validi.

## 3. PASSO 0 — il flag tocca il prefill?

Frammento corto ~2.4k token, stessa config, k8 vs k4:

| | n_scored | PPL | secondi |
|---|---:|---:|---:|
| k8 | 2404 | **1.892151** | 414.8 |
| k4 | 2404 | **6.393812** | 323.3 |
| ΔPPL | | **+4.501661** | |

`same_to_4dp = false` → **DIFFERS_FLAG_TOUCHES_PREFILL**.  
Procedibile: se il flag avesse toccato solo il decode, le due PPL teacher-forced
sarebbero state identiche. Artefatto: `results/f5.6/passo0/compare.json`.

## 4. Numeri chiave — scala k su part1

Bootstrap a **blocchi di 512** posizioni contigue (n_blocks=66, n_boot=5000,
seed=42). Bootstrap per-token vietato: i token vicini sono correlati e
stringerebbero il CI in modo fittizio. Controllo block=256: CI compatibili
(stesso punto, intervalli lievemente più stretti).

### 4.1 Tabella principale

| variante | k | PPL | ΔPPL vs k8 | CI95 bootstrap | hit% | mib_tok PPL | % traffico teorico (∝k, cache=0) | % saved teorico | costo = ΔPPL/%saved | mib_tok F5.2 decode-ref | % saved F5.2 | costo F5.2 | verdetto |
|---|---:|---:|---:|---|---:|---|---:|---:|---:|---:|---:|---:|---|
| k8 | 8 | **2.556004** | 0 | [0, 0] | 0 | non emesso | 100 | 0 | — | 47.52 | 0 | — | riferimento |
| k6 | 6 | **3.496907** | **+0.940903** | [0.860, 1.018] | 0 | non emesso | 75 | 25.0 | **0.0376** | 26.14 | 45.0 | 0.0209 | **archiviata** |
| k5 | 5 | **5.117100** | **+2.561096** | [2.372, 2.745] | 0 | non emesso | 62.5 | 37.5 | **0.0683** | — | — | — | **archiviata** |
| k4 | 4 | **9.843070** | **+7.287066** | [6.837, 7.725] | 0 | non emesso | 50 | 50.0 | **0.1457** | 13.12 | 72.4 | 0.1007 | **archiviata** |

- n_scored = 34 003 per tutte; sum_logprob k8/k6/k5/k4 =
  −31 909.95 / −42 567.64 / −55 512.89 / −77 756.96.
- Secondi wall (in carica, **non** usabili come velocità): k8 6097, k6 5493,
  k5 5374, k4 4921.
- Il path PPL **non emette** `BMOE_PROGRESS` → niente mib_tok / hit% misurati su
  queste corse. Con `cache_mb=0` hit%=0 per costruzione. Traffico teorico
  dichiarato **∝ k** (ogni token legge k esperti). Colonna F5.2 = riferimento
  decode di campagna (cache 2000, prosa), usata solo come croce-check del
  costo-per-traffico; **non** mescolare le due scale in un'unica claim di byte.

### 4.2 Verdetto per soglia (fisse)

| variante | ΔPPL | soglia | verdetto |
|---|---:|---|---|
| k6 | +0.941 | > 0.15 | **archiviata** (≈ 19× la soglia candidabile; ≈ 6× la soglia “lettura umana”) |
| k5 | +2.561 | > 0.15 | **archiviata** |
| k4 | +7.287 | > 0.15 | **archiviata** |

Nessuna variante k entra in “candidabile” né in “solo con lettura umana”.  
La metrica costo-per-traffico peggiora monotonicamente scendendo k
(0.038 → 0.068 → 0.146 ΔPPL per punto % di traffico teorico risparmiato):
**tagliare k costa qualità più che proporzionalmente al risparmio di byte**.

## 5. Drop BLOCKED

`--drop-cold-experts` **non è misurabile** sulla config baseline PPL. Diagnosi
(confermata da probe + lettura `config.cpp` / path PPL):

1. `drop_cold_frac` con `cache_mb=0` è rifiutato: degenera in weight-cut
   incondizionato (validazione in config).
2. Il path PPL marca ogni batch come **prefill**; `drop_prefill` è off di
   default → anche con cache>0 il drop non agirebbe senza `--drop-in-prefill`.
3. Alzare `cache_mb` violerebbe la regola “un solo parametro” e romperebbe il
   bit-repro del riferimento k8 (cache=0).

Flag esiste (`--drop-cold-experts F`, F∈(0,1]), progettato per **decode** con
cache. Riferimento decode F5.2: drop10 mib_tok 7.78 (−84 % vs k8 47.52) ma
qualità già “lossy” a orecchio in F5.2-C4.  
Artefatti: `results/f5.6/drop05/BLOCKED.json`, `drop10/BLOCKED.json`.

## 6. Analisi posizioni — stesse o diverse?

Domanda del mandato: il degrado cade sulle **stesse** posizioni fra k6/k5/k4
(degrado strutturale) o su posizioni **diverse** ogni volta (rumore di
traiettoria)?

Definizione: posizione “degradata” = peggior 10 % del Δlogprob = logP_var − logP_k8
(coda inferiore, q_worst=0.90 → 3401 posizioni per variante).

| coppia | Jaccard | |A∩B|/|A| | Spearman Δlogprob |
|---|---:|---:|---:|
| k6 vs k5 | **0.324** | 0.490 | **0.579** |
| k6 vs k4 | **0.217** | 0.356 | **0.457** |
| k5 vs k4 | **0.293** | 0.453 | **0.624** |
| tripla k6∩k5∩k4 | Jaccard 3-way **0.129** (856 / 6640) | | |

Jaccard atteso per due insiemi indipendenti al 10 % ≈ 0.053. I valori osservati
sono **4–6× il caso** e lo Spearman sui Δlogprob è moderato-alto (0.46–0.62).

**Conclusione:** il degrado è **in parte sulle stesse posizioni** (nucleo
condiviso ~856 token dove tutte e tre le varianti crollano insieme) **e in
parte specifico della variante** (unione 6640 ≫ intersezione). Non è puro
rumore di traiettoria: esiste un sottoinsieme stabile di posizioni “difficili”
che k ridotto non copre. Non è nemmeno collasso totale sulla stessa mappa:
scendendo k si aprono buchi nuovi. Allineato al sospetto qualitativo di F5.2
(k4 peggiora fatti/aritmetica; k6 “indistinguibile in struttura” a orecchio ma
qui il metro dice ΔPPL +0.94, ben oltre soglia).

Frazione di token con logprob peggiore di k8: k6 71.1 %, k5 79.4 %, k4 85.8 %.
Il danno non è concentrato in poche code: è **diffuso**.

## 7. Cosa non dice

- PPL **relativa** fra k, non qualità assoluta di generazione né utilità
  conversazionale (F5.2-C4 resta il riferimento qualitativo a orecchio).
- Nessuna misura di **velocità in carica** (tempi wall riportati solo come
  logistica; regola §8.2).
- Drop **non misurato** su questo protocollo (BLOCKED, non assente dal binario).
- Corpus **italiano letterario** (Commedia + Promessi Sposi + seed): non
  copre codice, inglese, né multi-turno.
- Traffico teorico ∝ k con cache=0 **non** è mib_tok di decode con cache 2000;
  i % F5.2 sono decode-ref, non ripetuti qui.
- Una sola corsa per k; CI bootstrap coprono la varianza fra blocchi del
  corpus, non la varianza fra run.

## 8. Deviazioni / sorprese

- k6 su PPL (+0.94) è **molto peggio** di quanto la lettura umana F5.2-C4
  suggerisse (“indistinguibile in struttura”). Il metro e l’orecchio non
  concordano sulla magnitudine: l’orecchio non vede il degrado distribuito
  al 71 % dei token.
- k4 PPL 9.84 (Δ +7.29) è un collasso numerico coerente col collasso fattuale
  già visto in generazione.
- Drop bloccato **prima** delle run lunghe: risparmiati ~ore di telefono.
- part1 (34k token) sotto la soglia SIGKILL ~45k: nessuno split necessario.

## 9. Verdetto gate

**PASS-CONDIZIONATO** sulla scala k: misure complete, appaiate, con CI a
blocchi e verdetti espliciti.  
**BLOCKED(drop)** per incompatibilità strutturale col protocollo PPL baseline
(cache=0 + prefill), non per manca di flag.

Nessuna variante lossy k è candidabile sul metro PPL con le soglie fissate.

## 10. Artefatti

| path | contenuto |
|---|---|
| `results/f5.6/k{8,6,5,4}/result.json` | PPL + sha corpus/binario/csv |
| `results/f5.6/k*/per_token.csv` | logprob per posizione (telefono + mirror PC; **non** in git) |
| `results/f5.6/passo0/` | probe flag-tocca-prefill |
| `results/f5.6/drop{05,10}/BLOCKED.json` | diagnosi drop |
| `results/f5.6/analysis.json` | bootstrap block=512, overlap, Spearman |
| `results/f5.6/analysis_block256.json` | controllo sensibilità blocco |
| `results/f5.6/scale.master.log` | timeline run telefono |
| `analysis/f56_analyze.py` | script analisi riproducibile |
| `scripts/f56_run_scale_rest.sh` | runner k4→k5 (mirror) |

## 11. Comando per rifare

Sul telefono (Termux), config e corpus come sopra; una variante alla volta:

```bash
export LD_LIBRARY_PATH=$(dirname $BIN)
$BIN -m $MODEL -t 4 -c 4096 \
  --moe-stream --cache-mb 0 --dense-weights anon --overlap \
  --io-threads 4 --ubatch 512 --n-expert-used <K> \
  --ppl-file $CORPUS/mixed_it.part1.txt \
  --ppl-csv $OUT/per_token.csv
```

Su PC:

```bash
/c/Users/gualt/AppData/Local/Programs/Python/Python312/python \
  analysis/f56_analyze.py --root results/f5.6 --block 512 --n-boot 5000 \
  --out results/f5.6/analysis.json
```

## 12. Prossima azione proposta

1. **Non** promuovere k6/k5/k4 su qualità finché ΔPPL resta ≫ 0.15.
2. Se serve ancora drop: protocollo **decode** separato (cache>0, non PPL
   teacher-forced), oppure estendere il path PPL con `--drop-in-prefill` +
   cache e accettare di rompere il bit-repro k8 cache=0 (nuovo mandato).
3. Priorità campagna invariata: prefill incrementale e fix loader E1 restano
   sopra qualsiasi leva lossy.

DONE
