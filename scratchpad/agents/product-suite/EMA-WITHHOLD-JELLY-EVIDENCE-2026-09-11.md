# Decode EMA withhold Jelly evidence — 2026-09-11

**Verdict (scoped): PASS** on APK CI `34544351697` / app `c906727`.

| Item | Value |
|---|---|
| APK SHA-256 | `1a47fff2c5f75dd2c8929cb75ec3e06b9d68f0124642987167c54c13154f4298` (same install as Copy shot) |
| Device | Jelly `JELLYS0000053795` only |
| Process | `am force-stop` then launch (in-memory EMA reset) |

## Observed

1. Header Pronto, LFM resident. Share-send `Dimmi solo la parola: ciao.`
2. `KALSA_THINKING {"turnId":"1","budget":512,"decodeTokPerSec":null}` at `20:46:46.393` (pid 14192).
3. Turn completed `interrupted:false`, `tokensPredicted:218`, `predictedPerSecond:6.48`.
4. That 6.48 tok/s is **above** the 5 tok/s extended-thinking threshold. Without the 3-sample withhold, the next send would have been able to take budget 1024. This send stayed 512 because EMA was unpublished (`null`).

No MiniCPM5, no Xiaomi, no S23, no uninstall.

Evidence: `scratchpad/agents/product-suite/EMA-WITHHOLD-EVIDENCE-2026-09-11/`
