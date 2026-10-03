# REPORT — iOS engine choice measured on the Mac (2026-10-02)

Machine: MacBook Pro M1 Max (8 P-cores + 2 E-cores, 64 GB unified), macOS 26.6.2. All measurements
are engine throughput on the Mac (no phones, no Runpod, public HF downloads only, no tokens used or
printed). Lab folder carries no binaries; builds and models stayed in `/tmp` and `~/kalsa-models`.
Nothing committed.

**Verdict in one line:** the numbers do not justify replacing llama.cpp as Kalsa's main iOS engine —
llama.cpp at the app's pin is slightly faster than MLX on LFM2.5-2.6B and ~26% slower than MLX on
Qwen3.5-2B (the same ordering as the public iPhone 17 Pro comparison) — and the app's 31.22 tok/s
decode on the Mac is fully explained by its shipped settings, ~97% of the gap to the engine's
capability coming from the catalog's quantized KV cache (`q8_0` K / `q4_0` V) on Metal, not from
threads or the 16k context reservation. Apple Foundation Models is unavailable on this Mac
(`appleIntelligenceNotEnabled`), so the AFM prompt sweep was skipped per brief.

## Engines, versions, builds

| component | version |
|---|---|
| llama.cpp (Kalsa engine, app pin `native/kalsallama.pin`) | commit `5b596ce43` (build 11598), llama-bench reports `0.5.0-dev (build 11598, commit 5b596ce43)` |
| llama.cpp build | `cmake -S <clone> -B build-mac -G Ninja -DCMAKE_BUILD_TYPE=Release -DGGML_METAL=ON -DLLAMA_CURL=OFF -DLLAMA_BUILD_SERVER=OFF`, AppleClang 21.0.0.21000334, backends `Accelerate + Metal` |
| MLX / mlx-lm | 0.32.3 / 0.32.0 (Python 3.14.6, Homebrew, venv in `/tmp/iec-venv`) |

Clone provenance: `git clone ~/Projects/kalsallama /tmp/kalsallama-pin` + `git switch --detach
5b596ce43…` — no repo was modified, nothing committed. The `tools/ui` asset-download step (network
fetch of the server web UI) is why `-DLLAMA_BUILD_SERVER=OFF` is in the configure line.

## Models

| model | file | size | source |
|---|---|---|---|
| LFM2.5-2.6B QAD-Q4_0 (GGUF) | `~/kalsa-models/mac/LFM2.5-2.6B-QAD-Q4_0.gguf` | 1,593,894,944 B | Kalsa's catalog file (arch `lfm2`), byte-exact with the Mac app run |
| LFM2.5-2.6B (MLX 4-bit) | `/tmp/iec-models/lfm25-mlx4-own/` | 1.4 GB | converted locally: `mlx_lm.convert --hf-path LiquidAI/LFM2.5-2.6B -q --q-bits 4` (exit 0) |
| Qwen3.5-2B Q4_0 (GGUF) | `/tmp/iec-models/qwen35-2b-gguf/Qwen3.5-2B-Q4_0.gguf` | 1,212,873,856 B | `unsloth/Qwen3.5-2B-GGUF` (arch `qwen35`) |
| Qwen3.5-2B Q4_K_M (GGUF) | `/tmp/iec-models/qwen35-2b-gguf/Qwen3.5-2B-Q4_K_M.gguf` | 1,280,835,840 B | `unsloth/Qwen3.5-2B-GGUF` |
| Qwen3.5-2B (MLX 4-bit) | `/tmp/iec-models/qwen35-2b-mlx4/` | 1.5 GB | `mlx-community/Qwen3.5-2B-4bit` (4-bit affine, group 64) |

Note: `mlx-community/LFM2.5-2.6B-4bit` is broken for mlx-lm 0.32.0 — its 600 tensors are all
`language_model.`-prefixed while its config declares `Lfm2ForCausalLM`, so loading fails with
`ValueError: Received 600 parameters not in model` (the brief's `mlx_lm.convert` fallback was used
instead).

## Method

- The wait gate ran before **every** timed invocation: `pgrep -fl "xcodebuild|KalsaAIChat|llama-bench|mlx_lm"`,
  poll 60 s, max 90 min. One timed cell at a time, cells sequential.
- llama-bench cells: each cell invoked 3 times; one invocation = 5 internal reps averaged by
  llama-bench (`avg_ts`), the reported number is the **median of the 3 invocations** (CSV output).
  All cells: `-fa 1 -ngl 99`, `-t 8` (P-core count) unless stated, `-p 512 -n 128`.
  `-d N` = llama-bench context depth (llama-bench derives `n_ctx = p + n + d`; decode runs with the
  depth tokens already in the KV), so `-d 2048` is "decode at 2k context depth" and the app's full
  16384 context maps to `-d 15744` (512+128+15744 = 16384).
- MLX cells: `mlx_lm benchmark --model <dir> -p 512 -g 128`, 3 gated invocations, median of the 3
  per-run `Averages:` lines. The tool benchmarks random-token forward passes (like llama-bench's
  random prompts, no chat template) and has no sampling seed; `peak_memory` is its own GiB reading
  (weights + KV + runtime).
- Contamination incident, disclosed: the other session ran 90 s `xctrace`/Xcode bursts on a
  KalsaAIChat build during two windows. The gate protected run starts, but five cells collected a
  run that overlapped activity (visible as outliers: e.g. `lfm_kv_d2048` tg 33.7 → 13.6 → 7.5).
  Those five cells were fully re-run under the gate and only the clean runs are reported (re-run
  values are tight: spread ≤ 6%). Raw CSVs/logs: `/tmp/iec/results/` (ephemeral).

## Results — llama.cpp at the app pin (Metal, `-ngl 99`, flash attn on)

LFM2.5-2.6B QAD-Q4_0:

| cell | settings | prompt tok/s (pp512) | decode tok/s (tg128) | decode @2k depth |
|---|---|---|---|---|
| lfm_base | `-t 8`, KV f16/f16, ctx 640 | 1226.83 | 128.58 | — |
| lfm_d2048 | `-t 8`, KV f16/f16, `-d 2048` | 1165.69 | 124.85 | **124.85** |
| lfm_t4_d2048 | `-t 4`, KV f16/f16, `-d 2048` | 1137.81 | 121.88 | 121.88 |
| lfm_kv_d2048 | `-t 8`, KV q8_0/q4_0, `-d 2048` | 214.68 | 36.28 | 36.28 |
| **lfm_app_d2048** (app repro) | `-t 4 -ctk q8_0 -ctv q4_0 -d 2048` | 137.04 | 31.27 | **31.27** |
| lfm_app_d15744 (full 16k ctx) | as above, `-d 15744` (n_ctx 16384) | 20.30 | 13.00 | 13.00 @ ~15.9k depth |

Memory (LFM, llama.cpp): weights 1.59 GB file — the app console measured 1512.20 MiB mapped to the
GPU + 205.08 MiB CPU-resident, and KV = 104.00 MiB at n_ctx 16384 with `q8_0`/`q4_0` (catalog
`kvBytesPerToken: 6656`, measured; f16 KV would be ~2× that per token, i.e. ~+104 MiB at 16384,
derived arithmetic). At the base cell's ctx 640 the KV is a few MiB — negligible next to weights.

Qwen3.5-2B (`-t 8`, KV f16/f16):

| cell | settings | prompt tok/s | decode tok/s | decode @2k depth |
|---|---|---|---|---|
| qwen_q40_base | Q4_0, ctx 640 | 1601.74 | 116.31 | — |
| qwen_q40_d2048 | Q4_0, `-d 2048` | 1601.42 | 111.80 | **111.80** |
| qwen_q4km_base | Q4_K_M, ctx 640 | 1573.27 | 110.65 | — |
| qwen_q4km_d2048 | Q4_K_M, `-d 2048` | 1326.01 | 88.54 | **88.54** |

Q4_0 file 1.13 GiB, Q4_K_M 1.19 GiB (KV sizes not measured for Qwen3.5; nothing app-side to
cross-check against).

## Results — MLX

| cell | settings | prompt tok/s | decode tok/s | decode @2k | peak memory |
|---|---|---|---|---|---|
| mlx_lfm4 | LFM2.5-2.6B 4-bit, p512/g128 | 814.42 | 121.20 | not measurable (`mlx_lm benchmark` has no depth knob) | 2.25 GiB |
| mlx_qwen4 | Qwen3.5-2B 4-bit, p512/g128 | 1327.97 | 146.20 | not measurable | 1.92 GiB |

## Same-model comparison and the iPhone reference

| model | engine | prompt tok/s | decode tok/s | decode @2k | peak memory |
|---|---|---|---|---|---|
| LFM2.5-2.6B | llama.cpp Q4_0 (t8, f16 KV) | 1226.83 | 128.58 | 124.85 | weights 1.59 GB (+104 MiB KV @16k quantized) |
| LFM2.5-2.6B | MLX 4-bit | 814.42 | 121.20 | — | 2.25 GiB |
| LFM2.5-2.6B | llama.cpp app settings (t4, q8/q4 KV) | 137.04 | 31.27 | 31.27 | as shipped in Kalsa |
| Qwen3.5-2B | llama.cpp Q4_0 (t8, f16 KV) | 1601.74 | 116.31 | 111.80 | file 1.13 GiB |
| Qwen3.5-2B | llama.cpp Q4_K_M | 1573.27 | 110.65 | 88.54 | file 1.19 GiB |
| Qwen3.5-2B | MLX 4-bit | 1327.97 | 146.20 | — | 1.92 GiB |

Against the public iPhone 17 Pro numbers (MODELS-RESEARCH.md §2: Qwen3.5-2B at 61.2 tok/s MLX Swift
vs 39.1 llama.cpp vs 27.9 CoreML/ANE, median of 3 cold short-chat runs): the M1 Max reproduces the
**ordering** — MLX beats llama.cpp on Qwen3.5-2B by +26% here (146.2 vs 116.3, both ~4-bit) versus
+57% on the iPhone — but not on LFM2.5-2.6B, where llama.cpp is slightly ahead (+6%). Absolute
llama.cpp decode on the M1 Max is ~3× the iPhone's. Caveats: the iPhone numbers are another author's
short-chat harness on iOS 26.4.2; mine are random-token benchmark cells on macOS, 3 gated runs,
medians — directionally comparable, not laboratory-identical.

## Why the app sees 31.22 tok/s (MAC-RELEASE-RUN.md) — measured attribution

The app's shipped config on the Mac (read from `~/Projects/kalsa/src/engine`, confirmed by the app's
own console capture): `n_threads` 4 on non-Android (`threadProfile.ts` fallback), KV profile
Standard = `q8_0` K / `q4_0` V (`kvCachePref.ts`, catalog `ModelRegistry.ts:232`), `engineCtx` 8192
RAM-upgraded to `HIGH_RAM_N_CTX` 16384 (`contextProfile.ts`), flash attn on, `nGpuLayers` 99, and
the measured turn decoded with ~2126 tokens already in the KV (session restore). Reproducing exactly
that in llama-bench (`lfm_app_d2048`: t4, q8_0/q4_0, depth 2048) gives **31.27 tok/s** vs the app's
31.22 — a 0.2% match. Factor costs, decode tg128, against the same-depth f16 8-thread baseline
(124.85):

| factor change | decode tok/s | cost |
|---|---|---|
| threads 8 → 4 | 121.88 | −2.4% |
| KV f16/f16 → q8_0/q4_0 | 36.28 | **−70.9%** |
| both (app config) | 31.27 | −74.9% |
| both + decode depth 2048 → ~15.9k | 13.00 | −89.6% (bound; the app's turn sat at ~2.1k) |

**The quantized KV cache is the cost.** With flash attention on Metal, `q8_0` K / `q4_0` V runs a
dequantizing attention path that costs ~4× decode (and ~5× prefill: pp512 1165.7 → 214.7 at t8,
137.0 at t4). The thread count is irrelevant (−2.4% with everything on the GPU), and the 16384
context *reservation* costs nothing at the depths the app actually uses — depth is what costs
(13.0 tok/s at ~16k depth vs 31.3 at 2k). The app's 60.05 tok/s "prefill" line is a 17-token turn
prompt, i.e. single-batch latency-bound work, not comparable to pp512. Actionable: an f16-KV
profile for desktop-class Macs would take the same engine from 31.3 to 121.9 tok/s (~3.9×) for
~+104 MiB of KV at n_ctx 16384 (the existing "High" q8_0/q8_0 choice only halves the V saving).

## B. Apple Foundation Models — unavailable, sweep skipped

Probe (tiny Swift script, `/tmp/afm-probe/main.swift`, `swiftc -target arm64-apple-macos26.0`):

```swift
import Foundation
import FoundationModels

let model = SystemLanguageModel.default
switch model.availability {
case .available:
    print("AVAILABILITY: available")
case let .unavailable(reason):
    print("AVAILABILITY: unavailable")
    switch reason {
    case .deviceNotEligible: print("reason: deviceNotEligible")
    case .appleIntelligenceNotEnabled: print("reason: appleIntelligenceNotEnabled")
    case .modelNotReady: print("reason: modelNotReady")
    @unknown default: print("reason: unknown (\(String(describing: type(of: reason))))")
    }
@unknown default:
    print("AVAILABILITY: unknown")
}
```

Output (exit 0):

```
AVAILABILITY: unavailable
reason: appleIntelligenceNotEnabled
```

Exact reason: `SystemLanguageModel.default.availability == .unavailable(.appleIntelligenceNotEnabled)`
— this Mac is of the eligible hardware class (the enum distinguishes `deviceNotEligible`, which did
not fire), but Apple Intelligence is not enabled on it (Settings toggle / language-region gate).
No answers, TTFT, `contextSize`, or guardrail data can be produced here; per brief the 5-language
sweep is skipped. It needs a Mac (or iPhone) with Apple Intelligence turned on — likely a 5-minute
settings change Marco can make, after which this section can be filled by re-running the probe and
a `LanguageModelSession` streaming script.

## Exact commands

```
# llama.cpp cells (one at a time, each gated, ×3; LFM shown, Qwen analogues with the Qwen files)
/tmp/kalsallama-pin/build-mac/bin/llama-bench -m ~/kalsa-models/mac/LFM2.5-2.6B-QAD-Q4_0.gguf \
  -fa 1 -ngl 99 -t 8 -p 512 -n 128 -o csv                                   # lfm_base
  … -d 2048                                                                 # depth 2k cells
  … -t 4 -ctk q8_0 -ctv q4_0 -d 2048                                        # app repro
  … -t 4 -ctk q8_0 -ctv q4_0 -d 15744                                       # full 16k ctx
# MLX cells (each gated, ×3)
/tmp/iec-venv/bin/mlx_lm benchmark --model /tmp/iec-models/lfm25-mlx4-own -p 512 -g 128
/tmp/iec-venv/bin/mlx_lm benchmark --model /tmp/iec-models/qwen35-2b-mlx4 -p 512 -g 128
# LFM MLX conversion (mlx-community 4-bit repo is broken for mlx-lm 0.32.0, see note above)
/tmp/iec-venv/bin/mlx_lm.convert --hf-path LiquidAI/LFM2.5-2.6B --mlx-path /tmp/iec-models/lfm25-mlx4-own -q --q-bits 4
```

Every timed invocation ran behind the gate script (`/tmp/iec/bin/waitgate.sh`: pgrep pattern from
the brief, 60 s poll, 90 min cap) inside per-cell runners; all exit codes are in
`/tmp/iec/results/*.log` (e.g. `== lfm_base run 3 exit=0`).

## Coordinator follow-up cells (2026-10-02, same build, `-t 4 -fa 1 -ngl 99 -p 0 -n 128 -d 2048 -r 3`)

Run by the coordinator after this report, with an Xcode index job possibly running in the background (treat as +-5%):

| KV K/V | tg128 @ d2048 |
|---|---|
| q8_0 / q8_0 | 97.48 +- 1.79 |
| f16 / f16 | 94.49 +- 2.56 |
| q8_0 / q4_0 (app today, from the table above) | 31.27 |

So the loss comes from the MIXED K/V types (q8_0 K with q4_0 V) on Metal, not from quantized KV as such: q8_0/q8_0
decodes as fast as f16 at half the KV memory. iOS fix candidate: q8_0/q8_0 on Apple GPUs.

Coordinator cells at the app's real context (`-d 15744`, `-r 2`, same flags, no other heavy job running):

| KV K/V | tg128 @ d15744 |
|---|---|
| q8_0 / q8_0 | 94.92 +- 6.22 |
| q8_0 / q4_0 | 12.55 +- 0.24 |

All cells are on the M1 Max Mac (Metal), not on an iPhone: the iPhone gap is expected but unmeasured.

## AFM (Apple Intelligence enabled) — full probe (2026-10-03)

Follow-up to the section above: Apple Intelligence was enabled on this Mac on 2026-10-02 23:45
(`/tmp/afm2/poll.log`: first `unavailable reason=modelNotReady` at 23:40, then `AVAILABLE
contextSize=4096` at 23:45). The probe in `/tmp/afm2` (Swift + FoundationModels, compiled with the
MacOSX27.0.sdk of Xcode at `/Applications/Xcode.app`) re-confirmed availability and ran the full
sweep plus a context-limit probe.

What the framework reports: OS `Version 26.6.2 (Build 25G83)`; `SystemLanguageModel.default`
exposes only `availability` and `contextSize` — **no model identifier or revision is exposed**.
`contextSize: 4096` (total content budget, prompt + output together, enforced as shown below).

Harness (each binary one responsibility, sources in `/tmp/afm2/{sweep,limit,tokrate}/main.swift`):

```
swiftc -O main.swift -o afm-sweep     # streamed cells: TTFT/total/chunks + verbatim answer
swiftc -O main.swift -o afm-limit     # growing prompt vs contextSize
swiftc -O main.swift -o afm-tokrate   # non-streamed twin: API token counts -> tok/s
/tmp/afm2/sweep/afm-sweep  > /tmp/afm2/sweep.log 2>&1; echo $?    # exit 0
/tmp/afm2/limit/afm-limit  > /tmp/afm2/limit.log 2>&1; echo $?    # exit 0
/tmp/afm2/tokrate/afm-tokrate > /tmp/afm2/tokrate.log 2>&1; echo $?  # exit 0
```

Both timed runs waited behind `/tmp/afm2/bin/waitgate.sh` (brief's pgrep pattern): the first gate
window timed out (exit 3) behind a ~100 min Xcode build of KalsaAIChat; a second clean window
passed (exit 0) before the sweep, and the gate was re-checked before limit and tokrate.

### Token-count API note

The 26.6.2 runtime carries `promptTokenCount`/`responseTokenCount` on
`LanguageModelSession.Response` but the installed 27.0 SDK exposes only a new `usage` struct
(availability macOS 27.0), so `afm-tokrate` reads the runtime fields via `Mirror` reflection
(`promptTokenCount` includes the session's default instructions: ~30 tokens of preamble).
Token counts/tok/s therefore come from the non-streamed twin run; TTFT/total/chunks come from the
streamed run. Both are single runs.

### Prompts (same cells to repeat with LFM2.5)

- it: `Spiegami in tre frasi cos'è la fotosintesi.`
- fr: `Explique-moi en trois phrases ce qu'est la photosynthèse.`
- es: `Explícame en tres frases qué es la fotosíntesis.`
- en: `Explain to me in three sentences what photosynthesis is.`
- zh: `请用三句话解释什么是光合作用。`
- kalsa-summary: `Riassumi in tre frasi il paragrafo seguente:\n\n<paragrafo300.txt>` — the 300-word
  Italian paragraph is saved in this folder as `paragrafo300.txt` (copy of `/tmp/afm2/paragrafo300.txt`)
- kalsa-3turn (one session, 3 turns): t1 `In una frase: cos'è il KV cache in un motore LLM on-device?`
  t2 `Perché quantizzarlo riduce la memoria occupata?`
  t3 `Tornando alla tua prima risposta: qual è il principale rischio di qualità quando si quantizza il KV cache?`
- kalsa-reasoning: `Se ho 3 mele e ne mangio una ogni 2 ore partendo alle 9, a che ora finisco?`

### Metrics (streamed run; tok/s from the non-streamed twin)

| cell | TTFT ms | total ms | chunks | prompt tok | response tok | out tok/s |
|---|---|---|---|---|---|---|
| it | 717 | 3208 | 10 | 37 | 87 | 34.6 |
| fr | 644 | 3348 | 12 | 38 | 117 | 46.3 |
| es | 658 | 2886 | 9 | 36 | 111 | 39.4 |
| en | 506 | 2348 | 9 | 32 | 86 | 37.2 |
| zh | 692 | 2332 | 7 | 32 | 94 | 33.0 |
| kalsa-summary | 7032 | 12597 | 12 | 440 | 117 | 9.4 |
| kalsa-3turn/t1 | 421 | 1833 | 6 | 40 | 50 | 11.1 |
| kalsa-3turn/t2 | 467 | 1457 | 5 | 108 | 40 | 5.5 |
| kalsa-3turn/t3 | 6462 | 13608 | 6 | 177 | 52 | 11.9 |
| kalsa-reasoning | 6717 | 9108 | 12 | 48 | 46 | 6.2 |

Observations: no guardrail refusals and no unsupported-language errors — all 5 languages answered.
Streaming is coarse (5–12 chunks per answer, not per-token). TTFT is bimodal: ~0.4–0.7 s on recall
cells vs ~6.5–7 s on cells where the model deliberates (summary, t3, reasoning). Short-prompt
throughput is ~33–46 out tok/s; the Kalsa-like cells land at 5.5–12 out tok/s (deliberation +
short answers amortize badly). The 3-turn session's prompt grows 40 → 108 → 177 tokens as context
accumulates.

### Answers verbatim

**it** — `La fotosintesi è il processo attraverso il quale le piante, le alghe e alcune batteri convertono la luce solare in energia chimica. Questo avviene principalmente nei cloroplasti attraverso la sintesi di glucosio e ossigeno dall'anidride carbonica e dall'acqua. Durante questo processo, la luce solare fornisce l'energia necessaria per catalizzare le reazioni chimiche che trasformano i nutrienti in energia utilizzabile dalla pianta.`

**fr** — `La photosynthèse est le processus par lequel les plantes, les algues et certaines bactéries transforment la lumière solaire en énergie chimique sous forme de glucose. Ce processus se déroule principalement dans les chloroplastes et nécessite l'absorption de dioxyde de carbone et d'eau. À l'aide de l'énergie solaire, ces substances sont converties en glucose et en oxygène, ce qui contribue à la production d'oxygène dans l'atmosphère et fournit de l'énergie pour la vie sur Terre.`

**es** — `La fotosíntesis es un proceso mediante el cual las plantas, algas y ciertas bacterias convierten la luz solar, el agua y el dióxido de carbono en glucosa y oxígeno. Este proceso ocurre principalmente en las cloroplastos de las células vegetales. La glucosa generada es utilizada como fuente de energía para la planta, mientras que el oxígeno es liberado al aire como subproducto.`

**en** — `Photosynthesis is a process used by plants, algae, and some bacteria to convert light energy, usually from the sun, into chemical energy stored in glucose. This process occurs in the chloroplasts of plant cells, where chlorophyll captures sunlight and uses it to combine carbon dioxide and water into glucose and oxygen. The oxygen produced as a byproduct is released into the atmosphere, while the glucose serves as an energy source for the plant.`

**zh** — `光合作用是一种植物、藻类和某些细菌通过 chlorophyll 进行的光合反应，将二氧化碳和水转化为葡萄糖和氧气。这个过程需要阳光的能量来驱动化学反应。光合作用不仅为植物提供能量和碳水化合物，也为地球上大部分生物提供氧气，维持生命循环。`

**kalsa-summary** — `L'intelligenza artificiale on-device consente di eseguire modelli linguistici direttamente sui dispositivi mobili, riducendo la latenza e migliorando la privacy, ma richiede più memoria rispetto ai modelli cloud. La quantizzazione dei modelli, che riduce il peso a quattro bit, è cruciale per ottimizzare la memoria e il consumo energetico, anche se comporta una perdita di qualità. Tuttavia, la scelta del motore di inferenza e la velocità dei chip possono influenzare significativamente le prestazioni, rendendo le cifre dei benchmark di difficile interpretazione.`

**kalsa-3turn/t1** — `Il KV cache in un motore LLM on-device è un sistema di memorizzazione a chiave-valore che consente di accedere rapidamente ai dati di contesto e agli stati intermedi durante la comprensione del linguaggio naturale, migliorando l'efficienza e la velocità dell'elaborazione.`

**kalsa-3turn/t2** — `Quantizzare il modello riduce la memoria occupata poiché le operazioni matematiche vengono eseguite con numeri di precisione ridotta, riducendo le dimensioni dei dati di input e del risultato, e semplificando la gestione dei parametri.`

**kalsa-3turn/t3** — `Il principale rischio di qualità quando si quantizza il KV cache è la perdita di accuratezza nelle operazioni matematiche, specialmente in presenza di dati complessi o quando si utilizzano operazioni che richiedono una precisione elevata, come le operazioni di logaritmo.`

**kalsa-reasoning** —

```
Se inizi a mangiare mele alle 9 e ne mangi una ogni 2 ore, puoi calcolare il tempo necessario per mangiare tutte e 3 le mele.

1. Mangia la prima mela alle 9:00.
2. Mangia la seconda mela alle 11:00 (9:00 + 2 ore).
3. Mangia la terza mela alle 13:00 (11:00 + 2 ore).

Quindi, finirai di mangiare le mele alle 13:00.
```

Raw logs: `/tmp/afm2/sweep.log`, `/tmp/afm2/tokrate.log`, `/tmp/afm2/limit.log` (answers above are
copied verbatim from sweep.log in case /tmp is wiped).

### Context limit

Filler prompts of growing length (English filler ~4.9 chars/token real vs the 4.0 assumed, so the
"scale" labels underestimate real tokens): ok at ~3.1k chars-estimated 3062 (real ~2.5k), ok at
"0.95×" and even "1.1×" (17,972 chars ≈ 3.7k real tokens, answered, though the 0.95× answer
hallucinated `cervo` for `fox` — quality degrades near the cap). First failure at 24,560 chars:

```
ERROR_TYPE: GenerationError
ERROR: exceededContextWindowSize(FoundationModels.LanguageModelSession.GenerationError.Context(
  debugDescription: "Content contains 5029 tokens, which exceeds the maximum allowed context size of 4096.",
  underlyingErrors: [Provided 5,029 tokens, but the maximum allowed is 4,096.], ...))
```

So the enforced 4096 budget counts the whole submitted content (prompt alone rejected at 5029);
with prompt+output sharing 4096, usable input for a Kalsa-like chat is roughly ≤3.5k tokens.

Quality flags for the coordinator (who judges): zh answer code-switches (`通过 chlorophyll 进行`);
it `alcune batteri` and es `en las cloroplastos` gender agreement errors; 3-turn t2 answers about
quantizing the model in general, missing the KV-cache referent; t3's risk answer ends on
`operazioni di logaritmo`, an incoherent detail. Reasoning cell correct (13:00).
