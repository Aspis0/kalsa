# S23 LFM governor long session — 2026-09-27

## Outcome

The campaign stopped before turn 1 (`EXIT=1`). It did not produce any valid turns or timing results. The app reached the governor load plan and completed model prewarm, but the device-share readiness gate never found `Pronto` or `Ready` within 240 seconds. The native-log setup then failed to deliver its enable command. No campaign code was changed.

The campaign ran from `/Users/marco/Projects/kalsa-wt-iroh` at `2641144cff9ca70d4ddcab981e650b144aac2773`; this is one app-only commit above the coordinator's stated `91b10eda`. That commit changes only `KalsaIrohModule.kt`; the campaign/device-share scripts are unchanged from `91b10eda`.

## Per-turn evidence

| Turn | Route by phase | Prefill ms | Decode tok/s | Governor pauses/kills | Thermal status / skin / battery temp / level | Awake | Answer OK |
|---|---|---:|---:|---|---|---|---|
| None | No turn started | — | — | — | No per-turn sample | — | — |

The model load emitted `KALSA_NATIVE_VARIANT {"androidLib":"rnllama_jni_v8_2_dotprod_i8mm_hexagon_opencl","nGpuLayers":{"prefill":99,"decode":0}}`; this describes the configured GPU-prefill/CPU-decode split, but no user turn ran, so it is not evidence of per-turn routing. The load log also emitted `KALSA_GOVERNOR_PLAN {"gpu_fit":"Fit","decode_repack":false,"required_mib_with_repack":4518.12,"required_mib_without_repack":2998.06,"available_mib":4116.83,"bench_norepack_forced":null}` and `KALSA_PREWARM` `op=done`. No answer from this attempt is counted.

Key driver lines:

```text
[ci] never reported Pronto/Ready after 240s
[ci] FATAL: native log setup: could not deliver bench:nativelog on
[ci] native log teardown: restoring previous preference
```

This is a readiness/protocol failure before the turn loop, not a thermal, battery, or charging stop. The APK provenance gate passed. It was the expected debuggable `ae64564d` APK (SHA-256 `cd644477c08d4d3d21cec0f3e756eed3b4a53e0c9814f9347ff0ce0ea7e26ecc`), `run-as` worked, and the governor preference was written before launch. Because the APK is debuggable, any tok/s would be diagnostic only; this attempt recorded none.

## Preflight and cleanup

At campaign start the TLS S23 was unplugged, battery 81%, battery temperature 28.0 °C, thermal status 0, `persist.traced.enable=0`, screen Awake, and Kalsa focused. No llama/bench process was present. The phone remained unplugged throughout the run.

The runner's failure cleanup unexpectedly deleted `screen_off_timeout` and left the display Dozing with the launcher focused. I restored the timeout to `2147483647`, woke/dismissed keyguard, and relaunched Kalsa. Final readback: Awake, Kalsa focused, timeout `2147483647`, unplugged, battery 80%, temperature 29.0 °C, traced 0, no llama/bench process. No app data was cleared. The phone was left with the screen on.

All driver, logcat/fatal snapshots, effective/original configs, self-test logs, APK hash, preflight and cleanup checks are in `raw/s23-20260927/`. The two host suites passed (`harness:campaign` exit 0; standalone defects suite `passed=74 failed=0`).

## Readiness gate diagnosis — 2026-09-27

The gate is an exact XML substring check, not a logcat check or regex: `scripts/device-share-send.sh:37` defines `_SHARE_READY_LABELS=("Ready" "Pronto")`; `scripts/device-env.sh:107-119` runs `uiautomator dump /data/local/tmp/ui.xml` and reads it back; `scripts/device-env.sh:121-127` applies `grep -qF` to the entire XML. `scripts/campaign/conversation.sh:111-125` repeats this every five seconds for 240 seconds. Source excerpts are saved in `raw/s23-readiness-20260927/source-excerpts.txt`.

The status row is only rendered inside `ModelPillSheet`: `ShellStrip.tsx:129-135` sets its `visible` from `sheetVisible`, and `ModelPillSheet.tsx:26-63` places `ModelBar` inside that modal. Thus the ordinary chat screen does not expose the row that can contain Ready/Pronto. Current main-screen XML has no Ready/Pronto in either `text` or `content-desc`. It instead reports `<node text="In attesa: il modello va caricato di nuovo" ... class="android.widget.TextView" ... enabled="true" />`; the composer is `<node resource-id="shell.composer.field" ... class="android.widget.EditText" ... content-desc="Messaggio" ... enabled="true" />`; the empty-composer send control is `<node resource-id="shell.composer.send" ... content-desc="Invia" ... enabled="false" />`. See `ui-after-60.xml`.

The fresh manual launch could not produce a new prewarm: storage still had `kalsa.governor.enabled=1` and `kalsa.load.dead.lfm2.5-2.6b=1`; logcat said `KALSA_PREWARM {"op":"skip","reason":"not_ready"}` and `KALSA_LOAD ... "refusedBy":"marker"`. The safety marker was left untouched. The earlier same-session successful governor-on load is the relevant timing proof: first app log `12:59:42.838` to `KALSA_PREWARM op=done` at `13:00:04.286` = 21.448 s; protocol marker `12:59:42.960` to done = 21.326 s. Prewarm itself was `12:59:49.891` to `13:00:04.286` = 14.395 s. Despite `op=done`, the gate exhausted its 240 s loop without seeing either label. Therefore 240 s is not too short for model loading; the ready UI was never observed by this main-screen matcher. No independent Ready UI moment was captured because the ready text is in the closed model-status sheet.

`bench:nativelog on` delivery uses `ACTION_VIEW` with a URL-encoded `kalsa://share?text=...` deep link (`device-share-send.sh:154-164`), then waits for composer text and taps Send; it does not type with `input text`. The campaign log shows `share preflight ... expected=none current=none`, then `never reported Pronto/Ready after 240s`, followed by `FATAL: native log setup: could not deliver bench:nativelog on`; there are no `share-send attempt` lines. `campaign_ensure_launch_pid` returns on its `campaign_wait_ready` failure before `device_share_intent` is reached. This failure is therefore downstream of the readiness precondition; the deep-link send itself was not independently tested. Logs: `prior-campaign-driver.log`, `prior-campaign-logcat.txt`, and `prior-campaign-timeout-ui.txt`.

Preflight/final checks are saved in this raw directory: phone unplugged, traced 0, display Awake, Kalsa foreground. No harness/app edits, app-data clearing, marker deletion, or `kalsa.bench.thermo` writes were made.
