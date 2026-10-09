# b11514 windows checks — Surface (i7-1065G7), engine 904d38fad

Date: 2026-10-08. Machine: TABLET-V477JRIG, Windows 11 Pro build 26200, i7-1065G7 4C/8T, 15.6 GB RAM (5.5 free at start), 185.8 GB free disk.
Kalsa app state: installed but NOT running at any point (no kalsa*.exe, ports 8130/18192 both free at recon). No cargo/cmake/cl/msbuild running before heavy work. App folders under AppData only READ (models, baseline build copied out to C:\Users\gualt\kbase before running).
Remote protocol: scripts written locally to /tmp/surfb/*.ps1 (pure ASCII; é built as [char]0xE9), scp'd to C:\Users\gualt\, run via `powershell -NoProfile -ExecutionPolicy Bypass -File`. Long jobs ran in the foreground of a persistent ssh session, logging to C:\Users\gualt\logs\ on the Surface, polled from separate ssh calls. No screen capture anywhere.

## Toolchain (found, nothing installed)
- cmake: NOT in PATH; VS 2022 BuildTools bundled cmake used: `C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\cmake.exe`
- MSVC 14.44.35207 (VS BuildTools, vswhere-verified), MSBuild 17.14.60
- ninja: not in PATH (bundled one present, unused)
- **Vulkan SDK: ABSENT** (`VULKAN_SDK` env empty, no `C:\VulkanSDK`, no glslc) → per instructions the Vulkan variant was NOT built and Check 3 was NOT run.

## Engine transfer + build
- `git -C ~/Projects/kalsallama-upstream-b11514 archive --format=zip -o /tmp/kb11514.zip 904d38fad` (commit: "Merge upstream tag b11514 (de7fa0a3c) into main (kalsallama)"); zip 40,328,229 bytes; expanded to C:\Users\gualt\kb11514 (repack.cpp present).
- Configure: `cmake -S . -B build-cpu -G "Visual Studio 17 2022" -A x64 -DGGML_VULKAN=OFF -DLLAMA_CURL=OFF -DCMAKE_BUILD_TYPE=Release` → configure OK ("Configuring done (39.8s)").
- Build: `cmake --build build-cpu --config Release --target llama-server test-backend-ops --parallel 4` → **exit 0**. `llama-server.exe` + `test-backend-ops.exe` produced 2026-10-08 19:57/19:58.
  - One first attempt failed at the build step with `MSBUILD : error MSB1031` (cmake split my `-m:4` passthrough into `-m: 4`); retried with cmake-native `--parallel 4` — build itself clean.
  - Pre-existing cosmetic warning: `MSB8027: Two or more files with the name of llama.cpp will produce outputs to the same location` (src\llama.cpp vs src\models\llama.cpp).

## Check 1 — repack smoke: PASS
test-backend-ops (new build, `-b CPU`):
- `-o MUL_MAT` → **exit 0**: `2515/2515 tests passed` / `Backend CPU: OK` / `1/1 backends passed`
- `-o MUL_MAT_ID` → **exit 0**: `967/967 tests passed` / `1/1 backends passed`

New vs baseline, E4B Q4_K_M, both CPU-only (`--threads 4 --ctx-size 32768 --n-gpu-layers 0`), temp 0, port 18192:
- New build: health ~10 s; 2-turn chat coherent: "The capital of France is Paris." → "The Seine River runs through Paris."
- Baseline copy (kbase\kalsa-server-v1.1.5, `-ngl 0`): health ~15 s; same two answers, coherent.
- 64-token /completion ("The Renaissance was a period of", temp 0, top_k 1, seed 42): first 64 tokens **byte-identical** (diff of JSON `content`, 313 chars each).
- Decode tok/s (timings.predicted_per_second): **new 8.98** (7013 ms / 64 tok) vs **baseline 7.26** (8678 ms / 64 tok) → new ≈ +24% on this run. Prompt eval: 19.3 vs 11.1 tok/s.

## Check 2 — app-flag loads: PASS
Flag set from kalsa-launch argv.rs (ForcedOff: `--n-gpu-layers 0` + `--n-gpu-layers-draft 0`; no `--device` on this machine), port 18192:
`--threads 4 --threads-batch 4 --batch-size 2048 --ubatch-size 512 --ctx-size 32768 --flash-attn on --cache-type-k q8_0 --cache-type-v q8_0 --sleep-idle-seconds 300 --no-webui --parallel 1 --cache-ram 2041 --slot-save-path C:\Users\gualt\slots-tmp --ctx-checkpoints 1`

E4B + MTP drafter (new build, full app set + `--model-draft mtp-gemma-4-E4B-it-Q8_0.gguf --spec-type draft-mtp --spec-draft-n-max 3 --spec-draft-n-min 0 --spec-draft-type-k q8_0 --spec-draft-type-v q8_0`):
- Load OK, health ~12 s; generation OK (`"speculative.types":"none,draft-mtp"` echoed in the response).
- MTP active: `draft acceptance = 0.33929 ( 19 accepted / 56 generated), mean len = 2.00`; draft_n 57–60, draft_n_accepted 19–20 across runs.
- Slot round trip, MTP on: save `POST /slots/0?action=save {"filename":"slot-ok.bin"}` → **200** `{"id_slot":0,"filename":"slot-ok.bin","n_saved":45,"n_written":1416988,"timings":{"save_ms":5.85}}`; restore → **200** `{"n_restored":45,"n_read":1416988,"timings":{"restore_ms":2.948}}`; replay after restore: `cache_n:1, prompt_n:5, tokens_cached:45`.
- Truncated slot file (1,416,988 → 708,495 bytes): restore **refused, HTTP 400**, exact body: `{"error":{"code":400,"message":"Unable to restore slot: No available space in KV cache or invalid slot save file","type":"invalid_request_error"}}`; server alive after (subsequent completion OK, health 200).

LFM2.5-VL + mmproj (new build, app set, `--mmproj LiquidAI__...mmproj-LFM2.5-VL-3B-Q8_0.gguf --image-max-tokens 560`, batch pair floored per argv.rs: `--batch-size 2048 --ubatch-size 1024`):
- Load OK. Image generated locally with System.Drawing: 96×96 PNG, royal-blue background, solid red circle centered (554 bytes), sent as data-URI base64.
- Answer, temp 0: **"A red circle on a blue background."** — exact. 83-token image+text prompt (3766 ms), decode 14.66 tok/s.

## Check 2 addendum — non-ASCII slot filename: FAILS, identically on baseline
Request body on the wire (UTF-8, hex): `7b 22 66 69 6c 65 6e 61 6d 65 22 3a 22 63 6b 70 74 5f c3 a9 2e 62 69 6e 22 7d` = `{"filename":"ckpt_é.bin"}`. Populated slot (45 tokens) in both cases; ASCII save immediately before returned 200 both times.

- **New build 904d38fad** (controlled run 12, curl, fresh server): `POST /slots/0?action=save` → **HTTP 500**, exact body:
  `{"error":{"code":500,"message":"Unable to save slot: slot save file size does not match the appended context checkpoints","type":"server_error"}}`
  Server stays alive (health 200, completions OK). Disk left behind: 0-byte `ckpt_é.bin` + orphan `ckpt_é.bin.<n>.tmp` files (one 1,416,908 B ≈ full save data). Server log: `send_error: task id = 23, error: Unable to save slot: slot save file size does not match the appended context checkpoints`; restore attempt logs `llama_state_seq_load_file: error loading sequence state file: failed to open C:\Users\gualt\slots-tmp\ckpt_é.bin: No such file or directory` (name mangled in the fopen path). Restore of the non-ASCII name → HTTP 400 (same "Unable to restore slot" body as above).
- **Baseline copy v1.1.5** (full app argset accepted, no fallback needed): non-ASCII save → **HTTP 500, byte-identical body** to the new build; same orphan `.tmp` (1,159,332 B); server alive (health 200). ASCII save/restore on baseline: 200/200 (`n_saved:38, 1203512 bytes / n_restored:38`).
- Conclusion: the non-ASCII slot-save failure is **pre-existing** (present in the shipped v1.1.5 engine, unchanged by the merge to 904d38fad), same HTTP status, same message, same on-disk debris.
- State-dependent variant worth knowing: on the new build, a non-ASCII save issued right AFTER a *failed* restore returned **200 with `"n_saved":0,"n_written":124`** (silent empty save, 0-byte file) instead of the 500 — the non-ASCII path can also drop data silently depending on slot/checkpoint state. Not reproducible from a clean populated slot.

## Check 3 — Vulkan: NOT RUN
No Vulkan SDK on the machine (VULKAN_SDK empty; no C:\VulkanSDK; no glslc). Per instructions nothing was installed; no Vulkan variant built. Baseline (a Vulkan build) was only exercised CPU-only with `-ngl 0` for Check 1.

## Cleanup
- Every llama-server/kalsa-server instance I started was Stop-Process'd and verified gone ("server stopped" after each run); port 18192 free at the end; no llama-server/test-backend-ops/kalsa-server processes left.
- One over-broad kill: my sweep matched any process named `curl` and stopped 2 curl processes belonging to `C:\Program Files\Palo Alto Networks\DEM\curl.exe` (the machine's own telemetry agent, not started by me). They are transient stateless requests; no lasting effect observed, flagged for transparency.
- Deleted: C:\Users\gualt\kbase, C:\Users\gualt\slots-tmp (with all slot files incl. orphans). Verified gone.
- KEPT for the fix re-run: `C:\Users\gualt\kb11514` — **343 MB total** (source ≈ 170 MB + build-cpu 172.7 MB, Release, ready to rebuild incrementally). Also kept (not requested, useful for the re-run): C:\Users\gualt\logs\*, all 00–13 .ps1 scripts, kb11514.zip, resp-*.json/req*-out.json evidence files.

## Exit-code ledger
build 0; tbo MUL_MAT 0; tbo MUL_MAT_ID 0; 05/06 (check 1 servers) 0; 07 (MTP slots) 0; 08 (LFM vision) 0; 09 (baseline slots) 0; 10 (invalid curl quoting — discarded, superseded by 11/12) 0; 11 (curl re-capture) 0; 12 (controlled non-ASCII) 0; cleanup 0.
