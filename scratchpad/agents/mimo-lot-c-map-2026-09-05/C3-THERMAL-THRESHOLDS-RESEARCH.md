# C3 — Thermal thresholds research

**Date:** 2026-09-05  
**Scope:** advisory-only UI and Governor hints for an on-device phone LLM; generation must remain available. Temperatures below are °C.

## Bottom line

There is no portable OEM threshold in °C. Android deliberately exposes manufacturer-defined thermal severity/headroom, and Apple exposes a qualitative `ProcessInfo.thermalState`; neither maps to a public universal skin, battery, or SoC temperature. Raw values must be labeled by sensor type. A `thermal_zone0` value must not be called “skin” unless the device mapping is known.

For Kalsa, use °C only as a soft advisory signal, with persistence and hysteresis. Prefer Android thermal status/headroom and iOS thermal state when available. The OS remains the safety authority; Kalsa should never hard-block a user send at 45–50°C.

## Published thresholds and observations

| Source | Number / band | What it measures | Product implication |
|---|---:|---|---|
| Android Thermal HAL / AOSP | No universal °C; supports skin, battery, GPU, CPU and USB sensors. Manufacturer policy supplies severity thresholds, and a reported value may be guard-banded rather than the physical temperature. [AOSP Thermal mitigation](https://source.android.com/docs/core/power/thermal-mitigation) | Per-device thermal sensors and policy severity | Do not compare a raw `thermal_zone0` number across Android models; use sensor type and platform status where possible. |
| Android `PowerManager` / Thermal API | `NONE`, `LIGHT`, `MODERATE`, `SEVERE`, `CRITICAL`, `EMERGENCY`, `SHUTDOWN`; these are throttling/severity states, not °C. [AOSP status-code guidance](https://source.android.com/docs/core/power/thermal-mitigation#use-thermal-status-codes) | Device thermal policy; largely driven by slow-moving skin sensors | `LIGHT` is intended for gentle mitigation; `MODERATE` means reduce power immediately; `SEVERE` means UX is already largely impacted. |
| Android Thermal Headroom | Unitless: `1.0` is the severe-throttling threshold. Android’s heuristic examples use about `0.85` for light, `0.95` for moderate, and `>1.0` for severe; values are device-dependent. [Android Thermal API](https://developer.android.com/games/optimize/adpf/thermal) | Forecast/current distance through the device thermal envelope; tracks slow sensors such as skin | Better Governor input than a fixed °C threshold. It is not a battery or SoC thermometer. |
| Android battery API | `BatteryManager.EXTRA_TEMPERATURE` exposes the current battery temperature; Android does not define a universal app warning cutoff. [BatteryManager](https://developer.android.com/reference/android/os/BatteryManager#EXTRA_TEMPERATURE) | Battery sensor | A battery reading can be used for advisory bands, but do not infer phone surface comfort from it. |
| Apple `ProcessInfo.thermalState` | `nominal` = normal; `fair` = slightly elevated; `serious` = high; `critical` = significantly affecting performance and the device needs to cool. No public °C mapping. [Apple enum](https://developer.apple.com/documentation/foundation/processinfo/thermalstate-swift.enum) | System thermal state / heat from logic components | On iOS, map these states directly to advisory/Governor tiers; do not invent a °C value. Apple recommends reducing system-resource use as state rises. [Apple serious-state guidance](https://developer.apple.com/documentation/foundation/processinfo/thermalstate-swift.enum/serious) |
| Apple OEM guidance | Use ambient `0–35°C`; store `-20–45°C`. Hot conditions can shorten battery life and trigger charging pause, dimming, or other protections. [Apple support](https://support.apple.com/en-la/118431) | Ambient operating/storage conditions, not skin or junction | Outdoor heat is a real confounder; a warm banner should not imply unsafe LLM use. |
| Samsung OEM guidance | Use ambient `0–35°C`; store `-10–50°C`. [Samsung safety information](https://images.samsung.com/is/content/samsung/assets/fr/support/refurbished-devices-information/SM-F731B_QSG_Open_TSS_4th_EUB_Rev.2.0_240614_Note.pdf) | Ambient operating/storage conditions, not internal sensor threshold | OEM ranges support context/persistence, not a universal app cutoff. |
| Smartphone thermal-experience research | Phone-surface temperature near `39°C` was observed in a 20-minute VR test; battery was `34–36°C`, CPU `41–45°C`, GPU `>42°C`. [IEEE AIVR paper / NSF copy](https://par.nsf.gov/servlets/purl/10281415) | Surface, battery, CPU and GPU in a Pixel 4 experiment | Surface can become uncomfortable while battery remains much cooler; sensor classes are not interchangeable. |
| Smartphone AR thermal research | In a 20-minute AR experiment, battery exceeded `46°C`, CPU initially exceeded `75°C`, GPU exceeded `70°C`, and Wi-Fi exceeded `65°C`. [IEEE AIVR abstract](https://www.researchwithrutgers.org/en/publications/a-smartphone-thermal-temperature-analysis-for-virtual-and-augment/) | Component temperatures under a heavy AR workload | SoC/junction numbers can be tens of degrees above the case; a SoC warning must not be presented as skin comfort. |
| Smartphone thermal-comfort research | `45°C` is cited as a pain/discomfort threshold for skin contact; a recent smartphone comfort study reports comfort below about `38°C` and discomfort above `45°C`. [KAIST MobiCom paper](https://nmsl.kaist.ac.kr/pdf/MobiCom19_Fire.pdf), [smartphone thermotactile study](https://www.sciencedirect.com/science/article/pii/S0169814126000120) | Human-contact surface/skin sensation | Around 45°C is a reasonable *comfort escalation* point, not a generation safety gate. |

## Recommended Kalsa advisory bands

These are starting points for a comfort/performance advisory, not battery-safety limits and not platform thermal policy. Use a moving median/average rather than one sample; enter a band only after sustained time and leave it after falling at least 2°C below the entry point. A practical default is 30 s for warm, 60 s for hot, and 10–15 s for critical, with shorter times only for a rapidly rising signal.

| Sensor classification | Normal | Warm (soft banner) | Hot (persistent banner) | Critical (strong advisory; still no block) |
|---|---:|---:|---:|---:|
| Actual phone skin/surface | `<38` | `38–42` | `>42–45` | `≥45` |
| Battery or unknown internal/`zone0`-like sensor | `<40` | `40–44` | `>44–48` | `≥48` |
| Kalsa fallback when `zone0` cannot be identified | `<42` | `42–46` | `>46–50` | `≥50` |
| SoC/CPU/GPU junction-like sensor | `<65` | `65–75` | `>75–85` | `≥85` |

Rationale:

- The skin row is comfort-driven: the literature puts noticeable discomfort around the high-30s/low-40s and pain around 45°C. It should be the only row used for a “phone feels hot” message.
- The battery/unknown row avoids treating an internal sensor like a skin thermometer. The AR measurement above shows that battery can exceed 46°C while component and surface behavior differ. A confirmed battery sensor may use the same row; charging state should increase the Governor’s caution, not hard-stop generation.
- The fallback row preserves the product owner’s rough `42°C warm / 50°C hot` behavior while making the labels more graduated: 42–46 is a low-severity advisory, 46–50 is hot, and 50+ is critical advisory. Persistence/hysteresis are essential for summer/outdoor use.
- The SoC row is deliberately separate. The cited AR experiment reached the 70–75°C range without that being a skin reading. These values are engineering starting points and should be calibrated against Android thermal status/headroom telemetry on representative devices.
- If Android `getThermalHeadroom()`/thermal status is available, let it override the severity tier for the Governor, while retaining °C only for the user-facing explanation. If iOS `thermalState` is available, use it instead of trying to estimate °C.

## Summer-aware behavior

Do not show a banner on a single sample. Require persistence, use a 2°C exit hysteresis, and rate-limit repeated banners. Consider temperature slope, charging, direct-sun/ambient context if available, and whether the signal is actually skin. A high ambient temperature can push a phone toward its normal thermal policy without meaning that the current LLM request must be refused; Apple explicitly describes hot-environment protections as charging/performance regulation and says normal warm operation can continue absent a system temperature warning. [Apple support](https://support.apple.com/en-la/118431)

## What not to do

- Do **not** hard-gate generation at 45°C, 48°C, or 50°C. Those values can be skin comfort points, battery/internal advisories, or OEM policy values depending on the sensor; using one as a universal cutoff can brick normal summer/outdoor use.
- Do **not** equate SoC/junction temperature with skin comfort, or battery temperature with case temperature.
- Do **not** assume `thermal_zone0` has the same meaning across Android devices, kernels, vendors, or OS releases.
- Do **not** treat iOS `thermalState` as a hidden Celsius scale. It is qualitative and system-defined.
- Do **not** duplicate the OS’s emergency/shutdown policy in app UI. At Android `EMERGENCY`/`SHUTDOWN` or iOS `critical`, give a strong advisory and yield to platform behavior; the app still should not reject a user send solely because its own heuristic crossed a number.

## Advisory bands → Governor hints

| Advisory/platform signal | Governor hint | UX contract |
|---|---|---|
| Normal / Android `NONE` / iOS `nominal` | Normal scheduling; no thermal preference | No banner. |
| Warm / Android `LIGHT` / iOS `fair` | Prefer `GPU_COOLMODE` when it is an available, measured-good path; avoid unnecessary big-core boosts and CPU-heavy prefill/decode settings | Optional low-salience “device is warm” banner; sends continue. |
| Hot / Android `MODERATE` or headroom near `0.95` / iOS `serious` | Prefer GPU; reduce CPU thread count or CPU-heavy decode bursts; use shorter work slices/yields; avoid starting extra background work | Persistent informational banner; sends continue and may be slower. |
| Critical / Android `SEVERE+` or headroom `≥1.0` / iOS `critical` | Strongly prefer the coolest supported execution path, minimize parallelism and auxiliary work, and let the OS throttle as needed | Strong advisory (“device is very warm; performance may drop”), but no app-level hard block. |

The Android documentation explicitly recommends gentle mitigation at `LIGHT`, immediate power reduction at `MODERATE`, and reduced capacity at `SEVERE`; that supports Governor hints and graceful workload shaping rather than refusing foreground LLM requests. [AOSP status-code guidance](https://source.android.com/docs/core/power/thermal-mitigation#use-thermal-status-codes) [Android Thermal API](https://developer.android.com/games/optimize/adpf/thermal)

### Measurement notes

- Record sensor identity, units, platform, charging state, thermal status/headroom, and timestamp in telemetry. Never persist only “zone0 = skin.”
- Treat raw °C as advisory and device-relative. The platform status/headroom is the stronger cross-device signal.
- Validate the bands on hot-weather devices and direct-sun/charging scenarios; tune banner persistence and hysteresis before moving thresholds.
