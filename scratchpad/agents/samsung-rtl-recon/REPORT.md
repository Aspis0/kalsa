# Samsung Remote Test Lab (RTL) reconnaissance

**Decision target:** second remote device cloud for on-device LLM benchmarking, compared with Qualcomm Device Cloud.

**Research date:** 2026-09-02

## Executive answer

RTL clears the “real device + ADB tunnel” bar and has the requested S23/S24/S25 inventory, but public evidence does **not** establish the decisive QDC capability: pushing and executing a custom standalone native ELF from `/data/local/tmp`. It is therefore **USABLE-WITH-LIMITS**, pending one free 30-minute probe. S23 is the clean Qualcomm/Adreno match; base S24 is mixed (B/N Exynos versus U Snapdragon), while S25/S25 Ultra are Snapdragon 8 Elite. The operational limits are short reservations, daily credits, live queues, undocumented charging/thermal state, UI-dependent session bootstrap, and terms that say personal/non-commercial use.

## 1. Device list

The live Samsung device-list page is the source of truth for what is bookable; it reports model, OS version, One UI, device name, location, and live availability. At research time it showed the requested families as follows (availability is volatile):

| Family | RTL records observed | Android versions observed | Important suffixes / status |
|---|---:|---|---|
| Galaxy S23 | 31 base-S23 records observed | 13, 14, 15, 16 | `SM-S911B` in India, Poland, Russia, UK, Vietnam, Brazil; `SM-S911U` in USA; no `SM-S911B` USA record observed |
| Galaxy S24 | 27 base-S24 records observed | 14, 15, 16 | `SM-S921B` (India/Poland/Russia/UK/Brazil), `SM-S921N` (Korea), `SM-S921U` (USA) |
| Galaxy S25 | 16 base-S25 records observed | 15, 16 | `SM-S931`, `SM-S931B`, `SM-S931BE`, `SM-S931N`; India/Russia/UK/Brazil/Korea; no USA base-S25 record observed |
| Galaxy S25 Ultra | 27 records observed | 15, 16 | `SM-S938B` (India/Poland/Russia/UK/Brazil), `SM-S938N` (Korea), `SM-S938U` (USA) |

The current page also lists S23+/Ultra, S24+/Ultra, S25+/Edge/FE, but those are not substitutes for the exact base-S23/S24/S25 classes without an explicit benchmark decision. The live API records are the detailed evidence behind the summary; use the exact device name and OS row when booking because multiple firmware generations coexist. [Samsung RTL device list](https://developer.samsung.com/remotetestlab/devices/125/galaxy-s/) · [RTL device API](https://developer.samsung.com/remotetestlab/rtl/api/v1/devices?clientType=web&pageNum=1&pageSize=100)

### Silicon interpretation

Samsung’s official Galaxy S23 material identifies Snapdragon 8 Gen 2 for Galaxy across the S23 series. Samsung’s S24 material distinguishes Snapdragon 8 Gen 3 for Galaxy from Exynos 2400 by market/model; in RTL terms, the base `SM-S921U` is the Qualcomm candidate while `SM-S921B/N` should be treated as Exynos until verified. Samsung’s S25 materials identify Snapdragon 8 Elite for Galaxy. Therefore the `S911*` records are the relevant Snapdragon 8 Gen 2 / Adreno class; S24 must be selected by exact regional SKU if GPU class matters; S25/S25 Ultra are the Snapdragon 8 Elite generation. The RTL suffix alone is not a sufficient benchmark manifest—record `ro.product.model`, `ro.soc.model`, and GPU strings inside the session. [Galaxy S23 launch/specs](https://news.samsung.com/global/samsung-announces-global-launch-of-the-galaxy-s23-series) · [Galaxy S24 regional chipset comparison](https://www.samsung.com/de/support/mobile-devices/vergleich-galaxy-s24-galaxy-s23/) · [Galaxy S24 US specs](https://news.samsung.com/us/enter-new-era-of-mobile-ai-samsung-galaxy-s24-series/) · [Galaxy S25 chipset](https://news.samsung.com/global/samsung-galaxy-s25-series-sets-the-standard-of-ai-phone-as-a-true-ai-companion) · [Galaxy S25 Ultra chipset](https://www.samsung.com/us/smartphones/galaxy-s25-ultra/)

## 2. Decisive capability: adb and custom native binaries

### What Samsung explicitly supports

Yes, RTL has a real ADB path: start the local RDB program, click Connect in the RTL client, approve the on-device RSA debugging prompt, then the remote device appears to the host and accepts ADB commands. Samsung documents use from Android Studio and a terminal, not just APK drag-and-drop. The current docs say RDB is for “manage the device through an ADB connection”; Samsung’s RDB tutorial says the connection is to a real device and that ADB commands can be run from a terminal. [RTL Tests on Devices](https://developer.samsung.com/remotetestlab/doc/tests-on-devices) · [Samsung RDB tutorial](https://developer.samsung.com/remote-test-lab/blog/en/2022/07/13/connect-to-devices-on-remote-test-lab-using-rdb-in-android-studio)

The practical path is therefore: reserve device → launch the browser Web Client → run the downloaded `rdb`/`rdb.exe` locally → click RDB Connect → approve RSA → use the printed localhost port with the local `adb` client. The Web Client is the current documented entry point; Samsung’s older standalone/JNLP material still exists, but the current guide centers the browser client. [RTL Web Client guide](https://developer.samsung.com/remotetestlab/doc/get-started-with-web-client) · [Older JNLP/standalone workflow](https://developer.samsung.com/sdp/blog/en/2021/02/18/get-started-with-remote-test-lab-for-mobile-app-testing)

### The native-binary answer

**Not proven by Samsung’s public docs, but plausible and must be probed.** Samsung explicitly documents ADB commands and file transfer, while the File Browser says it uploads files to “accessible” device folders; its worked example is an APK, not an arbitrary executable. No current RTL page found during this review promises `adb push` to `/data/local/tmp`, `chmod`, or execution of a non-APK ELF from `adb shell`. [RTL Tests on Devices](https://developer.samsung.com/remotetestlab/doc/tests-on-devices)

Independent current evidence is encouraging: a GitHub project reports that RTL’s RDB is a local ADB tunnel and that `dumpsys`, screencap, taps, and permission-grant commands work. That is evidence of a useful shell, not proof that Samsung permits arbitrary native ELF execution. A separate older Stack Overflow report describes the bridge as giving “almost the same access” as a USB-connected device, but it predates the current Web Client and is not a native-benchmark result. [LiveActivity RTL gotchas](https://github.com/FastheDeveloper/LiveActivity/blob/main/GOTCHAS.md#device-and-oem-matrix) · [Stack Overflow RTL bridge report](https://stackoverflow.com/questions/24402118/samsung-remote-test-lab-rtl-how-to-bind-the-device-to-eclipse-debugger)

**Operational implication:** RTL is not an APK-only service, but it is not yet a drop-in QDC substitute for this workload. Assume ordinary non-root `shell` privileges and Android linker/SELinux/mount restrictions until demonstrated otherwise. The required acceptance test is a prebuilt arm64 “hello” or benchmark ELF: `adb push hello-arm64 /data/local/tmp/hello && adb shell 'chmod 755 /data/local/tmp/hello && /data/local/tmp/hello; echo rc=$?'`. A successful push alone is insufficient; the binary must execute and return output through `adb shell`. If it fails with `permission denied`, `no such file`, `CANNOT LINK EXECUTABLE`, or an RTL transport error, treat native execution as unavailable.

## 3. Cost, quota, and reservation behavior

RTL is free for Samsung Developer members. The current FAQ says signing in once per day yields 20 credits; one credit is 15 minutes, the minimum reservation is 30 minutes (2 credits), and the documented daily reservation ceiling is 10 hours (40 credits). Samsung does not document cash pricing or a paid minute pool on these pages. [RTL FAQ](https://developer.samsung.com/remotetestlab/docs/2/faq) · [RTL user privilege policy](https://developer.samsung.com/remotetestlab/doc/about-remote-test-lab)

The UI currently exposes regular duration choices from 30 minutes through 2 hours; the current frontend also exposes 3–4 hour choices to partner/test user classes. The public policy’s hard ceiling is 10 hours per day, but the free daily grant is only 5 hours, so a regular account cannot consume 10 fresh free hours in one day unless it has a carried/extra credit balance or partner entitlement. This distinction is visible in the current client and should be confirmed against the account’s actual credit balance. Samsung’s July 2026 update says RTL Partner Program users receive additional credits and extended usage time. [Current RTL client](https://developer.samsung.com/remotetestlab/devices/125/galaxy-s/) · [RTL Partner Program notice](https://developer.samsung.com/sdp/news/en/2026/07/29/july-2026-dev-insight)

Ending a reservation early returns credits proportional to unused time. The device list exposes live `Available` versus `Waiting` states and wait times; Samsung does not publish a queue fairness/SLA policy. A waiting row is therefore a live queue estimate, not a guaranteed start time. [RTL Web Client guide](https://developer.samsung.com/remotetestlab/doc/get-started-with-web-client) · [Live RTL device list](https://developer.samsung.com/remotetestlab/devices/125/galaxy-s/)

Reservation concurrency is limited to three devices displayed in the client window; the current client reports this limit when exceeded. Samsung’s public prose does not state a separate account-wide reservation-count limit, so plan around three simultaneous tabs/devices, not unlimited parallel runners. [Live RTL device list / reservation client](https://developer.samsung.com/remotetestlab/devices/)

## 4. Telemetry and device state

ADB shell should be enough for the requested read-only telemetry if Samsung’s bridge exposes a normal Android shell: `getprop` for battery/system properties and `dumpsys thermalservice`/`dumpsys battery` for framework state. Samsung does not document thermal-zone, `thermalservice`, battery-property, or root access guarantees for RTL. The strongest current community evidence says `dumpsys` works through RDB, but that is not a promise that every thermal node or vendor counter is readable. [LiveActivity RTL gotchas](https://github.com/FastheDeveloper/LiveActivity/blob/main/GOTCHAS.md#device-and-oem-matrix) · [Samsung RDB tutorial](https://developer.samsung.com/remote-test-lab/blog/en/2022/07/13/connect-to-devices-on-remote-test-lab-using-rdb-in-android-studio)

Expect shell-user, non-root access. Do not assume `/sys/class/thermal`, vendor power HAL dumps, or privileged Samsung diagnostics will be readable; validate on the exact SKU/OS. A first telemetry command should capture `id`, model/SOC/GPU properties, battery state, thermal service, and thermal filesystem permissions before benchmarking.

The lab devices have dedicated Wi-Fi hotspots, and RTL has no SIM cards, so network and telephony conditions differ from a normal handset. Samsung documents no “always charging,” USB-powered, battery-bypass, or rack thermal policy. The physical-rack assumption is therefore not a valid measurement assumption: record `dumpsys battery` (including `AC powered`, `USB powered`, `Wireless powered`, level/status) and repeat runs only after confirming the power state. [RTL FAQ](https://developer.samsung.com/remotetestlab/docs/2/faq) · [RTL troubleshooting](https://developer.samsung.com/sdp/blog/en/2022/08/23/troubleshooting-common-issues-while-using-the-remote-test-lab-service)

RTL itself warns that it may not replicate exact operation conditions and that production models can vary. Treat thermal/battery measurements as comparative observations for that RTL device/firmware, not as equivalent to QDC or a handset on battery. [Samsung Developer Terms](https://developer.samsung.com/terms?location=us)

## 5. Terms and data handling

I found **no explicit prohibition on benchmarking, performance measurement, or publishing benchmark results** in the current RTL-specific terms. The terms describe RTL as testing application suitability/compatibility and require use for Samsung-device applications. They also say Samsung does not guarantee a specific device’s availability, the service may not reproduce production conditions, and access ends at the defined period. [Samsung Developer Terms, effective 2026-01-29](https://developer.samsung.com/terms?location=us)

There are material restrictions: the portal Terms say the Site is for personal, non-commercial use; RTL use is warranted for applications designed solely for Samsung devices; users must uninstall all software/content after the session; and users must not copy, reverse-engineer, or decompile the device or connected technology. For company/commercial benchmarking, get Samsung’s written confirmation before relying on the free service. The “designed solely for Samsung devices” wording is also a scope risk for a generic cross-device LLM benchmark unless the benchmark is framed as software being tested on Samsung devices. [Samsung Developer Terms](https://developer.samsung.com/terms?location=us)

Data wiping is not guaranteed as an automatic clean-room contract. Samsung tells users to uninstall their own software/content; its troubleshooting guidance says another user may obtain data left behind and instructs users to contact support so operators can reset the device if cleanup fails. Therefore push only disposable artifacts, pull all results before expiry, explicitly delete `/data/local/tmp` payloads, uninstall any APK, and never place secrets on the device. [RTL user privilege policy](https://developer.samsung.com/remotetestlab/doc/about-remote-test-lab) · [RTL troubleshooting](https://developer.samsung.com/sdp/blog/en/2022/08/23/troubleshooting-common-issues-while-using-the-remote-test-lab-service)

## 6. Practical experience and automation

Community evidence is strong for scripted ADB interaction but weak for this exact native-benchmark workload. A current GitHub project reports a local `localhost:<port>` ADB tunnel and successful permission grants, taps, screencaps, and `dumpsys` through RTL. I found no credible public report demonstrating `adb push` of a standalone custom ELF followed by `adb shell` execution on a current S23/S24/S25 RTL device. [LiveActivity RTL gotchas](https://github.com/FastheDeveloper/LiveActivity/blob/main/GOTCHAS.md#device-and-oem-matrix)

Academic precedent exists for using RTL in published on-device performance evaluation: the MatchNAS paper says all on-device tests in its example evaluation were performed on Samsung RTL. That supports benchmarking in principle, but it does not validate our native-binary transport, thermal controls, or legal posture. [MatchNAS paper](https://openreview.net/pdf?id=3CojD79xYh)

Automation is feasible after connection: the host-side `adb` client can run non-interactive commands, and the RDB binary runs from a terminal on macOS/Linux/Windows. The setup is not headless end-to-end: the documented flow requires a Samsung Developer login, browser reservation, launching the client, clicking RDB Connect, and approving the RSA dialog on the streamed device. A CI harness would need a persistent browser/UI bootstrap (or an undocumented session/API integration), a single RDB process, and cleanup on timeout. Samsung warns that network distance, bandwidth, firewall policy, and interruptions affect sessions; community reports an x86_64 RDB binary, one-instance behavior, and orientation/doze gotchas. [Samsung RDB tutorial](https://developer.samsung.com/remote-test-lab/blog/en/2022/07/13/connect-to-devices-on-remote-test-lab-using-rdb-in-android-studio) · [RTL restrictions](https://developer.samsung.com/remotetestlab/doc/about-remote-test-lab) · [LiveActivity RTL gotchas](https://github.com/FastheDeveloper/LiveActivity/blob/main/GOTCHAS.md#device-and-oem-matrix)

## Verdict

**USABLE-WITH-LIMITS — conditional, not yet a QDC substitute.**

Limits:

- The decisive `adb push` → `chmod` → standalone native ELF execution path is not promised by Samsung and has no public current example; it must pass the hands-on probe before RTL can run the benchmark.
- Regular free usage is 20 credits/day = 5 hours/day, with 30-minute minimum reservations; the policy ceiling is 10 hours/day (40 credits), and normal UI durations are short enough that 5–20-minute cells require reserving blocks and cleaning up inside them.
- Queue time and device availability are live/volatile; no queue SLA was found.
- Thermal/battery telemetry and charging state are not documented; measure and log power state, firmware, SOC/GPU, and thermal outputs per run.
- RDB scripting is practical after browser/UI setup, but end-to-end CI bootstrap is not a documented headless API.
- Terms require personal/non-commercial use, Samsung-device application scope, and post-session deletion; commercial use and publication should be cleared with Samsung.

**Cheapest next probe:** reserve a 30-minute `Galaxy S23 / SM-S911U-US01` row (USA/TX, Android 13; Snapdragon S23 class) and run one prebuilt arm64 static hello/benchmark binary:

```sh
adb push hello-arm64 /data/local/tmp/hello && adb shell 'chmod 755 /data/local/tmp/hello && /data/local/tmp/hello; echo rc=$?'
```

If this returns the binary’s output and `rc=0`, immediately repeat with `adb shell 'id; getprop ro.product.model; getprop ro.soc.model; dumpsys battery; dumpsys thermalservice'`. If execution fails, classify RTL as **NOT-USABLE-FOR-US** for the current QDC-style native workflow; if it passes, proceed to a 5–20-minute microbenchmark repeatability test, still under the limits above. [Live RTL device list](https://developer.samsung.com/remotetestlab/devices/125/galaxy-s/) · [RTL ADB procedure](https://developer.samsung.com/remotetestlab/doc/tests-on-devices)
