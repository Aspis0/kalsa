# Lineup provenance cell — Marco1c on Jelly (shipped config)

Date: 2026-08-19. Device: Jelly Star only. S23 (`R3CW406P8CV`) listed by
`adb devices` and never addressed. No git push. `PLAN.md` / `docs/ALIVE.md`
not edited.

## 1. Keepalive + battery

USB serial `JELLYS0000053795` not present (phone unplugged). Wireless adb
already attached as `192.168.1.82:39591` (`adb devices -l`:
`product:Jelly_Star`). mDNS this session listed only the S23; the Jelly
port was the leftover pairing from the cache rerun. Used that serial.

Applied:

```
adb -s 192.168.1.82:39591 shell settings put system screen_off_timeout 7200000
adb -s 192.168.1.82:39591 shell svc power stayon true
adb -s 192.168.1.82:39591 shell input keyevent KEYCODE_WAKEUP
```

`dumpsys power`:

```
  mWakefulness=Awake
  mWakefulnessChanging=false
```

`settings get system screen_off_timeout` → `7200000`.

`dumpsys battery` (start):

```
  AC powered: false
  USB powered: false
  Wireless powered: false
  status: 3
  level: 46
  temperature: 250
```

`termux-battery-status`: `"plugged": "UNPLUGGED"`, `"percentage": 46`.
Pre-launch recheck: level **45**, still unpowered. Not `<45`, so the cell
was started. Floor inside the cell is 35 (lineup protocol, see below).

sshd on 8022 refused once after keepalive (Termux group idle). Recovered
by `am start -n com.termux/.app.TermuxActivity` via adb; ssh returned.
Screen was still `Awake`.

## 2. Config provenance (file:line, not guessed)

### What the card 3.64 actually was

`docs/ALIVE.md:546` — `3.64 t/s (t2, ranking)`.
`docs/ALIVE.md:535-541` — flagged as a card with no `runs.csv`+analysis
cite. The audit (`docs/audit-2026-08-16-claims.md:102-106`) points at
`results/lineup_card/`.

That directory **does** contain the pair:

- `results/lineup_card/jelly_1c/SPEED_VERDICT.md`
- `results/lineup_card/jelly_1c/runs_speed.csv`

`SPEED_VERDICT.md:35-50` — median decode **3.642** t/s from four ABBA runs
(fact 3.594 / 3.576, creative 3.770 / 3.690). Protocol
`SPEED_VERDICT.md:23`:

```
-t 2 -c 4096 --moe-stream --cache-mb 2000 --dense-weights anon --overlap
--io-threads 4 --ubatch 512 --n-expert-used 6 --drop-cold-experts 0.65
--temp 0 --chatml --no-think
```

Confirmed byte-for-byte in `results/lineup_card/jelly_1c/logs/ARM_1C_fact_o1/cmdline.txt:1-32`.
Binary: `~/bin/bmoe-cli.JELLY` sha `36b01966ba0f471d17f8fcb29ab49f64f760999c4256f612f959a7a0b178ce81`
(`SPEED_VERDICT.md:15`). Model sha `2f92195854011538…` (`SPEED_VERDICT.md:14`).

So the card is **k6 d=0.65 cache 2000 t2** on that binary, not the shipped
config.

### What Marco ships now

| flag | value used | citation |
|---|---|---|
| drop | **0.0** (no drop) | user brief; `docs/ALIVE.md:581`; PLAN STATO CORRENTE "NESSUN DROP" / "Marco ships **no drop**" |
| threads | **2** | `docs/ALIVE.md:546` "t2, ranking"; `SPEED_VERDICT.md:23`; `cmdline.txt:25-26` |
| `--n-expert-used` | **6** | `SPEED_VERDICT.md:23`; `cmdline.txt:11-12` |
| `--cache-mb` | **2000** | lineup `SPEED_VERDICT.md:23` / `cmdline.txt:16-17`; campaign default `PLAN.md:3374` (`--cache-mb 2000`). See ambiguity below. |
| stream flags | `--moe-stream --dense-weights anon --overlap --io-threads 4 --ubatch 512` | same two sources |
| `-c` / sampling | `4096` / `--temp 0 --chatml --no-think` | same |
| ngen | 200 | `SPEED_VERDICT.md:27`; `cmdline.txt:9-10` |
| prompt | `p_fact.txt` sha `b5301c32c0bd8aae…` | `SPEED_VERDICT.md:25`; on-device `kf_cold_jelly/prompts/p_fact.txt` |
| binary | `bmoe-cli.JELLY` `36b01966…` | `SPEED_VERDICT.md:15`. **Not** the cache-cell pin. |
| batt floor | 35 % | `SPEED_VERDICT.md:28` (lineup). Cache cells used 45; start here was 45–46. |
| rounds | 3 of d=0.0, p_fact, cold, unplugged | dropsweep pairing (`run_dropsweep_jelly.sh` protocol). Card was 4-run ABBA of two prompts — see below. |

### Ambiguities, not guessed away

1. **`--cache-mb` 2000 vs 4000.** The lineup cell and the campaign default
   string are 2000. After the cache sweep, PLAN/ALIVE say the Jelly
   *optimum* is cache 4000 with no drop (0.113 s/tok on `kernel_kf`).
   That optimum is **not** what the card used and is **not** in the
   campaign flag string (`PLAN.md:3374`). The runtime probe that would
   pick 4000 is unbuilt (`docs/ALIVE.md:588`). This cell uses **2000**
   so it is the shipped *flag*, not the later recommendation.
2. **Binary.** Cache cells rest on `~/bin/kernel_kf/bmoe-cli`
   `77a94640…`. The lineup does **not**. Both exist on the device
   (verified). This cell uses the **lineup** binary so a comparison
   against 3.64 isolates the config change (d=0.65 → d=0.0), not an
   engine swap. `kernel_kf` at the same flags already has d=0.0 rows in
   `results/cachesweep_marco_jelly_c2000_cov/` (~5.5–5.9 t/s) — a
   different pin, not this gap.
3. **ABBA of two prompts vs 3 rounds of p_fact.** The card interleaved
   `p_fact` / `p_creative`. `p_creative` is not on the device (only on
   the PC under `results/lineup_card/jelly_1c/prompts/`). The covariate
   harness takes one `PROMPT`. This cell does **3 cold rounds of
   p_fact** so every row is the same prompt and the harness is
   unmodified. Comparison to 3.64 therefore uses the card's **fact**
   arm (3.594 / 3.576) as the like-for-like, and also quotes the card
   median 3.642. Not the same protocol.

## 3. Device sha checks

| object | device sha256 | vs recorded |
|---|---|---|
| `~/bin/bmoe-cli.JELLY` | `36b01966ba0f471d17f8fcb29ab49f64f760999c4256f612f959a7a0b178ce81` | `SPEED_VERDICT.md:15` MATCH |
| `~/bin/kernel_kf/bmoe-cli` (not used) | `77a94640a56a904301de93ee4c7d74cc7fbb1cc884c2302901d8f173fe3e713e` | cache-cell pin, left unused |
| model | prefix `2f92195854011538` (harness log; full sha verified 2026-08-19 cache rerun) | MATCH |
| `p_fact.txt` | `b5301c32c0bd8aae4cf5c25d667a52eef05b940a459a2e9c82b1b6134cf0dcbd` | MATCH |
| harness | `d37f0f1baf1da4ba59e2fd011d9de9c06a827ad00dc27be11dbaebebb970e1f5` | commit `6a26036` MATCH, LF-only |

Lineup binary smoke (n=5, d=0.0) before the cell: rc=0, `# summary`
present, `s/tok=0.287`. `ldd` resolves via rpath
`$HOME/src/BigMoeOnEdge/build-jelly/bin/`, not `kernel_kf/`.

## 4. Launch

```
cd $HOME/experiments/results/lineup_marco_jelly_cov
setsid nohup bash ./launch.sh >> outer.log 2>&1 < /dev/null &
```

`launch_pid=19433`, then `exec` → `run_dropsweep_jelly.sh` PPID=1.
PC watchdog: `scripts/watch_dropsweep_lfm_jelly.ps1 -CellName lineup_marco_jelly_cov`.
No `tail -f`.

Within ~2 min: STATUS=`RUNNING`, gate
`cpuset OK nproc=8 bits=8 cpuset=/ cgroup=/` (not `/top-app` this
session — Termux was re-opened via `am start`; still 8 cores, not
restricted). Binary from `ps` (not inferred):

```
bmoe-cli.JELLY -m …/Marco-Mini-Instruct-KEXP.gguf -n 200
  --moe-stream --cache-mb 2000 --dense-weights anon --overlap
  --io-threads 4 --ubatch 512 -t 2 -c 4096 --temp 0 --chatml --no-think
  --n-expert-used 6 --drop-cold-experts 0.0
```

`/proc/19713/status`: `Cpus_allowed: ff`, `Cpus_allowed_list: 0-7`,
`cpuset=/`.

Harness log: `bin=…/bmoe-cli.JELLY sha=36b01966ba0f471d`,
`drops='0.0' rounds=3`, `batt_floor=35`.

## 5. Results

STATUS=`DONE` at 2026-08-19T13:39:26-0400. No death, no watchdog relaunch
(the start `ALIVE=2` alert is the model-sha subshell, same as the cache
rerun; next probe `alive=1`, then `DONE`). Screen still `Awake` at 13:45.
Battery 45 → 41 % during the three runs, 40 % at the post-check; still
unplugged.

`runs.csv` (pulled to `results/lineup_marco_jelly_cov/runs.csv`):

```
ts,pass,run_idx,round,drop,label,s_tok,tok_s,...,hit,nproc,affinity_mask
2026-08-19T13:32:52-0400,1,1,1,0.0,r1_d0.0,0.299,3.340,...,50.2,...,UNPLUGGED,0,ok,8,ff
2026-08-19T13:36:08-0400,1,2,2,0.0,r2_d0.0,0.295,3.386,...,50.2,...,UNPLUGGED,0,ok,8,ff
2026-08-19T13:39:26-0400,1,3,3,0.0,r3_d0.0,0.306,3.273,...,50.2,...,UNPLUGGED,0,ok,8,ff
```

Every row: `excluded=0`, `nproc=8`, `affinity_mask=ff`, `plugged=UNPLUGGED`,
`read_MiB=11803.1`, `cache_hit_pct=50.2`, `drop=0.0`. Binary sha in
`sweep.log`: `36b01966ba0f471d`. Command line of the running PID had
`--cache-mb 2000 -t 2 --drop-cold-experts 0.0 --n-expert-used 6`.

### Per-round (no single-number claim)

| round | s/tok | tok/s | stall | compute | batt | temp °C |
|---|---:|---:|---:|---:|---|---|
| r1 | 0.299 | **3.340** | 0.118 | 0.161 | 45→44 | 28→29 |
| r2 | 0.295 | **3.386** | 0.115 | 0.160 | 44→43 | 30→30 |
| r3 | 0.306 | **3.273** | 0.122 | 0.163 | 43→41 | 31→32 |

Range 3.273–3.386 t/s (±3.4 % around the mid value). Not the ±50 %
horror case; three cold rounds agree.

Median tok/s (n=3): **3.340**. Mean: 3.333. Median s/tok: 0.299.

### Versus the card 3.64 t/s

| | tok/s | config | prompt | binary |
|---|---:|---|---|---|
| Card median (`SPEED_VERDICT.md:50`) | **3.642** | k6 **d=0.65** cache 2000 t2 | ABBA fact+creative | `36b01966` |
| Card fact arm only | 3.594 / 3.576 | same | p_fact | same |
| **This cell** | **3.340 / 3.386 / 3.273** | k6 **d=0.0** cache 2000 t2 | p_fact × 3 cold | **same** `36b01966` |

Like-for-like (p_fact, same binary, same cache, same t): shipped d=0.0
is **3.27–3.39 t/s** against the card's fact arm **3.58–3.59 t/s**
(about 6–9 % slower). Against the card's published 3.64 (which averages
in the faster creative prompt) it is about 8 % slower.

That is **not** a contradiction of the cache-sweep "d=0.0 is faster"
result: those rows were on `kernel_kf` `77a94640` (5.53 / 5.87 / 5.89 t/s
at the same flags, `results/cachesweep_marco_jelly_c2000_cov`). Same
`read_MiB=11803.1` and `hit=50.2` — the I/O regime matches to the digit;
the tok/s gap is the **binary**, not the drop. Closing the lineup gap
on the card's own pin does not replace that later pin.

## 6. Honest leftovers

- Cache 4000 was not run here (see §2 ambiguity). A shipped-optimum
  cell at 4000 on this binary is a different measurement.
- Not two-prompt ABBA (p_creative absent on the device).
- `cpuset=/` with 0-7, not `/top-app`. Gate passed (nproc=8, not
  background/moderate). Covariates record it.
- Watchdog `good_rows` still 0 (stale `,0,ok$` grep). Did not matter.
- Start battery 45–46 %: allowed (`<45` would have skipped). Floor 35
  never hit.
- No mid-cell death. No relaunch to verify.
- `PLAN.md` / `ALIVE.md` untouched. No push.

