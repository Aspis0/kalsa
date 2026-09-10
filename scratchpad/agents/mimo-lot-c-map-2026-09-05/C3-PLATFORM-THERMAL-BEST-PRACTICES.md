# Platform thermal best practices for Kalsa

Research brief — 2026-09-05. Scope: what well-behaved Android and iOS apps should do when an on-device LLM creates sustained CPU/GPU/memory load. This uses OS policy signals, not app-invented temperature cutoffs.

## Bottom line

Kalsa’s hard gate at platform **CRITICAL** is defensible: stop new inference, cancel/finish-safe any active generation, unload the model, and release other heavy resources. Before that point, respond progressively to the platform’s advisory/throttling states. Do not use ambient warmth, “plugged in,” or fast-charging alone as a hard stop.

## Android

### Signal: listen first; poll only as a supplement

Use `PowerManager.addThermalStatusListener()` for status-change events, and read `getCurrentThermalStatus()` at initialization/resume and when handling an event. Android exposes the status as a platform severity signal; it is preferable to building policy from raw sensor readings. The Android framework also supports polling `getThermalHeadroom()` for sustained workloads: it forecasts proximity to severe throttling and can drive proactive quality/workload reductions. If used, poll no more often than once per 10 seconds; unsupported devices can return `NaN`, and Android warns against relying on status alone on devices with imperfect support. [PowerManager API](https://developer.android.com/reference/android/os/PowerManager), [Android Thermal API / ADPF](https://developer.android.com/games/optimize/adpf/thermal)

### What the statuses imply

| Android status | Platform meaning | Kalsa response |
| --- | --- | --- |
| `NONE` | No throttling. | Normal inference. |
| `LIGHT` | Light throttling; UX not impacted. | Advisory only: avoid adding work; expose `preferGpuPath` as a tuning hint only if profiling shows it is sustainable. |
| `MODERATE` | Moderate throttling; foreground UX is not greatly impacted, but Android recommends reducing power immediately. | Reduce/defer nonessential work; avoid starting a new long generation if it can wait; lower concurrency/throughput. |
| `SEVERE` | Significant throttling; UX is largely impacted. | Stop or defer heavy/background work; do not queue repeated inference attempts. Keep only essential UI/user interaction. |
| `CRITICAL` | The platform has done everything it can to reduce power; components are at their lowest capacity. | **Hard stop:** block new inference and unload the LLM. |
| `EMERGENCY` / `SHUTDOWN` | Components are shutting down / immediate shutdown is needed; a callback may not arrive for shutdown. | Remain stopped; persist safe state and do not retry in a loop. |

The status definitions and suggested mitigations come from Android/AOSP, including “reduce power immediately” at `MODERATE`, lowest capacity at `CRITICAL`, and possible inability to receive `SHUTDOWN`. [AOSP thermal mitigation and status guidance](https://source.android.com/docs/core/power/thermal-mitigation)

### Sustained LLM analogy: ADPF

ADPF’s Thermal Headroom guidance is written for games, but the control idea transfers to a sustained LLM: predict whether the current workload can continue, then reduce workload to a sustainable level before throttling becomes worse. For a game that means fewer frames/lower fidelity or smaller cores; for Kalsa it means less concurrent work, less background work, and ultimately unloading the model at the hard gate. Headroom is an advisory/proactive control, not a replacement for the OS severity gate, and its numeric values are not universal temperature thresholds. [Android Thermal API / ADPF](https://developer.android.com/games/optimize/adpf/thermal)

### UX and resource behavior

Do not fight OS mitigation. Android says wake locks should be avoided where possible and released as soon as possible; releasing one releases the app’s claim to keep the CPU/screen active. At `CRITICAL` or higher, Kalsa should release any inference wake lock, stop the generation worker, and free CPU/GPU/model memory. A blocked send must be a quiet state transition—not a fast retry loop. [Android wake-lock guidance](https://developer.android.com/develop/background-work/background-tasks/awake/wakelock/release)

### Charging / fast charging

Fast charging can add heat and charging may be throttled or paused independently of an app’s inference decision. Android’s thermal architecture says **anything that throttles performance, including battery power constraints, must be reported through the thermal HAL**, and apps consume the resulting thermal severity via `PowerManager`. Therefore Kalsa should use the OS thermal status, not charging state, fast-charge detection, ambient warmth, or a raw battery/skin reading as the hard gate. Charging-related warmth may justify ordinary workload caution, but only `CRITICAL` (and more severe states) triggers the specified unload/block policy. [AOSP thermal mitigation](https://source.android.com/docs/core/power/thermal-mitigation)

## iOS

Observe `ProcessInfo.thermalStateDidChangeNotification` and read `ProcessInfo.processInfo.thermalState` when it changes. Apple specifically requires accessing `thermalState` before registering for the notification. The property is an OS thermal policy signal; Apple says that higher states require reduced system-resource usage. [Notification API](https://developer.apple.com/documentation/foundation/processinfo/thermalstatedidchangenotification), [thermalState](https://developer.apple.com/documentation/foundation/processinfo/thermalstate-swift.property)

### Apple’s per-state recommendations

| iOS state | Apple’s recommendation | Kalsa response |
| --- | --- | --- |
| `nominal` | Normal operating temperatures; no corrective action needed. | Normal inference. |
| `fair` | Slightly elevated; reduce/defer background work such as prefetching or database-index updates. | Defer model prefetch/warm-up and other discretionary work; keep the current user interaction responsive. |
| `serious` | High; reduce/defer I/O, CPU/GPU work, and battery/heat-generating resources; lower quality where applicable. | Stop background inference; reduce concurrency/throughput and avoid starting a long generation when it can wait. |
| `critical` | Performance is significantly impacted and the device needs to cool; reduce CPU, GPU, and I/O to the minimum needed for user interaction; stop peripherals where possible. | **Hard stop:** block new inference, cancel active generation safely, unload the LLM and release its CPU/GPU/memory resources. |

Apple’s documentation provides the state-specific actions; its WWDC guidance demonstrates the same progression: no action at nominal, proactive saving at fair, stronger CPU/graphics/I/O reductions at serious, and turning off as much as possible—including peripherals—at critical. [Fair](https://developer.apple.com/documentation/foundation/processinfo/thermalstate-swift.enum/fair), [serious](https://developer.apple.com/documentation/foundation/processinfo/thermalstate-swift.enum/serious), [critical](https://developer.apple.com/documentation/foundation/processinfo/thermalstate-swift.enum/critical), [WWDC19: Designing for Adverse Network and Temperature Conditions](https://developer.apple.com/videos/play/wwdc2019/422/)

### Charging on Hold is not `thermalState == critical`

Apple’s “Charging on Hold” behavior is a system protection that slows or pauses charging in hot or cold conditions and resumes automatically when the device returns to a normal temperature. It is not the app-facing thermal-state contract. Kalsa should not hard-stop inference merely because charging is held or the device is charging; use `thermalState` for the thermal gate. [Apple: thermally limited charging](https://support.apple.com/guide/iphone/understand-thermally-limited-charging-iph3006fbee4/ios)

## Cross-platform “done well” checklist

1. **Listen to OS signals, not only raw sensors.** Register Android’s `PowerManager` thermal-status listener and iOS’s `ProcessInfo` thermal notification; query the current state on startup/resume. Kalsa action: maintain one platform-normalized thermal state and update the UI/gate from it. If available, use Android headroom only as a rate-limited advisory.

2. **Use a graduated response: advisory → reduce → hard stop.** Kalsa action: at Android `LIGHT` / iOS `fair`, set `preferGpuPath` as an advisory (subject to measured device behavior) and defer prefetch; at Android `MODERATE`/`SEVERE` / iOS `serious`, reduce concurrency and defer heavy work; at `CRITICAL`, stop inference.

3. **On hard stop, release heavy resources.** Kalsa action: atomically block sends, cancel the generation, unload the LLM, release GPU/CPU execution resources and model memory, release wake locks, and stop inference workers. Do not retain a loaded model while claiming to have stopped.

4. **Give clear messaging and a recovery path.** Kalsa action: show a banner such as “Inference paused while the device cools down.” Suppress automatic retry while critical. When the OS reports a cooled state, either auto-resume only if the request is still valid and the user opted in, or keep the send enabled with an explicit Retry; make reloading lazy.

5. **Fail open if the API is missing.** Kalsa action: if the thermal listener/property/headroom API is unavailable or unsupported, do not invent a temperature cutoff or permanently block inference; continue normal policy, record capability/telemetry, and rely on the OS’s own mitigation. Android documents unsupported headroom as `NaN`; iOS’s API is OS/version dependent. This is a compatibility fallback, not permission to ignore a signal that is available.

6. **Do not hard-gate on ambient or fast-charge warmth alone.** Kalsa action: charging state, fast-charging state, “warm” sensor data, or a user saying the phone feels hot may influence advisory tuning only. The hard gate is the platform critical signal (`THERMAL_STATUS_CRITICAL` or `ProcessInfo.ThermalState.critical`), with `EMERGENCY`/`SHUTDOWN` treated as stopped if observed.

## Sources

- [Android `PowerManager` API](https://developer.android.com/reference/android/os/PowerManager)
- [Android Thermal API / ADPF](https://developer.android.com/games/optimize/adpf/thermal)
- [AOSP thermal mitigation](https://source.android.com/docs/core/power/thermal-mitigation)
- [Android wake-lock release guidance](https://developer.android.com/develop/background-work/background-tasks/awake/wakelock/release)
- [Apple `ProcessInfo.thermalStateDidChangeNotification`](https://developer.apple.com/documentation/foundation/processinfo/thermalstatedidchangenotification)
- [Apple `ProcessInfo.thermalState`](https://developer.apple.com/documentation/foundation/processinfo/thermalstate-swift.property)
- [Apple thermal-state recommendations: fair](https://developer.apple.com/documentation/foundation/processinfo/thermalstate-swift.enum/fair), [serious](https://developer.apple.com/documentation/foundation/processinfo/thermalstate-swift.enum/serious), [critical](https://developer.apple.com/documentation/foundation/processinfo/thermalstate-swift.enum/critical)
- [WWDC19: Designing for Adverse Network and Temperature Conditions](https://developer.apple.com/videos/play/wwdc2019/422/)
- [Apple: thermally limited charging](https://support.apple.com/guide/iphone/understand-thermally-limited-charging-iph3006fbee4/ios)
