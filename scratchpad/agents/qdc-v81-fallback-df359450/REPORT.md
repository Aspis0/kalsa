# QDC V81 GPU-prefill fallback — app main df359450 (engine f1f612388, binding 2581a9aa), SM8850 (2026-10-11)

## Status: NOT RUN — the SM8850 MRD was unavailable on the portal, no session was started

No turn ran. No APK was installed, no model was pushed, no tunnel was opened, no battery or screen state was changed on any board.

## Verdict table

| turn | arm | verdict | evidence |
|---|---|---|---|
| nolane-1 | NOLANE | NOT RUN | — |
| on-1 | ON | NOT RUN | — |
| nolane-2 | NOLANE | NOT RUN | — |
| off-1 | OFF | NOT RUN | — |

The V81 fallback claim is therefore **unverified on device**. Only the source reading below is checked.

## What was checked (no device)

- APK on disk: `/tmp/kalsa-apk-df359450/kalsa-apk-arm64-v8a-debuggable-df35945089e5ec19f7d837adfa2642891c4ae23f/app-release.apk`, `shasum -a 256` = `b10a79605a08e87d99fd8f6139b29c7c66c1afc29a04bd0f24135e553a3d4a7c` (matches `env.sh:12`).
- Route logic at app commit `df359450`, `src/engine/governorInputs.ts`:
  - `:370` `enabled = force || GPU_PREFILL_CORRECT[generation] || laneEnabled`.
  - `:102` `V81: true` (comment: "owner 2026-10-11: GPU fallback when the NPU lane is off").
  - `:410` the `gpu-prefill-incorrect-<gen>` reason is attached only when `enabled` is false, so on V81 it cannot fire.
  - `:17` `BENCH_NPU_LANE_KEY = "kalsa.bench.npu_lane"`; `:284` the effective pref is printed as `npu_lane` on the plan line; `tagSchemas.ts:66` enumerates `off|on|auto`.
  - `:362-367` `laneEnabled` is `false` for `"off"`, so with the lane off the governor's own GPU gate (`:370`) decides.
- Telemetry field names used by the pass criteria exist at this commit: `engine_prefill` (`LlamaService.ts:1855`), `layers_device` (`benchRoute.ts:97`).

Reading only: this says the NOLANE arm should reach GPU prefill, not that it does.

## Why nothing ran (portal, aspis.launcher account)

- Interactive Sessions list (20 rows read, sorted newest first): every row `Completed`; the newest is `onoff-8elite-41dc` (QRD8750, 12:23 PM–1:14 PM) and the SM8850 row is `oracle-onoff-8eg5-41dc` (11:39 AM–12:22 PM). No running session on this account.
- New Interactive Session, step 2 "Select Devices": the SM8850 card has class `disabled-card hoverable` and reads `SM8850 | Multiple | 799 min remaining | Unavailable`. The card is not selectable. The first list read showed `Devices Busy` for the same card.
- Re-read after a wizard reload and again on the Devices catalog page: still `Unavailable`, still 799 min.
- The QRD8750 card is `Available Now`, but it is Snapdragon 8 Elite (Adreno 830, V79). It cannot test the V81 route, so it was not used.
- The wizard was abandoned at step 2 (nothing created). The session list shows no new row.

## Minutes

| board | card before | card after | session used |
|---|---|---|---|
| SM8850 | 799 min remaining (read in the wizard and on the Devices page) | 799 min remaining | 0 |

## Changes made to the cell

1. `turn.sh` (logcat dump, around line 80–84): the atomic dump now requires a trailing newline, and a failed dump no longer falls back to `cp $FULL.tmp $FULL`. A failed dump writes `$P-logcat-failed.txt` and exits 13, so a turn is never reported as "0 crash markers" without a check. `rm -f $FULL` before the loop stops a stale file from passing. `bash -n` exit 0.
2. `campaign.sh` (new): the four planned turns in order (`nolane-1 NOLANE`, `on-1 ON`, `nolane-2 NOLANE`, `off-1 OFF`), stopping at the first non-zero rc. `bash -n` exit 0. Not run.
3. Unchanged: `env.sh`, `arm.sh`, `setup.sh`, `skin-id.sh`, `kmulti.sh`, `kset.sh`, `wipe-chats.sh`, `extract.sh`, `oparse.sh`, prompts.

## Not covered / odd

- Everything on device is unverified: install, model sha on device, skin entry choice, battery fake, keep-awake, all four turns, crash markers, answers, prefill/decode numbers.
- `extract.sh` and `oparse.sh` still source `env.sh` with `|| true`, so an unreachable tunnel prints `STOP` into their stream rather than failing loudly. Left as is: they run after a turn when the tunnel is up.
- Session cap, tunnel port 6037, and portal state were not touched.

## Evidence map

No `raw/` files exist for this cell. The only artifacts are this report and the two scripts above.
