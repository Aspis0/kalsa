# Known issues

## P0 — memory guard blocks completion with the model already loaded (HyperOS flagships)

**Found:** 2026-08-14, Xiaomi 14 (HyperOS, SD8Gen3), Qwen3.5-4B Q4_K_M, APK `bea257e` (main + TTFT-v2).
**Evidence:** `moe-experiments/results/ttft_4b_xiaomi/manual_1a/logcat_send_oom.txt`.

Sequence (device timestamps):

1. Cold launch: `model.fit {"verdict":"tight","availableMb":5596}` → model loads fine,
   prewarm completes (`KALSA_PREWARM done`, 30-50 s, 1179 tok).
2. With the 2.7 GB model resident, HyperOS settles `MemAvailable` at ~2.1 GB
   (`pressure.transition {"availableMb":2079..2176}` every 15 s — this is normal on
   MIUI/HyperOS: the OS keeps the rest as reclaimable cache).
3. User taps Send → app shows **"not enough memory for this model"** and never calls
   the engine (no `loadPrompt`, nothing in logcat from RNLlama).

**Root cause (hypothesis, high confidence):** the send-path fit-check compares
`availableMb` (~2.1 GB) against the model footprint (~2.7 GB) **without checking that
the engine already holds this model** — the model's own resident bytes are what
lowered `availableMb`. Double-counting. The pre-load fit-check logic is being applied
where the load has already happened.

**Fix direction:** when `isEngineReady() && activeModelId === requested`, the
completion path must skip the size-vs-available check entirely (or check only the
incremental need: KV/compute buffers). Pre-load checks stay as they are.

## P1 — idle engine unload leaves zombie UI ("Ready" header, dead Send, silent JS)

Same session, ~10 min idle after a completed prewarm: app process alive but RSS
dropped 3 GB → 167 MB, header still "Qwen 3.5 4B · Ready · local", Send taps
produce **zero** ReactNativeJS logcat output, composer still accepts text.
Force-stop + relaunch recovers.

**RSS collapse is not a death signal.** llama.rn memory-maps the GGUF
(`LLAMA_LOAD_MODE_MMAP`) and `use_mlock: true` does not pin the model on Android
— but **not because the limit is small**, which is what this file said until
2026-08-22. Measured on the Jelly: `RLIMIT_MEMLOCK` is **unlimited**, for the
shell and for the app process, not the ≈64 KB claimed. mlock does take effect
(system `Mlocked` 4 912 → 215 932 kB under `--load-mode mlock`) and locks ~211 MB
— 3 000× the supposed ceiling, and still far short of the 1.67 GB model. The
conclusion survives; the reason for it was wrong, and it was load-bearing enough
that it made mlock look like a candidate cause of the 8B's lmkd death. It is not.
Under pressure the kernel evicts file-backed pages;
a live engine shows a large RSS drop by design. An RSS-vs-baseline probe
false-positives on that healthy-cold state, then a naked JS-wrapper null leaks
the still-live native context (llama.rn has no GC finalizer) and the recovery
reload double-allocates — an OOM on the exact device state that triggered the
reading.

**Code-level fix (2026-08-14, `fix/p1-idle-zombie`, revised after review):**
JS `isEngineReady()` was only `context !== null`. Send had no breadcrumb before
the busy-guard / first await, so a hung `completion()` against a stale JSI
handle (or a stuck `sendClaimRef`) produced zero logcat. Detection is now
**on-contact**: the send path's first native call is a bounded-timeout
`tokenize` ping (8 s). Timeout / native error → `markEngineLost` runs a
**bounded** release (`stopCompletion` + settled wait +
`DISPOSE_SAFETY_TIMEOUT_MS` → `contextHung` on timeout; never a naked null).
Foreground does **not** mark lost (chip kind recomputes from existing
`jsReady`). `recoverLost` / `blocked_ram` bypass is scoped to `lostModelId ===
model.id` and is cleared on load **failure** as well as success. Every send
attempt logs `KALSA_SEND`. The on-contact ping **always runs** when
JS-ready (tokenize is parallel-safe); a stuck background job
(prewarm/summary/extractMemory) cannot disable detection. Only a live
user-facing turn (`sendingInFlightRef`) suppresses the lost-**mark**.
Probe unavailable → alive (fail-safe). Sync `release()` throws set
`contextHung` (fail-safe: throw ⇒ hung ⇒ restart).

**UX follow-up (F4, deferred):** worst-case zombie send is probe 8 s +
stop/settled 60 s + release 60 s (~128 s) of dead air while
`sendClaimRef` is held but the composer is not in "sending" state.
Repeated taps are silently dropped (KALSA_SEND breadcrumb logs them).
Recovered, but invisible. Add a "detecting engine…" banner when the
probe returns `timeout`.

**On-device verify still required** (Xiaomi/HyperOS not in hand):
1. Cold load 4B, wait for prewarm done, confirm header Ready · local.
2. Idle ~10 min (or until RSS collapses 3 GB → ~200 MB). Confirm
   `pressure.transition` still ticks. Chip **stays Ready** — collapsed RSS
   alone must not flip the chip (mmap eviction).
3. Type + Send on a still-alive cold engine: one `KALSA_SEND` enter line,
   `phase:fit` with `liveness:alive` / `alreadyResident:true`, then a (possibly
   slow) completion — **no** reload, **not** "not enough memory".
4. True-zombie path (native handle actually dead): Send → `KALSA_SEND`,
   `liveness:lost` / `recoverLost:true` / `allow:true`, `engine.lost` with
   `reason: native_timeout` (or `native_error`), header leaves Ready, model
   reloads, completion happens. A **different** model must still hit the RAM
   gate.
5. Confirm a second send after recover still works (prewarm re-queued).
6. Failed reload must clear `recoverLost` (next Send of a too-large model
   refuses; the P0 gate is not stuck open).

## Note for automated testing on HyperOS

Synthetic `input tap` (deviceId=-1) is silently dropped by HyperOS unless
"USB debugging (Security settings)" is enabled in Developer options — physical taps
(deviceId=7) work. All three automation attempts tonight failed on this, not on app
code. Enable that toggle on test devices, or drive taps through uiautomator/Appium
with an accessibility channel.

## P2 — thinking is shown inside the real assistant answer (app bug, not campaign)

**Found:** 2026-08-26, Jelly Star, LFM2.5-2.6B QAD-Q4_0, campaign build `7c8cce7`.
**Observed during the CisWire device campaign** — the model's reasoning/thinking block
is being rendered inside the assistant "final answer" bubble rather than being
hidden/collapsed. The chat bubble shows what should be the internal reasoning as if it
were the answer to the user.

**Contradicts the app's own copy.** The Settings rationale text says (paraphrase):
"il ragionamento non viene mai mostrato in chat, solo la risposta finale" — but the
thinking is leaking into the visible reply.

**Why it matters:** a user sees raw chain-of-thought as if it were the answer, which is
wrong UX and also contradicts the stated privacy/UX contract.

**Fix direction:** the stream/render path is not stripping the thinking block before
committing the assistant message (or is emitting the thinking tokens into the same
message bubble as the answer). The `thinkStripper` / `streamCoalescer` boundary needs to
be verified to actually separate the reasoning from the final answer, and the final
message must exclude the thinking text. (Reference implementation by the place that
strips `<think>`/`<thinking>` — locate the exact gap during the fix.)

## P3 — "Sto scrivendo" shown while the model is still thinking (app bug, not campaign)

**Found:** 2026-08-26, Jelly Star, LFM2.5-2.6B QAD-Q4_0, campaign build `7c8cce7`.
**Observed during the CisWire device campaign** — while the model is in the
thinking/reasoning phase (which on this model is long), the UI shows a
"Sto scrivendo" typing indicator, implying the answer text is being produced when in
fact the model is still thinking. The composer/status state is set to "writing"
too early.

**Why it matters:** misleading — the user is told the assistant is producing output
when it has not started generating the final answer. With the 2.6B's slow, long
thinking phase (this is exactly why the campaign ignores speed), "Sto scrivendo" can
show for tens of seconds before any answer token is emitted.

**Fix direction:** the "typing/writing" status should reflect that the model is
*thinking* (a distinct "sto pensando…" state, or keep the status neutral) and only
show "sto scrivendo" once actual answer tokens are streaming. The thinking-phase vs
answer-phase transition needs a distinct UI state rather than mapping both to
"Sto scrivendo".
