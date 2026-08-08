# F5.5-A — metro di perplessità teacher-forced su bmoe-cli — 2026-08-07

**Stato:** COMPLETE (PPL baseline congelata; non-regressione 8/8).  
**Device:** Samsung S23 (SM-S911U), PLUGGED_AC.  
**Modello:** `Qwen3.6-35B-A3B-UD-IQ2_M.gguf` (11522702304 B).  
**Runtime base:** b0c4e5b + patch `--ppl-file` (fork commit sotto).  
**Marca:** **F5.5-A IN-CARICA** — nessun verdetto di velocità.

## 1. Contesto

`quality/ppl_baseline.json` era BLOCKED: bmoe-cli non esponeva logprob, `llama-perplexity` non è nel build e mmapperebbe 11.5 GB (crollo F3). Serviva un metro PPL sul percorso streaming MoE senza toccare il decode di campagna.

## 2. Sopralluogo codice (dove sono i logit)

| pezzo | ruolo |
|---|---|
| `cli/main.cpp` | flag parsing; path one-shot `run()` → `Session::generate` |
| `core/src/engine/session.cpp` `generate()` | prefill a chunk (`n_batch`/`n_ubatch`), poi loop decode; dopo prefill `llama_get_logits_ith(ctx,-1)`; sampling greedy = `argmax` |
| `batch_fill(..., all_logits)` | già usato dal path speculativo: richiede logits su ogni posizione del batch |
| llama.cpp | `llama_get_logits_ith(ctx, i)` dopo `llama_decode` restituisce i logit **finali** della posizione `i` del batch (non intermedi di un ubatch parziale) |

**Estrazione log P(gold):** softmax numericamente stabile su `logits[v]` → `log P(tok) = logit[tok] - max - log(sum exp(logit-max))` (stessa forma di `tools/perplexity/perplexity.cpp`).

## 3. Modifica (minima, isolata)

**Flag nuovi (solo CLI):**
- `--ppl-file PATH` — teacher-forced PPL sul testo grezzo del file
- `--ppl-csv PATH` — CSV opzionale `pos,token_id,logprob`

**API nuova (non tocca `generate`):**
- `Session::perplexity(text, csv_path)` → `PplResult {n_tokens, n_scored, sum_logprob, ppl, seconds}`

**Algoritmo:**
1. Tokenizza raw text (`add_special=true`, no chat template).
2. Finestre non-overlapping di size `n_ctx` (4096). Tra finestre: `llama_memory_clear`.
3. Dentro ogni finestra: batch espliciti con `logits[i]=1` per ogni posizione; dopo ogni `llama_decode` score `log P(token_{j+1})` per ogni j con gold ancora nella finestra.
4. Sotto MoE streaming, **cap batch a 16** (solo in `perplexity()`): un ubatch 512 all-logits allarga il set esperti a ~512×k per layer e crolla a ~1.3 tok/s (misurato, poi abortito). Con batch 16 i logit restano finali per posizione; smoke ha dato **stesso** `sum_logprob` di ubatch 512.
5. Output: una riga `BMOE_PPL {n_tokens,n_scored,sum_logprob,ppl,seconds,...}` su stdout; progress su stderr.

**File toccati (solo fork BigMoeOnEdge):**
- `cli/main.cpp` (+ help, branch pre-`run()`)
- `core/include/bmoe/session.h` (`PplResult`, `perplexity`)
- `core/src/engine/session.cpp` (implementazione)

**Non toccati:** `generate()`, sampling, MoE streamer, router, decode loop. Path senza `--ppl-file` è byte-identico per costruzione + verifica.

## 4. Verifica non-regressione (cuore del mandato)

**Protocollo:** binario NUOVO **senza** `--ppl-file`, stessi 8 prompt di F5.5-B, config:

```
-t 4 -c 4096 -n <200|256> --chatml --no-think --progress --temp 0
--moe-stream --cache-mb 2000 --dense-weights anon --overlap --io-threads 4
--ubatch 512 --n-expert-used 8
-p "$(cat <prompt>)"
```

Riferimento: `results/f5.5/b/*-k8.gen.txt` (catturati da F5.5-B sul binario pre-patch).  
Criterio: **byte-identici** (D1: a temp 0 su questo stack qualunque differenza è un difetto).

**Esito (binario finale con cap batch-16, sha256 `5c95cb5f…`):**

| prompt | verdict | sha256 gen |
|---|---|---|
| short-k8 | IDENTICAL | 9a3f4175… |
| f45_1_esplicativo-k8 | IDENTICAL | 2424179f… |
| f45_2_scrittura-k8 | IDENTICAL | 71216127… |
| f45_3_istruzioni-k8 | IDENTICAL | baadf7b3… |
| f45_4_codice-k8 | IDENTICAL | d9c57c56… |
| f45_5_ragionamento-k8 | IDENTICAL | 9397d763… |
| long_conversational_it-k8 | IDENTICAL | 64f6f2bd… |
| d1_long-k8 | IDENTICAL | 50b17f32… |

**SUMMARY: ok=8 fail=0.**  
Artefatto: `results/f5.5/a/regression_checksums.txt`.  
Binario pristine salvato: `bmoe-cli.pristine` sha256 `ab800506…`.

Anche la prima build (pre-cap batch) aveva già passato 8/8 — il cap non ha toccato il path di decode.

## 5. Corpus

Script: `scripts/quality/prepare_it_ppl_corpus.py --download`.  
Fonti Gutenberg scaricate:
- Divina Commedia (1012) — ok
- Promessi Sposi (45334) — ok
- seed conversazionale locale

Output: `quality/corpus_it/mixed_it.txt`  
- sha256 `4175f3acd383c4125820df704967c3e7959817f46634c27f4a4a7d00cd147fc5`
- 217375 bytes / ~200911 chars  
- **n_tokens (tokenizer modello) = 68193** (somma parti run PPL; n_scored=68175; non wc)

Target ~50k rispettato (anzi 68k, accettabile). Truncation script: `max_chars_prose=200000`.

## 6. Run PPL baseline

**Esito: COMPLETE** — 2026-08-08T02:37:29-0400, `STATUS_PPL.txt` = `DONE rc=0`.

### 6.1 Config

```
-t 4 -c 4096 --moe-stream --cache-mb 0 --dense-weights anon
--overlap --io-threads 4 --ubatch 512 --n-expert-used 8
--ppl-file <half> --ppl-csv <half.csv>
```

- batch effettivo in `perplexity()` = 16 (cap MoE)
- n_ctx = 4096, finestre non-overlapping + `llama_memory_clear`
- LD_LIBRARY_PATH = dir del binario; die stop 95°C
- Smoke pre-run (14 tok): ppl=44.2583 sum_logprob=-49.2706 (identico batch 16 vs 512)

### 6.2 Workaround SIGKILL → split 2 metà

`bmoe-cli` riceve SIGKILL (rc=137) a ~45k token / ~2h con **cache-mb 2000 e 0**. Script `scripts/f55a_ppl_split.sh` (sul telefono: `~/experiments/results/f5.5/a/f55a_ppl_split.sh`):

1. split paragrafo-aligned a metà file → `mixed_it.part{1,2}.txt`
2. PPL sequenziale sulle due metà
3. combina `ppl = exp(-(s1+s2)/(n1+n2))`

Lo split non cambia la semantica delle finestre non-overlapping: sposta solo l'allineamento al taglio.

### 6.3 Risultati per metà

| part | n_tokens | n_scored | sum_logprob | ppl | seconds |
|---|---:|---:|---:|---:|---:|
| 1 | 34012 | 34003 | −31909.95090120 | 2.556004 | 6097.2 |
| 2 | 34181 | 34172 | −37772.75592154 | 3.020346 | 6117.2 |
| **tot** | **68193** | **68175** | **−69682.70682274** | **2.779067** | **12214.4** |

- mean_logprob = −1.0221152449
- 18 token non scorati = prima posizione di ciascuna finestra n_ctx (9+9)
- copertura scored/tokens = 99.97%
- ~5.6 tok/s in carica (non metrica di campagna)

### 6.4 Audit indipendente (PC, CSV part1+part2)

```
n_scored = 68175
sum_logprob = −69682.70682380
ppl = 2.77906695853247
Δppl vs JSON telefono ≈ 4.3e-11
```

### 6.5 Artefatto congelato

`quality/ppl_baseline.json` status **COMPLETE** (sovrascrive BLOCKED).

## 7. Comando per rifare

```bash
export PREFIX=/data/data/com.termux/files/usr; export PATH=$PREFIX/bin:$PATH
BIN=~/src/BigMoeOnEdge/build-bmoe/cli/bmoe-cli
export LD_LIBRARY_PATH=$(dirname $BIN)
OUT=~/experiments/results/f5.5/a
# prefer: bash $OUT/f55a_ppl_split.sh
# or manual halves:
$BIN -m ~/models/Qwen3.6-35B-A3B-UD-IQ2_M.gguf -t 4 -c 4096   --moe-stream --cache-mb 0 --dense-weights anon --overlap --io-threads 4   --ubatch 512 --n-expert-used 8   --ppl-file $OUT/split/mixed_it.part1.txt --ppl-csv $OUT/split/part1.per_token.csv
$BIN -m ~/models/Qwen3.6-35B-A3B-UD-IQ2_M.gguf -t 4 -c 4096   --moe-stream --cache-mb 0 --dense-weights anon --overlap --io-threads 4   --ubatch 512 --n-expert-used 8   --ppl-file $OUT/split/mixed_it.part2.txt --ppl-csv $OUT/split/part2.per_token.csv
# combine: ppl=exp(-(s1+s2)/(n1+n2))
```

## 8. Caveat

1. SIGKILL (rc=137) a ~45k token/~2h → baseline solo via split 2 metà (script `f55a_ppl_split.sh`).
2. Finestre non-overlapping di n_ctx: condizionamento esatto solo *dentro* la finestra; non è PPL a contesto infinito. Sufficiente per ΔPPL 0.05–0.15 tra config k.
3. Cap batch=16 solo in `perplexity()` sotto streaming: non cambia i logprob (smoke bit-stabile vs 512) ma evita thrash esperti.
4. Telefono in carica: tok/s non usabili come metrica di campagna.
5. IQ2_M quantizzato: PPL assoluta alta rispetto a full-precision; il metro serve a confronti *relativi* (k=8 vs k=4, drop, ecc.).
6. Corpus ~68k token IT letterario + micro seed conversazionale — non è un benchmark standard (WikiText).

## 9. Commit

| repo | hash | messaggio |
|---|---|---|
| BigMoeOnEdge (fork locale) | `7567e9f` | cli: add --ppl-file teacher-forced logprob mode |
| moe-experiments | *(questo commit)* | F5.5-A: PPL baseline COMPLETE + report + corpus |

## 10. Artefatti

- `results/f5.5/a/regression_checksums.txt` — non-regressione 8/8
- `results/f5.5/a/STATUS_REGRESSION.txt` / `STATUS_PPL.txt` — DONE rc=0
- `results/f5.5/a/ppl_baseline.json` + `ppl_baseline.master.log` (mirror telefono)
- `results/f5.5/a/split/part{1,2}.stdout` / `.stderr` (CSV per-token restano sul telefono / locale non committati)
- `quality/corpus_it/` (+ manifest con checksum reali)
- `quality/ppl_baseline.json` — **COMPLETE**, ppl=2.779067, n_scored=68175
- `scripts/f55a_regression.sh`, `scripts/f55a_ppl_baseline.sh`, `scripts/f55a_ppl_split.sh`
