# Report — gate scorer + re-pin + primo sweep `--drop-cold-experts`

Data: 2026-08-09 · Device: Galaxy S23 (PLUGGED_AC) · Fork base: `d408e03`  
Binario SCORER/CAMPAIGN: `1ca51420476d4a979552448f1c0b5bc48a04ed2e43643543ce43fa7566bb022f`  
PREFAULT intatto: `5c95cb5f…` · Artefatti: `results/dropcold/` (PC mirror parziale) + `~/experiments/results/dropcold/` (telefono)

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

Baseline twin F=0 (f45_1, n=200): **49.05 MiB/tok**, hit **77.0%**.  
Baseline PPL decode G2: **2.095450** (stesso subset).

| F | thr | ppl | ΔPPL | MiB/tok | Δbyte% | hit% | drop% | verdetto |
|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 0.25 | 0.03125 | 2.1062 | **+0.0107** | 47.05 | **−4.1%** | 77.6 | ~0.0* | **ARCHIVIATO** (qualità ok, byte < −10%) |
| 0.50 | 0.0625 | 2.1466 | **+0.0512** | 41.23 | **−15.9%** | 79.0 | 2.2 | **CANDIDATO** |
| 1.00 | 0.125 | — | — | — | — | — | — | **IN CORSO** su device (~45% ppl al wrap; pid sweep vivo) |

\* F=0.25: 26/64000 drop sul twin (0.04%) — quasi inerte a thr bassa.

Regole: F=0.50 passa entrambe le soglie → **candidato velocità** (mandato staccato, gualt). F=0.25 non paga i byte. F=1.00 curva da chiudere a fine run (artefatti in `~/experiments/results/dropcold/sweep/drop1.00/`).

## Artefatti telefono

- `~/experiments/results/dropcold/g1/` — G1 8/8  
- `~/experiments/results/dropcold/g2/` — G2 compare + CSV  
- `~/experiments/results/dropcold/smoke_kv/` — smoke n_common=71  
- `~/experiments/results/dropcold/sweep/` — baseline_f0, drop0.25, drop0.50, drop1.00 (in corso), `table.tsv`  
- Scripts: `run_g1.sh`, `run_g2.sh`, `run_smoke_kv.sh`, `run_dropcold_sweep.sh`

## Verdetto sintetico

| gate | esito |
|---|---|
| PASSO 0 semantica | OK (riduce esperti calcolati/caricati) |
| G1 8/8 | **PASS** |
| G2 \|ΔPPL\|≤0.02 | **PASS** (0.0173) |
| re-pin + smoke KV | **PASS** (`cab20432…` → `1ca51420…`, n_common=71) |
| sweep F=0.25 | archiviato (ΔPPL ok, −4% byte) |
| sweep F=0.50 | **CANDIDATO** (ΔPPL +0.051, −16% byte) |
| sweep F=1.00 | **non chiuso in questo wrap** (run ancora attivo) |

## Blocker / follow-up

1. **drop1.00**: ppl-decode ancora in corso al wrap (~4.5k/10k). Lasciar finire; poi twin + riga tabella; se ΔPPL>0.15 → ARCHIVIATO_PPL, se ≤0.15 e byte≤−10% → secondo candidato.  
2. Velocità del **CANDIDATO F=0.50**: solo scollegato (mandato a parte, gualt).  
3. max\|Δlogprob\| G2 grande: path hybrid GDN prefill vs decode; gate è sulla PPL subset, non per-token.  
4. Non toccati: `../ai-chat`, `PLAN.md`, PREFAULT. Nessun `complete_goal`.

## Commit

Vedi hash del commit padre che include questo report + script/artefatti leggeri (no GGUF/build).
