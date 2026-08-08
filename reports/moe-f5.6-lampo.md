# F5.6-lampo — Verifica riuso prefisso KV (n_common) nel multi-turno

**Stato:** COMPLETE  
**Obiettivo:** stabilire se il riuso del prefisso KV scatta con `clear_kv=false`, o se i 165 s di ri-prefill al turno 5 di F5.1 sono un difetto (n_common = 0).  
**Data:** 2026-08-08  
**Binario telefono:** `~/src/BigMoeOnEdge/build-bmoe/cli/bmoe-cli` v0.19.0 (build 5c95cb5f, `--ppl-file` presente)  
**Modello:** `~/models/Qwen3.6-35B-A3B-UD-IQ2_M.gguf`  
**Artefatti telefono:** `~/experiments/results/mandato_lampo/`

## Contesto

F5.1 (sessione multi-turno, `clear_kv=false` dal turno 2) mostrò:

| turno | n_prompt | n_past | prefill_s |
|------:|---------:|-------:|----------:|
| 1 | 97 | 353 | 9.1 |
| 2 | 436 | 692 | 41.2 |
| 5 | 1441 | 1697 | 165.3 |

Sospetto: `n_common` non scatta e ogni turno ri-prefilla l'intera storia. Il codice (session.cpp) definisce:

```
s.n_prompt = n_prompt - (int) n_common;  // token prefilled THIS turn
```

quindi un confronto X (clear_kv=false al t2) vs Y (clear_kv=true al t2) con lo **stesso** prompt P risolve il dubbio in un conteggio, indipendente da carica/termica.

## Protocollo

Due sessioni `--session` identiche, temp 0, stesso file prompt (byte-identico):

- **Turno 1** in entrambe: `clear_kv=true` (chat nuova).
- **Sessione X, turno 2:** `clear_kv=false` (continua KV).
- **Sessione Y, turno 2:** `clear_kv=true` (nuova chat).
- Stesso prompt P in entrambi i turni di entrambe le sessioni.
- `n_predict=32` (il test è sul prefill, non sul contenuto).

Criterio:

- `X.n_prompt < Y.n_prompt` → riuso scatta, `n_common ≈ Y − X`.
- `X.n_prompt == Y.n_prompt` → riuso non scatta, `n_common = 0`.
- Caso intermedio: riportare i numeri.

## Prompt e checksum

```
Spiega in tre frasi cos e la memoria KV in un transformer. Rispondi in italiano, max 80 parole.
```

- **sha256:** `a8471e81e2320558b64760b8ab354277330afe79c7456970cab1a962180f5cc9`
- **bytes:** 96 (newline finale inclusa)
- Hash del campo `prompt` nelle 4 richieste generate: `8918286077471fa9` (tutte identiche)

## Config esatta (identica X e Y)

```
bmoe-cli -m Qwen3.6-35B-A3B-UD-IQ2_M.gguf \
  -t 4 -c 2048 -n 32 --temp 0 \
  --chatml --no-think \
  --moe-stream --cache-mb 2000 --dense-weights anon \
  --overlap --io-threads 4 --session
```

Preflight: `nproc=7`, PLUGGED_AC, die_max pre-start ≤80 °C (smoke 44 °C, X/Y dopo cooldown), HARD STOP 98 °C non raggiunto.

Scelta `clear_kv` documentata: turno 1 = true in entrambe; sola variabile = flag del turno 2.

## Tabella risultati

| sessione | turno | clear_kv | n_prompt | n_past | prefill_s | prefill_tps | tokens | tok_s | hit% |
|----------|------:|----------|---------:|-------:|----------:|------------:|-------:|------:|-----:|
| smoke | 1 | true | 39 | 71 | 5.102 | 7.64 | 32 | 5.018 | 59.4 |
| X | 1 | true | 39 | 71 | 5.419 | 7.20 | 32 | 4.800 | 59.4 |
| **X** | **2** | **false** | **108** | **140** | **9.105** | **11.86** | 32 | 4.253 | 56.3 |
| Y | 1 | true | 39 | 71 | 5.763 | 6.77 | 32 | 4.446 | 59.4 |
| **Y** | **2** | **true** | **39** | **71** | **4.807** | **8.11** | 32 | 3.144 | 61.6 |

Derivati turno 2 (chat mode: `rendered = n_past − tokens`; `n_common = rendered − n_prompt`):

| | n_prompt | n_past | prefill_s | rendered | n_common |
|--|---------:|-------:|----------:|---------:|---------:|
| **X t2** | **108** | **140** | **9.105** | 108 | **0** |
| **Y t2** | **39** | **71** | **4.807** | 39 | 0 |

## Verdetto

**Il riuso del prefisso NON scatta in modo utile: `n_common = 0` sul turno 2 di X.**

Lettura dei numeri:

1. `X.n_prompt (108) > Y.n_prompt (39)` — non è il caso “riuso scatta” del mandato (`X < Y`).
2. Formula da sorgente: `n_common = rendered − n_prompt = 108 − 108 = 0`.
3. Perché 108 e non 39? Con `--chatml` e `clear_kv=false` il motore **re-renderizza l'intera chat** (user1 + assistant1 + user2) sul template. La sequenza tokenizzata del turno 2 è più lunga (~108 token di prompt renderizzato) rispetto a una chat nuova (39). Ma **nessun prefisso di quella sequenza coincide con `kv_tokens` residui del turno 1** → tutto viene ri-prefillato.
4. `prefill_s` X t2 (9.1 s) ≈ 2× Y t2 (4.8 s), coerente con ~2.8× token (108 vs 39) a prefill_tps simile.

Quindi: `clear_kv=false` **non** azzera la storia (n_past cresce 71→140), ma il match del prefisso sul re-render del template fallisce → **n_common = 0, ri-prefill completo della storia**.

## Implicazione per F5.1

I 165 s di prefill al turno 5 di F5.1 **non sono un costo inevitabile del multi-turno con riuso corretto**. Sono il costo di un **ri-prefill dell'intera conversazione a ogni turno**, con `n_common = 0`. È un **difetto di riuso del prefisso KV** (o di allineamento tra `kv_tokens` streamati e re-render Jinja del template), non la fisica del multi-turno.

Se il riuso funzionasse, al turno N si dovrebbe prefillare solo il delta (nuovo user + wrapping template), non ~n_past.

Ipotesi meccanica (da sorgente, non instrumentata qui):

- Dopo il turno 1, `kv_tokens` contiene i token grezzi di prefill+decode.
- Al turno 2, `common_chat_templates_apply` re-renderizza la storia (user + assistant parsato + nuovo user).
- I token dell'assistant re-inseriti dal template (con special token / formattazione) **non combaciano** con quelli streamati raw in `kv_tokens` → il while di uguaglianza su `kv_tokens[i] == tokens[i]` esce a 0.

## Artefatti

Telefono `~/experiments/results/mandato_lampo/`:

- `prompt.txt`, `prompt.sha256`
- `smoke_in.jsonl`, `X_in.jsonl`, `Y_in.jsonl`
- `smoke.stdout.log`, `X.stdout.log`, `Y.stdout.log` (+ stderr)
- `done_metrics.jsonl`, `summary.json`, `extract.py`
- `batt_pre.json`

Non committati: GGUF, binari, log grezzi telefono (solo questo report).

## Sicurezza

- die pre-start ≤80 °C rispettato dopo cooldown.
- Nessuno stop 98 °C.
- Batteria in carica (conteggio: ok).
- `../ai-chat` e `PLAN.md` non toccati.
