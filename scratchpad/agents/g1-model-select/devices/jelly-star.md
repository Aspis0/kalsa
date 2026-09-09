# Device manifest — Unihertz Jelly Star — read 2026-09-09 ~06:57 EDT over wireless adb

Read live with `adb -s 192.168.1.82:5555 shell` after the owner plugged it in by USB (serial `JELLYS0000053795`).

| Field | Value |
|---|---|
| Model / SoC | Jelly Star, **MT6789 (MediaTek Helio G99)**, Mali-G57 MC2, `/vendor/lib64/libOpenCL.so` present (Mali parked by owner decision 22/08) |
| Android / SDK | **13** / API 33, build Jelly_Star_20230626, security patch 2023-06-05 (the reason main carries minSdk 33) |
| RAM | MemTotal 7 968 548 kB (~7.6 GiB); **MemAvailable 4 428 204 kB (~4.2 GiB) at idle** |
| Swap | SwapTotal 4 380 020 kB (~4.2 GiB) |
| Page size | 4096 |
| Storage | 228 G, 105 G free (54 % used); `/data/local/tmp` holds LFM2.5-8B-A1B KEXP + Q4_K_M and Marco-Mini i1-Q4_K_M from August |
| Battery at read | 99 %, 27.0 °C, **AC powered**, thermal status 0 |
| Screen timeout / stay-on | 86 400 000 ms / stay_on_while_plugged_in = 7 (keep-alive recipe still applied) |
| Termux | com.termux, .boot, .api installed |
| Kalsa installed | **main @332aeed debuggable** (sha256 `67fff2d7…5eab8`), installed 2026-09-09 06:57 with `adb install -r` over the 25/08 build; `flags=[ DEBUGGABLE …]`, minSdk 33, `run-as` OK |
| App models (22 GB) | gemma-4-e2b 3.8 G, **lfm2.5-2.6b 3.0 G** (QAD-Q4_0 1 593 894 944 B sha `a247afd6…` == ship; plus `LFM2.5-2.6B-Q4_K_M.gguf` 1 674 454 848 B sha `79fdf003…`, a DIFFERENT build from the Mac's Q4_K_M 1 674 455 040 B / `02a8b7e1…`), lfm2.5-8b-a1b 4.8 G, -kexp 3.1 G, multilingual-e5-small 126 M, qwen3.5-2b 1.1 G, qwen3.5-4b 3.2 G, qwen3.5-4b-q3 2.8 G |
| adb | USB serial `JELLYS0000053795`; `adb tcpip 5555` → **192.168.1.82:5555** (TCP mode does not survive a reboot; the Jelly has no USB when unplugged) |

Launch smoke (main@332aeed): `am start` 485 ms, alive at 30 s, RSS 2.27 GB; eager-init of the stored
`kalsa.model.id` = **lfm2.5-2.6b**, fit `fits` (availableMb 4343), `KALSA_SESSION init no_extra_bufts:0` (repack ON,
i.e. no stale norepack pref here), session `load ok:false reason:no_file` (nothing to restore). Zero FATAL; stopped.

Traps: [[jelly-dies-in-idle-sleep]] / [[jelly-keepalive-via-adb]] still apply for long runs; wireless adb only when
unplugged; the stored prefs must still be listed before measuring (same rule as the S23).
