# S23 cb1d92d — bake A + background unload B — 2026-09-12

S23 only `adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp` SM-S911U/dm1q. `adb install -r`. No stayon true. No keepawake_begin. No 24h timeout. No file deletes. Not G2.

## SHA — PASS

```text
local_sha256=4a87fc1e9f9ace45966af6bc923bbb70f8cf8b7f75ee76a0325ab3f0a1b7c396
installed_sha256=4a87fc1e9f9ace45966af6bc923bbb70f8cf8b7f75ee76a0325ab3f0a1b7c396
hash_match=true
```

Battery 100% 30.1°C → 36.4°C, thermal 0→1. `stay_on_while_plugged_in=0` before and after. `screen_off_timeout=null` before and after (not 86400000). `stayon false` WARNING (never set true).

## A bake facts-diverge — PASS (window_slide then n_common≈embd)

Load of `conv-g1-i14` **2357** tokens ok. Screen off (`timeout=null`) unloaded the engine before the first tap. On re-send:

```text
08:58:08 KALSA_SESSION load ok:true tokens:2357 stem=...conv-g1-i14...
09:01:06 KALSA_SESSION {"op":"window_align","from":4,"to":0}
09:01:06 KALSA_THINKING {...,"contextMode":"ciswire"}
09:01:06 KALSA_SESSION {"op":"window_slide","kvCleared":true}
09:01:06 KALSA_KVPREFIX embd=0 text_tokens=2668 n_common=0
```

No first-user/facts `KVDIVERGE`. One-turn `window_slide` then `n_common=0` ≈ `embd=0` (honest cold after heal). Not the c7801f9 `1941` vs `2357` stuck mismatch.

## B background unload — PASS

Not mid-stream (no send yet). Screen off after restore:

```text
08:57:43 background.grace {"timer":"native"}
08:58:08 load ok tokens:2357
08:58:44 model.unload {"reason":"background","graceMs":45000}
```

No `skipped: inFlight`. Dedicated HOME-after-telemetry was not reached (`got_tel=0` on the second pass after historyHash mismatch). Second `model.unload` at `09:01:58` was during generate — not used as B.

| check | verdict |
|---|---|
| SHA | **PASS** |
| stayon/timeout after | **0 / null** |
| A bake | **PASS** (`window_slide` + n_common≈embd=0) |
| B unload | **PASS** (`reason:background`, `graceMs:45000`) |
