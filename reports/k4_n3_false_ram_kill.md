# K4 N3 — false RAM kill fix + relaunch

Device: S23 (`u0_a344@192.168.1.152:8022`)
Script: `~/gdn_k2/k4split/n3/run_n3n4.sh` (on-device edit, no source fork)

## Root cause (verified on-device)

Attempt 1 aborted at first cell `n3_ARM_CPU_fact_o1` (rc=143, wall=57s) with
`ABORT_RAM mf=67224`. The sampler logged **both** MemFree and MemAvailable but
**aborted on MemFree**. During the 12.5 GiB mmap load, MemFree sat at 25–185 MiB
for 12 consecutive 5s samples while MemAvailable stayed **1.1–4.0 GiB**.

Evidence (archived `logs/n3/aborted_attempt_1/runs/n3_ARM_CPU_fact_o1/memfree.csv`):

```
09:27:36  MemFree=25572   MemAvailable=3694196
09:28:21  MemFree=67224   MemAvailable=1148600   ← abort fired here
```

Page cache ate MemFree. This was not real pressure.

## Guard diff (before → after)

Constants:

```
-MEMFREE_ABORT_KIB=307200
-MEMFREE_STREAK_NEED=12   # 12 x 5s = 60s
+MEMAVAIL_ABORT_KIB=307200
+MEMAVAIL_STREAK_NEED=12   # 12 x 5s = 60s
```

Comment:

```
-# 60s MemFree window (12 x 5s). N1 lesson: 15s is a false kill during OpenCL alloc.
+# 60s MemAvailable window (12 x 5s). MemFree logged only; page-cache mmap load is not OOM.
```

Abort predicate + logs (CSV still writes `iso,memfree_kib,memavail_kib`):

```
-      if [ -n "${mf}" ] && [ "${mf}" -lt "${MEMFREE_ABORT_KIB}" ]; then
-        echo "LOW MemFree=${mf} KiB consec=${bad}/${MEMFREE_STREAK_NEED}" >> "${csv}"
-        if [ "${bad}" -ge "${MEMFREE_STREAK_NEED}" ]; then
-          echo "ABORT MemFree=${mf} KiB < 300 MiB sustained 60s" | tee -a "${csv}"
-          echo "ABORT_RAM mf=${mf}" > "${N3}/ABORT_RAM.txt"
+      if [ -n "${ma}" ] && [ "${ma}" -lt "${MEMAVAIL_ABORT_KIB}" ]; then
+        echo "LOW MemAvailable=${ma} KiB consec=${bad}/${MEMAVAIL_STREAK_NEED}" >> "${csv}"
+        if [ "${bad}" -ge "${MEMAVAIL_STREAK_NEED}" ]; then
+          echo "ABORT MemAvailable=${ma} KiB < 300 MiB sustained 60s" | tee -a "${csv}"
+          echo "ABORT_RAM ma=${ma}" > "${N3}/ABORT_RAM.txt"
```

Unchanged: pin (`b8b1c732…`), COMMON_MOE, ABBA order, cold fadvise, 300 MiB / 60 s window.

Backup of pre-fix script: `~/gdn_k2/k4split/n3/run_n3n4.sh.bak_memfree_guard`
(also copied into the archive).

## Archive of failed attempt

Moved (not deleted) live ABORT/STATUS plus forensics to:

`~/gdn_k2/k4split/logs/n3/aborted_attempt_1/`

Contains: `ABORT_RAM.txt`, `STATUS.txt`, `master.log`, `mem_pre.txt`,
`batt_pre.json`, `runs_speed.csv`, `bin.sha256`,
`runs/n3_ARM_CPU_fact_o1/`, `run_n3n4.sh.bak_memfree_guard`.

## Relaunch

| Field | Value |
|---|---|
| Timestamp | `2026-08-13T09:36:01-04:00` |
| PID | 28269 (`~/gdn_k2/k4split/logs/n3/n3n4.pid`) |
| nohup | `~/gdn_k2/k4split/logs/n3/n3n4_nohup.out` |
| Gate at launch | UNPLUGGED, 100%, 27.7°C |
| Pin | OK `b8b1c732` |

## First-cell status (load phase passed — detach)

At T+~3.5 min (`2026-08-13T09:39:49-04:00`):

- Runner **alive**, STATUS=`N3_RUNNING`, **no** `ABORT_RAM.txt`
- `n3_ARM_CPU_fact_o1` **PASS**: rc=0, wall=89s, load=11.465s, decode=2.914 t/s,
  prefill=9.9 t/s, ttft=18.969s, n_gen=200, batt=100→100, temp=27.7→30°C
- `memfree_min=37.8 MiB` — old guard would have killed again; MemAvailable stayed
  ~1.27–4.27 GiB, no LOW/ABORT lines in the new CSV
- Next cell already running: `n3_ARM_SPLIT_fact_o2` started 09:38:35

Detached. PC-side collector picks up completion.

DONE
