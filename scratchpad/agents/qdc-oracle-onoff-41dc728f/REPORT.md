# QDC oracle + governor ON/OFF — app main 41dc728f (engine 74b75037f), SM8850 and QRD8750 (2026-10-11)

APK: `/tmp/kalsa-apk-41dc728f/.../app-release.apk`, sha256 `f2eb381ffabede90f5cc68ff04c79398611b79df31e55df8144a30eff2baf2d4` (checked on the Mac before install and again in setup.sh; debuggable, `pkgFlags=[ DEBUGGABLE HAS_CODE ALLOW_CLEAR_USER_DATA ]`).
Model: `LFM2.5-2.6B-QAD-Q4_0.gguf`, sha256 `a247afd6…0b03`, size 1593894944, verified on each device.
Account aspis.launcher@gmail.com (portal chip shows the email). SSH-only sessions 888089 (SM8850, serial 4816891, host sa892158) and 888272 (QRD8750, serial c13eb13b, host sa892341). Tunnel on local 6037 only, opened after checking the listener was free; both ssh PIDs closed by PID.
Battery: faked unplugged at 30.0 C on both boards (`dumpsys battery unplug; set temp 300`, read back), reset and read back at the end.
Skin: the live `mName=skin` entry is **#2** on both boards (entry #1 is frozen at 29.24 / 31.19); chosen by `skin-id.sh` (3 samples, 30 s apart) and cross-checked with kernel thermal zones.

## Verdicts

**Part 1 — GPU-prefill logit oracle, SM8850 (Adreno 840, v81), app 41dc728f: FAIL (R2). Not enabled. Owner decides.**
- Oracle: unmodified `oracle_logit.py`, TF mode, thresholds 0.03 / 0.02 / 0.10 (PREREG.md). Command: `oracle.sh <A> <B>` (raw/sm8850/oracle-*.txt).

| pair | A (CPU) | B (GPU, forced to A's 32 ids) | verdict | max_dlogp | max_dp1 | R1 | R2 steps | text_tokens A / B |
|---|---|---|---|---:|---:|---|---|---|
| 1 | p1a1 | p1b1 | **FAIL R2** | 0.5236 | 0.1075 | none | 5, 6, 9, 16 | 595 / 595 (n_common 0) |
| 2 | p1a2 | p1b2 | **FAIL R2** | 0.5236 | 0.1075 | none | same | 595 / 595 (n_common 0) |
| 3 | p1a3 | p1b3 | **FAIL R2** | 0.5236 | 0.1075 | none | same | 595 / 595 (n_common 0) |
| control | p1a1 | p1c (CPU, governor off, forced to A1 ids) | PASS | 0.0000 | 0.0000 | none | none | 595 / 595 |

- Pairs 2 and 3 are **replicas, not independent evidence**: `cmp` shows A1 and A2 probs byte-identical, and B1 and B2 byte-identical (greedy decode is deterministic on this build for this prompt). They do confirm the run is repeatable.
- The control is the noise floor the 10-03 run lacked: the same forced path on CPU reproduces A1 exactly (max_dlogp 0.0000). So the oracle is not noisy on this path, and the R2 failures are attributable to the GPU prefill, as the oracle registers.
- R1 (confident top-1 flip) never fired; top-1 agrees on all 32 steps in every pair. The failures are R2 distribution drift at steps 5, 6, 9 and 16 (e.g. step 16: dp1 0.108 against a 0.02 limit).
- R5 is still unmet by the registry (the sanity PASS must come from the 8 Elite, not run here). This is a FAIL on an oracle whose sanity control is not complete. Nothing enabled (R6).

**Part 2 — governor ON vs OFF in-app, battery faked unplugged 30 C, short prompt, tools off (timed arms).**
- SM8850: **ON = NPU prefill, roughly 6.2× faster prefill than CPU; decode unchanged (CPU decode in both arms); no crash, no fallback.**
- QRD8750: **ON = NPU prefill (ON-2 valid turn), roughly 5.5× faster prefill than CPU; decode unchanged; no crash, no fallback.** Only one valid ON turn on this board: ON-1 was killed by the 48 C stop before any telemetry (see Odd #3).

#### SM8850 (session 888089, cap 100, Started 11:42:19 AM portal = 15:42:19 UTC)

| turn | arm | prefill tok/s (595 tok) | decode tok/s | route (engine_prefill / layers) | plan npu_lane / fit / device | skin start → peak | answer | source |
|---|---|---:|---:|---|---|---|---|---|
| on-short-1 | ON | **1332.7** | 30.39 | NPU / HTP0 ×6 | auto / Fit / HTP0 | 36.5 → 43.1 | on topic, complete | raw/sm8850/on-short-1-kalsa.txt |
| on-short-2 | ON | **1341.5** | 30.51 | NPU / HTP0 ×6 | auto / Fit / HTP0 | 39.2 → 44.7 | on topic, complete | raw/sm8850/on-short-2-kalsa.txt |
| off-short-1 | OFF (CPU) | **216.8** | 30.33 | CPU | — | 38.4 → 44.1 | on topic, complete | raw/sm8850/off-short-1-kalsa.txt |
| off-short-2 | OFF (CPU) | **215.2** | 29.81 | CPU | — | 39.8 → 45.3 | on topic, complete | raw/sm8850/off-short-2-kalsa.txt |
| xon-short-1 (extra, shipped: tools on, default toolchoice, 2075 prompt tok) | ON | 1580.5 | 21.86 | NPU | auto / Fit | 39.7 → **48.9 KILL** at 47 s | — | raw/sm8850/xon-short-1-kalsa.txt |

- ON/OFF prefill ratio: 1337.1 / 216.0 = **6.19×** (mean of two turns each). Decode: ON 30.45 vs OFF 30.07 tok/s, i.e. no decode gain (both CPU decode).
- `thermal_state` in telemetry: FAST on all ON turns.
- Turns OFF completed without a kill (422 tokens each).

#### QRD8750 (session 888272, cap 70, Started 12:24:19 PM portal = 16:24:19 UTC)

| turn | arm | prefill tok/s (595 tok) | decode tok/s | route | skin start → peak | outcome | source |
|---|---|---:|---:|---|---|---|---|
| on-short-1 (third attempt, keep-awake) | ON | — | — | no plan line, no telemetry | 39.9 → 48.0 **KILL** at 154 s | no telemetry | raw/qrd8750/on-short-1-kalsa.txt |
| on-short-2 | ON | **1159.3** | 26.17 | NPU / HTP0 ×6 | 40.0 → 44.0 | complete, 509 tok, no fallback | raw/qrd8750/on-short-2-kalsa.txt |
| off-short-1 | OFF (CPU) | **213.7** | 27.46 | CPU | 40.0 → 43.9 | complete, 422 tok | raw/qrd8750/off-short-1-kalsa.txt |
| off-short-2 | OFF (CPU) | **210.8** | 27.50 | CPU | 39.9 → 43.9 | complete, 422 tok | raw/qrd8750/off-short-2-kalsa.txt |
| xon-short-1 (extra, shipped) | ON | — | — | no telemetry | 39.9 → 48.1 **KILL** at 131 s | no telemetry | raw/qrd8750/xon-short-1-kalsa.txt |

- ON-2 / OFF mean prefill: 1159.3 / 212.3 = **5.46×**. Decode: ON-2 26.17 vs OFF 27.48 (single ON turn, so not a decode claim).
- Answers on ON-2 and OFF-1/-2 are on topic ("the battery percentage drops faster… the operating system…"); full text in `raw/qrd8750/*-answer.txt`.

## Failures and crash markers

- Crash / assert / FATAL / CDSP CRASHED markers: **0** on every turn of both boards (`*-crash.txt` empty).
- `am_kill` lines for com.kalsa.app are our own force-stops (`reason=10 (USER REQUESTED) subreason=21 (FORCE STOP)`, `*-exitinfo.txt`), not lowmemorykiller. No LMK hit.
- `KALSA_NATIVE warn failed to mlock 223281152-byte buffer … Out of memory` appears on SM8850 turns p1a1 and on-short-1 (and the logs of later turns). The model still ran. Not investigated further.
- Watchdog KILL at ≥ 48.0 C (owner stop): SM8850 XON at 48.9; QRD8750 ON-1 at 48.0 and XON at 48.1. Each KILL was followed by `force-stop` within the watchdog interval; the campaign then went on to the next turn.

## Odd / not covered (read this)

1. **Prompt drift from 10-03 did not recur.** Every valid turn on both boards shows `text_tokens=595 n_common=0`. The fix is `wipe-chats.sh`, which clears `kalsa.conversations.v1` and `kalsa.messages.*` (RKStorage) before each turn, with read-back (`chat_rows before=… after=0`). The 10-03 growth cause was never measured on 10-03; this run shows the conversation store was the variable that changed the token count when it was not cleared. Memory flags (`kalsa.memory.*`, `kalsa.personas.*`) were 0 rows.
2. **Control design.** The brief asked for an unforced A repeat; `oracle_logit.py` TF mode requires `forced:true` on the second arm (otherwise DESCRIPTIVE R4). The control is therefore the CPU forced path (governor off, `force_ids` = A1's 32 ids). Its check is the same instrument as the B arms.
3. **QRD8750 ON-1 and the screen.** Three ON-1 attempts:
   - 12:29 (rc 8, APP NOT FOREGROUND): the screen dozed during the cold launch and the launcher took the top. Files in `raw/qrd8750/discarded-fg-fail/`.
   - 12:32: the screen dozed mid-turn and the turn stalled with no telemetry; I stopped it manually. Files in `raw/qrd8750/discarded-doze-stall/`.
   - 12:38 (kept): with `turn.sh` wake + a `KEYCODE_WAKEUP` every 5 s, the screen stayed awake, the turn started at 39.9 C and reached the 48 C stop at 154 s with no telemetry and no `KALSA_GOVERNOR_PLAN` line. Route is unknown for this turn. Not root-caused. The same board produced a clean NPU route on ON-2, about 14 minutes later, from a cooled start of 39.96 C, so this was a single failed turn, not a route change.
4. **Keep-awake was added after the first board.** SM8850 turns ran without the WAKEUP loop (the screen stayed awake on that board). QRD8750 turns ran with it. The `turn.sh` change is in the cell (comment at the keep-alive).
5. **Watchdog KILL at 48 C was not relaxed.** Cooldown target stayed 40 C with a 600 s cap. On QRD8750 the cooldowns took 81–304 s.
6. **Extra shipped-config turn (XON)** ran with tools on and a 2075-token prompt. It was killed at 48.9 (SM8850) / 48.1 (QRD8750), so it gives route and first-round telemetry only on SM8850 (1580.5 tok/s prefill, 21.9 tok/s decode, 540 tokens). Correctness not claimed.
7. **Chat-wipe and oparse ordering.** `arm.sh` was edited during the run (the file was atomically replaced after `p1a2` started). Consequence: `oparse.sh` for `p1b1` was run by hand; `p1b2`, `p1b3`, `p1c` used the new script. Same output format.
8. **`extract.sh`** takes the KV-prefix line before the first telemetry line (the send). The first KV-prefix line is the app's prewarm (509 tokens on p1a1) and is not the send.
9. **Oracle file-name vs label.** Labels are `p1a1 … p1c` (not `on-…`); `extract.sh` takes the arm kind from `<label>-kind.txt`.
10. **Stray process kill (mine).** While cleaning up the stalled QRD8750 turn I ran `pkill -f "com.kalsa.app"` on the Mac. That pattern matches any local process whose command line contains that string. I did not identify what it matched. Survivors afterwards: a vite dev server (`kalsa-brain/chat`), its esbuild service, a `tail -f` on a kalsa transient path, and a bash shell. Nothing was reported as missing; if a kalsa dev process is gone, that pkill is the cause.
11. **Wizard mis-click (portal).** I clicked a stale ref that was "Cancel" on the new-session wizard; a confirmation dialog appeared and I answered No (nothing was cancelled). Session 888089 was then created normally.
12. **Card minutes (read after the sessions, provisional).**
    - SM8850: 841 before → 799 after (−42). Session used 11:42:19 → 12:22 PM (≈40 min).
    - QRD8750: 512 before → 442 after (−70 = cap). Session used 12:24:19 → 1:14 PM (≈50 min). The −70 is the provisional hold (memory: holds settle to actual use within hours). **Re-read both cards later before quoting billed minutes.**
13. Skin sensor: live entry #2 on both boards (`raw/*/skin-samples.txt`). Entry #1 was frozen (29.24 / 31.19). `state-pre` files show entry #1 (diagnostic only); all decisions use `skin_c` (entry #2).
14. Hard stop: SM8850 XON reached 49.2 at the end of the turn; QRD8750 XON reached 48.3. Both boards were force-stopped by the watchdog, and the battery was reset afterwards.

## Minutes

| board | session | Submitted | Started → Ended (portal) | used | cap | card before → after (after both sessions ended) |
|---|---|---|---|---|---|---|
| SM8850 | 888089 | 11:39:03 AM | 11:42:19 AM → 12:22 PM | ≈40 min | 100 | 841 → 799 (provisional) |
| QRD8750 | 888272 | 12:23:06 PM | 12:24:19 PM → 1:14 PM | ≈50 min | 70 | 512 → 442 (provisional, −70 = cap) |

Driver deadlines: SM8850 17:16 UTC (cap ends 17:22); QRD8750 17:28 UTC (cap ends 17:34). Both sessions ended before their deadlines.

## Not verified / could not verify

- Whether the QRD8750 ON-1 turn (12:38) took the NPU route: no plan line and no telemetry.
- The 10-03 prompt-growth cause (not reproduced; only the fix is shown).
- The "mlock … Out of memory" warning's effect on the model (not measured).
- Billed minutes (provisional card values only).
- 8 Elite (QRD8750) PASS sanity control for the oracle (R5): not run in this cell (Part 1 is SM8850 only, per brief).

## Evidence map

`raw/sm8850/`, `raw/qrd8750/`: `campaign.log`, `<label>-{kalsa,hexlog,fastrpc,lmk,crash,exitinfo,watchdog,cool,state-pre,state-post,battery-pre,answer,arm,chats,kind,sendtime,amstart}.txt`, `<label>-probs.jsonl`, `<label>-ids.txt`, `oracle-*.txt`, `steps-*.txt`, `all-rows.tsv` (extract.sh), `skin-samples.txt`, `skin-index.txt`, `battery-faked.txt`, `discarded-*` (failed QRD8750 attempts kept as evidence). UI dumps and full logcats were deleted from `raw/` (they stay in `/tmp/qdconoff`, outside the lab). No binaries, no model, no APK.

Scripts (this cell): `env.sh setup.sh skin-id.sh kset.sh kmulti.sh wipe-chats.sh turn.sh arm.sh campaign.sh oparse.sh oracle.sh extract.sh steps.py oracle_logit.py` (unmodified copy) and the prompt files (`prompt-*.txt`, `enc-*.txt`, `prompts.sha256`, checked).
