# Device manifest — Xiaomi 14 (houji) — read 2026-09-09 ~04:20 EDT over wireless adb

Read live with `adb -s 192.168.1.193:5555 shell` (G0 of PROPOSTA §11/§12; "RAM e firmware dell'unità vanno letti, non dedotti").

| Field | Value |
|---|---|
| Model / codename | 23127PN0CG, `houji_global` |
| SoC | SM8650 (Snapdragon 8 Gen 3) → `generationFor()` = **V75** |
| GPU | Adreno 750, `/vendor/lib64/libOpenCL.so` present |
| Android / SDK | **16** / API 36, build BP2A.250605.031.A3, HyperOS **OS3.0**, security patch 2026-07-01 |
| RAM | MemTotal 11 436 476 kB (~10.9 GiB); **MemAvailable 3 712 888 kB (~3.5 GiB) at idle** |
| Swap (RAM extension) | SwapTotal 12 582 908 kB (~12 GiB) — never count it as RAM (§13) |
| Page size | 4096 |
| Storage | /data 482 G total, 300 G free (38 % used); `/data/local/tmp` holds 10 GB of Aug-campaign GGUFs (Marco-Mini KEXP q8_0 6.5 GB, OLMoE Q4_0 3.9 GB) |
| Battery at read | 98 %, 37.8 °C, **AC powered (Quick charge)**, thermal status 0 |
| Screen timeout / stay-on | 600 000 ms / stay_on_while_plugged_in = 0 |
| Kalsa installed | `com.kalsa.app` versionName 0.1.0 versionCode 1, installed **2026-08-14**, minSdk 35 targetSdk 36, **NOT debuggable** (`run-as: package not debuggable`) — superseded; install the CI debuggable APK from main 332aeed (run 34336007950) before any test |
| adb | USB serial `625689a2`; switched to `adb tcpip 5555`, reachable at **192.168.1.193:5555** (LAN name `xiaomi-14.lan`). TCP mode does not survive a reboot: re-run `adb tcpip 5555` over USB after one |

Notes for the campaign:
- MemAvailable ~3.5 GiB of 10.9 with nothing of ours running: this is the HyperOS regime in which the app's RAM gate can refuse a model that fits (PROPOSTA §11 "test del falso rifiuto memoria a modello già caricato"). Record MemAvailable at every turn, not just at load.
- Timings while charging are functional checks, not measurements (same rule as the S23).
- macOS trap (cost ~1 h on 9/09): on Apple-silicon Macs a new USB accessory must be approved (System Settings → Privacy & Security → "Allow accessories to connect"); until then the phone only sees Quick charge and adb sees nothing.
