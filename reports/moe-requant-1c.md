# moe-requant-1c — dossier fasi A/B/C (2026-08-10)

## Pin
- bin CAMPAIGN: `1ca51420476d4a979552448f1c0b5bc48a04ed2e43643543ce43fa7566bb022f`
- KEXP sha: `ac44e20c1783b9105b83246fd8ce59892b47a265b84e1323a8a501929877721a` (size 13416430592)
- IQ2_M on phone sha: `2be7ef1ed7e1af8b10d3829102cf9a6c2bd5ddb64d675b4ece23a60799403d43`
- Q8_0: `d1a395809f65a43a13ad119eb4e7acdef1ac6d68120f39902c8ab96e72794a59`

## Nota provenienza (a verbale)
Il guadagno PPL può includere una revisione pesi del Q8 sorgente più nuova del
nostro IQ2_M del 3/8 (history HF non verificabile ora). **Per la decisione non
cambia nulla**: il metro è il nostro path di campagna; il file KEXP è pinnato per
sha. Annotato, non scontato come solo "k-quant vs i-quant".

## Fase A (PC) — fabbricazione
VERIFY_OK: experts 120/0 (Q2_K/Q3_K), dense 613/0. Recipe fix
`output.weight` → `^output\.weight$` (regex substring bug).

## Fase B — qualità (device)
Corpus: `corpus_subset_10k.txt` via `--ppl-decode`.

| misura | KEXP | baseline IQ2_M | Δ | esito |
|---|---|---|---|---|
| PPL F=0 | **1.5249** | 2.0955 | **−27.2%** (−0.571) | GO (migliore) |
| PPL drop 0.65 | **1.5647** | 2.19992 | **−28.9%** (−0.635) | GO (migliore) |

Soglia mandato: entro +0.02 o migliore → **GO fase C**.

### Smoke KV (rifatto valido)
- **Invalid (vecchio script B):** due run `-p` indipendenti — NON verifica n_common.
- **Valid (rifatto):** `--session` + gold `gk1_in.jsonl` (stesso input adopt_dense2).
  - **PASS** `t2_n_common=71`, `t1_n_past=71`, `t2_n_prompt=41` (identico al gold IQ2_M).
  - Artefatti: `phase_b/kv_smoke_session/`

## Fase C — velocità ABBA (device, STACCATO, batt 70–77%)
drop=0.65 entrambi, n=200, prompts short + f45_1, ABBA, + sostenuto B n=512.

**Metriche riparse dai log** (il CSV di script aveva parser rotto su tok/s):

| cell | arm | tok/s | drop% | wall_s | rc |
|---|---|---|---|---|---|
| p1_A1 | A | 5.578 | 6.5 | 56 | 0 |
| p1_B1 | B | 5.223 | 7.2 | 61 | 0 |
| p1_B2 | B | 5.389 | 7.2 | 63 | 0 |
| p1_A2 | A | 5.124 | 6.5 | 62 | 0 |
| p2_A1 | A | 5.107 | 6.1 | 65 | 0 |
| p2_B1 | B | 4.692 | 7.3 | 67 | 0 |
| p2_B2 | B | 4.652 | 7.3 | 70 | 0 |
| p2_A2 | A | 4.617 | 6.1 | 72 | 0 |
| sos_B_n512 | B | 4.275 | 7.1 | 80 | 0 (EOS a 228 tok) |

### Confronto
| vista | A med tok/s | B med tok/s | gain B vs A |
|---|---|---|---|
| pooled (4+4) | **5.116** | **4.958** | **−3.1%** |
| p1 short | 5.351 | 5.306 | −0.8% |
| p2 f45_1 | 4.862 | 4.672 | −3.9% |

Gate storico **B ≥ A + 5%**: **FAIL**.

### Lettura onesta (gate riletto alla luce del −27% PPL)
- Velocità: **pareggio leggermente negativo** (~−3% pooled), non un crollo.
- Qualità: **−27% PPL** a F=0 e a drop 0.65.
- Hit cache B leggermente peggiore (p1 75.7 vs 78.4; p2 79.0 vs 82.4); drop% B un filo più alto.
- File B più grosso (~12.5 vs ~11 GB IQ2_M): coerente con più I/O e meno slot cache.

**Candidatura cambio modello:** non passa il gate +5% velocità. Con la qualità
osservata, un **pareggio di velocità** sarebbe già adozione ovvia per molti
dossier; qui B è ~3% più lento. La decisione resta di gualt: trade qualità
enorme vs lieve regressione tok/s e I/O.

## Crash PC / recovery
0x19C Modern Standby (quantize assolto). Q8 clean redownload. powercfg keep-awake.

## Artefatti
- `results/requant1c/from_phone/phase_b/` (PPL + kv_smoke_session PASS)
- `results/requant1c/from_phone/phase_c/` (+ `c_metrics_reparsed.json`)
- KEXP on phone: `~/experiments/models/Qwen3.6-35B-A3B-KEXP.gguf`
