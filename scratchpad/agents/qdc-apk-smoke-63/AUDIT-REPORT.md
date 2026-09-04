# AUDIT REPORT — REPORT.md (Cell #63)

Auditor: pi (hostile). Every finding quotes file:line.

---

## Angle 1: Numeric traceability

Every number in REPORT.md against raw files:

| Claim | Report ref | Raw source | Raw content | Verdict |
|---|---|---|---|---|
| A tokensPredicted=90 | REPORT:71 | A_sa803197e_session_telemetry.txt:3 | `"tokensPredicted":90` | CONFIRMED |
| A predictedPerSecond=23.60897245882202 | REPORT:71 | A_sa803197e_session_telemetry.txt:3 | `"predictedPerSecond":23.60897245882202` | CONFIRMED |
| A promptMs=30040.307 | REPORT:71 | A_sa803197e_session_telemetry.txt:3 | `"promptMs":30040.307` | CONFIRMED |
| A tokensEvaluated=1329 | REPORT:70 | A_sa803197e_session_telemetry.txt:3 | `"tokensEvaluated":1329` | CONFIRMED |
| B tokensPredicted=65 | REPORT:72 | B_sa803197e_session_telemetry.txt:3 | `"tokensPredicted":65` | CONFIRMED |
| B predictedPerSecond=23.771593750045714 | REPORT:72 | B_sa803197e_session_telemetry.txt:3 | `"predictedPerSecond":23.771593750045714` | CONFIRMED |
| B promptMs=27776.585 | REPORT:72 | B_sa803197e_session_telemetry.txt:3 | `"promptMs":27776.585` | CONFIRMED |
| B tokensEvaluated=1329 | REPORT:70 | B_sa803197e_session_telemetry.txt:3 | `"tokensEvaluated":1329` | CONFIRMED |
| Attempt-4 B: 223 predicted, 23.538655856195913 t/s | REPORT:74 | B_sa803197d_session_telemetry.txt:3 | `"tokensPredicted":223,"predictedPerSecond":23.538655856195913` | CONFIRMED |
| APK-A SHA prefix c645f691 | REPORT:26 | steps_sa803197e.txt:1 | `sha=c645f691a9d16a896415a25d90bd3e179c7d9743c9bcdbde17603017112b0adc` | CONFIRMED |
| APK-B SHA prefix 1b8e2793 | REPORT:26 | steps_sa803197e.txt:9 | `sha=1b8e2793a63d182a1fe422a50519e246d8d4d4e4ce510ed2660c6cbbf8370a46` | CONFIRMED |
| Model size 1593894944 | REPORT:79 | A_sa803197e_model_ls.txt:4 | `1593894944 2026-09-04 09:32 LFM2.5-2.6B-QAD-Q4_0.gguf` | CONFIRMED |
| A proof: llama_model_loader 09:33:25.552 | REPORT:52 | A_sa803197e_s4_proof.txt:1 | `09-04 09:33:25.552 ... llama_model_loader: loaded meta data...` | CONFIRMED |
| A proof: KALSA_PREWARM 09:33:36.372 promptMs=9986.373 | REPORT:53 | A_sa803197e_s4_proof.txt:2 | `09-04 09:33:36.372 ... 'KALSA_PREWARM', '{"op":"done","promptMs":9986.373...}'` | CONFIRMED |
| B proof: llama_model_loader 09:35:35.499 | REPORT:56 | B_sa803197e_s4_proof.txt:1 | `09-04 09:35:35.499 ... llama_model_loader: loaded meta data...` | CONFIRMED |
| B proof: KALSA_PREWARM 09:35:46.537 promptMs=10156.62 | REPORT:57 | B_sa803197e_s4_proof.txt:2 | `09-04 09:35:46.537 ... 'KALSA_PREWARM', '{"op":"done","promptMs":10156.62...}'` | CONFIRMED |
| GPU offload 0/31 at line 8912 / 9320 | REPORT:84-85 | A_sa803197e_logcat_all.txt:8912 | `load_tensors: offloaded 0/31 layers to GPU` | CONFIRMED |
| B GPU offload 0/31 at line 9320 | REPORT:85 | B_sa803197e_logcat_all.txt:9320 | `load_tensors: offloaded 0/31 layers to GPU` | CONFIRMED |
| Attempt-1 refusal 40777 | REPORT:39 | A_sa803197_s2_copy.txt:1 | `run-as: /data readable or writable by others: 40777` | CONFIRMED |
| Attempt-1 B refusal 40777 | REPORT:39 | B_sa803197_s2_copy.txt:1 | `run-as: /data readable or writable by others: 40777` | CONFIRMED |
| Attempt-3 A "file is not a database" | REPORT:43 | A_sa803197c_s3_sql.txt:2 | `Error: in prepare, file is not a database (26)` | CONFIRMED |
| Attempt-3 B 40777 refusal | REPORT:43 | B_sa803197c_s2_copy.txt:1 | `run-as: /data readable or writable by others: 40777` | CONFIRMED |
| Uninstall A/B success | REPORT:88 | A_sa803197e_s7_uninstall.txt:1, B_sa803197e_s7_uninstall.txt:1 | `Success` | CONFIRMED |
| **B (attempt 2) S5 UI: "100%", "3:59", "Fri, Sep 4"** | REPORT:42 | **B_sa803197b_s5_send.xml** | Contains `"4:01"`, not `"3:59"`; `"3:59"` is in **A_sa803197b_s5_edit.xml** | **REFUTED** (wrong file attribution; B shows 4:01 not 3:59) |
| S0 flags: `flags=[ DEBUGGABLE HAS_CODE ALLOW_CLEAR_USER_DATA ]` | REPORT:28 | A_sa803197e_s0_flags.txt:2, B_sa803197e_s0_flags.txt:2 | Exact match | CONFIRMED |
| Recon: uid=0(root), ro.debuggable=1 | REPORT:9 | recon_sa803197e.txt:3-14 | `id uid=0(root)...ro.debuggable 1` | CONFIRMED |

**Attempt-outcome table vs steps ledgers:**

| Report table cell | Steps ledger | Verdict |
|---|---|---|
| A1: S0/S1 ok; S2 refused | steps_sa803197.txt:3-4 (S0 ok, S2 fail) | CONFIRMED |
| B1: S0/S1 ok; S2 refused | steps_sa803197.txt:11-12 (S0 ok, S2 fail) | CONFIRMED |
| A2: S0–S4 ok; S5 METHOD-VOID EditText missing | steps_sa803197b.txt:3-8 (S5 fail METHOD-VOID EditText not found) | CONFIRMED |
| B2: S0–S4 ok; S5 METHOD-VOID Send missing | steps_sa803197b.txt:11-16 (S5 fail METHOD-VOID Send node not found) | CONFIRMED |
| A3: S2 ok; S3 "file is not a database" | steps_sa803197c.txt:3-4 (S2 ok, S3 fail sql=1) | CONFIRMED |
| B3: S2 refused | steps_sa803197c.txt:12 (S2 fail) | CONFIRMED |
| A4: S0–S4 ok; S5 Send missing | steps_sa803197d.txt:3-8 (S5 fail METHOD-VOID Send node not found) | CONFIRMED |
| B4: S0–S7 pass | steps_sa803197d.txt:11-18 (all ok) | CONFIRMED |
| A5/B5: S0–S7 pass | steps_sa803197e.txt:1-16 (all ok) | CONFIRMED |

---

## Angle 2: Verdict G1 alignment with PREREG grid

PREREG grid: "G1: A-debug and B-debug both pass S0 through S5 through run-as."

REPORT verdict: "G1 — both debug release APKs pass S0–S5 through `run-as`" — **CONFIRMED correct.** The PREREG also says "S6" and "S7" are part of the procedure; the report says "S0–S7" in the table row for attempt 5, and the steps ledger confirms S6 and S7 both pass.

### Over-claiming check:

1. **"root/userdebug board"** (REPORT:9): The raw recon shows `uid=0(root)` (recon_sa803197e.txt:14) and `ro.build.type userdebug` (recon_sa803197e.txt:12). The phrasing conflates "root adbd" with "userdebug build" — technically imprecise but not an over-claim since both are stated.

2. **"the board's root adbd proves the `run-as` data-path behavior for these debuggable APKs"** (REPORT:92): Accurate. The report does NOT claim this proves non-root behavior.

3. **"this cell does not establish behavior on a non-rooted consumer phone"** (PREREG:9): The report repeats this caveat at REPORT:92. **CONFIRMED — no over-claim on field phones.**

4. **"The `predictedPerSecond` values are single-turn telemetry"** (REPORT:90): Correct; this is the PREREG non-goal. No over-claim.

5. **"no root command touches `/data/data`"** (REPORT:93): `grep /data/data d_run.sh` returns empty — no `/data/data` string exists in the driver. CONFIRMED.

**Angle 2 verdict: No over-claims found. The report is appropriately scoped.**

---

## Angle 3: Board-state interventions

Three interventions declared in PREREG amendments:

1. **chmod 771 /data** (Amendment 1): Declared "root, outside the app data path" — CONFIRMED.
2. **locksettings set-disabled true** (Amendment 2): Declared "board state, root, outside the app data path" — CONFIRMED.
3. **Holder loop `adb shell chmod 771 /data` every 2 s** (Amendment 3): Declared "root, outside the app data path" — CONFIRMED.

**No root command touches /data/data:** `grep -n '/data/data' d_run.sh` returns empty (exit code 1). All sandbox operations use relative paths via `run-as` (cwd = `/data/data/com.kalsa.app`). `grep -n 'su ' d_run.sh` and `grep -n 'adb root' d_run.sh` also return empty.

**Angle 3 verdict: CONFIRMED — all three interventions are correctly described as outside the app data path.**

---

## Angle 4: S4 proof lines exist in attempt-5 logcats AFTER launch

- A S4 launch timestamp: driver_attempt_sa803197e.log → `STEP A S4 ok` at `[12:33:39]`
- A proof lines in logcat: `09-04 09:33:25.552` (llama_model_loader) and `09-04 09:33:36.372` (KALSA_PREWARM done) — timestamps are after the launch (09:33:25 > device boot, and S4 poll follows launch).
- B S4 launch timestamp: `[12:35:49]`
- B proof lines: `09-04 09:35:35.499` and `09-04 09:35:46.537` — after launch.

The proof files `A_sa803197e_s4_proof.txt` and `B_sa803197e_s4_proof.txt` each contain exactly 2 lines matching the two grep patterns. CONFIRMED.

---

## Angle 5: "What this does NOT show" section — missing caveats

The section lists:
- No performance/throughput claim ✓
- promptMs is timer artifact ✓
- Not a consumer phone ✓

**Missing caveats:**

1. **userdebug board**: REPORT:9 mentions it; REPORT:92 repeats it. **Covered.** But the section title "What this does NOT show" does not explicitly restate that this is a userdebug board — the caveat is buried in the prose, not in the bullet list. Minor, not a failure.

2. **QDC-specific /data 0777**: The report notes `/data` was 0777 and needed 771 (REPORT:38, REPORT:43). The "What this does NOT show" section at REPORT:92 says "the board conditions `/data` held at 0771 and keyguard disabled were external preconditions." **Covered.**

3. **S5 UI flake of A in attempt 4 is unexplained**: REPORT:37 says "holder loop stabilized `/data`; A screen state still failed." The raw `A_sa803197d_s5_send.xml` shows the keyguard (package `com.android.systemui`, `text="4:28"`, `text="Fri, Sep 4"`, `text="100%"`). The `locksettings set-disabled true` from amendment 2 should have prevented this. The report does not explain why the keyguard reappeared for A in attempt 4. **MISSING CAVEAT.**

4. **promptMs artifact**: REPORT:90 mentions it. **Covered.**

**Angle 5 verdict: One missing caveat — the unexplained keyguard reappearance in attempt 4 A despite `locksettings set-disabled true`. The report describes the symptom ("A screen state still failed") but offers no hypothesis. This is a genuine gap in the analysis.**

---

## Angle 6: Session accounting

REPORT:96: "The orchestrator metadata for session 799128 reports billing at the 45-minute cap."

No raw file contains "799128" or "45". The report itself states at REPORT:97: "The local raw contains the five driver attempt tags and timestamps, but not the portal billing record; this accounting is therefore explicitly portal metadata, not independently recomputed here."

**Verdict: PLAUSIBLE** — portal figure, not in raw. The report is transparent about this.

---

## Angle 7: Referenced files that do not exist

All files cited in REPORT.md exist in raw/:
- steps_sa803197e.txt ✓
- A_sa803197e_s0_flags.txt ✓, B_sa803197e_s0_flags.txt ✓
- A_sa803197e_s4_proof.txt ✓, B_sa803197e_s4_proof.txt ✓
- A_sa803197e_session_telemetry.txt ✓, B_sa803197e_session_telemetry.txt ✓
- A_sa803197e_model_ls.txt ✓, B_sa803197e_model_ls.txt ✓
- A_sa803197e_s3_sql.txt ✓
- A_sa803197e_logcat_all.txt ✓, B_sa803197e_logcat_all.txt ✓
- A_sa803197_s2_copy.txt ✓, B_sa803197_s2_copy.txt ✓
- A_sa803197b_s5_edit.xml ✓, B_sa803197b_s5_send.xml ✓
- A_sa803197c_s3_sql.txt ✓, B_sa803197c_s2_copy.txt ✓
- A_sa803197e.png ✓, B_sa803197e.png ✓
- A_sa803197e_s7_uninstall.txt ✓, B_sa803197e_s7_uninstall.txt ✓
- B_sa803197d_session_telemetry.txt ✓
- driver_attempt_sa803197.log through driver_attempt_sa803197e.log ✓
- recon_sa803197e.txt ✓

**No missing files.** CONFIRMED.

---

## Summary

| # | Finding | Severity | Verdict |
|---|---|---|---|
| 1 | B attempt-2 S5 UI: report cites "3:59" from wrong file (A_sa803197b_s5_edit.xml, not B_sa803197b_s5_send.xml); B shows "4:01" | COSMETIC | REFUTED (wrong attribution) |
| 2 | All numeric values traceable to raw files | — | CONFIRMED |
| 3 | Verdict G1 matches PREREG grid literally | — | CONFIRMED |
| 4 | No over-claims found | — | CONFIRMED |
| 5 | All three board-state interventions declared and correctly described as outside app data path | — | CONFIRMED |
| 6 | No root command touches /data/data in d_run.sh | — | CONFIRMED |
| 7 | S4 proof lines exist in attempt-5 logcats after launch | — | CONFIRMED |
| 8 | Missing caveat: attempt-4 A keyguard reappearance despite `locksettings set-disabled true` | MINOR | MISSING |
| 9 | Session 799128 / 45 min: portal figure, not in raw | — | PLAUSIBLE |
| 10 | All referenced raw files exist | — | CONFIRMED |

**BLOCKERs: 0**
**FIX items: 0**
**MINOR items: 1** (Angle 5 missing caveat — keyguard reappearance)
**COSMETIC items: 1** (Angle 1 wrong file attribution for "3:59")

---

## Overall verdict: **BANK-WITH-FIXES**

The report is accurate on all numbers and structural claims. The G1 verdict is correctly derived. No over-claims. The two findings are cosmetic (wrong file attribution) and minor (missing caveat). Neither affects the validity of the G1 verdict or the integrity of the evidence. The report should add a sentence to "What this does NOT show" explaining why attempt-4 A S5 failed despite `locksettings set-disabled true` (the keyguard XML dump at `A_sa803197d_s5_send.xml` shows it re-engaged — likely because the keyguard disable was applied between attempts, not persistently, or the board's USB-power state re-triggered it).

## Orchestrator response (4/09 12:50)

- Finding 1 (3:59 attribution) FIXED: REPORT now states A `3:59` / B `4:01` with the right files.
- Finding 2 (attempt-4 A S5 cause) FIXED: paragraph added to "What this does NOT show" — display dropped between the EditText and Send dumps; sleep vs keyguard not distinguished; recorded as a board display flake.
