# Report — misure DA STACCATO (quanto vale tutto in secondi veri)

**Stato:** PARZIALE — **Cella 1 COMPLETA** (2 rep × 5 turni); Celle 2–4 **non scientifiche** (blocco `nproc=3` / cpuset `/moderate` dopo demotion schermo).  
**Data:** 2026-08-08  
**Mandato:** `mandates/misure-staccato.md`  
**Binario:** `bmoe-cli.CAMPAIGN` = DENSE2  
`sha256 cab204321d478931be1332f816fe5ed6a6fa26bde632dde45af9bf002fa0d6c8`  
**PREFAULT:** intatto (non toccato).  
**Config campagna (Cella 1):** `-t 4 -c 4096 -n 256 --temp 0 --chatml --no-think --moe-stream --cache-mb 2000 --dense-weights anon --overlap --io-threads 4 --ubatch 512 --session`

---

## Condizioni

| | start Cella 1 | fine Cella 1 (rep2 T5) | blocco C2–4 |
|---|---|---|---|
| plugged | **UNPLUGGED** | UNPLUGGED | UNPLUGGED |
| batteria % | **100** | **92** | 90 |
| batt temp °C | 28.5 | ~41.6 | 30.1 |
| die (max preflight) | 46.2 | — | — |
| nproc | 7 (top-app) | 6–7 | **3** (`/moderate`) |
| uptime start | ~3h38 | — | — |

Flight recorder attivo in Cella 1 (`results/staccato/flight.log`).  
Prompt F5.1 P1–P5 archiviato con sha in `results/staccato/prompt_sha256.txt` (byte-identici a `start_f5_1.sh`).  
fadvise GGUF solo a inizio conversazione (non fra turni).

---

## CELLA 1 — il numero del prodotto (PRIORITÀ) — **PASS**

Conversazione 5 turni stile F5.1, `clear_kv=true` solo al turno 1, poi `false`. 2 ripetizioni. Cache esperti calda fra turni = parte del fenomeno.

### Tabella per turno (mediana 2 rep)

| turno | n_prompt | n_common | prefill_s | tok/s | wall_s | F5.1 prefill_s | F5.1 n_prompt | speedup prefill |
|------:|---------:|---------:|----------:|------:|-------:|---------------:|--------------:|----------------:|
| 1 | 97 | 0 | **9.91** | 3.95 | 78 | 9.12 | 97 | ~1.0× |
| 2 | **87** | **353** | **9.70** | 3.52 | 84 | 41.16 | 436 | **4.2×** |
| 3 | **88** | **696** | **10.99** | 3.38 | 88 | 76.35 | 776 | **6.9×** |
| 4 | **92** | **1040** | **11.71** | 3.36 | 90 | 123.89 | 1119 | **10.6×** |
| 5 | **70** | **1388** | **9.37** | 3.26 | 90 | **165.25** | 1441 | **17.6×** |

### Dettaglio rep (raw)

| rep | T | n_prompt | n_common | n_past | prefill_s | tok_s | wall_s | hit% | batt |
|-----|--:|---------:|---------:|-------:|----------:|------:|-------:|-----:|------|
| 1 | 1 | 97 | 0 | 353 | 9.046 | 4.508 | 68 | 79.6 | 100→100 |
| 1 | 2 | 87 | 353 | 696 | 8.876 | 3.876 | 76 | 79.5 | 100→99 |
| 1 | 3 | 88 | 696 | 1040 | 10.221 | 3.513 | 83 | 79.1 | 99→98 |
| 1 | 4 | 92 | 1040 | 1388 | 11.020 | 3.481 | 86 | 78.7 | 98→97 |
| 1 | 5 | 70 | 1388 | 1714 | **8.917** | 3.430 | 85 | 78.7 | 97→96 |
| 2 | 1 | 97 | 0 | 353 | 10.778 | 3.388 | 88 | 79.6 | 96→96 |
| 2 | 2 | 87 | 353 | 696 | 10.521 | 3.156 | 92 | 79.5 | 96→95 |
| 2 | 3 | 88 | 696 | 1040 | 11.766 | 3.242 | 92 | 79.1 | 95→94 |
| 2 | 4 | 92 | 1040 | 1388 | 12.406 | 3.238 | 93 | 78.7 | 94→93 |
| 2 | 5 | 70 | 1388 | 1714 | **9.828** | 3.083 | 94 | 78.7 | 93→92 |

`n_common` calcolato come `n_past − n_prompt − tokens` (stesso schema smoke adopt-dense2 / G-K1).

### Verdetto Cella 1

1. **KV reuse funziona da staccato.** Dal turno 2, `n_prompt` resta ~70–92 (solo suffisso), non scala a 436→1441 come F5.1.  
2. **Prefill turno 5: mediana 9.37 s vs storico F5.1 165.25 s → ~17.6× più veloce.** Attesa mandato (~5–15 s) **centrata**.  
3. Decode tok/s scende 4.5→3.1 (termico + contesto lungo), stesso ordine di grandezza di F5.1 T5 (3.54). Il guadagno prodotto è sul **TTFT/prefill**, non sul decode.  
4. Hit-rate esperti stabile ~78–80% (calda).  
5. Nessun kill, die max sessione sotto 98 °C, batteria sempre ≥92% in Cella 1.

**Il numero del prodotto (prefill multi-turno lungo): da ~165 s a ~9–10 s al turno 5.**

---

## CELLA 2 — cache 2000 / 3000 / 3500 — **NON ESEGUITA (valida)**

### Tentativo 1 (bug harness, scartato)

- Bug A: `-p` passava un **path** invece del testo prompt → bmoe leggeva il path come prompt (~26 token, risposta “I cannot access files…”).  
- Bug B: `lmkd_count` con `grep -c || echo 0` produceva due righe → `$((…))` abort sotto `set -e` (line 562).  
- Esito: 1 run monco C2000-short-r1, poi jump a decision con n=0 → winner finto 2000.  
- Artefatti spostati in `results/staccato/bad_c234_*` sul telefono. **Non citabili.**

### Tentativo 2 (nproc)

Dopo Cella 1 il telefono è sceso a **cpuset `/moderate`, nproc=3** (schermo off / Termux non top-app).  
Preflight rifiuta nproc&lt;6 (regola F4.3-bis / mandato).  
Waiter `wait_nproc_staccato.sh` ha atteso ~5+ min senza recovery (OEM non promuove SSH idle a top-app).

**Decisione Cella 2:** **non presa** (dati assenti). Default operativo resta **cache 2000** finché gualt non ha sweep valido.  
Regola fissa non applicabile senza mediane.

---

## CELLA 3 — ubatch 512 vs 2048 — **NON ESEGUITA (valida)**

Stesso blocco nproc=3. Nessuna misura prefill d1_long valida.  
**Decisione:** non presa; in dubbio resta **512** (regola mandato).

---

## CELLA 4 — plateau n=512 — **NON ESEGUITA (valida)**

Un run monco pre-fix (prompt=path, EOS a 98 token, wall 43 s, blocks=0) è **scartato**.  
Curva tok/s per blocco 64: **assente**.

---

## runs.csv

10 righe Cella 1 in `results/staccato/runs_added.csv` e concatenate su telefono `~/experiments/results/runs.csv` (fase `STACCATO-C1`, `bin_sha256=cab20432…` in notes).  
Riga plateau C4 monca presente sul telefono: **da ignorare** (notes `cella=4;plateau` con prompt errato).

---

## Artefatti

```
results/staccato/
  cella1/turns.csv          # 10 righe valide
  cella1/rep{1,2}/          # session logs, done_lines, conversation, sampler
  prompts/f5_1_t{1..5}.txt + prompt_sha256.txt
  runs_added.csv
  flight.log
  STACCATO.master.log
  batt_start.json
  STOP_REASON.txt           # NPROC_LOW (post C1)
scripts/run_staccato.sh     # harness (fix -p text, lmkd, resume --from-cella2)
scripts/wait_nproc_staccato.sh
```

---

## Blocker / follow-up

| id | severità | dettaglio |
|---|---|---|
| B1 | **ALTO** | Dopo Cella 1, cpuset `/moderate` nproc=3. Celle 2–4 richiedono schermo acceso + Termux foreground (top-app, nproc≥6). Non recuperabile da solo SSH. |
| B2 | MEDIO (fixato in script) | `-p` = testo, non path; `lmkd_count` mono-intero; hard-stop su rc 93; resume `--from-cella2`. |
| B3 | BASSO | Plateau: usare prompt lungo anti-EOS + `--progress` (`step`) — già nel fix script. |

**Per chiudere C2–C4:** sbloccare schermo S23, Termux in foreground, verificare `nproc≥6`, poi:

```bash
bash ~/experiments/scripts/run_staccato.sh --detach --from-cella2
```

---

## Sintesi per gualt (adozioni)

| cella | verdetto | adozione |
|---|---|---|
| 1 multi-turno | **PASS** — T5 prefill ~9.4 s vs 165 s F5.1 | prodotto: KV reuse vale **~18×** sul prefill lungo |
| 2 cache | dati assenti | **resta 2000** finché non c’è sweep |
| 3 ubatch | dati assenti | **resta 512** (in dubbio vince 512) |
| 4 plateau | dati assenti | solo misura — da rifare |

**STOP al report.** Nessuna adozione cache/ubatch senza C2/C3 validi. Mai `complete_goal`.
