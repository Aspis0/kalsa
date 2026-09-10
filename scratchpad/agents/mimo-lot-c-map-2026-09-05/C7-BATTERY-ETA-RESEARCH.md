# C7 — Battery ETA research

## Bottom line

Treat this as a **rough, workload-specific projection**, not a battery gauge. Say “about” and show a range; never show minutes or a single precise countdown. The honest unit is:

> **About X–Y hours of continuous on-device generation at this recent workload**

That is not a promise about ordinary phone life, standby, or another model.

## 1. What the platforms expose

| Surface | App-readable data | Limits relevant to ETA |
|---|---|---|
| `expo-battery` | Battery level `0..1` (or `-1` unavailable), state (`UNKNOWN`, `UNPLUGGED`, `CHARGING`, `FULL`), low-power mode; listeners | Android level events fire only on significant changes; iOS level events are at most once/minute and on a 1% change. It is device-level data, not Kalsa/LLM-only consumption. |
| Android `BatteryManager` | Capacity as integer %, status/charging, remaining charge (`CHARGE_COUNTER`, µAh), instantaneous or average net current (`CURRENT_NOW`, `CURRENT_AVERAGE`, µA), energy counter where supported | Hardware/vendor support and update behavior vary. Current is whole-device net current. Positive current means into the battery; negative means discharging. |
| iOS `UIDevice` | `batteryLevel` (`0..1`) and `batteryState` (`unknown`, `unplugged`, `charging`, `full`) after `isBatteryMonitoringEnabled = true`; change notifications | Public `UIDevice` does not provide a general battery-current or remaining-µAh API. If monitoring is disabled, level/state are unavailable/unknown. |

## 2. Simple estimators

### Primary MVP estimator: recent percent slope

Store foreground samples `(timestamp, batteryPercent)` while an on-device generation is active.

For two samples:

```text
dropPercent = p_old - p_new
hours = (t_new - t_old) / 3600
dischargeRate = dropPercent / hours       # percentage points/hour
eta = (p_now - reservePercent) / dischargeRate
```

Use a least-squares slope over the last few valid samples, or simply use the oldest/newest sample in a short window. Ignore charging transitions and upward/non-discharge segments. A `reservePercent` of 5% avoids implying that 0% is usable; label the result as continuous generation time, not shutdown time.

Recommended validity gate for the MVP:

- at least **3 valid samples spanning 10 minutes**;
- net decrease of at least **1 percentage point**;
- app is foreground/active and the generation workload has not changed;
- state is `UNPLUGGED`/discharging, not charging or full;
- latest sample is fresh (for example, no older than 2 minutes).

If any gate fails, show **Unknown / Measuring**, not a guessed ETA. The thresholds are product guardrails, not platform guarantees; tune them after real-device testing.

### Optional Android discharge-rate estimator

If `CURRENT_AVERAGE` and remaining charge are available and the phone is discharging:

```text
etaHours ≈ remainingCharge_uAh / abs(averageCurrent_uA)
```

Use this only as a coarse device-level cross-check. Prefer the observed percent slope when the two disagree. Do not present it as Kalsa’s power draw: screen, radios, other apps, and OS work are included.

## 3. When to show “unknown”

Show **Unknown** or **Measuring** when:

- charging, full, battery state unknown, or battery level unavailable;
- fewer than 3 usable samples / less than 10 minutes / less than 1% net drop;
- the app is backgrounded or the screen is off, unless a deliberately supported foreground/continuous task is still sampling the same generation;
- the app resumed from background and the last sample is stale;
- the user changed model, quantization, context, token limit, delegate, network mode, or generation settings;
- the fitted rate is zero, negative, wildly unstable, or would imply an implausible ETA.

The screen-off rule is especially important for a minimal MVP: iOS normally suspends background apps shortly after they enter the background, and Expo’s battery events are not a reliable high-frequency sampling clock.

## 4. Honest UX copy

Good patterns:

- **No data:** “Battery ETA: Unknown — keep generating for about 10 minutes to measure.”
- **Valid estimate:** “About 2–3 hours of continuous on-device generation at this recent workload.”
- **Short ETA:** “Less than 1 hour of continuous generation.”
- **Charging:** “Charging — ETA paused.”
- **Screen off/background:** “ETA paused — resume Kalsa to measure.”
- **While measuring:** “Measuring battery use… estimate will appear after more samples.”
- **Workload change:** “New workload — recalibrating.”

Round aggressively: whole hours for long estimates, half-hour bands when useful, and a broad range rather than a decimal. Keep “recent workload” and “on-device” visible near the number. Do not say “X hours remaining” without those qualifiers.

## 5. Pitfalls

- **Discharge is not linear.** Battery percentage is a fuel-gauge estimate; usable runtime changes with load, state of charge, temperature, aging, voltage sag, and the phone’s shutdown reserve. A straight line can be directionally useful over a short stable window, not accurate to the end of discharge.
- **Thermal throttling changes both sides of the estimate.** Heat can increase power draw, then system throttling can reduce throughput and alter power draw. Treat a thermal-state change as a workload break and restart measurement; optionally suppress or widen the range at elevated thermal status.
- **Model size is not a fixed “battery cost.”** Larger weights, higher precision, longer context, more tokens/sec, different CPU/GPU/NPU delegates, memory pressure, and prompt/output mix can change energy per generated token. A model switch invalidates the prior slope.
- **The sample is whole-device consumption.** Display brightness, cellular/Wi-Fi, camera/audio, OS work, and other apps contaminate the slope. Android’s richer current/charge properties still describe the device, not one app.
- **Sparse/coarse samples create false stability.** Android capacity is integer-percent and Expo’s Android level listener is intentionally infrequent; iOS level notifications are limited. Poll only while the feature is active and do not infer a high-resolution rate from unchanged percentages.
- **Percent is not model tokens.** “Hours of LLM use” assumes uninterrupted generation at the same workload. If Kalsa is idle between prompts, report continuous-generation time or leave the ETA hidden.

## Minimal honest MVP recommendation for Kalsa (on-device only)

1. Use `expo-battery` for level and battery state. Do not add native current/energy APIs in v1.
2. While the app is foregrounded and an on-device generation is actively running, sample at roughly 60 seconds and retain only a short rolling window.
3. Require 3 samples over 10 minutes with at least a 1-point net drop. Fit a recent slope; reserve 5% battery; clamp/round into broad bands.
4. Show one of: **Unknown**, **Measuring**, **Charging**, or **About X–Y h continuous on-device generation**. Pause/reset on background/screen-off, charging, model/settings changes, thermal-state changes, or unstable slope.
5. Add a small disclosure: **“Estimate uses recent device battery change; actual time varies with model, screen, temperature, and other apps.”**

This is intentionally a confidence-preserving feature. A stable “Unknown” is better than a precise-looking number the phone cannot justify.

## Sources

- Expo Battery API: https://docs.expo.dev/versions/latest/sdk/battery/
- Android `BatteryManager`: https://developer.android.com/reference/android/os/BatteryManager
- Android battery monitoring: https://developer.android.com/training/monitoring-device-state/battery-monitoring
- Apple `UIDevice.batteryLevel`: https://developer.apple.com/documentation/uikit/uidevice/batterylevel
- Apple `UIDevice.isBatteryMonitoringEnabled`: https://developer.apple.com/documentation/uikit/uidevice/isbatterymonitoringenabled
- Apple app lifecycle/background suspension: https://developer.apple.com/documentation/uikit/managing-your-app-s-life-cycle
- Apple thermal state: https://developer.apple.com/documentation/foundation/processinfo/thermalstate-swift.property
- Android thermal status: https://developer.android.com/reference/android/os/PowerManager#getCurrentThermalStatus()
- Android Power Profiler (device-level CPU/GPU/display/memory/network power): https://developer.android.com/studio/profile/power-profiler
- Core ML power/model-size context: https://developer.apple.com/documentation/coreml/reducing-the-size-of-your-core-ml-app and https://developer.apple.com/documentation/CoreML
- Smartphone battery nonlinearity / thermal / aging research: https://www.mdpi.com/2313-0105/12/4/130
