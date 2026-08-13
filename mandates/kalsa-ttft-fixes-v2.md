# KALSA TTFT FIXES v2 — fresh from main; v1 failed verification and is archived

History: a first attempt (`fix/ttft-load-policy` @ 56464da) FAILED on-device
verification — S1 cold TTFT 53.4 s, identical to the old cold path
(`C:\Users\gualt\Desktop\Kalsa\moe-experiments\reports\kalsa-ttft-verify-jelly.md`
— READ IT FIRST, END TO END). The branch was deleted; its commits survive as
READ-ONLY tag `archive/ttft-v1-56464da` in the app repo. Use it only to read
diffs (what was tried, which flags/keys were named); do NOT continue it, do NOT
blind cherry-pick — main has moved 9 commits since its base.

Work in `C:\Users\gualt\Desktop\Kalsa\ai-chat`. Create NEW branch **`fix/ttft-v2`**
from current main (c407299). Small commits, English, each referencing the verify
finding it addresses.

MAIN OVERLAP WARNING: main has since landed KV/prefix-touching work you must
build on, not fight: `cc8ed55` (invalidate KV on conversation switch + migrate
hardening) and `39bf585` (user personas on the format-B tail). Read both diffs
before touching anything in the prompt-render or session path.

## The measured anatomy of the 53 s (Jelly, Qwen3.5-2B hybrid)

- 6.6 s `initLlama` — eager init never fired in v1 (its boot kick sat in
  `InteractionManager.runAfterInteractions` inside an effect closed over
  volatile deps; boot re-renders cancelled the handle; `engine.eagerInit`
  never appeared in logcat). That is the trap to avoid, not the design to copy.
- ~47 s prefill of the ~1.3-1.4k-token system/tool prompt at 28 tok/s — the
  hybrid `.kvs` restore is wiped natively (`loadPrompt:462`, `n_past=0` despite
  JS `ok:true tokens:1635`). Engine hole Q6.c — OUT OF SCOPE for the app repo.
- PROVEN WORKING: in-process prefix reuse — turn 2 reused 1407/1436 tokens,
  prefill 1.8 s. This is the lever v2 builds on.

## V2-0 — salvage from v1 (tag `archive/ttft-v1-56464da`), re-landed on main

Re-implement (or carefully re-apply, resolving against main) ONLY these, in
this order, each as its own commit:
1. **P1-1 memory-facts-tail** (`ff2cc63`) — facts ride the format-B tail, never
   the system block. REQUIRED: V2-2's prewarm needs a byte-stable system prefix.
   Reconcile with `39bf585` (personas already ride the tail on main).
2. P1-2 disk-gate-used-tokens (`d8c5896`) — harmless, keeps `.kvs` saves alive
   on low-storage phones for the day Q6.c lands.
3. P1-3 persist-tool-blocks (`ec49d26` + `706b8b0`) and P1-4
   boot-hash-on-switch (`fe4ec9b`) — only if they apply cleanly against main's
   `cc8ed55`; if not, note it and skip (they do not move message-1 TTFT).
4. P1-5 staged progress labels (`c81963a`) — nice-to-have, last.

## V2-1 — eager engine init that ACTUALLY runs

Implement on main: at boot, if the selected model is downloaded and fits, kick
`ensureEngineForModel` in the background. The kick must be one-shot per process
(ref/module-level guard), NOT scheduled through a cancellable handle tied to
volatile effect deps; cancellable only on real model switch. Flag
`EAGER_ENGINE_INIT` (default ON).
ACCEPTANCE: `engine.eagerInit` (or equivalent guaranteed-in-Release log) visible
in logcat on a cold Release launch on Jelly; `initLlama` completes before any
user tap; no UI-thread jank regression.

## V2-2 — the strategic fix: boot-time PREWARM of the static system prefix

Q6.c means cold KV restore is dead until the engine track lands. But the
system/tool prompt is STATIC per (model, settings) and in-process prefix reuse
works. So: after eager init completes, run ONE background prefill of the
byte-exact system/tool prefix (the same bytes message 1 would render), stop
before any user content, leave the KV hot.

- Message 1 then pays: delta prefill (user line) + decode. Jelly ~2-4 s
  instead of 53; S23-class near-instant.
- If the user sends BEFORE the prewarm finishes: the send must JOIN the running
  prewarm (queue on the same engine, continue from current n_past), never
  restart. TTFT = max(0, remaining prewarm) + delta — strictly better than
  today at every send time.
- Byte-stability contract: prewarmed prefix hash == message-1 rendered prefix
  hash (debug assert; on mismatch log `KALSA_PREWARM {"match":false}` and fall
  through — correctness over speed). Facts, personas, digest must ALL ride the
  format-B tail (V2-0.1 + main's 39bf585), never the system block.
- Cancel + redo on model switch or any settings change that alters the prefix.
- Flag `EAGER_PREFIX_PREWARM` (default ON).
- Battery honesty: ONE background prefill per process launch. No loops, no
  redo on foreground.

## V2-3 — compaction ON by default, INCLUDING upgraded installs

Main still defaults OFF (v1's flip died with the branch). Land the flip AND the
migration: honor OFF only if the user explicitly chose it in settings
(explicit-choice marker or versioned key; your call, document it).
ACCEPTANCE: fresh install ON; upgraded install with a residual stored "0" but
no explicit user choice ends up ON.

## V2-4 — stop selling what does not work

- Keepalive: on OEM-kill phones (Jelly force-stops in <5 min) an AppState flag
  cannot survive process death. If you land a keepalive flag, document the
  limitation in `docs/TTFT_FIXES.md`; no claim that it fixes S2 on aggressive
  OEMs. A foreground service is a product decision for gualt, NOT this branch.
- `.kvs` restore: keep saving (110 ms, harmless), but log reuse honestly:
  after load emit `KALSA_KVDIAG {"n_past":N,"tokens_on_disk":M}` so telemetry
  never again says ok:true while native reused 0.
- Q6.c (hybrid/SWA checkpoint in llama.rn `loadPrompt`) stays OUT OF SCOPE —
  engine track. Do not attempt it in the app repo.

## V2-5 (optional, only if trivial) — measure the prefix weight

Log token counts per block of the static prefix (system, tool schemas,
template). Report only — if tool schemas are hundreds of tokens and tools are
OFF, propose (do not implement) lazy schema injection.

## Verification (Jelly, same harness as the verify report)

Reuse `scripts/ttft_jelly_runner.py` + the method notes in the verify report
(IME off, logcat -c discipline, no HOME before S3). PLUGGED acceptable — the
deliverable is relative A/B on the same power state.

| # | Scenario | Gate |
|---|---|---|
| 1a | Cold launch, wait 90 s, send | eager log in logcat; TTFT ≤ 8 s |
| 1b | Cold launch, send immediately | TTFT < 53 s and = remaining prewarm + delta (report honestly) |
| 2 | 25-msg window edge, compaction ON via migration (no manual toggle) | no full re-prefill |
| 3 | Swipe-kill → relaunch → wait 90 s → send | same as 1a (prewarm covers it; KVDIAG logs n_past=0 — expected until Q6.c) |

## Deliverables

- Branch `fix/ttft-v2` + updated `docs/TTFT_FIXES.md` (v2 table + keepalive
  limitation + prewarm design note).
- Final summary with measured numbers per scenario, honest about 1b. End DONE.
