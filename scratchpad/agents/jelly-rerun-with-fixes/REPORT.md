# Jelly Star re-run on the build that contains our fixes — cell report (2026-09-21)

Goal: repeat the real-conversation test on the APK that carries the fixes, and answer whether
the prefill stall still happens and whether the prefill is slow or hung.

**STATUS OF THIS CELL: PRE-FLIGHT ABORTED — NO RUN. The battery gate failed (21 %, discharging,
below the 30 % floor). Nothing was installed, nothing was written to the device store, no send was
made. State below is as of 2026-09-21 15:55–16:00 local.**

---

## 0. Pre-flight — every item, and where it stopped

### 0.1 The build on the Mac — verified (matches the coordinator's handover)

```
/Users/marco/Projects/kalsa-wt-build-fixes/android/app/build/outputs/apk/release/app-release.apk
sha256  fbfe131f7150daa8e4a79c9c459673f30e272340578c455479b06abaac2d7b12   (computed here, matches)
size    159 255 122 B
mtime   2026-09-21 15:55
```

Identity read out of the APK itself (`unzip -p … assets/app.config`, read-only):

```
"extra":{"engineBuildId":"kalsa-eng-v2:ea29410fe22ba889113df5344305190b1b631c0f31a54063149210730c618853"}
```

i.e. the `kalsa-eng-v2:ea29410f…` identity the coordinator asked for is inside the file on disk.

Secondary, local (not device) confirmation of the engine pin in the build worktree
`/Users/marco/Projects/kalsa-wt-build-fixes`, HEAD `e5788cf`:

* `package.json:49` → `"llama.rn": "github:Aspis0/kalsa.rn#0288dc2786911d9b7dda6b2961cb3f0afa1e0ee2"`
  (the fork pin; unchanged from the Meter build — the engine change rides in the vendored tree).
* `node_modules/llama.rn/vendor/VERSIONS` carries the local override: the tree under
  `vendor/llama.cpp` is `git -C /Users/marco/Projects/kalsallama archive 1068eb03d`
  (branch `kalsa-gpu-opencl-v73`), i.e. the engine commit the coordinator named.

These are LOCAL file facts. They say the APK on the Mac is ours; they say nothing yet about
what the phone runs — that check is item 0.2 and was done.

### 0.2 The build on the phone — read BEFORE touching anything

```
installed path  /data/app/~~DeXzzJqpOSg2v2XKyM9rZg==/com.kalsa.app-UxC0xITqI0kpPL-dayUwRA==/base.apk
sha256          d56abe5f87cd352ad2e4f826203d1060be3fa8aa93e07c6a950606f51f3f1342          (streamed twice, identical)
```

**This is the previous cell's Meter build, exactly as the coordinator predicted. The new build is
NOT on the phone.** `dumpsys package` gives `versionCode=1`, `versionName=0.1.0`,
`lastUpdateTime=2026-09-21 12:26:08`, `firstInstallTime=2026-08-12 01:58:33` — consistent with the
Meter build being installed at 12:26 and used for the ladder and the real-conversation test.

`adb install -r` of `fbfe131f…` had **not** been performed when the gate below stopped the cell.

### 0.3 Battery — **THE GATE THAT FAILED**

`dumpsys battery`, three reads ~4 s apart, identical each time:

| field | value |
|---|---|
| AC powered / USB powered / Wireless powered | **false / false / false** |
| status | **3 (discharging)** |
| level | **21 %** |
| charge counter | 618 660 µAh |
| voltage | 3 760 mV |
| temperature | 25.0 °C |
| current_now (sysfs, independent read) | **-13 000 µA** |
| `/sys/class/power_supply/battery/status` (independent read) | **Discharging** |
| `/sys/class/power_supply/battery/capacity` (independent read) | **21** |

The task's gate is *not charging* AND *level ≥ 30 %*. Not charging holds; **21 % does not**. Per the
instruction ("if not, STOP and report instead of running") the cell stopped here. Charging the
phone is also forbidden by the project rule that forbids benchmarking while charging, so this could
not be worked around inside this cell.

Nothing was benchmarked. No energy CSV was produced.

### 0.4 The conversation — read-only, from the store (item satisfied without a write)

The store was pulled read-only with the app **STOPPED** (`pidof com.kalsa.app` → STOPPED; only
`databases/RKStorage` exists, no `-wal`/`-shm`). `PRAGMA integrity_check` → `ok`. No `sql_write`,
no force-stop, no key armed.

* `kalsa.conversations.v1` → `activeId = conv-1789854932144-696fm3wu`, single item, `hasMessages:true`.
* `kalsa.messages.conv-1789854932144-696fm3wu` exists (44 334 B) →
  **message count before the run: 26 (16 user / 10 assistant)**, exactly the count the meter-close
  cell left behind. Last two turns are the user `2+2` + the assistant notice
  `entro 739 s` (`createdAt 1790012270217`).
* The conversation is the same real ~8k one: `textEst 8292` in the last run, `8242` in Step B.
* Its title/preview carries the accumulated bench fixtures (`n20260919-*`) plus the three stall
  notices (see 0.6).

Evidence kept out of `/tmp`, in this agent directory:
`preflight-readonly-RKStorage.db`, `preflight-realconv-messages.json`.

**`kalsa.bench.energy_trace` is ABSENT** from the store at the time of this report — correct
pre-arm state (the previous cell deleted it). It was **not** armed, because arming is a write and
the run it would document was cancelled.

Other bench keys present, unchanged and untouched:
`devmodels=1`, `engine`, `format`, `kvtranscript=1` (predates both cells), `thinking`, `toolgate`,
`winbudget`. No key was modified or deleted.

### 0.5 UI state — NOT VERIFIED

Not checked: no `am start`, no UI dump, no screenshot. Launching the app would have changed device
state for a run that the battery gate had already cancelled. Whether the app opens inside
`conv-1789854932144-696fm3wu` (drawer row, composer present, home-page markers
`Buon pomeriggio.` / `Cosa vuoi approfondire oggi?` absent) is therefore **NOT VERIFIED** for this
cell. The store-level equivalent of the check (activeId + hasMessages) is verified in 0.4.

### 0.6 Read-only observation, recorded not diagnosed

The persisted `kalsa.conversations.v1` preview contains the assistant notice text
`entro 1520 s …` alongside `entro 1355 s` and `entro 739 s`. The meter-close report labelled the
`1520 s` / `tokPerSec 26.95` pair **UNSOURCED** in its own artefacts; this read shows the **notice
text** `entro 1520 s` does exist on the device in the persisted conversation. That does not source
the `tokPerSec:26.95` figure, and it is a store-side string, not a `KALSA_STALL` log line. Recorded
because it is device evidence the earlier cell did not have. Not investigated further — no new front.

## 0.7 Device and hygiene

* Jelly Star `192.168.1.82:5555` used for **read-only** commands only. Every command was addressed
  with `-s 192.168.1.82:5555`.
* **S23 (`adb-R3CW406P8CV-…`) was never touched.** It appeared in `adb devices -l` output and
  received no command.
* App left **STOPPED** (as found); no install, no uninstall, no data clear, no force-stop, no SQL
  write.
* `files/energy/` on the device: **8 CSVs, unchanged** — the 7 from earlier plus
  `1790012270294-t1.csv` (789.7 s, the failing turn). All left in place as evidence.
* No logcat, no harness, no background process was started, so nothing needed killing.
* `screen_off_timeout` read only: 7 200 000 ms.

## 0.8 What is needed to run the cell

1. Charge the Jelly Star to **≥ 30 %**, then let it sit **unplugged** again (benchmarking while
   charging is forbidden; the trace itself must be taken on battery). At ~13 mA idle drain and
   618 mAh in the counter, 21 % → 30 % is roughly 55–60 mAh of charge.
2. Then this cell resumes exactly at pre-flight 0.2 (hash BEFORE), install `fbfe131f…` with
   `adb install -r`, re-hash the installed `base.apk` and require `fbfe131f…` BEFORE touching the
   store, and only then arm `kalsa.bench.energy_trace=1` with the repo helper.

Nothing in RUN A or RUN B has been attempted, so the central question of the cell — does the
stall still happen on the fixed build, and is the prefill slow or hung — is **OPEN, NOT VERIFIED**.

## 0.9 NOT VERIFIED (this cell)

1. Anything about the fixed build's behaviour on the device — it is not installed.
2. Whether installing it with `-r` preserves the 26-message conversation (expected, but untested).
3. Whether the app runs our engine on the phone: the identity string was read from the **file**, and
   the coordinator's logcat read at model load has not been done.
4. The UI in-conversation check.
5. Anything about RUN A and RUN B.
