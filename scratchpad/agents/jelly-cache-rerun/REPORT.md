# Jelly cache-cell rerun (cpuset-covariate harness)

Date: 2026-08-19. Device: Jelly Star only (`JELLYS0000053795` / `192.168.1.82`).
S23 (`R3CW406P8CV`) was visible on the same adb server and was **never** addressed.
No git remote push. Local tree only.

## Step 0 — keepalive (adb)

USB adb serial `JELLYS0000053795` was **not** enumerated: the phone is unplugged
(required for valid tok/s). Wireless debugging was on via mDNS:

```
adb-JELLYS0000053795-UFuN1D  _adb-tls-connect._tcp  192.168.1.82:39591
```

`adb connect 192.168.1.82:39591` succeeded. Commands used that serial, not USB.

Applied:

```
adb -s 192.168.1.82:39591 shell settings put system screen_off_timeout 7200000
adb -s 192.168.1.82:39591 shell svc power stayon true
adb -s 192.168.1.82:39591 shell input keyevent KEYCODE_WAKEUP
```

Verification (`dumpsys power | grep mWakefulness`), recorded:

```
  mWakefulness=Awake
  mWakefulnessChanging=false
```

`settings get system screen_off_timeout` → `7200000`.

Re-checked immediately before launch: still `mWakefulness=Awake`.

Note: `svc power stayon true` only holds the screen while a charger is present.
The unplugged hold is the 2 h `screen_off_timeout` plus `KEYCODE_WAKEUP`.
Termux itself is still refused `settings` / `dumpsys` (`INTERACT_ACROSS_USERS`).

## Step 1 — battery / charging

`adb shell dumpsys battery` immediately after keepalive:

```
  AC powered: false
  USB powered: false
  Wireless powered: false
  status: 3
  level: 97
  temperature: 310
```

`termux-battery-status` (ssh) agreed: `"plugged": "UNPLUGGED"`, `"status": "DISCHARGING"`,
`"percentage": 98`. Pre-launch recheck: level 95, still unpowered, temp 32.0 °C.

**Not blocked.** Unplugged, well above the ~30 % risk line and the cell floor (45 %).

## Original cell spec (extracted, not guessed)

The three cache rows ALIVE.md §2 quotes are **not** all in `results/dropsweep_jelly/`.
That directory is the 2026-08-16 v1 sweep (4 drop levels, parser-broken CSV).
The numbers in the cache table come from:

| cache | on-device dir | launch.sh | sweep.log |
|---|---|---|---|
| 1500 | `cachesweep_marco_jelly_c1500` | `results/cachesweep_marco_jelly_c1500/launch.sh` | device `sweep.log` 2026-08-18T00:54 |
| 2000 | `dropsweep_marco_jelly` | `results/dropsweep_marco_jelly/launch.sh` | device `sweep.log` 2026-08-17T23:37 |
| 4000 | `cachesweep_marco_jelly_c4000` | `results/cachesweep_marco_jelly_c4000/launch.sh` | device `sweep.log` 2026-08-18T00:20 |

`results/dropsweep_jelly/REPORT.md` is the **v1** 2000-ish cell (DROPS `0.0 0.3 0.65 1.0`,
no `--drop-no-renorm`, died 11/12). It is **not** the 2000 row of the cache table
(that row is `dropsweep_marco_jelly`, which already includes `1.0nr`).

Common, recorded in every original `sweep.log` header:

- model: `Marco-Mini-Instruct-KEXP.gguf` sha `2f92195854011538…` (full on device:
  `2f921958540115384879eff2eeabfc7087597b245d32b0f515d9ce7b7414d777`)
- binary: `$HOME/bin/kernel_kf/bmoe-cli` sha `77a94640a56a9043…` (full on device:
  `77a94640a56a904301de93ee4c7d74cc7fbb1cc884c2302901d8f173fe3e713e`)
- prompt: `p_fact.txt` sha `b5301c32c0bd8aae…` (full:
  `b5301c32c0bd8aae4cf5c25d667a52eef05b940a459a2e9c82b1b6134cf0dcbd`)
- extra flags: `--n-expert-used 6`
- rounds=3, passes=3, ngen=200, cooldown=120 s, batt_floor=45
- `THREADS=2` from every launch.sh (not printed in sweep.log)
- harness BASE_FLAGS (script, not the log): `--moe-stream --cache-mb $CACHE_MB
  --dense-weights anon --overlap --io-threads 4 --ubatch 512 -t 2 -c 4096
  --temp 0 --chatml --no-think`
- plugged column in every original row: `UNPLUGGED`
- cold reset via `fadv` before every run

Arms (from launch.sh + sweep.log `drops=` line + runs.csv labels):

- 1500 / 4000: `DROPS="0.0 1.0nr"` → 6 measured runs
- 2000 (`dropsweep_marco_jelly`): `DROPS="0.0 0.65 1.0 1.0nr"` → 12 measured runs

`CACHE_MB` is **not** in the original sweep.log header. 1500/4000 set it in
launch.sh. 2000 did **not** export it; the harness default is 2000
(`scripts/run_dropsweep_jelly.sh:55`). Hit rate at d=0 (50.2 %) matches that
row. The rerun sets `CACHE_MB=2000` explicitly so a default change cannot
silently retarget the cell.

Screen posture: **not recorded** in runs.csv or sweep.log. Originals only log
`wake-lock acquired`. Campaign posture is screen-on; that is what this rerun
uses (adb keepalive above). Cannot prove the 18/08 rows were Awake.

Original CSVs have **no** `nproc` / `affinity_mask` columns. That is the gap.

Copies of the original CSVs/logs: `scratchpad/agents/jelly-cache-rerun/originals/`.

## Step 2 — harness gate verification

File on disk: `scripts/run_dropsweep_jelly.sh` (624 physical lines, 27478 bytes,
LF-only, sha256 `d37f0f1baf1da4ba59e2fd011d9de9c06a827ad00dc27be11dbaebebb970e1f5`).
Device copy: same sha, `cr=0`.

| required feature | where |
|---|---|
| F4.3-bis gate, exit 93 | `gate_cpuset` L211–248; `exit 93` at L240 |
| nproc<6 / background\|moderate / popcount<6 | `cpuset_gate_why` L183–209 (L197, L200–203) |
| `FAIL_CPUSET` written to STATUS | L239 |
| `ALLOW_RESTRICTED_CPUSET=1` hatch, stamps every row | L232–236 + L586–590 (`CPUSET_NOTE` into `exclude_reason`, excluded stays 0) |
| `nproc`+`affinity_mask` from **binary PID** | L548–567: `"$BIN" … &`; `pid=$!`; `read_pid_cpuset "$pid"` (L141–173) |
| old-CSV header migration | `ensure_csv_header` L345–386; `*,exclude_reason` → pad two empty fields (L361–370) |
| comma-in-`exclude_reason` | `sanitize_notes` L175–178; applied L591–595; note uses `bits=` not the raw list (L188–189, L207) |
| unknown-header raggedness | L372–383 + pad-to-header-NF L601–608 |
| `FAIL_CPUSET` in watchdog terminal set | `scripts/watch_dropsweep_lfm_jelly.ps1:47–48` (blame `6a26036`) |

`git status` on the harness: **already committed**. Not uncommitted.

```
6a26036 harness: F4.3-bis cpuset gate + nproc/affinity_mask covariates
```

Full hash: `6a26036c47a9fe067c7b41bdb7937763908d7725`.
Branch is 7 commits ahead of `origin/main`. Nothing was pushed.

No new harness commit was made.

Honest residual: the PC watchdog still counts good rows with `grep ',0,ok$'`
(`watch_dropsweep_lfm_jelly.ps1:112`). New rows end `,0,ok,<nproc>,<mask>`, so
that counter will stay 0. It is display-only; relaunch logic uses STATUS +
heartbeat, not the counter. Not fixed in this run.

## Step 3 — device sha checks

| object | device sha256 | vs original |
|---|---|---|
| `$HOME/bin/kernel_kf/bmoe-cli` | `77a94640a56a904301de93ee4c7d74cc7fbb1cc884c2302901d8f173fe3e713e` | matches sweep.log prefix `77a94640a56a9043` |
| `$HOME/models/Marco-Mini-Instruct-KEXP.gguf` | `2f921958540115384879eff2eeabfc7087597b245d32b0f515d9ce7b7414d777` | matches `2f92195854011538` |
| `p_fact.txt` | `b5301c32c0bd8aae4cf5c25d667a52eef05b940a459a2e9c82b1b6134cf0dcbd` | matches `b5301c32c0bd8aae` |
| harness | `d37f0f1baf1da4ba59e2fd011d9de9c06a827ad00dc27be11dbaebebb970e1f5` | matches PC file of `6a26036` |

No transfer of model or binary was needed.

Pushed (after `sed -i 's/\r$//'`, remote `cr=0`, shebang `23 21 2f 64…`):

- `experiments/scripts/run_dropsweep_jelly.sh` (already identical)
- `experiments/results/cachesweep_marco_jelly_c{1500,2000,4000}_cov/launch.sh`

New OUT dirs: originals are complete (`excluded=0` on every label). Resume
against those CSVs would have printed DONE without measuring.

## Step 4 — launch

Rerun cells (one at a time, same device):

1. `cachesweep_marco_jelly_c1500_cov` — DROPS `0.0 1.0nr`, CACHE_MB=1500
2. `cachesweep_marco_jelly_c2000_cov` — DROPS `0.0 0.65 1.0 1.0nr`, CACHE_MB=2000
3. `cachesweep_marco_jelly_c4000_cov` — DROPS `0.0 1.0nr`, CACHE_MB=4000

Launch (c1500, 2026-08-19T09:42:54-0400 device time):

```
cd $HOME/experiments/results/cachesweep_marco_jelly_c1500_cov
setsid nohup bash ./launch.sh >> outer.log 2>&1 < /dev/null &
```

`launch_pid=6131`. After `exec`, `ps` shows
`bash …/run_dropsweep_jelly.sh` with PPID=1. Wrapper name is gone — expected
(`launch.sh` execs the harness). Liveness is the binary PID + growing log.

PC chain: `scratchpad/agents/jelly-cache-rerun/chain.ps1` runs
`scripts/watch_dropsweep_lfm_jelly.ps1 -CellName <cell>` for each dir, launching
the next only after STATUS=`DONE`. Does not `tail -f` any device file.

### First measured row (c1500 r1_d0.0)

From the run's own CSV, not inferred:

```
r1_d0.0 s/tok=0.191 tok/s=5.229 read_MiB=15192.9 hit=39.5
nproc=8 affinity_mask=ff plugged=UNPLUGGED excluded=0
```

Original 18/08 r1_d0.0: s/tok=0.194, read_MiB=15192.9, hit=39.5. Byte columns
are bit-identical; time is within 2 %. Covariates now present (`8`,`ff`).

At ~4 min after launch: STATUS=RUNNING, heartbeat `cooldown 15s left before
r1_d1.0nr`, harness PID 6131 PPID=1 still alive. Watchdog: `alive=1`,
`tot_rows=1`, `good_rows=0` (the stale `,0,ok$` counter — see residual above).

### Live status (first 5 minutes)

sweep.log (device), first lines after launch:

```
bin=…/kernel_kf/bmoe-cli sha=77a94640a56a9043
model=Marco-Mini-Instruct-KEXP.gguf sha=2f92195854011538
drops='0.0 1.0nr' rounds=3 passes=3 ngen=200 cooldown=120s batt_floor=45
extra_flags='--n-expert-used 6'
cpuset OK nproc=8 bits=8 cpuset=/top-app cgroup=/top-app
PREFLIGHT ok rc=0 s/tok=0.187
COLD_RESET r1_d0.0 … drop_mb=3513 fadv_rc=0
```

STATUS=`RUNNING`. HEARTBEAT=`running r1_d0.0 (pass 1)`.

Binary, from `ps` (not inferred):

```
bmoe-cli -m …/Marco-Mini-Instruct-KEXP.gguf … -n 200
  --moe-stream --cache-mb 1500 --dense-weights anon --overlap
  --io-threads 4 --ubatch 512 -t 2 -c 4096 --temp 0 --chatml --no-think
  --n-expert-used 6 --drop-cold-experts 0.0
  --csv …/c1500_cov/per_token/r1_d0.0.csv
```

`/proc/6903/status` (PID of that binary):

```
Name: bmoe-cli
Cpus_allowed: ff
Cpus_allowed_list: 0-7
cpuset=/top-app
cgroup=/top-app
```

Matches the expected Jelly top-app 0-7.

## c1500_cov — DONE (6/6)

STATUS=`DONE` at 2026-08-19T09:59:16-0400. Wall ~16 min. Every row `nproc=8`,
`affinity_mask=ff`, `plugged=UNPLUGGED`, `excluded=0`. Pulled to
`results/cachesweep_marco_jelly_c1500_cov/` (harness outputs only).

| label | rerun s/tok | orig s/tok | rerun read_MiB | orig read_MiB | hit |
|---|---|---|---|---|---|
| r1_d0.0 | 0.191 | 0.194 | 15192.9 | 15192.9 | 39.5 |
| r1_d1.0nr | 0.142 | 0.145 | 4926.2 | 4926.2 | 59.0 |
| r2_d0.0 | 0.188 | 0.189 | 15192.9 | 15192.9 | 39.5 |
| r2_d1.0nr | 0.140 | 0.142 | 4926.2 | 4926.2 | 59.0 |
| r3_d0.0 | 0.185 | 0.189 | 15192.9 | 15192.9 | 39.5 |
| r3_d1.0nr | 0.142 | **0.184** | 4926.2 | 4926.2 | 59.0 |

Byte columns and hit rates are bit-identical to the original. The original
r3_d1.0nr (0.184 at 35 °C) was the thermal outlier; the rerun stays at 0.142
like r1/r2. Drop benefit vs paired d=0: −25.7 / −25.5 / −23.2 % (orig
mean cited as −25 %, with r3 almost flat).

## c2000_cov — DONE (12/12)

Launched 10:00:32 (`launch_pid=2759`, PPID=1). STATUS=`DONE` at
2026-08-19T10:33:44-0400. Binary from `ps`: `--cache-mb 2000 -t 2
--n-expert-used 6`. Gate: `/top-app nproc=8`. Every good row `nproc=8`,
`affinity_mask=ff`, `UNPLUGGED`. Pulled to
`results/cachesweep_marco_jelly_c2000_cov/`.

| label | rerun s/tok | orig s/tok | rerun read_MiB | orig | hit |
|---|---|---|---|---|---|
| r1_d0.0 | 0.181 | 0.163 | 11803.1 | 11803.1 | 50.2 |
| r1_d0.65 | 0.173 | 0.178 | 10535.0 | 10535.0 | 52.3 |
| r1_d1.0 | 0.125 | 0.125 | 3712.8 | 3712.8 | 67.1 |
| r1_d1.0nr | 0.126 | 0.124 | 3562.4 | 3562.4 | 67.9 |
| r2_d0.0 | 0.170 | 0.165 | 11803.1 | 11803.1 | 50.2 |
| r2_d0.65 | 0.174 | 0.175 | 10535.0 | 10535.0 | 52.3 |
| r2_d1.0 | 0.124 | 0.124 | 3712.8 | 3712.8 | 67.1 |
| r2_d1.0nr | 0.123 | 0.127 | 3562.4 | 3562.4 | 67.9 |
| r3_d0.0 | 0.170 | 0.171 | 11803.1 | 11803.1 | 50.2 |
| r3_d0.65 | 0.176 | 0.171 | 10535.0 | 10535.0 | 52.3 |
| r3_d1.0 | 0.128 | 0.127 | 3712.8 | 3712.8 | 67.1 |
| r3_d1.0nr | 0.124 | 0.123 | 3562.4 | 3562.4 | 67.9 |

Bytes and hit rates bit-identical. r1_d0.0 is 0.018 s/tok slower (phone was
already at 35–37 °C after the 1500 cell; original r1 started at 30 °C).
Paired d=1.0nr vs d=0: −30.4 / −27.6 / −27.1 %. Direction of the original
−24.9 % holds.

Watchdog first probe `ALIVE=2` (model `sha256sum` subshell — same false
positive as the 18/08 c1500 watch log). Did not relaunch. Next probes
`alive=1`.

## c4000_cov — DONE (6/6 good labels), with a resume

Launched 10:35:42 (`launch_pid=13861`). Binary from `ps`: `--cache-mb 4000
-t 2 --n-expert-used 6`. Gate: `/top-app nproc=8`. `Cpus_allowed_list: 0-7`
on the live binary PID.

First pass hit the same cold-reset wall as the original 18/08 cell:
`MIN_DROP_MB=1000`, `r2_d0.0` drop_mb 976 / 921 / 922 → `excluded=1`.
Original sweep.log L20–21 is the same exclude (`drop_mb=952`); they recovered
by relaunching after a 12 min death, smoke filled the page cache, resume
got `drop_mb=1311`. This rerun did the same: harness exited `STOP_VOID` at
10:59:49 (PASSES=3 spent). Manual `setsid nohup bash ./launch.sh` at 11:03
(void = `[r2_d0.0]` only). Smoke + fadv: `drop_mb=1598`. Row accepted.

STATUS=`DONE` at 2026-08-19T11:04:42-0400. Pulled to
`results/cachesweep_marco_jelly_c4000_cov/`.

Good rows (`excluded=0`):

| label | rerun s/tok | orig s/tok | rerun read_MiB | orig | hit | nproc |
|---|---|---|---|---|---|---|
| r1_d0.0 | **0.189** | 0.116 | 3365.8 | 3365.8 | 76.8 | 8 |
| r1_d1.0nr (pass 2) | 0.137 | 0.217 / 0.131 | 1188.8 | 1188.8 | 81.7 | 8 |
| r2_d0.0 (resume) | 0.111 | 0.113 | 3365.8 | 3365.8 | 76.8 | 8 |
| r2_d1.0nr | 0.133 | 0.131 | 1188.8 | 1188.8 | 81.7 | 8 |
| r3_d0.0 | 0.113 | 0.113 | 3365.8 | 3365.8 | 76.8 | 8 |
| r3_d1.0nr | 0.130 | 0.130 | 1188.8 | 1188.8 | 81.7 | 8 |

Bytes and hits bit-identical. r1_d0.0 is a first-cell outlier (37 °C, just
after allocating a 4000 MiB cache) — same class as the original r1_d1.0nr
0.217. Thermally matched pairs: d=1.0nr / d=0 = 0.133/0.111 = **+20 %** and
0.130/0.113 = **+15 %**. Drop still hurts at cache 4000.

One excluded row recorded `nproc=0` with `affinity_mask=ff`
(`r1_d1.0nr` pass 1). The binary produced a real measurement; the first
`/proc/<pid>/status` sample was empty and `popcount` fell through to 0.
That row is `excluded=1` anyway. All accepted rows are `8,ff`.

## Keepalive hold

`mWakefulness=Awake` at every poll: pre-launch, 09:59, 10:17, 10:37, 10:53,
11:02, 11:05. First apply ~09:42, last check 11:05 → **~83 min**, still
Awake, never Dozing. The ~20 min Termux kill did not fire. Watchdog never
had to relaunch a dead harness (the c4000 resume was an operator relaunch
for `STOP_VOID`, not a crash).

Battery: 97 % → 55 %, always `AC/USB/Wireless powered: false`, status 3
(discharging). Floor 45 % never hit.

## What this rerun settles

On the Jelly, with the binary PID recorded as `/top-app`, `nproc=8`,
`affinity_mask=ff`:

- cache 1500: drop still pays (~−25 %)
- cache 2000: drop still pays (~−27 to −30 %)
- cache 4000: drop still hurts (~+15 to +20 %)

The shipped "give Marco RAM, do not drop" reading is not a restricted-cpuset
artefact on this phone.

## Honest leftovers

- Original 18/08 screen state is still unknown (not in those CSVs).
- Watchdog `good_rows` grep `,0,ok$` is blind to the new schema (confirmed 0
  the whole run). Relaunch logic uses STATUS + heartbeat, not that counter.
- `pgrep` on `launch.sh` is empty on a healthy cell (`exec`). Liveness was
  the binary PID + growing `sweep.log`.
- One excluded c4000 row has `nproc=0` (sampling hole, see above).
- c4000 needed the same resume the original needed. Not hidden.
- S23 serial `R3CW406P8CV` was listed by `adb devices` and was never sent a
  command.
- No git push. Harness was already `6a26036`; no new commit.
- `PLAN.md` not touched. Result files only from the harness (plus these
  scp pulls of its outputs).

