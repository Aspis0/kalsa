# K-F stall — is decode I/O-stalled enough to fund layer-ahead prefetch?

Date: 2026-08-14
Device: **none this cell.** Derived from Jelly Star lineup Marco1c, 2026-08-13,
UNPLUGGED (`results/lineup_card/jelly_1c/`). Same binary and flags the gated
cell would have re-run.
Artifacts: `results/kernel_kf/`
Spec: `docs/kernel-plan-v2.md` §3.3. No prefetch code was written.

## Verdict

**KF_GO(stall 37.3% >= 10) — derived, not re-measured.**

The engine already reports the residual that `--overlap` does not hide.
On flash-bound Marco-class decode (Jelly G99, t=2, k=6, drop 0.65, n=200)
that residual is **0.1025 s/tok of 0.2746 s/tok**. Kill was stall < 10% of
token time. Overlap does not already hide flash. Phase 1 (instrumented
Jelly cell) was not run: it would have reprinted these four stdout tails.

Layer-ahead is **not** a promise of +37% tok/s. The recoverable ceiling is
`min(stall, next-layer I/O issuable early)` and depends on *when* layer l+1's
experts are known. Strict deterministic reading (hidden_l = FFN_l output →
issue during attn_{l+1}) is a **8–14%** band with no Marco attn split to pin
it. The FFN-window reading (rank l+1 from a hidden that exists during FFN_l)
can take almost all of the 37%. Cross-token speculation is out of scope.

## Why Phase 0 is enough

Lineup protocol (`SPEED_VERDICT.md`) is the gated cell: `-t 2 -c 4096
--moe-stream --cache-mb 2000 --dense-weights anon --overlap --io-threads 4
--ubatch 512 --n-expert-used 6 --drop-cold-experts 0.65 --temp 0 --chatml
--no-think`, n=200, cold every run, UNPLUGGED. Binary
`36b01966ba0f471d17f8fcb29ab49f64f760999c4256f612f959a7a0b178ce81`, model
`2f921958540115384879eff2eeabfc7087597b245d32b0f515d9ce7b7414d777`.
No `--prefetch-layers`, `--predict-prefetch`, or `--route-ahead`.

Every stdout already has the K0-style compute / flash / stall split:

```
moe-stream: read 10535.0 MiB (52.68 MiB/token), decode 0.278 s/token
            (compute 0.156 + cache mgmt 0.018 + flash I/O 0.363 s/token, 145 MiB/s)
moe-overlap: stall 0.105 s/token (flash reads overlapped with FFN compute)
```

## Overlap semantics (do not treat flash as wall)

K0 measured a *compute* waterfall; the same accounting applies. In overlap
mode (`BigMoeOnEdge/core/src/engine/session.cpp:168-170`):

```
stall_ms  = Δstall_seconds / n_threads     # on_expert_ready wait
compute   = wall − stall − mgmt
flash I/O = summed I/O-lane syscall ns     # NOT a wall slice
```

(`expert_stream_source.cpp:1401-1412`, `1335-1383`). `wall − max(compute, flash)`
is the wrong formula: flash 0.35 s > wall 0.27 s, the difference goes negative.
The identity that closes on every row is `wall = compute + mgmt + stall`.

`moe-waits: drain` (`cli/main.cpp:1045`) is printed only if drain or adopt
≥ 0.0005 s/tok. None of the four lineup stdout files print it. Previous-layer
I/O finishes before the next `load_layer_async` (`expert_stream_source.cpp:1106-1114`).
The I/O **tail** is already hidden. Stall is head-of-line plus in-layer
`expert-ready` waits — exactly the quantity a layer-ahead issue can attack.

## Numbers (n=4, ABBA fact/creative)

| run | wall | compute | mgmt | flash (lane-busy) | stall | stall/wall | hit% | MiB/tok |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| fact o1 | 0.278 | 0.156 | 0.018 | 0.363 | 0.105 | 37.8% | 52.3 | 52.68 |
| creative o2 | 0.265 | 0.149 | 0.017 | 0.343 | 0.099 | 37.4% | 54.5 | 50.48 |
| creative o3 | 0.271 | 0.153 | 0.017 | 0.345 | 0.101 | 37.3% | 54.5 | 50.48 |
| fact o4 | 0.280 | 0.157 | 0.018 | 0.360 | 0.104 | 37.1% | 52.3 | 52.68 |
| **median** | **0.275** | **0.1545** | **0.0175** | **0.3525** | **0.1025** | **37.3%** | **53.4** | **51.58** |

Median wall = 1 / 3.642 tok/s (SPEED_VERDICT). 0.1545+0.0175+0.1025 = 0.2745.

Mean I/O parallelism = 0.3525 / 0.2746 ≈ **1.28 of 4 lanes**. Flash is not
saturating the I/O pool; idle lanes exist. That is the prefetch side-channel
`--prefetch` / `route_ahead` already use.

## Layer-ahead ceiling

Marco-Mini is 28 layers × k=6 (33600 routed / 200 tokens; drop 4.5–4.6%).
Per layer, median: stall 3.66 ms, compute 5.52 ms, lane-busy 12.6 ms, 1.84 MiB
@ ~146 MiB/s. First projection (the HOL `mul_mat_id` blocks on,
`expert_stream_source.cpp:1099-1101`) ≈ 0.61 MiB ≈ 4.2 ms — it **fits** in
one layer's 5.52 ms compute. Layer 0 cannot be prefetched (1/28 of stall ≈
1.3% of wall).

`recoverable = min(stall, next-layer I/O issuable early)`. Two windows,
because §3.3's "once layer l's hidden exists, issue during l's compute" is
not a single instant:

| window | when l+1 ids are known | what the issue overlaps | recoverable | vs 10% |
|---|---|---|---|---|
| **Attn (strict)** | after FFN_l, `router(hidden_l)` — true post-attn router still needs attn_{l+1} | attn_{l+1} only | **0.023–0.039 s (8–14% of wall)** | lower edge fails |
| **FFN (route-ahead-style)** | rank l+1 from a hidden that exists *during* FFN_l (post-attn_l + gate_{l+1}) | FFN_l on idle lanes; first projection of l+1 | **0.099 s (36% of wall)** | clears |
| True ids at topk_{l+1} | `RouterHook::on_eval` today | same-layer overlap, already shipped | **0** | kill on recoverable |

Decode attn at h=1024 / 28 layers is estimated as 15–25% of the 0.1545 s
compute residual (no Marco `--compute-trace` in this lineup). The 8–14%
band is that estimate × one layer shift; it is the honest deterministic
ceiling if the only legal input is hidden_l. Pinning it needs one
`--compute-trace` decode, not a new prefetch.

Same-layer `--overlap` already starts I/O at layer l+1's own topk. Incremental
layer-ahead is **only** the time before that topk. Funding a hook that waits
for true post-attn ids recovers nothing new. Funding an *earlier* router
(issue-only, do not commit) is the actual design.

## Engine sketch (no implementation)

The streaming cache already has the idle-lane side channel. K-F is a
**when to call it**, not a new I/O path.

1. **True ids, too late for FFN_l.** `RouterHook::on_eval` on `ffn_moe_topk`
   — `core/src/moe/router_hook.cpp:1388-1466`. `gathered_` is the real
   top-k. `source_->load_layer` at 1462 is today's same-layer overlap
   (`load_layer_async`, `expert_stream_source.cpp:1103`). Graph order
   stages one layer at a time (`1343-1345`); do not restage l+1 here.

2. **Issue path that already exists.** `route_ahead_submit`
   (`router_hook.cpp:707-773`) at layer l topk ranks `il+N` from the
   stashed gate-input row. `route_ahead_collect` (`780-801`) +
   `route_ahead_issue_for` (`848-863`) call
   `ExpertStreamSource::prefetch` (`expert_stream_source.cpp:439`).
   Demand reads keep HOL (comment at 840-847). **`apply_route_ahead`
   (`804-837`) must not run** — that replaces the router. K-F is
   issue-only; the true topk still drives `load_layer`. Landed slices
   become hits via `settle_spec` / `quiesce_spec` before the next real
   load (`1126`, `1433`).

3. **Stricter hook (hidden_l).** After layer l's residual/FFN output is
   computed, run `gate_scores(gate_w_[l+1], hidden_l)` (static helper at
   `router_hook.cpp:516`; comment at 497–502 is the early-GEMV rationale)
   and `prefetch(l+1, ids, n)`. New
   node match in `on_eval`. Overlaps attn_{l+1}. This is the
   deterministic-ish reading of §3.3; the ids equal the true router
   only if attn_{l+1} does not change top-k.

4. **Waiter.** `on_expert_ready` (`expert_stream_source.cpp:1335-1383`)
   is the stall meter. A useful prefetch makes this return on the first
   acquire (`1355`) instead of the condvar (`1376-1380`).

Out of scope: `prefetch_layers` (`router_hook.cpp:1476-1483`) — previous
token's ids, cross-token speculation. `--route-ahead` as shipped is a
*commit* experiment, not this cell.

## What this does not fund

- A new I/O stack. Four lanes already sit 1.28-busy; the cache already
  prefetches onto the idle ones.
- Cross-token expert speculation. Precision / pollution / wasted bytes
  are a different gate (`docs/kernel-plan-v2.md` §3.3).
- A claim that 37% of token time comes back. The attn-window ceiling
  can land under 10%. The next measurement, if anyone builds the hook,
  is stall-with-issue-only vs this 0.1025 baseline — and a
  `--compute-trace` split so the 8–14% band stops being a band.

Kernel basket: dispatcher + library stay the funded now-work. K-F stays
gated-B: stall is large enough to *ask*, not large enough to *assume*
the attn-window pays.

## Hygiene

- Campaign pin not written. No new binary.
- Jelly / S23 / Xiaomi / PC PPL job not touched.
- Sources: `results/lineup_card/jelly_1c/{SPEED_VERDICT.md,runs_speed.csv,logs/*/stdout.txt}`.
