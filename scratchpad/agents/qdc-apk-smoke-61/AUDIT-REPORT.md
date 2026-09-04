# AUDIT-REPORT — Cell #61 (hostile read-only)

Auditor: pi. All quotes cite file:line from the cell folder. Arithmetic via shell.

---

## 1. Numbers in REPORT vs raw

| Claim (REPORT) | Raw line | Verdict | Sev |
|---|---|---|---|
| tokensEvaluated 1329, tokensPredicted 129, predictedMs 4882, 26.4 tok/s (A) | A_s5_logcat:9785 + session_telemetry line: `tokensEvaluated":1329,"tokensPredicted":129,"predictedMs":4882.076,"predictedPerSecond":26.423` | CONFIRMED exact | — |
| tokensEvaluated 1329, tokensPredicted 196, predictedMs 7544, 26.0 tok/s (B) | B_s5_logcat telemetry: `"tokensPredicted":196,"predictedMs":7543.621,"predictedPerSecond":25.982` | CONFIRMED exact | — |
| promptMs 411063 (A) / 410008 (B) | A/B session_telemetry: `"promptMs":411063.012` / `"promptMs":410008.334` | CONFIRMED exact | — |
| n_past=1314, embd.size=1329 | A_s5_logcat:9785 `n_past=1314, embd.size=1329`; B_s5_logcat:9586 same | CONFIRMED | — |
| 15 new tokens | 1329−1314=15 (shell) | CONFIRMED | — |
| A pre 45.0 °C / post 35.6 °C; B pre 39.1 / post 44.6 | A_thermal_pre_s4 `max_hal_temp=45.0`; A_thermal_post_s5 `max_hal_temp=35.6`; B_thermal_pre_s4 `max_hal_temp=39.1`; B_thermal_post_s5 `max_hal_temp=44.6` | CONFIRMED | — |
| offloaded 0/31 layers to GPU (both) | A_s5_logcat:5364 `offloaded 0/31`; B_s5_logcat:5764 `offloaded 0/31` | CONFIRMED | — |
| uid 10225 (A) / 10226 (B) | steps_sa803030: `app_uid=10225` / `app_uid=10226` | CONFIRMED | — |
| size 1,593,894,944 B (both) | steps_sa803030: `size=1593894944` both | CONFIRMED | — |
| SESSION save usedTokens 1459 (A) | A_s5_logcat session_telemetry: `"usedTokens":1459` | CONFIRMED | — |
| Started 07:32:32 → Ended 08:03:21 = 30.8 min | /tmp/cell61c.log first entry 07:44:39, DONE 08:01:58; REPORT start 07:32:32 predates cell log (driver attempt 1, overwritten). 30.8 min = 1849 s (shell) — matches. | PLAUSIBLE (portal source, cell log doesn't cover attempt 1) | NOTE |
| "30 s from Send to telemetry" | Cell log: IME suspend 07:52:43, S5 ok 07:53:16; logcat A telemetry 04:53:12 UTC = 07:53:12 (UTC+3). Delta = 29 s (A), 31 s (B). | PLAUSIBLE but unverifiable from raw alone — /tmp/cell61c.log is NOT in raw/ | FIX |
| Prompt and answer shown in screenshots | A_sa803030.png: header "LFM2.5 2.6B · QAD-Q4_0 · Ready · local", prompt "Reply with one short sentence about mountains", answer "Mountains are towering peaks…"; B_sa803030.png: same header, different answer. | CONFIRMED | — |

## 2. S4 signal re-read / G1 verdict

**Finding 2a — G1 "BOTH PASS" overclaims.**
REPORT table header: `"S4 model load: engine loaded (see re-read) — driver ledger says fail"`.
Ledger (steps_sa803030): `STEP A S4 fail`, `STEP B S4 fail`.
PREREG G1: "A and B install, load, answer (tokensPredicted ≥ 1), banner present".
Banner: A/B_native_banner.txt = 0 bytes; A/B_maps_librnllama.txt = 0 bytes.
Verdict: **REFUTED-by-my-own-reading.** The REPORT claims G1 while (a) both S4 fail in the ledger, (b) the banner is absent, and (c) the PREREG's load criterion (`KALSA_SESSION op:load ok:true`) is never satisfied. The re-read explanation is scientifically honest but the G1 label is an overclaim. **Severity: BLOCKER before bank.**

**Finding 2b — S4 mechanism: re-read is legitimate but should be declared as an amendment, not a "re-read".**
PREREG S4: `wait for KALSA_SESSION {"op":"load", … "ok":true}` (PREREG.md L39).
Raw A_s4_logcat: `KALSA_SESSION {"op":"load","ms":3,"ok":false,"reason":"no_file"}` — KV-session restore on fresh install, no saved session. The model DID load (llama_model_loader, PREWARM done, generation at 26 tok/s).
Verdict: **PLAUSIBLE.** The recon's criterion was wrong (KV-session ≠ model-load). The REPORT correctly identifies this but should call it a "declared amendment to the pass criterion" rather than a "signal re-read." **Severity: FIX.**

**Finding 2c — "model loaded" evidence is sufficient and quoted correctly.**
Raw A_s5_logcat:4802 `llama_model_loader: loaded meta data with 38 key-value pairs and 266 tensors from …LFM2.5-2.6B-QAD-Q4_0.gguf` — matches REPORT quote exactly. PREWARM done (promptMs 9374, 1319 tokens, toolCount 5). Generation: 129 tokens at 26.4 tok/s. All confirmed.
Verdict: **CONFIRMED.** **Severity: —.**

## 3. "Backend actually used: CPU"

REPORT: `"offloaded 0/31 layers to GPU" in BOTH logcats`.
A_s5_logcat:5364 `load_tensors: offloaded 0/31 layers to GPU`. B_s5_logcat:5764 same.
REPORT: `"Adreno 750 selected" is consistent with 0 layers offloaded`.
A_s5_logcat:4794 `lm_ggml_opencl: device: 'QUALCOMM Adreno(TM) 750'`. Platform selection = init, not use.
Verdict: **CONFIRMED.** The REPORT is honest: OpenCL platform is initialized but no layers are offloaded. The Adreno selection is a platform probe, not GPU inference. **Severity: —.**

## 4. promptMs artifact

REPORT: `"prompt timer is evidently started at prewarm/launch, not at the turn. Banked as an app bug candidate"`.
Raw: promptMs 411063 ms ≈ 401 s after PREWARM done (9374 ms). The app was alive ~401 s between prewarm completion and telemetry.
REPORT alternatives: names only "prewarm/launch" as the timer start point.
Missing alternatives: (a) timer never stopped after prewarm (leaked monotonically), (b) monotonic vs wall-clock mismatch, (c) timer accumulated across multiple internal events.
Verdict: **PLAUSIBLE.** The diagnosis is likely correct but incomplete. **Severity: FIX.**

## 5. Marker/banner paragraph

REPORT: `"only the _opencl variant links OpenCL"`.
RECON-APP.md:5 lists `librnllama_jni_*` variants in `lib/arm64-v8a/`. No evidence in the folder establishes which variants link what. `assert-native-patch.sh` greps the .so binary for the marker string but its output is not in raw/.
REPORT itself acknowledges: "Indirect; declared as such."
Verdict: **PLAUSIBLE but unsupported inference.** The OpenCL/HTP inference chain is reasonable but the folder contains no evidence that only the `_opencl` variant links OpenCL. **Severity: FIX (state explicitly as inference, not evidence).**

## 6. Ops lessons

REPORT: "release APKs from apk.yml are NOT debuggable (run-as impossible)".
Raw A_sa803004_s2_copy.txt: `run-as: package not debuggable: com.kalsa.app`. CONFIRMED.
REPORT: "QDC unit boots with screen off and keyguard up".
PREREG Pre-data amendment 2: `mWakefulness=Dozing, focus NotificationShade`. CONFIRMED (from pre-run audit, not from this session's raw).
REPORT: "CI helpers' device mode refuses sideloading, so root is the QDC path".
PREREG amendment 1: run-as fails, root used. CONFIRMED.
Verdict: **CONFIRMED.** **Severity: —.**

## 7. Prose/structure

- G1 label in the verdict line while both S4 fail and banner is absent is the most pushable point for any owner.
- "The recon's claim was wrong" — this is about the PREREG's own recon (RECON-APP.md), which IS the recon. The REPORT calls its own source wrong. Should say "the recon's S4 criterion was imprecise."
- Session accounting "driver attempt 1 07:32:53 → 07:35" is not in the cell log (first entry 07:44:39). First attempt timestamps are from the portal only; say so.
- n_past/embd.size lines are mentioned in passing but never quoted in the table. They should appear in the table for completeness.
- "26.0-26.4 tok/s on the QRD8650 CPU is in line with the #57/#58 CPU lane" — no evidence for this comparison is in the folder.

## Summary

| # | Finding | Verdict | Sev |
|---|---|---|---|
| 2a | G1 "BOTH PASS" while S4 fail ×2 and banner absent | REFUTED-by-my-own-reading | BLOCKER |
| 2b | S4 re-read should be "declared amendment" not "re-read" | PLAUSIBLE | FIX |
| 4 | promptMs alternatives incomplete | PLAUSIBLE | FIX |
| 5 | OpenCL variant inference unsupported by folder evidence | PLAUSIBLE | FIX |
| 1b | /tmp/cell61c.log not in raw/; 30s claim unverifiable from raw alone | — | FIX |
| 7a | G1 label inconsistent with own findings | REFUTED-by-my-own-reading | FIX |
| 7b | First-attempt timestamps sourced from portal, not cell log | — | NOTE |
| 7c | n_past/embd.size lines missing from table | — | NOTE |
| 1–6 | All telemetry numbers, thermal, offloaded, UIDs, sizes, screenshots | CONFIRMED | — |

**BLOCKERs: 1** (Finding 2a: G1 overclaim).
**FIX items: 4** (2b, 4, 5, 1b/7a merged into "relabel verdict + add alternatives").
**Overall verdict: DO-NOT-BANK** (BLOCKER: G1 label must be downgraded to a declared-amendment verdict before banking).

## Delta audit

Re-audit of REPORT.md after the five FIX/BLOCKER items. Each verified against raw.

| Item | REPORT change | Raw verification | Verdict |
|---|---|---|---|
| 2a | Verdict relabelled `G1-AMENDED`; amendment stated in verdict line and new section header `Declared amendment to the pass criterion` | REPORT L1: `G1-AMENDED — both APKs pass on the engine evidence; two preregistered signals were unsatisfiable as written`. Owner reject path stated: "The owner may reject the amendment; then the cell is G1-pending, not a fail." | ACCEPTED |
| 2b | Section renamed from "re-read" to "Declared amendment"; body says "met by the raw under this amendment" | REPORT L22: `## Declared amendment to the pass criterion (S4 signal and banner)`. REPORT L31: `met by the raw under this amendment`. No remaining uses of "re-read" in the verdict/section. | ACCEPTED |
| 4 | Three promptMs alternatives named, each marked `Readings, none verified here` | REPORT point 4: `the prompt timer started at prewarm/launch instead of at the turn; a monotonic-clock value carried over from the prewarm turn; a clock-type mismatch between the native and JS sides`. | ACCEPTED |
| 5 | OpenCL inference marked `UNSUPPORTED inference in this folder` | REPORT point 5: `read as "the OpenCL- and Hexagon-enabled variant ran" only on the naming of the JNI variants in RECON-APP.md, an UNSUPPORTED inference in this folder (no evidence maps a log line to a specific .so).` | ACCEPTED |
| 1b | Timing cites `raw/driver_attempt3_sa803030.log`; clock offset stated as `device clock = Mac clock − 3 h` | driver_attempt3_sa803030.log L11: `[07:52:43] ime suspended: ...` CONFIRMED by grep. L12: `[07:53:16] STEP A S5 ok KALSA_TELEMETRY tokensPredicted>0` CONFIRMED by grep. Logcat A telemetry: `04:53:12.235`. 07:53:16−04:53:12 = 10804 s = 3.00 h. APK B: logcat 05:01:38, driver 08:01:47, offset 10809 s = 3.00 h. Offset consistent. | ACCEPTED |

**BLOCKERs remaining: 0.** All five items resolved.
**Overall verdict: BANK-WITH-FIXES** (no blocker; four FIX items accepted and applied; owner must affirm the G1-AMENDED verdict.)
