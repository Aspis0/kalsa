# Drop sweep on a second MoE (LFM2.5-8B-A1B-KEXP, Jelly Star) — PARTIAL, 4 of 12 runs

**Result: on this model `--drop-cold-experts` is a net loss at every level, and
the reason is not the one the Marco-Mini report gave. The cost is COMPUTE, it is
paid for ARMING the drop rather than for dropping, and the drop is self-limiting
because it can only fire on experts that miss the cache.**

Exploratory characterisation. Round 1 complete (4 runs, all `excluded=0`); the
harness was killed by the phone before round 2 (see "Why this cell is partial").
No p-value, no pre-registration, no ship claim.

## Why this model

`results/dropsweep_jelly` found on Marco-Mini-Instruct-KEXP that small drop
fractions cost bytes *and* time, and only d=1.0 pays. The obvious follow-up is
CalaQwen, the model we actually ship — but CalaQwen is 13.4 GB and is not on this
phone, and transferring it would cost roughly 20 % of a 71 % battery before any
measurement, against a protocol floor of 45 %. With the S23 reserved, LFM2.5 is
the only other MoE available, and it is a genuinely informative contrast rather
than a fallback:

| | Marco-Mini-KEXP | LFM2.5-8B-A1B-KEXP |
|---|---|---|
| architecture | 256 experts, k=6 | `lfm2moe`, 32 experts, k=4, sigmoid gating |
| size | 6.4 GB | 3.3 GB |
| cache hit at d=0 | 50.2 % | **93.5 %** |

Native routing width was used (no `--n-expert-used`): forcing Marco's k=6 onto a
model trained at k=4 would change the model, not the drop level under test.

## The numbers (round 1, all four levels, `excluded=0`)

| drop | s/tok | stall | **compute** | io | read_MiB | hit % | routed | dropped |
|---|---|---|---|---|---|---|---|---|
| 0.00 | 0.182 | 0.016 | **0.164** | 0.045 | 2245.6 | 93.5 | 0 | 0 |
| 0.30 | 0.214 | 0.014 | **0.199** | 0.037 | 1917.7 | 93.9 | 17600 | **9** |
| 0.65 | 0.206 | 0.010 | **0.194** | 0.029 | 1414.4 | 94.6 | 17600 | 296 |
| 1.00 | 0.238 | 0.006 | **0.231** | 0.015 | 739.6 | 95.5 | 17600 | 639 |

Every I/O quantity improves monotonically with the drop level — stall −63 %,
io −67 %, bytes −67 %, hit 93.5 → 95.5 — and **compute degrades monotonically,
+41 %**. Total time is worse at every level, and d=1.0 is the *slowest*: the exact
opposite of Marco-Mini, where d=1.0 was the fastest.

The drop here saves bytes nobody was waiting for. At d=0 the I/O share of a token
is 8.8 %, because the expert working set fits in the 2000 MiB cache.

## The mechanism, and the correction to the previous report

`results/dropsweep_jelly/REPORT.md` attributed the slowdown at low drop fractions
to cache locality: "dropping a slot re-points it at the top expert, which
perturbs which experts are touched". **That explanation does not survive the
compute/stall split.** The time cost is in compute, not in stall, and on this
model bytes *fall* while time *rises* — a byte-based mechanism cannot do that.

**The number that settles it: at d=0.3 this model dropped 9 slots out of 17600
(0.05 %) and compute still rose 21 %.** Nine experts cannot cost 21 %. So the
cost is not in dropping.

Verified at source: `RouterHook::drop_armed()` (`router_hook.cpp:213-215`) returns
false when `drop_frac_ <= 0`. At d=0.0 the engine skips `gather_weights`,
`settle_spec()`, `query_residency()` and the whole `nu × nt` loop with its renorm
pass; at any d > 0 all of it runs over *every* routed slot (88 per token here)
regardless of how many are actually dropped. **d=0.0 is therefore not "the same
engine without drops" — it is the machinery switched off.**

Re-analysing Marco-Mini's raw per-token files (already in the repo, zero new cost)
gives the unified model:

**`compute(d) = base + arming_tax − saving(how many actually fall)`**

| model | hit % | routed slots | d=0.3 dropped | Δcompute | d=1.0 dropped | Δcompute |
|---|---|---|---|---|---|---|
| Marco-Mini | 50.2 | 33600 | **21** (0.06 %) | +6.8 % (r1), +13.8 % (r2) | **9986** (29.7 %) | **−13.7 %** |
| LFM2.5 | 93.5 | 17600 | **9** (0.05 %) | **+21.3 %** | **639** (3.6 %) | **+40.9 %** |

Both models drop ~0.05 % of slots at d=0.3 and both still pay compute — the
arming tax, on two architectures. At d=1.0 Marco-Mini drops 29.7 % of slots and
the saving repays the tax with interest (compute falls *below* baseline); LFM2.5
drops 3.6 % and never repays it.

**Why so few drops on LFM2.5: the drop can only fire on a cache miss.**
`router_hook.cpp:271` — `drop = k != best && drop_res_[idx] == route_miss &&
drop_w_[idx] < thr`. The hit rate therefore *caps* the drop rate, and both models
obey the cap: Marco-Mini 50.2 % hit → at most ~49.8 % droppable, 29.7 % observed;
LFM2.5 93.5 % hit → at most ~6.5 %, 3.6 % observed.

**`--drop-cold-experts` is self-limiting. On a model whose experts fit in cache it
has nothing to drop and only the tax remains.** The general rule, now predictive
rather than anecdotal: *the drop pays only when it saves enough I/O to cover a
fixed per-token compute tax; the break-even is set by the stall share, not by the
drop level.*

## A candidate of mine that the data refuted

I proposed that Marco-Mini's +5.0 % bytes at d=0.3 came from `settle_spec()`
committing speculative prefetches. **Refuted: `spec_read_MiB=0.0` and
`spec_experts=0` in every run — the speculative prefetcher is off.**

What the data does say: at d=0.0 and d=0.3 the demand is identical
(`token_demand_MiB=136.8` in both), while **evictions go 16692 → 17409 (+4.3 %)
and rereads 12514 → 13221 (+5.7 %)**. The extra bytes are re-reads caused by extra
evictions at unchanged demand — cache thrash from how the armed path loads
(`load_layer` called immediately with `D.deferred = false`), not extra demand.
**Not yet confirmed at source: this stays an open question, but it is no longer
"cache locality" and it is not speculation.**

## Scope and limits

- **One round.** n=1 per level. Rounds 2 and 3 were lost to the device death.
- **Thermal/position confound, partly.** Within a round the order is always
  0.0 → 0.3 → 0.65 → 1.0, so position correlates with drop level, and round 1
  warmed 32 → 34 °C. Two things blunt it: `d0.65` and `d1.0` both ran at 34 → 34,
  the same thermal state, and differ 0.206 vs 0.238; and the arming-tax
  conclusion rests on d=0.3 vs d=0.0 being separated by ~1 °C while compute moved
  21 %. The planned remedy is extra rounds with the drop order **reversed**,
  which the resume logic makes free.
- One device, one binary. The quality axis is not measured here at all.
- The Marco-Mini re-analysis is of previously collected data, not a new cell.

## Why this cell is partial

The phone killed the whole Termux process group at ~00:25, twelve minutes after
the last completed run. At that moment it **answered ICMP with 0 % loss while
every Termux port was closed** (8022, 22, 18022, 2222, 8080), so it was not the
network and not deep doze — the app group was killed. `termux-wake-lock` had been
acquired successfully.

**The pattern that yesterday's post-mortem missed: both deaths happened during
the cooldown, never during a run.** 2026-08-16: last run ended 23:34:26, died in
the cooldown that followed. 2026-08-17: last run ended 00:22:02, last heartbeat
"cooldown before r2_d0.0", gone within three minutes. The intervals from launch
were 30 min and 13 min, so **there is no fixed timeout** — which falsifies the
"30-minute screen timeout" diagnosis given yesterday (already contradicted then by
the K-F cell, which ran 50 minutes).

Hypothesis, 2 cases out of 2, unconfirmed: Android freezes an app that has gone
idle, and a process sitting in `sleep 120` looks idle while one doing periodic
work does not.

**Fix applied, measurement unchanged:** `cooldown_alive()` breaks the cooldown
into 5-second sleeps with a heartbeat write each time and the wake lock
re-acquired every 30 s — same total seconds, same flags, same cold gate; only the
liveness mechanics differ. The PC-side watchdog now also **pushes the harness by
scp and verifies its sha before relaunching**, otherwise it would faithfully
restart the version that dies.

Honest limit: there is no adb channel to this phone (only the S23 is on adb, and
it is reserved), so when Termux dies there is **no out-of-band recovery** — the
watchdog retries indefinitely and resumes at run 5 the moment sshd returns, but
until then we are blind.
