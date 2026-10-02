# S23 functional check — fresh-RAM governor fit, app main `2e7b4dfd`

Date: 2026-10-02, 15:10–16:45 EDT (Mac clock). Device: Galaxy S23 (SM-S911U, SM8550 /
Hexagon v73), serial `R3CW406P8CV`, wireless adb `192.168.1.152:35017`. ON CHARGER the
whole session (owner-allowed for functional checks today); FUNCTIONAL check, no benchmark.
This re-creates the expo57-smoke incident (smoke item 3, first attempt): after several
model switches in one process the governor priced the NPU lane against a MemAvailable
value cached at app start (it kept saying `available_mib:3458.93` while the phone had
123 MB free) and a 3k-token prompt then thrashed for >9 minutes. The fix under test:
`initEngine` re-reads `/proc/meminfo` after releasing the previous model and
`KALSA_GOVERNOR_PLAN` logs `available_mib`, `available_src` (fresh|cached|none),
`npu_fit`, `gpu_fit`.

**APK:** CI run `37052344359` (Aspis0/kalsa "APK (device build)", success, headSha
`2e7b4dfd9b…`), artifact `kalsa-apk-arm64-v8a-debuggable-2e7b4dfd…/app-release.apk`,
190,543,062 B, sha256 `cc6302a9691a20df5ea5e5c843906dbc2bfd635e511df50462d16aeba813e951`
(`raw/apk.sha256`); four HTP skels (v73/v75/v79/v81) + `hexagon_opencl.so` in `unzip -l`.
`adb install -r` **Success** 16:09:23 (`raw/install.log`); no uninstall, no data clear.
Build `DEBUGGABLE`, so bench keys were read/written via `run-as` (the /tmp/s23-func
sqlq/sqlw harness, reused unchanged).

**Preflight:** `persist.traced.enable=0` at start and end; battery 100 % / 29.2 °C at
start, 34.5 °C at end (limit 44.0 °C never approached); Thermal Status 0 throughout;
screen Awake + Kalsa `MainActivity` topResumed at every send; tombstones unchanged
(`tombstone_31.pb` newest before and after). A `KALSA_GOVERNOR_PLAN`+meminfo watcher
streamed logcat all session and read meminfo on the device within 0–1 s of every plan
line (`raw/plan-watch.txt`); per-phase `logcat -d --pid` windows were filtered to
KALSA_*/RNLlama lines only.

## Step 0 — bench keys

Found before any write (`raw/keys-before.txt`): `route=gpu, npu_lane=off, nativelog=off,
energy_trace=1, kvtranscript=1, devmodels=<absent, count 0>` — exactly the values the
previous session restored. Armed: `npu_lane=on`, `route=auto` (both verified by write+
read-back); `devmodels` never needed (Qwen 3.5 4B · Q4_K_M and LFM2.5 2.6B · QAD-Q4_0
are regular catalog rows; the selected model was already `kalsa.model.id=lfm2.5-2.6b`).
`nativelog` left off — `KALSA_GOVERNOR_PLAN` is a JS-layer line (tag ReactNativeJS) and
does not depend on the native-log mirror.

## Load table — every engine load, plan line vs meminfo read

| # | time  | event | `available_mib` | MemAvailable read | Δ MiB | `available_src` | `gpu_fit` | `npu_fit` | `npu_device` |
|---|-------|-------|----------------|-------------------|-------|-----------------|-----------|-----------|--------------|
| 1 | 16:09:54 | boot #1 (pid 20881) | 3572.20 | 3,648,048 kB = 3562.5 | ~10 | **fresh** | Fit | Fit | HTP0 |
| 2 | 16:21:39 | boot #2 (pid 24025) | 4055.05 | 4,148,716 = 4051.5 | ~4 | **fresh** | Fit | Fit | HTP0 |
| 3 | 16:27:42 | switch → Qwen 3.5 4B | 3760.85 | 3,833,636 = 3743.8 | ~17 | **fresh** | NoFit | NoFit | null |
| 4 | 16:31:08 | switch → LFM2.5 2.6B | 3921.74 | 4,001,680 = 3907.9 | ~14 | **fresh** | Fit | Fit | HTP0 |
| 5 | 16:32:26 | switch → Qwen (2nd) | 4017.32 | 4,118,080 = 4021.6 | ~4 | **fresh** | NoFit | NoFit | null |
| 6 | 16:37:01 | swq2 turn re-init | 3801.70 | 3,871,356 = 3780.6 | ~21 | **fresh** | NoFit | NoFit | null |
| 7 | 16:38:17 | switch → LFM (2nd) | 3253.19 | 3,322,360 = 3244.5 | ~9 | **fresh** | Fit | Fit | HTP0 |
| 8 | 16:42:06 | final boot, keys restored | 4376.54 | 4,476,100 = 4371.2 | ~5 | **fresh** | Fit | Fit | null (`npu_lane:"off"`) |

Every one of the 8 loads: `available_src:"fresh"`, `available_mib` within 4–21 MiB of the
meminfo read (different instants; tolerance was a few hundred), meminfo read DELTA 0–1 s.
The stale-cache failure mode (`available_src:"cached"`, one value repeated across loads)
never appeared. Qwen prices NoFit (required_with_repack 7331.47 / without 4627.83) and
runs CPU; LFM prices Fit against the fresh sample (required_without 3249.06).

## Verdicts

| step | check | verdict | key evidence (quoted) |
|---|---|---|---|
| 0 | keys recorded, armed, relaunch | **PASS** | `raw/keys-before.txt`, `raw/keys-restored.txt`; boot plan `{"npu_device":"HTP0",…,"npu_lane":"on","npu_fit":"Fit","available_src":"fresh"}` |
| 1 | every load: fresh source, available ≈ meminfo | **PASS** | 8/8 rows in the table: `available_src:"fresh"`, Δ 4–21 MiB, `DELTA_FROM_LINE=0s` (one `-1s`) |
| 2 | same-model idempotence on LFM (KV survives) | **PASS** | two turns "Quanto fa 17 per 23? Solo il numero." → UI `391`, "E 18 per 23?" → UI `414`; ZERO `KALSA_GOVERNOR_PLAN` between them (turn windows `raw/s2t1r-kalsa.txt`, `raw/s2t2-kalsa.txt` contain only boot's plan); turn 2 first load `KALSA_WINDOW {"turnId":"2","kvHeld":true,"nPast":1801,…}` + `KALSA_KVPREFIX embd=1801 text_tokens=1819 n_common=1801` (n_common > 0) — see Disclosure 2 for the mid-turn retry |
| 3 | pressure Qwen→LFM→Qwen→LFM + 3k prompt | **PASS** | 4 switches, all settled, one process (pid 24025); the incident moment (4th switch, on LFM) priced `available_mib:3253.19 … "npu_fit":"Fit","available_src":"fresh"`; long prompt (4,546 chars ≈ 3.4k tokens, needle mid-text, `raw/swlong-kalsa.txt`): `KALSA_KVPREFIX embd=1660 text_tokens=3434 n_common=1660`, `KALSA_GOVERNOR {…"engine_prefill":"NPU",…,"npu_device":"HTP0","prefill_chunks":"512+512+512+128+110",…,"fit":"Fit",…,"attempt":1}`, all 14 `layers_device` reads `"HTP0"`, `promptMs:2678.96`, turn done in 23 s wall including harness overhead — vs >9 min thrash in the incident; UI `text="ZAFFIRO-42"` (`raw/answers-step3.txt`). 300 s guard never tripped, no top/meminfo capture needed |
| 4 | keys restored + read back, end state | **PASS** | `raw/keys-restored.txt`: `route=gpu, npu_lane=off, nativelog=off, energy_trace=1, kvtranscript=1, devmodels count 0`; final boot plan shows `"npu_device":null,…,"npu_lane":"off","available_src":"fresh"` |

**4 of 4 PASS.** The headline claim of the fix is proven on-device: across two boots,
four model switches and a turn-level re-init in one process, the plan never reused the
app-start memory value — 8/8 `available_src:"fresh"`, each within ~20 MiB of the real
MemAvailable — and the 3k-token turn that used to thrash for >9 minutes under a stale
"Fit" completed attempt-1 on the HTP0 lane in well under 2 minutes.

## Disclosures

1. **Harness: first tap after deep-link staging never registered (6×), re-tap always
   did.** Every warm turn logged "send tap did not register - re-tap" and then ran
   normally ~5 s later; the first (s2t1) attempt predated that guard, sat 300 s with the
   staged text unsent (app idle 10 % CPU, MemAvailable 3.7 GB —
   `raw/s2t1-notap-top.txt`, `raw/s2t1-notap-meminfo.txt`), was force-stopped and the
   boot re-run. One extra engine load (table row 2) comes from that recovery. App-side
   staging/send/telemetry were never implicated (the re-tap used the same button).
2. **Step-2 turn 2 needed its designed admission-gate retry.** Attempt 1 loaded the
   held KV (`n_common=1801`) but aborted: `KALSA_GOVERNOR_THERMO {"valid":false,…}` →
   `set_thermo_profile: invalid thermal profile; accelerator admission is closed` →
   `KALSA_GOVERNOR_FALLBACK {stage:"decode",…,reason:"prefill admission aborted"…}` →
   `KALSA_GOVERNOR_RUNTIME_FALLBACK {…,"attempt":2}` → full CPU re-prefill
   (`n_common=0`, promptMs 25 s) → completed. Same designed abort-and-retry the 0b7c5e71
   session saw on the lane-OFF turn, here on a lane-ON same-model turn; battery was
   30 °C, Thermal 0. No GOVERNOR_PLAN line fired for either attempt (the "no reload"
   criterion is evaluated on the plan line, as specified). Worth an owner look: the
   invalid thermo profile costs the KV handoff whenever it fires.
3. **The 2nd Qwen switch "hangs" only if you count `done` lines.** Its prewarm took the
   KV-restore path (`'op":"restore","ok":true,"tokens":1692'`) which by design
   early-returns WITHOUT a `done` line (documented by the expo57-smoke session); the
   switch had in fact settled (Qwen resident, RES 806 MB). My swmodel script now accepts
   restore-ok as success. No app defect.
4. **`required_mib` is +251 MiB over the 0b7c5e71 build with the lane on** (LFM
   4769.12/3249.06 vs 4518.12/2998.06). The final lane-OFF boot prices 4518.12/2998.06 —
   consistent with the engine change "lane fit prices the effective KV types" (q8_0/q8_0
   on the lane, requested q8_0/q4_0 off it). Observation, not a regression.
5. **Carried-over observation:** every boot still logs `KALSA_PREWARM
   {"op":"snapshot_save","ok":false,"reason":"save_error",…}` (already reported by the
   0b7c5e71 session); the KV-restore path (Disclosure 3) works from the kvtranscript
   file instead.

## End state (16:45 EDT)

Kalsa FOREGROUND (`com.kalsa.app/.MainActivity` topResumed), screen Awake (keyevent 224
only), ON CHARGER, battery 100 % / 34.5 °C, Thermal Status 0, `persist.traced.enable=0`.
Debuggable `2e7b4dfd` installed (lastUpdateTime 2026-10-02 16:09:23). Bench keys
restored to the step-0 values and read back (`raw/keys-restored.txt`); `devmodels`
still absent. Tombstones unchanged from baseline. No `/data/local/tmp` files of mine
left behind (the sqlw helper self-cleans; all pre-existing files untouched). My turns
appended to an existing conversation (no new conversation rows created).

## Evidence

`raw/` holds ONLY filtered lines / small state files — no full logcat:
`apk.sha256`, `install.log`, `keys-before.txt`, `keys-restored.txt`,
`tombstones-before.txt`, `plan-watch.txt` (the watcher log: every plan line + the
meminfo read taken within 0–1 s), `boot1-kalsa.txt`, `s2t1r-kalsa.txt`, `s2t2-kalsa.txt`,
`swqwen-kalsa.txt`, `swq1-kalsa.txt`, `swlfm-kalsa.txt`, `swl1-kalsa.txt`,
`swqwen2-kalsa.txt`, `swq2-kalsa.txt`, `swlfm2-kalsa.txt`, `swlong-kalsa.txt`
(KALSA_*/RNLlama lines per phase), `answers-step2.txt`, `answers-step3.txt`,
`s2t1-notap-top.txt`, `s2t1-notap-meminfo.txt`, `state-boot1.txt`, `final-state.txt`.
