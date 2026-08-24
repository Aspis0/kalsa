# q44 — S23 -ngl sweep with LIVE memory accounting (#31, promoted by owner 24/08)

**Locked 2026-08-24 before any device run.** Accounting cell, NOT a speed-ship cell:
all t/s numbers are descriptive/exploratory and will be labeled as such. Purpose:
give the app's GPU fit-gate the constant "system MiB per offloaded weight MiB"
(k) and the KV term (k′), plus the validation series for `MemAvailable − RssFile`.

## Device / conditions (declared)

S23 (adb wireless `adb-R3CW406P8CV…`), **unplugged**, start 100 %, batt 26.3 °C at
probe. Session runs from `adb shell` (never Termux). Model:
`/data/local/tmp/LFM2.5-8B-A1B-KEXP.gguf` — sha256 computed **on-device** before the
first run and required to match the known `b07c8087…` (else STOP).

## Binary

Preferred: the exact llama-bench + libs of the #18 n5 session if still on device —
verified by on-device sha256 against `results/kexp_speed_s23/n5/` MANIFEST pins.
Fallback: any archived pinned build with the q2/q3 GPU kernels (backups/), pushed
fresh, sha256 on-device recorded. Build identity is REPORTED, not gated: the sweep
is self-contained (all comparisons within this cell, single binary for all points).

## Points

`-ngl {0, ceil(N/4), ceil(N/2), ceil(3N/4), 99}` where N = total layers reported by
the engine at load ("offloaded X/N layers", recorded). Order: ascending. One process
at a time. Cooldown ≥ 180 s between points; cool-start gate: batt temp ≤ 35.0 °C
before each point (wait, don't skip).

## Per point — captured (the cell's payload)

1. **Pre-load**: full `/proc/meminfo` dump; batt level+temp.
2. **During generation, sampled at ~1 Hz** by a device-side background loop writing
   to a file (never PC-side polling): `MemAvailable`, `MemFree`, `SwapFree` from
   `/proc/meminfo`; `VmRSS`, `RssAnon`, `RssFile`, `VmSwap` from
   `/proc/<pid>/status` of the bench binary; timestamp per sample.
3. **Post-exit**: full `/proc/meminfo` again.
4. Bench: `llama-bench` pp512 + tg128 (one run each), **stderr captured to file**
   (the OpenCL buffer-allocation lines are part of the payload — the n5 archive
   lost them by saving stdout only).
5. Layers actually offloaded (from stderr), file size of the GGUF, `-ngl` requested.
6. **cpuset gate (mandatory, hard rule)**: read `/proc/<pid>/cpuset` and
   `Cpus_allowed_list` of the BINARY pid; record nproc. Cell invalid without it.
7. Opportunistic (record if readable, no gate): KGSL per-pid GPU mem
   (`/sys/class/kgsl/kgsl-3d0/proc/<pid>/gpumem_mapped` or equivalent) — the direct
   driver-side number if the sysfs node is accessible.

## Derived (analysis, PC-side, after all raw is in)

- Per point: peak MemAvailable drop vs pre-load; ΔRssAnon, ΔRssFile, ΔVmSwap.
- k = (MemAvailable_preload − MemAvailable_min_during) / bytes_offloaded, per point
  and pooled; linearity check in BYTES (not layers) across points.
- The `MemAvailable − RssFile` series per point (validation payload for the app).
- No ship claims. Speed/thermal reported descriptively.

## Hygiene

Device scripts LF-only (`sed -i 's/\r$//'` before run; bash -n on git-bash is a
false confirm). Harness launched detached ON DEVICE (nohup), PC only monitors —
survives PC Modern Standby. All raw pulled to `results/ngl_sweep_s23/` with
per-file sha; report in this cell dir. No git push from agents. STOP conditions:
sha mismatch (model), batt < 30 %, batt temp > 42 °C, any llama-bench rc != 0
(record and continue to next point only for rc != 0 on a single point; abort on
two consecutive failures).
