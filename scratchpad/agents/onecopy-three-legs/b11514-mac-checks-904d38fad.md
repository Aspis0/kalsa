# b11514 (904d38fad) Metal measurement — Apple M1 Max, 64 GB, macOS (darwin 25.6.0, arm64)

Date: 2026-10-08. Port 18191 for all test servers. No downloads >200 MB were made; no screen capture was used.
The Kalsa app's own server (shipped v1.1.5, Qwen3.6-35B, ~23 GB resident) ran untouched on 8130/8131 (PID 57091) throughout — both engines fit in 64 GB, no swap observed, but decode numbers may carry a small shared-memory-bandwidth effect. Same conditions on both sides of every comparison.

## Engines

| role | binary | version |
|---|---|---|
| NEW | `/tmp/kb11514/build/bin/llama-server` (archive of 904d38fad, built Metal Release, `-DLLAMA_BUILD_UI=OFF -DLLAMA_USE_PREBUILT_UI=OFF`; target `llama-server`, no fork rename) | `0.6.0-dev (build 0, commit unknown)` |
| BASELINE | `~/Library/Application Support/kalsa-brain/runtime/builds/metal/kalsa-server-v1.1.5/kalsa-server` (the engine the app ships and currently runs) | `0.5.0-dev (build 11596, commit 63a51b6d6)` |

Build note: first build failed in the WebUI asset step (`CMake Error ... ui-assets.cmake:218 file failed to compress ... bundle.BHySb6NS.css` — corrupt HF-downloaded dist + `llama-ui-assets` target). Rebuilt clean with UI off; `CFG_EXIT=0 BUILD_EXIT=0`.

Models used (all on disk, nothing downloaded):
- E4B: `~/Library/Application Support/kalsa-brain/runtime/models/gemma-4-E4B-it-Q4_K_M.gguf` + drafter `/Users/marco/lab/spec/dl/mtp-gemma-4-E4B-it-Q8_0.gguf`
- LFM2.5-VL-3B: `/Users/marco/kalsa-models/LFM2.5-VL-3B-Q4_K_M.gguf` + `/Users/marco/kalsa-models/mmproj-LFM2.5-VL-3B-Q8_0.gguf`
- Test image: `/tmp/kbcheck/frame1920.png` — 1920×1080, made with `sips -z 1080 1920` from a committed repo screenshot (`chat/shots/08-long.png`). The lab's original screenshots were in `/tmp/lab-screen/` and are gone (reboot-cleared).

## Check 1 — Vision cap: PASS (with LFM2.5-VL substitute) / gemma part BLOCKED — missing file

**Blocked item, flagged per instructions:** no Gemma 4 mmproj exists anywhere on disk (`mmproj-gemma-4-12B-it-Q8_0.gguf`, `-26B-`, `-E4B-` all lived in `/tmp/lab-screen/models`, reboot-cleared). A replacement is an ~800 MB download; I stopped on that per the >200 MB rule. Everything below therefore exercises the vision path with LFM2.5-VL-3B + its mmproj (same engine code path: mtmd → clip → ubatch), not gemma.

NEW engine, LFM2.5-VL-3B, app vision flags: `--ubatch-size 1024 --batch-size 2048 --image-max-tokens 560 --flash-attn on --cache-type-k q8_0 --cache-type-v q8_0 --ctx-size 32768 --n-gpu-layers all` (the app renders `all`, not 99 — args.rs `ALL_LAYERS`; same thing for these models).

- u1024 startup: `grep -c "cap image_max_tokens"` → **0** (PASS: no cap warning). mmproj load lines quoted:
  ```
  0.00.058.139 I srv    load_model: loading model '/Users/marco/kalsa-models/LFM2.5-VL-3B-Q4_K_M.gguf'
  0.01.726.022 I srv    load_model: loaded multimodal model, '/Users/marco/kalsa-models/mmproj-LFM2.5-VL-3B-Q8_0.gguf'
  0.01.754.098 I srv    load_model: initializing, n_slots = 1, n_ctx_slot = 32768, kv_unified = 'false'
  ```
- 1920×1080 image via `/v1/chat/completions` (fresh-context u512 relaunch shows it cleanest): **status 200, no abort**, `prompt_n: 2603, cache_n: 0, prompt_ms: 7125`. Reply: `"A chat interface displays a conversation with a prompt to keep the message narrow and airy while the scroll remains pinned."` (correct — the image is a chat screenshot). At u1024 (after 2 chat turns): 200, `prompt_n: 2604, cache_n: 106`, same description.
- u512 relaunch: server started fine; `grep "cap image_max_tokens"` → **0 matches**; same image → **status 200, no abort** (`prompt_n 2603`), engine healthy after. **No status-134 anywhere.**
- Baseline control (u1024): 200, `prompt_n: 2603`, same reply, no cap line — identical to NEW.

**Why no cap warning at u512 and no abort — source-verified, not an anomaly:** the warning only fires for mixed-batch or non-causal-on-image projectors (`tools/server/server-context.cpp:1284-1299`: `if (is_mixed || mmproj_usage.use_non_causal) ... SRV_WRN("cap image_max_tokens (original=%d) to %d (n_ubatch = %d) because %s\n" ...)`). `mtmd_decode_use_non_causal` (`tools/mtmd/mtmd.cpp:2197`) returns true for GEMMA4V except n_embd 1536/2560 (E2B/E4B causal — which is exactly why E4B never crashed in the old lab matrix), GEMMA4UV, GEMMA3, DEEPSEEK4V; LFM2 falls to `default: false` (causal → image chunks split across ubatches, no assert). LFM also never honors the 560 cap: the LFM2 projector block (`clip.cpp:1529-1552`) never reads `custom_image_max_tokens` (its own tile limit is `set_limit_image_tokens(64, 256)`), so the 1920×1080 frame legitimately costs ~2480 image tokens — pre-existing (baseline identical), **not** a b11514 regression.

**Gap:** the gemma-specific assertion of Check 1 (u512 relaunch must emit `cap image_max_tokens (original=560) to 512` and not abort) is NOT covered by this run — it requires a gemma 12B/26B mmproj (non-causal GEMMA4V), which is the missing download. For reference, the old engine's failure mode from `dev/lab-screen/results/crash/matrix.txt`: `ENGINE=died status=134` at g12 u512/u256 with `GGML_ASSERT((cparams.causal_attn || cparams.n_ubatch >= n_tokens_all) && ...) failed`.

## Check 2 — MTP decode: PASS (new is faster)

E4B + `mtp-gemma-4-E4B-it-Q8_0.gguf`, app MTP flags (`--model-draft ... --spec-type draft-mtp --spec-draft-n-max 3 --spec-draft-n-min 0 --spec-draft-type-k q8_0 --spec-draft-type-v q8_0`), `--threads 4 --threads-batch 4 --ubatch-size 512 --ctx-size 32768`, same fixed prompt, temp 0, 256 max tokens, 3 runs each side:

| engine | runs (tok/s) | median `timings.predicted_per_second` | acceptance |
|---|---|---|---|
| NEW 904d38fad | 61.99, 61.48, 62.22 | **61.99** | `draft_n: 234, draft_n_accepted: 172` → 73.5 % |
| BASELINE v1.1.5 | 51.93, 52.07, 52.01 | **52.01** | `draft_n: 234, draft_n_accepted: 172` → 73.5 % |

New is **+19.2 % faster**, identical acceptance and identical output text (temp 0). PASS. (Both engines log only `common_speculative_init_result: loading draft model '...'`; acceptance comes from `timings.draft_n/draft_n_accepted`.)

## Check 3 — Real load / chat / slot round trip: PASS on both models

Slot dir `/tmp/kbcheck/slots`, `--slot-save-path` + `--ctx-checkpoints 1`, MTP on for E4B. Save/restore = `POST /slots/0?action=save|restore` with `{"filename": ...}`.

**E4B + MTP (NEW):** load OK; TURN1 `("My name is Marco and I keep my boat in Palermo...")` → `"OK."`; TURN2 → `"Your name is Marco, and you keep your boat in Palermo."`;
- SAVE: `200 {"id_slot":0,"filename":"check3-e4b.slot","n_saved":69,"n_written":3237396,"timings":{"save_ms":5.158}}`
- RESTORE: `200 {"id_slot":0,"filename":"check3-e4b.slot","n_restored":69,"n_read":3237396,"timings":{"restore_ms":0.708}}`
- Post-restore TURN3 recalls correctly: `"Your name is Marco, and you keep your boat in Palermo."`, warm: `cache_n: 51` of 95, MTP active (`draft_n: 12, draft_n_accepted: 9`).
- Truncated slot (`truncate -s 1618698` of 3237396): restore **REFUSED**: `400 {"error":{"code":400,"message":"Unable to restore slot: No available space in KV cache or invalid slot save file","type":"invalid_request_error"}}`; `/health` right after → `200 {"status":"ok"}`. Server alive. PASS.

**LFM2.5-VL-3B (NEW, with mmproj, u1024):** load OK; TURN1 → `"OK"`; TURN2 → `"Your cat is named Nour and she is nine years old."`;
- SAVE: `200 {... "filename":"check3-lfm.slot","n_saved":68,"n_written":1315336 ...}`; RESTORE: `200 {... "n_restored":68 ...}`; post-restore TURN3 correct and warm (`cache_n: 68`).
- (Side note: `DELETE /slots/0` returns 404 "File Not Found" on this build — endpoint differs; not part of the round trip, restore-after-restart semantics unaffected.)

## Check 4 — test-backend-ops FLASH_ATTN_EXT on MTL0: SIGSEGV — information only

`cmake --build build --target test-backend-ops -j` → cheap (already-built libs), `BUILD_EXIT=0`.
`./build/bin/test-backend-ops -b MTL0 -o FLASH_ATTN_EXT` → **exit 139 (SIGSEGV)** after **4937 OK** cases, on the case whose pipeline is:

```
ggml_metal_library_compile_pipeline: compiling pipeline: base = 'kernel_flash_attn_ext_vec_f32_dk128_dv96', name = 'kernel_flash_attn_ext_vec_f32_dk128_dv96_mask=1_sink=0_bias=0_scap=0_kvpad=1_sparse=0_ns10=128_ns20=96_nsg=4_nwg=32'
ggml_metal_library_compile_pipeline: kernel not found in any metal library: base = 'kernel_flash_attn_ext_vec_f32_dk128_dv96', name = '..._kvpad=1_...'
```
i.e. a vec-path f32-K case, dk128/dv96, mask=1, kvpad=1 — the kernel is missing from the library and the runner segfaults on the null pipeline instead of skipping. Not compared against baseline (baseline ships no test-backend-ops binary; building one was out of scope for an info-only item).

## Server hygiene

PIDs started and stopped on 18191, each verified gone (`kill -0` fails, port freed): 40363, 41536, 42401, 46251, 49011, 51395. Final sweep: `lsof -nP -iTCP:18191 -sTCP:LISTEN` → empty; app server 57091 on 8130/8131 untouched, still running.

## Raw artifacts

Logs: `/tmp/kbcheck/logs/*.log` (+ `.argv` per run). Sources: build logs `/tmp/kb-cfg*.log`, `/tmp/kb-build*.log`, `/tmp/kb-tbo-*.log`; bench client `/tmp/kbcheck/bench.py`; image `/tmp/kbcheck/frame1920.png`; build tree `/tmp/kb11514/` (UI disabled).

---

# Appendix — Check 1 Gemma part completed (second pass, same day)

The Gemma 4 12B mmproj was found pinned in the catalog (`crates/kalsa-catalog/src/manifest.rs:926-932`): repo `ggml-org/gemma-4-12B-it-GGUF` @ `e3e681731089efaa3f0917336944ac64752db8ba`, file `mmproj-gemma-4-12B-it-Q8_0.gguf`, 158,987,616 bytes (< 200 MB, so downloaded after all). Downloaded with `curl -L` to `/tmp/kb-mmproj/` (NOT the app model dir); size exact and `shasum -a 256` = `59e62255435dda870e2d1de97cc031330b31a898bac12b38a182cecff9cd3738` — **matches the manifest**. Weights: the on-disk `gemma-4-12B-it-Q4_K_M.gguf` from the app model dir. Gemma sampling per the lab profile: `--temp 1.0 --top-p 0.95 --top-k 64`. Same image `/tmp/kbcheck/frame1920.png`.

## (a) NEW 904d38fad, u1024 b2048 — PASS

`grep -c "cap image_max_tokens"` → **0**. mmproj load line:
```
0.04.440.454 I srv    load_model: loaded multimodal model, '/tmp/kb-mmproj/mmproj-gemma-4-12B-it-Q8_0.gguf'
```
Image request: **status 200**, `prompt_n: 550, cache_n: 0, prompt_ms: 3297.9`, reply: `"The image shows a long, repetitive chat conversation in a messaging application where a user is asking the same question repeatedly and receiving the same filler text answer."` (correct description of the screenshot).

## (b) NEW 904d38fad, u512 relaunch — PASS (warning fires, no abort)

Startup log line 11, exactly the expected wording:
```
0.01.345.684 W srv    load_model: cap image_max_tokens (original=560) to 512 (n_ubatch = 512) because model needs non-causal attention on image
```
Same image: **status 200, no abort**, `grep -c GGML_ASSERT` → 0, `prompt_n: 503` (image capped under the 512 ubatch), reply: `"The image shows a user interface for a long chat conversation with a sidebar on the left, a main chat window in the center, and an attachments panel on the right."`

## (c) BASELINE shipped v1.1.5, same u512 flags — CONFIRMED ABORT (status 134)

Engine healthy at start; on the same image the client got `RemoteDisconnected`, and:
```
BASE_EXIT=134
/Users/runner/work/kalsallama/kalsallama/src/llama-context.cpp:1804: GGML_ASSERT((cparams.causal_attn || cparams.n_ubatch >= n_tokens_all) && "non-causal attention requires n_ubatch >= n_tokens") failed
```
Same request, same flags, same image: baseline dies (134), new build answers (200, 503 prompt tokens). **The fix is proven.**

Server hygiene: PIDs 59842, 59972 stopped via stop.sh (verified gone), 60593 died on its own (134). Final sweep: no test engine processes remain, 18191 clear, app server (57091, 8130/8131) untouched. New logs: `/tmp/kbcheck/logs/new-g12-u1024.log`, `new-g12-u512.log`, `base-g12-u512.log`; mmproj kept at `/tmp/kb-mmproj/`.
