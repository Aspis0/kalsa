# Handover - governor coordinator, 2026-10-15 (session mvs_f5f687c / Paseo agent 0dc81aaa) - READ FIRST

Supersedes `HANDOVER-GOVERNOR-2026-10-14.md`. Detail lives in `PLAN.md` + `docs/ALIVE.md`; this
file is the pointer list and the operating procedure.

## HEADs (all pushed, rev-list 0/0 verified)

| Repo | HEAD | What |
|---|---|---|
| App Aspis0/kalsa main | `54c36105` | Stage 0b: the Xiaomi 14 declares its own pacing lines 39.0 / 42.6 C skin -> `0.083 / 0.203`; the S23 keeps the shared `0.87 / 0.99`. Base `357e36d2` (the other session's phone-chat work) is inside the history. |
| Binding Aspis0/kalsa.rn main | `861a3cc3` | Stage 0 binding (observation ring, battery sysfs probe, one-lock stats+samples). Unchanged this session. |
| Engine | `f1f612388` | Unchanged; `vendor/VERSIONS` `LLAMA_CPP_REF=f1f612388e686...`, matches the engine worktree HEAD. |
| Lab | see `git log` | `5a79fb20` on top of the cell commit `944e3e12`. |

App worktree used this session: `~/Projects/kalsa-wt-s0b` (detached, **itself now on the pushed
`54c36105`**; it has `node_modules` from `npm ci`). `~/Projects/kalsa-wt-severe` is still the
Stage 0 harness tree at `aa789620`. Never touch `~/Projects/kalsa` (another session).

## Done 2026-10-15

- **Xiaomi 14 Stage 0 arm** (`xiaomi-stage0-obs-aa789620`): 6 turns, 8 observation rows on the
  owner's daily driver, harness stop flag at 11:57:46. Criteria **1, 2, 4, 5, 6 PASS**; 3 not
  testable (paced from the first completion); 8 not observable (no native line reaches logcat,
  pre-existing). **OPEN 1 closed**: Xiaomi passive trips cpu 60-115 C, npu 100 C, **gpu 95 C**, so
  the GPU block ceiling is 90 C and the zone guard does not bind on the blind path. **OPEN 4 closed
  negatively**: the battery sysfs is not readable by the app here either (same as the S23). Decode
  stayed 100 % NPU, pps 17.9 -> 3.2, skin peak 42.2 C, battery 79 -> 63 %, status 0 throughout, no
  crash, no pause, no kill.
- **DESIGN 5.1's freshness gate settled on paper** (`learning-governor/DESIGN-ADDENDUM-2026-10-15.md`,
  Item B): the app sample age reaches **503 s** inside one paced completion on the Xiaomi (350 s on
  the S23), so the planned 120 s wall-clock gate false-disarms. Rule: ownership of the current
  completion first, 1200 s backstop second; the native 5 s refresh branch is dead (OPEN 4).
- **The blind budget per turn** (Item C): the policy's unit is the completion and the engine has no
  turn, so a per-turn cap needs a monotonic `turn_epoch` the app sends once per turn, with stats
  `decode_speed_turn_epoch` / `decode_speed_blind_tokens_turn` so a reviewer can see it not resetting
  inside a turn.
- **Stage 0b shipped** as app `54c36105` on the owner's OK. Writer claude-haiku-5-5, hostile audit
  codex/gpt-6-luna: round 1 DO-NOT-SHIP (no test pinned the rounding direction), fixed and amended
  by the same writer, round 2 SHIP. Coordinator re-ran jest / tsc / provenance and both rounding
  mutations with real exit codes (`ceil` -> EXIT=1, restored -> EXIT=0).
- Phone left as found: `persist.traced.enable` 1, `screen_off_timeout` 60000, app force-stopped,
  device-side scripts removed. The kalsa-brain session `0ebb6a06` was told the phone is free.

## NEXT: Phase B - the >= 20 completions batch, collected from normal use

The owner agreed on 2026-10-15 to use the Stage 0 dev build normally on his Xiaomi for about a day.
That is the only thing owed before Stage 2. **Nothing on the phone needs doing except use it**:
no benchmark, no unplugged requirement, no settings.

State at handover: **8 rows / 6 turns**, file 50953 B of a 4 MB cap (rotation is far away), installed
APK sha256 prefix `0784913fe473febe` (the Stage 0 build, byte-identical to the local
`~/kalsa-apks/aa789620-debuggable/.../app-release.apk`).

Procedure (all commands are read-only except the two `cat`s, which only read the app's private dir):

```bash
X='adb-625689a2-9xEOfw._adb-tls-connect._tcp'          # it also appears twice in adb devices: always -s
CELL=/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/xiaomi-stage0-obs-aa789620

# 1. how many rows so far
adb -s "$X" exec-out run-as com.kalsa.app cat files/governor/observations.jsonl 2>/dev/null | grep -c '^{'

# 2. the installed build must still be Stage 0, or the rows are from something else
adb -s "$X" shell pm path com.kalsa.app        # then stream that base.apk through shasum -a 256
#    expected: 0784913fe473febec96689da816338b79a762f336598dcfbb56b29f69a4b177e

# 3. pull (a few seconds, over the existing wireless adb) and keep the copy
adb -s "$X" exec-out run-as com.kalsa.app cat files/governor/observations.jsonl \
  > "$CELL/raw/observations-phaseB.jsonl"

# 4. the DESIGN 3.4 checks on the new set
cd "$CELL/raw" && python3 check.py observations-phaseB.jsonl
```

**Do not** let anyone install another Kalsa on that phone: the other session is pushing app main and
dispatching `apk.yml`, and a new APK replaces the Stage 0 build and its rows. Step 2 exists to catch
exactly that.

After the pull: write the **DESIGN 3.3 replay** (not written yet - it is the next coding task, and it
is small: per-leg tok/s, the age distributions, the zone-rise per leg per window, the fit on the
non-censored rows, the bg/cooling condition number, the wake skin per phone). It closes **OPEN 2, 3,
5, 6**, and then Stage 2 can start for real, numbers included.

## Still open (owner)

- Whether to let **Stage 2's structure** be written now with the default OFF, in parallel with the
  Phase B collection, instead of waiting for the gate. Raised on 2026-10-15, not answered: the
  design says "Stage 2 does not start until OPEN 1-6 are closed"; OPEN 1 and 4 are closed, 2, 3, 5, 6
  wait for the replay. The structure does not need the numbers, the constants do.
- **QDC**: no board is connected in this session. It is the place for the speed branch, the GPU
  seed (OPEN 8) and the GPU-prefill logit oracle, but **never** for anything thermal (boards are
  always powered; the oracle cell faked battery 30 C unplugged). Needs his QDC access or the ssh
  path.
- Repeat cell 75 on the Xiaomi (3 runs per leg, same start skin) before Stage 3 - owner question
  from the previous handover, still open.
- M1 track (PLAN "Next steps" 5-7) untouched this session.

## Delegation state (re-read at every handover turn, the roster changes)

- Roster as of 2026-10-15 (`list_profiles`, cross-checked with `~/.paseo/config.json`): **Coder** =
  claude/claude-haiku-5-5 (auto/high), **Skill Coder n1** = minimax-code M3.1 Flash (max),
  **Explorer&WebSearch** = read-only, **Reviewer** = codex/gpt-6-luna (full-access/xhigh),
  **reviewer n2** = minimax-code M3.1 Flash. GLM/grok/luna of the previous session are **gone**.
- This session's agents: Stage 0b writer `51026de6` (claude-haiku-5-5), hostile auditor `187afbde`
  (codex/gpt-6-luna, two rounds). Recycle the same agent for revisions of its own work.
- Other live session: kalsa-brain `0ebb6a06` (claude-opus-5-5, cwd `~/Projects/kalsa-brain`) - warn
  it before any `apk.yml`, and it must be told before taking either phone. Its id changes; ask the
  owner.
- Device harness for the Xiaomi arm: `xiaomi-stage0-obs-aa789620/raw/{run-arm.sh,guard.sh,check.py}`.
  Traps learned there: the campaign config must live in the worktree's `campaigns/` dir (the runner
  resolves `t20c/script.json` next to it), `deviceModel` must be the model code (`23127PN0CG`, not
  "Xiaomi 14"), and the runner leaves `screen_off_timeout` pinned with **no restore at exit**.