# Phone LLM total hard-gate temperature research

Date: 2026-09-05

## Bottom line

There is no defensible universal Celsius cutoff for both Android and iOS. A total gate for **new** LLM turns is justified by the platform thermal state, not by an untyped temperature number:

| Platform | Total gate predicate | Why |
|---|---|---|
| Android | `PowerManager.getCurrentThermalStatus() >= THERMAL_STATUS_CRITICAL` (API 29+), including `CRITICAL`, `EMERGENCY`, and `SHUTDOWN` | Android defines `CRITICAL` as the platform having done everything to reduce power, `EMERGENCY` as key components shutting down and the last warning before shutdown, and `SHUTDOWN` as immediate shutdown; apps might not receive the last notification. ([AOSP thermal mitigation](https://source.android.com/docs/core/power/thermal-mitigation), [PowerManager API](https://developer.android.com/reference/android/os/PowerManager.html)) |
| iOS | `ProcessInfo.processInfo.thermalState == .critical` | Apple defines `.critical` as thermal conditions significantly impacting performance and requiring cooling, and tells apps to reduce CPU/GPU/I/O to the minimum needed for user interaction. ([Apple `ProcessInfo.ThermalState.critical`](https://developer.apple.com/documentation/foundation/processinfo/thermalstate-swift.enum/critical), [Apple thermal-state guidance](https://developer.apple.com/library/archive/documentation/Performance/Conceptual/power_efficiency_guidelines_osx/RespondToThermalStateChanges.html)) |

`.serious` on iOS and Android `SEVERE` are good reasons to reduce/defer or downgrade work, but are not the strongest evidence for a total block: Apple says `.serious` should trigger corrective reductions, while Android says `SEVERE` means UX is largely impacted and the system should limit capacity. ([Apple `.serious`](https://developer.apple.com/documentation/foundation/processinfo/thermalstate-swift.enum/serious), [AOSP status table](https://source.android.com/docs/core/power/thermal-mitigation))

**Owner's 60°C-on-both proposal:** sane only as an emergency boundary for a **known battery-temperature** reading, and even there it is at the upper edge of common discharge ratings and too high for charging. It is too high for a user-contact surface, and it is not portable or interpretable for an unknown `zone0` or an internal SoC/junction sensor. ([TI Li-ion characteristics](https://www.ti.com/lit/an/snva533a/snva533a.pdf), [Google Pixel safety guide](https://support.google.com/pixelphone/answer/12164747?hl=en), [IEC 62368-1 touch-temperature table](https://www.iec-equipment.com/Uploads/download/BS-EN-62368-1-2014-C-2015.pdf))

## Android evidence

### Thermal HAL / status levels

Android's Thermal HAL models multiple sensor classes—skin, battery, GPU, CPU, and USB—and AOSP says device skin temperature is the most important system to track for keeping the external surface within thermal limits. The framework exposes status to apps through `PowerManager`, while detailed sensor/event information is restricted to trusted services. ([AOSP thermal mitigation](https://source.android.com/docs/core/power/thermal-mitigation))

| Status | Android's meaning | App implication |
|---|---|---|
| `THERMAL_STATUS_CRITICAL` (`4`) | Platform has done everything to reduce power; components run at their lowest capacity. | Strong basis to block new heavy inference. ([AOSP](https://source.android.com/docs/core/power/thermal-mitigation)) |
| `THERMAL_STATUS_EMERGENCY` (`5`) | Key platform components are shutting down; functionality is limited; last warning before device shutdown. | Block immediately; do not depend on receiving a later status. ([AOSP](https://source.android.com/docs/core/power/thermal-mitigation)) |
| `THERMAL_STATUS_SHUTDOWN` (`6`) | Shut down immediately; apps might not receive it. | Gate if observed, but treat it as a best-effort last chance. ([AOSP](https://source.android.com/docs/core/power/thermal-mitigation)) |

There is deliberately no cross-device Celsius mapping to use here: AOSP permits a manufacturer to return a guarded or policy-specific numerical value, provided the severity is accurate; its example says an actual 65°C condition could be represented by a 72°C critical threshold. ([AOSP manufacturer guidance](https://source.android.com/docs/core/power/thermal-mitigation))

### Battery-temperature APIs

- `BatteryManager.EXTRA_TEMPERATURE` in `Intent.ACTION_BATTERY_CHANGED` is an integer containing the current battery temperature. ([Android `BatteryManager`](https://developer.android.com/reference/android/os/BatteryManager#EXTRA_TEMPERATURE))
- `HardwarePropertiesManager.getDeviceTemperatures()` distinguishes `DEVICE_TEMPERATURE_BATTERY`, `DEVICE_TEMPERATURE_CPU`, `DEVICE_TEMPERATURE_GPU`, and `DEVICE_TEMPERATURE_SKIN`, and can request current, throttling, or shutdown temperatures. It returns an empty array when the platform does not provide the queried value; access can also throw `SecurityException` for ordinary callers. ([Android `HardwarePropertiesManager`](https://developer.android.com/reference/android/os/HardwarePropertiesManager))
- Android's app-facing thermal API is `PowerManager.getCurrentThermalStatus()` plus `addThermalStatusListener()`, available from API 29. ([Android `PowerManager`](https://developer.android.com/reference/android/os/PowerManager.html))

### OEM behavior and numbers

The published OEM guidance is behavior-based, not a universal app cutoff:

| OEM guidance | Published behavior |
|---|---|
| Samsung Galaxy | Samsung says normal ambient operating conditions are 0–35°C; safeguards may close apps, dim/limit performance, pause charging, and power off. A current Galaxy manual says a first overheat warning limits features and closes running apps, while a further rise can power the device off. ([Samsung support](https://www.samsung.com/us/support/answer/ANS10002887/), [Galaxy manual, pp. 154–155](https://images.samsung.com/is/content/samsung/assets/fr/support/warranty/refurbished-devices-information-warranty/s23-fe-sm-s711b-um-eu-uu-eng-rev-1-1-240417.pdf)) |
| Google Pixel | Pixel may reduce CPU performance, reduce charging speed, disable camera/5G, enter low-power mode, show a warning, and turn off if temperature continues to rise; Google says to stop resource-heavy apps and not use the phone until cool. ([Pixel overheating guidance](https://support.google.com/pixelphone/answer/3333708?hl=en-GB)) |
| Pixel safety limits | Pixel guidance says use/charge at ambient 0–35°C, avoid ambient above 45°C because it may damage the phone, overheat the battery, or pose a fire risk, and expect reduced performance, inability to charge, or power-down when internal temperature exceeds normal operating temperatures. These are **ambient** limits, not a battery, skin, or SoC sensor threshold. ([Pixel 7 safety guide](https://support.google.com/pixelphone/answer/12164747?hl=en)) |

Typical Li-ion cell ratings explain the often-seen 45–60°C numbers, but they are not phone-app gate specifications: TI describes safe charging at 0–45°C and a specified discharge range of −20–60°C; Panasonic gives the same 0–45°C charge and up-to-60°C discharge pattern for its cells. ([TI](https://www.ti.com/lit/an/snva533a/snva533a.pdf), [Panasonic Li-ion handbook](https://industry.panasonic.eu/sites/default/pidseu/files/downloads/files/panasonic_li-ion_handbook.pdf))

## iOS evidence

`ProcessInfo.thermalState` is a system thermal state with four values: `.nominal`, `.fair`, `.serious`, and `.critical`. Apple describes `.critical` as significantly impacting performance and needing cooling; its recommended action is to reduce CPU, GPU, and I/O to the absolute minimum needed to respond to user actions and, where possible, stop peripherals. ([Apple thermal-state enum](https://developer.apple.com/documentation/foundation/processinfo/thermalstate-swift.enum), [Apple critical-state guidance](https://developer.apple.com/documentation/foundation/processinfo/thermalstate-swift.enum/critical))

Apple's public iPhone guidance gives an **ambient** use range of 0–35°C and storage range of −20–45°C. When the interior exceeds the normal operating range, iOS may slow/stop charging, dim or blank the display, weaken radios, disable camera functions, reduce performance, show a cooling warning, or temporarily disable the device. ([Apple hot/cold guidance](https://support.apple.com/en-la/118431), [Apple iPhone user guide](https://support.apple.com/en-mide/guide/iphone/iphbbe12ba1/ios))

Apple's public app guidance found here gives no Celsius value at which an app must stop heavy work. It gives a state-based rule: at `.serious`, reduce/defer heat-producing work; at `.critical`, take immediate corrective action and leave only the minimum required for user interaction. ([Apple `.serious`](https://developer.apple.com/documentation/foundation/processinfo/thermalstate-swift.enum/serious), [Apple `.critical`](https://developer.apple.com/documentation/foundation/processinfo/thermalstate-swift.enum/critical))

## Do not conflate the sensors

| Reading | What it represents | Why 60°C cannot be treated as a universal gate |
|---|---|---|
| **Battery °C** | Cell/pack thermistor estimate. Android explicitly labels a battery temperature API. ([Android `BatteryManager`](https://developer.android.com/reference/android/os/BatteryManager#EXTRA_TEMPERATURE), [Android `HardwarePropertiesManager`](https://developer.android.com/reference/android/os/HardwarePropertiesManager)) | 60°C is around the upper end of a common Li-ion discharge specification and above the common 45°C charge range; it is a plausible emergency ceiling, not a comfortable or charging-safe operating target. ([TI](https://www.ti.com/lit/an/snva533a/snva533a.pdf), [Xiaomi battery-temperature guidance](https://www.mi.com/global/support/faq/details/KA-07107/)) |
| **Skin / surface °C** | External enclosure temperature relevant to the person's hand/skin and product touch limits. Android explicitly has a `SKIN` sensor class and calls it the key surface-protection signal. ([AOSP](https://source.android.com/docs/core/power/thermal-mitigation), [Android `HardwarePropertiesManager`](https://developer.android.com/reference/android/os/HardwarePropertiesManager)) | 60°C is too high for a total-gate threshold intended to protect normal phone contact: a touch-temperature table lists 48°C for accessible surfaces held or touched for more than one minute, with lower temperatures to be considered for continuous skin contact; Google also warns that prolonged contact with hot surfaces can cause discomfort or burns. ([IEC 62368-1 table](https://www.iec-equipment.com/Uploads/download/BS-EN-62368-1-2014-C-2015.pdf), [Pixel safety guide](https://support.google.com/pixelphone/answer/12164747?hl=en)) |
| **SoC / junction °C** | Internal CPU/GPU silicon or package temperature, not the enclosure or battery. Android exposes CPU/GPU as distinct classes and exposes separate throttling/shutdown sources. ([Android `HardwarePropertiesManager`](https://developer.android.com/reference/android/os/HardwarePropertiesManager)) | 60°C is not portable: it may be below or above a device's policy threshold, and AOSP says OEMs may use guarded/policy-specific numeric values so the number need not equal the physical threshold. Use platform thermal status, not a universal °C gate. ([AOSP manufacturer guidance](https://source.android.com/docs/core/power/thermal-mitigation)) |
| **Unknown `sysfs` `thermal_zone0`** | A Linux thermal-zone entry whose numeric index is not a semantic sensor name. The kernel interface exposes `thermal_zone[0-*]`, a `type`, a current `temp`, and trip points; the `type` is what identifies the zone. ([Linux kernel thermal sysfs](https://www.kernel.org/doc/html/latest/driver-api/thermal/sysfs-api.html)) | Kalsa's current `zone0` is unknown by the task description, so 60°C has no reliable interpretation. Do not hard-gate on that number alone; use Android thermal status / iOS thermal state. ([AOSP](https://source.android.com/docs/core/power/thermal-mitigation), [Apple thermal state](https://developer.apple.com/documentation/foundation/processinfo/thermalstate-swift.enum)) |

## Recommendation table

The numeric battery recommendation below is an engineering guardband inferred from the cited common 0–45°C charge and −20–60°C discharge ranges; it is not an Android, Apple, or universal battery-safety standard. ([TI](https://www.ti.com/lit/an/snva533a/snva533a.pdf), [Panasonic](https://industry.panasonic.eu/sites/default/pidseu/files/downloads/files/panasonic_li-ion_handbook.pdf))

| Sensor available to the app | Recommended total-gate rule | 60°C verdict |
|---|---|---|
| Unknown `zone0` / unknown internal | **Do not hard-gate on °C alone.** Android: gate on `THERMAL_STATUS_CRITICAL` or higher; iOS: gate on `.critical`. | **Not sane**: too ambiguous to classify. ([Linux kernel thermal sysfs](https://www.kernel.org/doc/html/latest/driver-api/thermal/sysfs-api.html), [AOSP](https://source.android.com/docs/core/power/thermal-mitigation), [Apple](https://developer.apple.com/documentation/foundation/processinfo/thermalstate-swift.enum/critical)) |
| Known SoC/junction/internal | **Do not hard-gate on a universal °C number.** Use platform status; if Android also provides a device-specific shutdown/throttling threshold, prefer that policy signal. | **Not portable**; could be too low for one device and too high for another. ([AOSP](https://source.android.com/docs/core/power/thermal-mitigation), [Android `HardwarePropertiesManager`](https://developer.android.com/reference/android/os/HardwarePropertiesManager)) |
| Known skin/surface | Prefer platform status. If a validated, calibrated skin reading must be used as an extra guard, use a conservative product-specific limit around **45–48°C**, with the lower end for sustained hand/skin contact; validate against the applicable product-safety standard. | **Too high** for a normal-contact protection gate. ([IEC 62368-1 table](https://www.iec-equipment.com/Uploads/download/BS-EN-62368-1-2014-C-2015.pdf), [Pixel safety guide](https://support.google.com/pixelphone/answer/12164747?hl=en), [AOSP](https://source.android.com/docs/core/power/thermal-mitigation)) |
| Known battery | **Android fallback: gate at ≥55°C** as a conservative emergency guardband; if charging, treat ≥45°C as already outside the common charge range and stop/defer heavy work. On iOS, use `.critical` because the public app surface is the thermal state, not a public battery-°C contract. | **Acceptable only as an emergency ceiling for a validated battery sensor while discharging; too high for charging; too late if the reading is skin, SoC, or unknown.** ([TI](https://www.ti.com/lit/an/snva533a/snva533a.pdf), [Panasonic](https://industry.panasonic.eu/sites/default/pidseu/files/downloads/files/panasonic_li-ion_handbook.pdf), [Apple thermal state](https://developer.apple.com/documentation/foundation/processinfo/thermalstate-swift.enum/critical)) |

## Implementation note: one total-gate boolean

A single boolean such as `blockNewTurns` is sufficient for the requested UX, provided it is driven by extreme, platform-level state rather than a raw untyped sensor:

```text
blockNewTurns =
    androidThermalStatus >= THERMAL_STATUS_CRITICAL
    OR iosThermalState == .critical
    OR (validatedBatteryCelsius >= 55°C)
```

The Android listener reports the **overall** thermal throttling status, and Android's thermal framework aggregates policy across sensor classes; Apple likewise supplies one system thermal state and tells the app how to reduce resource use at each state. That makes one “block new turns” decision a reasonable product control even though the underlying thermal system has multiple sensors. ([Android listener/API](https://developer.android.com/reference/android/os/PowerManager.OnThermalStatusChangedListener), [AOSP](https://source.android.com/docs/core/power/thermal-mitigation), [Apple `thermalState`](https://developer.apple.com/documentation/foundation/processinfo/thermalstate-swift.property))

Unknown, missing, empty, or semantically unverified temperature readings should **fail open for the temperature leg**—they must not turn this boolean on. Android documents undefined/empty temperature results when a platform does not provide a queried sensor, while the platform thermal status remains the correct signal; on iOS, use the public thermal-state signal. ([Android `HardwarePropertiesManager`](https://developer.android.com/reference/android/os/HardwarePropertiesManager), [AOSP thermal APIs](https://source.android.com/docs/core/power/thermal-mitigation), [Apple `ProcessInfo.ThermalState`](https://developer.apple.com/documentation/foundation/processinfo/thermalstate-swift.enum))

The UI can therefore show one blocking state (“Phone is too warm; cool it before starting another response”) and clear it when the platform status leaves the critical state or the validated battery reading has cooled below the chosen release policy. The platform/OEM may independently throttle, pause charging, close apps, or shut down, so this app gate is a workload-protection UX, not a replacement for device thermal protection. ([Google Pixel guidance](https://support.google.com/pixelphone/answer/3333708?hl=en-GB), [Samsung guidance](https://www.samsung.com/us/support/answer/ANS10002887/), [AOSP](https://source.android.com/docs/core/power/thermal-mitigation))

## Sources

- [Android Open Source Project — Thermal mitigation](https://source.android.com/docs/core/power/thermal-mitigation)
- [Android `PowerManager` API](https://developer.android.com/reference/android/os/PowerManager.html)
- [Android `BatteryManager` API](https://developer.android.com/reference/android/os/BatteryManager)
- [Android `HardwarePropertiesManager` API](https://developer.android.com/reference/android/os/HardwarePropertiesManager)
- [Linux kernel — Generic Thermal Sysfs driver](https://www.kernel.org/doc/html/latest/driver-api/thermal/sysfs-api.html)
- [Samsung — Keep your Galaxy device at its normal operating temperature](https://www.samsung.com/us/support/answer/ANS10002887/)
- [Samsung Galaxy S23 FE user manual, overheating section](https://images.samsung.com/is/content/samsung/assets/fr/support/warranty/refurbished-devices-information-warranty/s23-fe-sm-s711b-um-eu-uu-eng-rev-1-1-240417.pdf)
- [Google Pixel — Help keep your Pixel phone from feeling too warm or hot](https://support.google.com/pixelphone/answer/3333708?hl=en-GB)
- [Google Pixel 7 safety and regulatory guide](https://support.google.com/pixelphone/answer/12164747?hl=en)
- [Apple Developer — `ProcessInfo.ThermalState`](https://developer.apple.com/documentation/foundation/processinfo/thermalstate-swift.enum)
- [Apple Developer — `.critical`](https://developer.apple.com/documentation/foundation/processinfo/thermalstate-swift.enum/critical)
- [Apple Developer — `.serious`](https://developer.apple.com/documentation/foundation/processinfo/thermalstate-swift.enum/serious)
- [Apple Support — If your iPhone or iPad gets too hot or too cold](https://support.apple.com/en-la/118431)
- [Apple — iPhone user guide, important handling information](https://support.apple.com/en-mide/guide/iphone/iphbbe12ba1/ios)
- [Texas Instruments — Characteristics of Rechargeable Batteries](https://www.ti.com/lit/an/snva533a/snva533a.pdf)
- [Panasonic — Lithium Ion Batteries handbook](https://industry.panasonic.eu/sites/default/pidseu/files/downloads/files/panasonic_li-ion_handbook.pdf)
- [IEC 62368-1 touch-temperature table (public PDF mirror)](https://www.iec-equipment.com/Uploads/download/BS-EN-62368-1-2014-C-2015.pdf)
