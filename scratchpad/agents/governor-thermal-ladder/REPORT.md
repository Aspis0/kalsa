# S23 governor thermal ladder — partial attempt

Status: the requested comparison is incomplete. Only the first GPU-requested, 5-thread arm was started. It was manually stopped when Android thermal status reached 3; later arms were withheld at 31% battery because the fixed stop floor is 30% and the first arm had already consumed at least five displayed percentage points. No comparative cooling or thread-count verdict is supported.

## Setup and controls

- Device: Galaxy S23 / SM8550, TLS adb endpoint `adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp`. The installed debuggable `ae64564d` APK and LFM2.5-2.6B were used; no install, uninstall, data clear, or `kalsa.bench.thermo` write occurred.
- Preflight: unplugged (AC/USB/wireless all false), 40%, battery 30.7 °C, Android thermal status 0, `persist.traced.enable=0`; no `llama|bench` process. Screen was Awake and Kalsa foreground throughout each sampler row. `/sys/class/power_supply/battery/{current_now,voltage_now}` returned Permission denied, so energy used `dumpsys battery` current-now (mA) and voltage (mV), integrated trapezoidally from 2 s samples.
- Governor load evidence: `KALSA_GOVERNOR_PLAN {"gpu_fit":"Fit",...}`; `KALSA_NATIVE_VARIANT {"androidLib":"rnllama_jni_v8_2_dotprod_i8mm_hexagon_opencl","nGpuLayers":{"prefill":99,"decode":0}}`; `KALSA_PREWARM ... {"op":"done","promptMs":14237.494,"promptN":1660,...}`. The Governor UI state was not changed.
- Route knob exists at `src/bench/benchConfig.ts:38`: `kalsa.bench.route: "cpu" | "gpu" (next-turn prefill-route request; absent/"auto" → engine decides)`. Runtime source says this is a request and engine safety gates remain authoritative (`src/engine/benchRoute.ts`). `bench:route gpu` was acknowledged. The corresponding per-turn `KALSA_GOVERNOR` line is absent, so actual prefill placement for this arm is UNKNOWN; the load-time GPU variant alone is not execution proof. The initial `bench:show`, route-set acknowledgement, and reset acknowledgement are in [configuration-acks.txt](raw/s23-20260927/configuration-acks.txt).
- Thread knob exists at `src/bench/benchConfig.ts:33, 714-779` as `kalsa.bench.engine` / `bench:engine threads=N`; it applies at engine init and requires force-stop + relaunch. `src/engine/threadProfile.ts:9-12` documents the S23 default of 5 threads. `bench:show` reported `engine=default`, `threads_src=capacity`. No `n_predict` / decode-length bench pref exists in `benchConfig.ts`; the fixed prompt requested exactly 256 words, and actual generated tokens are recorded below.
- Prompt bytes: [prompt.txt](raw/s23-20260927/prompt.txt), 4,638 characters / 765 whitespace-separated words; SHA-256 in [prompt.sha256](raw/s23-20260927/prompt.sha256). Newlines were flattened by the app composer, so the saved canonical prompt is the exact composer text; it was staged byte-for-byte before the arm.

## Arm

| Arm | Request / threads | Outcome | Duration | Energy | Prompt / prefill | Decode telemetry | Thermal end / peak |
|---|---|---|---:|---:|---|---|---|
| G5-r1 | GPU / default 5 | STOPPED at Android status 3; actual route unverified | ~279 s from `KALSA_THINKING` to stop tap | ≥344 mWh sampled; final ~130 s unmetered | `prompt_n=2584`; `promptMs=23199.374` ms (intermediate completion) | 780 tokens at 10.108 tok/s (intermediate segment; answer still streaming) | start 30.7 °C/status 0; reached 39.8 °C/status 2 in sampled segment; stop reading 42.9 °C battery / 44.1 °C skin, status 3; battery 40%→35% |

The key lines are in [G5-r1-kalsa.log](raw/s23-20260927/G5-r1-kalsa.log), [G5-r1-post-status3.log](raw/s23-20260927/G5-r1-post-status3.log), and [G5-r1-timeseries.csv](raw/s23-20260927/G5-r1-timeseries.csv). `KALSA_TELEMETRY` reported `tokensPredicted=780`, `predictedPerSecond=10.108...`, `prompt_n=2584`; it was not the completed answer: the UI still showed `I have 204 words, need 256...` and `transcript.stop... Fermato da te` when stopped at status 3. The sampled 344 mWh ends before that stop; total turn energy is unknown.

## Stop and cleanup

Cooldown log is [cooldown-wait.log](raw/s23-20260927/cooldown-wait.log). At 31% the phone cooled below the start limit; final check was 31%, battery 31.6 °C, status 0, unplugged, screen Awake, Kalsa foreground, traced 0, and no llama/bench process ([final-phone-state.txt](raw/s23-20260927/final-phone-state.txt)). The remaining battery margin was insufficient for another ~5-point arm. GPU route was reset and acknowledged with `bench:route auto`; no thread override was written. No CPU-prefill, 3-thread, or 2-thread arm was run. CPU-vs-GPU heat, speed cost, and thread-count heat effect remain unknown.

## Protocol v2 — fresh conversation and bounded workload

No device commands or arms were run for this preparation; the S23 was reported at 31% and is going on charge. Do not benchmark while charging.

### Fresh chat per arm

The `kalsa://share` handler is not a new-chat API: `src/app/shareIntent.ts` parses only `kalsa://share?text=` / `file=`, and `mergeSharePrefill()` appends incoming text to the existing composer draft. It does not change the active conversation. Source: `src/app/shareIntent.ts:1-2,12-23`.

Use the app's own drawer action. `src/theme/components/DrawerContent.tsx:64-82` renders `testID="drawer.newChat"` and calls `onNewChat`; `src/host/conversationActions.ts:118-169` implements it: it switches to an existing empty conversation or creates a new empty conversation with `createEmptyConversationMeta()` and binds it active. It does not delete or clear chat data. Source `src/host/HostRoot.tsx:219` opens the drawer from the menu.

For each future arm, with Kalsa already on its chat screen and awake/unlocked, run from the lab root:

```sh
cd scratchpad/agents/governor-thermal-ladder
SERIAL=adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp
adb -s "$SERIAL" shell uiautomator dump /sdcard/bench-ui.xml > raw/protocol-v2/ui-dump-menu.log 2>&1; echo EXIT=$?
adb -s "$SERIAL" shell cat /sdcard/bench-ui.xml > raw/protocol-v2/ui-menu.xml 2>&1; echo EXIT=$?
```

Read the `bounds="[x1,y1][x2,y2]"` for `resource-id="shell.strip.menu"` in `ui-menu.xml`, tap its center, then dump again and read the center of `resource-id="drawer.newChat"` (or its `New chat` accessibility text):

```sh
adb -s "$SERIAL" shell input tap MENU_CENTER_X MENU_CENTER_Y > raw/protocol-v2/tap-menu.log 2>&1; echo EXIT=$?
adb -s "$SERIAL" shell uiautomator dump /sdcard/bench-ui.xml > raw/protocol-v2/ui-dump-drawer.log 2>&1; echo EXIT=$?
adb -s "$SERIAL" shell cat /sdcard/bench-ui.xml > raw/protocol-v2/ui-drawer.xml 2>&1; echo EXIT=$?
adb -s "$SERIAL" shell input tap NEW_CHAT_CENTER_X NEW_CHAT_CENTER_Y > raw/protocol-v2/tap-new-chat.log 2>&1; echo EXIT=$?
```

Dump once more and confirm the composer is empty and the transcript contains no previous user/assistant turns. If the expected resource-id is absent, stop and inspect the dump; do not use `pm clear`, uninstall, or a share intent as a substitute. To submit the same prompt bytes after the new-chat check, the existing helper sends the file through `kalsa://share` and taps the enabled send button:

```sh
python3 raw/s23-20260927/manual_send.py --file raw/protocol-v2/prompt-v2.txt > raw/protocol-v2/send.log 2>&1; echo EXIT=$?
```

### Output length finding

There is no `n_predict`, `maxTokens`, or output-token benchmark preference/command in `src/bench/benchConfig.ts`; its usage exposes thinking, format, speculative, engine, devmodels, route, and show only (`:6-38,859-860`). `bench:thinking budget256` limits the reasoning budget, not answer length. Ordinary LFM chat does have a hard engine ceiling: `src/engine/ModelRegistry.ts:295` sets LFM `thinking.nPredict: 2048`, and `src/engine/thinkingBudgets.ts:98-99` returns `max(1024, model.thinking.nPredict ?? 1024)`; `src/engine/LlamaService.ts:5148` passes it as `n_predict`. That is a 2048-token ceiling, not a configurable ~256-token decode length.

No bench stop-after-N-tokens command was found. Cheapest practical substitute: the prompt asks for a compact four-field JSON answer and at most 64 whitespace words, and the run must record actual generated tokens from telemetry. This bounds typical answers but is not a hard token guarantee. Do not compare arms as fixed-decode if actual generated-token counts differ; a hard matched decode length requires an app/engine control that this build does not expose.

### Fixed prompt and tokenizer

Exact UTF-8 prompt: [prompt-v2.txt](raw/protocol-v2/prompt-v2.txt); SHA-256: see [prompt.sha256](raw/protocol-v2/prompt.sha256). Host tokenizer: `/Users/marco/Projects/kalsallama/build/bin/llama-tokenize` (Mach-O arm64; `pkg-snapdragon/llama.cpp/bin/llama-tokenize` is Android ELF and cannot run on the Mac). Tokenizer result: **962 tokens**, including BOS, counting the standalone user text only and excluding the app system prompt and chat wrapper. Command and result are in [tokenizer-count.txt](raw/protocol-v2/tokenizer-count.txt). The prior 2584 `prompt_n` was not this user-text count; a fresh chat removes previous transcript history, but runtime system/template tokens still add to the engine's full prompt count.

### Run protocol

1. Wait until unplugged and all existing start gates pass (Android thermal status 0, battery ≤33.0 °C, battery ≥30%, Awake, Kalsa foreground, traced 0, no `llama|bench`). Keep screen on; never set `kalsa.bench.thermo`.
2. Use the same model, prompt file, app settings, and sampling settings for every arm. Create and verify a fresh chat as above. Set `bench:route gpu` or `bench:route cpu` in the composer and verify its acknowledgement; route applies next turn. For thread arms, set `bench:engine threads=5`, `threads=3`, or `threads=2`; this engine override applies at init, so force-stop/relaunch consistently after changing it, then create a fresh chat. Do not change other engine fields.
3. Send the prompt using the helper command above. Record runtime `prompt_n`, route proof, prefill ms, generated-token count, decode tok/s, and 1–2 s thermal/current/voltage samples. An answer that ends naturally may have variable token count; preserve actual counts and mark unequal-decode pairs incomparable. Stop at Android thermal status 3 or 30% battery.
4. Alternate GPU/CPU prefill, two repetitions each; include 5/3/2 decode-thread arms only if the thread override acknowledgement and relaunch are both proved. Return to the exact start point (status 0, battery ≤33.0 °C) before each arm; otherwise withhold it.

### Protocol v2 addendum — phase-only accounting and decode timeout

- Capture device logs with epoch timestamps (`adb -s "$SERIAL" logcat -b all -v epoch`) so they align with the sampler's epoch timestamps. For the single ordinary completion in each arm, anchor the phase interval at the `KALSA_TELEMETRY` event timestamp `T` and its `promptMs` / `predictedMs`: `decode_end=T`; `decode_start=T-predictedMs`; `prefill_end=decode_start`; `prefill_start=prefill_end-promptMs`. Cross-check the start against that turn's `KALSA_THINKING` line and the durations/route against `KALSA_TELEMETRY` and `KALSA_GOVERNOR`. If an arm has multiple rounds/attempts or missing markers, split each logged round separately; do not merge phases into one turn interval.
- Integrate the existing 1–2 s `current_now × voltage_now` samples separately over `[prefill_start,prefill_end]` and `[decode_start,decode_end]`, linearly interpolating power at interval boundaries. Convert mWh with `mWh = sum(power_mW × Δseconds / 3600)`. Report `prefill mWh / prompt_n × 1000` (mWh per 1k prefill tokens) and `decode mWh / tokensPredicted` (mWh per decoded token). Use `prompt_n` from that completion's telemetry; report the actual `tokensPredicted`, including a truncated answer.
- For each phase, report battery and exposed skin temperature at phase start/end and the rise (`end − start`); interpolate boundary temperatures from adjacent samples and include the phase peak. GPU-vs-CPU prefill conclusions use prefill-only energy/token and °C rise, with decode settings held fixed. 5/3/2-thread conclusions use decode-only energy/token and °C rise, with prefill route held fixed. Do not use whole-turn deltas to answer either question.
- Limit any still-running generation at a fixed 60 s after the helper's send tap. At `+60 s`, dump the UI; if the turn is still streaming and the enabled `resource-id="shell.composer.send"` is the stop control, tap its bounds center with `adb shell input tap`. Save the dump and stop-tap log. A stopped arm is marked truncated; use its measured generated-token count and telemetry, and do not treat its output as a natural EOS. Do not stop a completed turn or infer equal decode lengths from the requested word bound.
