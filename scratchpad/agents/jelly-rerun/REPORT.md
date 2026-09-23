# Jelly Star rerun (Run A / Run B) on the fixed build — cell report (2026-09-22)

**STATUS: RUN A = STALL REPRODUCED. RUN B = COMPLETED (with a warm-KV confound).**
The rerun ran on 2026-09-22 17:18-18:06 EDT on APK `d3c66bdb...` (engine `1577495b9`,
stamp `kalsa-eng-v2:1725f3a8...`). Run A reproduced the prefill stall on the fixed build:
`KALSA_STALL {"gapMs":0,"tokens":0,"turnId":"1","reason":"prefill","tokPerSec":31.755094769952162}`
at **+1175.04 s** after `KALSA_THINKING`, zero tokens, notice `entro 1175 s`. Run B
(seeded EMA) **completed** in +213.30 s with 75 tokens and the answer `4`, but on warm KV
(`kvHeld:true`, only 761 new prompt tokens), so it does not isolate the EMA variable.
Evidence: both logcat captures (filtered + full raw) and UI dumps under `raw/`.
No energy CSV exists: the new APK is NOT debuggable, so `run-as`/`sql_write` cannot arm
`kalsa.bench.energy_trace` (declared, D1). Full detail in sections 11-16.

Scope held: Jelly Star `192.168.1.82:5555` only; every adb command addressed with
`-s 192.168.1.82:5555`. The S23 (`adb-R3CW406P8CV-…`) appeared in `adb devices -l` output and
received **no command, not even a read**. No push, no tag, no commit, no upstream contact.

---

## 0. Sources read first, not re-derived

* `scratchpad/agents/meter-close/REPORT.md` — 638 lines, read in full (protocol, ladder rungs,
  stall signature and its arrival times, evidence format).
* `scratchpad/COORDINATOR-STATE.md` — read in full (how the task was left: "Jelly Star rerun
  (Run A / Run B, the stall protocol on the fixed build) is still waiting for the phone to be
  at >= 70% battery. It was at 21% and discharging.").
* Because they carry the operative instructions for this cell, also read:
  `scratchpad/agents/jelly-rerun-with-fixes/REPORT.md` (the aborted pre-flight; its section 0.8
  defines the resume point: hash BEFORE, `adb install -r` of `fbfe131f…`, re-hash, arm
  `kalsa.bench.energy_trace=1`) and `scratchpad/agents/jelly-prefill-hung-or-slow/REPORT.md`
  (defines Run A = the real-conversation stall reproduction, Run B = the section 4(a) in-memory
  EMA seed, branch-2 deadline run).

No protocol step was found to be wrong. None was silently changed. Nothing got as far as a
step that could deviate.

## 1. Battery and charger — both gates PASS (read first, as instructed)

Fresh archived read at start (13:40 EDT), `dumpsys battery` on the Jelly:

| field | value |
|---|---|
| AC / USB / Wireless powered | **false / false / false** |
| status | **3 (discharging)** |
| level | **100 %** |
| voltage | 4380 mV |
| temperature | 22.0 °C |

Second fresh read at 13:51 EDT: still `false/false/false`, status 3, **level 99 %**,
24.0 °C. The coordinator's `>= 70 %` requirement is met with a wide margin. Not charging,
so the never-measure-while-charging rule is satisfied as of these reads; a fresh read is
required again immediately before any run, once a run becomes possible.

## 2. Installed build — read BEFORE touching anything

* `pm path com.kalsa.app` ->
  `/data/app/~~DeXzzJqpOSg2v2XKyM9rZg==/com.kalsa.app-UxC0xITqI0kpPL-dayUwRA==/base.apk`
* sha256 of the installed `base.apk`, streamed (`exec-out cat | shasum -a 256`):
  **`d56abe5f87cd352ad2e4f826203d1060be3fa8aa93e07c6a950606f51f3f1342`**
* `dumpsys package com.kalsa.app`: `versionCode=1`, `versionName=0.1.0`,
  `lastUpdateTime=2026-09-21 12:26:08`, `firstInstallTime=2026-08-12 01:58:33`.
* `settings get system screen_off_timeout` = `7200000` (read only, never changed).

**Declared before installing, per instruction: the device carries the OLDER build.** Hash
`d56abe5f…` is the **Meter build** (pre-fix, branch `app-integration-2026-09-20` tip `6a58ef5`
+ engine pin `0288dc27`, as documented in meter-close REPORT section (a)) — the exact build
whose stall this rerun is supposed to re-test on the FIXED build. It has been installed since
2026-09-21 12:26:08 and nothing has replaced it since. This is expected: the
jelly-rerun-with-fixes cell aborted at its battery gate before `adb install -r` could run.

App state: **STOPPED** (`pidof com.kalsa.app` -> STOPPED), as found.

## 3. The fixed APK — VERIFIED MISSING (this is the blocker)

Expected artifact:

```
/Users/marco/Projects/kalsa-wt-build-fixes/android/app/build/outputs/apk/release/app-release.apk
sha256 fbfe131f7150daa8e4a79c9c459673f30e272340578c455479b06abaac2d7b12  (size 159 255 122 B, mtime 2026-09-21 15:55)
```

Verification results (hash computed, not assumed):

1. The path does not exist — `android/app/build/` is gone from the worktree; the whole
   `outputs/` tree is absent. Yesterday's cache cleanup (COORDINATOR-STATE: "the app's
   `android/app/build` + `.gradle` 5.9 G") is the likely deletion, though the cleanup note
   names the main `kalsa` checkout; either way the directory is gone.
2. The file is still referenced by its own build log,
   `kalsa-wt-build-fixes/build-s23-fixes.log` (tail):
   `fbfe131f7150daa8e4a79c9c459673f30e272340578c455479b06abaac2d7b12  app/build/outputs/apk/release/app-release.apk`,
   `BUILD SUCCESSFUL in 7m 31s`. So the APK existed at 15:55 on 2026-09-21 and was produced
   from worktree HEAD `e5788cf` plus the then-present uncommitted changes (see section 5).
3. **Every APK on this Mac was sha256'd** (50 files across `~/kalsa-apks`, `~/kalsa-qdc`,
   `~/kalsa-apk-*`, `~/kalsa-local-artifacts`, `~/Projects/kalsa-ux`, `~/.paseo/worktrees/…`):
   **none hashes to `fbfe131f…`**. The only hashes near the family are
   `d56abe5f…` (= `kalsa-local-artifacts/s23-repack-timing-app-release.apk`, the Meter build
   also currently on the phone) and `245c514c…` (= `POLICY-OLD-pulled.apk`, the old-pin build).
4. A filename-independent search for a file of exactly 159 255 122 bytes: **0 results**.
5. `~/.Trash`: empty. Time Machine local snapshots: **none**
   (`tmutil listlocalsnapshots /` returns nothing). No external volumes (`/Volumes` =
   `Macintosh HD` only). Spotlight name search: no other candidates.
6. The device does not hold a copy: `/data/local/tmp` contains no APK (full inventory in
   section 6), and the only installed APK is the `d56abe5f…` one. The S23 was not searched —
   it is another agent's device and received no command.

Conclusion: the fixed build artifact cannot be installed because it no longer exists anywhere
this machine can see.

## 4. Run A and Run B — NOT ATTEMPTED

* **Run A** (reproduce the real-conversation stall protocol on the fixed build: `2+2` into
  `conv-1789854932144-696fm3wu`, bounded `adb logcat -s ReactNativeJS RNLlama` watcher,
  `kalsa.bench.energy_trace=1` armed via the repo helper, evidence = `KALSA_SEND` /
  `KALSA_WINDOW` / `KALSA_THINKING` / `KALSA_STALL` line + arrival timestamp + token count +
  CSV if produced): **not run**. Blocked at step "hash BEFORE + `adb install -r` of
  `fbfe131f…`".
* **Run B** (seed the in-memory EMA in a throwaway chat with a `prompt_n >= 64` turn, same
  process, then repeat the stall send on branch 2 of the deadline): **not run**. It inherits
  the same blocker, and per protocol it must happen in one app process after the fixed build
  is installed, so it could not have been run independently anyway.
* No `KALSA_STALL` line, no timestamp, no token count, no CSV exists for today. The stall
  evidence format to be produced on a future run is unchanged from meter-close:
  `KALSA_STALL {"gapMs":0,"tokens":…,"turnId":…,"reason":"prefill","tokPerSec":…}` with its
  logcat wall-clock timestamp, plus the `files/energy/<wall_ms>-t<turnId>.csv` if the trace
  was armed.

## 5. What a rebuild would and would not give (decision needed from the owner)

The build inputs still exist: worktree `/Users/marco/Projects/kalsa-wt-build-fixes` at HEAD
`e5788cf`, script `.build-s23-repack.sh`, `node_modules/` intact, build log kept. Facts the
owner needs before choosing:

* The worktree is **dirty**: uncommitted changes in `src/engine/governorInputs.ts`,
  `src/engine/governorInputs.test.ts` and `AGENTS.md` (all with mtime 2026-09-21 15:35:04,
  i.e. **on disk before the 15:55 build**, so `fbfe131f…` was built from this dirty state),
  plus `android/` touched at 2026-09-21 23:12 (after the build).
* A fresh build with the same script and tree would be the same source state but will **not**
  reproduce the sha `fbfe131f…` (zip entry timestamps / build clock), so it is a **new
  artifact with new provenance**, not "the" fixed build as previously hashed and recorded.
* Building takes roughly 40–90 min from clean (2874 native objects were involved last time).
* Not done by me: no build was started, no install was attempted.

Options for the owner, as I see them: (1) authorise a rebuild in this worktree and accept a
new recorded hash as the fixed build; (2) recover `fbfe131f…` from a backup/another machine
if one exists that I cannot see; (3) point me at another copy of the artifact.

## 6. Device hygiene — what I found, what I left

**Nothing was written to the device.** No install, no uninstall, no app-data clear, no
force-stop, no SQL write, no setting change (`screen_off_timeout` read only: `7200000`),
no logcat capture started, no harness process started. App left **STOPPED** (as found).

`/data/local/tmp` (114 entries): inventoried, **nothing added by this cell, nothing deleted**.
Everything in it predates this cell and belongs to earlier sessions' evidence (the three large
`.gguf` model files, `bmoe*`, `llamabench*`, `q56/q60` probe artifacts, `meter-ui*.xml` and
`ui.xml` from the 2026-09-21 meter-close cell, various `kalsa-*.xml` UI dumps, etc.). I did
not delete other cells' artifacts without an instruction naming what to remove; if the owner
wants a purge, say so and it is a single pass.

`files/energy/`: untouched (still the 8 CSVs meter-close left, per the last inventory).

Bench keys: untouched — no key was read-modified-written this cell (the store was not opened;
the app is stopped and the only store access was through nothing at all this cell).

## 7. NOT VERIFIED (this cell)

1. Everything about the fixed build's behaviour on the device — it is not installed.
2. Whether Run A still stalls, and whether Run B's branch-2 deadline lets the turn complete —
   both OPEN, exactly as the coordinator left them.
3. Whether a rebuild reproduces `fbfe131f…` — claimed "no" in section 5 on general grounds
   (timestamps), not tested, because no build was run.
4. Whether the `fbfe131f…` APK survives anywhere off this machine.

**Not committed, not pushed, no tag, no PR.** Report written to
`scratchpad/agents/jelly-rerun/REPORT.md`.

---

# 8. Owner ruling, artifact-loss record, and the new rule (2026-09-22)

The owner accepted the pre-flight outcome and identified the loss as his: the cache cleanup he
authorised on 2026-09-21 deleted `android/app/build` and the APK with it. Evidence gathered by
this cell (full detail in sections 3 and 5): all 50 APKs on the machine sha256'd, no
`fbfe131f…` match; exact-size search (159 255 122 B), 0 hits; `~/.Trash` empty; no Time Machine
local snapshots; no external volumes; no copy on the device; the build log
`kalsa-wt-build-fixes/build-s23-fixes.log` still quoting the hash as of 2026-09-21 15:55.
Conclusion accepted on both sides: **unrecoverable on this machine.**

**DECISION: do NOT rebuild yesterday's APK.** Rationale as given by the owner: a rebuild from
the dirty `kalsa-wt-build-fixes` tree yields a different hash, and its engine (`1068eb03d` base)
is now superseded — the landing chain will build the real artifact from verified engine commit
`d75422944` (release tip `a7d2cec79` line plus the GPU commits) with the app changes. One APK
instead of two, testing the same stall protocol with everything else included. The rerun moves
to that build. I disagree with nothing in this reasoning; the only caveat is recorded in
section 10 item 1 (more variables move at once than in the original A/B, which is the owner's
call and is stated as such).

**NEW RULE, adopted from this incident by the owner:** *an artifact whose hash is cited in a
report must be archived before any cleanup touches build output.* Had it been in force, the
rerun would have had its file. This cell's report and any future report must therefore name an
archived copy (outside any `build/` tree) for every hash it cites. The two APK hashes this cell
cites are both already outside build trees:
`~/kalsa-local-artifacts/s23-repack-timing-app-release.apk` (`d56abe5f…`, still installed on
the phone) and `~/kalsa-local-artifacts/POLICY-OLD-pulled.apk` (`245c514c…`); `fbfe131f…` was
the exception and is the reason the rule exists.

Device state per the owner's instruction: **left stopped and untouched; no command sent to it
since 2026-09-22 13:52 EDT.** Installed build remains `d56abe5f…` (Meter build,
`lastUpdateTime 2026-09-21 12:26:08`); the rerun did not run and section 4 says why.

---

# 9. The rerun as one mechanical step (no design decisions left)

Inputs the owner sends: APK path `NEW_APK`, its sha256 `NEW_SHA256`, engine commit
`NEW_ENGINE_COMMIT`. Serial `S=192.168.1.82:5555`, always with `-s`. Artifact directory for
this cell: `RAW=/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/jelly-rerun/raw/`.
Protocol source, followed as written: meter-close REPORT (real-conversation test) +
jelly-prefill-hung-or-slow section 4(a) for Run B. Any deviation is recorded verbatim in the
report, never silently fixed.

## 9.1 Shared pre-flight (fresh archived reads, before EACH run)

```sh
# 0. verify and ARCHIVE the new artifact first (new rule, section 8)
shasum -a 256 "$NEW_APK"                    # require == NEW_SHA256
cp "$NEW_APK" /Users/marco/kalsa-local-artifacts/   # archived outside any build/ tree

# 1. fresh battery read, archived (never-measure-while-charging rule)
adb -s $S shell dumpsys battery | tee "$RAW/preflight-$(date +%H%M%S)-battery.txt"
#   require: AC/USB/Wireless powered all false, status: 3, level >= 70

# 2. hash BEFORE, installed build must still be the Meter build
adb -s $S shell pm path com.kalsa.app
adb -s $S exec-out cat <that path> | shasum -a 256   # expect d56abe5f... before first install

# 3. install -r ONLY. Never uninstall, never clear data, never touch a setting.
adb -s $S install -r "$NEW_APK"

# 4. re-hash BEFORE touching the store: require installed base.apk == NEW_SHA256
adb -s $S shell pm path com.kalsa.app
adb -s $S exec-out cat <that path> | shasum -a 256
adb -s $S shell dumpsys package com.kalsa.app | grep -E "versionName|versionCode|lastUpdateTime"

# If step 3 returns INSTALL_FAILED_UPDATE_INCOMPATIBLE (signature mismatch with d56abe5f...):
#   STOP, escalate to owner. The fix would be an uninstall, which is forbidden.
```

Provenance recorded at install time, in the report: `NEW_SHA256`, `NEW_ENGINE_COMMIT`,
versionCode/versionName/lastUpdateTime, and the identity string
`unzip -p "$NEW_APK" assets/app.config | grep engineBuildId` (the `kalsa-eng-v2:...` field).

## 9.2 Arm the energy trace (Run A, per jelly-rerun-with-fixes 0.8)

```sh
adb -s $S shell am force-stop com.kalsa.app
# repo helper: /Users/marco/Projects/kalsa/scripts/ci-lib.sh:119 sql_write
sql_write "INSERT OR REPLACE INTO catalystLocalStorage (key,value) VALUES ('kalsa.bench.energy_trace','1');" kalsa.bench.energy_trace 1
# helper read-back + one independent read-back: kalsa.bench.energy_trace|1
adb -s $S shell am start -n com.kalsa.app/.MainActivity    # then open the conversation (9.3)
```

All other bench keys left EXACTLY as found (last known state):
`thinking|default`, `format|none`, `toolgate|1`, `winbudget|6451`, `devmodels|1`,
`engine|{"useMmap":false}`, `kvtranscript|1`. `energy_trace` was ABSENT when found (previous
cell deleted it); it is deleted the same way at cleanup.

## 9.3 Conversation setup and delivery (verbatim from the meter-close real-conversation run)

1. Open `conv-1789854932144-696fm3wu` through the app's own Menu. Verify: store
   `activeId` = that id; home markers `Buon pomeriggio.` / `Cosa vuoi approfondire oggi?`
   ABSENT from the UI dump; composer present; message count **26 before the send** (re-verify
   read-only if a prior run already added notices).
2. Delivery of the prompt `2+2`: the draft must be placed by `am start` (programmatic draft;
   `input text` does not reach React `draft`, documented harness hole). If the IME is open
   (`dumpsys input_method` `mInputShown=true`) the composer sits at the wrong y and taps are
   inert: send `keyevent KEYCODE_BACK` first (`mInputShown=false`). One tap on `Invia` at its
   live bounds; require a `KALSA_SEND` line before waiting on anything.
3. **No `am start` after the send** (it makes RN background `disposeEngine()`). Watcher checks
   the status chip every ~2 min for the dispose signature `Tocca per ricaricare`.

## 9.4 Watchers (two, both to `$RAW` — closes the raw-capture gap the Meter cell recorded)

```sh
adb -s $S logcat -s ReactNativeJS RNLlama   | tee "$RAW/runA-markers.txt"   # filtered markers
adb -s $S logcat -v threadtime              | tee "$RAW/runA-full.logcat"   # FULL capture
```

## 9.5 Run A — expected signatures, quoted from the Meter report for comparability

Marker order as observed in the original run (verbatim, times are 2026-09-21):

```
13:37:50.208 KALSA_SEND {"empty":false,...,"historyLoaded":true,...}
13:37:50.216 KALSA_SEND {"phase":"fit","liveness":"alive","alreadyResident":true,...}
13:37:50.289 KALSA_WINDOW {"kvHeld":false,"nPast":null,...,"textEst":8292}
13:37:50.292 KALSA_THINKING {"turnId":"1","budget":512,"decodeTokPerSec":null,"forceShort":true,"contextMode":"ciswire"}
13:50:09.334 KALSA_STALL {"gapMs":0,"tokens":0,"turnId":"1","reason":"prefill","tokPerSec":null}   <- +739.0 s after KALSA_THINKING
13:51:00.336 I/RNLlama: nextToken:1792 Decoding Interrupted                                       <- +790.0 s after KALSA_THINKING
```

The stall line shape to compare against: `KALSA_STALL {"gapMs":0,"tokens":0,"turnId":"1",
"reason":"prefill","tokPerSec":null}` — **zero tokens, `reason:"prefill"`, `tokPerSec:null`
(branch 1, no EMA), arrival timed from `KALSA_THINKING`, observed at +739.0 s** with the
persisted notice `La risposta non e iniziata entro 739 s.` and the conversation going
26 -> 28 messages. The Step B reference stall (branch 2) is
`tokPerSec:29.332381873019724` at +1355 s. +739 s = `min(900000, max(180000,
ceil(est/10)*1000))` with est 7381-7390.

Comparability rule: the exact seconds are NOT the comparand (section 10 item 1 can move the
estimate); the comparands are (a) the line shape, (b) `tokens:0`, (c) branch binding via
`tokPerSec`, (d) completion-vs-stall. Whatever deadline appears is recorded as measured.

**Outcome COMPLETED (stall fixed) looks like:** first token callback (clears the deadline),
then `KALSA_TELEMETRY {"turnId":"1",...,"promptMs":...,"prompt_n":...,"tokensPredicted":>0,
"interrupted":false,...}`, a real assistant answer persisted, and — if the trace was armed —
`files/energy/<wall_clock_ms>-t1.csv`, pulled with
`adb -s $S shell run-as com.kalsa.app cat files/energy/<name>.csv > "$RAW/<name>.csv"` and
reported in the Meter format: schema line, row count, 1 Hz span, first/last `wall_clock_ms`
bracketing `KALSA_THINKING`...`KALSA_TELEMETRY`, voltage/current ranges, status triplet.

## 9.6 Run B — seed the in-memory EMA, then repeat (jelly-prefill-hung-or-slow 4a, verbatim)

1. Full shared pre-flight again (9.1 battery/charger reads are per-run; force-stop then
   launch is part of this run's preflight — the seed must live in the SAME process as the
   stall send, starting from a known state).
2. Arm `energy_trace` (9.2) if the CSV is wanted for Run B too (recommended: yes, it is
   observational).
3. Open a NEW conversation; send a one-sentence prompt long enough that telemetry records
   **`prompt_n >= 64`** (`MIN_ACCEPTED_PROMPT_TOKENS = 64`; the ladder's rung 1a, 41 chars,
   logged `prompt_n 84`; rung 0's `2+2` logs `prompt_n 34` and does NOT seed). Wait for the
   answer; require `KALSA_TELEMETRY` with `prompt_n >= 64` as the seed receipt.
4. **Do not force-stop, do not reload JS, do not switch model.** Switching conversation is
   fine (EMA is keyed by model id). Note: a completed static-prefix prewarm `op:"done"` also
   seeds; `op:"skip","reason":"already_warm"` does not. Record whichever appears.
5. Switch to `conv-1789854932144-696fm3wu`, send `2+2`, watchers per 9.4 (files `runB-*`).
6. Read the first of: a token callback, `KALSA_TELEMETRY`, or `KALSA_STALL`.

Run B comparability: if it stalls, the line must carry a **non-null `tokPerSec` number**
(branch 2, deadline `max(180000, 5*ceil(est/rate)*1000)`; Step B example: rate
`29.332381873019724`, 1355 s). If it completes, record first-token wall time and
`promptMs`/`prompt_n` from telemetry.

## 9.7 Cleanup (same rules as every cell)

Delete `kalsa.bench.energy_trace` (force-stop first, `sql_write`, helper + independent
read-back). All other bench keys exactly as found. Kill both logcat captures, verify 0
harness procs. `/data/local/tmp`: nothing will have been added; the 114 pre-existing entries
stay (declared in section 6) unless the owner names a purge. App left STOPPED. Report gets
`ls -la` + `wc -l` verification quoted. No commit, no push, no tag.

---

# 10. What is needed besides the APK

1. **Nothing in Run B needs a build knob.** The EMA is pure in-memory process state
   (`prefillSpeed.ts:19-20`, module-level Maps); the only writers are `recordPrefillSample`
   from a completed turn with `prompt_n >= 64` or a completed prewarm `op:"done"`. No
   AsyncStorage key, no bench flag, no settings change touches it. What Run B does need is
   process continuity (9.6 step 4), which is a discipline item, not an artifact.
2. **The sha256 and engine commit** (owner will send), plus I will read the embedded
   `engineBuildId` from `assets/app.config` myself and record all three in the report.
3. **Convergence caveat, stated once and owned by the owner:** the lost APK varied only the
   engine fixes; the new build moves engine (`d75422944`), governor consolidation, and app
   changes together. If Run A's outcome differs from the original stall, the rerun answers
   "does the shipped combination fix the stall" (the owner's framing: strictly more
   informative) but NOT "which change fixed it". Comparability is anchored on the section 9.5
   signatures, not on isolating a variable.
4. **Things the new build may invalidate in the protocol — watch, do not force:**
   * `prefillDeadline.ts` may have changed on the app side; if the formula moved, 739 s will
     not repeat even at the same estimate. I will re-read the file at `NEW_ENGINE_COMMIT`'s
     app pin before the run if the source is on disk, and report the formula in effect.
   * `textEst` (was 8292) may change with windowing/compaction changes; recorded from
     `KALSA_WINDOW`, whatever it is.
   * The GPU fix changes prefill speed (measured -9.9 % on the S23) and the governor
     consolidation changed routing, including a new refuse path (thermal/battery invalid ->
     prefill refused, CPU route). A refusal would produce a DIFFERENT marker set than
     `reason:"prefill"`; it gets recorded as a new outcome, not squeezed into the stall shape.
   * Signature check is in 9.1 step 3; mismatch = escalate, never uninstall.
   * The device's existing bench keys are read by the app as found; whether the new build
     reads any of them differently is unknown and is noted, not changed.
5. **Nothing else.** The conversation fixture (26 messages), the delivery harness, the
   helpers (`ci-lib.sh:119`, `device-share-send.sh`) and the evidence formats are all in
   place and unchanged. Device stays stopped until the APK arrives.

---

# 11. Execution log (2026-09-22 17:18-18:06 EDT)

Chain received from the owner: engine `kalsa-phone-v1-1-1` =
`1577495b92096fca572f57a35b71607bacac85d5`, binding `kalsarn-governor-engine` =
`5b966218eadb85aaacf3eefcefa38651fc8ed1ec`, app `engine-pin-kalsallama` =
`e206a945bf39610681bc50b989f5a4d179a0b889`.

Hash bracket, every step archived in `raw/`:

| step | result |
|---|---|
| APK on disk | size 152760583 = expected; sha256 `d3c66bdb135d394b4bec741c96d89128efc3172cd8ef583e7f2347fdeddf00e3` = expected; `assets/app.config` `extra.engineBuildId` = `kalsa-eng-v2:1725f3a838b0b799f715136a16e6e18ace4f609bd89acb9258ec5c47c819b231` = expected |
| archive first (new rule) | `~/kalsa-local-artifacts/app-release-1577495b9-d3c66bdb.apk`, re-hashed after copy = `d3c66bdb...` |
| battery before install (17:18) | AC/USB/Wireless false, status 3, level **82 %**, 20.0 C (`raw/preflight-battery.txt`) |
| hash BEFORE | `d56abe5f...` = the Meter build (as expected, as declared in section 2) |
| `adb install -r` (17:19:59) | `Success`, `-r` only |
| hash AFTER | `d3c66bdb...` (new install path `~~sIxMm9wa3dt...`), `versionName 0.1.0`, `versionCode 1`, `lastUpdateTime 2026-09-22 17:19:59` |
| hash FINAL (18:05, after both runs) | `d3c66bdb...` - unchanged across the session (`raw/hash-final.txt`) |
| trace flag via `sql_write` | **IMPOSSIBLE - see D1** (never armed; store never written) |
| watchers | both started 17:23: `raw/runA-markers.txt` (filtered `ReactNativeJS RNLlama`) and `raw/runA-full.logcat` (full `threadtime`); one continuous capture covers both runs (D6); both killed at cleanup |

Delivery of both sends: programmatic draft via `kalsa://share?text=` + `Invia` tap at
(426,805) + `KALSA_SEND` proof (D2) - the Meter run's own path.

## Deviations, declared (D1-D8)

* **D1 - no `run-as`: the new APK is not debuggable.** `run-as com.kalsa.app` ->
  `package not debuggable`. Consequences: `kalsa.bench.energy_trace` cannot be armed
  (`sql_write` pulls/pushes the DB through run-as), the energy CSV cannot be pulled, the
  store cannot be read for message counts. The trace flag is observational and the stall
  evidence is logcat-based, so both runs proceeded; **no CSV exists for this cell**. No root
  (`su` absent), no alternative forced.
* **D2 - `device-share-send.sh` unusable on this build.** Its store guard dies without
  run-as (`FATAL: cannot resolve active conversation id...`, 17:25). Delivery fell back to
  the Meter protocol's documented path: share-URI `am start` (draft), IME check, `Invia`
  tap, `KALSA_SEND` as the proof. The harness's own fatal diagnostics
  (`fatal_*` files it wrote at 17:25 into `kalsa/device-share-send-out/`) are copied into
  `raw/`; originals left in place (pre-existing directory).
* **D3 - Run A ran branch 2, not the original's branch 1.** Fresh install -> first launch
  ran `KALSA_PREWARM op:"done" promptMs=67611.198 promptN=2147` (17:24:49) which seeds the
  EMA (2147/67.611 = 31.755094769952162, exactly the `tokPerSec` later seen in the stall
  line). The original Run A had `tokPerSec:null` / 739 s. Pre-agreed comparison rule
  applies: form, `tokens:0`, branch binding - NOT the literal seconds.
* **D4 - operator errors, recovered before any send.** Two stray `KEYCODE_BACK` presses
  backgrounded the app (once to the launcher); recovery via `am start` happened before
  any send (the no-`am start`-after-send rule was never violated). A Google account
  permission dialog appeared over the app mid-session (17:27ish); dismissed with BACK,
  neither option tapped, no permission state changed. Early status checks used a broken
  `grep|head && echo` pattern (always-true); every state claim in this report is taken
  from `uiautomator` dumps parsed in python, not from those checks.
* **D5 - Run B differs from Run A in the KV state too.** The seed turn (same process) left
  the real conversation's KV loadable: Run B sent with `kvHeld:true, nPast:11875`,
  `prompt_n=12636, n_common=11875` -> only **761** new prompt tokens. Run A was
  `kvHeld:false, nPast:null` (full eval). jelly-prefill's "NOT verified" item 5 (warm chat
  KV never tested) is what Run B actually exercised, on top of the seeded EMA.
* **D6 - one continuous logcat capture** covers seed + Run A + Run B (runbook assumed
  per-run files); stronger provenance than restart-per-run, timestamps disambiguate.
* **D7 - the seed turn used a tool.** The seed telemetry has two rounds:
  round 0 (`prompt_n 2172`) and round 1 with `"tool":"web_search"` (`prompt_n 109`). Both
  completed. Whether `recordPrefillSample` saw one or both samples is not observable; the
  post-seed EMA is therefore a reconstruction: **30.07 tok/s** (one sample) or **24.22**
  (both), not a measurement.
* **D8 - thermal state differs from the originals.** See section 16.

---

# 12. RUN A - THE STALL REPRODUCED ON THE FIXED BUILD

Verbatim marker sequence (raw capture, 2026-09-22):

```
17:30:58.413 KALSA_SEND {"empty":false,...,"historyLoaded":true,...,"activeModel":"lfm2.5-2.6b"}
17:30:58.419 KALSA_SEND {"phase":"fit","liveness":"alive","alreadyResident":true,"allow":true,...,"availableMb":3986}
17:30:58.470 KALSA_WINDOW {"kvHeld":false,"nPast":null,...,"hasDigest":true,"legacyWindowStart":6,"textEst":8341,"measuredCharsPerToken":null,"windowTokens":8341}
17:30:58.474 KALSA_THINKING {"turnId":"1","budget":512,"decodeTokPerSec":null,"forceShort":true,"contextMode":"ciswire"}
17:30:58.548 RNLlama loadPrompt:533 KALSA_KVPREFIX embd=2147 text_tokens=12585 n_common=2147 ...
17:50:33.515 KALSA_STALL {"gapMs":0,"tokens":0,"turnId":"1","reason":"prefill","tokPerSec":31.755094769952162}
17:50:34.047 RNLlama nextToken:1792 Decoding Interrupted
```

* **Stall arrival: +1175.041 s after `KALSA_THINKING`** (not from SEND), zero tokens the
  whole turn, no `KALSA_TELEMETRY`, no answer started.
* **Branch binding observed:** `tokPerSec:31.755094769952162` (non-null) = branch 2, the
  EMA seeded by the launch prewarm (D3). Arithmetic check: deadline
  `5*ceil(est/31.755094769952162)*1000 = 1175000` -> `ceil(...)=235` -> est in
  **7431-7622** (reconstruction of the unpreserved estimate input, same caveat as
  meter-close section (d); `textEst` was 8341).
* **Persisted notice: `entro 1175 s`** - seen in the app's own drawer preview after the
  run (`raw/runB-ui-drawer-after.xml` area dump, pre-Run-B): the app's number equals the
  arrival, exactly like the original's 739 s pairing.
* **`Decoding Interrupted` at +0.532 s after the abort** (original Meter run: +51.0 s).
  Recorded as observed; not interpreted.
* **Full raw capture existed this time** (the Meter cell had none): **0 native/RNLlama
  lines** between 17:31:00 and 17:50:33 - the blank prefill window is now proven with an
  unfiltered capture, closing meter-close's "Updated NOT verified" item 8 for this run.
* **No JS exception** anywhere in the session (0 `thinkingText` hits, no `Exception`).
* **Battery:** 82 % pre-run (not charging) -> 79 % at send -> 68 % at stall, battery
  25.0 -> 37.0 C, discharging on every read. No governor/refuse marker fired.
* **No energy CSV** (D1). The Meter-format CSV comparison is not available for this cell.

---

# 13. RUN B - SEEDED EMA, TURN COMPLETED

Sequence exactly per jelly-prefill 4(a): fresh process (force-stop + launch, 17:53),
seed turn in a NEW conversation, telemetry receipt, no restart / no model switch, Menu to
the real conversation, stall send. All in process pid 24734.

Seed turn (receipt = `prompt_n >= 64`):

```
17:55:48.472 KALSA_THINKING {"turnId":"1",...,"forceShort":false,...}   (new conv, textEst 17)
17:58:16.459 KALSA_TELEMETRY {"turnId":"1","round":0,"prompt_n":2172,"promptMs":83148.648,"tokensPredicted":309,"interrupted":false}   -> 26.121 tok/s
17:58:39.797 KALSA_TELEMETRY {"turnId":"1","round":1,"prompt_n":109,"promptMs":10317.773,"tokensPredicted":61,"tool":"web_search","interrupted":false}   -> 10.564 tok/s
```

`prompt_n 2172 >= 64` = seed receipt satisfied; turn completed (D7: second round ran a
`web_search`).

Stall send into `conv-1789854932144-696fm3wu`:

```
17:59:55.411 KALSA_SEND {...}
17:59:55.465 KALSA_WINDOW {"kvHeld":true,"nPast":11875,...,"textEst":8391,"measuredCharsPerToken":2.5871710526315788,"windowTokens":9730}
17:59:55.468 KALSA_THINKING {"turnId":"2","budget":512,"decodeTokPerSec":null,"forceShort":true,"contextMode":"ciswire"}
17:59:55.540 RNLlama loadPrompt:500 prompt_n=12636 n_ctx=16384 embd=11875
17:59:55.540 RNLlama loadPrompt:533 KALSA_KVPREFIX embd=11875 text_tokens=12636 n_common=11875 ...
18:03:28.765 KALSA_TELEMETRY {"turnId":"2","round":0,"tokensCached":12712,"tokensEvaluated":12636,"tokensPredicted":75,"promptMs":176123.701,"predictedMs":36575.359,"predictedPerSecond":2.0505608707764154,"interrupted":false,"truncated":false,"prompt_n":761,...}
```

**Outcome: COMPLETED. No `KALSA_STALL` line for turn 2.**

* First token and full answer at **+213.300 s after `KALSA_THINKING`**, 75 tokens
  predicted, `interrupted:false` - far inside the seeded-EMA deadline (reconstruction:
  ~1240-1270 s at EMA 24.2-30.07, est 7431-7622).
* Answer persisted: the drawer preview of the real conversation reads **`4`**
  (`raw/runB-ui-drawer-after.xml`), and the in-chat dump shows the message `4`.
* `promptMs 176123.701` against `prompt_n 761` -> **4.32 new-tok/s**; against
  `tokensEvaluated 12636` -> **71.75 evaluated-tok/s**. Both readings kept, as in
  meter-close section (d); the accounting semantics were not re-derived here.
* Battery during Run B: preflight 67 % (17:53, not charging, 36.0 C) -> 63 % at telemetry,
  final 62 % (18:05), discharging on every read.
* **Honest scope:** Run B changed TWO things relative to Run A (seeded EMA AND warm KV,
  D5). It completes the protocol as written and is a result, but "EMA seeding fixed it"
  is NOT supported: the warm-KV state alone cuts new prompt work to 761 tokens, and the
  warm-KV state was exactly jelly-prefill's never-tested variable. The protocol's own
  sequence produced the second variable; recorded, not silently attributed.

---

# 14. Comparison with the Meter originals

| | Meter realconv stall (2026-09-21) | Step B (old pin) | **Run A (fixed build, today)** | **Run B (fixed build, today)** |
|---|---|---|---|---|
| build | `d56abe5f` Meter | `245c514c` old pin | `d3c66bdb` fixed chain | same, same process as A |
| outcome | stall | stall | **stall** | **COMPLETED** |
| `KALSA_STALL` form | `gapMs:0,tokens:0,turnId:1,reason:prefill` | same | **same, verbatim form** | none (telemetry instead) |
| `tokens` | 0 | 0 | **0** | 75 predicted |
| branch binding | `tokPerSec:null` (branch 1) | `29.332...` (branch 2) | **`31.755094769952162` (branch 2)** | EMA present (value reconstructed, D7) |
| arrival from THINKING | +739.0 s | +1355 s | **+1175.041 s** | no stall; completed +213.300 s |
| `Decoding Interrupted` after abort | +51.0 s | (same class) | **+0.532 s** | n/a |
| persisted notice | `entro 739 s` | `entro 1355 s` | **`entro 1175 s`** | answer `4` |
| KV state | `kvHeld:false` | `kvHeld:false` | **`kvHeld:false, nPast:null`** | **`kvHeld:true, nPast:11875`** (D5) |
| native lines during stall | none proven (no raw capture) | n/a | **0, proven by full capture** | n/a |
| thermal | NONE throughout | n/a | **SKIN SEVERE episodes, 47 C (D8)** | SEVERE during turn (D8) |
| energy CSV | 779 rows | none | **none (D1)** | none (D1) |

Headline, stated directly: **the prefill stall reproduces on the shipped fixed build in the
same form with zero tokens** (Run A), and **the protocol's EMA-seeded repeat completed**
(Run B) while simultaneously exercising the warm-KV state that was never tested before.

---

# 15. Left behind (final, 2026-09-22 18:06 EDT)

**Device (Jelly `192.168.1.82:5555`):**

* ONE install this cell: APK `d3c66bdb...` via `adb install -r` only; never uninstalled,
  never cleared, hash-final identical to hash-after. Previous build `d56abe5f...` is
  superseded on-device (its file survives at `~/kalsa-local-artifacts/s23-repack-timing-app-release.apk`).
* No settings written; `screen_off_timeout` read only = `7200000` before and after.
* Store: **never written by me** - no `sql_write` executed (D1); `kalsa.bench.energy_trace`
  was absent when found and is still absent (unreachable); bench keys unreadable and
  untouched.
* App state: **STOPPED** (as found), screen off (as found), unplugged throughout.
* `/data/local/tmp`: **114 entries, exactly as found** (verified count before/after);
  nothing added, nothing deleted.
* App's own new artefacts, left in place and named: one new conversation
  `Spiega la fotosintesi clorofilliana in una frase` (the seed chat), and 4 new messages in
  `conv-1789854932144-696fm3wu` (Run A: user `2+2` + notice `entro 1175 s`; Run B: user
  `2+2` + answer `4`), i.e. expected 30 messages - count NOT verified (store unreadable),
  drawer preview `4` is the UI-side evidence.
* Thermal aftermath: battery 36.0 C, skin had reached 47 C SEVERE during both runs; screen
  slept at the end to let it cool as found.

**Mac:**

* Archived artifact (new rule honored): `~/kalsa-local-artifacts/app-release-1577495b9-d3c66bdb.apk`.
* Evidence: `scratchpad/agents/jelly-rerun/raw/` - **25 files**: 4 battery archives, 3 hash
  reads, install/pmpath logs, `runA-markers.txt` (461 KB, continuous, covers seed + A + B),
  `runA-full.logcat` (8.0 MB full raw), 7 UI dumps, 6 copied harness `fatal_*` files
  (originals also left in `kalsa/device-share-send-out/`, pre-existing dir).
* Watchers: both killed; `0` logcat captures remaining. No other process started.
* **Not committed, not pushed, no tag, no PR.** Same report file as before.

---

# 16. Thermal, recorded as a confound (D8)

The full capture contains the thermal HAL's own notifications: `ThrottlingStatus: NONE`
1348 times, **`ThrottlingStatus: SEVERE` 69 times**, `Type: SKIN Name: SKIN
CurrentValue 47.0-47.133`, first SEVERE at **17:36:48** (inside Run A's stall window,
+5 min 50 s after THINKING) and a later episode at **18:00:48-18:00:52** (inside Run B's
turn). Battery temperature rose 20.0 -> 37.0 C across the session; level 82 -> 62 %.
The Meter originals ran at thermal NONE throughout (battery 30-33 C).

Consequence, stated plainly: today's runs were thermally hotter than the originals, and
SEVERE skin throttling can slow prefill. Run A's stall cannot be attributed to the build
alone without a cool-state repeat; Run B's completion happened DESPITE a SEVERE episode.
A cooldown repeat of Run A (battery < 30 C, `ThrottlingStatus: NONE` at send time) is the
one measurement this cell does not have and the cheapest next step if the owner wants the
thermal limb separated.
