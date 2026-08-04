# Schema `runs.csv` — telemetria campagna MoE (PLAN.md §8.3)

File canonico sul telefono: `~/experiments/results/runs.csv`  
Copia PC (archivio): `results/runs.csv` (pull a fine sessione, v. PLAN.md §2.2 / F0.2)  
Harness: `scripts/run_bench.sh`

Una riga = un run. Header creato automaticamente se assente.

## Convenzione `run_id`

```
<model-shortname>-<yyyyMMdd-HHmmss>
```

- `model-shortname` = basename del GGUF senza `.gguf` (troncato a 40 char).
- Override: `--run-id ID`.
- Esempio: `Qwen3.6-35B-A3B-UD-IQ2_M-20260803-143015`.

## Protocollo di misura (PLAN.md §8.2)

| Regola | Dettaglio |
|---|---|
| Ripetizioni | **3 run** per configurazione; si riporta la **mediana** |
| Cold | post-riavvio telefono (no `drop_caches` senza root) |
| Warm | run successivo senza riavvio |
| Pressure | protocollo F5 (browser / camera / combinato) |
| Temperatura | scarta run se batteria **> 32.0°C** a inizio (exit 5) |
| Carica | scarta se `plugged != UNPLUGGED` (exit 4) — misure invalide in carica |
| Gate batteria | fail-closed: API assente o `plugged` sconosciuto → exit **7** (salvo `--allow-no-battery`, solo smoke) |
| Determinismo | `--temp 0` hardcodato nell'harness |
| Una variabile | ogni run cambia UN parametro vs il precedente (§2.2) |
| Sweep intermedi | solo warm; cold+warm solo sulle config promosse (§9) |

### Pre-run gate (hard fail, **nessuna riga CSV**)

| Condizione | Exit | Messaggio |
|---|---:|---|
| USB/wireless charging attivo | 4 | misure invalide in carica |
| `temperature > 32.0°C` | 5 | run scartato: temperatura iniziale >32°C |
| binario assente (`command -v`) | 6 | binario non trovato |
| argomento/usage errato | 3 | — |
| `termux-battery-status` assente / `plugged` UNKNOWN | **7** | gate batteria non disponibile/incerto (salvo `--allow-no-battery`) |

### Exit codes harness

| Code | Significato | Riga CSV? |
|---:|---|---|
| 0 | run ok | sì |
| 1 | llama/bmoe fallito | sì (`FAIL rc=…` in notes; timings vuoti se assenti) |
| 3 | usage / path invalidi | no |
| 4 | in carica | no |
| 5 | troppo caldo | no |
| 6 | binary missing | no |
| 7 | gate batteria non disponibile/incerto | no |

`--allow-no-battery`: **solo smoke/dry-run**. Mai per run scientifici. Con questo flag, se l'API batteria manca o `plugged` è sconosciuto, l'harness prosegue (con warning).

## Runtime → binario e flag set

| `--runtime` | binario default | flag KV / display | note |
|---|---|---|---|
| `mainline` | `llama-cli` | `-ctk <kv> -ctv <kv> --no-display-prompt --temp 0` | + `-m -p -n -t -c` |
| `ik` | `llama-cli` | come mainline | |
| `custom` | `llama-cli` | come mainline | |
| `bigmoe` | `bmoe-cli` | **solo** `--temp 0` (+ `-m -p -n -t -c`) | **niente** `-ctk/-ctv`, **niente** `--no-display-prompt` (non supportati; bmoe gestisce KV internamente) |

- `--binary NAME` override sempre il default.
- `--temp 0` è hardcodato per determinismo (§8.2) su entrambi i runtime.
- Colonna CSV `kv_type`: sempre popolata (informativa). Con `bigmoe` **non** viene passata al binario.
- `--print-cmd`: stampa la cmdline esatta (flag runtime-appropriate) ed esce 0, **senza** eseguire e **senza** riga CSV. Utile per test e operator sanity.

## Colonne (ordine fisso)

| # | Colonna | Tipo / unità | Sorgente | Note |
|---:|---|---|---|---|
| 1 | `run_id` | string | harness | v. convenzione sopra |
| 2 | `date` | ISO-8601 | `date -Iseconds` | timestamp di avvio harness |
| 3 | `phase` | string | `--phase` | es. `F2.2`, `F3`, `F4.2` |
| 4 | `model` | string | basename GGUF | solo nome file, non path |
| 5 | `quant` | string | `--quant` o derivato dal filename | es. `UD-IQ2_M`, `Q4_K_M` |
| 6 | `file_gb` | float o vuoto | `--file-gb` | dimensione file in GB |
| 7 | `runtime` | enum | `--runtime` | `mainline` \| `bigmoe` \| `ik` \| `custom` |
| 8 | `runtime_commit` | string | `--runtime-commit` | hash corto del binario/build |
| 9 | `flags` | string | `--flags` | flag extra; virgole → `;` |
| 10 | `threads` | int | `--threads` / `-t` | default 4 |
| 11 | `n_ctx` | int | `--ctx` / `-c` | default 512 |
| 12 | `kv_type` | enum | `--kv-type` | `f16` \| `q8_0`; passato come `-ctk/-ctv` **solo** a llama-cli; con bmoe-cli resta **informativo** (KV gestito internamente) |
| 13 | `n_gen` | int | `--n-gen` / `-n` | default 64 (35B); 128 per piccoli |
| 14 | `run_type` | enum | `--run-type` | `cold` \| `warm` \| `pressure` |
| 15 | `prompt_id` | string | `--prompt-id` | default `short`; anche `medium`, `code` |
| 16 | `prompt_tok_s` | float (2 dec) | log llama.cpp | tokens/s prompt eval; **vuoto se assente** |
| 17 | `eval_tok_s` | float (2 dec) | log llama.cpp | tokens/s decode; **vuoto se assente** |
| 18 | `ttft_ms` | int ms | log llama.cpp | **proxy** = `prompt eval time` ms (non true time-to-first-token strumentato) |
| 19 | `majflt_delta` | int | `/proc/<pid>/stat` | major faults end−start (letture da flash/page-in) |
| 20 | `minflt_delta` | int | `/proc/<pid>/stat` | minor faults end−start |
| 21 | `read_bytes_delta` | int byte | `/proc/<pid>/io` | `read_bytes` end−start |
| 22 | `vmrss_peak_mb` | int MB | `/proc/<pid>/status` VmRSS | picco campionato ogni 0.5 s |
| 23 | `memfree_min_mb` | int MB | `/proc/meminfo` MemFree | minimo durante il run |
| 24 | `batt_temp_start` | float °C | `termux-battery-status` | gate ≤32.0; vuoto se API assente (solo con `--allow-no-battery`) |
| 25 | `batt_temp_end` | float °C | `termux-battery-status` | post-run |
| 26 | `expert_hit_rate` | string | log fork (best-effort) | es. `94.2%`; vuoto se assente |
| 27 | `notes` | string | `--notes` + auto | single-line, no virgole/newline; prefisso utente |

### Parsing `/proc/<pid>/stat` (majflt / minflt)

Il campo 2 (`comm`) è tra parentesi e **può contenere spazi**. L'harness:

1. strippa tutto fino all'**ultima** `)` inclusa;
2. nel resto: `minflt` = campo 8, `majflt` = campo 10  
   (corrispondono ai campi originali 10 e 12 di `proc(5)`).

I valori di **fine** sono l'ultimo sample del loop 0.5 s (dopo `wait` `/proc/<pid>` non esiste più).

### Parsing timings llama.cpp

Blocco tipico `llama_perf_context_print`:

```
prompt eval time =  2345.67 ms /  128 tokens ( 18.32 ms per token,  54.57 tokens per second)
       eval time =  3456.78 ms /   64 runs   ( 54.01 ms per token,  18.51 tokens per second)
```

- Preferisce il "tokens per second" già stampato; altrimenti `tokens / (ms/1000)`.
- Se le righe mancano: campi timing **vuoti** + `no timings in log` in `notes`. **Mai inventare numeri.**

### `ttft_ms` — avvertenza

Non è un true TTFT strumentato (timestamp del primo token). È il tempo di **prompt eval** riportato da llama.cpp, usato come proxy di latenza al primo token. Documentare così nei report.

---

## Esempi di invocazione

### F3 — mainline mmap naive (il muro)

```bash
# cold, post-riavvio, -n 32
# binario default = llama-cli (da --runtime mainline)
./scripts/run_bench.sh \
  --model ~/models/Qwen3.6-35B-A3B-UD-IQ2_M.gguf \
  --prompt-file ~/experiments/prompts/short.txt \
  --prompt-id short \
  --phase F3 \
  --runtime mainline \
  --runtime-commit "$(cd ~/src/llama.cpp && git rev-parse --short HEAD)" \
  --file-gb 11.52 \
  --quant UD-IQ2_M \
  --threads 4 --ctx 512 --kv-type q8_0 --n-gen 32 \
  --run-type cold \
  --notes "F3 naive mmap default"
```

### F4.2 — BigMoeOnEdge riproduzione

```bash
# binario default = bmoe-cli (da --runtime bigmoe)
# flag: -m -p -n -t -c --temp 0  (+ EXTRA); NO -ctk/-ctv, NO --no-display-prompt
./scripts/run_bench.sh \
  --model ~/models/Qwen3.6-35B-A3B-UD-IQ2_M.gguf \
  --prompt-file ~/experiments/prompts/short.txt \
  --prompt-id short \
  --phase F4.2 \
  --runtime bigmoe \
  --runtime-commit "<commit-pinnato-audit-F0.4>" \
  --flags "--moe-stream --cache-mb 2000" \
  --file-gb 11.52 \
  --quant UD-IQ2_M \
  --threads 4 --ctx 512 --kv-type q8_0 --n-gen 64 \
  --run-type warm \
  --notes "F4.2 riproduzione cache-mb 2000"
```

### Override binario / print-cmd / CSV

```bash
# build vecchia dove l'eseguibile si chiama ancora "main"
./scripts/run_bench.sh --binary main -m ~/models/foo.gguf -p ~/experiments/prompts/short.txt

# operator sanity: stampa cmdline senza eseguire
./scripts/run_bench.sh -m m.gguf -p p.txt --runtime bigmoe --print-cmd --allow-no-battery
./scripts/run_bench.sh -m m.gguf -p p.txt --runtime mainline --print-cmd --allow-no-battery

# CSV custom (o export RUNS_CSV=...)
./scripts/run_bench.sh --csv ~/experiments/results/runs-f4.csv \
  -m ~/models/foo.gguf -p ~/experiments/prompts/short.txt --phase F4.3
```

---

## Dipendenze Termux

```bash
pkg install termux-api   # termux-battery-status (gate termico/carica, FAIL-CLOSED)
pkg install jq           # opzionale, parsing JSON batteria più robusto
# binario: llama-cli (runtime mainline/ik/custom) oppure bmoe-cli (runtime bigmoe)
# override: --binary NAME
```

Riferimenti: PLAN.md §8.1 (metriche), §8.2 (regole), §8.3 (schema), §2.2 (una var / 3-run mediana).
