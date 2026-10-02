# S23 functional check — plugged idle-baseline latch, app main `7ec12eb0`

Date: 2026-10-02, 18:10–19:12 EDT (Mac clock). Device: Galaxy S23 (SM-S911U, SM8550 /
Hexagon v73), serial `R3CW406P8CV`, wireless adb `192.168.1.152:35017`. ON CHARGER by
design (owner-allowed for functional checks) — **the charger physically dropped out of
the phone mid-step-2 at 19:00:33 EDT** (see Disclosure 2); from that moment the plugged
protocol was no longer runnable and the run was stopped. FUNCTIONAL check, no benchmark.

What is under test: app main `7ec12eb0` restores a plugged idle-baseline latch in the
Android battery module — the first thermal read that sees the phone plugged latches the
battery temperature, every later plugged read reports that SAME latched value as t_idle,
cleared by any unplugged read. On `2e7b4dfd` (this afternoon, same phone, same chat,
same prompts: `s23-fresh-ram-fit-2e7b4dfd/REPORT.md`) the live temperature was sent; the
battery warmed 1.7 °C in turn 1 and turn 2 logged `set_thermo_profile: invalid thermal
profile; accelerator admission is closed` → `KALSA_GOVERNOR_FALLBACK
reason:"prefill admission aborted"` → CPU retry.

**APK:** CI run `37066820198` (Aspis0/kalsa "APK (device build)", artifact
`kalsa-apk-arm64-v8a-debuggable-7ec12eb0a2e8fbbe039c4b745da67b0b6de63c83/app-release.apk`),
190,603,926 B, sha256 `f9d065324d8b999a520ff5d9e1fa458a1f51938ffec9ee0ff086fdf2e1a5952e`
(`raw/apk.sha256`); binary manifest attribute record `debuggable` type 0x12 data
0xffffffff = TRUE (`raw/manifest-debuggable.txt`); four HTP skels (v73/v75/v79/v81) +
`hexagon_opencl` libs in `unzip -l`. `adb install -r` **Success** 18:13:29
(`raw/install.log`); post-install `run-as com.kalsa.app id` works (debuggable, uid
u0_a347). No uninstall, no data clear.

**Preflight:** `persist.traced.enable=0` at start and end; battery 100 % / 29.5 °C /
`AC powered: true` at start; Thermal Status 0; screen Awake, keyguard `showing=false`,
Kalsa `MainActivity` topResumed at every send. Tombstones unchanged from baseline
(`tombstone_05.pb` newest before and after — different file than the previous session's
`tombstone_31.pb` baseline; tombstones rotated between sessions, set unchanged within
this one). A continuous `adb logcat` stream ran in /tmp all session (never committed);
per-phase evidence files hold ONLY the grep-filtered lines described in Evidence.

## Step 0 — bench keys

Found before any write (`raw/keys-before.txt`): `route=gpu, npu_lane=off, nativelog=off,
energy_trace=1, kvtranscript=1, devmodels=<absent, count 0>`, `kalsa.model.id=lfm2.5-2.6b`
— identical to the values the previous session restored. Armed `npu_lane=on`,
`route=auto` via the run-as sqlw harness (write + read-back verified). Relaunch 18:16:10;
boot plan 18:16:12 pid 7866: `{"npu_device":"HTP0",…,"npu_lane":"on","npu_fit":"Fit",
"available_src":"fresh"}` (`raw/boot1-kalsa.txt`, `raw/state-boot1.txt`).

## Per-turn table (step 1 + step 2)

Battery temp = `dumpsys battery` `temperature` taken immediately BEFORE the send
(plugged, `AC powered: true`, in every case marked "plugged"). "THERMO" column:
`KALSA_GOVERNOR_THERMO` does not exist as a valid:true line on this build — see
Disclosure 3; admission validity per turn is attested by `attempt:1` + zero
"invalid thermal profile" + the prefill completing on the lane. All turns in ONE chat,
one process (pid 7866), model LFM2.5 2.6B unless stated.

| turn | model | temp before | THERMO valid | prefill device | fallback lines |
|---|---|---|---|---|---|
| 1 long needle (4.5k chars, "ZAFFIRO-42") | LFM | 29.5 °C | no line; attempt 1, 0 invalid | **NPU HTP0**, 9 chunks, promptMs 4675 ms | none |
| 2 "17 per 23?" | LFM | 30.7 °C | no line; attempt 1, 0 invalid | **NPU HTP0**, 24 tok, `kvHeld:true nPast:4695`, n_common=4695 | none |
| 3 "18 per 23?" | LFM | 31.5 °C | no line; attempt 1, 0 invalid | **NPU HTP0** (kvHeld, n_common=4782) | none |
| 4 "17 per 23?" | LFM | 32.2 °C | no line; attempt 1, 0 invalid | **NPU HTP0** (kvHeld) | none |
| 5 "18 per 23?" | LFM | 32.9 °C | no line; attempt 1, 0 invalid | **NPU HTP0** (kvHeld) | none |
| 6 "17 per 23?" | LFM | 33.0 °C | no line; attempt 1, 0 invalid | **NPU HTP0** (kvHeld) | none |
| 7 (sw1) "capitale d'Italia?" | Qwen 3.5 4B | 37.0 °C (plugged) | no line | CPU (reload priced `NoFit`, by design) | none — **aborted by harness re-tap**, Disclosure 1 |
| 8 (sw1b) same question re-sent | Qwen 3.5 4B | 31.5 °C (plugged at send; **unplugged 10 s in**) | no line | CPU (NoFit) | none |

Answers on screen: turns 1–6 → `ZAFFIRO-42`, `391`, `414`, `391`, `414`, `391`
(all correct); turn 8 → `Roma` (`raw/answers.txt`). Turn 7 produced no answer (aborted).

Turn 1 alone put the battery +2.2 °C over the pre-turn-1 reference (≥ 2.0 °C target
already met); turns 2–6 were sent anyway ON PURPOSE — short KV-held turns are the exact
turn type that aborted on `2e7b4dfd`, and they add the most failure surface for the
latch at minimal heat. Pre-turn temps never approached the 44.0 °C stop (max 37.0 °C).

## Engine loads (all `available_src:"fresh"`)

| # | time | event | npu_device | npu_lane | gpu/npu fit | available_mib |
|---|---|---|---|---|---|---|
| 1 | 18:16:12 | boot pid 7866 (LFM, armed keys) | HTP0 | on | Fit / Fit | 3563.80 |
| 2 | 18:26:56 | switch → Qwen (`raw/swqwen-kalsa.txt`) | null | on | NoFit / NoFit | 3860.44 |
| 3 | 18:40:34 | turn-7 Qwen re-init, `KVRESUME n_tokens=1692`, restore ok | (CPU turn) | on | — | — |
| 4 | 19:07:55 | boot pid 31230 (keys restored; Qwen still selected) | null | off | NoFit / NoFit | 4312.77 |
| 5 | 19:09:35 | switch → LFM (device-state restore, unplugged) | null | off | Fit / NoFit | 3005.06 |

The Qwen switch's first prewarm rejected the previous build's KV transcript
(`meta_mismatch:engineBuild","deleted":true`) and re-prefilled (102.8 s for 1692 tokens
on CPU) — by-design cross-build KV invalidation, matches the `2e7b4dfd` → `7ec12eb0`
engine change. The latch did its job across loads 1–3: every LFM turn stayed attempt-1
HTP0 while the real battery climbed from 29.5 to 37.0 °C.

## Verdicts

| step | check | verdict | key evidence |
|---|---|---|---|
| 0 | keys recorded, armed, relaunch, plugged | **PASS** | `raw/keys-before.txt`, boot plan HTP0/lane on, `AC powered: true` |
| 1 | 6 warm plugged turns: zero invalid profile, zero aborted admission, HTP0 every turn, rise ≥ 1.5 °C | **PASS** | session-wide greps (below) all 0; 6/6 turns `engine_prefill:"NPU"` + all `layers_device:"HTP0"` + `attempt:1`; plugged rise 29.5 → 37.0 °C = **+7.5 °C** |
| 2 | switch LFM→Qwen→LFM plugged+warm, latch survives policy recreation | **PARTIAL — not completable** | Qwen leg clean (reload priced NoFit, turn 7+8 zero invalid/zero fallback). **LFM leg NOT RUN: charger dropped at 19:00:33** (Disclosure 2); running it unplugged would exercise the live-temp path, not the latch |
| 3 | keys restored + read back, end state | **PASS** | `raw/keys-restored.txt` = step-0 values exactly; `raw/final-state.txt`; model restored to LFM |

**Session-wide counts** (grep over the continuous whole-session stream,
`raw/session-kalsa.txt` is its KALSA_*/RNLlama projection):

```
$ grep -c 'invalid thermal profile'   stream.log   → 0
$ grep -c 'prefill admission aborted' stream.log   → 0
$ grep -c 'KALSA_GOVERNOR_FALLBACK'   stream.log   → 0
$ grep -c 'KALSA_GOVERNOR_THERMO'     stream.log   → 0
$ grep -c 'KALSA_GOVERNOR_RUNTIME_FALLBACK' stream.log → 0
```

**Bottom line:** everything that ran is clean — the exact failure sequence of
`2e7b4dfd` (warm plugged chat → KV-held follow-up turn → invalid thermal profile →
prefill admission aborted → CPU fallback) never fired once on `7ec12eb0`, across 6 LFM
turns with the battery 7.5 °C above the latch point, plus a Qwen reload and two Qwen
turns. What this run does NOT prove: that the latch survives an engine-policy
recreation on the **NPU path** (the LFM switch-back leg) — the charger loss cancelled
it. Treat step 2 as OPEN until that one leg is re-run (LFM→Qwen→LFM, plugged, warm).

## Disclosures

1. **Turn 7 was aborted by my harness, not by the app.** My manual send procedure
   re-tapped the send button 3 s after the first tap because the staged text was still
   "found on screen" — but the first tap HAD sent: the grep matched the sent user
   bubble, not the compose. The re-tap hit the button's running-turn (stop) role →
   `nextToken:1835 Decoding Interrupted` at 18:41:05 (`raw/sw1-interrupted-excerpt.txt`).
   No TELEMETRY/GOVERNOR line for turn 7; the window has zero invalid/fallback lines.
   The previous session's guard never hit this because their first taps never
   registered. Fixed for turn 8: the re-send check looks at the compose EditText only,
   and no re-tap is issued once the compose has emptied. Turn 7's data is excluded from
   the verdict; turn 8 re-ran the same question cleanly.
2. **The charger dropped at 19:00:33 EDT** — `ac:true` through 18:51:01 and at 31.5 °C;
   `ac:false, status:3, online:1` from 19:00:33 (`raw/unplug-timeline.txt`, filtered
   ACTION_BATTERY_CHANGED lines). NOT thermal charge protection (the battery was cool
   when it dropped); loose cable/wall side suspected — I cannot re-seat it remotely.
   Turn 8 was sent at 19:00:23 plugged and ran its 225.6 s Qwen CPU prefill mostly
   UNPLUGGED: discharge −1700 mA, level 100→98, battery climbed 31.5 → **41.4 °C peak**
   (19:04:34, Thermal Status 3 transient, back to 1 by 19:06), always under the 44.0 °C
   stop. Turn 8 therefore counts as "nothing aborted" evidence, NOT latch evidence, and
   the plugged protocol ended there. Owner: please re-seat the S23's charger.
3. **`KALSA_GOVERNOR_THERMO` never logs `valid:true` on this build.** Session-wide the
   line count is 0 while ~10 admission checks passed; on `2e7b4dfd` the same line
   appeared only as `{"valid":false,…}` at the failure. The per-turn validity claim in
   the table rests on `attempt:1`, zero `invalid thermal profile`, zero
   `KALSA_GOVERNOR_FALLBACK`, and the prefill actually running on HTP0, plus
   `KALSA_GOVERNOR … "thermal_state":"FAST","thermo_source":"battery"` per turn.
4. **Turn-8 `promptMs` 225.6 s** is Qwen-4B CPU prefill of ~2.9k tokens while unplugged
   (NoFit is the designed pricing for Qwen; the previous run's Qwen turns also ran
   CPU). Consistent with the switch's CPU prewarm (102.8 s / 1692 tokens ≈ 16.5 tok/s).
   Nothing hung; `interrupted:false`, decode 6.4 tok/s.
5. The temp gate ("stop at 44.0 °C") was enforced before every turn by the harness
   (exit ≥ 440); the maximum PRE-turn reading was 37.0 °C. The 41.4 °C peak was
   post-send inside turn 8 on battery (Disclosure 2) — reported, not a gate miss.

## End state (19:12 EDT)

Kalsa FOREGROUND (`com.kalsa.app/.MainActivity` topResumed, pid 31230), screen Awake
(keyevent 224 only), model LFM2.5 2.6B restored, **NOT on charger** (dropped at
19:00:33 — see Disclosure 2), battery 97 % / 37.8 °C, Thermal Status 1,
`persist.traced.enable=0`, debuggable `7ec12eb0` installed (lastUpdateTime 2026-10-02
18:13:29). Bench keys restored to the step-0 values and read back
(`raw/keys-restored.txt`): `route=gpu, npu_lane=off, nativelog=off, energy_trace=1,
kvtranscript=1`, `devmodels` count 0. Tombstones unchanged from baseline. My turns
appended to the existing conversation (no new conversation rows).

## Evidence

`raw/` holds ONLY filtered lines / small state files — no full logcat:
`apk.sha256`, `manifest-debuggable.txt`, `install.log`, `keys-before.txt`,
`keys-restored.txt`, `tombstones-before.txt`, `tombstones-after.txt`,
`state-boot1.txt`, `boot1-kalsa.txt`, `t{1..6}-state-pre.txt`, `t{1..6}-kalsa.txt`,
`t{1..6}-state-post.txt`, `swqwen-state-pre.txt`, `swqwen-kalsa.txt`,
`sw1-state-pre.txt`, `sw1-kalsa.txt`, `sw1-interrupted-excerpt.txt`,
`sw1b-state-pre.txt`, `sw1b-kalsa.txt`, `sw1b-state-post.txt`,
`sw1b-governor-line.txt`, `swlfm-restore-state-pre.txt`, `swlfm-restore-kalsa.txt`,
`unplug-timeline.txt`, `answers.txt`, `session-kalsa.txt` (the continuous stream's
KALSA_*/RNLlama lines), `final-state.txt`. Per-turn KALSA windows are cumulative since
pid start (same style as the previous report); per-turn slices are recoverable by
timestamp. Raw UI dumps and the raw stream stay in /tmp/s23-latch (not committed).
