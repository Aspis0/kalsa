# Protocollo F1 — LiteRT vs llama.cpp CPU (S23, eseguibile)

**1 pagina. Esecuzione = mandato successivo** (S23 libero + gualt). Prep PC pronta.

## Scopo

Fail-fast porta-740: il decode **sostenuto ≥60 s** di LiteRT-LM (Gallery / OpenCL Adreno)
è ≥ **1.15×** il gemello **llama-bench CPU** size-matched sullo **stesso S23**, staccato, 2 rep.

## Artefatti (già su PC)

| pezzo | path | sha (verificare pre-run) |
|---|---|---|
| App | `models/litert-prep/ai-edge-gallery-sm8550-1.0.18.apk` | `A2BEA016…96639` |
| Modello LiteRT | `models/litert-prep/gemma-4-E2B-it-gpu.litertlm` | `a53a5900…a5cf5` |
| Gemello GGUF CPU | da preparare al F0: GGUF **~stessa footprint** (es. Gemma-2-2B o Llama-3.2-3B Q4_K_M da HF) — **annotare sha** a verbale F0 |

## Setup device (F0, una tantum)

1. S23 staccato, batteria ≥45%, schermo ON (timeout alto), Termux + `bmoe`/`llama-cli` pin campagna se serve gemello.  
2. `adb install -r` APK sm8550.  
3. `adb push` `.litertlm` → `/sdcard/Download/`.  
4. Aprire **Google AI Edge Gallery** → import model file → backend **GPU** se esposto.  
5. Cold: force-stop app + drop page cache modello se disponibile; 2 min idle termico.

## Come misurare DECODE in Gallery (metriche esposte)

La Gallery UI tipicamente mostra **tokens/sec** (prefill e/o decode) nel pannello stats
della chat / benchmark card (release note 1.0.x: multimodal chat + model stats).

**Procedura misurabile:**

1. Prompt fisso (stesso testo del gemello), es. `prompts/short.txt` (~80–100 token prompt).  
2. Genera **n ≥ 256** token (o finché wall ≥ 65 s).  
3. Se UI espone **decode tok/s** separato dal prefill → registra quello.  
4. Se espone solo **overall tok/s** → registra overall **e** wall-clock + n_gen, ricava  
   `tok/s ≈ n_gen / t_decode` se prefill time è mostrato; altrimenti overall con nota.  
5. **Sostenuto ≥60 s:** una singola generazione lunga **oppure** loop di generazioni
   consecutive senza chiudere l’app, finché tempo decode cumulato ≥60 s; media tok/s.  
6. 2 rep complete; mediana.

**Se l’app NON espone tok/s:**

| alternativa | come |
|---|---|
| **A (preferita)** | LiteRT-LM **CLI** su device (se build Android `litert-lm` da Termux/NDK) con flag bench — oggi la CLI ufficiale è desktop-first; su S23 va validata a F0 |
| **B** | `adb shell` + logcat del runtime LiteRT (tag da scoprire a F0: spesso latency per token) |
| **C** | screen recording + contatore token UI (ultimo resort, alta incertezza) |

→ A F0: aprire Gallery una volta e **fotografare** schermata stats; se zero metriche,
dichiarare BLOCKED e passare ad A/B.

## Gemello llama-bench CPU (comando esatto)

Modello GGUF size-matched (es. `gemma-2-2b-it-Q4_K_M.gguf` o Llama-3.2-3B-Q4_K_M), sha a verbale.

```bash
# Su S23 Termux, staccato, -t 4 (campagna S23)
export LD_LIBRARY_PATH=...   # come pin ISA-safe
BIN=~/src/llama.cpp/build-safe/bin/llama-bench   # o path pin locale
MODEL=~/experiments/models/<SIZE_MATCHED>.gguf
$BIN -m $MODEL -t 4 -p 128 -n 256 -r 2 -o json \
  2> ~/experiments/results/litert_f1/llama_bench.stderr \
  | tee ~/experiments/results/litert_f1/llama_bench.json
```

- **CPU only** (no OpenCL).  
- Stesso device, stessa sessione termica target (≤32 °C inizio se policy lab).  
- 2 rep (`-r 2`).  
- Metrica: **tg_ts** (decode tok/s) da json llama-bench.

Se `llama-bench` assente: `llama-cli -n 256 -p "..." -t 4` + parse `tok/s` dalle telemetrie bmoe/llama (meno pulito).

## Condizioni comuni

| regola | valore |
|---|---|
| Alimentazione | **staccato** |
| Batteria | ≥45% inizio; stop &lt;30% |
| Thread CPU gemello | **-t 4** |
| Rep | **2** |
| Gate | mediana LiteRT_decode ≥ **1.15 ×** mediana llama_CPU_decode |
| Cold | sì, per rep (force-stop Gallery; fadv sul GGUF se c’è) |

## Verbale minimo F1

```text
device, apk_sha, model_litert_sha, model_gguf_sha
rep, litert_tok_s, llama_cpu_tok_s, ratio, wall_s, batt%, temp
gate: PASS|FAIL (1.15x)
note: metrica UI usata (decode vs overall)
```

## STOP

Install/run su S23 = **mandato successivo**. Questo file è solo prep.
