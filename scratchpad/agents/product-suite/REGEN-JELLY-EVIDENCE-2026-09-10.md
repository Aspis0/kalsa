# Regenera Jelly evidence — 2026-09-10

**Verdict (scoped): PASS** on APK CI `34539915778` / app `1807aad`.

| Item | Value |
|---|---|
| APK SHA-256 | `9c03c710655e607ac2181063c589a507c1084de8adbe16a4fd4e2a50c6213693` (local == installed) |
| Device | Jelly `JELLYS0000053795` only |
| Install | `adb install -r` Success; `lastUpdateTime` 2026-09-10 19:41:20 |

## Observed

1. Assistant Altro sheet listed **Rigenera** (`content-desc`, bounds `[19,685][461,760]`). Copy absent on this APK (invert is `c906727`, not in `1807aad`).
2. Tap Rigenera → `KALSA_SEND regen:true regenPass:true` at 19:42:28, `alreadyResident:true`.
3. `KALSA_THINKING budget:512 decodeTokPerSec:null` (process restart; first-measure short).
4. Mid-stream persist: user `edited` **absent**, assistant `"The"` `interrupted:true`.
5. Completion: `KALSA_TELEMETRY turnId:1 interrupted:false predicted:340`; session save `messageCount:2 hash:1025249379`.
6. Live hist: user `"Dimmi solo la parola: ciao."` `edited=None`; assistant `"ciao"` not interrupted.

User bubble was **not** re-badged as edited. No MiniCPM5, no Xiaomi, no uninstall.

Evidence: `scratchpad/agents/product-suite/REGEN-EVIDENCE-2026-09-10/`
