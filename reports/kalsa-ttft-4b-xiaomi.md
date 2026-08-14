# kalsa-ttft-4b-xiaomi

**Question:** does the TTFT-v2 prewarm recipe (eager engine kick + static-prefix prewarm) generalize from Jelly 2B to Qwen3.5-4B on Xiaomi 14?
**Device:** Xiaomi 14 · houji · 23127PN0CG · SM8650 · wireless adb `adb-625689a2-9xEOfw._adb-tls-connect._tcp`
**Model:** in-app catalog `qwen3.5-4b` (official MTP Q4_K_M + mmproj). `/data/local/tmp` tree not written.
**S23 / Jelly:** not touched.

### Post-fix APK (the numbered run)

**App:** `com.kalsa.app` @ `fix/memguard-p0` `4f5c034` (P0 send-path skip when the requested model is already resident).
**APK:** `results/ttft_4b_xiaomi/kalsa-memguard-p0-4f5c034.apk` sha256 `AE2AA467966886FA04D53C92BDFC8391F5611B4AC054E4D10CE0DD7F29BB3E2F` · assembleRelease arm64 · `--max-workers=4` · installed `-r` 2026-08-14 ~14:15 UTC (no wipe). Bundle contains `alreadyResident`.
**Power:** UNPLUGGED the whole window. 62% → 56% · 30.5–35.6 °C (abort 43 °C never approached). Screen unlocked by owner. USB debugging (Security settings) ON — synthetic `input tap` lands.

---

## Verdict

**PREWARM_UNIVERSAL.** **FIX_VERIFIED** (harness 27/27 + on-device Send after 4B resident).

Both 1a reps land in the 1–3 s class with `reusing 1174/1187` (98.9% of the **actual** prefix; this APK/session is 1179 prewarm / 1187 send, not the earlier 1510). Hidden boot cost is a ~30 s prefill.

P0 ("not enough memory" with the model already loaded) is gone on this device. P1 (idle unload / zombie Ready header) is **not** covered by this fix.

---

## vs Jelly 2B (kalsa-ttft-v2-jelly.md)

| | Jelly 2B Q4_K_M | Xiaomi 14 4B (pre-fix, unmeasured send) | Xiaomi 14 4B **post P0 fix** |
|---|---|---|---|
| SoC | Helio G99 | SM8650 | SM8650 |
| APK | `fix/ttft-v2` | `bea257e` | `fix/memguard-p0` `4f5c034` |
| `engine.eagerInit` | yes | yes (3/3 colds) | **yes** (1a×2 + 1b) |
| `initLlama` / load | 6.6 s | first-ever 52.1 s; later 11.5 / 12.1 / 14.4 s | later-cold class (prewarm starts ~4–14 s after launch) |
| Prewarm tokens | ~1293 | **1510** | **1179** (`embd.size`; send total **1187**) |
| Prewarm `promptMs` | 40.1 s | 44.4 / 42.3 / 42.5 s | **30.9 / 29.1 / 33.1 s** |
| Prefill rate | ~28 tok/s | ~35 tok/s | **~38 tok/s** (1179 / 31 s) |
| 1a TTFT | **1.40 s** · `reusing 1276/1293` | not measured (taps eaten) | **1.42 s / 2.02 s** · `reusing 1174/1187` |
| 1b (join) | 39.5 s | not run | **26.0 s** · remaining prewarm + 2.52 s · `reusing 1174/1247` |
| swipe-kill | 2.48 s | not run | not run (out of this mandate) |
| Send after 4B resident | — | **blocked** (P0 memguard) | **works** |
| Foreground gate | — | behind lock: `skip reason=background` | n/a (screen unlocked) |

The earlier campaign's 1510-token prefix was heavier than Jelly's ~1293 and still ~40 s class. The post-fix session prefix is **1179 / 1187** and the hidden prefill is **~30 s** — still the cost the user never sees on a cold launch, just cheaper on this SoC.

---

## Post-fix numbers (2026-08-14 ~14:15–14:32 UTC)

Prompt: `ciao`. Clock: `TTFT_MARK` → first `KALSA_TELEMETRY` (`ttft ≈ telemetry_ts − predictedMs`). Artefacts: `results/ttft_4b_xiaomi/postfix/` + `timings.csv`.

| # | Gate | Measured | Detail |
|---|---|---|---|
| 1a r1 | eager; TTFT 1–3 s; reuse >90% | **1.424 s** | eagerInit yes; prewarm 31.254 s / 30915 ms; `reusing 1174/1187`; 60% 32.9 °C UNPLUGGED |
| 1a r2 | same | **2.016 s** | prewarm 29.413 s / 29088 ms; `reusing 1174/1187`; 59% 33.9 °C UNPLUGGED |
| 1b r1 | join | miss | Send during model-load, 4 s before `KALSA_PREWARM start`. No user `loadPrompt`. |
| 1b r2 | join after `KALSA_PREWARM start` | **25.992 s** | remaining prewarm + 2.52 s user `promptMs`; `reusing 1174/1247`; 56% 35.6 °C UNPLUGGED |

1a r1 device timestamps: `TTFT_MARK` 10:20:54.531 → `loadPrompt` 10:20:54.802 (`reusing 1174/1187`, `n_past=1174`) → `KALSA_TELEMETRY` 10:20:56.848 (`predictedMs` 892.5). No `model.tooLarge`.

P0 was the other blocker on this phone: after prewarm, HyperOS `MemAvailable` ~2.1 GB vs 2.7 GB GGUF → Send refused. `alreadyResident` skips that check. Harness: loaded + low available → allow; unloaded + low → still refuse.

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

## Next (superseded)

The PIN / right-edge-tap blockers are closed: owner unlocked the phone and enabled **USB debugging (Security settings)**. The 1a/1b numbers above are the ones to cite. Swipe-kill was out of this mandate. P1 idle-zombie is still open.

---

## Retry 2026-08-14 ~08:50 (clock-only — stopped on PIN)

**Verdict still PREWARM_PARTIAL(1a_ttft_unmeasured).** No 1a/1b numbers. Upgrade to PREWARM_UNIVERSAL not earned.

Attempted the surgical retry on the same device/APK/4B (no reinstall, no wipe, S23/Jelly untouched). UNPLUGGED 76% → 75% · 33.5–33.6 °C.

| step | result |
|---|---|
| `KEYCODE_WAKEUP` | leaves HyperOS **Dozing/AOD** (black + fingerprint circle) |
| `KEYCODE_POWER` | **Awake**, full lockscreen (clock + media card + fingerprint) |
| `wm dismiss-keyguard` | **does not** clear this lock (`NotificationShade`, `mDreamingLockscreen=true`) |
| mid-screen swipe-up | reveals **PIN + fingerprint bouncer** (`id/keyguard_pin_view`, “Enter PIN or use fingerprint to unlock”) |
| PIN in prior artefacts | **no** — not typed, not guessed |

`navigation_mode` is still **2** (gestures). `back_gesture_inset_scale_right=0` is already set; applying it last run required a SystemUI bounce that re-showed this PIN. Do **not** bounce SystemUI.

Send center-tap and KEYCODE_ENTER were not reached (app behind keyguard → prewarm would `skip reason=background` again).

Human unlock (PIN or fingerprint, ~30 s) then 1a ×2 / 1b ×1. After send, read `KALSA_PREWARM` `op=done`, `RNLlama : loadPrompt`, first `KALSA_TELEMETRY`, and `reusing X/Y`.

Artefacts: `results/ttft_4b_xiaomi/retry_lock/` (`immed.xml` = PIN pad). Task report: scratchpad `agents/ttft-4b-xiaomi-retry/report.md`.

---

## Post-fix artefacts

`results/ttft_4b_xiaomi/postfix/` — 1a_r1, 1a_r2, 1b_r1 (load-time miss), 1b_r2 (join), `timings.csv`. APK + sha in `sha_records.md`. Task report: scratchpad `agents/ttft-p0fix-measure/report.md`.

DONE
