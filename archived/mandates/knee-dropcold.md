# MANDATO — ricalibrazione guardrail + ginocchio della curva drop-cold (F ∈ {0.65, 0.80})

Due parti. La 1 è prerequisito della 2 (nessun run lungo col guardrail vecchio).
La 2 è tutta deterministica (PPL + conteggi): **telefono in carica va benissimo**,
nessun timing citabile in questo mandato.

**Regole fisse:** binario CAMPAIGN `1ca51420…` (verificare sha, NESSUN rebuild/re-pin);
PREFAULT intatto; non toccare `../ai-chat`; STOP ai gate; mai `complete_goal`;
flight recorder attivo; `screen_off_timeout` ripristinato a fine.

## PARTE 1 — ABORT_MEM diventa condizione COMBINATA

Verbale (PLAN 2026-08-09): la soglia solo-memoria uccide run citabili — memfree
13–52 MiB è lo stato normale del workload; la firma RescueParty era memoria ≪100 MiB
**E** die 88–92 °C sostenuti.

Modifica a `scripts/lib_guardrails.sh`:
- **ABORT_MEM scatta solo se ENTRAMBE sostenute**: MemFree < 100 MiB (hold 10 s
  invariato) **E** die > **85 °C** (stesso hold). Memoria bassa con die freddo =
  solo log `MEM_LOW` sul flight, nessun kill.
- THERMAL_PAUSE 88 °C/60 s: **invariato**. HARD_STOP 98 °C: **invariato**.
- Log della nuova condizione: `GUARDRAIL,…,ABORT_MEM_COMBINED` (die e memfree nel
  messaggio, così il post-mortem è leggibile).

Verifica: `bash -n`; test a secco della funzione con valori sintetici (mem bassa +
die freddo → NO kill; mem bassa + die 86 sostenuto → kill) usando una modalità
dry-run o un harness di test della lib — dichiarare nel report come è stato provato.
Push su telefono, commit PC.

## PARTE 2 — il ginocchio: F ∈ {0.65, 0.80}

La curva a verbale: 0.50 → ΔPPL +0.051 / −15.9% byte (ADOTTATO); 1.00 → +0.261 /
−78.8% (morto). In mezzo potrebbe esserci un punto che paga molto di più a budget
tenuto. Budget PPL residuo: **cumulativo 0.15 vs baseline decode 2.095450** (stesso
subset 10k del G2 — stesso file, stesse posizioni).

**2 valori dichiarati:** F=0.65 (thr 0.08125) e F=0.80 (thr 0.10). Ordine: prima
0.65; 0.80 si misura comunque (siamo in carica, la curva completa vale il verbale).

**Attenzione config:** gli harness ora hanno `--drop-cold-experts 0.50` nel default
di campagna — per lo sweep il flag va **sovrascritto esplicitamente** col valore
del punto (e per il twin baseline di controllo, se rifatto, F resta 0.50: il
riferimento byte del confronto resta comunque il twin F=0 storico, 49.05 MiB/tok).

Per ogni F: (1) `--ppl-decode` su `corpus_subset_10k.txt` → PPL e ΔPPL vs 2.095450;
(2) twin f45_1 n=200 → MiB/tok, hit%, drop%. Stesso protocollo dello sweep
precedente (`run_dropcold_sweep.sh` è riusabile parametrizzato).

**Regole di decisione (dichiarate ORA):**

| esito | conclusione |
|---|---|
| ΔPPL ≤ 0.15 **e** byte/token ≤ **−25%** (vs 49.05 F=0) | **CANDIDATO SOSTITUZIONE** di 0.50 — passa dal test velocità da staccato (mandato a parte, gualt decide) |
| ΔPPL ≤ 0.15 ma byte > −25% | archiviato: non batte abbastanza 0.50 (−15.9%) per giustificare più costo qualità — **0.50 resta** |
| ΔPPL > 0.15 | archiviato — la soglia è la soglia (cumulativa, non incrementale) |

La soglia −25% è deliberatamente più dura del −10% dello sweep originale: qui non
si cerca un candidato, si cerca un motivo per SPOSTARE un default già adottato.

## Deliverable

`reports/moe-knee-dropcold.md`: Parte 1 (diff lib + come è stato testato il
combinato), Parte 2 (tabella curva completa 0.25→1.00 con i due punti nuovi,
ΔPPL/byte/hit/drop per punto, verdetto per le regole). Artefatti in
`results/dropcold/knee/` (+ mirror PC leggero). **STOP al report — l'eventuale
sostituzione di 0.50 è di gualt.**
