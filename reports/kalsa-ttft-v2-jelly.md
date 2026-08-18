# kalsa-ttft-v2-jelly

**Mandato:** `mandates/kalsa-ttft-fixes-v2.md`
**Branch:** `fix/ttft-v2` @ `493336b` (from main `c407299`)
**Device:** Jelly Star · 192.168.1.82:44395 · Qwen 3.5 2B Q4_K_M
**APK:** worktree `C:\wt-ttft-v2` · minSdk 33 local-only (main catalog is 35) · JS entry `index.js` (node_modules junction otherwise bundles ai-chat main)
**Power:** 1a/1b/3 **PLUGGED**. S3 later **UNPLUGGED** 72% 38 °C.
**S23:** not touched.

---

## Verdict

**1a PASS (1.40 s).** `engine.eagerInit` fires. After 40 s prewarm, first send reuses **1276/1293** tokens. Gate was ≤ 8 s.

**1b PASS (39.5 s), honest.** Send during prewarm joins the FIFO; remaining prewarm + 3.1 s delta. Strictly < 53 s.

**3 PASS (2.48 s).** Same shape as 1a. `KALSA_KVDIAG n_past:0` as expected until Q6.c.

**2 PARTIAL.** 25-turn in-process send lost (process died after unplug). Recovery send reused 1276/1456 — not a full-window re-prefill.

v1 S1 was 53.4 s. v2 1a is **1.4 s**. The 47 s moved off the tap onto boot prewarm.

---

## Numbers

| # | Gate | Measured | Detail |
|---|---|---|---|
| 1a | eager log; TTFT ≤ 8 s | **1.40 s** | eagerInit 21:02:22; prewarm done 40.1 s; `reusing 1276/1293` |
| 1b | TTFT < 53 s = remaining prewarm + delta | **39.5 s** | mark 21:04:55 mid-prewarm; done 21:05:33; send `promptMs` 3056 |
| 2 | no full re-prefill at window edge | **PARTIAL** | process died; see below |
| 3 | same as 1a; KVDIAG n_past=0 | **2.48 s** | KVDIAG `n_past:0 ok:false`; prewarm 40.2 s; `reusing 1276/1313` |

v1 S1 reference: 53.4 / 53.7 s (6.6 s load + 47 s prefill, n_past=0).

---

## What landed (`fix/ttft-v2`, not pushed)

| Commit | Item |
|---|---|
| 755d549 + ad034b2 | V2-0.1 facts-tail + bake rematch |
| e65a5ee | V2-0.2 disk-gate used tokens |
| — | V2-0.3 P1-3/P1-4 **skipped** (cherry-pick conflict vs `cc8ed55`) |
| 28040e6 | V2-1 one-shot eager (`console.log engine.eagerInit`) |
| 7470c92 … 203bd2f | V2-2 prewarm + join; hybrid restore does not skip; Qwen jinja needs a one-char user |
| e517b36 | V2-3 compaction default ON + explicit-choice marker |
| d1e78cf + 493336b | V2-4 KVDIAG + docs |

Keepalive **not** shipped.

---

## Prewarm reality

System-only `completion()` does **not** format on this Qwen template (`Prompt is required` / jinja parser fail). Prewarm sends `[system, user: "."]` + `n_predict: 0`. Prefix-match still covers the ~1276 system+tool tokens; the real user line is the delta.

---

## S3 honesty

Runner S3 after 24 warms returned no telemetry (phone unplugged, process dying). Immediate follow-up send: new `KALSA_PREWARM` (process had restarted) then `reusing 1276/1456`. That is 1a-shaped, not an in-process window-edge. Do not cite 67 s / 17 s as the compaction number.

---

## Next

- Q6.c still out of scope (hybrid `.kvs` → n_past=0).
- Re-run S3 **PLUGGED**, no HOME, in-process only, if you want a clean window-edge number.
- Push `fix/ttft-v2` when you want it on the remote.

DONE
