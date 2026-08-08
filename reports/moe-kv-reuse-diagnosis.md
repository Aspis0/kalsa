# Diagnosi riuso prefisso KV — perché `n_common = 0`

**Stato:** COMPLETE (diagnostica usa-e-getta)  
**Data:** 2026-08-08  
**Mandato:** `mandates/kv-reuse-diagnosis.md`  
**Domanda unica:** cosa c’è all’inizio delle due sequenze che le fa divergere a posizione 0?  
**Risposta:** non divergono a posizione 0. Combaciano per 35 token; divergono a posizione 35 sul blocco `<think>` vuoto. Poi `llama_memory_seq_rm` fallisce e azzera `n_common` a 0.

## Setup

| voce | valore |
|---|---|
| base build | telefono `~/src/BigMoeOnEdge` @ `b0c4e5b` (pulita; PC fork era a `f58980c` con loader-fix — scelta: base telefono = b0c4e5b come da mandato) |
| binario | `build-bmoe/cli/bmoe-cli.DIAG` (sha256 `374b4447…7a58`, 392360 byte) — **non** ha toccato `.NEW` / `.PREFAULT` / campagna |
| campagna intatta | `bmoe-cli` = `bmoe-cli.NEW` sha256 `7354947b…1331` (388696 byte, 5c95cb5f) |
| modello | `~/models/Qwen3.6-35B-A3B-UD-IQ2_M.gguf` |
| config | identica al lampo: `-t 4 -c 2048 -n 32 --temp 0 --chatml --no-think --moe-stream --cache-mb 2000 --dense-weights anon --overlap --io-threads 4 --session` |
| prompt | stesso del lampo, sha256 `a8471e81…5cc9` |
| input | t1 `clear_kv=true`, t2 `clear_kv=false`, stesso prompt, `think=false` |
| preflight | nproc=6, PLUGGED_AC 100%, die pre 37–41 °C, HARD STOP 98 °C non raggiunto (picco ~90 °C in load) |
| artefatti telefono | `~/experiments/results/kv_reuse_diag/` |
| artefatti PC | `results/kv_reuse_diag/` |

## Modifica diagnostica (usa-e-getta, non committata nel fork)

File: `core/src/engine/session.cpp`, subito prima del ciclo di confronto `n_common` (~riga 976).  
Solo `fprintf(stderr, …)` + detokenize con `llama_token_to_piece`. Nessun cambio al calcolo.  
Applicata sul telefono, build → `bmoe-cli.DIAG`, sorgente **ripristinato** da `session.cpp.PREDIAG` dopo il run. Patch script locale: `tools/kvdiag_patch.py` (solo strumento, non feature).

## Output KVDIAG (integrale)

```
KVDIAG n_common_atteso=? kv_tokens=0 tokens=39 chat_on=1
KVDIAG kv[0..15]  = <empty>
KVDIAG tok[0..15] = 248045:<|im_start|> 846:user 198:\n 6205:Sp 161421:iega 303: in 4118: tre 1374: fr 9911:asi 7709: cos 378: e 1147: la 68906: memoria 81726: KV 303: in 632: un
KVDIAG prima divergenza a posizione N/A: kv_tokens empty (confronto saltato)
KVDIAG n_common_atteso=? kv_tokens=71 tokens=108 chat_on=1
KVDIAG kv[0..15]  = 248045:<|im_start|> 846:user 198:\n 6205:Sp 161421:iega 303: in 4118: tre 1374: fr 9911:asi 7709: cos 378: e 1147: la 68906: memoria 81726: KV 303: in 632: un
KVDIAG tok[0..15] = 248045:<|im_start|> 846:user 198:\n 6205:Sp 161421:iega 303: in 4118: tre 1374: fr 9911:asi 7709: cos 378: e 1147: la 68906: memoria 81726: KV 303: in 632: un
KVDIAG prima divergenza a posizione 35: kv=248068:<think> tok=8482:La
KVDIAG kv_full_head[71] = 248045:<|im_start|> 846:user 198:\n 6205:Sp 161421:iega 303: in 4118: tre 1374: fr 9911:asi 7709: cos 378: e 1147: la 68906: memoria 81726: KV 303: in 632: un 41163: transformer 13:. 51572: Ris 3396:pond 72:i 303: in 57786: italiano 11:, 1866: max 220:  23:8 15:0 46652: parole 13:. 248046:<|im_end|> 198:\n 248045:<|im_start|> 74455:assistant 198:\n 248068:<think> 271:\n\n 248069:</think> 271:\n\n 8482:La 68906: memoria 81726: KV 11094: è 4931: una 6297: cache 2920: che 15563: memor 13347:izza 585: i 184327: valori 378: e 501: le 24977: chi 5997:avi 26109: delle 190005: precedenti 10929: sequ 81191:enze 1789: di 3817: token 13:. 171777: Questo 246277: meccanismo 203991: evita 1789: di 427: r 908:ical 177667:colare 324: l 6:' 193220:attenzione
KVDIAG tok_full_head[80] = 248045:<|im_start|> 846:user 198:\n 6205:Sp 161421:iega 303: in 4118: tre 1374: fr 9911:asi 7709: cos 378: e 1147: la 68906: memoria 81726: KV 303: in 632: un 41163: transformer 13:. 51572: Ris 3396:pond 72:i 303: in 57786: italiano 11:, 1866: max 220:  23:8 15:0 46652: parole 13:. 248046:<|im_end|> 198:\n 248045:<|im_start|> 74455:assistant 198:\n 8482:La 68906: memoria 81726: KV 11094: è 4931: una 6297: cache 2920: che 15563: memor 13347:izza 585: i 184327: valori 378: e 501: le 24977: chi 5997:avi 26109: delle 190005: precedenti 10929: sequ 81191:enze 1789: di 3817: token 13:. 171777: Questo 246277: meccanismo 203991: evita 1789: di 427: r 908:ical 177667:colare 324: l 6:' 193220:attenzione 248046:<|im_end|> 198:\n 248045:<|im_start|> 846:user 198:\n 6205:Sp 161421:iega 303: in 4118: tre 1374: fr 9911:asi 7709: cos 378: e
```

## Sequenze affiancate (turno 2, primi 16 + punto di rottura)

| pos | kv_tokens (dopo t1) | tokens (re-render t2) |
|----:|---|---|
| 0 | `248045:<\|im_start\|>` | `248045:<\|im_start\|>` |
| 1 | `846:user` | `846:user` |
| 2 | `198:\n` | `198:\n` |
| 3–15 | `Sp iega in tre frasi cos e la memoria KV in un` | **identici** |
| … | … | … |
| 0–34 | user + `<\|im_end\|>` + `<\|im_start\|>assistant\n` | **identici** |
| **35** | **`248068:<think>`** | **`8482:La`** |
| 36 | `271:\n\n` | (continua risposta) |
| 37 | `248069:</think>` | |
| 38 | `271:\n\n` | |
| 39+ | `La memoria KV è una cache…` | `La memoria KV è una cache…` poi nuovo user |

## n_common effettivo

| turno | clear_kv | n_prompt | n_past | tokens gen | prefill_s | n_common (= rendered − n_prompt) |
|------:|----------|---------:|-------:|-----------:|----------:|----------------------------------:|
| 1 | true | 39 | 71 | 32 | 5.342 | 0 (kv vuota, atteso) |
| 2 | false | **108** | 140 | 32 | 11.954 | **0** |

Match grezzo al confronto: **35 token** (pos 0..34).  
`s.n_prompt = 108` ⇒ il `n_common` finale usato dal motore è **0**, non 35: dopo il match parziale, `llama_memory_seq_rm(ctx, 0, n_common=35, -1)` fallisce e il ramo di fallback azzera KV + `n_common` (session.cpp ~983–986). Due fallimenti in serie: (1) divergenza a 35, (2) wipe del prefisso comune.

## Caso identificato (regole del mandato)

| # | regola | qui? |
|---|---|---|
| 1 | divergenza a **posizione 0** (template / BOS nuovo) | **NO** — pos 0..34 identiche |
| **2** | **combaciano un tratto, poi divergono presto** | **SÌ** — match 35, rottura a 35 su `<think>` |
| 3 | `kv_tokens` vuoto al t2 | **NO** — size=71 |
| 4 | sequenze identiche 71 ma n_common=0 (bug nel confronto) | **NO** — non sono identiche |

**Caso 2.** Il prefisso comune c’è; lo interrompe il blocco thinking vuoto presente in `kv_tokens` e assente dal re-render.

### Meccanismo (dal codice, non da ipotesi)

1. Turno 1 con `think=false` / `--no-think`: il modello **emette comunque** ` <think>\n\n</think>\n\n ` (4 token) prima della risposta. Entra in `kv_tokens` insieme ai 28 token di risposta → 32 gen, n_past=71.
2. `common_chat_parse` separa reasoning da content; in history si committa solo `assistant.content = "La memoria KV…"`, **senza** i marker think (`session.cpp` ~1526–1538).
3. Turno 2: Jinja re-renderizza `chat_history` → dopo `<|im_start|>assistant\n` parte subito `La`, **senza** il blocco think che invece sta ancora nella KV.
4. Confronto: match fino a 35, divergenza `kv=<think>` vs `tok=La`.
5. `seq_rm` del tail fallisce → clear totale → `n_common=0` → ri-prefill di tutti i 108 token.

## Fix suggerito (non implementato)

Obiettivo: il re-render del turno N+1 deve produrre **byte-per-byte** lo stesso prefisso che `kv_tokens` ha accumulato.

Vie ordinate per invasività:

1. **Allineare history al stream reale (preferita):** al commit dell’assistant, se la generazione grezza inizia con lo span think del template, conservare in `chat_history` anche `reasoning_content` (anche se vuoto) in modo che `common_chat_templates_apply` re-emetta gli stessi marker; oppure serializzare in history la forma “raw” che la KV ha visto.
2. **Allineare kv allo history:** dopo il parse, riscrivere/trimmare da `kv_tokens` (e dalla memory) i token dello span think se history non li riprodurrà — rischioso se il modello ha condizionato sui marker.
3. **Forzare no-think lato template in modo che i marker non vengano mai generati** (Prefill/Template già tentano; qui il modello li ha emessi lo stesso) e, se compaiono, non accodarli a `kv_tokens`.
4. **Indipendente:** capire perché `llama_memory_seq_rm` parziale fallisce su questo modello (senza SWA dichiarato) e non azzerare un prefisso già valido — altrimenti anche col match a 35 si perde tutto.

Soglia di successo del fix: turno 2 con stesso setup → `n_common ≈ 71` (o 70 per la regola “tieni 1 token”), `n_prompt ≈ 108−71 ≈ 37` (solo il nuovo user turn), prefill_s nell’ordine del turno 1 (~5 s), non ~12 s.

## Valore in gioco

Turno 5 F5.1: **165 s → ~10 s** di attesa percepita (−65%), senza toccare decode, qualità o modello. Conferma lampo: il costo è ri-prefill per `n_common=0`, non la fisica del multi-turno.

## Artefatti

- Telefono: `~/experiments/results/kv_reuse_diag/{diag.stderr.log,diag.stdout.log,kvdiag_extract.txt,bmoe_done.txt,diag_in.jsonl,bin_sha.txt,build.log}`
- PC: `results/kv_reuse_diag/` (extract + done + input + sha)
- Binario diagnostico lasciato sul telefono come `bmoe-cli.DIAG` (non in path di campagna); sorgente fork ripristinato.
- Non toccati: `../ai-chat`, `PLAN.md`, `bmoe-cli.NEW`, `bmoe-cli.PREFAULT`.
