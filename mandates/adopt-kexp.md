# MANDATO — adozione KEXP + griglia di conversione qualità→velocità (k × drop)

gualt ha ADOTTATO KEXP (`moe-requant-1c.md`: PPL 1.5249 vs 2.0955, velocità −3%).
Il tesoretto di qualità (−27%) va riconvertito in velocità con le leve già
costruite. **Regola di spesa dichiarata ORA: floor di prodotto = PPL ≤ 2.0955**
(mai peggio di ciò che shippiamo oggi). Tutto ciò che sta sotto il floor è
spendibile.

**Regole fisse:** binario CAMPAIGN `1ca51420…` INVARIATO; PREFAULT intatto;
IQ2_M NON si cancella (resta il riferimento storico); guardrail+flight; floor
batteria 30%; PPL in carica OK, velocità solo staccato; screen ripristinato;
non toccare fork/`../ai-chat`; STOP ai gate; mai `complete_goal`.

## PARTE 1 — adozione formale (PC + phone, subito)

1. `KEXP.gguf` diventa il modello di campagna: aggiornare il path modello nella
   config/harness (dove gli script puntano a `UD-IQ2_M`), con grep di verifica.
   Gli script A/B storici che parametrizzano il modello restano parametrici.
2. Dossier baseline nuovo in `results/kexp_baseline/`: sha del file (già in
   `kexp.sha256`), PPL 1.5249 (F=0) / 1.5647 (drop 0.65) come baseline ufficiali,
   provenienza (Q8_0 sha + imatrix sha + recipe + comando quantize).
3. Commit "adopt: KEXP as campaign model".

## PARTE 2 — griglia PPL (in carica, deterministica: ~35-40 min/cella)

`--ppl-decode` sullo stesso subset 10k, config di campagna, celle in quest'ordine
(le più promettenti prima, così un'interruzione lascia il meglio sul tavolo):

| # | k | drop | ipotesi |
|---|---|---|---|
| 1 | 8 | 0.80 | il vecchio morto (+0.174 su IQ2_M) qui dovrebbe stare ~1.62-1.68 |
| 2 | 6 | 0.65 | il pruning vero: −25% GEMV; su IQ2_M costava +0.94, qui ? |
| 3 | 8 | 1.00 | −79% byte; su IQ2_M +0.26 → qui ~1.72-1.80? |
| 4 | 6 | 0.80 | combinata: se 2 e 1 reggono singole |
| 5 | 7 | 0.80 | ripiego se k=6 sfora |
| 6 | 6 | 1.00 | solo se 4 regge con margine |

**Regola di lettura per cella: PPL ≤ 2.0955 = VIVA; > 2.0955 = MORTA** (e le
combinate figlie di una morta si saltano, si dichiara lo skip). Riportare la
griglia completa con ΔPPL vs 1.5249.

## PARTE 3 — velocità dei sopravvissuti (staccato, batteria ≥ 45%)

Le 2 celle VIVE più aggressive (per compute atteso risparmiato) + il default
attuale (k=8, drop 0.65) come controllo: A/B/C ABBA-ish, 2 prompt × 2 rep, n=200,
cold per run. Metriche solite + MiB/tok + hit. Poi sostenuto n=512 sul vincitore.

**Regola di decisione:** vince la cella con la mediana decode più alta; se due
sono entro il 2%, vince quella con PPL migliore. Il vincitore è la **proposta di
default di campagna** — l'adozione finale è di gualt.

## Deliverable

`reports/moe-adopt-kexp.md`: adozione (grep di verifica), griglia PPL completa
con vive/morte, tabella velocità, proposta di default con la scheda prodotto
aggiornata (load / prefill KV / decode / sostenuto / MiB/tok / PPL vs floor).
Artefatti `results/kexp_baseline/` e `results/kexp_grid/`. **STOP al report —
il default finale è di gualt.**
