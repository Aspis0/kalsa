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
Session name: `S5b-8Elite-large` (under 30 characters). Budget: 90-minute
session cap, 85-minute driver deadline, and 90-minute QDC session.
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
typing over 150 seconds, unparseable thermal skin after retries, or deadline; preserve raw evidence and write `END.txt`.
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

### Run 3 (sa805443): first valid A row, thermal abort
A1 was valid but excluded: composer 5,142/5,142, new_tokens_a=925, CPU uncached promptMs=5,842.393, decode=26.93 tok/s, ids_sha present, structuredCalls=0; one row/no pair. After skin was 42.547 °C (before 33.084 °C; S5 run 7 comparison 34.761 °C); idle probe 42.5→36.04 °C in ≈3.5 min after force-stop, then 33.2 °C at +11 min (≈0.36 °C/min), `/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-governor-s5b/raw/sa805443/`.
Pre-register `COOL_TARGET_C=36.0 °C`, 15 s polls, 10 min cap, `VOID(hot)`, post-turn skin recorded but not gated, and an 85-minute deadline; every turn starts from the same cooled skin, while B `thermal_state` is read from `KALSA_GOVERNOR` at Send.

### Run 4 → run 5 changes
Run 4 recorded four `VOID(hot)` rows under `COOL_TARGET_C=36.0 °C` and a 600 s cap: the post-GPU cooldown samples remained 36.3–37.7 °C, while CPU-turn cooldowns reached 36.0 °C in 150–480 s. Run 4 also recorded ten `logcat -d -b all` failures; the B2 overwrite left a truncated file, so run 5 uses an atomic temporary dump, accepts it only when `rc=0`, non-empty, newline-terminated, and no older in last-line epoch than the last good file, retries three times with 3 s spacing, and parses only the last good file.
Run 5 pre-registers `COOL_TARGET_C=37.0 °C`, 15 s polls, a 720 s cap, and unchanged `VOID(hot)` semantics. The status file records `logcat_rc` and `logcat_retries`; rejected dumps are retained as failure evidence. The existing large uncached prompt, ABABABAB order, oracle, and ≥2 oracle-PASS GPU/FAST-pair speed rule remain locked.
Run 5a was aborted by the orchestrator at A1 with no data: the first logcat dump was 2,034,143 bytes and later complete ring-buffer dumps were 1.85–1.99 MB, so the obsolete size comparison rejected every valid refresh. The correction is epoch/newline completeness; logcat is a ring buffer and dump size is not an acceptance criterion.

### Run 5b → run 6
Run 5b is in progress. A1 typed 5,141 characters in 73 s, one short of 5,142; it passed the diagnostic ≥90% threshold but produced a tool-call VOID. Tool-call VOID now also covers non-web local tools. From run 6, the hint-aware composer must equal `PROMPT_EXPECTED_CHARS` exactly; a short value is cleared and retyped once, then becomes `VOID(reason=composer)` if still non-exact and is never sent. The ≥90% value remains diagnostic only. The `last_epoch` parser formats epochs to three decimals so second/millisecond precision is retained.
Run 6 uses order `ABABAB` with `deadline_minutes=85`. Its pragmatic thermal amendment sets the A/CPU cooldown target to 38.5 °C, the B/governor target to 37.0 °C, and the cap to 900 s. This is forced by the 8 Elite QRD skin plateau at 37.1–37.3 °C after GPU turns, not a change of hypothesis. FAIRNESS CAVEAT: A now starts up to 1.5 °C hotter than B; this can only hurt A through CPU throttling, biasing the comparison against the CPU null and in favour of B. `skin_c_before` is recorded per row; any A row with `skin_before > 38.5` °C is VOID(hot) as before.
With six turns in `ABABAB`, the plateau is turns 2–3 per arm (at most two adjacent A/B pairs); the median rule over valid adjacent pairs is unchanged, and turn 1 of each arm is discarded as before. B has no post-cooldown `skin_before` gate because its 37.0 °C target has always been reached within the cap (75–435 s in runs 4–5b); A gets the 38.5 °C gate. The asymmetry is recorded, not hidden. Falsified in run 6 (2026-09-05, post hoc note): B2 was `VOID(hot)` at the 900 s cap (skin 37.066) after A2 had ended at 47.9 °C, i.e. the B target is not always reachable when A starts warm; a B-side post-cooldown `skin_before` gate or a warm-A→B target is a candidate per-device amendment for runs 7+, to be pre-registered before any bank.

### Runs 7+ — other SoCs (pre-registered 2026-09-05)
The prior driver hard-coded `SM8750|QRD8750) BOARD=8-Elite ;;` (old `d_run.sh:108`); the next driver keys on `ro.product.name` via `device_tag` and uses `ro.soc.model` only to disambiguate shared `pineapple` names, recording both and the tag in `recon.txt`.
Devices and expected `getprop` values, in pre-registered order: QRD7675/SM7675/Adreno 732 (`ro.product.name=pineapple`, `ro.product.model=Pineapple for arm64`, 912 min); QRD8635/SM8635/Adreno 735 (same values, 981 min); HDK8550/SM8550/Adreno 740 (`kalama`, `Kalama for arm64`, 868 min); QRD8650/SM8650/Adreno 750 (`pineapple`, `Pineapple for arm64`, 757 min). Each run records the live values.
Use only corrected ALIVE priors: #52 says `CPU number is build-suspect`; #56 says `l'8s Gen 3/Adreno 735 è pulito e gemello del 732`; #57 says `vecchi numeri CPU RITIRATI`, `mid-tier CONTESTED (GPU solo 1.59×)`, and `750 confermato 2.87×`; #58 records `G4 291/98.97 = 2.94×`. Thus 732/735 use ≈1.59×, 740 has no speed claim, and 750 uses ≈2.87–2.94×. Apply the observed 8 Elite in-app discount range 1.79–1.86× versus the cited ≥3× baseline, a 0.597–0.620 speedup factor, not a point: mid-tier `1/(1.59×0.597…0.620)≈1.01–1.05` B/A (near parity; no measurable governor gain is the legitimate bankable null), and 750 `≈0.55–0.58` B/A (1/(2.94×0.620)=0.549 … 1/(2.87×0.597)=0.584).
The ship model `/Users/marco/kalsa-qdc/models/LFM2.5-2.6B-QAD-Q4_0.gguf` and APK `8a56edc` remain identical. Arms, greedy oracle, prompt SHA `9109f58516104950079a4a4ecbcd46b557b598741227e893c275bece27079ea6`, `ABABAB` order, 85-minute deadline, endpoint definitions (median over at least two oracle-PASS GPU/FAST adjacent pairs), median rule, and VOID rules remain unchanged. QRD8650 is last; its B rows are descriptive/oracle evidence only because the 750 f16/bf16-batched defect is open, and any 750 GPU speed claim stays gated.
For runs 7+, `PASS-1` means at most one differing token index between the A/B 32-token greedy ids, with re-convergence on every later index; PASS-1 pairs count toward the endpoint. This does not apply retroactively to 8 Elite runs 4–6, which remain strict; PASS-1 there may be reported only as exploratory. The rule is motivated by the exact index-29 difference `640` vs `1194` in run 4 and run 6 (`raw/sa805734/` and `raw/sa806967/8-Elite_{A,B}_t1_ids.txt`).
On each new device's first run, A uses 38.5 °C and B 37.0 °C with the 900 s cap: thermal targets are exploratory on the first run; a per-device amendment may follow after run 1, before any bank. The thermo override and HAL skin are recorded per turn.

### Run 7a (sa807321, QRD7675) → run 7b
Run 7a produced no data: A1/B1 were composer VOID and A2 aborted [raw/sa807321a/END.txt:1].
C1 was the 60 s `screen_off_timeout=60000` doze threat; typing stopped at `attempt=initial actual=3821 expected=5142` [raw/sa807321a/7p-Gen-3_A_t1_composer_len.txt:1].
C2 was Android 14 hint omission: cleared text was `Ask a question…`, recorded as `actual=17 ... hint_len=0` [raw/sa807321a/7p-Gen-3_A_t1_composer_cleared.xml:1; raw/sa807321a/7p-Gen-3_A_t1_composer_len.txt:2].
C3 was a transient `/data` permission reset: `run-as: /data readable or writable by others: 40777` despite successful chmod calls [raw/sa807321a/7p-Gen-3_A_t2_model_copy.txt:1; raw/sa807321a/adb-exit.log:12-381].
Run 7b+ uses the unchanged pre-registration at PREREG:132-138, with the new screen-stay-awake, EMPTY_TEXT, and retry-wrapper fixes. The 60 s screen-timeout threat also applies to the remaining boards.

### Run 7b (sa807321) → run 7c
Run 7b lost A1 to `actual=3976 expected=5142 ... empty_text_len=17`, then cleared to zero; typing took `initial_seconds=133 rc=0` and `retype_seconds=55 rc=2 total_seconds=188` [raw/sa807321/7p-Gen-3_A_t1_composer_len.txt:1-2; raw/sa807321/7p-Gen-3_A_t1_type_prompt.txt:1-2].
The 150 s total typing cap caused the VOID; the 11 chunk wake records stayed `Awake` [raw/sa807321/7p-Gen-3_A_t1_ui_attempts.txt:1-11].
Run 7c verifies the composer after every chunk, handles the first-character loss with one chunk-0 retype, and retries other mismatches through the 500 → 200 → 100 ladder, with a 400 s cap per attempt; failure remains `VOID(composer)` and never aborts the run.
PREREG:132-138 remains unchanged.

### Run 7c (sa807902) → run 7d
Run 7c aborted before typing: `raw/sa807902a/7p-Gen-3_A_t1_edit.xml` was 64 bytes (`cat: /data/local/tmp/kalsa-s5/ui.xml: No such file or directory`); the prewarm took 118 s.
The driver now retries `uiautomator dump` five times at 3 s intervals, captures dump diagnostics, and treats an exhausted UI dump as `VOID(composer)` rather than an abort.
The 7d+ run uses the unchanged PREREG:132-138 endpoint and abort rules; no 7c data are analyzed.

### Run 7d (sa807902) → run 7e
Run 7d lost A1 and B1 to `VOID(composer)`: the successful edit dump was 9.6 kB of `com.android.systemui` AOD content with no `EditText` [raw/sa807902b/7p-Gen-3_A_t1_edit.xml].
The board reported `mStayOn=false` and `mIsPowered=false`; bare `KEYCODE_WAKEUP` re-dosed in ≈9 s, while wakeup+dismiss-keyguard+tap stayed Awake for ≥40 s [raw/sa807902b/driver-sa807902.log]. Power facts: `mIsPowered=false`/`mStayOn=false` [raw/sa807902b/wake.log:10,15]; the 9 s re-doze (`mLastSleepReason=timeout`) was measured live by the orchestrator and is not in raw.
Run 7e retries dumps, wakes before each attempt and load poll, taps the composer for user activity, and records `aod`/wake evidence; the unchanged PREREG:132-138 rules remain in force.

## Run 7e — post hoc (written 5/09 18:58 EDT while the run was still going; not a change to the protocol)

Two facts learned from run 7e on QRD7675 (SM7675, `ro.product.name=pineapple`, Adreno 732), both
outside what §"Runs 7+" pre-registered:

1. **Harness trap n. 8 (A1 VOID composer).** Typing at 500 chars/chunk loses characters
   (attempt 1 chunk 3: 1412/1500), the 200-chunk ladder is exact, but at attempt 2 chunk 4
   `adbT 60 dumpsys power` returned rc=255 with a complete dump
   [raw/sa807902/7p-Gen-3_A_t1_typing_wake_4_before.txt, 147 KB, `mWakefulness=Awake`] and
   `typing_awake` treats any rc≠0 as fatal (parse.sh, `typing_awake`, first `adbT ... || return 1`)
   → `send_prompt_chunk` rc 2 → type_prompt rc 2 → VOID [raw/sa807902/7p-Gen-3_A_t1_type_prompt.txt].
   `dumpsys power` rc=255 with good output: 3 of 76 calls in this run [raw/sa807902/adb-exit.log:160,213,352].
   Fix for the next driver: judge wakefulness from the dump CONTENT (`mWakefulness=` present) with
   ≤3 retries; rc alone is not evidence. Same treatment for `dump_ui`'s power check and `poll_load`
   (audit #13 minor).

2. **The governor is inert on this SoC by design, so arm B ≡ arm A here.** B1 logged
   `KALSA_GOVERNOR_FALLBACK {"stage":"correctness","reason":"gpu-prefill-incorrect-Unknown","forced":false}`
   and loaded `offloaded 0/31 layers to GPU` [raw/sa807902/7p-Gen-3_B_t1_logcat_all.txt].
   "correctness" is not a runtime check: app `src/engine/governorInputs.ts` (feat/governor-in-app @8a56edc)
   has `GPU_PREFILL_CORRECT = { V79: true, V75: false, V73: false, Unknown: false }` and
   `generationFor()` maps only SM8550/KALAMA→V73, SM8650/PINEAPPLE(soc)→V75, SM8750/SUN→V79; SM7675 →
   Unknown → `enabled=false` → CPU. Even with the bench key `kalsa.bench.governor_force=1` (read only
   when `kalsa.governor.enabled` is true) the fork policy `llama_governor_policy::prefill_engine()`
   (kalsallama-wt-governor-v03 `src/llama-governor-policy.cpp:160-168`) returns GPU only for V75/V79
   with `gpu_fit==Fit && gpu_prefill_measured`, GPU_COOLMODE for V73 only when `model_kind==MoE`, and
   CPU otherwise; `gpuFit()` also returns NoFit on Unknown. Consequences for the pre-registered device
   list:
   - QRD7675 (SM7675) and QRD8635 (SM8635): Unknown → no in-app GPU prefill path exists. The B/A
     ratio cannot be measured in-app; the pre-registered mid-tier band (1.01–1.05, parity) is
     consistent with the policy's choice (CPU) but run 7e does not test it. What run 7e can bank:
     CPU TTFT of the shipped app on the 732 (A rows and B rows alike), and the fact that the shipped
     governor routes CPU there.
   - HDK8550 (V73): LFM2.5-2.6B is dense → CPU by policy; same situation.
   - QRD8650 (V75): GPU path exists but is allowlisted off (Adreno 750 f16/bf16-batched defect, ALIVE
     38/39/48); `kalsa.bench.governor_force=1` re-enables it for the bench. An in-app A/B is measurable
     there, **descriptive only** as already stated in §"Runs 7+" (strict oracle expected to FAIL at
     token 14 by the known defect; PASS-1 not expected to rescue it).
   Blind spot owned by the orchestrator: §"Runs 7+" was written from ALIVE #57/#58 (CLI kit) without
   reading the app allowlist. It is left as written; this section records the correction.
   Prior check: ALIVE row 36 (cell #52) reported GPU prefill ~11× CPU on this very board, but ALIVE row
   40 (cell qdc-cpu-tuned-57) retired that CPU number as build-suspect and left ~1.6× on the mid-tiers,
   which is the 1.59× used in §"Runs 7+". With the 0.597–0.620 in-app discount that is parity, so the
   shipped policy's CPU choice on the 732 is consistent with the corrected data; the gap is in the
   device table's *coverage* (SM7675 → Unknown), not in the routing outcome.

**Proposed next step (needs the owner's call, not taken unilaterally):** skip the in-app A/B on QRD8635
and HDK8550 (no B arm exists), run QRD8650 with `kalsa.bench.governor_force=1` set in `set_prefs` for
arm B only, pre-registered in a "Run 7 → run 8" section before launch. The rc=255 fix ships first.

## Run 7e → run 8 (QRD8650, SM8650 → V75) — pre-registered 5/09 ~19:05 EDT, before any driver change

Device order changes: QRD8650 is next because it is the only remaining board on which an in-app B arm
can reach the GPU (see §"Run 7e — post hoc", point 2). QRD8635 and HDK8550 are NOT dropped here; they
are parked for the owner's call (no B arm exists there under the shipped policy).

Driver changes (Luna; delta audit before launch):
1. **Wakefulness from content, not rc.** `typing_awake`, `dump_ui`'s per-attempt power check and
   `poll_load` accept a `dumpsys power` capture when it contains `mWakefulness=`, regardless of adb rc;
   otherwise retry up to 3 times; only 3 consecutive captures without `mWakefulness=` are fatal for that
   check (rc 124/255 on all three → transport). Closes trap n. 8 and audit #13's minor.
2. **Arm B forces the governor on V75 only.** `set_prefs` writes `kalsa.bench.governor_force='1'` for
   arm B when `device_tag` is `8-Gen-3`, and `'0'` otherwise (arm A always `kalsa.governor.enabled=false`,
   under which the force key is never read: `LlamaService.ts:1307-1309`). Without this key
   `GPU_PREFILL_CORRECT[V75]=false` sends B to CPU.
3. **B must actually reach the GPU.** A B row whose logcat has `KALSA_GOVERNOR_FALLBACK` or lacks a
   `KALSA_GOVERNOR {` line with `engine_prefill` = GPU is VOID with `void_reason=governor_fallback`
   (new reason; today it surfaces only as `new_tokens_b=na`).
4. **RAM precondition.** `gpuFit()` returns NoFit when total RAM ≤ 8 GiB. The driver records
   `MemTotal` in recon and, for `8-Gen-3`, exits 2 with `GPU_FIT_RAM` before installing if MemTotal ≤
   8 GiB, so a session is not spent on a run whose B arm cannot exist.

Endpoint on QRD8650 (unchanged from §"Runs 7+"): descriptive only. Expected band B/A 0.55–0.58 from
ALIVE #58 (2.87–2.94× CLI) × in-app discount 0.597–0.620. Strict oracle expected FAIL by the known
Adreno 750 f16/bf16-batched MUL_MAT defect (deterministic divergence at token 14, ALIVE 38/39/48);
PASS-1 is not expected to rescue it; the pair (ratio, oracle) is what gets banked, never the ratio alone.
Pairing: same-turn adjacent pairs, median. Cooldown A 38.5 / B 37.0 °C, cap 900 s, first run on this
board thermally exploratory. Order ABABAB, deadline 85 min on a fresh 120-min session.
