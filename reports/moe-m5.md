# M5 — Analisi delle route-trace (F4.8)

Solo PC. Nessun telefono. HEAD atteso: `3b37d03`.

## 1. Schema del trace e validazione (Passo 0)

Sorgente: `BigMoeOnEdge/core/include/bmoe/route_trace.h` (`RouteTraceRow`) e
`BigMoeOnEdge/core/src/metrics/route_trace_sink.cpp` (scrittura CSV).

### Colonne (header TSV)

| # | nome | tipo | significato | unità |
|---|------|------|-------------|-------|
| 0 | `turn` | int | session turn index (0 for one-shot) | — |
| 1 | `phase` | int | 0 = prefill, 1 = decode | — |
| 2 | `step` | int | absolute context position of the token being routed | — |
| 3 | `layer` | int | MoE layer index 0..n_layer-1 | — |
| 4 | `slot` | int | router rank 0..n_expert_used-1 (descending weight) | — |
| 5 | `expert` | int32 | routed expert id (payload of the matrix cell) | — |
| 6 | `weight` | float | final applied routing weight; NaN if graph exposed none | — |
| 7 | `residency` | uint8 | 0=miss (flash read), 1=hit (earlier demand), 2=hit_spec (prefetch) | — |
| 8 | `expert_bytes` | uint64 | flash bytes this routing reads; 0 unless residency==miss | — |
| 9 | `dropped` | uint8 | 1 if cache-aware drop discarded this miss (never read); else 0 | — |

Frammento di sorgente (`route_trace.h`):

```cpp
struct RouteTraceRow {
    int turn = 0;  // session-mode turn (0 for a one-shot run)
    int phase = 0; // 0 = prefill, 1 = decode
    int step = 0;  // absolute context position of the token being routed
    int layer = 0;
    int slot = 0;              // 0..n_expert_used-1, router rank order
    int32_t expert = 0;        // the routed expert id
    float weight = 0.0f;       // final applied routing weight; NaN if none
    uint8_t residency = 0;     // RouteResidency: 0=miss, 1=hit, 2=hit_spec
    uint64_t expert_bytes = 0; // flash bytes this routing reads; 0 unless miss
    uint8_t dropped = 0;       // 1 if cache-aware drop discarded this miss
};
enum RouteResidency : uint8_t {
    route_miss = 0,     // not resident: this routing reads it from flash
    route_hit = 1,      // resident from an earlier demanded read
    route_hit_spec = 2, // resident because a speculative prefetch guessed it
};
```

### Tre validazioni

Finestra del trace: **prefill + decode**. Il contatore runtime `moe-cache % hit`
è cumulativo su unique-prefill + decode (stessa finestra del trace con prefill
deduplicato per layer). Il contatore `moe-stream read N MiB` è **attributo al
decode** (diviso per `gen_tokens`), non al prefill.

| trace | V1 eventi (ok?) | V2 byte decode MiB (trace / stdout / gap%) | V3 hit% accounting (trace / stdout / gap pp) |
|-------|-----------------|---------------------------------------------|-----------------------------------------------|
| short_bench | 42880/42880 OK | 2579.8 / 2613.1 / -1.27% OK | 48.1 / 48.1 / -0.05pp OK |
| f45_1_esplicativo | 48960/48960 OK | 2110.1 / 2137.5 / -1.28% OK | 51.0 / 51.0 / +0.01pp OK |
| f45_2_scrittura | 52800/52800 OK | 2354.4 / 2385.0 / -1.28% OK | 48.7 / 48.7 / -0.03pp OK |
| f45_3_istruzioni | 46720/46720 OK | 1759.7 / 1782.6 / -1.28% OK | 54.1 / 54.1 / -0.04pp OK |
| f45_4_codice | 57600/57600 OK | 3015.7 / 3054.7 / -1.28% OK | 42.4 / 42.4 / +0.02pp OK |
| f45_5_ragionamento | 62720/62720 OK | 2730.7 / 2766.1 / -1.28% OK | 45.1 / 45.1 / +0.04pp OK |

**Esito V1 (eventi):** PASS su tutte — `n = (n_prefill + n_decode) × 40 × 8`.

**Esito V3 (hit%):** PASS su tutte — hit accounting = stdout al decimo di punto.

**Esito V2 (byte):** residual sistematico **−1.3%** (trace decode miss-bytes sotto
stdout) identico su tutte e 6 le run. Stessa finestra (decode), non un mismatch di
copertura. Dichiarato, non nascosto. Ipotesi: overhead fisso per miss nel contatore
runtime (allineamento/IO accounting) non esposto nella colonna `expert_bytes`.
Non blocca il simulatore: il gate di validità usa l'hit-rate, che torna esatto.

## 2. Cancello del simulatore (Passo 2)

- trace di gate: `short_bench`
- C = 2000 MiB, policy LRU
- hit misurato (stdout): **48.1%**
- hit simulato (cumulativo): **48.1%**
- hit simulato (decode-only): **72.2%**
- scarto: **-0.05 pp** (tolleranza ±2 pp)
- **esito: PASSATO**

## 3. Verdetti delle quattro regole di decisione

Regole dichiarate **prima** di guardare i numeri (mandato M5).

### 3.1 Politiche di cache (H2) — Belady − LRU a C=2000

- LRU decode hit: **72.24%**
- LFU decode hit: **72.12%**
- W-TinyLFU decode hit: **59.45%**
- Belady decode hit: **90.03%**
- **Belady − LRU = 17.79 pp**
- **VERDETTO: VIVO** — Belady−LRU = 17.79 pp >= 8: vale costruire una politica migliore

### 3.2 MTP / sovrapposizione non catturata (F6)

- short_bench residual mandato (miss@t tra overlap): **5.04%**
- raw overlap medio (frazione degli 8): **0.364**
- di cui catturata da LRU@2000 (miss@t ∧ hit@t+1): **0.050**
- già in cache a t (hit@t): **0.314**
- finestra cache (miss@t ∧ miss@t+1, diagnostica): **0.00%**
- range residual mandato sulle 6 trace: 4.12% … 6.29%
- **VERDETTO (short_bench): IN_MEZZO** — residual mandato (miss@t tra overlap) = 5.04% in [5, 15): serve tasso di accettazione draft abbastanza alto da ammortizzare i miss sprecati dei draft rifiutati
- break-even accettazione (naive): 85%
  (naive: serve accettazione ≥ 85% se un draft rifiutato costa ~94 miss e uno accettato ne risparmia ~16.1)
- verdetti per-trace: IN_MEZZO, MTP_NEGATIVO

> **Nota audit (fix Passo 3):** Errore corretto dopo audit: la definizione di residual
> richiedeva miss@t AND miss@t+1 (misurava la finestra cache); la definizione del mandato
> è miss@t (ammortamento MTP). Il verdetto cambia da MTP_NEGATIVO a IN_MEZZO.

Lettura: l'overlap grezzo c'è (~34–45% degli 8 esperti di t+1 erano già in t). Di
quell'overlap la maggior parte era già residente prima di t; il residual mandato
(~4–6% degli 8) sono miss pagati da t e riusati a t+1 — ammortizzabili da MTP se il
draft li propone. La finestra cache (miss@t ∧ miss@t+1) resta ~0%: a C=2000 LRU non
evince tra due token consecutivi quello che t ha appena pagato.

### 3.3 Prefetch cross-layer

- train: f45_1_esplicativo, f45_2_scrittura, f45_3_istruzioni, f45_5_ragionamento
- test (held-out): short_bench, f45_4_codice
- Recall@8 = **19.2%**, extra-fetch = **273.7%** del traffico miss
- Recall@16 = **28.9%**, extra = **579.7%**
- Recall@32 = **38.4%**, extra = **1225.2%**
- miss medi per layer (test): **2.36** (riferimento mandato ~2.36)
- **VERDETTO: PREFETCH_MORTO** — Recall@8=19.2% o extra=273.7% oltre soglia: morto anche in regime latenza

### 3.4 Dipendenza dal contenuto (rifacimento F4.5)

- hit decode range: **67.5% … 80.9%** (Δ = 13.4 pp)
- classifica per hit decode: f45_3_istruzioni > f45_1_esplicativo > f45_2_scrittura > short_bench > f45_5_ragionamento > f45_4_codice
- F4.5 confrontava 56.9% cumulativo benchmark con 71-77% italiano: numeri non confrontabili (prefill+decode vs claim di content). Qui tutti i livelli sono sulla stessa finestra (decode-only e accounting).

La classifica regge: il contenuto sposta l'hit decode di ~13 pp (codice peggiore,
istruzioni migliore). I livelli assoluti sono più alti del 56.9% cumulativo di F4.5
perché quella cifra mescolava prefill freddo; qui decode-only è 67–81%.

## 4. Tabelle grezze

### 4.1 Copertura top-K (aggregato, tutti gli accessi router)

| K | frazione accessi |
|---:|---:|
| 64 | 0.1006 |
| 128 | 0.1617 |
| 256 | 0.2480 |
| 512 | 0.3599 |
| 1024 | 0.5041 |
| 2048 | 0.6898 |
| 4096 | 0.8911 |

Esperti **mai** attivati (aggregato 6 trace): **1492 / 10240** (14.6%).

Limite superiore ingenuo del pruning ≈ frazione mai usata; non è un budget di
pruning sicuro (un esperto raro può comparire sul prompt successivo).

### 4.2 Concentrazione per layer (aggregato, rappresentativi)

| layer | accessi | unique | top-8 share | entropy bits |
|------:|--------:|-------:|------------:|-------------:|
| L0 early | 7792 | 256 | 0.161 | 7.57 |
| L1 early | 7792 | 246 | 0.140 | 7.47 |
| L19 mid | 7792 | 209 | 0.235 | 6.73 |
| L20 mid | 7792 | 209 | 0.291 | 6.48 |
| L38 late | 7792 | 201 | 0.504 | 5.77 |
| L39 late | 7792 | 215 | 0.474 | 6.11 |

I layer non sono intercambiabili: una politica uniforme su tutti i layer ignora
differenze di entropia/unique set. L38/L39 hanno anche `expert_bytes` maggiore
(1097728 vs 942080).

### 4.3 Curva h(C) — short_bench (request hit decode + byte hit decode + MiB/token)

| C MiB | LRU hit% | LFU hit% | W-TinyLFU hit% | Belady hit% | LRU byte-hit% | LRU MiB/tok |
|------:|---------:|---------:|---------------:|------------:|--------------:|------------:|
| 500 | 39.5 | 41.0 | 30.6 | 65.7 | 39.5 | 176.2 |
| 1000 | 57.5 | 56.2 | 39.5 | 78.9 | 57.5 | 123.7 |
| 1500 | 67.6 | 65.7 | 51.0 | 84.6 | 67.6 | 94.2 |
| 2000 | 72.2 | 72.1 | 59.5 | 90.0 | 72.3 | 80.6 |
| 2500 | 76.3 | 76.3 | 63.9 | 94.0 | 76.4 | 68.7 |
| 3000 | 80.0 | 80.0 | 68.4 | 94.0 | 80.2 | 57.7 |
| 3500 | 84.1 | 84.1 | 73.9 | 94.0 | 84.2 | 46.1 |
| 4000 | 87.6 | 87.6 | 80.8 | 94.0 | 87.7 | 35.9 |
| 5000 | 93.4 | 93.4 | 92.7 | 94.0 | 93.4 | 19.2 |

Teorico full-read decode (no cache) short_bench: **9314.0 MiB** (291.1 MiB/token).

### 4.4 Sovrapposizione MTP per trace

Residual mandato = frazione degli 8 esperti di t+1 che (i) erano fra quelli di t
e (ii) erano miss al momento di t (senza richiedere miss@t+1). Le colonne
`catturata da LRU` e `finestra cache` sono diagnostica secondaria.

| trace | raw overlap | residual mandato | catturata da LRU | finestra cache | già in cache | verdetto |
|-------|------------:|-----------------:|-----------------:|---------------:|-------------:|----------|
| short_bench | 0.364 | 5.04% | 0.050 | 0.00% | 0.314 | IN_MEZZO |
| f45_1_esplicativo | 0.415 | 4.29% | 0.043 | 0.00% | 0.372 | MTP_NEGATIVO |
| f45_2_scrittura | 0.432 | 6.27% | 0.063 | 0.00% | 0.369 | IN_MEZZO |
| f45_3_istruzioni | 0.447 | 4.12% | 0.041 | 0.00% | 0.406 | MTP_NEGATIVO |
| f45_4_codice | 0.338 | 6.29% | 0.063 | 0.00% | 0.275 | IN_MEZZO |
| f45_5_ragionamento | 0.368 | 6.08% | 0.061 | 0.00% | 0.307 | IN_MEZZO |

### 4.5 Prefetch recall/costo (test held-out)

| K | Recall | extra % del traffico miss |
|--:|-------:|--------------------------:|
| 8 | 19.2% | 273.7% |
| 16 | 28.9% | 579.7% |
| 32 | 38.4% | 1225.2% |

Overfit check (train):

| K | Recall train |
|--:|-------------:|
| 8 | 56.3% |
| 16 | 78.5% |
| 32 | 93.6% |

### 4.6 Contenuto: 6 prompt a confronto (finestra corretta)

| trace | hit acc% | hit dec% | stdout hit% | MiB/tok trace | MiB/tok stdout | cov@256 | cov@1024 | never |
|-------|---------:|---------:|------------:|--------------:|---------------:|--------:|---------:|------:|
| short_bench | 48.0 | 72.2 | 48.1 | 80.6 | 81.7 | 0.305 | 0.693 | 7087 |
| f45_1_esplicativo | 51.0 | 77.2 | 51.0 | 65.9 | 66.8 | 0.437 | 0.775 | 7505 |
| f45_2_scrittura | 48.7 | 74.5 | 48.7 | 73.6 | 74.5 | 0.380 | 0.730 | 7296 |
| f45_3_istruzioni | 54.1 | 80.9 | 54.1 | 55.0 | 55.7 | 0.446 | 0.813 | 7867 |
| f45_4_codice | 42.4 | 67.5 | 42.4 | 94.2 | 95.5 | 0.315 | 0.653 | 6764 |
| f45_5_ragionamento | 45.1 | 70.5 | 45.1 | 85.3 | 86.4 | 0.350 | 0.696 | 7104 |

## 5. Cosa non dice questa analisi

1. **6 trace, un solo modello** (Qwen3.6-35B-A3B-UD-IQ2_M), un solo utente, un solo device
   (S23 via Termux). Non è un campione di traffico reale multi-utente.
2. **32 token di decode per run** — finestre corte: la coda LRU non vede riusi a 100+ token.
3. **Prefill incluso nel hit cumulativo** ma freddo (0% hit prefill): confronti con
   deploy long-running (cache calda tra turni) non sono diretti.
4. **W-TinyLFU** è un'implementazione offline onesta (CMS + admission), non Caffeine;
   iperparametri (decay, sketch size) non sono stati sweepati.
5. **Belady** è l'oracolo offline sul replay a batch `load_layer`; non è un upper bound
   su politiche che usano segnali extra (peso router, layer-ahead).
6. **Byte gap −1.3%** non spiegato a livello di sorgente: ogni MiB/token assoluto eredita
   quel residual; i confronti relativi (curve, politiche) no.
7. **Nessun effetto termico/batteria** in queste trace: solo routing e cache.
8. **MTP**: non modelliamo il costo dei draft rifiutati sulla coda I/O né il batching
   multi-token reale del runtime — solo l'ammortamento byte da overlap residuo.

## 6. Script e comando di riesecuzione

```bash
/c/Users/gualt/AppData/Local/Programs/Python/Python312/python \
    scripts/analysis/m5_route_trace_analysis.py \
    --traces-dir results/f4.8/traces \
    --out-dir results/f4.8/m5 \
    --write-report reports/moe-m5.md
```

Dipendenze: Python 3.12 + numpy (stdlib per il resto). Nessuna dipendenza esotica.

Artefatti TSV in `results/f4.8/m5/`:

- `pass0_validation.tsv`
- `pass1_coverage.tsv`, `pass1_never.tsv`, `pass1_layer.tsv`
- `pass2_curve.tsv`, `pass2_gate.tsv`, `pass2_policies_C2000.tsv`
- `pass3_mtp.tsv`
- `pass4_prefetch.tsv`
- `pass5_content.tsv`
- `summary.json`

