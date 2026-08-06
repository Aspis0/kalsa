# F3 — Il muro (mmap naive 35B) — 2026-08-06

## Cosa è stato fatto (vs piano)

### Harness F3 — COMPLETATO (commit acf15ad + 2877ef5)
- `run_f3.sh` / `start_f3.sh` / `cold_model.sh` (fadv DONTNEED + mincore)
- `run_bench.sh` classic-perf + `--perf` (sync telefono md5 `c52c941a2d987dcc2a83f6b197902adc`, prima era desync `055038b5…`)
- Preflight ISA full (`--build-dir build-safe`): PASS pin **67d5978**, GGML_NATIVE=OFF, armv8.2-a+dotprod+i8mm+fp16, no SVE/SME
- Flag pin: `--numa TYPE`, `--warmup/--no-warmup`, `--perf` presenti
- Model gate: `Qwen3.6-35B-A3B-UD-IQ2_M.gguf` size **11522702304** MATCH
- Protocollo: cooldown ≥180 s, cool ≤30.0°C, abs start ≤32°C, floor batteria 40% → CHARGE_NEEDED exit 92, timeout 2700 s, cold=fadv PAIR same boot

### Variante default (phase `F3`, riga B) — COMPLETATA (runner detached, agente precedente)
4 righe CSV: rep1 cold=fadv + rep2 warm + rep3 warm + sentinel warm. Nessun re-run.

### Variante `--numa distribute` (phase `F3-numa`, riga B2) — COMPLETATA questa sessione
Lancio: `start_f3.sh --variant numa --first-run-type cold --reps 3` (PID 19077, 23:05→00:02). 4 righe.

### Variante `--no-warmup` (phase `F3-nowarmup`) — COMPLETATA questa sessione
Lancio: `start_f3.sh --variant nowarmup --first-run-type cold --reps 1 --no-sentinel` (PID 22943, 00:08→00:22). 1 riga cold. Flag supportato; batteria ≥40%.

### Pull artefatti
- `results/runs.csv` (129 righe totali; 9 F3*)
- `results/f3/f3_*_console.txt`, `f3_state/*`, sample `logs/`
- Reconcile: **0** `run_id` duplicati; conteggi F3=4, F3-numa=4, F3-nowarmup=1

## Numeri chiave (tabella, riferimenti a run_id)

| Voce | default F3 | F3-numa | F3-nowarmup |
|---|---|---|---|
| Rows | 4 (1c+2w+1s) | 4 (1c+2w+1s) | 1 (1c) |
| Median eval tok/s cold | **0.10** | **0.10** | **0.10** |
| Median eval tok/s warm | **0.10** | **0.10** | n/a |
| prompt_tok_s (range) | 1.70–1.90 | 1.90 | 1.80 |
| majflt_delta (regime) | **11.43–11.60 M** | **11.36–11.48 M** | **11.13 M** |
| read_bytes_delta | ~325 GB/rep (sentinel 0) | ~324–326 GB/rep | ~316 GB |
| load_s (notes) | 500–511 | 502–518 | 490 |
| ttft_ms | **vuoto** (tutte) | **vuoto** | **vuoto** |
| memavail_start_mb | 4168–5147 | 4996–5128 | 5076 |
| vmrss_peak_mb | 4377–4757 | 4651–4793 | 4691 |
| lmkd / OOM | **0** (exit 0 tutte) | **0** | **0** |
| Sentinel drift eval | **0%** (≤15%) | **0%** | n/a (no sentinel) |

### run_id per variante

**F3 default**
- cold: `Qwen3.6-35B-A3B-UD-IQ2_M-20260805-220026` eval=0.10 majflt=11433905 load_s=500 memavail=4168
- warm: `…-221304` 0.10 / 11430825 / 504 / 4955
- warm: `…-222720` 0.10 / 11544082 / 506 / 5147
- sentinel: `…-224313` 0.10 / 11598176 / 511 / 5126 (read_bytes=0)

**F3-numa** (`--numa distribute`)
- cold: `…-230821` 0.10 / 11364923 / 502 / 4996
- warm: `…-232306` 0.10 / 11411465 / 507 / 5128
- warm: `…-233725` 0.10 / 11475321 / 518 / 5102
- sentinel: `…-235400` 0.10 / 11458889 / 507 / 5111

**F3-nowarmup** (`--no-warmup`)
- cold: `…-20260806-001358` 0.10 / 11130037 / 490 / 5076

### Tabella §9 (celle F3)

| ID | Configurazione | tok/s cold | tok/s warm | hit-rate | majflt/tok* | MiB flash/tok† | RAM peak | Note |
|---|---|---:|---:|---:|---:|---:|---:|---|
| B | 35B UD-IQ2_M mmap naive | 0.10 | 0.10 | n/a | ~3.6e5 | **~9.7e3** (9.5 GiB) | ~4.4–4.8 GB | cold=fadv; wall~load_s 500–511; regime majflt alto; no OOM |
| B2 | B + `--numa distribute` | 0.10 | 0.10 | n/a | ~3.6e5 | **~9.7e3** (9.4 GiB) | ~4.7–4.8 GB | indistinguibile da B **alla risoluzione dello strumento** (v. Correzioni) |
| B2alt | B + `--no-warmup` | 0.10 | — | n/a | ~3.5e5 | **~9.4e3** (9.2 GiB) | ~4.7 GB | 1 sola rep cold, nessun warm: esplorativo, NON riga promossa |

\* majflt/tok ≈ majflt_delta / n_gen (n_gen=32); ordine di grandezza — fault principalmente da mmap load + expert re-fault.  
† MB flash/tok ≈ read_bytes_delta / (1024²) / n_gen; include fault del file modello intero.

## Deviazioni / sorprese / bug
1. **`ttft_ms` colonna vuota su tutte le 9 righe F3\*** nonostante `classic_perf=1` e `--perf` in cmdline. Il pin 67d5978 sotto `--no-conversation --single-turn` emette solo la riga compatta `[ Prompt: X t/s | Generation: Y t/s ]`, **non** il blocco `llama_perf_context_print` (`prompt eval time = …`). `load_s` è wall-clock harness (affidabile). Parser TTFT non regredito: input assente nel log.
2. **Warm ≈ cold a 0.10 tok/s**: page cache non salva il throughput eval; majflt resta ~11.4 M anche in warm → thrashing/re-fault esperti MoE su UFS, non solo cold-start.
3. **`--numa distribute` e `--no-warmup`**: nessun guadagno misurabile vs default (stesso 0.10).
4. **Sentinel default `read_bytes_delta=0`**: anomalia contatore (altre metriche coerenti); non usato come fallimento.
5. **Temp post-run 33–36°C**: cooldown automatico runner ha atteso ≤30.0 prima di ogni rep (fino a ~4 min extra). Nessun abort termico.
6. **Batteria**: start numa 72% → fine nowarmup **54%** UNPLUGGED. Floor 40% non toccato. **Serve ≥80% prima di F4** (§8.2).

## Correzioni post-audit (Claude, 2026-08-06 — audit ostile su commit 2877ef5..c28a2e0)

Il testo sopra è di Grok; la tabella §9 è stata corretta in place e queste sono le
correzioni, con il motivo. I dati grezzi in `runs.csv` **non** sono stati toccati: erano
giusti loro, era sbagliata una colonna derivata.

1. **[BLOCKER, corretto] "MB flash/tok" era 1024× troppo alto.** I valori `~1.0e7` /
   `~9.9e6` erano KiB/token calcolati con `/1024`, non MiB/token come dichiarava la nota †
   (`/1024²`). Valori veri: **~9.7e3 MiB/token ≈ 9.5 GiB/token** (B), 9.4 GiB (B2),
   9.2 GiB (B2alt). Perché è grave e non cosmetico: F4 misurerà la riduzione di traffico
   di BigMoeOnEdge **contro questa baseline**, e un fondoscala gonfiato di 1024× farebbe
   sembrare qualunque risultato di F4 mille volte migliore del reale. Ogni colonna derivata
   di §9 va ricontrollata a mano prima di essere usata per un confronto.
2. **[Metodologico] "0.10 tok/s" ha una risoluzione di ±0.05, non ±0.005.** Il numero non
   viene da `llama_perf_context_print` ma dalla riga compatta `[ … | Generation: 0.1 t/s ]`,
   che ha **una sola cifra significativa**; il `printf "%.2f"` dell'harness aggiunge uno
   zero, non precisione. Conseguenze: (a) "sentinel drift 0%" è garantito dall'arrotondamento,
   non è prova di stabilità; (b) **non si può affermare che `--numa` e `--no-warmup` non
   diano guadagno**: a questa risoluzione una differenza reale anche del ±40% sarebbe
   invisibile. Quello che i dati sostengono è più debole e va detto così: *nessuna variante
   sposta il muro di un fattore misurabile con questo strumento*. A 8.90 tok/s (F2) lo stesso
   formato dà ±0.5% ed è ininfluente — il problema esiste solo ai valori piccolissimi, cioè
   esattamente qui. Da F4 in poi serve il blocco perf vero (v. punto 3 di "Prossima azione").
3. **[Copertura] `--no-warmup` non è una riga promossa.** In PLAN.md §9 non esiste nessuna
   riga "B2alt" e §8.2 elenca come promosse solo B, B2, C2, C3, D, E; `--no-warmup` era una
   domanda esplorativa laterale (§F3). Con 1 sola rep cold e zero warm, "COMPLETATA" e
   "stesso muro" dicono più di quanto sia stato misurato: il warm≈cold è dimostrato per B e
   B2, per B2alt è inferito per analogia. Tenuta in tabella ma marcata esplorativa.
4. **[Telemetria] `read_bytes_delta=0` significa "non misurato", non "zero".**
   `read_read_bytes()` restituisce `"0"` sia quando il contatore dice davvero 0 sia quando
   `/proc/<pid>/io` non è leggibile — e l'ultimo campionamento cade nella finestra zombie
   subito dopo l'uscita del processo, dove `io` può sparire prima di `stat` (infatti majflt
   e minflt di quella riga sono normali). Vale per la sentinella di B e per alcune righe F2.
   Da sistemare come già fa `fadv.c`: sentinella `-1` per "non misurabile".

**Cosa invece regge, verificato riga per riga:** `cold=fadv` fa davvero il suo lavoro
(`resident_after=0`, `fadvise_rc=0` in tutti e 3 i cold, e un fallimento aborta il run senza
scrivere CSV); il timeout 2700 s è imposto dal codice, non solo documentato, e
`harness_timeout=0` su tutte le righe — **nessun run è stato ucciso da noi**; il CSV è
integro (27 colonne ovunque, zero run_id duplicati, conteggi coerenti col telefono);
`ttft_ms` vuoto è una vera assenza di input, non una regressione del parser (`--perf` era
in cmdline); `majflt/tok ≈3.6e5` è calcolato bene; e i ~325 GB letti per 32 token sono
architetturalmente coerenti (~28 KB per fault = readahead del kernel su mmap random).

**Non verificabile da questo repo:** che `--numa distribute` attivi un path `MADV_RANDOM`
sul mmap del modello. In mainline quel flag governa l'affinità NUMA di thread e buffer, e
l'S23 è a nodo singolo — quindi "identico a B" potrebbe voler dire semplicemente che il
flag non fa nulla su questo hardware, non che MADV_RANDOM non aiuti. Da chiarire leggendo
il sorgente del pin prima di trarne conclusioni di design.

## Verdetto gate: **PASS**

F3 è pura misura. Numeri naive registrati su tutte le varianti richieste (default già presente + numa + nowarmup). Nessun OOM/lmkd; se ci fossero stati sarebbero comunque PASS annotati. Gate F3 **chiuso**.

Non avviato F4. Non toccati goal files. Nessun caricatore, nessun reboot, nessun pkill broad.

## Prossima azione proposta
1. **Operatore**: ricaricare S23 a **≥80%**, poi UNPLUG e raffreddare ≤30°C prima di F4.
2. Gate F4 = checkpoint Claude (non aprire da questo agente).
3. Follow-up opzionale non bloccante: capire perché `--perf` non stampa `llama_perf_context_print` su questo pin/path (stderr vs stdout, o flag aggiuntivo) se si vuole `ttft_ms` reale in F4+.
4. Archivio: `results/f3/` + `reports/moe-f3.md` + `results/runs.csv` commit.
