# Slot save / restore cost — measured on the published engine (v1.1.0, commit `2a290390d`)

Host-only measurement on this Mac (Apple M1 Max, 64 GB, macOS 26.6.2). No phones, no repo
writes outside this report; every artefact lives under `/tmp/kalsa-measure/`. The server was
always run in the background with a log file, and every HTTP call was wrapped in
`perl -e 'alarm shift; exec @ARGV' <secs> ...` because macOS has no `timeout(1)`.

## Engine and invocation

- Binary: `/Users/marco/Library/Application Support/kalsa-brain/runtime/builds/metal/kalsa-server-v1.1.0/kalsa-server`
  - `--version` → `version: 0.4.1-dev (build 11187, commit 2a290390d)` / `built with AppleClang 21.0.0.21000101 for Darwin arm64` — the published v1.1.0.
- Model: `/Users/marco/Library/Application Support/kalsa-brain/runtime/models/Trinity-Nano-Preview-Q4_K_M.gguf`,
  **3,786,957,088 bytes** (3.52 GiB, 4.94 BPW, architecture `afmoe`, 56 layers).
- Exact command line (working dir `/tmp/kalsa-measure/server`, log redirect shown):

```
"/Users/marco/Library/Application Support/kalsa-brain/runtime/builds/metal/kalsa-server-v1.1.0/kalsa-server" \
  -m "/Users/marco/Library/Application Support/kalsa-brain/runtime/models/Trinity-Nano-Preview-Q4_K_M.gguf" \
  --host 127.0.0.1 --port 8391 -c 16384 -np 1 --slots \
  --slot-save-path /tmp/kalsa-measure/slots -lv 4 \
  >> /tmp/kalsa-measure/server/server.log 2>&1 &
```

Flag spellings, quoted from the binary's own `--help` (`/tmp/kalsa-measure/help.txt`):

- `-c, --ctx-size N`
- `-np, --parallel N` — "number of server slots (default: -1, -1 = auto)"
- `--slots, --no-slots` — "expose slots monitoring endpoint (default: enabled)"
- `--slot-save-path PATH` — "path to save slot kv cache (default: disabled)"
- `-lv, --verbosity, --log-verbosity N` — default 3; I used 4 (trace)
- `-m, --model`, `--host`, `--port`

Two spelling traps, both hit and recorded:

1. **`--slots` is not the slot count.** It only exposes the `/slots` monitoring endpoint, and it
   is already the default. The number of slots is `-np/--parallel 1`. What actually enables the
   save/restore actions is `--slot-save-path`; without it the server answers
   `This server does not support slots action. Start it with \`--slot-save-path\``.
2. **The save/restore route needs a JSON body, not just query parameters.** `POST /slots/0?action=save`
   with `-d '{"filename":"ctx16k.bin"}'` works. With the filename only in the query string and no
   body it fails — HTTP 500,
   `{"error":{"code":500,"message":"[json.exception.parse_error.101] parse error at line 1, column 1: attempting to parse an empty input; check that your input string or stream contains the expected JSON","type":"server_error"}}`,
   and no file is written.

Engine startup facts (from `server/server.log`):

```
llama_model_loader: ... general.architecture str = afmoe
print_info: file size   = 3.52 GiB (4.94 BPW)
print_info: n_layer     = 56
llama_context: n_ctx    = 16384
llama_context: n_batch  = 2048
llama_kv_cache: size = 224.00 MiB (16384 cells, 14 layers, K (f16) 112.00 MiB, V (f16) 112.00 MiB)
llama_kv_cache_iswa: creating SWA KV cache, size = 2560 cells ... 105.00 MiB (42 layers)
srv load_model: initializing, n_slots = 1, n_ctx_slot = 16384, kv_unified = 'false'
srv load_model: context checkpoints enabled, max = 32, min spacing = 8192
srv load_model: un-salted requests share one namespace
```

## Context used for the save

Built with one completion request: prompt = 620 deterministic "field journal" entries
(14,111 tokens by `POST /tokenize`), `n_predict 2000`, `temperature 0`, `cache_prompt true`,
`stream false`.

```
POST /completion  ->  http=200  wall=37.507514 s
tokens_evaluated 14111   tokens_predicted 2000   stop_type "limit"
timings: prompt_n 14111, prompt_ms 9438.734 (1495.0 tok/s), predicted_n 2000, predicted_ms 28026.361 (71.33 tok/s)
GET /slots -> [{"id":0,"n_ctx":16384,"is_processing":false,"n_prompt_tokens":16110, ...}]
```

The slot holds **16,110 tokens** (~16k) when saved.

## 1. What the save creates, and how big

```
POST /slots/0?action=save    body {"filename":"ctx16k.bin"}
-> http=200  wall=0.662592 s
{"id_slot":0,"filename":"ctx16k.bin","n_saved":16110,"n_written":495529160,"timings":{"save_ms":661.956}}
```

Directory listing after the save — **one file per save**:

```
-rw-r--r--  1 marco  wheel  495529160  ctx16k.bin
```

The three timed saves each created exactly one file (`save_1.bin`, `save_2.bin`, `save_3.bin`),
each 495,529,160 bytes, and all four are byte-identical:

```
3b98a076e4e5f095e4243ef4c151aa6056dd7fbd697f8178c7bda3799ffcef49  ctx16k.bin
3b98a076e4e5f095e4243ef4c151aa6056dd7fbd697f8178c7bda3799ffcef49  save_1.bin
3b98a076e4e5f095e4243ef4c151aa6056dd7fbd697f8178c7bda3799ffcef49  save_2.bin
3b98a076e4e5f095e4243ef4c151aa6056dd7fbd697f8178c7bda3799ffcef49  save_3.bin
```

(The implementation writes a temporary file and renames it on success — `create_slot_save_temp`,
`failed to commit the slot save file` — so a completed save leaves exactly one file and no temp
file; none were observed.)

**`SCKP` sections.** The file contains exactly one `SCKP` magic, at byte offset 319,317,084:

```
grep -a -c SCKP ctx16k.bin  ->  1
grep -a -o SCKP ctx16k.bin | wc -l  ->  1
offset 319317084: 53 43 4b 50 | 01 00 00 00 | 02 00 00 00 | ...
                  magic SCKP  | version 1   | n_checkpoints 2
```

So: **one `SCKP` appendix, declaring 2 context checkpoints.** The engine's log agrees:

```
srv save_slot_ch: appended 2 context checkpoint(s) (168.049 MiB)
```

Size decomposition (all measured):

```
total file                    495,529,160 B   (472.57 MiB)
  state payload (before SCKP) 319,317,084 B   (304.52 MiB)
  SCKP appendix               176,212,076 B   (168.05 MiB)  = 2 x 88,106,038 B
```

Fraction of the model: **495,529,160 / 3,786,957,088 = 0.13085 → 13.09 %**.

The appendix is variable: **each context checkpoint costs 88,106,038 B (~84.02 MiB)**, and the file
carries however many the slot holds at save time. Observed on a smaller 3,455-token context, same
model:

```
137,692,524 B base + 2 ckpt = 313,904,600 B   (VN.bin / VA.bin / VB.bin)
                    + 3 ckpt = 402,010,632 B   (seq2_saltA.bin)
                    + 4 ckpt = 490,073,644 B   (salt_a.bin, seq1_saltA.bin)
```

and the 16,110-token case: `319,317,084 B base + 2 ckpt = 495,529,160 B`. The state payload grows
with context (~304 MiB at 16k on this model); each extra checkpoint adds ~84 MiB on top.

## 2. Save and restore wall-clock (3 each + median)

Wall-clock is `curl -w '%{time_total}'` around the POST. The engine also reports its own timing in
the response body (`timings.save_ms` / `timings.restore_ms`) — that is its internal measurement.
The engine prints **no** separate "save took" line in the text log; the only related log line is
the checkpoint-appendix line above.

Save (slot at 16,110 tokens, 495,529,160 B written each time):

| rep | wall (s) | engine `save_ms` |
|-----|----------|------------------|
| 1   | 0.546336 | 545.124 |
| 2   | 0.551469 | 550.863 |
| 3   | 0.553033 | 552.440 |
| **median** | **0.551469** | **550.863** |

Restore (same 495,529,160 B file):

| rep | wall (s) | engine `restore_ms` |
|-----|----------|---------------------|
| 1   | 0.081708 | 80.992 |
| 2   | 0.081412 | 80.746 |
| 3   | 0.079356 | 78.705 |
| **median** | **0.081412** | **80.746** |

First (cold) save: 0.662592 s / 661.956 ms. Restore into a **fresh process**: 0.092774 s / 92.019 ms.

Rate: save ≈ **899 MB/s**, restore ≈ **6.1 GB/s** from the page cache (MB = 10^6 bytes) — the save is
about 6.8× slower than the restore. Caveat: other inference servers were running on this Mac at the
time (load average 1.7–2.5), so these are upper bounds, not best-case.

## 3. What a round trip does to the context

Cold reference: the original build evaluated 14,111 prompt tokens in 9438.7 ms (1495 tok/s).

**Continuation C2 — token-identical prefix** (original prompt + a short new suffix, 14,121 tokens):

```
cache_n 14106   prompt_n 15   prompt_ms 100.718
log: cached n_tokens = 14106, memory_seq_rm [14106, end)
log: prompt eval time = 100.72 ms / 15 tokens
```

**Continuation C1 — realistic** (original prompt + the generated text + new suffix, 16,122 tokens):

```
cache_n 14106   prompt_n 2016   prompt_ms 1593.814
log: restored context checkpoint (pos_min = 11547, pos_max = 14106, n_tokens = 14107, n_past = 14106, size = 84.024 MiB)
log: cached n_tokens = 14106, memory_seq_rm [14106, end)
log: prompt eval time = 1593.81 ms / 2016 tokens
```

The engine **reuses the restored cache** — it does not silently re-prefill. In the token-identical
case only **15 tokens (0.10 s)** are evaluated, against ~9.4 s for a cold 14k prefill. In the
realistic case, BPE re-tokenisation of the concatenated generated text diverges from the saved token
sequence around token 14,106, so 2,016 tokens are re-evaluated (1.59 s); reuse still covers 14,106 of
16,122 tokens (87.5 %). Reuse is possible because the appendixed context checkpoints let the engine
re-enter the sequence near 14,106 without re-evaluating from zero.

## 4. Is a save legal mid-generation?

Yes — but it is deferred, not concurrent. A streaming completion (`n_predict 600`, prompt 3,450
tokens) was started; `GET /slots` confirmed `is_processing: true`; the save was issued 2.08 s in.

```
POST /slots/0?action=save   body {"filename":"midgen.bin"}   -> http=200, wall=8.133567 s
{"id_slot":0,"filename":"midgen.bin","n_saved":4049,"n_written":322429688,"timings":{"save_ms":493.042}}
stream: 601 data chunks, last chunk {"stop":true,"tokens_predicted":600,"tokens_evaluated":3450}, wall 9.77 s
log: slot release: id  0 | task 2071 | stop processing: n_tokens = 4049, truncated = 0
log: srv save_slot_ch: appended 2 context checkpoint(s) (168.049 MiB)
```

HTTP 200, and the generation was **not interrupted** (600/600 tokens, clean `stop:true`). But the
save request blocked for 8.13 s while the engine's own `save_ms` was 0.49 s: the save handler defers
the task while the slot is processing (`if (slot->is_processing()) { ... queue_tasks.defer(...) }`)
and runs it once the slot goes idle. Consequence: the snapshot holds the state at *generation end*
(`n_saved: 4049`), not the state at the moment of the request. The engine's deferral message is
emitted at debug verbosity, below the `-lv 4` threshold I ran, so the deferral is established by the
wall-clock-vs-engine-time gap and by the log ordering, not by a captured deferral line.

## 5. What survives a restart

SIGTERM to the server, process confirmed gone, then a **fresh process** with the same model and the
same `--slot-save-path`.

```
kill -TERM <pid>  ->  OLD_PROCESS_GONE
fresh slot: /slots -> n_prompt_tokens null (empty)
POST /slots/0?action=restore  body {"filename":"ctx16k.bin"}
 -> http=200 wall=0.092774 s
{"id_slot":0,"filename":"ctx16k.bin","n_restored":16110,"n_read":495529160,"timings":{"restore_ms":92.019}}
log: srv load_slot_ch: restored 2 context checkpoint(s) from '/tmp/kalsa-measure/slots/ctx16k.bin'
```

Continuation on the fresh process:

```
C2 (token-identical): cache_n 14106  prompt_n 15    prompt_ms 109.810
   log: restored context checkpoint (pos_min = 11547, pos_max = 14106, n_tokens = 14107, n_past = 14106, size = 84.024 MiB)
   log: cached n_tokens = 14106, memory_seq_rm [14106, end)
   log: prompt eval time = 109.81 ms / 15 tokens
C1 (realistic):       cache_n 14111  prompt_n 2011  prompt_ms 1578.303
   log: cached n_tokens = 14111, memory_seq_rm [14111, end)
   log: prompt eval time = 1578.30 ms / 2011 tokens
```

The restore succeeds against a fresh process, and the continuation **reuses the cache**
(`cache_n` 14,106 / 14,111; a `restored context checkpoint` line; only 15 tokens evaluated in the
token-identical case). No error or warning in the fresh log — the only line my error grep caught was
`erased invalidated context checkpoint`, which matched on the substring "invalid" and is an info line.

One reporting gap: after a restore, `GET /slots` reports `n_prompt_tokens: null` (the monitoring
endpoint does not expose the restored prompt length) even though the continuation demonstrably reuses
it. The reuse proof is the completion response's `cache_n` and the `cached n_tokens` log line, not
`/slots`.

## 6. The salt question

**Shipped-code facts.** The local repo `~/Projects/kalsallama` is byte-identical to the published
commit: `git diff 2a290390d HEAD -- tools/server/` is empty.

- The header is `x-kalsa-cache-salt`, matched case-insensitively and read by `get_cache_salt()`
  (`server-context.cpp:4503`). An empty value is the unsalted namespace; "un-salted requests share
  one namespace" (`server-context.cpp:1374`).
- At task launch, a namespace mismatch clears the slot prompt and adopts the request's namespace
  (`server-context.cpp:3418–3421`).
- The save serialises only `slot->prompt.tokens` (`server-context.cpp` ~2768), so the salt is **not**
  in the file.
- The restore does `slot->prompt.clear()` (~2868), and `server_prompt::clear()` clears `cache_salt`
  (`server-task.h:577–581`). A restored slot is therefore **unsalted**.

**Empirical, clean-room** — a freshly started server process per variant, to avoid the in-process RAM
prompt cache leaking namespaces between runs. In each variant: completion with salt `A` (cold) →
save → restore → continuation:

| variant | continuation salt | `cache_n` | `prompt_n` | outcome |
|---------|-------------------|-----------|------------|---------|
| VN | *(none)* | 3447 | 5 | REUSE |
| VA | `A` (the namespace it was saved under) | 0 | 3452 | **clear + full re-prefill** |
| VB | `B` | 0 | 3452 | **clear + full re-prefill** |

VA and VB, verbatim from the log:

```
slot get_availabl: id  0 | task -1 |  - skipping, different cache namespace
srv          load:    - skipping cached prompt with a different cache namespace
slot   operator(): id  0 | task 10 | different cache namespace - clearing cached prompt
slot   operator(): id  0 | task 10 | cached n_tokens = 0, memory_seq_rm [0, end)
slot print_timing: id  0 | task 10 | prompt eval time = 1771.53 ms / 3452 tokens
```

so the request re-evaluates all 3,452 tokens (1.77 s) instead of reusing. VN logs no namespace line
and evaluates only 5 tokens.

**Conclusion: the peer's reading is confirmed.** A restored slot is unsalted. The device's own next
*salted* request — even with the same salt `A` the conversation was saved under — triggers
`different cache namespace - clearing cached prompt` and re-prefills the whole prompt. Only an
*unsalted* request reuses the restored context.

A caution on method: on the long-lived server used for the earlier phases, the same test appeared to
show salt `B` reusing after a restore. That was contamination — the server's in-process prompt cache
keeps namespace-tagged entries across requests, and later runs were served from it. Restarting the
process per variant removed the contamination and gave the stable result above. The clean-room
result, not the long-lived one, is what I report.

## Plain language: what this costs, what is proven, what is not

Cost of one ~16k-token chat, on this Mac, with this published engine and model:

- Disk: **one file, 495.5 MB** — 13.1 % of the 3.53 GB model. That is ~304 MB of KV state plus
  168 MB for the 2 context checkpoints the slot held. A shorter chat is **not** proportionally
  smaller: a 3,455-token chat still wrote 138 MB of state, and the file grows by ~84 MB for every
  extra checkpoint the slot carries.
- Time to save: **~0.55 s** (median of 3; ~899 MB/s).
- Time to restore: **~0.08 s** (median of 3; ~6 GB/s), about 7× faster than saving.
- A save during generation is accepted (HTTP 200) but **waits** for the generation to finish
  (8.1 s of wall clock for a 0.5 s save) and snapshots the end-of-generation state.
- **Restarting the engine does not lose the conversation**: a fresh process restores the file and
  reuses the cache (15 tokens re-evaluated instead of a full prefill).
- A restored conversation is reusable by an *unsalted* request, but the moment the client sends its
  salt header the restored cache is discarded and the whole prompt is re-prefilled — so with the
  device's normal salted requests, a save/restore round trip costs one full prefill (~1.8 s for
  3.4k tokens, ~9.4 s for 14k).

**Proven** (measured, with the raw evidence above): file count and exact sizes; `SCKP` = one appendix
with 2 checkpoints; save/restore wall-clock and engine timings (3 reps + medians); cache reuse after
restore (`cache_n`, `cached n_tokens`, `restored context checkpoint`); mid-generation save behaviour;
restart survival; and the unsalted-after-restore salt behaviour (clean-room, fresh process per
variant, and confirmed in the shipped source).

**NOT established:**

- Nothing about phones or the app's own client code — this is the engine on the Mac only.
- Live-slot namespace transitions were not fully characterised: a change of salt on a live slot
  cleared in one run (A→B) and reused in another (B→A) with a namespaced RAM prompt cache present.
  Only the restore case was fully pinned down.
- The engine's internal deferral message for the mid-generation save sits below the verbosity I ran;
  the deferral is inferred from wall-clock vs engine time and from log ordering.
- Absolute timings are upper bounds: other inference servers were running on the same machine (load
  average 1.7–2.5), and the files were warm in the page cache after the first write.
- Marginal cost per token and per checkpoint across other models or context sizes was not measured —
  one model and one context size were used.

## Raw log / artefact index

All under `/tmp/kalsa-measure/`:

- `server/server.log` — first process (sections 1–4; the 16k build, saves, restores, continuations, mid-generation save)
- `server/server2.log` — the restart process (section 5) plus the first (contaminated) salt run
- `server/serverF_VN.log`, `serverF_VA.log`, `serverF_VB.log` — clean-room salt variants (section 6)
- `server/serverF_live.log` — live-slot salt control (not fully characterised)
- `slots/*.bin` — the save files (`ctx16k.bin`, `save_1..3.bin`, `midgen.bin`, `VN/VA/VB.bin`, `salt_a.bin`, `seq1_saltA.bin`, `seq2_saltA.bin`)
- `comp_*.json`, `save_resp*.json`, `restore_*.json`, `slots_*.json`, `tok_*.json` — raw HTTP responses
- `payload_*.json`, `prompt_long.txt`, `prompt_short.txt`, `gen_long.txt`, `gen_prompt.py` — request material
- `help.txt` — the binary's `--help` dump
- `phase_d.sh`, `phase_e.sh`, `phase_f.sh`, `phase_f2.sh`, `phase_f3.sh`, `phase_f4.sh` — the scripts that produced the runs

The server was stopped at the end of each phase; no process from this exercise was left running
(port 8391 free, no `kalsa-server` with a `/tmp/kalsa-measure` path).

---

# Addendum — context-checkpoint count: `--ctx-checkpoints 1` vs `0` vs the default 32

Appended 2026-09-21. This does not modify the sections above.

## Flags, confirmed from the binary's own `--help`

Verbatim from `/tmp/kalsa-measure/help.txt`:

```
-ctxcp, --ctx-checkpoints, --swa-checkpoints N
                                        max number of context checkpoints to create per slot (default:
                                        32)[(more info)](https://github.com/ggml-org/llama.cpp/pull/15293)
                                        (env: LLAMA_ARG_CTX_CHECKPOINTS)
-cms,  --checkpoint-min-step N          minimum spacing between context checkpoints in tokens (default: 8192,
                                        0 = no minimum)
                                        (env: LLAMA_ARG_CHECKPOINT_MIN_SPACING_NT)
```

Spelling trap hit while doing this: **`-ctx-checkpoints` with a single dash is rejected** —
`error: invalid argument: -ctx-checkpoints`, and the server does not start. The accepted spellings are
`-ctxcp` or `--ctx-checkpoints` (double dash). I used `--ctx-checkpoints 1` and `--ctx-checkpoints 0`.

The cold path the question cites (`server-context.cpp:3619-3624`) emits exactly this line, and it is
the marker I grep for:

```
forcing full prompt re-processing due to lack of cache data (likely due to SWA or hybrid/recurrent memory, see https://github.com/ggml-org/llama.cpp/pull/13194#issuecomment-2868343055)
```

## Clean-room setup

One **fresh server process per variant** (no reuse between variants), my own port **8393**, working dir
`/tmp/kalsa-measure/followup`, save path `/tmp/kalsa-measure/followup/slots`, one log per variant. The
other sessions' servers were not touched.

```
kalsa-server -m <model> --host 127.0.0.1 --port 8393 -c 16384 -np 1 --slots \
  --slot-save-path /tmp/kalsa-measure/followup/slots -lv 4 --ctx-checkpoints <N> \
  >> /tmp/kalsa-measure/followup/<tag>.log 2>&1 &
```

Each run: build the same ~16k context (14,111-token prompt + 2,000 generated → 16,110 tokens in the
slot), save, restore, then two continuations, each preceded by a **fresh restore**: **C1** the
realistic end-of-chat continuation (saved conversation + new suffix, 16,122 tokens) and **C2** the
token-identical control (original prompt + suffix, 14,121 tokens).

## File and restore, per variant

| variant | file bytes | state part | appendix | save `appended` | save wall / `save_ms` | restore `n_restored` | restore wall / `restore_ms` | restore `restored` |
|---|---|---|---|---|---|---|---|---|
| default 32 (baseline, §1–3) | 495,529,160 | 319,317,084 | 176,212,076 (2 ckpt) | `appended 2 context checkpoint(s) (168.049 MiB)` | 0.551469 s / 550.863 ms | 16,110 | 0.081412 s / 80.746 ms | `restored 2 context checkpoint(s)` |
| `--ctx-checkpoints 1` | **407,423,128** | 319,317,084 | **88,106,044 (1 ckpt)** | `appended 1 context checkpoint(s) (84.024 MiB)` | 0.424855 s / 424.245 ms | **16,110** | 0.058521 s / 57.787 ms | `restored 1 context checkpoint(s)` |
| `--ctx-checkpoints 0` | **319,317,084** | 319,317,084 | **0 (no SCKP at all)** | *(no line emitted)* | 0.233068 s / 232.45 ms | **16,110** | 0.039580 s / 38.878 ms | *(no line emitted)* |

The appendix parses as `12 + N x 88,106,032` bytes: `N=1 → 88,106,044`, `N=2 → 176,212,076`, `N=0 →
no SCKP magic present in the file at all` (`grep -a -c SCKP cp0.bin` = 0). The three-state split is
exact: `cp1.bin` and `cp0.bin` share the same 319,317,084-byte state part, and `cp0.bin` is exactly
that state part. The save/restore figures here are single runs (one per variant), not the 3-rep
medians used for the baseline above.

## Continuations after a fresh restore

| variant | C1 `cache_n` | C1 tokens **actually re-evaluated** | C1 wall | C2 `cache_n` | C2 tokens **actually re-evaluated** | C2 wall | cold marker |
|---|---|---|---|---|---|---|---|
| default 32 | 14,106 | 2,016 | 1.958 s | 14,106 | 15 | 0.451 s | none |
| `--ctx-checkpoints 1` | 14,106 | 2,016 | 1.959 s | 14,106 | 15 | 0.460 s | none |
| `--ctx-checkpoints 0` | **0** | **16,122** | **10.496 s** | **0** | **14,121** | **8.981 s** | `forcing full prompt re-processing …` |

Raw lines for `--ctx-checkpoints 1`:

```
save:    srv  save_slot_ch: appended 1 context checkpoint(s) (84.024 MiB)
restore: srv  load_slot_ch: restored 1 context checkpoint(s) from '/tmp/kalsa-measure/followup/slots/cp1.bin'
C1:      slot operator(): restored context checkpoint (pos_min = 11547, pos_max = 14106, n_tokens = 14107, n_past = 14106, size = 84.024 MiB)
C1:      slot operator(): cached n_tokens = 14106, memory_seq_rm [14106, end)
C1:      slot print_timing: prompt eval time = 1580.57 ms / 2016 tokens
```

Raw lines for `--ctx-checkpoints 0`:

```
save:    (no `appended` line — cp0.log has no `appended` match at all)
restore: (no `restored N context checkpoint(s)` line; HTTP 200, n_restored 16110, n_read 319317084)
C1:      slot operator(): forcing full prompt re-processing due to lack of cache data (likely due to SWA or hybrid/recurrent memory, see https://github.com/ggml-org/llama.cpp/pull/13194#issuecomment-2868343055)
C1:      slot operator(): cached n_tokens = 0, memory_seq_rm [0, end)
C1:      slot print_timing: prompt eval time = 10128.79 ms / 16122 tokens
```

Note on the zero-checkpoint save/restore: with `--ctx-checkpoints 0` the engine emits **neither** the
`appended N context checkpoint(s)` nor the `restored N context checkpoint(s)` line — `cp0.log`
contains no `appended`, `load_slot_ch` or `restored` match at all. The operations still succeed
(save: HTTP 200, `n_written: 319317084`; restore: HTTP 200, `n_restored: 16110`, `n_read:
319317084`). I report the absence of those two lines rather than inventing them.

## Why the resume lands at 14,106 and not 16,110 (mechanism, with the log lines)

For this `afmoe` model the memory is a hybrid/SWA cache (`n_swa = 2560`), and the rewind point must be
rebuilt from a context checkpoint (`server-context.cpp:3594-3624`: if the checkpoint search falls
through, `do_reset` forces full re-processing). Checkpoints are created during **prompt evaluation**,
not during generation: in the cp1 build, the log shows the prefill creating checkpoints at `pos_max`
13594 then 14106 (both `1 of 1`, so max=1 keeps the newest), and the 2,000-token generation adds
none. The saved file therefore carries its newest checkpoint at 14,106, and a restored slot resumes
there (C1 re-evaluates 14,106→16,122 = 2,016 tokens). A **live** (non-restored) slot does not pay
this: in the cp1b probe the turn-2 prefill logged `cached n_tokens = 16110, memory_seq_rm [16110,
end)` and evaluated only 12 tokens. The extra cost is specific to the restore, and it is the same
with 1 checkpoint as with the default 32.

## Probe: does a save taken at a turn boundary carry an end-of-chat checkpoint?

`cp1b` variant, `--ctx-checkpoints 1`, fresh process:

```
build 16k                                                slot = 16,110 tokens, checkpoints 13594 then 14106
SAVE #1  (right after generation)                        appended 1 context checkpoint(s) (84.024 MiB)   file 407,423,128 B
turn-2 prefill (live, no restore)                        cached n_tokens = 16110, memory_seq_rm [16110,end)   cache_n 16110 / re-evaluated 12
                                                         created context checkpoint 1 of 1 (pos_min = 13558, pos_max = 16117, n_tokens = 16118)
SAVE #2  (after turn-2 prefill)                          appended 1 context checkpoint(s) (84.024 MiB)   file 407,595,352 B = 319,489,308 state + 88,106,044 (1 ckpt @ 16117)
restore SAVE #2                                          restored 1 context checkpoint(s)   n_restored 16,122
resume (chat + next turn)                                restored context checkpoint (pos_min = 13558, pos_max = 16117, n_past = 16117)
                                                         cached n_tokens = 16117, memory_seq_rm [16117, end)
                                                         prompt eval time = 212.17 ms / 10 tokens
                                                         -> cache_n 16117, tokens re-evaluated 10, wall 0.575 s
```

So a save taken after a turn's prefill carries a checkpoint at the end of the conversation (16,117),
and a restore from that file lands **warm at the end**: 16,117 of 16,127 tokens reused, only 10
re-evaluated (0.21 s of prompt eval). The 2,016-token re-evaluation in the first-save case is an
artefact of saving immediately after a long generation, before any turn-boundary prefill has advanced
the newest checkpoint.

## The design answer

If the app passes `--ctx-checkpoints 1`, the appendix contains **exactly one** checkpoint — measured
in three ways: the save log says `appended 1 context checkpoint(s) (84.024 MiB)`, the `SCKP` header
reads `version 1, n_checkpoints 1`, and the file is `407,423,128 B = 319,317,084 B state +
88,106,044 B` (one checkpoint). The restore succeeds (`n_restored: 16110`) and the continuation lands
warm to the newest checkpoint in the file — identical to the default 32-checkpoint configuration:
`cache_n 14,106`, 2,016 tokens re-evaluated, 1.58 s for the end-of-chat continuation, and 15 tokens /
0.10 s for the token-identical control. Because the one retained checkpoint is always the newest one,
`--ctx-checkpoints 1` does not lose the resume point the design cares about: for a save taken at a
turn boundary it carries a checkpoint at the end of the chat (probe: 16,117) and the resume reuses
16,117 tokens and evaluates 10. The trade is a straight **88,106,032 bytes (84.02 MiB) saved per 16k
chat** against the current default (495,529,160 B → 407,423,128 B), with no change in warmness.
`--ctx-checkpoints 0` reaches 319,317,084 B (88 MiB smaller again) but **does not land warm**: with no
checkpoint the SWA/hybrid memory cannot be rewound, the engine logs `forcing full prompt
re-processing due to lack of cache data`, `cache_n` is 0, and a restore costs a full prefill — 16,122
tokens in 10.50 s (C1) or 14,121 tokens in 8.98 s (C2). So the better default for the app is
`--ctx-checkpoints 1`: it is the smallest setting that still performs a real warm resume, and it is
half the appendix of the shipped default; `--ctx-checkpoints 0` is only sensible if the app is willing
to pay a ~9–10 s cold prefill on every restore.

## Processes: started and stopped

- Manual spelling check: one server on port 8393 — **stopped**.
- `cp1` run: pid 74179 (`/tmp/kalsa-measure/followup/cp1.log`) — **stopped** (script printed `STOPPED 74179`).
- `cp0` run: pid 77579 (`/tmp/kalsa-measure/followup/cp0.log`) — **stopped** (`STOPPED 77579`).
- `cp1b` probe: pid 86829 (`/tmp/kalsa-measure/followup/cp1b.log`) — **stopped** (`STOPPED 86829`).
- Two failed starts (pids 28444, 48888) exited immediately on the invalid `-ctx-checkpoints` spelling.
- Verified after all runs: port 8393 free, no `kalsa-server` process with a `kalsa-measure` path. The
  servers on ports 18081 / 18083 / 18080 / 18082 / 18090 / 8130 belong to other sessions and were not
  touched.

Artefacts for this addendum: `/tmp/kalsa-measure/followup/` (`cp0.log`, `cp1.log`, `cp1b.log`,
`slots/{cp0,cp1,cp1b_turn1,cp1b_turn2}.bin`, `comp_*.json`, `save_*.json`, `restore_*.json`,
`run_followup.sh`, `run_cp1b.sh`).
