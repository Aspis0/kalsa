# F4.5 qualità + F4.7 curva batteria — 2026-08-06

## Cosa è stato fatto (vs piano)

- **F4.5 QUALITÀ (priorità assoluta)**: prima lettura umana di output del 35B UD-IQ2_M (~2.4 bpw) sulla config del gate. 5 prompt (3 IT + codice + ragionamento), `n_gen=200`, `--temp 0`, `--chatml --no-think`, `t=4 --io-threads 4 --cache-mb 2000 --dense-weights anon --overlap`, binario `bmoe-cli` `b0c4e5b`, modello size gate `11522702304`. Una passata per prompt (niente 3-rep / sentinella / protocollo tempi). Confronto 4B Q4_K_M sullo stesso prompt esplicativo (mainline `build-safe2`).
- **F4.7 curva batteria-prestazioni**: config **fissa** del gate, phase tag `F4.7-batt-curve`. 8 punti da 32% a 10% (sessione partita a batteria ~42% già scesa da F4.5). Colonna `battery_pct` aggiunta all'harness (intent f6d6117, prima solo documentato). Power saver verificato via `adb dumpsys power` a ogni poll.
- **Harness**: `scripts/run_bench.sh` + `runs.schema.md` — nuova colonna `battery_pct` (dopo `batt_temp_end`); migrazione CSV 29→30 colonne. Script `start_f4_5_quality.sh`, `start_f4_7_batt_curve.sh`. Prompt `prompts/f45_*.txt`.

**NON confrontare** i tok/s di F4.7 con il gate (5.02): fase separata a carica in discesa, motivo del floor 40%.

## F4.5 — OUTPUT INTEGRALE e giudizio

Config: UD-IQ2_M, `b0c4e5b`, top-app, nproc binario 7–8, `--chatml --no-think`, `n=200`.

### Prompt 1 — IT esplicativo (`f45_1_esplicativo`)

**Prompt:** cos'è un MoE e perché 35B-A3B può essere più pratico di un denso 7B su 8GB RAM (memoria, routing, streaming flash; ≤180 parole).

**Output (intero, run `…-164616`, eval 5.89 tok/s, batt 41%):**

```
Un modello Mixture-of-Experts (MoE) è un'architettura neurale che divide i parametri in "esperti" specializzati. A differenza dei modelli densi, dove ogni token attiva tutti i parametri, un MoE attiva solo un sottoinsieme selezionato tramite un meccanismo di routing (instradamento).
Su uno smartphone con 8 GB di RAM, un MoE da 35B parametri ma con soli 3B attivi per token è più pratico di un denso da 7B per due motivi chiave. Innanzitutto, la memoria: caricare un denso da 7B (FP16) richiede circa 14 GB, superando la RAM disponibile. Il MoE, invece, mantiene i 35B parametri sul disco (o nella memoria non volatile), caricando in RAM solo gli esperti attivi (circa 6 GB), permettendo l'esecuzione senza crash.
```

**Giudizio: usabile.** Italiano coerente, definizione e memoria corrette nella direzione. Tagliato a 200 token prima dello streaming flash e del limite parole; stima «6 GB attivi» grezza ma non spazzatura. Nessuna ripetizione a ciclo, nessuna deriva in inglese.

### Prompt 2 — IT scrittura breve (`f45_2_scrittura`)

**Prompt:** messaggio ≤120 parole a un collega per test chat on-device S23 (2.4 bpw, ~5 tok/s, schermo acceso, annotare T/batteria/tok-s).

**Output (intero, run `…-164916`, eval 5.52 tok/s, batt 40%):**

```
Ciao,
per il test dell'app di chat on-device su Samsung S23, stiamo utilizzando un modello MoE quantizzato a circa 2.4 bit per peso. L'obiettivo è verificare le prestazioni in scenari reali.
La velocità attesa è di circa 5 token al secondo. Per garantire che il processo resti in foreground e non venga sospeso dal sistema, è fondamentale mantenere lo schermo acceso durante l'intera sessione.
Per favore, annota con precisione:
- La temperatura del dispositivo durante il test.
- Il consumo di batteria.
- I token generati al secondo (tok/s) effettivi.
```

**Giudizio: usabile.** Tutti i vincoli di contenuto rispettati; tono professionale; italiano naturale.

### Prompt 3 — IT istruzioni letterali (`f45_3_istruzioni`)

**Prompt:** esattamente 3 frasi sul perché misurare a batteria scarica ≠ piena; poi esattamente 2 domande; niente altro; solo italiano.

**Output (intero, run `…-165426`, eval 6.04 tok/s, batt 38%):**

```
Misurare le prestazioni a batteria scarica rivela i limiti termici e la degradazione della tensione, mentre il test a batteria piena non sempre evidenzia questi colli di bottiglia critici.
La stabilità della frequenza di clock tende a crollare sotto carico quando l'alimentazione è ridotta, un fenomeno che rimane nascuro con una carica ottimale.
Questo approccio differenziato permette di identificare le reali capacità di gestione dell'energia del dispositivo in condizioni estreme.
Quali sono i valori di temperatura massima raggiunti durante il test a batteria scarica?
```

**Giudizio: degradato.** Tre frasi ok (typo «nascuro»). Poi **una sola** domanda invece di due; il budget token finisce. Istruzioni parzialmente ignorate. Testo ancora leggibile e on-topic.

### Prompt 4 — codice Python (`f45_4_codice`)

**Prompt:** funzione `median_eval_tok_s(rows)` con filtri nproc≥6, mediana, `None` se vuoto, esempio `if __name__`, no markdown fences.

**Output (intero, run `…-165953`, eval 4.75 tok/s, batt 37%):**

```python
def median_eval_tok_s(rows):
    """Return the median of eval_tok_s for rows where nproc is not None and nproc >= 6.
    Ignores rows with missing eval_tok_s. Returns None if fewer than 1 valid value remains.
    """
    valid_values = []
    for row in rows:
        eval_tok_s = row.get("eval_tok_s")
        nproc = row.get("nproc")
        if eval_tok_s is None:
            continue
        if nproc is None or nproc < 6:
            continue
        valid_values.append(eval_tok_s)
    if len(valid_values) < 1:
        return None
    valid_values.sort()
    n = len(valid_values)
    if n % 2 == 1:
        return valid_values[n // 2]
    else:
```

**Giudizio: degradato.** Logica corretta fino al ramo dispari; tronco sul ramo pari e manca l'usage example (limite 200 token). Ha messo fence markdown vietate. Non è codice inutilizzabile: si completerebbe in 10–20 token.

### Prompt 5 — IT ragionamento (`f45_5_ragionamento`)

**Prompt:** 5.0 vs 1.2 tok/s a T simile → A termico / B cpuset 3 little / C quant? Una opzione, ≤5 frasi, controllo concreto.

**Output (intero, run `…-171017`, eval 5.36 tok/s, batt 35%):**

```
La spiegazione più plausibile è la **(B) il processo è finito in un cpuset con solo 3 core little**.
I benchmark MoE moderni sono altamente parallelizzati e richiedono multi-threading; passare da 8 core a 3 core "little" (generalmente lenti) ridurrebbe drasticamente la velocità da 5.0 a circa 1.2 tok/s, mentre un throttle termico (A) causerebbe un calo graduale, non un salto netto tra run separati. La quantizzazione (C) influisce sulla velocità ma non giusterebbe un divario così ampio senza altri cambiamenti hardware.
```

**Giudizio: usabile.** Risposta corretta (B), motivazione solida (allineata alla lezione F4 cpuset). Manca il controllo concreto richiesto (`/proc/PID/status Cpus_allowed_list`). Typo «giusterebbe».

### Confronto 4B Q4_K_M (stesso prompt 1)

**Output (run `…-172000`, eval 8.00 tok/s, batt 33%, mainline, senza `--no-think`):**

Il 4B ha speso i 200 token in *thinking in inglese* (`[Start thinking]… Drafting - Key Points…`) e **non ha prodotto la risposta italiana**. Confronto sbilanciato (manca `--no-think` su mainline). Non invalida il 35B; mostra solo che il 4B «a caldo» su questo path non ha chiuso la risposta nel budget.

### Tabella giudizi F4.5

| prompt | livello | citazione rappresentativa |
|---|---|---|
| f45_1 esplicativo IT | **usabile** | «un MoE attiva solo un sottoinsieme selezionato tramite un meccanismo di routing» |
| f45_2 scrittura IT | **usabile** | «modello MoE quantizzato a circa 2.4 bit per peso… circa 5 token al secondo» |
| f45_3 istruzioni IT | **degradato** | 3 frasi ok + **1** domanda invece di 2; «nascuro» |
| f45_4 codice | **degradato** | funzione corretta ma tronco su `else:`; fence markdown |
| f45_5 ragionamento IT | **usabile** | «**(B) il processo è finito in un cpuset con solo 3 core little**» |
| 4B ref (prompt 1) | fatto, non usabile come risposta | thinking EN senza answer IT |

### Verdetto qualità

**UD-IQ2_M NON è inutilizzabile.** 3/5 usabile, 2/5 degradato (troncamento / istruzioni parziali), 0/5 spazzatura. Italiano regge a ~2.4 bpw con `--no-think`. I numeri di throughput del gate restano rilevanti per il prodotto. Non si apre la strada forzata a UD-IQ3_XXS per sola qualità.

Caveat: `n=200` taglia risposte lunghe; per chat reale serve più budget o streaming. Errori minori (typo, stime numeriche) tipici di quant aggressiva.

## F4.7 — curva batteria / tok-s

Config fissa gate: `t=4 --io-threads 4 --cache-mb 2000 --dense-weights anon --overlap`, `n_gen=64`, prompt `short`, phase **`F4.7-batt-curve`**. UNPLUGGED sempre. nproc binario **8** / mask **ff** su tutti i punti. Power saver: **OFF** per tutta la sessione (`adb dumpsys power`: «Battery Saver is currently: OFF»; Termux `dumpsys` non leggibile → colonna script UNKNOWN, adb = fonte di verità).

| battery_pct | T_start °C | eval tok/s | nproc | mask | power saver | run_id |
|---:|---:|---:|---:|---|---|---|
| 32 | 31.3 | **4.84** | 8 | ff | OFF | …-172434 |
| 30 | 30.3 | **4.98** | 8 | ff | OFF | …-174733 |
| 27 | 29.0 | **4.84** | 8 | ff | OFF | …-180757 |
| 25 | 29.4 | **4.92** | 8 | ff | OFF | …-182605 |
| 21 | 28.7 | **4.88** | 8 | ff | OFF | …-190621 |
| 17 | 28.6 | **5.00** | 8 | ff | OFF | …-194721 |
| 13 | 28.5 | **4.64** | 8 | ff | OFF | …-202720 |
| 10 | 28.9 | **4.69** | 8 | ff | OFF | …-205847 |

Range 32→17%: **4.84–5.00** (span ~3%). A 13–10%: **4.64–4.69** (~−6% vs mediana 4.88 dei punti alti). Nessun crollo. Nessuna demotion a 3 core. Power saver **non** si è attivato fino al 9% finale (post-run).

### Lettura

- **Soglia dura non osservata** nella fascia 32–17%: la carica non spiega differenze di throughput a nproc=8 e saver OFF.
- **Lieve soft-dip sotto ~15%** (4.64–4.69): compatibile con sag di tensione / governor, non con cpuset.
- **Power saver non scattato** su questo S23 (policy OEM o soglia più bassa / manuale). La trappola «3 core via saver» **non** si è materializzata qui; resta un rischio di prodotto da ri-testare se l'utente attiva il risparmio a mano.
- Questi numeri **non** sostituiscono il gate 5.02: fase marcata, carica in discesa, un rep per punto, scarica assistita tra punti.

## Deviazioni / confondenti

- Sessione partita a ~42% (F4.5 ha consumato prima); punti 40/35% non campionabili come target alti.
- F4.5: gate termico harness T>32 ha bloccato i prompt 2–5 al primo tentativo; risolto con `cool_wait` (non protocollo di misura tempi, solo per passare il gate).
- Power saver da Termux = UNKNOWN; verità da adb.
- 4B ref senza `--no-think`: confronto qualità 4B vs 35B non equo.
- Scarica lenta: burn `dd` tra punti per non restare ore a idle (non durante i run di misura).

## Verdetto gate

| fase | esito |
|---|---|
| F4.5 qualità | **PASS** — usabile/degradato, non inutilizzabile; throughput resta sensato |
| F4.7 batt-curve | **PASS** (descrittivo) — curva piatta 32–17%, soft-dip 13–10%, saver OFF |

## Prossima azione proposta

- Non aprire F5 da questo agente.
- Opzionale: ripetere un punto F4.7 con power saver **forzato ON** (settings) per documentare l'impatto se l'utente lo attiva.
- Qualità: per chat IT alzare `n_gen` o accettare risposte corte; considerare check periodici anti-typo su prompt istruzioni.
- Ricaricare il telefono (fine sessione **9% UNPLUGGED**).

## Artefatti

- Prompt: `prompts/f45_*.txt` (+ copia telefono `~/experiments/prompts/`)
- Output grezzi: `results/f4.5/*.gen.txt`
- CSV: `results/runs.csv` (phase `F4.5-quality`, `F4.7-batt-curve`; colonna `battery_pct`)
- Curva: `results/f4.7/curve_summary.csv`
- Script: `scripts/start_f4_5_quality.sh`, `scripts/start_f4_7_batt_curve.sh`, `scripts/run_bench.sh`

**Batteria fine sessione: 9% UNPLUGGED, T~31.5°C, power saver OFF, nproc=7 shell / 8 binario.**

DONE
