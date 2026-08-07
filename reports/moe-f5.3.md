# F5.3 — Tre cose che sono diventate possibili oggi — 2026-08-07

**Stato:** DONE_PARTIAL — fase A 10/10 turni completata; B e C non partite (STOP_BATT:28).  
**Device:** Samsung S23 (SM-S911U), UNPLUGGED, top-app.  
**Runtime:** `bmoe-cli` commit `b0c4e5b`, modello Qwen3.6-35B-A3B-UD-IQ2_M.  
**Harness:** `scripts/start_f5_3.sh --run` (detached, nohup; PID launcher 31241, bmoe 400).  
**HEAD al launch script (non committato):** e9f9491 + `scripts/start_f5_3.sh` untracked.  
**Stop:** safety floor batteria 30% → post T10 batt=28% → STOP prima di B.

## Cosa è stato fatto (vs piano)

| cella | piano | esito |
|---|---|---|
| **A** sessione 10 turni `--ubatch 512 -c 8192 --session clear_kv=false` + sampler `cur_freq` (cpu0/3/5/7) 500 ms | 10 turni IT concatenati, no cooldown | **10/10 ok** |
| **B** LFM2-8B-A1B Q4_0 vs Q4_K_M (3+1 rep cold, `--ubatch 256 --cache-mb 400`) | kernel GEMM compute s/tok | **non eseguita** (STOP_BATT:28) |
| **C** sweep cache-mb 2000/2500/3000/3500 ×2 (`--ubatch 512 -c 4096 -n 256`) | hit% vs simulatore M5 | **non eseguita** (STOP_BATT:28) |
| **D1** (coda gualt) ubatch 512 vs 2048, stesso prompt byte-identico lungo >512 tok, `--temp 0` | equivalenza output | **non eseguita** (batt 28% <35%) |
| **D2 / F5.3-ubatch-sweep** (coda gualt) ubatch 256/512/1024/2048, prefill_tps + decode + RSS + sched_reserve | plateau vs #18725 | **non eseguita** (batt 28% <35%) |

Config A effettiva (master.log):  
`-t 4 -c 8192 -n 256 --chatml --no-think --moe-stream --cache-mb 2000 --dense-weights anon --overlap --io-threads 4 --ubatch 512 --session`  
T1 `clear_kv=true`, T2–T10 `clear_kv=false`. Cold model solo pre-T1.

## Numeri chiave — Fase A

| turno | tok/s | compute s/tok | cur_freq_prime | hit% | n_prompt | n_past | prefill_s | RSS peak GiB | die max °C | batt % |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 1 | **5.275** | 0.1374 | **2.51 GHz** | 79.3 | 96 | 352 | 8.1 | 3.97 | **91.2** | 50→49 |
| 2 | 4.442 | 0.1736 | 1.77 GHz | 78.1 | 435 | 691 | 37.7 | 3.97 | 90.3 | 49→47 |
| 3 | 4.272 | 0.1789 | 1.65 GHz | 75.5 | 774 | 1030 | 73.2 | 3.94 | 76.2 | 47→46 |
| 4 | 3.819 | 0.2040 | 1.47 GHz | 72.7 | 1118 | 1374 | 118.0 | 3.91 | 77.0 | 46→44 |
| 5 | 3.704 | 0.2095 | 1.41 GHz | 71.7 | 1440 | 1696 | 158.3 | 3.59 | 72.5 | 44→42 |
| 6 | 3.589 | 0.2162 | 1.40 GHz | 70.2 | 1780 | 2036 | 200.2 | 3.60 | 70.5 | 42→40 |
| 7 | 3.832 | 0.2075 | 1.39 GHz | 68.6 | 2112 | 2368 | 238.5 | 3.59 | 72.1 | 40→38 |
| 8 | 3.123 | 0.2605 | 1.35 GHz | 66.8 | 2441 | 2697 | 284.3 | 3.59 | 74.5 | 37→34 |
| 9 | 3.635 | 0.2219 | 1.40 GHz | 65.1 | 2763 | 3019 | 316.8 | 3.59 | 74.9 | 34→31 |
| 10 | 3.197 | 0.2505 | **1.29 GHz** | 63.6 | 3081 | 3337 | 375.7 | 3.60 | 71.3 | 31→**28** |

Fonte: `results/f5.3/a/turns.csv`, `results/f5.3/cells.csv`, sampler `cur_freq*_avg` (kHz sysfs → GHz).  
`cur_freq_prime` = media del cluster medio usato come proxy (cpu5 nella colonna prime del harness).

### A1 SOPRAVVIVENZA — 10/10 vivo

- Sessione continua 10 turni, `bmoe-cli` pid 400 mai morto, `stopped_reason=ok` su ogni riga.
- RSS peak max **3.97 GiB** (T1–T2); da T5 stabilizzato ~**3.59–3.60 GiB**. n_ctx=8192, n_past finale 3337 (headroom ancora presente).
- die max sessione **91.2 °C** (T1 load/decode); mai ≥98 → nessuno stop termico.
- Stop solo per **floor batteria** post-T10 (28% < 30%).

Misura **assoluta**: con `--ubatch 512` e n_ctx 8192 la sessione multi-turno regge 10 turni senza kill del processo e con RSS sotto 4 GiB.  
**Non** si attribuisce qui la differenza rispetto a F5.1 (morte a T6, `wait_rc_1`) a `--ubatch`: i prompt P1 **non sono byte-identici** (vedi lezione metodologica sotto). A1 resta un risultato di sopravvivenza assoluto, non un A/B test di ubatch.

### A2 SOSTENUTO — non assestato

Ultimi 3 turni (T8–T10): **3.123 / 3.635 / 3.197** tok/s.  
Range relativo (max−min)/min = **16.4% > 10%** → **NON assestato**.

Serie completa non monotona: rimbalzi a T7 (3.832) e T9 (3.635) su un trend di fondo discendente da 5.275.  
T5–T7 erano entro ~7% (3.59–3.83) ma T8–T10 riaprono la forbice.  
**Verdetto A2:** non c’è un plateau utilizzabile come “numero di prodotto” multi-turno senza cooldown. Dominanza termica/sostenuta + contesto crescente; serve mitigazione (cooldown, policy freq, o KV-append che tagli il prefill).

### A3 FREQUENZA — CONFERMATO throttling governor

| turno | cur_freq_prime | compute s/tok | tok/s |
|---:|---:|---:|---:|
| 1 | 2.51 GHz | 0.137 | 5.28 |
| 2 | 1.77 GHz | 0.174 | 4.44 |
| 3 | 1.65 GHz | 0.179 | 4.27 |
| 4 | 1.47 GHz | 0.204 | 3.82 |
| 5 | 1.41 GHz | 0.210 | 3.70 |
| 6 | 1.40 GHz | 0.216 | 3.59 |
| 7 | 1.39 GHz | 0.208 | 3.83 |
| 8 | 1.35 GHz | 0.261 | 3.12 |
| 9 | 1.40 GHz | 0.222 | 3.64 |
| 10 | 1.29 GHz | 0.251 | 3.20 |

Mentre `compute_s_tok` sale **0.137 → 0.251** (+83%), `cur_freq_prime` scende **2.51 → 1.29 GHz** (−49%).  
I rimbalzi di tok/s (T7, T9) coincidono con leggeri rialzi di frequenza (1.39–1.40 GHz) e compute più basso.  
**Verdetto A3: CONFERMATO** — il calo sostenuto è riduzione di frequenza (throttling del governor), non solo crescita di contesto. Allineato a F5.2-C2; qui su 10 turni senza cooldown.

Nota collaterale (non A3): `n_prompt` cresce ~+320–340/turno → **ri-prefill** per-messaggio (KV non in append). Hit cache esperti scende 79.3 → 63.6 (calda ma erosa). TTFT = prefill_s 8 → 376 s.

## B — Q4_0 vs Q4_K_M (kernel)

**Non eseguita.** `STOP after A before B: STOP_BATT:28`.  
Cartella `results/f5.3/b/` vuota.  
**Verdetto ramo ri-quant: NON DECISO.** Follow-up prioritario a batteria ≥80%.

## C — sweep cache-mb vs simulatore M5

**Non eseguita.** Stesso stop batteria. `results/f5.3/c/` vuota.  
**Verdetto cache grande: NON DECISO.**

Riferimento simulatore (non validato su telefono in F5.3), `results/f4.8/m5/pass2_curve.tsv` colonna `lru_hit_req_dec`:

| C_mib | lru_hit_req_dec (sim) | Δ vs 2000 |
|---:|---:|---:|
| 2000 | 72.24% | — |
| 2500 | 76.27% | +4.0 pt |
| 3000 | 80.05% | +7.8 pt |
| 3500 | 84.08% | +11.8 pt |

Se il telefono riprodurrà ≥+3 pt da 2000→3500, il simulatore “aveva ragione” e cache grande paga; se <+1.5, saturata a 2000. **Misura ancora da fare.**

## D — test ubatch (coda gualt, non eseguiti)

Batteria fine A = **28%** (<35% soglia gualt, floor harness 30%). **Non eseguiti.**

1. **D1 equivalenza 512 vs 2048:** prompt lungo >512 tok, `--temp 0`, stesso file byte-identico, confronto char-per-char. Interpretazione: identiche → ubatch trasparente; divergenza tardi/sinonimi → rumore FP; divergenza subito/fatti → bug path a blocchi.
2. **D2 sweep 256/512/1024/2048** (`F5.3-ubatch-sweep`): reportare **separati** `prefill_tps` e decode tok/s, `sched_reserve` (stderr), RSS peak. Regola: prefill ≥+15% vs 512 → adotta; 256≈512 entro 5% → tieni 512; se decode cambia con ubatch → segnale (non dovrebbe). Contesto: ggml-org/llama.cpp#18725 (plateau 256–512, calo >1024 su Qwen3-Next CPU; fix #20379 solo Vulkan).

## Lezione metodologica (gualt) — prompt byte-identici

| | F5.1 P1 | F5.3 P1 |
|---|---|---|
| stringa | `… a **metà** settembre …` | `… a **meta** settembre …` |
| file | `scripts/start_f5_1.sh` | `scripts/start_f5_3.sh` |

Un accento cambia la tokenizzazione e da lì l’intera traiettoria di risposta.  
**Conseguenza:** A1/A2/A3 di F5.3 restano **misure assolute valide**. Il confronto “ubatch ha cambiato X rispetto a F5.1” **non è attribuibile**.  
**Regola operativa:** tra fasi confrontabili i prompt devono essere **byte-identici** (stesso file, stesso hash). Segnalato come difetto di questo harness e promemoria per le prossime.

## Deviazioni / sorprese / bug

1. Stop batteria a fine A (start 50% → end 28%): A da sola ha consumato ~22 punti in ~43 min wall. B+C+D richiedono ricarica ≥80% prima del blocco successivo (§8.2).
2. tok/s non monotono: T7 e T9 rimbalzano; A2 non chiude con un plateau.
3. Hit cache scende quasi linearmente 79→64 su 10 turni a cache-mb 2000 fissa (pressione contesto + working set esperti).
4. Prompt non byte-identico con F5.1 (vedi sopra).
5. `scp` non copia `req.fifo` (named pipe) — irrilevante.

## Sicurezza

- die max **91.2 °C**, mai >98.  
- batteria 50% → 28%, UNPLUGGED; floor 30% rispettato dal runner (stop autonomo).  
- nessun pkill/reboot/caricatore; runner lasciato finire.

## Verdetto gate

**PASS-CONDIZIONATO (solo A).**

| criterio | esito |
|---|---|
| A1 sopravvivenza 10 turni | **PASS** (assoluto) |
| A2 sostenuto assestato ultimi 3 ≤10% | **FAIL** (16.4%, non monotono) |
| A3 freq vs compute | **PASS / CONFERMATO** throttling |
| B ramo Q4_0 | **BLOCKED(batt)** |
| C cache sweep + M5 | **BLOCKED(batt)** |
| D ubatch equiv + sweep | **BLOCKED(batt<35%)** |

## Cosa non dice

1. Non dice se Q4_0 è ≥+20% su compute vs Q4_K_M (B assente).  
2. Non dice se cache 3500 paga ≥+3 pt hit vs 2000, né se M5 aveva ragione (C assente).  
3. Non dice se `--ubatch 512` e `2048` producono lo stesso testo a temp 0 (D1 assente).  
4. Non dice quale ubatch massimizza `prefill_tps` su CPU (D2 assente; #18725 ancora aperto su CPU).  
5. Non attribuisce la morte F5.1-T6 a ubatch (prompt non byte-identici).  
6. Non dà un unico “tok/s prodotto multi-turno”: A2 non assestato; prefill per-messaggio domina la latenza utente.

## Artefatti

- `results/f5.3/` — STATUS, master, cells, safety, batt_*, pid, prompts  
- `results/f5.3/a/` — turns.csv, sampler_500ms.csv, conversation_full.txt, done_lines, session logs  
- `results/f5.3/b/`, `c/` — vuote (non partite)  
- `scripts/start_f5_3.sh` — harness A/B/C  
- `scripts/start_f5_1.sh` — presente untracked (preesistente, non modificato qui)

## Prossima azione proposta

1. Ricarica telefono ≥80% UNPLUGGED check.  
2. Eseguire in un solo blocco (stesso harness o script dedicato, **prompt file hash-pinnato**):  
   - B (Q4_0 vs Q4_K_M, compute s/tok, eventuale `--compute-trace` → bucket MUL_MAT_ID)  
   - C (cache 2000…3500 ×2) + confronto a `pass2_curve.tsv`  
   - D1 (512 vs 2048, temp 0, char-diff)  
   - D2 (sweep 256/512/1024/2048, prefill_tps vs decode)  
3. Non riaprire A finché D non chiude la domanda ubatch; A assoluta è già completa.

DONE
