# LAB GEMMA AUDIO + VIDEO — 2026-10-04 — Gemma 4 E4B/E2B audio turns and video-as-frames, on the M1 Max

Lab measurement for the question: **can the app accept voice notes
(`input_audio` data URIs, decoded inside llama.cpp) and keep sending videos as
still frames, on the Gemma 4 rows whose mmproj advertises
`modalities.audio`?** — correctness, token cost per second of audio, prefill
time, the MTP drafter's interaction with audio, slot save/restore of an audio
chat, CPU-only behaviour (the slow-PC case), and 4-frame vs 1-frame video.

Machine: MacBookPro18,2, Apple M1 Max, 64 GiB, macOS 26.6.2 (Build 25G83).
Engine: `~/Library/Application Support/kalsa-brain/runtime/builds/metal/kalsa-server-v1.1.5/kalsa-server`
— the newest build dir beside it (there is only `kalsa-server-v1.1.5`; the
`.kalsa-build` marker names tar `…v1.1.5-bin-macos-arm64…`, exe sha
`8958c829…`), run from its own directory; `GET /props` → `build_info:
"b11596-63a51b6d6d"`. The owner's running app (engine 8130, door 8131, read
from `~/Library/Logs/ai.kalsa.brain/kalsa-brain.log`) was not touched,
stopped or queried; every lab server ran on 127.0.0.1:**8150**, one at a
time, killed after its test (verified stopped, port free, at the end). All
downloads were from huggingface.co only, into `/tmp/lab-av/models`, and
**deleted at the end of this session** (see Cleanup). All scratch (logs,
payloads, raw responses, server logs) is in `/tmp/lab-av/`. No repo code was
changed; this doc is the only repo file written.

## Setup

### Files (all sha256-measured after download; every curl EXIT=0)

| file | bytes | sha256 | provenance |
|---|---:|---|---|
| gemma-4-E4B-it-Q4_K_M.gguf | 4,977,171,584 | `85a896a047553e842f25297ee5b031d64ff30147d9c4af17b1e4b394cd1fab87` | `unsloth/gemma-4-E4B-it-GGUF@bfc15c38…` — **equals the catalog pin** (`manifest.rs` E4B row) |
| mtp-gemma-4-E4B-it-Q8_0.gguf | 98,653,280 | `f38ae62962657c7a6303c49bbb147e9ae23634e911cfa532fac0818c2e18b665` | `ggml-org/gemma-4-E4B-it-GGUF@b8093469…` — **equals the catalog pin** (E4B drafter) |
| mmproj-gemma-4-E4B-it-Q8_0.gguf | 559,874,816 | `197f49a93027f9843772bd24a6a9e0be2a32a788de5a3def330e9c585d86edd1` | same official repo/commit — **equals the catalog pin** (E4B mmproj) |
| gemma-4-E2B-it-Q8_0.gguf | 4,967,497,152 | `996d08777aadc6bfd3c7375ef70ba25a0f55240075860754fdb18d6d860aa63a` | `ggml-org/gemma-4-E2B-it-GGUF@b4243c15…` (repo HEAD via the HF API; E2B is a research row — no catalog pin, so the file is recorded here) |
| mmproj-gemma-4-E2B-it-Q8_0.gguf | 557,368,064 | `9406f99c16d68cda4f1f0552192dcc99021ea1fc6d2fd50b1dc3ccf30d04b292` | same repo/commit |
| mtp-gemma-4-E2B-it-Q8_0.gguf | 97,817,696 | `c4fba8d43b40c9fab8c3db15ca6ef00fd28192208753f1f038269c176437068a` | same repo/commit |

Every digest equals the `x-linked-etag` the resolve URL served (`curl -sIL`,
`/tmp/lab-av/logs/headers.txt`, EXIT=0).

### Launch flags (the app's argv, `kalsa-launch/src/argv.rs`)

Base (E4B shown; E2B swaps the two files and keeps the same Gemma sampling —
the E2B research row in `manifest.rs` carries the same temp 1.0 / top-p 0.95
/ top-k 64):

```
cd "$HOME/Library/Application Support/kalsa-brain/runtime/builds/metal/kalsa-server-v1.1.5"
./kalsa-server --host 127.0.0.1 --port 8150 \
  --model /tmp/lab-av/models/gemma-4-E4B-it-Q4_K_M.gguf \
  --alias gemma-4-E4B-it-Q4_K_M \
  --threads 4 --threads-batch 4 --batch-size 2048 --ubatch-size 512 \
  --ctx-size 65536 --parallel 1 \
  --flash-attn on --cache-type-k q8_0 --cache-type-v q8_0 \
  --temp 1.0 --top-p 0.95 --top-k 64 \
  --mmproj /tmp/lab-av/models/mmproj-gemma-4-E4B-it-Q8_0.gguf --image-max-tokens 560 \
  --model-draft /tmp/lab-av/models/mtp-gemma-4-E4B-it-Q8_0.gguf --spec-type draft-mtp \
  --spec-draft-n-max 3 --spec-draft-n-min 0 --spec-draft-type-k q8_0 --spec-draft-type-v q8_0 \
  --sleep-idle-seconds 300 --no-webui \
  --slot-save-path /tmp/lab-av/slots --ctx-checkpoints 1 \
  > /tmp/lab-av/logs/server-X.log 2>&1 &      # then: echo EXIT=$? per request
```

Six servers, one at a time on 8150: **A** E4B Metal+mmproj+drafter · **B**
E4B Metal+mmproj, no drafter · **C** E4B CPU (`--n-gpu-layers 0`, otherwise
identical to B) · **D** E2B Metal+mmproj+drafter · **E** E2B Metal+mmproj,
no drafter · **F** E2B CPU. Six launches, six clean kills; each request ran
as `curl -s --max-time … -X POST …/v1/chat/completions -H
'Content-Type: application/json' -d @payload.json -o resp.json` behind
`/usr/bin/time -p`, EXIT recorded for every call (all 0 unless quoted). The
slot was erased (`POST /slots/0?action=erase`, the door's own route) before
every timed turn so `cache_n` is 0 and prefill is cold — except where the
test itself was the restore flow. Requests non-streaming, temp 0,
`chat_template_kwargs.enable_thinking:false`, `max_tokens` 100–300.

Note on CPU mmproj placement: this build has **no `--no-mmproj-offload`
flag** (`--help` lists none; the brief's spelling was tried against the
docs, the flag does not exist here). With `--n-gpu-layers 0` the load log
shows `llama threadpool init, n_threads = 4` and no Metal/device lines at
all, so the projector rode the CPU placement too (inferred from the log; no
explicit projector-placement line exists). Both CPU runs also print the
engine's own caveat at load: *"init_audio: audio input is in experimental
stage and may have reduced quality"* (llama.cpp discussion 13759) — printed
by the Metal runs too.

### Audio and video material (all synthesized on this Mac)

- `say -v Alice` (it_IT) / `say -v Samantha` (en_US) → `afconvert -f WAVE -d
  LEI16@16000 -c 1` (WAV 16 kHz mono, the shape the engine's audio path is
  built for):
  - `it10.wav` 8.135 s — "Il treno per Milano parte alle diciotto e trenta
    dal binario sette. Ricorda di convalidare il biglietto prima di salire a
    bordo, e buona giornata."
  - `en10.wav` 5.898 s — "The weather tomorrow will be sunny with a high of
    twenty two degrees, and light winds from the north east after lunch."
  - `it60.wav` 57.896 s — 14 Italian sentences with checkable facts (Milano
    18:30 binario 7 · Torino 9:15 binario 3, arrivo 12:30 · volo Roma 21:10
    · riunione venerdì 15 quarto piano · gatto Pluto 8 anni · film 22:30 ·
    …).
- **MP3: UNMEASURED.** This Mac has no MP3 encoder — no `ffmpeg`, no `lame`,
  and `afconvert -hf` lists no MP3 output format — so no MP3 (or FLAC) clip
  could be produced. The engine's MP3/FLAC decode paths are untested; WAV is
  the only measured container.
- Video: ffmpeg absent, so frames were drawn with PIL — `counter.gif`, 10 s
  at 10 fps, 640×360: a large counter 1→10 (one number per second) and an
  orange ball moving left→right. Frames extracted at gif indices 0/33/66/99
  → `frame1..4.jpg` (counters **1, 4, 7, 10**; ball x ≈ 40/227/413/600).

## Item 1 — AUDIO turns (E4B, server A: Metal + mmproj + drafter)

### The request shape that works

The door's exact accepted shape (`kalsa-door/src/tests/media_guard.rs:55`)
was sent, and the engine accepted **both** spellings of `data`:

```json
{"type":"input_audio","input_audio":{"data":"data:audio/wav;base64,<payload>","format":"wav"}}
{"type":"input_audio","input_audio":{"data":"<raw base64>","format":"wav"}}
```

Both answered identically and correctly (the raw form's run hit the slot's
prefix cache: `cache_n 230`, the door's data-URI form is the one to keep).

### Results (every row: cold slot, EXIT=0, wall from `/usr/bin/time -p`)

| turn | answer (verbatim) | correct? | prompt_n | prompt_ms | prefill tok/s | decode tok/s | drafter acc | wall s |
|---|---|---|---:|---:|---:|---:|---|---:|
| it10 transcription | "Il treno per Milano parte alle 18:30 dal binario 7. Ricorda di convalidare il biglietto prima di salire a bordo e buona giornata." | verbatim¹ | 222 | 654 | 338 | 55 | 27/33 | 1.36 |
| it10 "A che ora parte il treno?" | "Il treno per Milano parte alle 18:30 dal binario 7." | ✅ | 235 | 930 | 253 | 43.3 | 12/21 | 1.39 |
| en10 transcription | "The weather tomorrow will be sunny with a high of 22 degrees and light winds from the northeast after lunch." | verbatim¹ | 165 | 609 | 270 | 54 | 16/21 | 1.05 |
| en10 "What will the weather be?" | "The weather tomorrow will be sunny with a high of 22 degrees and light winds from the northeast after lunch." | ✅ | 172 | 559 | 307 | 62 | 18/18 | 0.94 |
| it60 transcription | 14 sentences, 295 tokens out | near-verbatim² | 1466 | 3129 | 468 | 58 | 210/252 | 8.25 |
| it60 "treno per Milano? e per Torino?" | "Il treno per Milano parte alle 18:30 e quello per Torino alle 9:15." | ✅ | 1488 | 3137 | 474 | 49 | 16/24 | 3.70 |
| it60 "Come si chiama il gatto…?" | "Il gatto del vicino si chiama Pluto e ha otto anni." | ✅ | 1479 | 3082 | 479 | 53 | 10/12 | 3.41 |

¹ "verbatim" up to numeral normalization ("diciotto e trenta" → "18:30",
"twenty two" → "22", "north east" → "northeast").
² three word-level slips in 295 tokens: "alle quindici" → "alle **15:15**",
"richiamarlo" → "chiamarlo", "il pacco dalla libreria" → "della libreria".
Every checkable fact correct.

Text-only control (same question, no audio part): `prompt_n 29` — so the
8.1 s clip itself costs ≈ **206 tokens**; the 57.9 s clip ≈ **1459 tokens**
(1466 minus its ~7-token question). **Audio tokenizes at 25–27 tokens per
second of audio** (25.2 on the 58 s clip, 26.4 and 27.0 on the 10 s clips)
— the same rate on E2B (identical `prompt_n`), so it is the Gemma 4 audio
tokenizer's property, not the quant's. A voice note therefore prices like
text at ~26 tok/s: a 60 s note is ~1.5 k tokens, ~2 % of the 65 536-token
window; three 60 s notes still leave 93 % of the context.

**GO** (WAV, Metal). Transcription near-verbatim, comprehension correct in
both languages, answers in the clip's language as asked, ~1 s wall for a
10 s note, 3.7 s for a 58 s note.

## Item 2 — MTP drafter on/off, and slot save → erase → restore (E4B)

### Drafter OFF (server B, identical minus the drafter block)

| turn | OFF decode tok/s | ON decode tok/s | answers |
|---|---:|---:|---|
| it10-q (20 tok out) | 38 | 43.3 | identical, correct |
| it10-tr (39 tok out) | 38 | 55 | byte-identical transcription |
| it60-tr (295 tok out) | 41 | 58 | byte-identical, including the same 15:15 slip |
| it60-q (25 tok out) | 41 | 49 | identical, correct |
| video4 (143 tok out) | 37 | 40 | both correct |

Prefill is unchanged (audio encode dominates it: 3.03 s vs 3.13 s on it60).
**GO** — audio does not disturb the drafter (acceptance 79–84 % on long
outputs); the speedup is the usual 1.1× on short answers, 1.4–1.45× on the
295-token transcription.

### Slot save → erase → restore → follow-up (server A, door's routes)

Audio turn (it10-q) completes → save → erase → restore → follow-up
"E da quale binario parte?" with the full audio history re-sent:

```
curl -s -X POST "http://127.0.0.1:8150/slots/0?action=save"   -d '{"filename":"lab-av-a3.bin"}'  # EXIT=0
curl -s -X POST "http://127.0.0.1:8150/slots/0?action=erase"                                                           # EXIT=0
curl -s -X POST "http://127.0.0.1:8150/slots/0?action=restore" -d '{"filename":"lab-av-a3.bin"}'  # EXIT=0
```

- save: `{"id_slot":0,"n_saved":254,"n_written":12775712,"timings":{"save_ms":10.042}}`
  (12,775,712-byte file) · erase `{"n_erased":254}` · restore
  `{"n_restored":254,"n_read":12775712,"timings":{"restore_ms":2.269}}`.
- Follow-up after restore: **"Sette."** — correct, and **warm**:
  `cache_n 230`, `prompt_n 51`, `prompt_ms 256`, wall 0.40 s — the same
  numbers as the never-paged warm continuation (230/51/253 ms), and against
  the cold control (erase, then follow-up: `cache_n 0`, `prompt_n 281`,
  824 ms). The audio embeddings ride the saved KV and come back reusable.

A measurement trap, recorded so it is not repeated: the first
follow-up-after-restore run printed `cache_n 0` because the harness erased
the slot *between restore and request* — the restore was never given a
chance. The identical-payload replay after restore (`cache_n 230`,
`prompt_n 5`) exposed the harness, and the corrected run above is the real
result. **GO.**

## Item 3 — CPU-only audio (E4B, server C: `--n-gpu-layers 0`, `-t 4`)

| turn | answer | prompt_ms | prefill tok/s | decode tok/s | wall s |
|---|---|---:|---:|---:|---:|
| it10-q (8.1 s clip) | "Il treno per Milano parte alle 18:30 dal binario 7." ✅ | 3460 | 68 | 22 | 4.33 |
| it60-q (57.9 s clip) | "Il treno per Milano parte alle 18:30 e quello per Torino alle 9:15." ✅ | 24622 | 60 | 20 | 25.89 |

**GO-WITH-CONDITION** (slow-PC estimate). CPU audio works and stays correct,
but prefill runs at ~60–68 tok/s on this Mac's 4 performance cores — 3.5 s
for a 10 s note, 24.6 s for a 58 s note. A slow PC (2–3× slower cores than
an M1 Max P-core set) lands a 60 s voice note at roughly 50–75 s of prefill
— unusable as a chat rhythm; ≤30 s voice notes are the honest CPU gate for
an E4B-class row, and E2B (below) is the better CPU story.

## Item 4 — VIDEO AS FRAMES (E4B, server A) — the app's way

Four evenly spaced `image_url` JPEG data URIs in one user turn, "What
happens in this video?":

> "This video is a simple **countdown or counter display**. … 1. Frame 1:
> The number **1** … 2. … the number changes to **4**. 3. … changes to
> **7**. 4. … changes to **10**. … The numbers are increasing in increments
> of three across the frames."

The answer **describes the change across frames** — it read the counter
sequence and even abstracted the step. The moving ball was noticed only as
"a small orange circle in the bottom corners" (position change across
frames not narrated). One frame only:

> "…a large, white numeral **"1"** … a solid orange circle … in the bottom
> left corner…" — a static description, no change to report (correct
> behaviour for one frame).

| | prompt_n | prompt_ms | decode tok/s | wall s |
|---|---:|---:|---:|---:|
| 4 frames (640×360 each) | 460 | 1632 | 40 | 5.22 |
| 1 frame | 132 | 522 | 41 | 4.39 |

≈ **105 tokens per 640×360 JPEG frame** (460 − ~40 question / 4; and 132 −
~27), far under the 560 `--image-max-tokens` bound — a 4-frame video turn
costs ~420 vision tokens, cheaper than 20 s of audio. **GO** — the
frames-as-images path already shipping for photos carries video summaries;
4 frames beat 1 exactly as designed (change vs no change).

## Item 5 — `GET /props` → `modalities`

`curl -s http://127.0.0.1:8150/props` (EXIT=0 both):

```json
E4B + mmproj Q8_0:  "modalities": { "vision": true, "video": true, "audio": true }
E2B + mmproj Q8_0:  "modalities": { "vision": true, "video": true, "audio": true }
```

**GO.** Both Gemma 4 rows advertise audio honestly (the audio turns above
ran on exactly these launches), so gating media on `/props` works for the
E2B research row as it does for E4B.

## E2B repeat (Q8_0 — the research row's file, recorded in Setup)

Server D (Metal + mmproj + drafter), same payloads:

| turn | answer | correct? | prompt_n | prompt_ms | prefill tok/s | decode tok/s | drafter acc | wall s |
|---|---|---|---:|---:|---:|---:|---|---:|
| it10 transcription | same verbatim text as E4B | verbatim¹ | 222 | 376 | 590 | 103 | 28/30 | 0.76 |
| it10 comprehension | "Il treno per Milano parte alle 18:30 dal binario 7." | ✅ | 235 | 356 | 659 | 74 | 12/21 | 0.63 |
| en10 transcription | same verbatim text as E4B | verbatim¹ | 165 | 302 | 545 | 93 | 17/21 | 0.57 |
| en10 comprehension | same correct answer as E4B | ✅ | 172 | 302 | 568 | 108 | 18/18 | 0.53 |
| it60 transcription | 293 tokens out | near-verbatim² | 1466 | 1657 | 884 | 103 | 210/249 | 4.56 |
| it60 two-train question | "Il treno per Milano parte alle 18:30 dall'abinario 7 e quello per Torino alle 9:15 dall'abinario 3." | ✅ facts, one spelling slip³ | 1488 | 1672 | 889 | 87 | 24/36 | 2.17 |
| it60 cat question | "Il gatto del vicino si chiama Pluto e ha otto anni." | ✅ | 1479 | 1657 | 892 | 91 | 9/12 | 1.88 |

² slips: "della libreria" for "dalla", "chiamarlo" for "richiamarlo" — but
"alle quindici" correctly as "15:00" where E4B wrote "15:15".
³ "dall'**abinario**" for "dal binario" — a fused non-word; the facts
(18:30, 9:15, both binari) are right.

- Drafter OFF (server E): decode 50 / 50 / 55 tok/s on it10-q / it10-tr /
  it60-q against 74 / 103 / 87 ON — **1.5–2× speedup**, answers identical
  (including the same "abinario" slip; temp 0 determinism).
- Save → erase → restore → follow-up: `n_saved 254`, file 4,006,024 bytes,
  restore 0.906 ms; follow-up **"Sette."** correct, warm `cache_n 230`,
  `prompt_n 51`, wall 0.27 s. Same GO as E4B.
- CPU-only (server F, `--n-gpu-layers 0`, `-t 4`): it10-q correct, prefill
  1511 ms (155 tok/s), wall 2.14 s; it60-q correct (same slip), prefill
  12353 ms (120 tok/s), wall 13.75 s. **GO-WITH-CONDITION, milder than
  E4B**: E2B on CPU prefills audio at ~2× E4B's rate — a 60 s note costs
  ~12 s here, so a slow-PC estimate of ~25–40 s for a minute of audio;
  ≤30 s notes stay comfortable, and a minute is survivable.

## Verdicts

| item | verdict |
|---|---|
| 1 — audio, WAV, Metal | **GO** (both rows). ~26 tokens per second of audio; 10 s note ≈ 0.6–1.4 s wall; 58 s note ≈ 2.2–3.7 s wall; transcription near-verbatim, comprehension correct in IT and EN. MP3/FLAC **UNMEASURED** (no encoder on this Mac). |
| 2 — drafter + slot save/restore | **GO** (both rows). Identical outputs on/off; drafter 1.1–1.45× (E4B) and 1.5–2× (E2B) on audio-answer decode; save/erase/restore round-trips an audio chat warm (230 of 281 tokens reused, correct follow-up). |
| 3 — CPU-only | **GO-WITH-CONDITION.** Correct everywhere; E4B CPU ≈ 60–68 prefill tok/s (60 s note ≈ 25 s here, ~50–75 s on a slow PC) — gate CPU voice notes at ≤30 s for E4B; E2B CPU ≈ 120–155 tok/s (60 s ≈ 12 s here) is the CPU-friendly row. |
| 4 — video as frames | **GO.** 4 frames → the model narrates the change (counter 1→4→7→10, "increments of three"); ≈105 tokens per 640×360 frame, 4-frame turn 460 tokens / 1.6 s prefill (E4B). 1 frame → static-only answer, as expected. |
| 5 — /props modalities | **GO.** E4B and E2B with their mmproj both report `vision/video/audio: true`, and the audio turns prove the claim. |

## UNMEASURED (explicitly)

- **MP3 / FLAC containers** — no encoder exists on this Mac (no ffmpeg, no
  lame, `afconvert -hf` has no MP3 format); only WAV was measured. The
  engine's MP3/FLAC decode path and the door's `data:audio/mpeg` /
  `data:audio/flac` acceptance are untested claims.
- **Real speech** — every clip is macOS TTS (clean, single speaker, no
  noise). Accent, crosstalk, music, phone-mic compression: UNMEASURED.
- **Streaming first-token latency** — requests were non-streaming; the app
  streams. Same accounting, but ttft is not quoted.
- **Native video parts** — refused by the door by design (the engine shells
  out to ffmpeg, absent here); only the frames path was measured.
- **Door-level pass-through of `input_audio`** — measured engine-side with
  the door's exact accepted JSON shape; the door binary itself was not
  proxied through (its media guard was read only).
- **`--no-mmproj-offload`** — the flag does not exist in this build; CPU
  projector placement is inferred from the load log (threadpool 4, no Metal
  lines), not from an explicit placement line.
- **Large-image clamping under `--image-max-tokens 560` with audio present**
  — our frames cost ~105 tokens each; the clamp's resizing behaviour was
  not exercised.

## Cleanup

```
rm -rf /tmp/lab-av/models; echo EXIT=$?    # EXIT=0 — all six GGUF downloads deleted
```

All scratch (payloads, responses, server logs, timings) remains in
`/tmp/lab-av/` and `/tmp/lab-av/slots/` (two small .bin checkpooints). No
repo file changed except this doc; nothing committed, pushed or tagged. The
owner's app on 8130/8131 was never touched, stopped or sent a request by
the lab — one read-only `GET /health` to 8130 slipped into the final
cleanup verification (exit 0, no state change); it is the only contact.
