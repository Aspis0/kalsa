# MULTI-DEVICE-SHAPE — one household, one server, which shape

Date: 2026-09-17 · Machine: Apple M1 Max, 64 GiB unified · Binary: the shipped
Kalsa Brain runtime `llama-server` 0.4.0-dev **b10950 (ad6c66839)**, Metal,
`runtime/builds/metal/llama-b10950/`. Model: `Trinity-Nano-Preview-Q4_K_M.gguf`
(3.79 GB, 56 layers = 14 full-attention + 42 sliding-window). Every server ran
the app's own argv shape (`crates/kalsa-launch/src/argv.rs`): threads 4/4,
batch 2048/ubatch 512, `-fa on`, KV q8_0/q8_0, `--no-webui`, `--cache-ram 384`,
`--sleep-idle-seconds 3600`, plus `--metrics` and `-lv 5`. Total `--ctx-size
16384` in **every** run; shapes: **A** `--parallel 1` (the app today), **B2**
`--parallel 2`, **B4** `--parallel 4`, **U** no flag (auto → 4 slots **and**
`kv_unified=true`, see §3). Simulated phones: 2 and 4 per run, each holding its
own 3-turn conversation — a ~1.9k-token context chunk re-sent every turn plus a
short question, ~72 generated tokens, phones overlapping in time. Harness:
`dev/simulate-phones.py`, `dev/run-multi-device-shape.sh`, `dev/measure-switch-cost.py`,
`dev/test-isolation.py`; raw numbers in `dev/results/multi-device-shape/`.

**The shape decision in one line:** explicit `-np N` gives per-slot KV caches
(`kv_unified='false'` in the load line); only the *auto* slot count turns on
`kv_unified`, and `try_clear_idle_slots()` acts **only** when `kv_unified` is
true (`server-context.cpp:1421-1434,1667-1684`). The 21× story is about the
second, gated mechanism — not about slot counts.

## 1. Household experience — wall clock and TTFT

| run | shape | phones | wall s | TTFT avg ms | TTFT max ms | max requests_deferred | max requests_processing |
|---|---|---:|---:|---:|---:|---:|---:|
| A-2p | `--parallel 1` | 2 | 6.96 | 1670 | 2455 | 1 | 1 |
| A-4p | `--parallel 1` | 4 | 17.79 | 4614 | 6197 | 3 | 1 |
| B2-2p | `--parallel 2` | 2 | 4.92 | 928 | 2222 | 0 | 2 |
| B2-4p | `--parallel 2` | 4 | 15.22 | 3173 | 4878 | 2 | 2 |
| B4-2p | `--parallel 4` | 2 | 4.89 | 924 | 2224 | 0 | 2 |
| B4-4p | `--parallel 4` | 4 | 9.71 | 1810 | 4519 | 0 | 4 |
| U-2p | auto (4 + unified) | 2 | 5.46 | 896 | 2174 | 0 | 2 |
| U-4p | auto (4 + unified) | 4 | 10.25 | 2334 | 4357 | 0 | 4 |

The queue is real and silent: with no slot free the task is deferred —
`SRV_DBG("no slot is available, defer task…")`, `queue_tasks.defer(…)`
(`server-context.cpp` ~2389) onto an **unbounded** `std::deque`
(`server-queue.h:24-26`) — and nothing tells the waiting phone. A-4p: three
people queue behind one slot; the last-served first token lands at **6.2 s**.

## 2. Warm context survival — does the 21× story still hold?

Median `cached_tokens/prompt_tokens` over each phone's non-first turns
(turn 0 is first contact; nothing to reuse), from `usage.prompt_tokens_details`:

| run | phones | median reuse | cold turns (cached ≤ 32) |
|---|---:|---:|---:|
| A-2p | 2 | 0.49 | 2/4 |
| A-4p | 4 | 0.00 | 8/8 |
| B2-2p | 2 | 0.98 | 0/4 |
| B2-4p | 4 | 0.00 | 7/8 |
| B4-2p | 2 | 0.98 | 0/4 |
| B4-4p | 4 | 0.97 | 0/8 |
| U-2p | 2 | 0.97 | 0/4 |
| U-4p | 4 | 0.98 | 2/8 |

Per-request `cached/prompt` by turn, 4-phone runs: in B4-4p every phone keeps
its slot and reuses ~1960 of ~2000 tokens every turn; in A-4p every single
turn pays the whole ~2k prefill; in U-4p two of eight turns went cold
(TTFT 2.54 s vs 0.32 s warm) with **zero** `purging slot` lines — the idle
slots were *saved to the prompt cache* (`--cache-ram 384`), not wiped.

**Answer to the 21× question: changed in b10950, and split in two.** The
single-slot thrash is real: A with 4 people = 0 % reuse everywhere. But "more
slots erase caches" did **not** reproduce: explicit `-np N` runs per-slot KV
with no idle-slot clearing at all (log: `kv_unified = 'false'`), and stays
warm (0.97–0.98). The purging mechanism exists only behind auto slots +
`kv_unified` + a non-zero `--cache-ram`, and at 2k-token conversations it
never fired; this build instead *restores context checkpoints* — B's cross-turn
reuse in the isolation runs came back as `restored context checkpoint
(pos_max = 80, n_tokens = 81)` rather than the 579-token theoretical prefix.

## 3. Isolation — one phone's context must never become another's

### (a) `id_slot` out of range wraps — confirmed, quoted, measured

`server-context.cpp:1519-1521`:

```c
server_slot * get_slot_by_id(int id_slot) {
    // note: allow id_slot to be out of bounds (wrap around)
    id_slot = id_slot % slots.size();
```

Test (`dev/test-isolation.py --np 2 --wrap`, 2 slots): device C fills slot 0
with a long conversation; device D sends a *different* conversation with
`id_slot=2`; the server log accepts it — `selected slot by id (2)` — and the
modulo lands it in slot 0, on top of C.

Measured: D reused **0** tokens of C's resident context (genuinely shared: 6)
and paid the full re-prefill (**331 ms** at ~600 tokens); C's follow-up was
**restored from the RAM prompt cache** (575 tokens, 63.9 ms re-prefill).
Correct and not a content leak — but two devices *did* silently co-locate, so
the wrap must be fixed to a range check: the cost is a surprise re-prefill and
a silently shared cache, for an id the server should have refused.

### (b) Prefix-cache cross-talk — green under both designs

A and B share a 579-token preamble (computed with `/tokenize`, not eyeballed;
B's prompt is 596 tokens total) and diverge in their tails. A's tail holds a
unique numeric marker; B's asks about a different fact.

| | np=1 | np=2 |
|---|---|---|
| B's cache reuse | 81 | 81 |
| bound: genuinely shared | 579 | 579 |
| A's marker in B's completion | no | no |
| B answered from its own tail | yes | yes |

Reuse (81) sits far **below** the shared prefix (579) because the server
restores conservative checkpoints instead of the full common prefix — the safe
direction. **Red first:** an upper-bound assert cannot be broken from below by
a correct server, so the red run injects a bound one token too tight
(`81 <= 81-1`, must fail) and runs the marker-absence check against A itself
(A carries the marker by construction). Both detectors went red with real exit
codes: np1 red exit 0 (red-confirmed), np2 red exit 0 (red-confirmed); the
green runs restore the true bounds and pass, exit 0. A run that has never been
red proves nothing; these were red first.

## 4. The per-person context floor

Same conversation shape, grown until it no longer fits the slot:

| run | slot size | conversation | outcome |
|---|---:|---:|---|
| CLIFF-B4 | 4096 | 3 878 tokens | served, reuse 0.99 — fits, cache survives |
| CLIFF2-B4 | 4096 | 4 225–4 367 tokens | **all 6 requests refused, HTTP 400**: `request (4225 tokens) exceeds the available context size (4096 tokens), try increasing it` |
| CLIFF2-A | 16384 | same conversation | served, but every turn a cold ~5 s re-prefill (§5) |

**Floor: 4 096 tokens per person.** A 4 096-token slot holds a ~3.9k-token
conversation warm; the moment the conversation needs one more turn, the server
refuses outright — it does not truncate silently. So the product may offer
4 096/person only with a visible refusal surface in the UI; per-person sizes
below 4 096 must not be offered at all. Note the budget: per-person context is
the total divided by people — 4 × 4 096 exactly exhausts the 16k total; four
people cannot each have 8 192 at this total context (and B2-4p shows four
phones rotating on two 8k slots anyway reuse nothing, 7/8 cold).

## 5. The cost of a switch, in seconds

Design A, one slot, two fixed same-size conversations A/B — sequence
A-warm → B (switch away) → A (switch back) — server-side `prompt_ms`
(queue-free), `n_predict 16` (`dev/measure-switch-cost.py`):

| accumulated conversation | warm return | switch-back | re-prefill paid | cached after switch-back |
|---|---:|---:|---:|---:|
| ~1 867 tok | 142 ms | 151 ms | **−2 ms (free)** | 1862/1867 — RAM prompt cache restored it |
| ~7 498 tok | 269 ms | 4 511 ms | **4 236 ms** | 0/7498 |
| ~14 703 tok | 305 ms | 9 620 ms | **9 304 ms** | 0/14703 |

The restore that makes the 2k switch free stops working somewhere below 4k
(CLIFF2-A: all six turns cold, ~4.8 s each; log: `making room for prompt cache
entry, removing oldest entry (size = 262.706 MiB)` — the 384 MiB roof evicts
the large states). Design B / unified eviction:

| accumulated | slots | measured |
|---|---|---|
| ~2k | B2, 4 phones on 2 slots | 7/8 turns cold; cold prefill ≈ **1.2 s** (1 615–1 706 tok/s) |
| ~7.3k | B2, 4 phones on 2 slots | **8/8 turns cold**, prefill 4.46–4.52 s each (8.6 s when two slots prefill at once) |
| ~16k | B2/B4 | **structurally impossible**: `n_ctx_slot = 8192/4096` — the conversation cannot exist |
| ~16k | U (unified pool) | two 14.7k prompts raced for 16 384 cells: one finished (prefill ~9.5 s, ~1 490 tok/s), the other was cut at 2 200 tokens |

**Turn-policy number:** a mid-size conversation switch costs 4–9 s of pure
re-prefill on A (and the same eviction cost exists in B with more phones than
slots); at ~2k it is free *if* the prompt cache restore holds. Serving same-
conversation prompts back-to-back before yielding is worth real seconds — at
16k accumulated, 9.3 s per avoidable switch.

## 6. Changing the model — the household rule

One model per process on our source: the task enum (`server-task.h:16-29`) has
no reload/switch type — `COMPLETION, EMBEDDING, RERANK, INFILL, CANCEL,
CONTROL, NEXT_RESPONSE, METRICS, SLOT_GET/SAVE/RESTORE/ERASE, GET/SET_LORA` —
and `/v1/models` is registered as a read (`server.cpp:252`). The router mode is
a separate process that "never loads a model and must not touch the GPU"
(`server.cpp:134-135`). **Switching == restarting the process.**

Measured (`dev/measure-model-switch.py`, both models warm in the page cache;
kill → start → health → first streamed token of the same ~2k question):

| switch | load | kill → first token | first-request cached_tokens | steady TTFT after |
|---|---:|---:|---:|---:|
| Trinity → gemma-4-12B | 2.5 s | **14.9 s** | 0 | 0.08 s |
| gemma-4-12B → Trinity | 1.0 s | **2.8 s** | 0 | 0.06 s |

A model switch destroys **every slot and every prompt cache in the house, for
everybody** — a new process starts from nothing, measured: `cached_tokens = 0`
on the first request in both directions. The UI must say "about 15 seconds
before anyone gets a first token" for the big model, and a phone must never be
allowed to trigger it while other devices are attached.

## 7. Memory at load — the servers' own lines

Quoted `llama_kv_cache` / `sched_reserve` lines (full sets per run in
`dev/results/multi-device-shape/*/memory.txt`; this build prints two contexts,
so compute lines appear twice — citation convention per
`COMPUTE-BUFFERS-DENSE.md` §6). No per-token constants anywhere:

| shape | full-attention KV (14 layers) | sliding-window KV (42 layers) | KV total | MTL0 compute |
|---|---|---|---:|---:|
| A, np=1 | 119.00 MiB (16 384 cells) | 55.78 MiB (2 560 cells) | **174.78 MiB** | 53.43 MiB |
| B2, np=2 | 119.00 MiB (8 192 cells × 2 seqs) | 111.56 MiB (2 560 × 2) | **230.56 MiB** | 45.99 MiB |
| B4, np=4 | 119.00 MiB (4 096 cells × 4 seqs) | 223.12 MiB (2 560 × 4) | **342.12 MiB** | 50.24 MiB |
| U, unified | 119.00 MiB (16 384 cells, 4/1 seqs) | 189.66 MiB (8 704 cells, 4/1) | **308.66 MiB** | 59.43 MiB |

The affine-KV finding bites here in a new way: the 14 full-attention layers
**divide** their pool by slot count (119.00 MiB in every shape), but the 42
sliding-window layers **replicate per slot** (55.78 → 111.56 → 223.12 MiB).
Four slots cost +167 MiB of KV over one slot for the same total context —
which is why per-token arithmetic would have missed it.

## 8. Answers

1. **Which design gives a household the better experience?** With one person,
   A: a single slot has no contention and keeps the whole context. From two
   people on, B already wins every measured axis that matters — at 2 people:
   wall 4.9 s vs 7.0 s, TTFT avg 0.93 s vs 1.67 s, reuse 0.98 vs 0.49; at 4
   people it is not close: wall 9.7 s vs 17.8 s, last first-token 4.5 s vs
   6.2 s, reuse 0.97 vs 0.00 — and A's waiting and A's cold cache arrive
   *together*, so the feared trade "wait 8 s vs quarter context and cold
   cache" does not exist. What B really costs is context per person
   (total ÷ N), the SWA KV replication (+167 MiB at np=4), and the 4 096
   refusal floor. **Recommended shape: explicit `-np N` slots — keep
   `kv_unified` out of the launch (never rely on auto slots) — with N = people
   and ≥ 4 096 per person; U (auto) is acceptable but strictly dominated at
   2k scale and dangerous at the pool ceiling (§5, one conversation cut at
   2 200 tokens).**
2. **Smallest per-person context worth offering: 4 096 tokens** — the largest
   conversation it served was 3 878 tokens warm; 4 225 was refused with HTTP
   400. Anything smaller must not be offered: the refusal is the product's
   hard evidence, and the UI must surface it.
3. **Does `cached_tokens` match the 21× prediction?** Half. Single-slot
   alternation is as cold as predicted (0 % reuse, 4 people). But "more slots
   erase caches" did not reproduce on b10950: explicit `-np N` gives per-slot
   KV with no idle-slot clearing and stays warm; the erasing mechanism
   (`kv_unified` + `try_clear_idle_slots`) is gated behind auto slots and a
   non-zero `--cache-ram`, and at household scale it never fired — this build
   restores context checkpoints instead, and reuses far *below* the shared
   prefix (81 of 579), which is the safe direction for isolation.

**Privacy:** no prompt or completion text from the simulated devices is
committed. `results.json` files are stripped of completions; server logs are
deliberately not committed because `-lv 5` logs full prompts. The marker value
in `dev/test-isolation.py` is a harness fixture, like the questions.

Files: the seven scripts named above, plus
`dev/results/multi-device-shape/{summary.md,manifest.txt,*/results.json,*/memory.txt,*/argv.txt,*/sim.out,isolation/}`
— results dir intentionally excludes the server logs.
