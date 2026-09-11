# Copy sheet Jelly evidence — 2026-09-10/11

**Verdict (scoped): PASS** on APK CI `34544351697` / app `c906727`.

| Item | Value |
|---|---|
| APK SHA-256 | `1a47fff2c5f75dd2c8929cb75ec3e06b9d68f0124642987167c54c13154f4298` (local == installed) |
| Device | Jelly `JELLYS0000053795` only |
| Install | `adb install -r` Success; `lastUpdateTime` 2026-09-10 20:32:37 |

## Observed

1. After install, header `LFM2.5 2.6B · QAD-Q4_0 · Pronto · locale`. Assistant bubble non-empty (Italian coffee sentence).
2. Tap Altro (bounds `[357,366][452,406]`, script tap `404 386`).
3. Altro sheet listed **Copia** (`content-desc`/`text`, bounds `[19,462][461,536]`), plus Salva nelle note, Traduci, Rigenera, Annulla.
4. Sheet header: `Tieni premuto per copiare, tradurre o salvare nelle note`.
5. Oneshot verdict `PASS` (`has_copy: true`, `sheet: true`).

This is the invert fix (`sheetCopyVisible`): Copy is reachable for non-empty assistant text. Decode-EMA 3-sample withhold is in this APK but was **not** device-measured here (would need a send + budget log). No MiniCPM5, no Xiaomi, no S23, no uninstall.

Evidence: `scratchpad/agents/product-suite/COPY-SHEET-EVIDENCE-2026-09-10/`
