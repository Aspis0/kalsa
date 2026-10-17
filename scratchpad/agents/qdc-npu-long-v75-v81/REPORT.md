# REPORT — NPU prefill logit-oracle, Hexagon v75 (QRD8650) and v81 (SM8850), QDC

Cell: `qdc-npu-long-v75-v81`. Date 2026-10-17 (EDT). Build: `app-release.apk` sha256 `0bcace27…` (debuggable, binding `df912b0e`), the v73-fix build
(`/tmp/apk-v73.wS32/…/app-release.apk`). Model: `LFM2.5-2.6B-QAD-Q4_0.gguf`, sha256 `a247afd6…` (checked on the device).
Oracle: `oracle_logit.py` unmodified, sha256 `685c7a08…`, TF mode, thresholds 0.03 / 0.02 / 0.10.

## VERDICT

- **SM8650 / Hexagon v75 (QRD8650): not affected like v73.** 0 of 32 top-1 flips on the long prompt (2005 positions)
  and on the short prompt (595). The NPU logits still leave the R2 band (max Δlogp 1.26 long, 0.98 short), the same class as v79.
  Decode also ran on NPU in this arm, so this result does not isolate prefill.
- **SM8850 / Hexagon v81 (SM8850): not affected like v73.** 0 of 32 top-1 flips on either prompt, and the NPU
  prefill with decode on CPU (the S23 kind-H configuration). Logits still breach R2 (max Δlogp 1.30 long, 1.10 short).

Reference: v73 before the fix 21/32 (long), after 1/32 (user figures, not re-measured here). v79 0/32 long, max Δlogp 1.44.

## ORACLE LINES (verbatim)

```
QRD8650 (v75) long:   oracle=FAIL rule=R2 steps=32 max_dlogp=1.2607 max_dp1=0.0671 divergences=0 first_div=-1
QRD8650 (v75) short:  oracle=FAIL rule=R2 steps=32 max_dlogp=0.9845 max_dp1=0.0292 divergences=0 first_div=-1
SM8850 (v81) long:    oracle=FAIL rule=R2 steps=32 max_dlogp=1.3039 max_dp1=0.0665 divergences=0 first_div=-1
SM8850 (v81) short:   oracle=FAIL rule=R2 steps=32 max_dlogp=1.0959 max_dp1=0.0511 divergences=0 first_div=-1
```

Pairs: CPU reference = same board, governor off, free greedy (kind CPU); NPU = governor on, teacher-forced to the CPU arm's 32 ids,
`governor_force` / `npu_lane` / `route` / `thermo` absent (kind NPU, S23 kind H). `oracle_exit=0`, `steps_exit=0` for all four.

## TABLE (steps 0–31, comparable steps 32 in every pair)

| board | prompt (positions) | top-1 disagree | max \|Δlogp\| CPU top-1 | max dp1 | R1 steps | oracle |
|---|---|---|---|---|---|---|
| QRD8650 v75 | long (2005) | **0 / 32** | 1.261 | 0.067 | none | FAIL R2 |
| QRD8650 v75 | short (595) | **0 / 32** | 0.984 | 0.029 | none | FAIL R2 |
| SM8850 v81 | long (2005) | **0 / 32** | 1.304 | 0.067 | none | FAIL R2 |
| SM8850 v81 | short (595) | **0 / 32** | 1.096 | 0.051 | none | FAIL R2 |

Per-step tables: `raw/sa905809/steps-CL-vs-NL.txt`, `steps-CS-vs-NS.txt`, `raw/sa906021/steps-CL-vs-NL.txt`, `steps-CS-vs-NS.txt`.
Top-1 counts parsed from the `A1=`/`B1=` fields of each step row. Forced ids identical to the CPU arm for all four NPU arms (`cmp`).

## ROUTE AND SKEL, FROM THE LOGS

| board | arm | engine_prefill | engine_decode | npu_device | skel opened | forced |
|---|---|---|---|---|---|---|
| QRD8650 (`sa905809`, serial `36aa3b71`, SM8650) | NL, NS | NPU | **NPU** | HTP0 | `libggml-htp-v75.so` | false (ids forced by `force_ids`) |
| SM8850 (`sa906021`, serial `cf39e6a`, SM8850, Android 17) | NL, NS | NPU | CPU | HTP0 | `libggml-htp-v81.so` | false |

`prefill_ctx_ngl:99` and `prefill_chunks` sum to 2005 (long) and 595 (short). Crashes 0 in all 8 turns; watchdog KILL 0.
Peak skin: QRD8650 CPU 38.8 / NPU 37.3 °C (long), SM8850 CPU 39.4 / NPU 32.4 °C (long).

**Caveat (QRD8650):** the default governor chose NPU decode on this board, unlike the S23 H arm and the SM8850 board (decode CPU).
So the QRD8650 NPU arms are NPU prefill plus NPU decode, and the logit drift cannot be attributed to prefill alone there.
Forcing decode to CPU on that board was not in the brief and was not run.

## BOARDS AND SESSIONS

| board | QDC session | portal board | device | host (ADB via tunnel) | start → end (EDT) |
|---|---|---|---|---|---|
| SM8650 | **901740** `oracle-npu-v75-long-qrd8650` | Snapdragon 8 Gen 3, Mobile Reference Design, QRD8650 | `36aa3b71`, `ro.soc.model=SM8650` | `sa905809.sa.svc.cluster.local:5037` | 09:39:03 → 10:00:52 (Completed) |
| SM8850 | **901952** `oracle-npu-v81-long-sm8850` | Snapdragon 8 Elite Gen 5, Mobile Reference Design, SM8850 | `cf39e6a`, `ro.soc.model=SM8850` | `sa906021.sa.svc.cluster.local:5037` | 10:06:06 → 10:26:55 (Completed) |

SM8650 board name: the lab's `QRD8650` cells (`qdc-governor-s5`, `qdc-8g3-gpu750-y8-70`). SM8850: `snapdragon-all/PLAN.md` ("8 Elite Gen 5, SM8850, canoe").
Both sessions: SSH only, Screen Always On, SSH key `kalsa-mac`, 90 min cap. Sessions were run one after the other.
Portal "Total Minutes Used" was not verified against billing.
Other notes: the SM8850 SSH key list came back empty on the first pass (a transient list state); it was fine after reopening the wizard.
No login or 2FA prompt was seen. No credentials were handled.

## METHOD NOTES

- Same board for both arms of each pair, as the brief required. The CPU reference is the board's own CPU arm
  (free-run), not the R5 `A2long` file. R5 showed a cross-board CPU reference can differ by Δlogp ~0.6 (see `qdc-npu-long-8750/REPORT.md`).
- Setup per board: APK sha checked, `install -r -d`, model pushed and checked on device (`device model sha OK`),
  battery faked 30.0 °C unplugged (as R5), `kalsa.model.id=lfm2.5-2.6b`.
- Chat store wiped before each turn, cold launch each turn, cooldown to ≤40 °C before each turn.
- n = 1 pair per prompt per board. This does not measure how often the drift happens, only that it happened here.

## WHAT THIS DOES NOT SETTLE

- Whether the logit drift (|Δlogp| ~1.0–1.3 at top-1) matters for answers: no top-1 flips here, so greedy text was unaffected on these prompts.
- Prefill-only behaviour on v75: decode was NPU on that board (see caveat).
- v73 after-fix long prompt (1/32) was not re-run; the comparison above uses the user's figures.

## CLEANUP

- Each board: 12 bench / app keys deleted and read back `ABSENT` (`raw/sa905809/cleanup-keys.txt`, `raw/sa906021/cleanup-keys.txt`).
- Each board: `dumpsys battery reset`, `svc power stayon false` (`battery-reset.txt`).
- Both sessions ended in the portal (End Session, then Yes on the confirm dialog; "Create Snapshot" not used).
- Both SSH tunnels closed (process verified before `kill`; `lsof` on 6037 empty afterwards).

## FILES

- Scripts (copied from `qdc-npu-long-8750`, `env.sh` repointed to this cell and to the v73-fix APK; `oracle_logit.py` unmodified): `setup.sh`, `arm.sh`, `turn.sh`, `kmulti.sh`, `kset.sh`, `oparse.sh`, `oracle.sh`, `steps.py`, `skin-id.sh`, `wipe-chats.sh`, `env.sh`.
- Raw per board: `raw/sa905809/` (QRD8650) and `raw/sa906021/` (SM8850): per turn `CL`, `NL`, `CS`, `NS` (`*-kalsa.txt`, `*-probs.jsonl`, `*-ids.txt`, `*-watchdog.txt`, `*-hexlog.txt`, `*-crash.txt`, `*-run.log`), oracle and steps output, `setup-run.log`, `recon.txt`, `install.txt`, `pkg.txt`, `skin-samples.txt`, `cleanup-keys.txt`, `battery-reset.txt`.
