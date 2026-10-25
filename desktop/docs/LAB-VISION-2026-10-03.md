# LAB VISION — 2026-10-03 — Gemma 4 E4B + LFM 2.5 with `--mmproj`, on the M1 Max

Lab measurement for the question: **can the app add images (`--mmproj`, OpenAI
`image_url` data URIs, capability from `GET /props` → `modalities`) without
breaking what it already does** — the MTP drafter, slot paging, `--parallel`,
the tool loop. Every test ran the engine the app ships, with the app's own
flags, adding only `--mmproj` (and, where a test says so, the app's own
request shapes: `tools` from `chat/src/lib/tools/definitions.ts`,
`chat_template_kwargs.enable_thinking:false` from the thinking switch, slot
actions as `kalsa-door/src/paging/io.rs` sends them).

Machine: MacBookPro18,2, Apple M1 Max, 64 GiB, macOS 26.6.2 (Build 25G83).
Engine: `~/Library/Application Support/kalsa-brain/runtime/builds/metal/kalsa-server-v1.1.5/kalsa-server`,
run from its own directory (dylibs beside it); `GET /props` → `build_info:
"b11596-63a51b6d6"`. The owner's running app (ports 8130/8131) was not
touched; every lab server ran on 127.0.0.1:**8150**, one at a time, killed
after each test. All models were downloaded from huggingface.co only, into
`/tmp/lab-vision/models`, and **deleted at the end of this session** (see
Cleanup). Nothing was uploaded anywhere; no screenshots were taken. All
scratch (logs, payloads, raw responses) is in `/tmp/lab-vision/`.

## Setup

### Files (all sha256-measured after download; every curl EXIT=0)

| file | bytes | sha256 | provenance |
|---|---:|---|---|
| gemma-4-E4B-it-Q4_K_M.gguf | 4,977,171,584 | `85a896a047553e842f25297ee5b031d64ff30147d9c4af17b1e4b394cd1fab87` | `unsloth/gemma-4-E4B-it-GGUF@bfc15c38…` — **equals the catalog pin** (`manifest.rs` E4B row) |
| mtp-gemma-4-E4B-it-Q8_0.gguf | 98,653,280 | `f38ae62962657c7a6303c49bbb147e9ae23634e911cfa532fac0818c2e18b665` | `ggml-org/gemma-4-E4B-it-GGUF@b8093469…` — **equals the catalog pin** (E4B drafter) |
| mmproj-gemma-4-E4B-it-Q8_0.gguf | 559,874,816 | `197f49a93027f9843772bd24a6a9e0be2a32a788de5a3def330e9c585d86edd1` | same official `ggml-org/gemma-4-E4B-it-GGUF`, same commit as the drafter pin |
| LFM2.5-2.6B-Q8_0.gguf | 2,874,779,648 | `1e22128dfa128bdfb684da167e74e072d0a056baa7d06d9f280291e2839b0fc9` | `LiquidAI/LFM2.5-2.6B-GGUF@e7caca5d…` — **equals the catalog pin** |
| LFM2.5-VL-3B-Q8_0.gguf | 2,874,779,680 | `69b49ceddf61c65cce4a8938a0791c364a8d38cd2d87db2ca7ea359232a8b17e` | `LiquidAI/LFM2.5-VL-3B-GGUF@6f730e9a…` (official LiquidAI GGUF repo, repo sha recorded) |
| mmproj-LFM2.5-VL-3B-Q8_0.gguf | 583,109,984 | `ecbbe7097f696dba67172738d79c9f01132cdb6c0b457606315e268df3d67e64` | same repo, same commit |

```
curl -sL --fail --retry 3 -o <file> "https://huggingface.co/<repo>/resolve/<commit>/<file>"; echo EXIT=$?
shasum -a 256 <files>          # matches printed above
```

### Launch flags (the app's argv, `kalsa-launch/src/argv.rs`)

Base (Gemma, per test; deltas noted per test):

```
cd "$HOME/Library/Application Support/kalsa-brain/runtime/builds/metal/kalsa-server-v1.1.5"
./kalsa-server --host 127.0.0.1 --port 8150 \
  --model /tmp/lab-vision/models/gemma-4-E4B-it-Q4_K_M.gguf \
  --alias gemma-4-E4B-it-Q4_K_M \
  --batch-size 2048 --ubatch-size 512 \
  --ctx-size 65536 --parallel 1 \
  --flash-attn on --cache-type-k q8_0 --cache-type-v q8_0 \
  --temp 1.0 --top-p 0.95 --top-k 64 \
  --sleep-idle-seconds 300 --no-webui \
  --slot-save-path /tmp/lab-vision/slots --ctx-checkpoints 1 \
  [+ --mmproj /tmp/lab-vision/models/mmproj-gemma-4-E4B-it-Q8_0.gguf]
  [+ --model-draft /tmp/lab-vision/models/mtp-gemma-4-E4B-it-Q8_0.gguf
     --spec-type draft-mtp --spec-draft-n-max 3 --spec-draft-n-min 0
     --spec-draft-type-k q8_0 --spec-draft-type-v q8_0]
```

Drafter block = the renderer's exact sequence (`argv.rs`, `n_max` =
`DEFAULT_DRAFT_N_MAX` = 3). LFM rows swap the model and the row sampling
(`--temp 0.1 --top-k 50 --repeat-penalty 1.1`, no top-p). Deliberate
omissions, for the record: `--threads` and `--cache-ram` are tune-derived for
this machine and not readable from the repo, so they are not rendered (they
govern speed/memory, not vision behaviour); no `--device` (Metal gets none by
design); `--parallel 1 --ctx-size 65536` for single-seat tests (the app's
per-slot window), and the app's two-seat shape `--parallel 2 --ctx-size
131072` for the parallel test. Context checkpoints 1, as rendered. Requests
were non-streaming (the app streams; same accounting, but streamed
first-token latency is UNMEASURED).

### Test images (generated locally with PIL)

- `kalsa42.png`, 800×400: "KALSA 42" in 120 pt black Helvetica on white, red
  filled circle lower right, clear of the text. (First drawing accidentally
  covered the "42" with the circle — the model correctly reported "KALSA"
  only; image regenerated, test re-run. Harness bug, not an engine result.)
- `big-scene.png`, 3000×2000, 8.2 MB: RGB gradient + noise + 60 white oval
  outlines (photo-like for timing).

### Requests

`POST /v1/chat/completions`, OpenAI shape, `content: [{type:"text"...},
{type:"image_url","image_url":{"url":"data:image/png;base64,…"}}]`.
Correctness probes carry per-request `"temperature": 0` (llama-server
per-request override, the mechanism the app itself uses); speed probes and
Italian prompts use the row sampling. Every quoted number's request is saved
under `/tmp/lab-vision/logs/` with its exit code.

---

## Test 1 — `GET /props` → `modalities`

`curl -s http://127.0.0.1:8150/props > logs/props-*.json; echo EXIT=$?` (EXIT=0 both)

Without `--mmproj` (Gemma E4B base):

```json
"modalities": { "vision": false, "video": false, "audio": false }
```

With `--mmproj` (Gemma E4B + mmproj Q8_0):

```json
"modalities": { "vision": true, "video": true, "audio": true }
```

LFM2.5-VL-3B + its mmproj: `{ "vision": true, "video": true, "audio": false }`.

**GO.** Capability detection works exactly as planned: the flag is what flips
`modalities.vision`, and a chat can read it from `/props`. (Note: Gemma E4B
advertises video and audio too — untested, see UNMEASURED.)

## Test 2 — image turn, continuation, prompt-token cost

Reading probe (temp 0, `enable_thinking:false`), "Look at this image… exactly
what text… circle? color?":

```
curl -s --max-time 300 -X POST http://127.0.0.1:8150/v1/chat/completions \
  -H "Content-Type: application/json" -d @p-turn1.json ; echo EXIT=$?    # EXIT=0
```

Answer, verbatim: "1) **Exactly what text does it show, word for word?**
KALSA 42  2) … Yes, there is a circle in the image. It is **red**." — correct.
Continuation (same conversation, text-only): "Spell the number you saw, digit
by digit" → **"4 2"** — correct; `cache_n` 184, so the server reuses the
image turn's KV for the resent history (the app's own stateless-reshape
pattern works).

Prompt tokens (`usage.prompt_tokens` = `timings.prompt_n`), per
`--image-max-tokens` (fresh server each, same payloads):

| image | default (from model) | 280 | 560 |
|---|---:|---:|---:|
| kalsa42.png 800×400 | 189 | 189 | 189 |
| big-scene.png 3000×2000 | 1098 | 278 | 550 |

**GO.** The small image never reaches the caps; the caps bind only on large
images (default for 3000×2000 is >1098 tokens, so the app should consider
shipping a cap — 280 nearly halves a large image's prompt). Gemma 4 is a
thinking model: with the default (thinking on) a 300-`max_tokens` image turn
returned empty `content` and all reasoning in `reasoning_content` — token
budgets must include reasoning or the app's thinking switch must be used.

## Test 3 — MTP drafter ON vs OFF, same image turn

Same payload, cold slot, `--mmproj` both sides; ON adds the app's drafter
block (`--spec-draft-n-max 3`):

| | OFF | ON |
|---|---|---|
| answer | correct (KALSA 42, red) | **identical, correct** |
| decode tok/s (`predicted_per_second`) | 35.77 | **55.60** |
| predicted_n | 73 | 73 |
| prompt_ms | 658.5 | 702.7 |
| draft (`timings.draft_n` / `draft_n_accepted`) | — | 63 / **52 (82.5 %)** |
| crashes / errors / refused start | none | none |

**GO.** No condition. Vision does not disturb the MTP drafter; the image turn
decodes ~1.55× faster with it. (Acceptance measured at temp 0.)

## Test 4 — slot save → erase → restore with an image in the history

Server: mmproj **and** drafter (the app's daily shape). Engine routes as the
door sends them (`paging/io.rs` → `POST /slots/{id}?action=…`, body
`{"filename":…}` for save/restore):

```
curl -s -X POST "http://127.0.0.1:8150/slots/0?action=save"   -d '{"filename":"lab-gemma-vision.bin"}'   # SAVE_EXIT=0
curl -s -X POST "http://127.0.0.1:8150/slots/0?action=erase"                                                          # ERASE_EXIT=0
curl -s -X POST "http://127.0.0.1:8150/slots/0?action=restore" -d '{"filename":"lab-gemma-vision.bin"}'  # RESTORE_EXIT=0
```

- save: `{"id_slot":0,"n_saved":262,"n_written":12018152,"timings":{"save_ms":8.527}}`
  — **file 12,018,152 bytes** (`/tmp/lab-vision/slots/lab-gemma-vision.bin`).
- erase: `{"id_slot":0,"n_erased":262}`; restore: `{"n_restored":262,"n_read":12018152,"restore_ms":2.041}`.
- Continuation after restore (full history incl. image): **"4 2"** — correct.
  `cache_n` 184, `prompt_n` 108, `prompt_ms` 369.2.
- Cold run (erase, then the same continuation): **"4 2"**, `cache_n` 0,
  `prompt_n` 292, `prompt_ms` 944.2.

Restore re-processes 108 tokens instead of 292 (the image turn's 184-token
prefix rides the restored KV), 2.6 % of the file's 11.5 MiB re-read — the
same warm shape as the never-paged run earlier (prompt_n 108 / cache_n 184 /
370.7 ms). **GO.** Saved KV with image embeddings restores semantically
intact. (Door-level routes with private headers / device namespaces
UNMEASURED — engine routes only.)

## Test 5 — `--parallel 2`, concurrent image + text

`--parallel 2 --ctx-size 131072` (the app's two-seat plan on this Mac: 65 536
per slot) + mmproj + drafter. `total_slots: 2` in `/props`. Two simultaneous
non-streaming POSTs (image probe / "17×23"):

| slot | answer | prompt_n | decode |
|---|---|---:|---|
| image (slot 0) | correct (KALSA 42, red circle) | 189 | 55.6 tok/s |
| text (slot 1) | "391" — correct | 25 | 4.7 tok/s (interleaved with the image prefill; 4 tokens) |

Both HTTP 200, `CURL_EXIT=0` both, no cross-contamination (each slot answered
its own question). Server log errors: only two init-time lines about fitting
the drafter's context ("this warning is normal during memory fitting" per the
engine's own text). **GO.**

## Test 6 — image encode time: projector placement

Fresh server per config, cold slot per image, non-streaming; `prompt_ms`
from the response (the fork logs no separate encode line — it includes the
vision encode), wall = `curl -w %{time_total}`. Commands: `enc-run.sh` in
`/tmp/lab-vision` (base argv + the config's flags); every `CURL_EXIT=0`.

| config | small: prompt_ms (wall s) | large: prompt_ms (wall s) | decode tok/s small / large |
|---|---:|---:|---|
| Metal (default `--mmproj-offload`) | **640** (2.59) | **4 099** (5.29) | 37.1 / 39.7 |
| `--no-mmproj-offload` (projector on CPU) | 11 091 (13.02) | 17 517 (18.73) | 37.5 / 40.0 |
| CPU-only `-ngl 0 --no-mmproj-offload -t 4` | 3 976 (7.64) | 57 699 (59.87) | 19.7 / 18.8 |

Large image at default caps = 1098 prompt tokens here (test 2). Decode is
unaffected by projector placement (37→40 tok/s both GPU rows), as expected.

**GO-WITH-CONDITION: keep the projector on Metal.** The anomaly worth the
owner's attention: projector-on-CPU *beside a GPU model* was 2.8× slower than
the whole model on CPU at `-t 4` (11.1 s vs 4.0 s, small image) — plausibly
the CPU backend gets ~no threads when Metal is the main backend (UNMEASURED
mechanism). If `--no-mmproj-offload` is ever shipped, its thread behaviour
must be measured first. A CPU-only PC at 4 threads pays ~4 s per small image
and ~58 s per 3000×2000 image, and decodes at ~19 tok/s.

## Test 7 — Liquid LFM 2.5: text speed, tools, Italian, VL images

Base argv as above with the LFM row sampling; VL rows add the VL mmproj.
Text probe: "Write a 150-word summary of the history of Venice.",
`max_tokens` 200, row sampling; two runs per server (run 1 cold, run 2 warm
prefix).

### Text decode tok/s

| model | GPU | CPU `-ngl 0 -t 4` |
|---|---|---|
| LFM2.5-2.6B Q8_0 (catalog row) | 77.68 / 80.83 | 10.41 / 26.17 |
| LFM2.5-VL-3B Q8_0 + mmproj | 55.98 / 41.52 | 26.39 / 27.96 |

(GPU numbers consistent with the catalog's own llama-bench row: Q8_0 tg128
81.0/75.2.)

### Tool probe — the chat's exact `tools` body, `tool_choice:"auto"`, temp 0

10 prompts where `web_search` is the right call + 5 where none is (list in
`/tmp/lab-vision/tool-prompts.json`). The fork serves tool calls **without
`--jinja`** — the app's argv needs nothing added for tools; `chat_template_caps`
reports `supports_object_arguments: true`, `supports_parallel_tool_calls: true`.

| model | right tool choice | valid `web_search` JSON args | wrong calls (no-tool prompts) |
|---|---|---|---|
| LFM2.5-2.6B | **11/15** (10/10 search prompts) | **10/10** | N1 arithmetic, N3 capital, N4 translation, N5 plot summary → searched anyway; only N2 (haiku) abstained |
| LFM2.5-VL-3B | **13/15** (10/10 search prompts) | **10/10** | N2 haiku, N5 plot → searched; N1/N3/N4 answered directly |

All arguments were valid JSON objects with a non-empty `query` string (e.g.
`{"query":"most recent UEFA Champions League final winner score 2025 2026"}`).

**Condition: the over-calling is the finding.** With tools attached, both
models search for things they know (2.6B worse: 4/5 spurious). The chat needs
its own gate (tool off by default, or a classifier) — the model will not
restrain itself.

### Italian (3 prompts, row sampling temp 0.1, `max_tokens` 2000) — verbatim, no verdict

LFM2.5-2.6B (thinking ON by default — `reasoning_content` non-empty on all
three; first pass at `max_tokens` 400 left two answers empty, re-run with
headroom):

1. Q: "Spiega in due frasi cos'è la fotosintesi."
   > La fotosintesi è il processo attraverso cui le piante e altri organismi convettori trasformano l'energia luminosa in energia chimica. Utilizzando anidride carbonica e acqua, producono glucosio come cibo e rilasciano ossigeno nell'atmosfera.
2. Q: "Traduci in inglese: 'Il treno delle otto ha dieci minuti di ritardo'."
   > La traduzione più diretta e naturale è:
   > **"The eight o'clock train has a ten-minute delay."**
   > Un'altra opzione comune, spesso usata nel linguaggio quotidiano, è:
   > **"The 8am train is ten minutes late."**
3. Q: "Scrivi una breve email di ringraziamento a un cliente per il suo ordine."
   > Ecco una proposta di email professionale e cortese. Puoi personalizzare i campi tra parentesi quadre `[...]`.
   >
   > **Oggetto:** Ordine #[Numero] - Grazie per la tua fiducia
   >
   > Gentile [Nome del Cliente],
   >
   > Vi ringraziamo sinceramente per l'ordine effettuato presso la nostra azienda.
   >
   > Siamo lieti di aver ricevuto il tuo ordine e sappiamo che è stato un piacere poter servire i tuoi bisogni. Stiamo lavorando ora per preparare il tuo pacco e ti invieremo immediatamente il tracking per la spedizione.
   >
   > Grazie ancora per la fiducia che ci hai riposto.
   >
   > Cordiali saluti,
   >
   > [Tuo Nome]
   > [Tua Posizione]
   > [Nome Azienda]
   >
   > ---
   >
   > **Consigli per l'utilizzo:**
   > *   **Se l'ordine è già stato spedito:** Puoi aggiungere una frase come *"Il tuo ordine è in viaggio e ti aspettiamo!"*.
   > *   **Se vuoi un tono più informale:** Sostituisci "Gentile" con "Ciao [Nome]" e "Cordiali saluti" con "Un caro saluto".

LFM2.5-VL-3B (no reasoning by default):

1. > La fotosintesi è il processo attraverso cui le piante e altri organismi utilizzano l'energia solare per trasformare anidride carbonica e acqua in glucosio, un tipo di zucchero che fornisce energia. In questo processo, la clorofilla assorbe la luce del sole, permettendo alla materia organica di essere prodotta e rilasciando ossigeno come sottoprodotto.
2. > La traduzione più naturale è:
   >
   > **"The eight o'clock train is ten minutes late."**
   >
   > Altre opzioni possibili, a seconda del contesto:
   > *   "The 8 AM train is running ten minutes behind schedule."
   > *   "The train at 8 has a ten-minute delay."
3. > Ecco una proposta di email professionale e cortese:
   >
   > **Oggetto:** Ringraziamento per il vostro ordine
   >
   > Ciao [Nome del Cliente],
   >
   > grazie mille per l'ordine! Siamo molto contenti che la vostra esperienza sia stata positiva.
   >
   > Se avete bisogno di qualsiasi assistenza o avete domande, non esitate a contattarci.
   >
   > Un saluto cordiale,
   >
   > [Il Tuo Nome]

### VL-3B image turns, CPU-only (`-ngl 0 -t 4 --no-mmproj-offload`)

| image | wall s | prompt_n | prompt_ms | decode tok/s | reads KALSA 42 + red circle? |
|---|---:|---:|---:|---:|---|
| kalsa42.png | 5.27 | 295 | 4 451 | 31.8 | **yes, correct** |
| big-scene.png | 33.87 | 1808 | 31 960 | 25.6 | (describe-only probe) |

**GO-WITH-CONDITION.** VL-3B is the only vision option among the Liquid rows
and it works on CPU, but a 3000×2000 image costs ~34 s wall on 4 CPU threads
— size/cap images before sending on slow machines. LFM 2.5 2.6B remains
text-only (no mmproj exists for it in the official repo); its thinking-by-default
must be budgeted for in `max_tokens`.

## Test 8 — Qwen 3.5: does an mmproj exist for the pinned row?

Catalog row (`manifest.rs` research table): repo `Qwen/Qwen3.5-4B`, quant
Q4_K_M — a CATALOG row only, no DOWNLOADABLE entry, so no GGUF file is pinned
at all. Checks against huggingface.co (no download, per instructions):

- `GET /api/models/Qwen/Qwen3.5-4B/tree/main`: safetensors only —
  `model.safetensors-00001-of-00002.safetensors` 5,329,398,688 B,
  `…00002…` 3,990,429,408 B, plus tokenizer/config files and
  `preprocessor_config.json` + `video_preprocessor_config.json`.
  `config.json`: `architectures: ["Qwen3_5ForConditionalGeneration"]`, with
  `vision_config`, `image_token_id`, `video_token_id` — **the upstream model
  is multimodal**.
- No `mmproj*` and no `*.gguf` file anywhere in the repo; the HF repo search
  for `Qwen3.5` under author Qwen lists main/FP8/GPTQ repos only — **Qwen
  publishes no GGUF and no mmproj for Qwen 3.5**.

**NO-GO (for vision on this row as pinned).** There is no mmproj to name and
no size to record: a Qwen 3.5 vision launch would require a third-party GGUF
conversion the catalog has not pinned, which the app's rules exclude. The
upstream multimodality means a pinned conversion could exist later; until
then the row stays text-only.

---

## Failures and deviations (nothing papered over)

1. First `kalsa42.png` drew the circle over the "42"; the model correctly
   said "KALSA" only. Image regenerated, test re-run. (Harness bug.)
2. First image-turn run used thinking-default + `max_tokens` 300: `content`
   empty, everything in `reasoning_content`, `finish_reason: "length"`. All
   later Gemma correctness probes send the app's own
   `chat_template_kwargs.enable_thinking:false`; speed probes keep row
   sampling.
3. LFM 2.6B Italian first pass (`max_tokens` 400): answers 2 and 3 empty —
   consumed by thinking. Re-run at 2000 (`EXIT=0`), verbatim above; the empty
   first pass is itself the recorded finding for token budgets.
4. `enc-run.sh` first attempt passed a relative log path into `serve.sh`,
   which `cd`s to the engine directory; the output redirect failed, no server
   started, `NOT HEALTHY after 300s`. Fixed to absolute paths; the three
   recorded enc runs all healthy.
5. One `config.json` fetch without `-L` failed to parse (redirect body);
   retried with `-L`, EXIT=0.

## UNMEASURED

- Door-level paging (private `x-kalsa-slot` headers, device namespaces,
  staging-rename dance) — engine routes only; the door is a thin relay
  (`paging/io.rs`).
- Streaming latency (app streams with `return_progress`); all runs
  non-streaming.
- Video and audio turns (Gemma E4B advertises `video`/`audio` true);
  `--video-fps` exists in the build but nothing was exercised.
- The CPU-projector thread mechanism behind test 6's anomaly.
- Draft acceptance on long text generations, cold-boot/thermal variation,
  mmproj Q8_0 vs BF16 quality, `--image-min-tokens`.
- Italian quality — the owner judges; answers above are verbatim.

## Cleanup

The six downloaded model files were deleted at the end of this session
(`rm /tmp/lab-vision/models/*.gguf` and the directory, `EXIT=0`, `ls`
confirmed empty) together with the saved slot state
(`/tmp/lab-vision/slots/`). Logs, payloads and images remain in
`/tmp/lab-vision/` as the only record; nothing left this machine except the
huggingface.co downloads above. No repo file was touched except this one.
