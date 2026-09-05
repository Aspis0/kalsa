# PREREG — S5b: governor TTFT on a large, uncached prefill

Date: 2026-09-05. Lock before the first QDC launch. This cell measures the
large user-tail prefill inside the app; it is not a no-prewarm cold-context cell.

## Motivation and hypothesis

S5 reports that the prewarm KV leaves “only 15 tokens are new in both arms”
(`/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-governor-s5/REPORT.md:245`),
so this-turn TTFT was a cached-tail comparison. Its only large-prefill figure was
the prewarm, “far below fork cell #38’s roughly `10×`” (`/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-governor-s5/REPORT.md:239`).

Hypothesis: on the same 8 Elite board, APK, model, sampler, and fixed large user
prompt, governor B’s GPU prefill is at least 3× faster than CPU A: B/A ≤ 1/3.
The result is reported with the native `prefill_ms` and `prefill_chunks` fields.

## Fixed materials and uncached mechanism

Model: `/Users/marco/kalsa-qdc/models/LFM2.5-2.6B-QAD-Q4_0.gguf`,
1,593,894,944 bytes, SHA-256
`a247afd6414918eac8e520a9e6137dc271235461ecbe1180462221d5b8d40b03`.
The driver verifies the local/device SHA and uses `run-as` for app data.

APK: `/Users/marco/kalsa-qdc/apk/apk-gov-8a56edc/kalsa-apk-arm64-v8a-debuggable-8a56edc8926e388f27ceb575afd86024d35d3057/app-release.apk`,
branch `feat/governor-in-app` @ `8a56edc`, SHA-256
`272f4547b097b0738f278e14fad50da0478b5533504d82e7eaefba99caf59946`;
the locked artifact must show `application-debuggable` and installed flags must
show `DEBUGGABLE`. Model/APK/prompt are fixed; any identity mismatch aborts.

Prompt: `/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-governor-s5b/PROMPT.txt`,
893 whitespace words, 5,142 bytes, SHA-256
`9109f58516104950079a4a4ecbcd46b557b598741227e893c275bece27079ea6`.
It contains lowercase English words and spaces only. The driver converts spaces
to Android `input text` `%s` escapes and sends one fixed argument after prewarm.

The inspected app has no `kalsa.bench.prewarm` key. `queueStaticPrefixPrewarm`
is active whenever the app is active and sends system/tools plus user `"."`
(`/Users/marco/Projects/kalsa-wt-governor/src/engine/LlamaService.ts:704-775`).
The existing bench keys are sampling, thermo, governor force, engine, norepack,
speculative, and toolgate; none disables prewarm (`/Users/marco/Projects/kalsa-wt-governor/src/engine/LlamaService.ts:1204-1219,1298-1303`,
`/Users/marco/Projects/kalsa-wt-governor/src/engine/governorInputs.ts:9-10,137-175`, `/Users/marco/Projects/kalsa-wt-governor/src/engine/benchSampling.ts:3,21-48`). S5b therefore
does not invent a prewarm key. The fixed user message differs from the prewarm
probe at the user boundary, so the static system/tools prefix may be reused but
the 893-word user tail is newly evaluated. Fresh app data is used per turn.

## Arms, order, and sampling

A: `kalsa.governor.enabled="0"`, single-context CPU. B:
`kalsa.governor.enabled="1"`, governor. Same board, APK, model, prompt, and
SQLite AsyncStorage injection; run exactly `ABABABAB`, with turns 2–4 as plateau.
QRD8750/8 Elite is first and the only valid device. QRD8650/Adreno 750 is
gated off before the run because its GPU-prefill correctness is not accepted.
Session name: `S5b-8Elite-large` (under 30 characters). Budget: 45-minute
session cap, 40-minute driver deadline, and 600 QDC minutes before booking.

For both arms, `kalsa.bench.sampling="greedy"` forces temperature 0, top_k 1,
top_p 1, min_p 0, repeat/presence/frequency penalties off, seed 42, and
`n_predict` ≥ 48. Each completed turn must log one
`KALSA_BENCH_TOKENS {"turnId":"<id>","n":<count>,"ids":[<first 32 ids>]}`.
The driver requires `tokensPredicted ≥ 1` for telemetry; missing/short token
evidence is oracle VOID only and does not timeout a completed turn.

## Thermo, endpoints, and promised data

Before every turn the driver refreshes `kalsa.bench.thermo` from HAL skin:
`batt_temp_tenths_c=round(skin*10)`, level 100, `plugged=false`,
`sensor_valid=true`, `t_idle_valid=true`, first-skin `t_idle_c`, and measured
trend. The QDC board’s plugged report is not used; the override is not production
input. Record skin before/after, thermal state, memory, lmkd, fallback, and exits.

Primary endpoint: for each valid cool B turn, native B `prefill_ms` divided by
A `KALSA_TELEMETRY promptMs` on this large prompt; report B/A, chunks, prompt
size, and all turns. PASS expectation is B/A ≤ 1/3 (GPU ≥ 3× faster). Secondary:
greedy oracle PASS, decode tok/s, `commit_ms` versus prompt size, governor fields,
skin, memory, and fallback/lmkd counts. WARM/HOT CPU B rows are valid thermal
degradation evidence but are not GPU-speed observations; a FAST B row must use
GPU prefill and CPU decode.

TSV header:
`arm turn ttft_ms prefill_ms prefill_chunks decode_tps engine_prefill engine_decode thermal_state skin_c_before skin_c_after fallback_count lmkd_count ids_sha oracle`.
Use adjacent A/B pairs for the oracle; first 32 IDs must match for PASS.

`promptMs` is the native completion timing: `roundTelemetryFromResult` copies
`result.timings.prompt_ms` (`/Users/marco/Projects/kalsa-wt-governor/src/engine/turnTelemetry.ts:164-177`),
and the completion occurs after the bench reads (`/Users/marco/Projects/kalsa-wt-governor/src/engine/LlamaService.ts:2787-2792,3174`).
Thus driver typing, UI wait, launch, and prewarm are outside promptMs; input
typing time is not silently counted as prefill.

## Abort, VOID, and threats

Abort on device/APK/model/prompt identity, disconnect, install/run-as/load/prewarm/UI
failure, invalid thermo, process crash, counted kill, FAST B non-GPU route, or
skin ≥42 °C; preserve raw evidence and write `END.txt`. A failed wake/uninstall
or missing telemetry is status 1. First-turn absence of `KALSA_BENCH_TOKENS`
writes `PREREQUISITE.txt` and exits 3. A short EOS is oracle VOID, not abort.

Threats: the static prefix remains warm, so this is a large uncached user tail,
not a full cold prompt; `input text` may truncate or alter a long argument and
the code cannot prove its exact model-token count before device execution. The
fixed prompt SHA/byte check and raw UI/log evidence expose that risk. Thermal
override, USB/power behavior, two-context memory/commit cost, and QDC variance
limit production and generalization claims. Unresolved from source: whether
the target IME preserves the full 5,142-byte `input text` payload end-to-end.
