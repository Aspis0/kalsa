# Report — gate scorer + re-pin + primo sweep `--drop-cold-experts`

Data: 2026-08-09 · Device: Galaxy S23 (PLUGGED_AC) · Fork base: `d408e03`  
Binario SCORER/CAMPAIGN: `1ca51420476d4a979552448f1c0b5bc48a04ed2e43643543ce43fa7566bb022f`  
PREFAULT intatto: `5c95cb5f…` · Artefatti: `results/dropcold/` (PC) + `~/experiments/results/dropcold/` (telefono)  
**Stato mandato: COMPLETE**

## PASSO 0 — semantica di `--drop-cold-experts` (dal sorgente)

| | |
|---|---|
| **Flag** | `--drop-cold-experts F` → `MoeStreamConfig::drop_cold_frac` (`cli/main.cpp`, `config.h`) |
| **Range** | `F ∈ (0, 1]`; `0` = off (default). Validate: richiede cache LRU (`cache_mb>0`) |
| **Soglia** | `thr = F / n_expert_used` (= `F/k`). Con k=8: thr = F/8 |
| **Regola** | Per ogni slot top-k: **drop se** (1) non è il top-weighted, (2) cache **MISS**, (3) peso router `< thr`. Residenti: **mai** droppati. Top expert: **pinned** |
| **Dove** | `RouterHook::apply_drop` (`router_hook.cpp`): classifica residency **prima** del load, zeroa peso, ripunta ID al best, opz. renorm (`drop_renorm=true` default). Decode only (`batch_phase==1`); prefill off di default |
| **Effetto** | **Riduce gli esperti caricati/calcolati per token** (miss leggeri saltati) → I/O e matmul risparmiati. Lossy e cache-dependent |

**Semantica = obiettivo mandato → OK, si misura.**

### 3 valori dichiarati PRIMA della misura

| etichetta | F | thr = F/8 |
|---|---:|---:|
| blando | **0.25** | 0.03125 |
| medio | **0.50** | 0.0625 |
| aggressivo | **1.00** | 0.125 |

## PASSO 1 — rebuild + G1

- SCP 3 file scorer (`main.cpp`, `session.cpp`, `session.h`) su telefono (tree già DENSE2+KV).
- Build Termux `build-bmoe` → `bmoe-cli.SCORER` sha `1ca51420…` (~5 s, nproc≥6).
- **G1** path `-p`, scorer OFF, config G-A, `ALLOW_UNPINNED=1`: **8/8 IDENTICAL** vs `results/f5.5/b/*-k8.gen.txt`. Prompt sha verificati 8/8.  
  `STATUS_G1.txt`: `DONE ok=8 fail=0 total=8`.

## PASSO 2 — G2 + re-pin + smoke

### G2 (`--ppl-decode`, k=8, drop off, stesso subset ~10k)

- Corpus: prefisso LF puro di `mixed_it.part1.txt` (31200 B, sha `46efe834…`), n_tokens=10101.
- Confronto prime **10000** righe vs `part1.per_token.csv` (prefill baseline F5.5-A).

| metrica | valore |
|---|---:|
| ppl_decode | **2.095450** |
| ppl_ref_prefill | 2.112749 |
| **ΔPPL** | **−0.017299** |
| \|ΔPPL\| | **0.0173 ≤ 0.02** → **PASS** |
| max\|Δlogprob\| | 11.1155 (path hybrid GDN; atteso) |
| mean\|Δlogprob\| | 0.164 |
| token_id mismatch | 0 |
| n_compared | 10000 |

### Re-pin

| | sha |
|---|---|
| vecchio CAMPAIGN (DENSE2) | `cab204321d478931be1332f816fe5ed6a6fa26bde632dde45af9bf002fa0d6c8` |
| nuovo CAMPAIGN = SCORER | `1ca51420476d4a979552448f1c0b5bc48a04ed2e43643543ce43fa7566bb022f` |

Procedura: `chmod u+w` → `cp SCORER→CAMPAIGN` → `chmod a-w` → `CAMPAIGN.sha256` aggiornato; file copiato = sha dichiarato. PREFAULT non toccato.

### Smoke post-pin (due turni KV, `--session`, n=32)

| turno | clear_kv | n_prompt | n_past |
|---|---|---:|---:|
| 1 | true | 39 | **71** |
| 2 | false | **41** | 144 |

**PASS** `n_common=71`, `n_prompt(t2)=41`.

## PASSO 3 — sweep (metro: ΔPPL ≤ 0.15 e byte/token ≤ −10%)

Baseline twin F=0 (f45_1, n=200): **49.05 MiB/tok**, hit **77.0%**, tok/s 4.773.  
Baseline PPL decode G2: **2.095450** (stesso subset, n_scored=10098).

Config: CAMPAIGN `1ca51420…`, `--ppl-decode` su `corpus_subset_10k.txt`, cache 2000, ubatch 512, k=8, config campagna. Twin: f45_1, n=200.

| F | thr | ppl | ΔPPL | MiB/tok | Δbyte% | hit% | drop% | n_scored | verdetto |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 0 (baseline) | — | 2.0955 | — | 49.05 | — | 77.0 | — | — | baseline |
| 0.25 | 0.03125 | 2.1062 | **+0.0107** | 47.05 | **−4.1%** | 77.6 | ~0.0* | 10098 | **ARCHIVIATO** (qualità ok, byte < −10%) |
| 0.50 | 0.0625 | 2.1466 | **+0.0512** | 41.23 | **−15.9%** | 79.0 | 2.2 | 10098 | **CANDIDATO** |
| 1.00 | 0.125 | 2.3568 | **+0.2613** | 10.39 | **−78.8%** | 87.1 | 17.0 | 10098 | **ARCHIVIATO** (ΔPPL > 0.15) |

\* F=0.25: 26/64000 drop sul twin (0.04%) — quasi inerte a thr bassa.

### F=1.00 (chiusura)

- ppl-decode: rc=0, 10098 scored, ppl=**2.356775**, sum_logprob=−8656.9576, 2253.3 s.
- ΔPPL vs baseline G2: **+0.2613 > 0.15** → **ARCHIVED_PPL**.
- Twin: 10.39 MiB/tok (−78.8% vs 49.05), hit 87.1%, drop 17.0% (10903/64000), tok/s 4.416 (in carica, non citabile per velocità).
- Curva completa a verbale: qualità crolla oltre F=0.50; i byte collassano (−79%) ma la soglia di k uccide il punto.

### Regole applicate

| esito | regola | F |
|---|---|---|
| ΔPPL ≤ 0.15 e byte ≤ −10% | CANDIDATO (velocità da staccato = mandato a parte, gualt) | **0.50** |
| ΔPPL ≤ 0.15 ma byte < −10% | archiviato (non paga) | 0.25 |
| ΔPPL > 0.15 | archiviato (soglia di k) | 1.00 |

## Artefatti

Telefono `~/experiments/results/dropcold/`:
- `g1/`, `g2/`, `smoke_kv/`
- `sweep/baseline_f0`, `drop0.25`, `drop0.50`, `drop1.00` (cell_summary, ppl/twin meta, OVER_PPL su F=1)
- `sweep/table.tsv`, `sweep/sweep.master.log`
- Scripts: `run_g1.sh`, `run_g2.sh`, `run_smoke_kv.sh`, `run_dropcold_sweep.sh`

PC mirror leggero: `results/dropcold/sweep/{table.tsv,sweep.master.log,drop*/cell_summary.json,drop1.00/*_meta.json}` (no GGUF, no CSV giganti).

## Verdetto sintetico

| gate | esito |
|---|---|
| PASSO 0 semantica | OK (riduce esperti calcolati/caricati) |
| G1 8/8 | **PASS** |
| G2 \|ΔPPL\|≤0.02 | **PASS** (0.0173) |
| re-pin + smoke KV | **PASS** (`cab20432…` → `1ca51420…`, n_common=71) |
| sweep F=0.25 | **ARCHIVIATO** (ΔPPL +0.011, −4% byte) |
| sweep F=0.50 | **CANDIDATO** (ΔPPL +0.051, −16% byte, hit 79%) |
| sweep F=1.00 | **ARCHIVIATO** (ΔPPL +0.261 > 0.15; byte −79%, hit 87%) |
| **mandato** | **COMPLETE** |

## Conclusione

Un solo CANDIDATO: **F=0.50** (thr=0.0625). Qualità tenuta sotto la soglia di campagna (+0.051 ≪ 0.15) e risparmio I/O reale (−15.9% MiB/tok). F=0.25 è inerte; F=1.00 paga i byte ma rompe la PPL (+0.26).  
**Test velocità da staccato del candidato F=0.50: mandato a parte, deciso da gualt.** Nessuna adozione in questo wrap.

## Note / non-blocker

1. max\|Δlogprob\| G2 grande (11.12): path hybrid GDN prefill vs decode; gate è sulla PPL subset, non per-token.  
2. tok/s twin in carica non citabili (mandato: nessun timing su AC).  
3. Non toccati: `../ai-chat`, `PLAN.md`, PREFAULT. Nessun `complete_goal`.
