# F0.1 — Ri-verifica online — 2026-08-03

## Cosa è stato fatto (vs piano)

Eseguita la checklist di ri-verifica online di §7-F0.1 senza scaricare GGUF e senza toccare codice runtime:

1. GitHub API: PR llama.cpp #26003, #24156, #22673 + release latest.
2. GitHub API + raw README: `Helldez/BigMoeOnEdge` (meta, issues aperte, flag e bench).
3. Hugging Face tree API (`/api/models/<repo>/tree/main?recursive=1`): size byte-esatti di tutti i `.gguf` rilevanti.
4. llama.cpp master `common/arg.cpp` + `include/llama.h`: nomi flag correnti (`--spec-*`, `--load-mode`, `-ctk/-ctv`, `--no-warmup`).
5. llama.rn: GitHub releases/latest + npm `registry.npmjs.org/llama.rn/latest`.

Nota ambiente: su questo host `python3` punta allo stub Microsoft Store; parsing fatto con `py -3` (Python 3.14/3.12). Tutte le API hanno risposto al primo tentativo (nessun item BLOCKED per rete).

## Numeri chiave / tabella di verifica

| # | Fatto (piano) | Stato attuale (URL) | Esito |
|---|---|---|---|
| 1a | PR #26003 `--lazy-experts` OPEN, created 2026-07-22 | **OPEN**, `merged=false`, `draft=false`; created `2026-07-22T14:29:33Z`; updated `2026-07-24T11:09:47Z`; head `546369630ff32a3589bffdff803d2e4a69502353` (`lazy-experts-mmap`); title *llama : add --lazy-experts for MoE models larger than RAM*. https://api.github.com/repos/ggml-org/llama.cpp/pulls/26003 | **[V] confermato** |
| 1b | PR #24156 `--reclaim-mmap-source` open? | **OPEN**, `merged=false`; created `2026-06-05`; updated `2026-07-10`; head `aba63239f0cc796507a4022b85c96c53c3054952`. https://api.github.com/repos/ggml-org/llama.cpp/pulls/24156 | **[V] confermato** |
| 1c | PR #22673 MTP/NextN merged May 2026 | **MERGED** `2026-05-16T12:06:24Z` (closed same); title *llama + spec: MTP Support*. https://api.github.com/repos/ggml-org/llama.cpp/pulls/22673 | **[V] confermato** |
| 2a | BigMoeOnEdge ~196★, creato 2026-07-10, attivo, Apache-2.0 | `Helldez/BigMoeOnEdge`: **197** stars, license **Apache-2.0**, created `2026-07-10T16:19:44Z`, pushed `2026-08-02T04:44:42Z`, last commit **`b0c4e5bfffd5b10ec636ad7edd7d5a0564c790a1`** (2026-08-02, docs README #154), description *Run MoE models bigger than your RAM…*, open_issues=18, not archived. https://api.github.com/repos/Helldez/BigMoeOnEdge | **CAMBIATO** (stelle 196→197, cosmetico) |
| 2b | Flag fork: `--moe-stream`, `--cache-mb`, `--dense-weights`, `--drop-cold-experts`, + k | README raw conferma tutti e quattro; **k = `--n-expert-used`** (0=model default, 6/4/3/2). Altri correlati: `--cache-ceil-mb`, `--io-threads`, `--overlap`, `--prefetch`, `--predict-prefetch`. Bench Qwen3.6-35B-A3B Q4_K_M 22.3GB su 12GB/UFS4.x: lossless best **5.0 tok/s** (k=8, cache 3000, lanes 4); lossy best **5.8** (k=6, cache 3000). https://raw.githubusercontent.com/Helldez/BigMoeOnEdge/main/README.md | **[V] confermato** (+ chiarimento k) |
| 2c | Issue aperte (titoli) | 18 open (mix issue/PR), tra cui: #159 Markov temporal prediction (PR); #158 ML predictor; #157 LoRA compress experts; #156 lazy-load attn/routers; #155 Qwen3-30B cloud VM; #153 delete dialog session sig; #149 odirect-zero-copy Windows; #147 praise; #146 smoother memory; #143 zero-copy IO (PR); #141 metrics preamble; #140 settings vs model; #138 full context dead-end; #133 cpu-mask (PR); #103 dynamic expert cache (PR); #98 telemetry residual; #69 Android 14 FGS download resume; #63 loading waste time (`--no-warmup`). https://api.github.com/repos/Helldez/BigMoeOnEdge/issues?state=open | **[V] elenco aggiornato** |
| 3a | `unsloth/Qwen3.6-35B-A3B-GGUF` size list §3/§4 | File target (byte esatti): | **[V] size match** (GB decimali = piano) |
| | UD-IQ1_M | `Qwen3.6-35B-A3B-UD-IQ1_M.gguf` = **10 047 749 088** (10.05GB) | |
| | UD-IQ2_XXS | `…-UD-IQ2_XXS.gguf` = **10 756 586 464** (10.76GB) | |
| | **UD-IQ2_M** | `…-UD-IQ2_M.gguf` = **11 522 702 304** (11.52GB) | |
| | **UD-Q2_K_XL** | `…-UD-Q2_K_XL.gguf` = **12 290 628 576** (12.29GB) | |
| | UD-IQ3_XXS | `…-UD-IQ3_XXS.gguf` = **13 211 155 424** (13.21GB) | |
| | UD-Q3_K_S | `…-UD-Q3_K_S.gguf` = **15 359 196 128** (15.36GB) | |
| | UD-Q3_K_M | `…-UD-Q3_K_M.gguf` = **16 600 710 112** (16.60GB) | |
| | UD-Q4_K_M | `…-UD-Q4_K_M.gguf` = **22 134 528 992** (22.13GB) | |
| | Source | https://huggingface.co/api/models/unsloth/Qwen3.6-35B-A3B-GGUF/tree/main | |
| 3b | `unsloth/Qwen3.5-4B-GGUF` Q4_K_M 2.74GB (+ MTP se presente) | `Qwen3.5-4B-Q4_K_M.gguf` = **2 740 937 888**. **Nessun** file MTP in questo repo. MTP separato: `unsloth/Qwen3.5-4B-MTP-GGUF` → `Qwen3.5-4B-Q4_K_M.gguf` = **2 834 975 040** (2.83GB) — coerente con §3.1. https://huggingface.co/api/models/unsloth/Qwen3.5-4B-GGUF/tree/main · https://huggingface.co/api/models/unsloth/Qwen3.5-4B-MTP-GGUF/tree/main | **[V] confermato** (MTP in repo dedicato, non nel base) |
| 3c | `LiquidAI/LFM2-8B-A1B-GGUF` Q4_K_M 5.04GB | `LFM2-8B-A1B-Q4_K_M.gguf` = **5 044 779 712** (5.04GB). https://huggingface.co/api/models/LiquidAI/LFM2-8B-A1B-GGUF/tree/main | **[V] confermato** |
| 3d | MTP 35B quant minima ~2–3GB [S] (§4 voce 5) | **Nessun draft piccolo.** `unsloth/Qwen3.6-35B-A3B-MTP-GGUF` min model quant = `Qwen3.6-35B-A3B-UD-IQ1_M.gguf` **11 366 414 624** (~11.37GB). `ggml-org/…-MTP-GGUF` min model = `Qwen3.6-35B-A3B-MTP-Q8_0.gguf` **37 801 096 544** (~37.80GB). | **CAMBIATO** (stima → 11.37GB min utile) |
| 3e | Gemma-4-26B-A4B UD-IQ2_XXS 9.92 / UD-IQ3_XXS 11.42 | `gemma-4-26B-A4B-it-UD-IQ2_XXS.gguf` = **9 922 480 608**; `…-UD-IQ3_XXS.gguf` = **11 416 548 832**. MTP draft piccolo presente (`mtp-gemma-…-Q8_0.gguf` 461 766 816). https://huggingface.co/api/models/unsloth/gemma-4-26B-A4B-it-GGUF/tree/main | **[V] confermato** |
| 4a | llama.cpp latest release | tag **`b10244`**, published `2026-08-03T22:13:49Z`, name `b10244`. https://api.github.com/repos/ggml-org/llama.cpp/releases/latest | **info nuova** (piano non pinnava un tag) |
| 4b | Flag `--spec-draft-*`, `--spec-type`, `-ctk/-ctv` | Presenti in master `common/arg.cpp`: `--spec-type`; `--spec-draft-n-max/min`; `--spec-draft-type-k/v` (alias `-ctkd/-ctvd`); `--spec-draft-cpu-moe` (alias `-cmoed`); `--spec-draft-model` (`-md`); famiglia completa listata nel report grezzo. `-ctk/--cache-type-k`, `-ctv/--cache-type-v` presenti. Vecchi `--draft/--draft-max` **rimossi** (messaggio: usare `--spec-draft-n-max`). Source: https://raw.githubusercontent.com/ggml-org/llama.cpp/master/common/arg.cpp | **[V] confermato** (nessun rename rispetto a §3.2) |
| 4c | `--load-mode` map/on-demand? | Modi: **`none`, `mmap`, `mlock`, `mmap+mlock`, `dio`** (default `mmap`). **Non esiste** `on-demand` / `map`. Alias deprecati `--mmap/--mlock/--direct-io` reindirizzano. | **chiarito** (non era un claim forte del piano) |
| 4d | `--no-warmup` se disponibile | **Sì**, coppia `--warmup` / `--no-warmup` in `arg.cpp` (default warmup enabled). | **[V] confermato** |
| 5 | llama.rn 0.12.8 | GitHub latest **`v0.12.8`** (2026-07-28); npm latest **`0.12.8`**. https://api.github.com/repos/mybigday/llama.rn/releases/latest · https://registry.npmjs.org/llama.rn/latest | **[V] confermato** |

### Download list §4 — size canoniche (byte)

| Voce | File | Byte | GB (10³) | Note |
|---|---|---:|---:|---|
| 1 | `unsloth/Qwen3.5-4B-GGUF` / `Qwen3.5-4B-Q4_K_M.gguf` | 2 740 937 888 | 2.74 | ok |
| 2 | `LiquidAI/LFM2-8B-A1B-GGUF` / `LFM2-8B-A1B-Q4_K_M.gguf` | 5 044 779 712 | 5.04 | ok |
| 3 | `unsloth/Qwen3.6-35B-A3B-GGUF` / `Qwen3.6-35B-A3B-UD-IQ2_M.gguf` | 11 522 702 304 | 11.52 | target primario |
| 4 | stesso repo / `…-UD-Q2_K_XL.gguf` | 12 290 628 576 | 12.29 | F4.4 only |
| 5 | MTP 35B min utile: `unsloth/…-MTP-GGUF` / `…-UD-IQ1_M.gguf` | **11 366 414 624** | **11.37** | **non ~2–3GB**; alternativa ggml-org Q8_0 = 37 801 096 544 |
| 6 | `…-UD-IQ3_XXS.gguf` | 13 211 155 424 | 13.21 | se gate F4 |
| 7 | `unsloth/gemma-4-26B-A4B-it-GGUF` / `…-UD-IQ2_XXS.gguf` | 9 922 480 608 | 9.92 | opzionale |

## Deviazioni / sorprese / bug

1. **Sorpresa materiale — MTP 35B non è un add-on da 2–3GB.** I repo MTP unsloth/ggml-org pubblicano **modelli full con head MTP**, non un draft leggero tipo Gemma (`mtp-*.gguf` ~0.46GB). Impatto: spazio telefono, sequenza download F1, e F6 (probabile: caricare variante MTP al posto del base, non “base + draft”).
2. **Qwen3.5-4B MTP** vive in repo separato `unsloth/Qwen3.5-4B-MTP-GGUF` (2.83GB Q4_K_M) — allineato al piano, ma non è dentro `Qwen3.5-4B-GGUF`.
3. **BigMoeOnEdge README** dichiara di essere costruito *on top of llama.cpp public API, not as a fork* (con un solo hook ~25 righe su branch `bmoe/expert-ready-hook`). Il piano lo chiama “fork”: semanticamente quasi-fork; da tenere a mente in F0.4 (audit diff vs submodule bump).
4. **Bench 5.0 vs 5.8:** il piano cita 5.0 (lossless k=8); README documenta anche 5.8 lossy (`--n-expert-used 6`). Non contraddice il piano.
5. **Nessuna PR lazy mergiata** → strategia F4 (fork first, mainline lazy come piano B) **invariata**.
6. Release mainline del giorno: **b10244** — da pinare nelle build F0.3/F3 per riproducibilità.

## Verdetto gate: PASS

F0.1 non ha hard gate di prodotto; tutti i check della checklist sono stati completati con fonti live. Un fatto [S] della download list (MTP 35B ~2–3GB) risulta **sbagliato in eccesso di ottimismo** e va propagato a §4/F1/F6, ma non blocca la chiusura di F0.1.

## Prossima azione proposta

1. Aggiornare formalmente §4 voce 5 e il calcolo “core ≈ 22.6GB” → ~30.7GB se si tengono base+MTP, oppure documentare strategia “swap to MTP quant for F6”.
2. Procedere F0.2 (layout telefono/CSV) e **F0.4 audit ostile BigMoeOnEdge** (priorità piano), in parallelo a F0.3 build harness se l’audit non alza red flag.
3. Continuare a monitorare PR #26003 / #24156 (ancora OPEN; ultima attività #26003 = 2026-07-24).

DONE
