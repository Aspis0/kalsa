# PLAN — one slot per device, non-unified, full window each

**Version 3.** Version 1 chose one resident slot plus a disk swap; version 2 chose unified
KV with a per-slot cap. Two hostile audits refuted both, the second one from this repo's
own committed runs. What survives is below, and it is deliberately smaller than either.
Nothing here is sent upstream.

## 1. The shape

**One slot per device, in the non-unified form: `--parallel N` with a pool of `N × window`.**
Every device's chat is resident and warm, and nobody's slot is ever cleared to make room
for somebody else's.

That last clause is the whole reason the form is not negotiable, and it is committed:

- Under unified KV the engine gains an idle-slot clearing path, hard-gated on the flag
  (`server-context.cpp:1671-1673`) and fired as the retry after *"failed to find free space
  in the KV cache"* (`:3980`). Its pressure valve is another device's warm slot.
  Measured: the unified four-phone run had **2 cold turns of 8 (TTFT 2.54 s against
  0.32 s warm)** where the non-unified run had **0 of 8** (`MULTI-DEVICE-SHAPE.md:34-35`,
  `57`, `61-63`), and the recommendation it produced is explicit — *"keep `kv_unified` out
  of the launch"* (`§8.1`).
- The saving that would buy is **33.5 MiB at four slots** (`§7`: unified SWA pool
  189.66 MiB against 223.12 MiB replicated). Buying a 33.5 MiB saving with a measured
  cold-turn regression on the thing the plan promises is not a trade, it is a mistake.
- Under unified the per-slot cap is also **conditional**: `n_ctx_slot()` is
  `min(llama_n_ctx_seq, kv_unified_per_slot, n_ctx_train)` (`server-context.cpp:4276-4283`),
  so the cap binds only when the pool is at least `N × cap`; otherwise the engine warns
  that *"cap has no effect, slots are limited to …"* and every slot believes it owns the
  pool, which is how two 14.7k prompts racing for 16 384 cells ended with one of them
  **cut mid-generation at 2 200 tokens** (`MULTI-DEVICE-SHAPE.md:163`). If unified is ever
  revisited, that invariant is its precondition, not a detail.

**What one extra device costs, correctly derived:** the sliding-window layers replicate per
stream, `55.78 MiB` each — `§7`'s `+167.34 MiB` is `55.78 × 3` for four slots. Version 2
divided by four and printed 42; the marginal figure is **55.78 MiB per device**, and it is
the number the panel should carry.

**The window per device** under this form is `pool / N`, from the launcher's own arithmetic.
With three devices and a 64k pool that is ~21k each; with one device it is the whole pool.
The two numbers trade, and the panel must show both — that is the honest answer to "how many
seats, and how big is each".

## 2. What is not settled, and must be measured before anything is promised

1. **What two devices talking at once costs, per stream.** The only committed solo figure is
   **62.7 tokens/s at context 4096** (`WHAT-IS-MISSING.md:337`). The paired figure is *not*
   committed anywhere: `dev/results/multi-device-shape/*/results.json` records prefill rates
   only, and this repo deliberately does not commit server logs
   (`MULTI-DEVICE-SHAPE.md:243-246`). The number that would go in the panel — "each device
   keeps X % of its speed when you both talk" — **does not exist yet**, and version 2's
   39 % was a ratio between two different runs at two different decode lengths. Task 1 below
   produces it and commits a stripped artifact so anyone can check it.
2. **Whether a chat switch comes back warm without `--swa-full`.** Two committed
   experiments disagree: the paging spike's single-slot run reports `n_restored=613` and
   then `cached=0` — *"paging gives nothing back"* (`dev/results/kv-paging-spike/summary.md`)
   — while the shape run's switch-back at ~2k restored **1862 of 1867 tokens for −2 ms** on
   the same build with the same default. The switch path is real traffic: the door names the
   slot on every request, but the cache logic still runs — `server-context.cpp:1564`
   (*"if a specific slot is requested, use it (still goes through cache update logic
   below)"*) and `:1625` sets `update_cache` whenever the prompt shares less than half the
   slot's content, which is exactly a chat switch. So the steady-conversation warmth this
   plan promises rests on a path whose behaviour is **contradicted by the record**, and the
   answer decides whether `--swa-full` is a launch flag or a disk-tier detail.

## 3. The tasks, in order

1. **Measure the two things above, and commit stripped artifacts.** A two-device
   back-to-back run on the pinned model recording per-stream decode rates alone and
   together, and a chat-switch run with and without `--swa-full` on a sliding-window model.
   Stripped of prompts and completions, as this repo already does. Nothing in the panel
   may print a number before this exists.
2. **Re-audit the five launch gates** in `crates/kalsa-launch/src/args.rs:79-126` before
   treating any of them as work. Their real state today: gate 1 (the engine carries the
   inlet) is **closed** on this platform; gate 4 (`funded_context` per slot) is **closed in
   code** — `policy.rs:196` takes the slot count and a committed test pins
   `preview == maximum / slots` for N = 1..=8 — but still **declared open** in the list;
   gate 2 is **half closed**, the per-slot KV term is in place while the per-token figure is
   still the conservative 96 KiB/token and Gemma 4 E2B is unpriced; gate 3 (the prompt-cache
   roof) is **open** and slot-blind (`policy.rs:467-477`); gate 5 (the panel's grid, which
   must step in `256 × N` multiples) is **open**. Four real streams of work, one of them UI,
   one an arithmetic replacement — each with its own acceptance test, not one sentence.
3. **Make the panel true**: the resident count, the window each device gets under this form,
   the **55.78 MiB** an extra resident costs, and the measured concurrency figure from task
   1. The **disk** figure stays absent and the plan says so out loud: the disk tier is
   deferred (§4), and until it lands the panel says nothing about disk rather than a number
   without a mechanism.
4. **The isolation test the household rules already mandate**, under this shape: device A
   sends a prompt carrying a unique marker, device B sends a prompt sharing a long identical
   preamble; assert that B's answer never carries A's marker and that B's reused tokens never
   exceed the true shared prefix. Keep the `id_slot` wrap probe
   (`server-context.cpp:1533`, deliberate upstream, unreachable through the door) in it.

## 4. The lifecycle the earlier versions ignored

- **A device forgotten while it holds a slot.** Enrollment shrinks, the count the launch was
  sized for does not. The door already prunes the device and frees its slot; say what
  happens to the *number* the engine was launched with, and whether the freed seat is
  reusable before a relaunch.
- **A model change while devices are attached.** Committed: it *"destroys every slot and
  every prompt cache in the house"* (`MULTI-DEVICE-SHAPE.md:171-192`), with an explicit
  product rule — a phone must never trigger it while other devices are attached. The plan
  inherits that rule into a task.
- **A second chat on the same device** is cold under this shape: the isolation unit is the
  device, and the second chat takes the slot. That is honest and it is the reason the disk
  tier exists; the panel should not imply otherwise.
- **The prompt cache is "up to" 6 GiB**, not 6 GiB: `min(leftover / 4, 96 KiB × 32768 × 2)`
  (`policy.rs:467-477`), machine-dependent. And under pinned slots it is **not** bypassed —
  it runs at chat switches, which is where its state matters.

## 5. The disk tier, later and much smaller

Only for what RAM cannot do: surviving a restart and the idle unload
(`--sleep-idle-seconds 300` destroys the contexts), and holding more than the prompt cache
can. As its own plan, with `--swa-full` (or a guaranteed checkpoint per save) as a
**tested** precondition, the save/restore pair under the door's slot-exclusive lease so two
devices cannot interleave into each other's files, the resident map invalidated when the
engine's generation changes (the supervisor already learns of sleeps,
`kalsa-supervisor/src/child.rs:32-43`), the cache salt both in the file and on the restore
call, a sweep for a revoked device's files, per-device encryption plus a backup decision,
and a disk figure taken from each model's own geometry — linear in context for the
full-attention layers and **saturating** for the sliding-window ones.

## 6. Rules this plan obeys

- **Nothing goes upstream.** No PRs, issues, comments, reviews, patches or discussion.
  Upstream is read, never written.
- The checkpoint appendix that follows someone else's design stays credited in the code.
- **No number reaches the user interface before it is committed in a stripped artifact.**
  This is what killed versions 1 and 2, and it is now a rule of this plan.
- No secret value in code, tests, logs or error strings.
