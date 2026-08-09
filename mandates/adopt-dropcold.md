# MANDATO — adozione `--drop-cold-experts 0.50` + GIRO FINALE misure di prodotto

gualt ha ADOTTATO F=0.50 (verbale in PLAN.md, report `moe-speed-dropcold.md`).
Due parti: (1) il flag entra nella config di campagna negli harness — lavoro da PC,
subito; (2) giro finale di misure di prodotto col default completo — serve il telefono
UNPLUGGED (timing citabili).

**Regole fisse:** NESSUN rebuild, NESSUN re-pin — il binario resta CAMPAIGN
`1ca51420…` (verificare sha contro `CAMPAIGN.sha256` prima di ogni run). PREFAULT
intatto. Non toccare `../ai-chat`. STOP ai gate, mai `complete_goal`. Guardrail +
flight recorder attivi. Floor batteria 30%. `screen_off_timeout` ripristinato a fine.

## PARTE 1 — config negli harness (PC, subito)

1. Individuare dove gli script harness definiscono la config di campagna (la riga
   flag comune: `--moe-stream --cache-mb 2000 --dense-weights anon --overlap
   --io-threads 4 --ubatch 512 --n-expert-used 8`). Se è centralizzata in una lib →
   un solo punto; se è ripetuta → aggiornare TUTTI gli script che la usano
   (elencarli nel report con grep di verifica: nessuna occorrenza della config
   vecchia senza flag).
2. Aggiungere `--drop-cold-experts 0.50` alla config di campagna. Gli script di
   A/B che parametrizzano il flag (es. `run_speed_dropcold.sh`) restano com'erano:
   lì il flag è variabile di braccio, non default.
3. `bash -n` su ogni script toccato; push su telefono (`~/experiments/scripts/`);
   commit PC (Conventional, inglese).
4. Nel report: elenco script modificati + sha/righe della config nuova.

## PARTE 2 — giro finale di prodotto (telefono UNPLUGGED, batteria ≥ 45%)

La scheda prodotto definitiva col default completo. Tutti i run con la config
adottata (drop 0.50 attivo). fadvise cold dove indicato. 

| # | misura | protocollo | numero atteso (banda pre-adozione) |
|---|---|---|---|
| 1 | **load cold** | 2 rep, fadvise prima di ognuna, tempo a primo token pronto | ~10 s (invariato: il drop non tocca il load) |
| 2 | **conversazione 5 turni KV** (`--session`, input gk1 5 turni) | 1 run, prefill per turno + n_past per turno | turno 5 prefill ~9-10 s; riuso KV pieno (n_past cresce, prefill = solo delta) |
| 3 | **decode** short + f45_1, n=200, 2 rep ciascuno, cold per run | eval tok/s, hit, MiB/tok, drop% | ~4.4-4.8 (short), ~4.2-4.6 (f45) — se sotto la banda VECCHIA senza drop → STOP, regressione |
| 4 | **sostenuto** n=512, 1 run | eval tok/s, die curve dal flight | ~4.0-4.9; die: watch 91.6 °C — se THERMAL_PAUSE scatta, annotare e NON riprovare |

**Regole di lettura (dichiarate ora):**
- #1 e #2 sono INVARIANTI attesi: se load o riuso KV peggiorano col drop attivo →
  STOP e riportare (sarebbe una scoperta: il drop non deve toccare né load né
  prefill).
- #3 conferma l'adozione se le mediane stanno nella banda B del test A/B (o sopra la
  banda A vecchia). Sotto la banda A → STOP, il verbale dell'adozione va riaperto.
- #4 è documentazione termica, non un gate — ma ABORT/PAUSE si rispettano sempre.
- Nessun timing se PLUGGED. Se la batteria non basta per tutto: ordine di priorità
  #2, #3, #1, #4; ciò che salta = SKIPPED scritto.

## Deliverable

`reports/moe-adopt-dropcold.md`: Parte 1 (script toccati + verifica grep), Parte 2
(tabella scheda prodotto: load / prefill-per-turno / decode / sostenuto con tutti i
numeri e le bande di confronto), batteria inizio/fine, guardrail, verdetto per le
regole di lettura. Artefatti in `results/adopt_dropcold/` (+ mirror PC leggero).
**STOP al report.**
