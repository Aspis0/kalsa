# AUDIT-PRERUN — S5 cell, hostile pre-lock audit

Date 2026-09-04. Read-only except this file. Read: PREREG.md, d_run.sh, README-run.md,
PLAN-governor-in-app.md S5, qdc-apk-smoke-63 d_run.sh + REPORT.md + raw/, governorInputs.ts,
governorRuntime.ts, LlamaService.ts (880-930 + greps), turnTelemetry.ts, AUDIT-S3S4. Nothing
was run against a device; claims below are code-reading plus #63's own preserved raw evidence.

## B1 — The greedy token-ID oracle is not implemented anywhere in the driver — CONFIRMED, BLOCKER
d_run.sh:20 `if [ "$GREEDY_PREREQUISITE_VERIFIED" -ne 1 ]; then` (constant `=0`, d_run.sh:19)
d_run.sh:178 `grep -E 'KALSA_TELEMETRY.*"tokensPredicted"[[:space:]]*:[[:space:]]*[1-9][0-9]*'`
d_run.sh:224-233 (no token-ID field, no ≥32 check; TSV header d_run.sh:16 has no oracle column)
Failure: flipping the constant to 1 at lock time adds no oracle machinery — no
`kalsa.bench.sampling` read, no first-32 token-ID extraction/comparison, no `tokensPredicted >= 32`
check (any `[1-9][0-9]*` value ≥1 passes). PREREG.md:19-20 ("A paired observation with fewer than
32 tokens or missing token IDs is invalid") is then silently violated; speed rows are produced for
pairs the PREREG declares VOID (PREREG: "The cell is VOID if … missing token IDs"). Even the
set_prefs pull of RKStorage (d_run.sh:146-150, temp dir deleted) destroys the only snapshot that
could hold an app-side token artifact. One-line fix: parse/compare first-32 token IDs from the
declared artifact and require `tokensPredicted >= 32` before any speed row; gate on a runtime
proof line, not a literal.

## B2 — lmkd gate counts its own turn's events; it can never be zero — CONFIRMED, BLOCKER
d_run.sh:205 `adbT 60 -s "$SER" logcat -c > "${prefix}_clear.txt" 2>&1 || status=1`
d_run.sh:41 `logcat_all() { adbT "$1" -s "$SER" logcat -d -b all > "$2" 2>&1; }`
d_run.sh:224 `lmkd=$(count_lines 'lmkd|am_kill|lowmemorykiller' "$logcat")`
d_run.sh:233 `[ "$lmkd" -eq 0 ] || status=1`
`logcat -c` clears only the default set (main/system/crash); `-b all` still dumps the persistent
`events` buffer. Proven on this exact board family: #63 raw A_sa803197e_logcat_all.txt:3133 holds
`03-22 02:17:20.740 … I am_kill : [0,5354,com.google.android.gms.unstable,…]` — 5 months old,
survived `logcat -c` — and :4954/:5168 `am_kill : […,com.kalsa.app,…,stop com.kalsa.app due to
from pid …]` / `… due to deletePackageX` from earlier turns. S5 performs its own uninstall +
bootstrap force-stop BEFORE the clear (d_run.sh:164, 199-203) → every turn's dump contains ≥1
`am_kill` (plus board history) → lmkd_count ≥ 1 every turn → `status=1` → run aborts at turn 1.
Also `-b all` includes the kernel buffer (`init: Starting service 'lmkd'` boot lines survive -c).
One-line fix: `adbT … logcat -b all -c` at turn clear and epoch-anchor the count to after-clear,
or count only `main`+`events` lines with post-clear timestamps.

## M1 — Fresh-install contract silently breakable — CONFIRMED, MAJOR
d_run.sh:164 `adbT 120 -s "$SER" shell "pm uninstall $PKG" > "${prefix}_uninstall_old.txt" 2>&1 || true`
d_run.sh:166 `adbT 300 -s "$SER" install -r "$APK" > "${prefix}_install.txt" 2>&1; rc=$?`
If `pm uninstall` fails (tunnel hiccup, pm busy), `install -r` keeps prior app data; the previous
arm's chat/session state survives into the observation. set_prefs still overwrites the three keys,
so the arm flag is right, but history/caches differ from a true fresh install → oracle and TTFT
rows are silently invalid while `status=0`. Evidence exists in raw but nothing gates on it.
One-line fix: propagate the uninstall rc (and verify absence with `pm list packages`) and fail
the turn when it is non-clean.

## M2 — USB-power contradiction between #63 and S5 PREREG; no wakefulness check — PLAUSIBLE, MAJOR
#63 REPORT.md: "the board is not USB-powered, so `svc power stayon` cannot hold the screen"
(that display drop killed attempts 2/4); S5 PREREG: "A QDC board has no battery, USB power …".
d_run.sh:50 `adbT 60 -s "$SER" shell svc power stayon true >> "$file" 2>&1 || true` and d_run.sh:53
dumps `dumpsys power` but never parses `mWakefulness` (unlike #63's driver). If #63 is right about
this unit class, the display can sleep between typing and Send; the only response is the PREREG
abort on missing Send (PREREG "abort … missing UI composer/Send"), wasting the 45-minute session.
One-line fix: parse `mWakefulness=` from the wake.log dump and re-wake before the Send dump.

## Budget (checked, fits; zero slack) — PLAUSIBLE, MINOR
#63 REPORT timings: A loader 09:33:25 → B loader 09:35:35 (two arms ≈ 2 min/arm incl. install,
1.6 GB copy, 25 s bootstrap, ~11 s load); 8 arms ≈ 16-20 min + ~3 min model push + recon ≈ 25 min
< 45 min billed cap. But: any single flake aborts the session (no per-turn retry; PREREG stop rule),
and the driver has no internal deadline — the operator must enforce the cap.

## Minors
m1. d_run.sh:12 `case "$ARM_ORDER" in ABAB|ABABABAB) ORDER=ABABABAB;;` — "ABAB" silently runs 8
turns; usage text promises both. CONFIRMED. Fix: reject ABAB or drop the branch.
m2. PREREG secondary evidence (`commit_bytes`, `commit_ms`, `thermo_source:"bench-skin"`, exactly
one KALSA_GOVERNOR line per B turn) is not runtime-verified: d_run.sh:224-231 parses only
engine_prefill/engine_decode/thermal_state; everything else is post-hoc from raw logcat (which
does contain the fields, LlamaService.ts:917-926). CONFIRMED. Fix: `json_field` the missing keys
and check `thermo_source`.
m3. No `wait-for-device` after `SER=$(adbT 60 devices …)` (d_run.sh:77); a dead tunnel surfaces
as slow per-command rc=1s (masked by `|| true` chains) rather than a fast abort; evidence still
preserved. CONFIRMED.
m4. Statistics: thresholds are unambiguous (≤ and ≥ inclusive; tie at exactly 1/3 → pass, PREREG);
ABABABAB interleave is fine; 3-point medians flip on one outlier, acceptable given the declared
~10x prior art; fresh-install makes turn-1 "warm-up" exclusion moot (every turn is equally cold),
harmless as declared. EOS-before-32 is the oracle's hole (B1). CONFIRMED-minor.
m5. promptMs artifact: #63 raw `"promptMs":30040.307,"tokensPredicted":90,"tokensEvaluated":1329`
— TTFT is a known app timer, declared in PREREG; both arms pay the same 1329-token prefill, so
the ratio cell is unaffected. CONFIRMED-minor. One-line fix: none needed, but state the artifact
in the report.
m6. Driver relies on the post-fix contract only (enums as names, one governor line last in turn;
`last_json` at d_run.sh:227 takes the last line, verified against the real format
`KALSA_TELEMETRY {"turnId"...}` — turnTelemetry.ts:191 — sed + JSON::PP parse clean, trailing \r
is valid JSON whitespace). No reliance on the old contract found. CONFIRMED-clean.

## Checked and clean
- Prerequisite gate placement: d_run.sh:19-22 exits 3 before any device access (device select at
:77) and before the model path; PREREQUISITE.txt + empty results.tsv are the only artifacts —
CONFIRMED correct.
- Thermo JSON: all six amended fields present (`batt_temp_tenths_c=round(skin*10)` → 39.291→393;
`plugged:false`, `t_idle_valid:true`, `t_idle_c`=first session skin; trend °C/min, warming sign+,
first-turn baseline = session_pre). Matches governorInputs.ts profileFrom gate (`!plugged || …`).
- Skin parse (d_run.sh:96) matches the real dump line exactly: `Temperature{mValue=39.291, mType=3,
mName=skin, mStatus=0}` and the "Current temperatures from HAL:" / "Thermal Status:" markers in
#63 raw; mName=skin/mType=3 is a HAL convention, plausibly stable on QRD8750.
- set_prefs: SQL quoting safe (JSON carries no single quotes; `"` inside single-quoted SQL literal);
`-bail`, `wal_checkpoint(TRUNCATE)`, wal/shm removed on device after the main DB copy; run-as cp
makes the file app-owned; app force-stopped before pull.
- Model identity: local sha+size, device sha, push, re-sha, 644, per-turn run-as copy size check
— all match PREREG (sha a247afd…, 1593894944); APK sha recorded per turn; DEBUGGABLE grepped and
gated per turn (fresh_install returns the grep rc).
- No root in the app-data path; `/data` 771 holder lives outside it (d_run.sh:66-73), proven shape
from #63 attempt 5; residual chmod/run-as race accepted with prior evidence.
- adb exit codes: every adbT logged to adb-exit.log incl. quiet ones; CRLF stripped for SOC/ui/
stat; absolute paths only; no `find` on $HOME; evidence (status.txt, filtered, thermal, install,
flags, wake) preserved on every partial-failure path; cleanup restores stayon/locksettings/
screen_off_timeout/IME and force-stops; session names ≤30 chars; one TSV row per turn (11 cols,
all populated, na only on genuine gaps).

## Verdict
NO-GO to lock as written. Closing the prerequisite and filling the APK sha does not cure B1 (the
oracle machinery must actually exist) or B2 (B2 alone aborts turn 1 on every board, every session,
on #63-proven evidence). Everything else (M1-M2, m1-m6) is fixable without changing the design.

## Delta re-audit (5/09)

Re-read PREREG.md (125), d_run.sh (299), README-run.md (16), PLAN Amendment 5/09, benchSampling.ts.

- B1 — PARTIAL. Oracle now exists: key injected d_run.sh:166 `('kalsa.bench.sampling','greedy');`,
  parse_tokens (d_run.sh:204-206: n≥32, 32 numeric ids, dies on missing/strange, partial output
  overwritten by VOID), ids_sha+oracle columns, pairing d_run.sh:290 (A writes, B reads, VOID never
  diffed, state correct across turns), runtime prereq d_run.sh:291+295 exit 3 on A turn 1 with
  PREREQUISITE.txt and END.txt=exit_3 via trap. Hole → D1.
- B2 — FIXED. d_run.sh:233 `logcat -b all -c` clears events/kernel; anchor = device `date +%s`
  taken AFTER the clear (d_run.sh:234-238): gap lines are excluded (timestamp < anchor) — safe
  direction; count_lmkd_after (d_run.sh:197) `$1+0>=a` (float epoch vs int OK, banner lines $1+0=0
  excluded) AND requires `com.kalsa.app` or APP_PID — foreign am_kill and `init: Starting service
  'lmkd'` kernel lines can no longer fire. APP_PID taken after `am start`, before the kills it
  detects; #63 raw shows am_kill always names the process, so the name filter suffices.
- M1 — FIXED. d_run.sh:180-181: `grep -c` prints 0 AND exits 1 on no match; `|| true` patches rc
  only; the count is read from stdout, so absent→0 (pass), present→1 (fail), adb failure→empty→
  `${package_count:-1}`≠0 (fail closed). Correct; `list_rc` is dead (always 0) → D3.
- M2 — FIXED. ensure_awake (d_run.sh:111-121) before/after mWakefulness dumps, re-wake, turn fails
  if not Awake; PREREG now records #63's not-USB-powered note and separates rack power from the
  BatteryManager plugged report.
- Budget — FIXED. d_run.sh:22 `START_EPOCH=$(date +%s); DEADLINE_EPOCH=$((START_EPOCH + 2400))`
  (host clock, script start); deadline_check in polls+per turn; exit 124 → `trap cleanup EXIT INT
  TERM` (d_run.sh:69) restores IME/screen//data holder, END.txt=deadline_40_min. Caveat → D4.
- m1 FIXED (d_run.sh:12). m2 FIXED (d_run.sh:286-288 gate commit_bytes/commit_ms/thermo_source/
  governor_count==1). m3 FIXED (d_run.sh:72). m4 FIXED (oracle-PASS-only medians enforceable).
  m5 FIXED (prefill artifact declared in PREREG). m6 FIXED (post-fix strings only).

New findings:

- D1 — MAJOR, CONFIRMED. poll_telemetry (d_run.sh:225-230)+telemetry_32 (d_run.sh:208-210)
  `n>=32` make ≥32 tokens a completion requirement. The contract sanctions EOS-short turns
  ("fewer than 32 ids are allowed only when EOS came first") and PREREG rules them VOID-continue.
  A short greedy answer → 600 s poll timeout → status=1 → session aborts; VOID is unreachable.
  Fix: poll on tokensPredicted≥1; let the oracle VOID short pairs.
- D2 — MINOR, PLAUSIBLE. poll returns on the first dump containing the telemetry line;
  KALSA_BENCH_TOKENS is logged ~ms later; a snapshot inside that window (matters only on A1) →
  empty bench → spurious PREREQUISITE exit 3. Fix: one extra logcat_all after the match.
- D3 — MINOR. `list_rc` always 0 after `|| true`; recorded `list_rc=0` misleads forensics when
  grep failed. Fix: capture rc before `||`.
- D4 — MINOR. Deadline is checkpoint-granular; a 600 s push / 300 s install can overshoot 40 min;
  evidence+END.txt still guaranteed by the trap. Acceptable.
- D5 — MINOR/watch. governor_count==1 (d_run.sh:287) counts prewarm lines too (anchor is before
  launch); holds only if the locked APK emits one KALSA_GOVERNOR per chat turn and none at
  prewarm — verify against the locked APK before locking.

Checked clean: parse_tokens robustness (n as string/float coerces numerically; ids array with
spaces fine; trailing \r is valid JSON whitespace); ids_sha = sha256 of the 32-line file, na on
VOID, diff only between two valid files; 13 TSV columns exactly per PREREG; evidence preserved
before every exit 3/124/1; run_observation one-liners (d_run.sh:273-295) fully quoted — no
word-splitting bug; 299 lines < 300 cap — no split needed.

## Delta verdict
GO-WITH-FIXES. 0 blockers, 1 major (D1), 4 minor (D2-D5). Fix D1 before lock: poll on any
completed telemetry; the oracle VOIDs short pairs per the contract.
