# MANDATO — sessione da STACCATO: (1) gate sostituzione 0.65, poi (2) spike S1 kernel

Il telefono è STACCATO. Due lavori in sequenza, stesso ordine del verbale. Verificare
subito batteria con `termux-battery-status`: serve **≥ 45%** per partire; floor **30%**
= STOP sessione (finire il run in corso, poi stop, MAI "ancora una cella").

**Regole fisse per tutta la sessione:** binario CAMPAIGN `1ca51420…` (sha check);
NESSUN rebuild; guardrail lib `74bbb4d` (ABORT_MEM combinato) attivi; flight recorder;
fadvise cold prima di ogni run; `screen_off_timeout` alzato e RIPRISTINATO (1800000)
a fine sessione; se il telefono viene ricollegato a metà run → quel run non è
citabile, annotare e rifare; non toccare fork/`../ai-chat`; STOP ai gate; mai
`complete_goal`.

## PARTE 1 — speed-dropcold-065 (il gate di sostituzione)

Eseguire ESATTAMENTE `mandates/speed-dropcold-065.md`:
- A = drop 0.50 (default) vs B = drop 0.65, 2 prompt × 2 rep × 2 bracci, n=200,
  ABBA per prompt, cold per run;
- gate dichiarato: **B ≥ A − 2%** sulla mediana decode → SOSTITUZIONE RACCOMANDATA
  (vista per-prompt SEMPRE a verbale accanto alla pooled);
- consistenza banda attesa per B: MiB/tok ≈ 28.6 ± 10%, hit ≈ 82.4, drop ≈ 6.1%;
- smoke KV con B (n_past=71 atteso);
- sostenuto n=512 con B solo se batteria ≥ 38% a celle chiuse (annotare die:
  ipotesi = scalda MENO con −42% di I/O).

Deliverable: `reports/moe-speed-dropcold-065.md` + `results/dropcold/speed065/`.

## PARTE 2 — spike S1 kernel (solo se batteria ≥ 40% dopo la Parte 1)

Harness già pronto dallo S0: eseguire

```
bash ~/experiments/results/spike_iq2/run_s1_bench.sh
```

(M1/M2 = tg128 IQ2_XXS ref vs ik `-rtr 1`, ABBA, 2 rep; M3 = pp512 controllo;
M4 = IQ3_XXS se batteria regge). Poi pull dei CSV e compilare le tabelle S1 nel
report `reports/moe-spike-iq2.md` (le colonne sono già predisposte), col verdetto
secondo le regole del mandato spike:

| g su IQ2_XXS @ -t 4 | decisione |
|---|---|
| ≥ 1.30 | GO port (lista file ik da portare + stima costo nel report) |
| 1.20–1.30 | GO condizionato |
| < 1.20 | NO-GO: capitolo kernel chiuso |

Se la batteria finisce prima di M4: dichiarare SKIPPED, il verdetto su IQ2_XXS
basta per la decisione.

## Chiusura sessione

Un commit per parte (Conventional, inglese), batteria/die a verbale ora per ora dal
flight, screen ripristinato. **STOP ai due report — sostituzione 0.65 e GO cantiere
kernel sono decisioni di gualt.**
