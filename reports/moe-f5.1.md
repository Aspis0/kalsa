# F5.1 — Conversazione vera multi-turno senza cooldown (S23)

**Stato:** PARZIALE — 5/8 turni completati in sessione continua; turno 6 in prefill quando il controllo agente ha raggiunto il limite di turni. Processo `bmoe-cli --session` ancora vivo sul telefono (non fermato da noi).  
**Tag CSV:** `F5.1 SESSIONE-SENZA-COOLDOWN`  
**HEAD locale al launch:** `f17d9fa` (post-`6293f92`; piano/runtime già presenti).  
**Runtime telefono:** `bmoe-cli` gate `t=4 -c 4096 -n 256 --chatml --no-think --moe-stream --cache-mb 2000 --dense-weights anon --overlap --io-threads 4 --session`  
**Preflight:** `nproc=7` top-app, UNPLUGGED, cold_model.sh solo pre-turno 1, die start ~48 °C, batt 85 %.

## Nota: turno 1 vecchio (sessione morta, log recuperati)

Sessione precedente (pid bmoe 18987, 09:46–09:49) completò solo il turno 1; l’agente morì su `/reload` e il processo restò orfano (kill orchestratore). Log in `results/f5.1/old_session_turn1/`.

| metrica | valore |
|---|---|
| n_prompt / n_past | 97 / 353 |
| tokens / tok_s | 256 / **5.461** |
| prefill_s / TTFT | 8.342 s |
| cache_hit_pct | 79.6 |
| die start→end / max | 59.3→76.6 / **91.2 °C** |
| batt | 87→86 |
| J/token (stima) | 0.62 |
| esito | ok; turno 2 DEAD (processo ucciso) |

Questi numeri **non** entrano nella misura di persistenza KV della nuova sessione (sessione distinta, cold cache ripetuto). Servono solo come riferimento.

## Misura A — Persistenza (KV vs cache esperti)

Regola: dal turno 2, se `n_prompt` ≈ solo token nuovi → KV **persiste**; se `n_prompt` ≈ contesto accumulato e cresce → **RI-PREFILL** (TTFT per-messaggio).

| turno | n_prompt | n_past | prefill_s (TTFT) | hit% | lettura |
|---|---:|---:|---:|---:|---|
| 1 | 97 | 353 | 9.118 | 79.6 | cold + primo prefill |
| 2 | **436** | 692 | **41.159** | 77.6 | ri-prefill ≈ past turno1 + nuovo user |
| 3 | **776** | 1032 | **76.348** | 76.3 | n_prompt ≈ n_past(T2)+user |
| 4 | **1119** | 1375 | **123.885** | 76.1 | cresce ~+343/turno |
| 5 | **1441** | 1697 | **165.253** | 75.9 | cresce ~+322/turno |

**Verdetto A — KV: PER-MESSAGGIO (RI-PREFILL).**  
Dal turno 2, `n_prompt` non è “solo token nuovi” (~80–100): è ~ contesto accumulato (436, 776, 1119, 1441). TTFT scala quasi linearmente con `n_prompt` (~9→41→76→124→165 s). È il problema n.1 del piano: la sessione **non** riusa il KV come append di solo il messaggio nuovo.

**Verdetto A — cache esperti: CALDA e stabile.**  
Hit-rate turno1 79.6 % → turno2 77.6 % (non crolla a ~3 % cold). Poi 76.3 / 76.1 / 75.9. Due persistenze distinte: **esperti sì, KV no**.

`mib_tok` / I/O prefill (rb_delta intero turno, grezzo): T1 167.4 MiB/prompt-tok (freddo), poi 45.6 / 28.0 / 18.1 / 14.3 — scende perché il numeratore I/O non cresce come `n_prompt` (cache esperti calda), ma il **costo wall di prefill** sì (compute su tutta la sequenza).

## Misura B — Sostenuto (tok/s senza cooldown)

| turno | tok/s | compute s/tok | stall s/tok | die start→end (max) | RSS end MB | batt % |
|---|---:|---:|---:|---|---:|---:|
| 1 | **4.776** | 0.159 | 0.040 | 64.4→64.4 (90.3) | 4002 | 85→84 |
| 2 | **4.274** | 0.180 | 0.041 | 53.1→59.9 (75.8) | 4113 | 84→83 |
| 3 | **3.843** | 0.204 | 0.041 | 52.1→58.9 (73.3) | 3774 | 83→82 |
| 4 | **3.800** | 0.205 | 0.044 | 53.9→60.1 (72.1) | 3821 | 82→80 |
| 5 | **3.539** | 0.225 | 0.044 | 51.8→59.3 (73.3) | 3842 | 80→78 |

- Rapporto primo/ultimo (T1/T5): **4.776 / 3.539 ≈ 1.35** (−26 %).  
- Ultimi 3 (T3–T5): 3.843, 3.800, 3.539 — **non** entro 10 % l’uno dall’altro; discesa monotona leggera.  
- Soglia prodotto >4.0 tok/s: **solo T1–T2**; da T3 **sotto 4.0**, T5 **sotto 3.5**.  
- Compute s/tok sale 0.159→0.225 (+41 %); stall stabile ~0.04. Il calo non è solo stall I/O: c’è componente compute/termica + contesto lungo.

**Verdetto B (su 5 turni, non 8):** **non regge** il criterio “ultimi 3 entro 10 % e >4.0”. Discesa monotona verso/sotto 3.5; prodotto diverso se si esige multi-turno lungo senza cooldown. Curva non ancora “piatta” — servirebbero T6–T8 per chiudere se si assesta.

## Misura C — Qualità, sopravvivenza, energia

**Qualità (giudizio umano, turni 1–5):**  
Filo della conversazione tenuto (Sicilia, budget, bambino, mezzi, cibo). T3 cita esplicitamente i cambi rispetto a prima. T4 spezza il budget. T5 propone posti per zona. Tagli a 256 token: risposte troncate a metà frase (T1 “Taorm”, T2 “**”, T4 “(~12”, T5 “Ch”). Nessuna parola malformata evidente; qualche imprecisione geografica (Capo d’Orlando vs costa sud-est) e budget T4 etichettato “per 2 persone (600€ a testa)” confuso rispetto a 1200€/persona. Coerenza multi-turno: **sufficiente** per un chat prodotto, ma il troncamento `-n 256` limita la completezza.

**Sopravvivenza:**  
- Nessun kill lmkd nei 5 turni.  
- RSS peak sampler ~4.54 GiB; RSS fine turno ~3.8–4.1 GiB.  
- MemFree min sampler **12.9 MiB** (pressione memoria alta ma processo vivo).  
- n_past T5 = 1697 su n_ctx 4096 → headroom ancora c’è per T6–T8 se la sessione continua.

**Energia (stima V×I×t, grezza):**  
J/token: 0.30 / 0.84 / 1.23 / 1.76 / 1.62.  
Da T3 in poi **≥1.2**, in linea o sopra la fascia F4.7 (1.0–1.4). T4–T5 sopra 1.6: il prefill lungo domina l’energia per token generato.

## Sicurezza

- die max sessione nuova: **90.3 °C** (turno 1 load/decode); poi picchi turni ~72–76 °C. **Mai >98 °C** → nessuno stop termico.  
- batteria: 85 % → 78 % a fine T5; UNPLUGGED. **Mai <30 %**.  
- Sessione ancora in esecuzione (turno 6 prefill) al momento del report — non interrotta per safety.

## Curva die (sintesi)

Load → picco ~90 °C; ogni turno: prefill/decode ~65–75 °C, poi scende a ~52–55 °C tra turni (senza cooldown esplicito, solo gap di pochi secondi di safety/battery). Non c’è accumulo termico monotono verso 98 °C nei 5 turni: il die “respira”, ma il tok/s scende comunque (compute + contesto).

## Conversazione integrale (turni 1–5)

Vedi `results/f5.1/conversation_full.txt` (testo completo pullato). Sintesi path: viaggio Sicilia 7gg Milano, budget 1200€, poi alloggio/mezzi, vincolo bambino 6 anni + spiaggia, budget spezzato, 4 posti cibo. Turni 6–8 non ancora nel file.

## Cosa non dice

1. **Non dice** se T6–T8 reggono o se lmkd/ctx overflow colpiscono: sessione ancora in corso; report chiuso a 5/8 per limite di controllo agente.  
2. **Non dice** che il KV “non esiste” in memoria: dice solo che l’API di sessione con `clear_kv=false` + `--chatml` **ri-prefilla** l’intero contesto (n_prompt crescente). Se il KV fosse riusato, n_prompt resterebbe ~token del solo messaggio nuovo.  
3. **Non dice** che la cache esperti sia il problema n.1: hit ~76–80 % è calda; il buco è il **prefill per-messaggio**.  
4. **Non dice** un numero di prodotto unico “tok/s chat”: con ri-prefill, la latenza utente = TTFT(prefill intero) + decode; tok/s decode scende sotto 4.0 dal turno 3.  
5. Energia J/token mescola prefill+decode+overhead; non è J/token di solo decode.  
6. Turno 1 vecchio (5.46 tok/s) era su die più caldo in decode e non è confrontabile 1:1 con T1 nuovo (4.78) come “regressione runtime” senza ripetizioni.

## Artefatti

- `results/f5.1/` — sessione nuova (turns, sampler, master, conversation, done_lines, partial session.stdout)  
- `results/f5.1/old_session_turn1/` — turno 1 recuperato  
- Script: `scripts/start_f5_1.sh` (già sul telefono in `~/scripts/`)

## Blocker / follow-up

- **Blocker report:** 8 turni non chiusi in questo controllo (sessione viva al T6). Serve un pull finale quando `STATUS` = DONE o safety stop, poi aggiornare tabella T6–T8.  
- **Prodotto:** senza KV append, multi-turno lungo su 35B-A3B è TTFT-bound; mitigazione = fix riuso KV in session path, non solo cache esperti.  
