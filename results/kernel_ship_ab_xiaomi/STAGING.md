# Staging record — Xiaomi 14, ship A/B replication

Staged 2026-08-16 06:21-06:31, **before the harness existed and before any run**.
Everything below was verified by hash on the device, not assumed from a
successful transfer.

## Device

Xiaomi 14 `23127PN0CG` (`houji`), adb serial
`adb-625689a2-9xEOfw._adb-tls-connect._tcp` (wireless, 69 MB/s on small files,
~15 MB/s sustained for the 8 GB model — flash write, not the link).
Battery 100 %, **unplugged**, 30.2-31.9 °C, 326 GB free on /data.

## Staged at `/data/local/tmp/ship_ab/`

| item | sha256 | verified |
|---|---|---|
| `bin/` (7-file pinned runtime) | see `models_staging/ship_runtime_s23_0ac612de/DEVICE.sha256` | **7/7 OK** on device |
| `Mellum2-12B-A2.5B-Instruct-Q4_K_M.gguf` | `b04281c27de5d968d577f310d982273b1b13bdbd8117b3ecffffeebfe222f0a7` | **match** (PC and device computed independently), 8 071 293 600 bytes |
| `prompts/p_fact.txt` | `b5301c32c0bd8aae4cf5c25d667a52eef05b940a459a2e9c82b1b6134cf0dcbd` | **match**, same prompt as the S23 cell |

`bmoe-cli` is dynamically linked — every invocation needs
`LD_LIBRARY_PATH=/data/local/tmp/ship_ab/bin`.

## Blocking item before the first measured run

The PREREG requires a **fresh reboot**. At staging time the device reported
`up 1 day, 3:17` with load average 3.62/4.96/6.82 and ~3 GB already in zram
(`MemAvailable` 4.0 GB, `SwapFree` 9.47 GB of 12 GB). That is the exact state
that invalidated two S23 sessions (arm A degraded 60-100x under dirty zram).
**Do not start the sequence from this state.**

## Not yet done

- Harness `run_ship_ab_xiaomi.sh` + `push_and_start_xiaomi.ps1` — being ported
  from the S23 bash/Termux original to Android POSIX `sh`.
- Reboot, then session start.
