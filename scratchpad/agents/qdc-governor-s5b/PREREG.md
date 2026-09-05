# PREREG — S5b: governor TTFT on a large, uncached prefill
Date: 2026-09-05. **LOCKED 2026-09-05 (Mac 07:27 EDT)**: pre-run audit GO-WITH-FIXES → fixes → delta #1 GO-WITH-FIXES (F1 B-VOID abort) → fixes → delta #2 GO (deepseek, `AUDIT-PRERUN.md`). APK `8a56edc` SHA-256 `272f4547b097b0738f278e14fad50da0478b5533504d82e7eaefba99caf59946`; QDC session `S5b-8Elite-r1` (QRD8750). No numbers were collected before this lock. This cell measures the
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
893 whitespace words, 5,142 bytes, auditor-tokenized to 938 model tokens, SHA-256
`9109f58516104950079a4a4ecbcd46b557b598741227e893c275bece27079ea6`.
It contains lowercase English words, spaces, and line breaks only. The driver
converts line breaks to spaces, splits the original text into ≤500-character
chunks, encodes spaces as `%s`, and sends single-quoted commands 0.5 s apart
(11 chunks; expected ≈55–65 s, nominal ≈60 s). Expected composer characters: 5,142.
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
Before Send, the driver dumps the UI and records actual/expected characters and
hint_len; empty text equal to the hint counts as zero. It requires actual ≥90% of 5,142; if short it uses
`input keycombination KEYCODE_CTRL_LEFT KEYCODE_A` then `KEYCODE_DEL`, redumps,
and requires actual ≤3 before retyping once. Send retries only redump/re-find Send and never retype. A still-short
composer is a row VOID, not an abort. Turn-1 total typing over 150 seconds aborts.
## Thermo, endpoints, and promised data

Before every turn the driver refreshes `kalsa.bench.thermo` from HAL skin:
`batt_temp_tenths_c=round(skin*10)`, level 100, `plugged=false`,
`sensor_valid=true`, `t_idle_valid=true`, first-skin `t_idle_c`, and measured
trend. The QDC board’s plugged report is not used; the override is not production
input. Record skin before/after, thermal state, memory, lmkd, fallback, and exits.
Primary speed endpoint: over adjacent oracle-PASS pairs, retain only B rows with
`engine_prefill=GPU` and `thermal_state=FAST`; use the median of each B
`prefill_ms` divided by its same-turn A `promptMs`. Require ≥2 such pairs for a
median; otherwise speed is descriptive only. A WARM/HOT CPU-routed B row is valid
degradation evidence, reported separately and excluded from the GPU ratio. The
fork-cell expectation is B/A ≥3× (equivalently ratio ≤1/3). The S5 same-board
prewarm prior is B/A ≈1.6× (measured 1.647×); pre-register it as supported for ratios 1.4–1.9×.
The report will say whether the data supports the ≥3× expectation, the ≈1.6×
prior, both, or neither. Secondary endpoints: greedy oracle, decode tok/s,
`commit_ms` versus prompt size, governor fields, skin, memory, and fallback/lmkd.
TSV header:
`arm turn ttft_ms prefill_ms prefill_chunks new_tokens_a new_tokens_b decode_tps engine_prefill engine_decode thermal_state skin_c_before skin_c_after fallback_count lmkd_count ids_sha oracle`.
Use adjacent A/B pairs for the oracle; first 32 IDs must match for PASS.
`new_tokens_a` is derived from the turn-anchored native `reusing X/Y` line;
`new_tokens_b` is the integer sum of B `prefill_chunks` (including `cpu:` prefixes).
Each must be within 938 ±10% (845–1031 inclusive); otherwise that row is VOID.
The promised TSV adds `new_tokens_a` and `new_tokens_b` after `prefill_chunks`.
`promptMs` is the native completion timing: `roundTelemetryFromResult` copies
`result.timings.prompt_ms` (`/Users/marco/Projects/kalsa-wt-governor/src/engine/turnTelemetry.ts:164-177`),
and the completion occurs after the bench reads (`/Users/marco/Projects/kalsa-wt-governor/src/engine/LlamaService.ts:2787-2792,3174`).
Thus driver typing, UI wait, launch, and prewarm are outside promptMs; input
typing time is not silently counted as prefill. The driver records per-turn
typing wall time and the composer evidence.
## Abort, VOID, and threats

Abort on device/APK/model/prompt identity, disconnect, install/run-as/load/prewarm/UI
failure, invalid thermo, process crash, counted kill, FAST B non-GPU route, turn-1
typing over 150 seconds, or skin ≥42 °C; preserve raw evidence and write `END.txt`.
A failed wake/uninstall or missing telemetry is status 1. First-turn absence of
`KALSA_BENCH_TOKENS` writes `PREREQUISITE.txt` and exits 3. Short EOS, a short
composer after one retype, and a new-token count outside the 938 ±10% band are
row VOID conditions and do not abort the run.

Threats: the static prefix remains warm, so this is a large uncached user tail,
not a full cold prompt; even chunked `input text` may alter characters and
the code cannot prove its exact model-token count before device execution. The
fixed prompt SHA/byte check, 90% UI-length gate, token-count gate, and raw UI/log
evidence expose that risk. Typing is outside promptMs only if the app timer starts
after Send as inspected above. Thermal override, USB/power behavior, two-context
memory/commit cost, and QDC variance limit claims. Unresolved: whether the target
IME preserves all chunked characters end-to-end.
### Run 1 (sa804790) VOID — mechanism + fix
Run 1 produced no speed/oracle number: one-shot 1,500 chars→1,073 (71%); the
5,142-character strings landed 1,046–1,221, while 3×500 with 0.5 s landed
1,501/1,500. Empty EditText reported text=hint “Ask a question…” (16–17 chars);
the fix is ≤500-char original chunks, 0.5 s, `%s`, escaped single quotes, and
hint-aware zero length with post-clear verification; 11 chunks/expected ≈55–65 s
(nominal ≈60 s); the 150 s cap is retained.

### Run 2 (sa805215): typing fixed, tool-call confound
A1 is excluded: 5,142/5,142 composer characters in 59 s (11 chunks),
new_tokens_a=1,016, CPU promptMs=6,581.954 (uncached), decode=28.36 tok/s;
tools were enabled; this single row has no oracle, produced no speed result, and is not analyzed.
Fixed factors set `kalsa.web.enabled`, `kalsa.tools.device`, and
`kalsa.tools.calendar` to `"false"`; tool-call rows are VOID, not prereq exits.
