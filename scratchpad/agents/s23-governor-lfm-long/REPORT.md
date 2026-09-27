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
