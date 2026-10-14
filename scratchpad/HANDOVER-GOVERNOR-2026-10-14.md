# Handover - governor coordinator, 2026-10-14 (session d5715de3 / kalsa-57) - READ FIRST

Supersedes `HANDOVER-GOVERNOR-2026-10-05.md` and the 2026-10-01 `COORDINATOR-STATE.md` for the governor line.
Detail lives in PLAN.md + docs/ALIVE.md; this file is the pointer list.

## HEADs (all pushed, verified 0 ahead)

| Repo | HEAD | What |
|---|---|---|
| App Aspis0/kalsa main | `aa789620` | Stage 0 app part (pin 861a3cc3, JSONL observation rows, KALSA_GOVERNOR_COMPLETION) on top of `8a8d74cf` (H9 fix) |
| Binding Aspis0/kalsa.rn main | `861a3cc3` | Stage 0 binding (observation ring, battery sysfs probe, one-lock stats+samples) on top of `2581a9aa` |
| Engine | `f1f612388` | unchanged (no skel rebuild needed) |
| Lab | see `git log` | cells below, PLAN/ALIVE current |

App worktree used: `~/Projects/kalsa-wt-severe` (detached at app main; push with `git push origin HEAD:main`).
Binding checkout: `~/Projects/llama.rn-kalsa-onecopy` (main). Never touch `~/Projects/kalsa` (other session).

APKs on disk: `~/kalsa-apks/aa789620-debuggable/` (CI run 38277368560, Stage 0) and `~/kalsa-apks/df359450-debuggable/`
(CI run 38172857932). The S23 has `aa789620` installed, battery ~56 % (needs a charge before the next benchmark).

## Done in this session (2026-10-11 .. 10-12)

- Meter: in-app energy (`s23-meter-gov-onoff-bc99cfeb`, current x voltage; turn 1 ON 254-294 mWh vs OFF 376) and
  sampler overhead bound <= 0.24-0.44 % of a turn (`s23-meter-overhead-bc99cfeb`).
- V81 GPU-prefill fallback verified in-app on QDC SM8850 (`qdc-v81-fallback-df359450`).
- H9 harness fix (prewarm restore readiness, PID filter): app `8a8d74cf`.
- Learning governor: design v0.5 + coordinator notes 3.5 (`agents/learning-governor/DESIGN.md`, AUDIT-1..3);
  Stage 0 binding + app written by GLM, hostile-audited by gpt-6-luna (binding 3 rounds + coordinator read that caught
  an engine reset on the bench path; app 2 rounds), pushed.
- S23 Stage 0 device check (`s23-stage0-obs-aa789620`): DESIGN 3.4 criteria 1-6 pass; 7 (leg mix) not judgeable as
  written (the two conversations differ; one 32-token GPU window per completion in both arms from turn 2); 8 not
  observable (no native binding log line reaches logcat). S23 battery sysfs is denied (OPEN 4: unusable there).
  App thermo sample age reaches 350 s inside a paced completion -> the planned 120 s freshness gate must change.

## Owner decisions this session (recorded in PLAN "Open decisions")

Learning-governor shape "va bene a tutto"; margin from both sources, blind forecast abstains; real-life robustness
(live margin, background heat term, outliers, forgetting, breaker, real-use Stage 0 data); Xiaomi pacing lines 39.0 /
42.6 C skin (headroom 0.083 / 0.203, SEVERE 66.5); private numeric Stage 0 log on the owner's Xiaomi approved;
starting values approved "se hanno senso si": breaker latch 6 h, blind cap 2048 tokens (must count across the tool
rounds of one turn), lookahead 10 s.

## Next, in order

1. **Xiaomi Stage 0 data** (owner lends the phone; it is his daily driver with a PIN): install dev APK `aa789620`,
   >= 20 completions of normal use, then `adb exec-out run-as com.kalsa.app cat files/governor/observations.jsonl`.
   Closes OPEN 1 (all three trip ranges) and OPEN 4 (battery sysfs on the Xiaomi). Xiaomi traps: memory
   `xiaomi-inapp-session-setup-traps`.
2. **Stage 0b** (DESIGN sec. 4): Xiaomi lines 0.083 / 0.203 in the app's `declaredSevere.ts`, its own check and audit.
3. **Lab replay** (DESIGN 3.3) over the Stage 0 JSONL; feed: app-age distribution (S23: up to 350 s), sysfs result.
4. **Stage 2** (the speed rule in the engine) only after 1-3; fix on paper first: app-sample freshness gate (120 s is
   wrong), blind cap per turn not per completion.
5. Owner question still open: repeat cell 75 on the Xiaomi (3 runs per leg, same start skin) - only before Stage 3.
6. M1 track (PLAN "Next steps" 5-7): Xiaomi 20-turn run on a current APK, owner's safety-marking decision, M1 dossier.

## Backlog added this session

- `KALSA_GOVERNOR` logcat line truncated at 4101 chars from turn 4 on (pre-existing, both APKs): fields after the cut
  are lost to the harness.
- No native binding log line reaches logcat in release-debuggable APKs (KALSA_GOVERNOR_PLATFORM, BATTERY_SYSFS,
  "decode hop thermal legs"): DESIGN 3.4 criterion 8 is unobservable until that is fixed or the criterion changes.
- Binding `lib/typescript` predates the new GovernorStats fields; the app reads them through a structural cast.
- Binding hop mirror drifts from the engine counter after a failed bench run (pre-existing, declared in 861a3cc3).
- The harness default battery floor is 85 %: set `CAMPAIGN_MIN_BATTERY_LEVEL` for a second arm; the runner installs no
  APK (install first, or the JS provenance gate refuses).
- Older leftovers: H9 residuals, A2, A3, E7, H8, H6.

## Delegation state

Paseo agents of this session archived at handover (GLM f0ae121c, luna c7d5e9b4, Fable 50888022). New session: new
agents from `list_profiles` (cross-check `~/.paseo/config.json`). Roster at 12/10: Skill Coder = GLM-5.3-Flash
(zcode: `update_agent` model `builtin:zai-coding-plan\GLM-5.3-Flash` after create and every prompt), reviewers luna /
deepseek. Writer model != auditor model. Device run harness for two arms: `agents/s23-stage0-obs-aa789620/raw/run-arm.sh`.
