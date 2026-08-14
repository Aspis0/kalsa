# kalsa-ttft-4b-xiaomi

**Question:** does the TTFT-v2 prewarm recipe (eager engine kick + static-prefix prewarm) generalize from Jelly 2B to Qwen3.5-4B on Xiaomi 14?
**App:** `com.kalsa.app` 0.1.0 @ `bea257e` (main merge of `fix/ttft-v2`)
**APK:** `results/ttft_4b_xiaomi/kalsa-ttft-v2-bea257e.apk` sha `2B71032D87B3B6A695AE7ABECDEF4FA63DF75276C4D2AE56A0D1FD47417CA4CA` · assembleRelease arm64 · `--max-workers=4` · installed `-r` 2026-08-14 06:12 (existing 2026-08-09 install **not wiped**, 4736 MiB data kept)
**Device:** Xiaomi 14 · houji · 23127PN0CG · SM8650 · wireless adb `adb-625689a2-9xEOfw._adb-tls-connect._tcp`
**Model:** in-app catalog `qwen3.5-4b` (official MTP Q4_K_M + mmproj). Campaign file `/data/local/tmp/gdn_750/Qwen3.5-4B-Q4_K_M.gguf` 2740937888 B sha `00fe7986…ef11a4` MATCH, copied to `/sdcard/Download/` only (gdn tree untouched). App already had the catalog bundle; eagerInit selected `qwen3.5-4b`.
**Power:** UNPLUGGED the whole window. 100% → 87% · 29–35 °C (abort 43 °C never approached).
**S23 / Jelly:** not touched.

---

## Verdict

**PREWARM_PARTIAL(1a_ttft_unmeasured).**

The recipe **runs** on this SoC + 4B: `engine.eagerInit` fires, `KALSA_PREWARM start→done` completes in **~43 s** over **1510** prefix tokens (~35 tok/s). That is the hidden boot cost. First-send TTFT and the `reusing X/Y` fraction were **not clocked**: HyperOS right-edge back eats injected taps on the Send control (x≳1030 / 1200), and a SystemUI restart to apply `back_gesture_inset_scale_right=0` re-locked the PIN. Left-side taps (Menu, attach, mic) work. Protocol send = tap Send.

Do **not** cite a 1–3 s 1a number from this run.

---

## vs Jelly 2B (kalsa-ttft-v2-jelly.md)

| | Jelly 2B Q4_K_M | Xiaomi 14 4B Q4_K_M |
|---|---|---|
| SoC | Helio G99 | SM8650 |
| `engine.eagerInit` | yes | **yes** (3/3 colds) |
| `initLlama` / load | 6.6 s | first-ever 52.1 s (cold page cache); later colds **11.5 / 12.1 / 14.4 s** |
| Prewarm tokens | ~1293 | **1510** (`n_past=0`, `embd.size=1510`) |
| Prewarm `promptMs` | 40.1 s | **44.4 / 42.3 / 42.5 s** |
| Prefill rate | ~28 tok/s | **~35 tok/s** |
| 1a TTFT | **1.40 s** · `reusing 1276/1293` | **not measured** |
| 1b (join) | 39.5 s | not run |
| swipe-kill | 2.48 s | not run |
| KVDIAG after restore | n_past:0 | n_past:0 · `no_meta` / `meta_mismatch` (expected, hybrid) |
| Foreground gate | — | **CONFIRMED**: behind lock `KALSA_PREWARM skip reason=background` |

The 4B prefix is **heavier** (1510 vs ~1293) but **not slower in wall time** on this phone. The hidden cost the user never sees is still a ~40 s class prefill, same order as Jelly 2B.

---

## Protocol (mirrored)

Same clocks as the Jelly runner: `TTFT_MARK` at send + first `KALSA_TELEMETRY` (`ttft ≈ telemetry_ts − predictedMs`). Scenarios 1a ×2, 1b ×1, swipe-kill ×1. Screen ON. UNPLUGGED.

Harness: `scripts/ttft_xiaomi_runner.py`. RN logs `console.log("KALSA_PREWARM", json)` as `'KALSA_PREWARM', '{…}'` — regex must allow the quoted form.

---

## 1a colds that did run (send never reached the engine)

| rep | eager | load | prewarm start→done | promptMs | tokens | send |
|---|---|---|---|---|---|---|
| r1 | yes | 11.5 s | 07:30:19 → 07:31:04 | 44386 | 1510 | tap missed (gesture home) |
| r2 | yes | 12.1 s | 07:40:26 → 07:41:09 | 42288 | 1510 | tap missed (right-edge) |
| r3 | yes | 14.4 s | (same shape) | 42502 | 1510 | tap missed (right-edge) |

Behind-lock diagnostic (06:19): eagerInit `qwen3.5-4b`, load **52.1 s**, mmproj `/data/user/0/com.kalsa.app/files/models/qwen3.5-4b/mmproj-F16.gguf` n_ctx=16384, then `skip reason=background`.

---

## What blocked TTFT

1. Send lives at x=1029–1137 on a 1200-wide panel. Injected `input tap` / uiautomator2 click on that strip is swallowed (HyperOS right-edge back, full height). Menu / attach / mic (left and mid) inject fine.
2. `back_gesture_inset_scale_right=0` + `navigation_mode=0` (3-button) did not take effect until SystemUI was bounced; the bounce re-showed the PIN lock.
3. PIN is not in any campaign note. First unlock this session took ~74 min of polling (owner). After the bounce, polling again.

---

## Artefacts

`results/ttft_4b_xiaomi/` — apk, sha_records.md, existing_install.md, diag_behind_lock/, 1a_r{1,2,3}/ logcats + UI dumps, timings.csv, screenshots.

---

## Next (if someone has the PIN)

Keep 3-button nav. After unlock, confirm a right-edge tap now reaches Send. Then 1a ×2, 1b, swipe. Gate: 1a TTFT in the 1–3 s class **and** `reusing` >90% of 1510.

DONE
