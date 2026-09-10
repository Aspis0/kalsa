# Model-switch after stop — Jelly evidence — 2026-09-10

**Verdict (scoped): PASS** on APK CI `34539915778` / app `1807aad`.
UI did **not** freeze on "checking". LFM disposed and Qwen became the selected model in ~2 s.

| Item | Value |
|---|---|
| APK SHA-256 | `9c03c710655e607ac2181063c589a507c1084de8adbe16a4fd4e2a50c6213693` |
| Device | Jelly `JELLYS0000053795` only |
| Switch | LFM2.5 2.6B → Qwen 3.5 4B (already on disk). **Not** MiniCPM5. |

## Observed

1. After Regenera, LFM header was `Pronto`. Settings → chat models → Qwen **Seleziona** at 19:53:17Z.
2. Native unload: `detach_threadpool`, `~llama_context`, `KALSA_SESSION save` 141 ms.
3. No `model switch dispose timed out` line (native FIFO was empty; the hang path was not forced).
4. Pref `kalsa.model.id=qwen3.5-4b`. Header after back: `Qwen 3.5 4B · Q4_K_M · Tocca per ricaricare` — not "checking".
5. Settled in 2 s (`verdict.txt` PASS).
6. Active model pref restored to `lfm2.5-2.6b` after the shot (`force-stop` + sql_write). App left stopped.

This proves idle dispose is bounded and the UI unlocks. It does **not** prove the hung-FIFO timeout copy (that needs a native completion that never settles).

Evidence: `scratchpad/agents/product-suite/MODEL-SWITCH-EVIDENCE-2026-09-10/`
