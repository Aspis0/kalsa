# q66 — App lifecycle under real phone use (Kalsa APP, S23) — PREREG

**Status: LOCKED at commit time (orchestrator, 2026-08-26 night; owner GO "vai, delega… installarla
sul S23 e girare"). No q66 number existed at lock. Measurement starts only after PREP.md reports
`Q66 PREP: READY` (fresh APK with the kalsallama engine installed on the S23).**

## Question
Every Kalsa cell so far ran the CLI from `adb shell`. Nobody has measured what happens to the
model process when the user **uses the phone**: Home, camera, browser, coming back after seconds
or minutes. With q64's cache constant (auto ≈ 3.4 GB) + dense anon (~1.7 GB) + KV, the app holds
~6 GB anonymous memory on an 8 GB phone — a backgrounded app of that size is a prime LMK target,
and `adb shell` processes have a different OOM priority than apps, so the CLI cells cannot see it.
Outputs: does the process survive; if killed, when and by whom (LMK / ActivityManager); time to
usable again (reload cost); is the in-flight turn lost or resumed; does the answer change with the
cache size.

## Device / build (frozen)
- Galaxy S23 (8 GB), wireless adb `R3CW406P8CV`, **unplugged or plugged both allowed (not a
  thermal cell; state recorded)**, battery ≥ 40 %, guard q56 running anyway (WARN 40 / KILL 43
  on the app's engine pid), cool start ≤ 32 °C not required but temperature logged.
- APK: the build recorded in `PREP.md` (sha256, engine commit `a0cabca6b` of kalsallama or as
  recorded), installed with `adb install -r`; app package/version from `dumpsys package`.
- Model: Marco-Mini-Instruct-KEXP (6.4 GB, fits in RAM: streaming OFF, dense+experts resident
  as the app configures) as the primary model — the product model; if PREP shows the app can
  select a > RAM model (Marco i1 10.5 GB, streaming ON, cache auto), that is the secondary
  scenario set. Prompt: a fixed 64-token question producing ≥ 200 tokens of answer (greedy or
  the app's production sampler — recorded; not compared across runs).
- Driving: adb only (`am start`, `input keyevent KEYCODE_HOME`, `am start` of camera and
  Chrome, `input tap` per LIFECYCLE_HOOKS.md), never by hand; every step timestamped.

## Scenarios (frozen; each repeated N = 3, order fixed A→E per block, 3 blocks)
A. **Background during generation**: start a turn, at ~5 s of decode press Home, wait
   {10 s, 120 s, 600 s} (three sub-arms), return to the app. Record: process alive?; if alive,
   did decode continue in background (token count in logcat vs time) or pause?; turn completed,
   truncated, or lost?; time from tap-back to first new visible token.
B. **Background idle with model loaded**: after a completed turn, Home, then "normal phone use"
   script for 5 min: open camera (30 s preview), open Chrome and load 3 pages (30 s each), open
   Settings, return. Record alive/killed (pidof + `logcat -s ActivityManager lowmemorykiller`),
   the kill time if any, `dumpsys meminfo` of the app before/after, oom_score_adj timeline
   (sampled every 5 s), MemAvailable timeline.
C. **Memory pressure while foreground**: with the model loaded and idle in foreground, launch
   camera via intent to the foreground for 20 s and come back (the app goes to background for 20 s
   only) — the short-background boundary.
D. **Cold return**: after a kill in B (if any), tap the app icon: time to model-ready (reload;
   logcat load line), chat history preserved (yes/no), previous partial answer preserved.
E. **Cache-size variant** (only if the app exposes the cache setting or the > RAM model): repeat
   B with cache {auto, 1500 MiB}; else record "not exposed".

## Frozen derivations
Per scenario: survival rate over N; median time-to-kill (B) and time-to-usable (D); decode
tokens produced in background (A) per sub-arm; memory: app PSS / private dirty foreground vs
background, oom_score_adj foreground vs background (the number Android uses to pick victims).
Verdicts (pre-declared wording): **SURVIVES** (≥ 8/9 alive across A+B, turn completes or
resumes), **DIES-IN-BACKGROUND** (killed in B in ≥ 2/3 blocks → product action: trim the cache
on `onTrimMemory`/background, or keep a foreground service — design item, not decided here),
**DIES-ON-SWITCH** (killed already in A at 10 s or in C). Any kill = the datum, never retried
inside a block.

## Hygiene
Stop rule for the ENGINE (exact substrings in logcat): `ggml_abort`, `GGML_ASSERT`, `Aborted`,
`Segmentation`, `SIGSEGV`, `Fatal signal` from the app pid → record, one retry of that block.
LMK kill is NOT a stop condition (it is the measurement). No deletions on the device; the
previous APK backed up (PREP) and restorable. Guard q56 on the engine pid (the app's process).
Outputs: RUN_LOG.md (timestamped adb script + observations), manifest.json (apk sha, package
version, model sha, device state, battery/temps, scenario order), raw/ (logcat slices, meminfo,
oom_adj samples, MemAvailable samples, screenshots at key moments via `screencap`), REPORT.md
numbers only + `finalize_q66.py`. Audit before bank (math = DeepSeek, doc = mimo).
