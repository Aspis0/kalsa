# Fase 1 — Marco runtime “come KEXP” (i1-Q4_K_M, NO requant)

**Scopo:** isolare se **k + drop-cold** (config campagna KEXP) trasferiscono su Marco
(`qwen3moe`), senza toccare il GGUF.

**File modello:** `models/Marco-Mini-Instruct.i1-Q4_K_M.gguf`  
**size:** 10 505 424 704 · **sha trial:** `a001d324b6edc6a797009fbe6eb94a52a9f32453ee8d06465409875f3e3a6dbc`

## Trappole del metro (obbligatorie)

1. **IT = solo v2 moderno** (`corpus/multi5/it.txt` = Wikipedia «Caffè», sha  
   `498a5f3b554fac4bb6f7eda4f7bdcea60f3ad6be30699f306a3255d8ba85545a`).  
   **MAI** `it_v1_literary.txt` (Dante) per gate.  
   Il multi5 storico `ppl_marco` ha IT letterario → **A0 IT = solo `ppl_it_v2`**.
2. **Dichiarare k e drop in ogni riga CSV** (`n_expert_used`, `drop_cold`). Default
   del modello ≠ k di campagna.
3. **Drop NON salta il matmul** (PLAN audit): misura **MiB/tok + hit%** come
   successo I/O; non vendere “meno GEMV”.
4. **Stesse slice byte-identiche** per tutte le celle (sha a verbale).
5. **PC = qualità** (`--ppl-decode`); **device = velocità** (staccato). Non mescolare.
6. **Jelly ≠ S23** per tok/s assoluti; su Jelly solo ranking relativo ABBA.
7. Gate **pre-dichiarati sotto** — non rinegoziare dopo i numeri.

## Config fissa (tutte le celle)

```
--moe-stream --cache-mb 2000 --dense-weights anon --overlap
--io-threads 4 --ubatch 512 -c 4096
PC: -t 8   |  device S23: -t 4  |  Jelly: -t 2
```

## Celle (solo runtime)

| id | k (`--n-expert-used`) | drop (`--drop-cold-experts`) | ruolo |
|---|---|---|---|
| **A0** | **8** | **OFF** | baseline trial (Marco “come misurato”) |
| **A1** | 8 | **0.65** | solo drop KEXP |
| **A2** | **6** | **0.65** | clone campagna **k6d065** |
| **A3** | 6 | **0.50** | drop più gentile |
| **A4** | 5 | 0.65 | **solo se** A2 passa qualità fail-fast |

## A0 — numeri già validi (non rifare se sha match)

| slice | bpb | fonte |
|---|---:|---|
| EN | 0.6051 | `ppl_marco` (k=8, no drop) |
| ES | 0.6766 | idem |
| FR | 0.7234 | idem |
| ZH | 0.8834 | idem |
| **IT** | **0.7501** | **`ppl_it_v2/marco`** (v2) — **non** 1.6377 letterario |

Macro-4 (EN/ES/FR/ZH) A0 = 0.7221  
Macro-5 con IT v2 = (0.6051+0.6766+0.7234+0.7501+0.8834)/5 = **0.7277**

## Qualità — ordine e gate (PC)

### Fail-fast (obbligatorio prima del multi5 pieno)

Lingue: **IT v2 + EN** (prodotto + ancora multilingua barata).

Per ogni cella A1, A2, (A3):

| gate | soglia vs A0 **sulla stessa slice** |
|---|---|
| IT | Δbpb ≤ **+0.05** |
| EN | Δbpb ≤ **+0.05** |
| STOP cella | se IT o EN > +0.05 → cella **NO-GO qualità**, non fare multi5 |

### Full multi5 (solo celle che passano fail-fast)

Lingue: en, es, fr, it(v2), zh.

| gate | soglia vs A0 |
|---|---|
| per-lingua | nessuna Δbpb > **+0.10** |
| macro-5 | Δbpb ≤ **+0.04** |
| flag | se una sola lingua sfonda +0.10 → a verbale, non nascondere in macro |

**Nota:** non confrontare con KEXP in questa fase per il GO runtime; il confronto
cross-model resta trial. Qui isoliamo **regressione vs A0 Marco**.

## Velocità — gate (device, dopo almeno una cella qualità OK)

Device preferito: **S23** se libero; altrimenti Jelly (ranking only).

ABBA: A0 vs best cella (tipicamente A2), 2 prompt × ABBA, n=200, cold per run,
staccato, batt ≥45%.

| gate | soglia |
|---|---|
| decode mediana best vs A0 | ≥ **1.15×** **oppure** |
| MiB/tok mediana | ≤ **−20%** vs A0 (stesso prompt set) |
| hit% | riportare; successo I/O se hit sale in modo chiaro (es. +15 pt) |
| aspirazione vs KEXP | solo se stesso device e KEXP k6d065 in ABBA separato |

Se qualità A2 PASS ma velocità non muove hit/MiB → **Fase 1 runtime INSUFFICIENTE**
→ raccomandare Fase 2 MarcoKEXP (non “alza il drop”).

## Deliverable

- `results/marco_phase1/runs_quality.csv`
- `results/marco_phase1/A*/` json ppl
- `results/marco_phase1/VERDICT.md` (PASS/FAIL per cella + next step)
- report breve in `reports/moe-marco-phase1-runtime.md` a fine griglia qualità
  (speed se device c’è)

## STOP

Niente download Q8, niente quantize, niente patch fork in Fase 1.
