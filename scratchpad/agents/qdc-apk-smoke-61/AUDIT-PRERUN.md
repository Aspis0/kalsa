# AUDIT-PRERUN — Cell #61 (QDC headless APK smoke, 2 APKs)

Generated read-only. Every finding cites the file:line it reads.

---

## 1. Cross-file tracer: PREREG ↔ driver

| PREREG step | Driver (d_run.sh) | Verdict | Severity |
|---|---|---|---|
| S1 install + pm dump | L105-111 `adbT 300 install -r` + `pm dump` | CONFIRMED | — |
| S2 run-as copy + size 1593894944 | L115-128 `run-as … cp` + `wc -c <` vs `$MODEL_SIZE` | CONFIRMED | — |
| S3 first-launch 25 s + force-stop | L132-136 `am start … sleep 25 … force-stop` | CONFIRMED | — |
| S3 SQL: `kalsa.model.id` | L137 `set_model_pref` → host sqlite3 on pulled RKStorage | CONFIRMED | — |
| S3 SQL: compaction/thinking defaults | Omitted — app defaults are compaction=ON, thinking=default (compactor.ts:291, benchConfig.ts:355) | CONFIRMED | — |
| S4 logcat poll `op:load ok:true` | L153-157 `poll_load` → `has_load` awk | CONFIRMED | — |
| S5 IME suspend/restore | L88-96 `ime_suspend` / `restore_ime` (EXIT trap) | CONFIRMED | — |
| S5 prompt typed via `input text` | L77-82 `type_prompt` — word-by-word + keyevent 62 | CONFIRMED (matches ci-lib.sh:1415-1422 `type_text` convention) | — |
| S5 Send via uiautomator bounds | L84-86 `bounds_node Send` greps `content-desc="Send"\|text="Send"` | CONFIRMED (`accessibilityLabel="Send"` → content-desc; AiChatPage.tsx:4701) | — |
| S6 logcat -d -b all | L172 `logcat_all 300` → `logcat -d -b all` | CONFIRMED | — |
| S6 native banner `kalsa-native-patches` | L174 `grep -F 'kalsa-native-patches'` | CONFIRMED | — |
| S6 `/proc/pid/maps` via run-as | L178-180 `run-as $PKG cat /proc/$pid/maps` | CONFIRMED | — |
| S6 screencap | L183 `exec-out screencap -p` | CONFIRMED | — |
| S6 ui xml dump | L184 `dump_ui_to` | CONFIRMED | — |
| S6 thermal | L100-107 `thermal_record` via `thermal_gate.sh` | CONFIRMED | — |
| S7 `pm uninstall` | L196-200 `finish_apk` → `pm uninstall` | CONFIRMED | — |
| A then B order | L253-254 `run_apk A …; run_apk B …` | CONFIRMED | — |
| Per-APK uninstall before B | `finish_apk` at end of each `run_apk` call | CONFIRMED | — |
| Model reuse in `/data/local/tmp` | Push once (L48-62), resume check skips re-push | CONFIRMED | — |
| SHA checks: local APKs + model | L43 `verify_local_sha` × 3 (shasum -a 256) | CONFIRMED | — |
| SHA check: on-device model | L51-61 `sha256sum` on device, compare to `$MODEL_SHA` | CONFIRMED | — |
| `adbT` caps on every adb call | All `adb` invocations go through `adbT` | CONFIRMED | — |
| Evidence: `KALSA_SESSION\|KALSA_TELEMETRY` lines | L173 `grep -E` | CONFIRMED | — |
| Evidence: telemetry `tokensPredicted>0` | L73-74 `poll_telemetry` grep `[1-9][0-9]*` | CONFIRMED | — |

**Nothing in PREREG the driver skips or does differently.**

---

## 2. Bugs

### BUG-1 — `type_prompt` space handling (FIX)

d_run.sh:77-82:
```
type_prompt() { local -a words; local word first=1; read -r -a words <<< "$PROMPT"; for word in "${words[@]}"; do if [ "$first" -eq 0 ]; then adbT 60 -s "$SER" shell input keyevent 62 || return 1; fi; adbT 60 -s "$SER" shell input text "$word" || return 1; first=0; done; }
```

**Verdict: PLAUSIBLE.** ci-lib.sh:1415-1422 documents the same word-by-word + KEYCODE_SPACE pattern with the comment: *"`adb shell input text "a b"` reaches the device as two arguments (only "a" is typed)"*. This is the established convention. However, the prompt `'Reply with one short sentence about mountains'` has only ASCII words — no risk of IME mangling here. **Severity: NOTE (matches ci-lib convention; correct for this prompt).**

### BUG-2 — `wc -c <` through run-as: carriage-return in output (FIX)

d_run.sh:122-123:
```
size=$(adbT 60 -s "$SER" shell "run-as $PKG sh -c 'wc -c < files/models/$MODEL_DIR/$MODEL_FILE'" |
      tr -d '[:space:]')
```

**Verdict: PLAUSIBLE.** The `tr -d '[:space:]'` strips `\r` from `adb shell` output. Confirmed: `adb shell` appends `\r\n`; `tr -d '[:space:]'` removes all whitespace including `\r`. **Severity: NOTE (correctly handled).**

### BUG-3 — `pull_rkstorage` fallback: inverted `have_wal`/`have_shm` guard (FIX)

d_run.sh:99-105:
```
  if adbT 60 -s "$SER" shell "run-as $PKG test -f databases/RKStorage-wal" >/dev/null 2>&1; then
    have_wal=1; files+=(RKStorage-wal)
  fi
  ...
  [ "$have_wal" -eq 0 ] || adbT 120 -s "$SER" exec-out run-as "$PKG" \
    cat databases/RKStorage-wal > "$dir/RKStorage-wal" 2> "$dir/pull.err" || return 1
```

**Verdict: PLAUSIBLE but confusing.** `[ "$have_wal" -eq 0 ]` → true when file does NOT exist → skip. The OR (`||`) means the `cat` runs only when `[ … -eq 0 ]` is false (i.e., file exists). Logically correct but reads as inverted. **Severity: NOTE (logic is sound; readability issue only).**

### BUG-4 — bash 3.2 `set -u` + empty `"${files[@]}"` (FIX)

d_run.sh:1 sets `set -u`. If the `files` array were ever empty, `"${files[@]}"` on bash 3.2 macOS would fail with `unbound variable`. In practice, `files` always starts with `(RKStorage)` (line 93), so this never triggers. **Severity: NOTE (defensive guard missing but unreachable in this code).**

### BUG-5 — No step ledger for S5 sub-failures (FIX)

d_run.sh:159-170: `tap_bounds`, `type_prompt`, and `bounds_node` failures set `s5_detail` but are not individually recorded in the step ledger. The step is only written once at line 171. If `type_prompt` fails (returns 1 from `adbT` SIGALRM), the step says `METHOD-VOID prompt typing failed` but the `tap_bounds` success is not logged separately. **Severity: NOTE (all sub-failures aggregate into one S5 fail; adequate for smoke test).**

### BUG-6 — `sqlite3` assumed present on Mac (FIX)

d_run.sh:140-145 uses bare `sqlite3` on the host. Not checked. ci-lib.sh:79 does `sqlite3 "$db" "PRAGMA quick_check;"` without checking. **Severity: NOTE (both scripts assume sqlite3 is installed; it is on macOS with Xcode CLT). Confirm before run: `which sqlite3`.**

### BUG-7 — No resume/retry for mid-run crashes (FIX)

If `d_run.sh` crashes between S1 and S7 (e.g., SSH tunnel drops), the model is already on device and APK is installed, but there is no checkpoint to resume from. The model push has a resume guard (L48-51), but install/copy/launch/sql do not. A re-run starts from scratch (S1 installs over existing, S2 re-copies). **Severity: FIX (acceptable for a 45-min smoke, but add a `--resume` gate for longer sessions).**

### BUG-8 — connect.sh `exec` replaces shell, orphaning tunnel on failure (FIX)

connect.sh:75 `exec "$DIR/d_run.sh" "$JOB"` replaces the shell. If `d_run.sh` exits non-zero, the SSH tunnel background process (L60) is orphaned. **Severity: NOTE (tunnel cleanup is manual; `lsof -nP -iTCP:6037` in connect.sh L35-37 kills stale tunnels on re-run).**

### BUG-9 — PREREG: compaction/thinking not explicitly set in SQL (FIX)

PREREG says "compaction and thinking left at the CI defaults (COMPACTION=on, THINKING=default)". The driver does NOT write these keys (only `kalsa.model.id`). The app defaults are compaction=ON (compactor.ts:291 `return "anchored"` for missing) and thinking=default (benchConfig.ts:355 `return "default"`). **Verdict: CONFIRMED. Severity: NOTE (defaults match CI expectations).**

---

## 3. Removed/unsafe behaviour

| Check | Verdict | Evidence |
|---|---|---|
| Touch port 5037? | REFUTED | connect.sh:35 checks `6037`; L29 `ANDROID_ADB_SERVER_PORT=6037` |
| Push to git remote? | REFUTED | No `git push` in any script |
| Edit app repo? | REFUTED | PREREG: "Nothing in the app repo is modified" — driver uses read-only ci-lib |
| `rm -rf` on computed path? | REFUTED | `rm -rf "$dbdir"` only on mktemp dirs; `rm -rf "$dir"` for temp files |

---

## 4. Ops

**End Session reminder:** d_run.sh:257 `log "DONE FINAL_RC=$FINAL_RC — raw/ populated. Remember: End Session in the portal."` — log only, no enforcement. **Severity: NOTE.**

**Per-APK isolation:** `finish_apk` calls `pm uninstall` at L196 before next `run_apk`. Model in `/data/local/tmp` is shared (PREREG: "the gguf in /data/local/tmp is reused"). **Severity: NOTE (correct per PREREG).**

**Model reuse:** Push once (L48-62); resume guard skips re-push if sha matches. Per-APK: run-as copy re-done (L115-128). **Severity: NOTE (correct per PREREG).**

**45-min budget — WORST-PATH CAP SUM:**

| Operation | Cap (s) |
|---|---|
| Device discover | 60 |
| Recon getprop | 120 |
| SHA checks ×3 | 180 |
| Model push (fresh) | 3600 |
| Model push verify | 300 |
| APK-A install | 300 |
| S2 run-as copy + size | 120 |
| S3 first launch + force-stop | 85 |
| S3 thermal pre_s4 | 90 |
| S3 set_model_pref | 480 |
| S4 logcat clear + launch + poll (5×60) | 360 |
| S5 IME suspend | 60 |
| S5 UI dump ×2 | 120 |
| S5 type (7 words × 60) | 420 |
| S5 poll_telemetry (10×60) | 600 |
| S5 thermal post_s5 | 90 |
| S6 evidence (logcat + maps + screencap + ui) | 540 |
| S7 uninstall | 120 |
| **SUBTOTAL (fresh push)** | **7640 (127 min)** |
| **Resume (push skipped)** | **4040 (67 min)** |

**Verdict: FIX.** A fresh model push (3600s) dominates and exceeds 45 min alone. The resume path (67 min) still exceeds 45 min. The PREREG estimates 20 min — this assumes push takes 2 min (1.6 GB ≈ 8 MB/s = 200s), not the 3600s cap. **The cap is a safety limit, not expected. With a fast tunnel and 8+ MB/s, the push should finish in ~200s, total ~25 min.** Severity: FIX (verify tunnel throughput before booking; if <2 MB/s, book 90 min).

---

## 5. Reuse/simplify

**Dead code:** None found. Every function in d_run.sh is called.

**Helpers unused:** `bounds_edit` is used only once (S5 EditText), but extracting it keeps S5 readable. `skip_steps` is used on S1/S2 failure paths.

**PREREG does not need:** The `GATE` thermal_gate.sh reference (L22) — it's optional (`[ -x "$GATE" ]` guard at L101). The `adb root` attempt in recon (L36-38) — recorded but not used for anything. Both are low-cost and informative.

---

## Summary

| # | Finding | Severity |
|---|---|---|
| BUG-1 | type_prompt word-by-word (matches ci-lib convention) | NOTE |
| BUG-2 | wc -c through run-as, \r stripped | NOTE |
| BUG-3 | pull_rkstorage fallback guard reads inverted | NOTE |
| BUG-4 | bash 3.2 set -u + empty array (unreachable) | NOTE |
| BUG-5 | S5 sub-failures not individually step-logged | NOTE |
| BUG-6 | sqlite3 not checked on Mac | NOTE |
| BUG-7 | No resume/retry for mid-run crashes | FIX |
| BUG-8 | connect.sh exec orphans tunnel on failure | NOTE |
| BUG-9 | Compaction/thinking keys omitted (defaults match) | NOTE |
| OPS-1 | 45-min budget: fresh push exceeds; verify throughput | FIX |
| OPS-2 | End Session: log only, no enforcement | NOTE |
| OPS-3 | Per-APK isolation: correct per PREREG | NOTE |

**BLOCKERs: 0.**
**FIX items: BUG-7 (resume gate), OPS-1 (verify tunnel throughput).**
**All other findings: NOTE severity — correct, matching ci-lib conventions, or unreachable.**

## Verdict: **RUN** (with pre-flight: `which sqlite3` and `dd if=/dev/zero bs=1M count=100 | adb shell cat > /data/local/tmp/kalsa61/bwtest` to verify tunnel throughput ≥2 MB/s before booking).
