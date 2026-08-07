# F5.4 — IN CARICA, METRICA INVARIANTE — 2026-08-07 (finale)

**Stato:** **DONE** — C quasi completo + D1 IDENTICAL + **B CHIUSO (ramo ri-quant MORTO, motivo: no-repack streaming)** + **D2 DONE** (ubatch sweep).  
**Device:** Samsung S23 (SM-S911U), **PLUGGED_AC / CHARGING**.  
**Runtime:** `bmoe-cli` commit `b0c4e5b`.  
**Modelli:** Qwen3.6-35B-A3B-UD-IQ2_M (C/D1/D2); LFM2-8B-A1B Q4_0 (4733893312 B) e Q4_K_M (5044779712 B) per B.  
**Harness B+D2:** `results/f5.4/run_bd2_only.sh` (= `scripts/run_f5_4_bd2_only.sh`), detached setsid/nohup, PID 13537, 15:08–15:51 EDT.  
**Marca:** tutte le righe **F5.4 IN-CARICA** — non entrano nelle mediane del gate.  
**Stop termico:** die > 95 °C (nessun hard-stop osservato; die max B/D2 = 90.8 °C).

## Ordine previsto vs eseguito

| fase | piano | esito |
|---|---|---|
| **C** cache-mb 2000/2500/3000/3500 ×2 | hit% vs sim M5 | **quasi completo:** 2000/2500/3000 ×2 ok; 3500-r1 ok (hit 76.1); **3500-r2 crash mid-prefill** |
| **D1** ubatch 512 vs 2048, temp 0, stesso file | equivalenza output | **DONE — IDENTICAL** (n_prompt=1318) |
| **B** Q4_0 vs Q4_K_M A/B×3 + work | ramo ri-quant | **DONE — MORTO** (streaming disabilita repack; test ha confrontato 2 kernel generici) |
| **D2** ubatch 256/512/1024/2048 | prefill_tps + decode | **DONE** — prefill +18.8% a 512 vs 256; plateau 512/1024/2048; decode non monotono (anomalia) |

Config base C: `-t 4 --cache-mb … --dense-weights anon --overlap --io-threads 4 --moe-stream --ubatch 512 -c 4096 -n 256 --chatml --no-think --temp 0`.  
Prompt lungo IT: file espanso da `long_conversational_it.txt`. cold_model.sh prima di ogni cella.  
Soglie termiche harness: **STOP ≥95 °C**, avvio/respiro ≤80–85 °C (attive; nessun hard-stop termico osservato).

## Metrica invariante

`work = compute_s_tok × cur_freq_prime` (freq in kHz sysfs; sampler 500 ms su cpu0/3/5/7; `cur_freq_prime` = max(avg cpu3, avg cpu5)).

## C — punti misurati (F5.4 IN-CARICA)

Fonte: `cells.csv` + `=== perf ===` / meta. Marca **F5.4 IN-CARICA**.

| cella | C_mib | hit% | mib/tok | read MiB | compute s/tok | cur_freq_prime | work | tok/s | prefill_tps | RSS peak | die max °C | batt |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| F5.4-C-cache2000-r1 | 2000 | **71.1** | 32.93 | 8430 | 0.154 | 2.036 GHz | 313481 | 5.130 | 11.39* | 4.36 GiB | **90.8** | 29→28 |
| F5.4-C-cache2000-r2 | 2000 | **71.1** | 32.93 | 8430 | 0.179 | 1.542 GHz | 275996 | 4.332 | 9.62* | 4.40 GiB | 89.5 | 28→28 |
| F5.4-C-cache2500-r1 | 2500 | **73.3** | 24.80 | 6350 | 0.153 | 2.126 GHz | 325290 | 4.673 | 11.6 | 4.45 GiB | 90.3 | 31→31 |
| F5.4-C-cache2500-r2 | 2500 | **73.3** | 24.80 | 6350 | 0.159 | 2.085 GHz | 331534 | 4.339 | 11.53 | 4.45 GiB | 90.3 | 34→33 |
| F5.4-C-cache3000-r1 | 3000 | **75.1** | 18.35 | 4698 | 0.394 | 1.628 GHz | 641495 | 2.143 | 6.13 | 4.56 GiB | 89.9 | 33→33 |
| F5.4-C-cache3000-r2 | 3000 | **75.1** | 18.35 | 4698 | 0.231 | 1.608 GHz | 371374 | 3.339 | 7.61 | 4.60 GiB | 89.5 | 33→33 |
| F5.4-C-cache3500-r1 | 3500 | **76.1** | 14.63 | 3746 | 0.842 | 2.593 GHz | 2183542 | 1.064 | 7.17 | 4.54 GiB | **90.8** | 33→31 |
| F5.4-C-cache3500-r2 | 3500 | — | — | — | — | — | — | — | — | — | ~90.3† | 31→? |

\*prefill_tps C=2000 recuperato offline da perf (CSV harness live a 0 per r1/r2).  
†sampler mid-crash; cella **incompleta** — non usare.

- hit% **identico** r1/r2 a 2000/2500/3000 → conteggio deterministico ok in carica.  
- hit sale con C ma **sub-lineare**: 71.1 → 73.3 → 75.1 → 76.1 (+5.0 pt su 2000→3500).  
- mib/tok e read MiB scendono come atteso (32.9 → 14.6; 8430 → 3746).  
- work **non** stabilizza a C=3500-r1 (freq_prime alta + compute_s_tok 0.842 → work outlier); normalizzazione incompleta su pochi punti termici.  
- sched_reserve (ubatch 512, n_ctx 4096): **501.02 MiB** costante.

### Simulatore M5 vs misura (lru_hit_req_dec)

Rif. `results/f4.8/m5/pass2_curve.tsv`:

| C_mib | sim hit% | misura hit% | scarto (misura − sim) |
|---:|---:|---:|---:|
| 2000 | 72.236 | **71.1** (×2) | **−1.14 pt** |
| 2500 | 76.27 | **73.3** (×2) | **−2.97 pt** |
| 3000 | 80.049 | **75.1** (×2) | **−4.95 pt** |
| 3500 | 84.082 | **76.1** (×1) | **−7.98 pt** |
| Δ 2000→3500 | +11.85 pt (sim) | **+5.0 pt** (misura) | sim **sovrastima** il beneficio |

**Verdetto C:** M5 ha ragione sulla **direzione** (hit↑ con cache) ma **sbaglia la pendenza**: scarto monotono −1.1 → −8.0 pt; guadagno reale 2000→3500 ≈ **+5 pt**, non +12. Regola prodotto ≥+3 pt su 2000→3500: **sì numericamente (+5)**, ma il costo RSS/termico a 3500 (crash r2, work outlier, die 90.8 °C) e lo scarto sim crescente **non** supportano promuovere cache grande in config di prodotto. **Non** promuovere cache 3000–3500; M5 **non** è affidabile come predittore quantitativo oltre ~2000–2500 MiB.

## D1 — ubatch cambia l'output? (F5.4 IN-CARICA)

**Eseguito** 2026-08-07T14:46–14:54 EDT via `run_d1_only.sh` (gates batt+die attivi; `termux-battery-status` dopo `export PREFIX/PATH`).  
**Config:** `-t 4 -c 2048 -n 256 --cache-mb 2000 --dense-weights anon --overlap --io-threads 4 --moe-stream --chatml --no-think --temp 0`.  
**Prompt:** `~/experiments/prompts/d1_long.txt` (copia stabile di `results/f5.4/prompts/d1_prompt.txt`, sha256 `96629f53…e37650`, 5210 B) — **stesso file byte-identico** per entrambe le run.  
**n_prompt:** **1318** (confermato `prefill: 1318 tokens` in entrambi i log; **>512** → i due ubatch processano in blocchi multipli).

| cella | ubatch | n_prompt | tokens | tok/s | prefill_tps | die max °C | batt | rc |
|---|---:|---:|---:|---:|---:|---:|---|---:|
| F5.4-D1-ubatch512 | 512 | **1318** | 256 | 4.824 | 12.0 | **90.3** | 39→38 | 0 |
| F5.4-D1-ubatch2048 | 2048 | **1318** | 256 | 4.393 | 10.9 | **89.9** | 38→38 | 0 |

**Confronto carattere-per-carattere** (`compare.txt` + `diff` locale):

- `len_512=1006` = `len_2048=1006` (gen strip); raw 1007 = 1007.
- `VERDICT=IDENTICAL` · `first_diff_at=-1`.
- head (primi ~50 char, entrambi):
  `L'orologio digitale sul muro della carrozza 7 segn`
- sha256 gen (entrambi): `d335145116b93eb5…` (identico).

**Verdetto D1:** output **identici** a temp 0 con prompt byte-identico e n_prompt=1318>512. **ubatch è trasparente** sul testo generato — questione chiusa. Il confronto F5.1 vs F5.3 resta invalidato **solo dall'accento** nel prompt, non da ubatch. Nessun sospetto bug nel percorso a blocchi da questi dati. Marca **F5.4 IN-CARICA** (non entra nelle mediane gate).

Artefatti: `results/f5.4/d1/ubatch512.out`, `ubatch2048.out`, `*.gen.txt`, `compare.txt`, `D1.master.log`, `run_d1_only.sh`.

## B — Q4_0 vs Q4_K_M (F5.4 IN-CARICA) — ramo ri-quant

**Eseguito** 2026-08-07T15:08–15:33 EDT via `run_bd2_only.sh` (PREFIX/PATH; gates batt+die; cold_model ogni run; A/B interleaved ×3).

### Config IDENTICA (dichiarata)

```
-t 4 -c 4096 -n 256 --ubatch 512 --moe-stream --cache-mb 400 --force-cache
--dense-weights anon --io-threads 4 --chatml --no-think --temp 0
# NO --overlap (RAM stretta)
```

- **cache-mb 400 + --force-cache**: il binario rifiuta cache &lt;1500 senza force (`pathological band`). Cache piccola per tenere Q4_0 (4.73 GB) e Q4_K_M (5.04 GB) nello **stesso regime di memoria** (lezione C: work si sfascia sotto pressione RAM).
- Prompt: `prompts/b_prompt.txt` (2205 B, sha `c64a9cc3…`). n_prompt = **655**.
- Ordine: Q4_0-r1 → Q4_K_M-r1 → Q4_0-r2 → Q4_K_M-r2 → Q4_0-r3 → Q4_K_M-r3.

### Tabella run (marca F5.4 IN-CARICA)

| cella | tok/s | compute s/tok | cur_freq_prime | work | RSS peak | MemAvail min | die max | batt | hit% | mib/tok |
|---|---:|---:|---:|---:|---:|---:|---:|---|---:|---:|
| F5.4-B-Q4_0-r1 | 1.535 | **0.063** | 2.035 GHz | 128218 | 3.11 GiB | 3.86 GiB | **90.8** | 42→41 | 0.0 | 520.78 |
| F5.4-B-Q4_K_M-r1 | 1.404 | **0.063** | 1.631 GHz | 102752 | 3.24 GiB | 3.89 GiB | **90.8** | 41→41 | 0.0 | 556.88 |
| F5.4-B-Q4_0-r2 | 1.640 | **0.068** | 1.582 GHz | 107581 | 3.52 GiB | 3.95 GiB | 90.3 | 41→40 | 0.0 | 520.78 |
| F5.4-B-Q4_K_M-r2 | 1.462 | **0.062** | 1.556 GHz | 96456 | 3.23 GiB | 3.98 GiB | 90.3 | 40→40 | 0.0 | 556.88 |
| F5.4-B-Q4_0-r3 | 1.613 | **0.068** | 1.509 GHz | 102620 | 3.74 GiB | 3.97 GiB | 90.3 | 40→40 | 0.0 | 520.78 |
| F5.4-B-Q4_K_M-r3 | 1.505 | **0.061** | 1.361 GHz | 83029 | 3.81 GiB | 3.99 GiB | 89.9 | 40→39 | 0.0 | 556.88 |

- I/O domina: flash I/O ~0.45–0.51 s/tok vs compute ~0.06 s/tok; **hit 0.0%** (cache 400 thrash: 90.2 re-read/token).  
- MemAvailable min **simile** fra arm (~3.86–3.99 GiB) → **stesso regime memoria** (non un arm in thrash e l'altro no). RSS Q4_K_M ≈ Q4_0 + ~100–300 MB (file +300 MB).  
- **work instabile** tra rep stesso modello (Q4_0 max_dev_from_med 19%; Q4_K_M 14% &gt; tol 10%) — quasi tutto da **freq_prime** (throttling progressivo 2.0→1.5→1.4 GHz), non da compute (0.061–0.068 stabile). B_VALID=0 su metrica work → **non** usare mediana work per la regola ±20%.

### Chiusura analitica GFLOP/s (su dati già raccolti)

Geometria LFM2-8B-A1B da GGUF/stderr load (fonte: `F5.4-B-Q4_0-r1.stderr.log`):

| param | valore |
|---|---:|
| arch | lfm2moe |
| n_embd | 2048 |
| n_layer | 24 |
| leading_dense_block_count | 2 → **22 MoE layers** |
| n_expert / n_expert_used | 32 / **4** |
| n_ff_exp (gate/up/down) | **1792** |

FLOP/token expert GEMM (3 matmul × MAC×2):

`4 × 22 × 3 × 2 × 2048 × 1792 = 1.938 GFLOP/token`

Riferimento 35B IQ2 (F5.2, expert_gemm @ ctx 300):
`8 × 40 × 3 × 2 × 2048 × 512 = 2.013 GFLOP/token` @ 98.65 ms → **~20.4 GFLOP/s**.

| arm | compute med | GFLOP/s se *tutto* compute = expert (LB) | se expert ≈ 50% compute |
|---|---:|---:|---:|
| Q4_0 | 0.068 | **28.5** | ~57 |
| Q4_K_M | 0.062 | **31.3** | ~63 |
| progress compute_ms ~55–58 ms | 0.055–0.058 | **33–35** | ~66–70 |

Q4_0 e Q4_K_M danno **GFLOP/s quasi identici** (~30–35 LB). Non c'è un vantaggio kernel Q4_0 vs Q4_K_M misurabile qui.

### Perché il ramo ri-quant è MORTO (verdetto corretto — codice)

`session.cpp:404–408` (confermato sul device, b0c4e5b):

> *Load with the layout the streamer requires: file-backed mmap, no repack (a repacked q4_K buffer would break the rebind), experts on CPU.*  
> `use_mmap = true; use_extra_bufts = false;` → **disabilita** `ggml_backend_cpu_repack_buffer_type()`.

| percorso | quant | buffer / kernel |
|---|---|---|
| streaming 35B IQ2 | IQ2_M | generico (IQ2 non ha repack veloce) |
| streaming 35B Q4_0 | Q4_0 | **ancora generico** (tipo ok, **buffer no-repack**) |
| non-streamed (mmap repack) | Q4_0 / Q4_K / Q8_0 / IQ4_NL | percorso **veloce** repack |

Il test B (cache 400, hit 0%, mib/tok 520–557) confrontava **due kernel generici equivalenti** — non ha testato l'ipotesi «Q4_0 kernel più veloce di K-quant». I GFLOP/s ~33–35 su entrambi lo confermano. **Scaricare 20 GB di 35B in Q4_0/IQ4_NL non cambierebbe il kernel sotto streaming.**

**Verdetto B:** ramo ri-quantizzazione **MORTO** — non perché «il codebook IQ2 costa poco», ma perché **il percorso veloce (repack) è irraggiungibile dallo streaming degli esperti**. Motivo strutturale nel loader, non empirico-marginale.

**Leva vera (nuova):** pre-paccare gli esperti nel GGUF nel layout repacked → lo streaming copia i byte e il kernel veloce li accetta (il buffer dichiara il tipo giusto). Ripaccare a ogni miss = CPU sul critical path (no). Pre-pack nel file = sì. Nessuno in letteratura perché nessuno streamma gli esperti.

Caveat: work instabile (freq) → regola ±20% su work **non applicata**; la chiusura è sul codice + GFLOP/s equivalenti, non sulla mediana work.

## D2 — sweep ubatch 256/512/1024/2048 (F5.4 IN-CARICA)

**Eseguito** 2026-08-07T15:33–15:51 EDT.  
**Config gate:** `-t 4 -c 4096 -n 256 --cache-mb 2000 --dense-weights anon --overlap --io-threads 4 --moe-stream --chatml --no-think --temp 0`.  
**Modello:** Qwen3.6-35B-A3B-UD-IQ2_M.  
**Prompt:** stesso file D1 (`d1_prompt.txt`, n_prompt=**1318**). cold_model ogni cella.

| cella | ubatch | prefill_tps | decode tok/s | compute s/tok | cur_freq_prime | work | sched_reserve | RSS peak | die max | batt |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| F5.4-D2-ubatch256 | 256 | **8.0** | **4.024** | 0.185 | 1.374 GHz | 254137 | **250.51 MiB** | 4.10 GiB | 86.3 | 39→39 |
| F5.4-D2-ubatch512 | 512 | **9.5** | **3.574** | 0.215 | 1.507 GHz | 323939 | **501.02 MiB** | 4.14 GiB | **90.3** | 39→39 |
| F5.4-D2-ubatch1024 | 1024 | **9.4** | **3.574** | 0.212 | 1.515 GHz | 321249 | **1002.04 MiB** | 4.62 GiB | 89.5 | 39→39 |
| F5.4-D2-ubatch2048 | 2048 | **9.4** | **4.157** | 0.178 | 1.469 GHz | 261400 | **2004.08 MiB** | 4.29 GiB | 89.9 | 39→39 |

Fonte prefill/decode: riga `prefill:` / `generation:` in stdout (parser harness prefill_tps=0 — recuperato offline).  
sched_reserve **esatto** da stderr `CPU compute buffer size` — scala ~lineare con ubatch (250→501→1002→2004 MiB).

### Regole D2

1. **Prefill ≥ +15% vs 512?**  
   - vs baseline **256**: 512 dà **+18.8%** prefill_tps (8.0 → 9.5) → **sì, adottare ≥512**.  
   - vs **512**: 1024/2048 = 9.4 (**−1%**, ns) → **nessun guadagno** oltre 512. Plateau 512–2048.  
   - Coerente con issue ggml-org/llama.cpp#18725 (plateau 256–512, calo sopra 1024 su famiglia ibrida): qui **non** c'è calo prefill sopra 1024, solo plateau.

2. **Decode non dovrebbe cambiare con ubatch** (un token in volo).  
   - 256: 4.024 · 512: 3.574 · 1024: 3.574 · 2048: 4.157.  
   - **ANOMALIA:** decode **non** costante — −11% a 512/1024 vs 256, poi +16% a 2048 vs 512. **Non usare decode come criterio di scelta ubatch**; segnalare come anomalia (possibile confondimento termico/freq/cache-hit: hit sale 60→79% con ubatch, e die/freq variano).  
   - Prefill è la metrica che conta per il costo di turno.

**Verdetto D2:** adottare **ubatch 512** (o lasciare 512 di default prodotto). Non salire a 1024/2048: prefill piatto, sched_reserve ×2/×4, RSS peggiore a 1024. Decode varia → **anomalia da capire**, non risultato da usare.

## Sicurezza

- die max osservato **90.8 °C** (C e B); D1 90.3; D2 90.3; mai ≥95 (STOP).  
- batteria B+D2: **42→39–40% PLUGGED_AC** (CHARGING). Floor batteria disabilitato in carica.  
- nessuno scollegamento caricatore, no broad pkill, no reboot.  
- Gate: `termux-battery-status` + die thermal attivi preflight e pre-cella (PREFIX/PATH in testa a ogni script).  
- nproc=6 (≥6). LD_LIBRARY_PATH = dir binario. cold_model.sh ogni cold run.

## Deviazioni / bug harness

1. **Crash mid-C a cache-mb 3500-r2** (e storico 2500 al primo launch).  
2. Parser live `tok_s`/`mib_tok` multi-grep corrotto (numeri da stdout `generation:` / meta).  
3. `prefill_tps` CSV a 0 su B/D2; recuperato da riga `prefill:` stdout.  
4. `--cache-mb 400` rifiutato senza `--force-cache` (pathological band &lt;1500) — fix harness B.  
5. Stability script B: chiavi meta `rss_peak` / `mem_available_min_kb` non parsate nello stab print (work sì) — non ha invalidato il giudizio (work spread e MemAvailable letti a mano dai meta).

## Cosa non dice

- B **non** misura il vantaggio del kernel Q4_0 repacked (streaming lo spegne).  
- B **non** autorizza scaricare 35B Q4_0 «per il kernel».  
- D2 **non** spiega perché decode varia con ubatch (anomalia aperta).  
- Non produce numeri da mediane gate (tutto IN-CARICA).  
- work come metrica invariante: fragile quando I/O domina o freq deriva (B e C-3500).  
- Pre-packing esperti nel GGUF: **ipotesi di leva**, non implementata né misurata qui.

## Artefatti

- `results/f5.4/` — cells C, BD2.master.log, bd2_cells.csv, STATUS  
- `results/f5.4/b/` — 6 run Q4_0/Q4_K_M ×3 (meta, stdout, stderr, sampler, metrics), stability.txt  
- `results/f5.4/d2/` — ubatch 256/512/1024/2048 (meta, stdout, stderr, sampler, metrics)  
- `results/f5.4/d1/` — D1 IDENTICAL  
- `scripts/run_f5_4_bd2_only.sh`, `start_f5_4*.sh`

## Verdetto gate

| fase | verdetto |
|---|---|
| C cache curve | M5 sovrastima; **non** promuovere cache 3000–3500 |
| D1 ubatch output | **IDENTICAL — ubatch trasparente** |
| **B Q4_0 vs Q4_K_M** | **MORTO** — repack irraggiungibile da streaming; non scaricare 35B Q4_0 per il kernel |
| **D2 ubatch sweep** | **adottare 512**; prefill plateau oltre; decode varia = **anomalia** |

**Leva aperta:** pre-pack esperti repacked nel GGUF (unica via al kernel veloce sotto stream).
