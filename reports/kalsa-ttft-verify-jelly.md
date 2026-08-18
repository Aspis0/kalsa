# kalsa-ttft-verify-jelly

**Mandato:** TTFT load-policy BEFORE/AFTER matrix on the worst phone.
**Device:** Unihertz Jelly Star · mt6789 / Helio G99 · Android 13 · 7.78 GiB MemTotal · wireless adb `192.168.1.82:44395`
**App:** `com.kalsa.app` 0.1.0 / minSdk 33 · AFTER APK `kalsa-ttft-fixed-56464da.apk` sha `398050591036bf66802520bbea1024a953624bc586ae29ca0c72045f9e72503a` · installed 2026-08-13 17:53
**Branch measured:** `fix/ttft-load-policy` @ `56464da` (JS flags). Native `loadPrompt` warning at line 462 — **unpatched**.
**Model:** Qwen 3.5 2B Q4_K_M (in-app catalog) · hybrid · decode 2 / prefill 8 threads (G99 preset)
**Power:** PLUGGED AC · level 100% · 29–37 °C. Absolute numbers are PLUGGED. Relative A/B is the deliverable; BEFORE APK was not built (see caveats).
**Artefacts:** `results/ttft_verify_jelly/`
**Finestra:** 2026-08-13 17:53 → 23:10 local · STATUS **DONE** (AFTER only; S4/S5 not run)
**Branch fate:** `fix/ttft-load-policy` **cancelled** after this matrix — total fail, not shipped.
**S23:** not touched.

---

## Verdict (one line)

S3 AFTER (in-process, window edge) **16.7 s** (compaction stored OFF) / **1.8 s prefill** on the next turn after a full rebuild — **overall FAIL** for product TTFT: S1 AFTER is still **53.4 / 53.7 s** = 6.6 s `initLlama` + ~47 s full prefill of the ~1.3k-token system/tool prompt, because eager never called `initLlama` and hybrid session restore reports `ok:true` with `n_past=0`.

---

## The 53 seconds (S1 AFTER)

Not a policy delay. The whole cold path is still on the send. Jelly, pid 9972 / sibling colds tonight:

| Piece | Time | What |
|---|---|---|
| `initLlama` / `loadModel` | 6.6 s | 19:08:53.898 → 19:09:00.487 |
| `KALSA_SESSION load` | 38 ms | `ok:true`, 1635 tokens (when a `.kvs` exists) |
| native immediately after | 0 tokens reused | `n_past=0`, `embd.size=1413` |
| prefill | ~47 s / ~1318–1413 tok | ≈ 28 tok/s |
| **TTFT S1** | **53.4 / 53.7 s** | 6.6 + 47 |
| S2 (5 min home) | 51.9 s | same cold |

Split: **~12% load, ~88% prefill**. The JS flags removed neither from the first send.

Same process, next turn (engine already resident):

```
restored state checkpoint: reusing 1407/1436 prompt tokens
promptMs: 1793
predictedPerSecond: 7.86
```

In RAM, prefix-match works. Cold, it does not.

MemAvailable idle (Kalsa dead): 5.53 GiB. After 2B resident: leftover ~2799 MiB. Fit estimate non-evictable ~1421 MiB. This is not `does_not_fit`. The leftover gate does not explain the eager miss.

---

## 6-row matrix

Measurement: `TTFT_MARK` (adb) + first `KALSA_TELEMETRY` after the mark (`ttft_ms ≈ telemetry_ts − predictedMs`). `{"event":"ttft"}` did not appear. Same method every cell. `promptMs` is the engine prefill clock.

| # | Scenario | Fix | BEFORE | AFTER r1 | AFTER r2 | Verdict |
|---|---|---|---|---|---|---|
| 1 | Cold launch → send | P0-2 | **not built** (expected ≈ AFTER) | 53437 ms (`promptMs` 47032) | 53740 ms (`promptMs` 46860) | **FAIL** |
| 2 | Background 5 min → send | P0-1 | not built | 51946 ms (`promptMs` 45412, `predictedMs` 0) | — | **FAIL** |
| 3 | 25-msg → send at window edge | P0-3 | not built | 16683 ms (`promptMs` 16251, 1610 tok) compaction **stored OFF** | 2191 ms (`promptMs` 1793, 1446 tok) after a full rebuild, compaction toggled ON | **PARTIAL** (in-process only) |
| 4 | Memory ON, turn after extract | P1-1 | — | not run | — | **NOT RUN** |
| 5 | Web-search turn, then next | P1-3 | — | not run | — | **NOT RUN** |
| 6 | Swipe-kill → relaunch → send | P1-2 / P1-4 | not built | 76358 ms (`promptMs` 67534); `load ok:true tokens:1610` then full prefill | — | **FAIL** as TTFT; save/load JS **PASS** |

S1 r1 also has an earlier “send 18 s after launch” twin: 51530 ms. Same cold. Chip never left `Tocca per ricaricare`. RAM stayed ~5.5 GiB until the tap.

---

## Per-fix

### P0-2 eager init — FAIL

Waited 70 s. Chip stuck. RAM stuck. `initLlama` did not start. `model.fit` logged `tight` at ~5570 MiB — allowed (`eagerFitAllowsInit` skips only `does_not_fit`).

Boot kick:

```ts
if (!EAGER_ENGINE_INIT || !modelPrefReady) return;
InteractionManager.runAfterInteractions(() => {
  void kickEagerEngineInit(model, generation);
});
```

`kickEagerEngineInit` is closed over `ensureEngineForModel` → `[locale, t, ...]`. Re-renders at boot cancel the `runAfterInteractions` handle. `console.info("engine.eagerInit", …)` never appeared. `pressure.transition` is the same `console.info` and **does** appear — so if the kick had reached `ensureEngineForModel`, the line would be in logcat. It is not.

Send bypasses leftover: `if (!getActiveModelId()) return { ok: true }` then `gateForModel` uses the process-lifetime cached profile. Two doors. Send’s door is open. Eager’s is not. The 6.6 s stay on the tap.

### P0-1 keepalive — FAIL on this phone

After 5 min home (and between cells): `Force stopping` / `Killing` / new `Start proc`. Keepalive is an `AppState` `if` inside a live process. Dead process = dead engine. 51.9 s = 6.6 + prefill again. Leftover 2799 MiB would not trip `shouldEvictResidentEngine`.

### P1-2 disk gate — writes. Does not deliver TTFT

Save is real: `KALSA_SESSION {"op":"save","ok":true,"tokens":1446,"hash":"…","ms":110}`.

Then cold:

```
KALSA_SESSION {"op":"load","ms":38,"ok":true,"tokens":1635}
W/RNLlama: loadPrompt:462 no usable state checkpoint (recurrent/hybrid/SWA model), doing full cache clear
loadPrompt: n_past=0, embd.size=1413, num_prompt_tokens=1413
```

JS thinks 1635 tokens came back. Native wipes. Qwen 3.5 is `hybrid: true`. `loadSession` is not a checkpoint `loadPrompt` will reuse: `llama_memory_seq_rm` fails, `state_checkpoints` in the new process is empty, full clear. Same class as `patches/llama.rn+0.12.8.patch` (Xiaomi 14 / CI 31293842336: `ok:true` and `n_past=0`). Mandate parked Q6.c out of scope. Line 462 is unpatched. No `KALSA_KVDIAG`. 1635 tokens on disk = 0 on the first generate.

`no_meta` / `meta_mismatch` is the other JS branch (no file, or persist race after kill). Even when JS load passes, native throws the KV away. The 47 s stay.

1318–1413 tokens on message 1 with an empty chat UI = system + tool schema + template, not “one user line”. ~28 tok/s × 1413 ≈ 50 s. Hardware. The only way not to pay it is reuse. Cold reuse does not happen.

### P0-3 compaction — PARTIAL

Fresh-install default-ON did **not** apply: this package had a stored `"0"` from the previous install. First S3 ran with the switch **OFF** (16.7 s in-process at turn 26, 1610 tok). After an explicit toggle + a full rebuild, the next turn was 1.8 s prefill / 1407 of 1436 reused. That is llama.rn prefix-match in a live process, not a cold win. Compaction does not help S1.

### P1-1 / P1-3 — NOT RUN

Irrelevant to product TTFT until cold stops re-prefilling the whole system prompt.

### P1-5 TTFT debug line — not usable

`{"event":"ttft"}` never showed. `KALSA_TELEMETRY.promptMs` + RNLlama `loadModel` are the clocks that exist.

---

## Promise vs measured

Doc: *message 1 should start at prefill or warm restore, not `initLlama` on send.*

AFTER `56464da`:

1. Eager never calls `initLlama` → send pays 6.6 s load.
2. Disk save yes; native hybrid restore no → send pays ~47 s prefill of 1.3 k tokens.
3. Home 5 min / force-stop kills the process → P0-1 does not exist.
4. Sum: ~53 s. Same as an AFTER that never touched the load path.

Delivered: `.kvs` files, compaction default-on **if the key is missing**, keepalive-if-the-process-lives, half a log. Not TTFT.

The minute is not “2B decode is slow” (decode tonight 7.9 tok/s on 9 tokens = 1.1 s). Every cold = mmap 6–7 s + full system/tool prefill, because eager does not start and a hybrid session is not a checkpoint. **Q6.c, left out of scope, is 88% of the number.**

---

## Method / harness notes (so nobody repeats them)

- Gboard swallows `adb input text`. Disable IME for the matrix; re-enable after. Re-enabled 2026-08-13 23:xx.
- Release strips some `console.info`; do not wait for `{"event":"ttft"}`.
- Do not HOME before an S3 measure — HOME is S2.
- `logcat -c` after a warmup or the parser reads the warmup `promptMs`.
- First S2 row `-449056 ms` is that parser bug; discarded (`S2_r1_invalid`).
- Screenshot chip / launcher overlay can steal uiautomator dumps.

---

## What to fix next

1. **Q6.c / hybrid checkpoint** — until `loadPrompt` can reuse a hybrid/SWA `.kvs`, P1-2 is a disk write with no TTFT. This is the 47 s.
2. **P0-2 kick** — stop cancelling `runAfterInteractions` on boot re-renders; prove `engine.eagerInit` in logcat; then S1 should be prefill-only (~47 s still, unless (1) lands).
3. **P0-1** on OEM-kill phones is not an `AppState` flag. Do not sell keepalive as a Jelly win.
4. Do not build a BEFORE APK to A/B S1 until (1)+(2) move. The AFTER already *is* the old cold path.

---

## Shas / power

| | |
|--|--|
| AFTER APK | `398050591036bf66802520bbea1024a953624bc586ae29ca0c72045f9e72503a` |
| commit claimed | `56464da` |
| power | AC=true · 100% · 29–37 °C · **PLUGGED** |
| runner | `scripts/ttft_jelly_runner.py` |
