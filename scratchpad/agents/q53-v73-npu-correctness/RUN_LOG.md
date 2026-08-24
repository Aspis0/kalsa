# q53 RUN_LOG

Measurement cell: q53-v73-npu-correctness
Locked pre-registration: commit 7ec4c231
Serial: adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp

## Start declarations

- Lock/read declaration: PREREG.md read before measurement actions.
- Device state: adb `device` at 2026-08-24T16:33:57Z UTC.
- Battery level / temperature / plugged state at start snapshot: 72%; 25.3 °C (`temperature: 253`); unplugged (`AC=false`, `USB=false`, `Wireless=false`, `Dock=false`).

## Immutable preflight

- q46 device build: `/data/local/tmp/kalsahtp`; model: `/data/local/tmp/LFM2.5-8B-A1B-KEXP-fromsrc-trunk-q8_0.gguf`.
- Device build presence: `llama-perplexity` absent from `/data/local/tmp/kalsahtp`.
- Device `/data`: 104G total, 95G used, 8.3G available, 92%.
- Device sha256sum pins:
  - `/data/local/tmp/kalsahtp/llama-bench`: `5db18906bfe159ba97da18404c513886a5b2a07ec715c18dda7a1bc2d6d38507` — MATCH.
  - `/data/local/tmp/kalsahtp/libggml-hexagon.so`: `f06aa3098f63fd4f419d9943063a07a4718fc32832a919734d0094fccdea6448` — MATCH.
  - `/data/local/tmp/kalsahtp/libggml-htp-v73.so`: `c8f9d14a388455ec364e99d4f63dbee773a4bad6de204b61496fe128f125edd5` — MATCH.
  - `/data/local/tmp/LFM2.5-8B-A1B-KEXP-fromsrc-trunk-q8_0.gguf`: `38a93d7120ef217effba39e4490d341ce02a0ed04fef899d65b03c1322a1b13a` — MATCH; size 3,580,407,296 B.
- q43/q41 corpus: `scratchpad/agents/q41-ppl-gate/corpus/wikitext-2-raw/wiki.test.raw`; PC Python hashlib sha256 `173c87a53759e0201f33e0ccf978e510c2042d7f2cb78229d9a50d79b9e7dd08`; size 1,290,590 B; matches q43 prefix `173c87a53759…`.
- q46/q48 binary provenance from artifacts: kalsahtp source commit `3f545beccee69d9975f466ec7e45fd9aacd8ba90`; device JSON build commit `3f545bec`, build number 10587.
- Rebuild source worktree: `upstream-hexagon/llama-q53-3f545be`, detached at `3f545beccee69d9975f466ec7e45fd9aacd8ba90`; main source worktree not switched.
- Rebuild flags copied from q28/q46 v73 recipe: Android arm64-v8a, android-31, Release; `-march=armv8.7a+fp16+dotprod+i8mm -fvectorize -ffp-model=fast -fno-finite-math-only -flto -D_GNU_SOURCE`; Release `-O3 -DNDEBUG`; `GGML_OPENMP=OFF`, `GGML_LLAMAFILE=OFF`, `GGML_OPENCL=OFF` unless explicitly available (q46 build context was HTP v73), `GGML_HEXAGON=ON`, `LLAMA_OPENSSL=OFF`, tools/tests enabled, `PREBUILT_LIB_DIR=android_aarch64`.
- Configure wrapper’s first direct invocation rejected spaced flag parsing before CMake; no source or build artifact was modified by that invocation. Corrected command-file configure completed successfully; CMake reported ggml commit `3f545becc`.
- Cross-build: completed `rc=0`, low priority `BELOW_NORMAL`, Ninja `-j 4`, target `llama-perplexity`; 258/258 steps. PC Python hashlib:
  - `build-android-hexagon-q53/bin/llama-perplexity`: `4aef69d7b032db4fea15d5fab86041328c2180b0086f74656c319d9331f7ba50`, 7,560 B.
  - `build-android-hexagon-q53/bin/libllama-perplexity-impl.so`: `344a81ff021cd110abe966e7daf535efcaeb50dc4d777cb12ee751b9d1a4af4f`, 1,870,368 B.
- Existing device shared-library hashes were recorded and left unchanged: `libllama.so` `1538010abebf249ddaccfa44e1c1d22b995c6174c5b62d434e471daa80a291ab`, `libllama-common.so` `1ff3a30644cb9b3c227900f36f803277cc894c9aaa92b2f5df0cb9de74d8cb6a`, `libggml.so` `2c7e4fe18df856f136dc6f899b50f33f3ea7103c563bb0aab0d587fe75a57ded`, `libggml-base.so` `e5565847e40a510ea5a1b47ba713344d0d8a97e60f2f0b3f0278fe1a6dc9e5b4`, `libggml-cpu.so` `65faaee251cdf01660427e1204df020eef827023f31998d45c9d6256fb0598af`.
- PPL binary push: `/data/local/tmp/kalsahtp/llama-perplexity` and `/data/local/tmp/kalsahtp/libllama-perplexity-impl.so`; no model push. Device sha256sum matches PC for both. `llama-perplexity --help` executed from `adb shell` with q46-style library paths and returned rc=0.
- Secondary tool check: no `llama-cli` in q46 device build. Same pinned commit/flags target `llama-cli` attempt 1 and attempt 2 both rc=1 at `llama-ui-embed` host compile: Android clang reported `inttypes.h` missing. No alternate binary or flags used; secondary generation is recorded unavailable.
- q49 prompts: `scratchpad/agents/q49-marco-bprime-axisB/prompts.json`, PC Python hashlib `56574436b342d71464b58fd66982a2dbf8b9fb3f5fb14ddf12bf01cca2aacfb9`, 14,902 B. First five IDs are `fact_it_01` through `fact_it_05`; no generation run after the two mandated CLI build failures.
- Corpus device check before push: no `/data/local/tmp/**/wiki.test.raw` found. Allowed corpus-only push completed to `/data/local/tmp/wiki.test.raw`; device sha256sum `173c87a53759e0201f33e0ccf978e510c2042d7f2cb78229d9a50d79b9e7dd08` MATCH.
- Lane 2 eligibility: `/data/local/tmp/kalsahtp/Qwen3.5-4B-Q4_0.gguf` already present, 2,583,221,408 B, PC/device sha256 `298fcb5fe7a77ccc79745ae24751560c5ac56874caff4bb39b1f2055bd72b8bb`; q46/q48 artifacts record this dense Qwen 3.5 Q4_0 model running on HTP0 with the same v73 build. Lane 2 is eligible; no model push.

## Runtime records

- LFM HTP execute-op probe: PID 690, cpuset `/`, `RC=0`; local raw log has 1,667 `execute-op` lines including HTP `MUL_MAT` operations. Pre 72%/25.4 °C/unplugged at 2026-08-24T16:54:05.711037Z; post 71%/29.7 °C/unplugged at 2026-08-24T16:54:56.969405Z.
- LFM HTP PPL: PID 2083, cpuset `/`, `-c 2048`, 32 chunks, `RC=134`; terminal raw error `HTP0 dspqueue_write failed: 0x00000001` after chunks 1 and 2 (`[1]34.2815,[2]35.8966`). Pre 71%/29.7 °C/unplugged at 2026-08-24T16:54:57.101639Z; post 68%/31.8 °C/unplugged at 2026-08-24T17:06:28.517896Z.
- LFM CPU-reference PPL: PID 7558, cpuset `/`, launched from `adb shell`, `-ngl 0`, `-c 2048`, 32 chunks. Original host wait exceeded 3600 s; a device-side wait reconnect was used, then that watcher exceeded 7200 s while PID 7558 remained live. The binary subsequently completed all 32 chunks; terminal line `Final estimate: PPL = 32.4892 +/- 0.66534`. Local raw log is 1,454 B. Pre snapshot was 68%/31.0 °C/unplugged; last available device snapshot after completion was 22%/32.8 °C/unplugged.
- Lane 2 HTP execute-op probe: PID 31371, cpuset `/`, `RC=0`; local raw log is 10,463,161 B. Pre 22%/32.7 °C/unplugged at 2026-08-24T20:54:24.694347Z; post 21%/33.8 °C/unplugged at 2026-08-24T20:56:53.088042Z.
- Lane 2 HTP PPL: PID 32279, cpuset `/`, `-ngl 99 -dev HTP0`, `-c 2048`, 32 chunks. Raw log reached chunk 8 (`[1]7.9075,[2]9.4123,[3]9.8187,[4]9.9195,[5]9.8501,[6]8.4025,[7]7.5301,[8]7.4312`) before the preregistered serial disappeared from adb. Launcher returned `adb_rc=255` at 2026-08-24T21:12:45.495108Z; no final PPL was available and the remote log could not be pulled.
- Lane 2 CPU-reference PPL was not launched on-device: the runner reached it after the Lane 2 HTP disconnect, and the required serial was unavailable (`adb device not found`).
- Device connectivity: the required serial `adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp` was absent from `adb devices` after 2026-08-24T21:12:45.495108Z; mDNS later advertised the endpoint but TCP connection was actively refused. End declaration: last known 21%/33.8 °C/unplugged before disconnect; final battery read unavailable due adb loss.
- Secondary generation: unavailable; the same pinned/flagged `llama-cli` cross-build failed twice at Android `llama-ui-embed` compile with missing `inttypes.h`, so no `gen/` outputs were produced.
- Gate arithmetic: `PPL_HTP_LFM=NaN` (HTP arm terminated without a final estimate), `PPL_CPUref_LFM=32.4892`, `r=NaN`; frozen gate result `FAIL`. Lane 2 has no terminal pair because of device disconnect.
