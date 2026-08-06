# ARBITER NOTES — source-verified facts, injected between Round 2 and Round 3

These were read directly out of the BigMoeOnEdge source tree at
`C:/Users/gualt/Desktop/Kalsa/moe-experiments/BigMoeOnEdge` by the human-side arbiter, after
Round 1 raised them as open questions. They are **[V] verified from source**, not inferred.
They outrank speculation in either direction. Where they contradict a claim made in Rounds
0–2, the source wins.

---

## N1 — Read granularity: THREE reads per expert, confirmed. Round 1's question 3 is answered.

`core/src/moe/expert_stream_source.cpp:141-165` — in LRU cache mode the runtime reserves
**one buffer per (layer, projection)**, not per expert:

```cpp
// LRU cache: one reserved (address-only) buffer per (layer, projection). Physical
// pages appear on the first miss and are released on eviction. mul_mat_id needs
// each expert at its canonical offset e*nb2 inside tensor->data, so the buffers
// live at fixed per-layer addresses; lazy commit keeps that affordable.
for (int p = 0; p < MoeRecipe::max_exps; ++p) { ... }   // max_exps == 3: gate, up, down
```

Each buffer holds all 256 experts of one projection, expert `e` at offset `e*nb2`. One
expert's three slices therefore live in **three different buffers at three different file
offsets**, and `expert_stream_source.cpp:280` issues one job each:

```cpp
const long long window = readers_[j.file]->read(lane, j.dst, j.off, j.nbytes);
```

`core/src/io/file_reader.cpp:94` `FileReader::read` is a **single-buffer positioned read**
(`pio::pread_at`, `platform_io.h:38`). There is **no** `preadv`/iovec path anywhere in the
tree.

**Consequence.** The real read pattern is **264 KiB / 264 KiB / 392 KiB random**, not 1 MiB
random. Round 1's Reason 2 is correct and Round 0's Fact 3 compared against the wrong fio
cell. The relevant device rates are fio-256k ≈ **214 MiB/s** and fio-1M ≈ **413 MiB/s** [M],
and the runtime's own 266 MiB/s sits in the 256k class.

## N2 — The repacked layout is EXACTLY 4 KiB-aligned by construction. No padding. O_DIRECT stays legal.

Round 1's D4 assumption (4) — *"0.942 MB is not 4K-aligned by construction — the rewriter must
pad to the fs block class"* — is **false**, and false in our favour:

```
gate  270336 B = 66 × 4096   ✓
up    270336 B = 66 × 4096   ✓
down  401408 B = 98 × 4096   ✓
expert 942080 B = 230 × 4096 ✓     (66 + 66 + 98 = 230)
and the IQ4_XS down of layers 34/38/39: 557056 B = 136 × 4096 ✓
```

So `e*nb2` is always page-aligned, an expert-major repack needs **zero padding**, and every
destination offset satisfies the O_DIRECT alignment requirement that
`file_reader.cpp:121-122` enforces.

## N3 — The design this implies, which no round stated

Round 1's D4 proposes fusing the three slices into one blob. Taken literally that breaks
`mul_mat_id`, which requires the per-projection memory layout (N1). But **the memory layout
and the file layout are independent**, and only the file layout needs to change:

1. **Repack the file expert-major**: for each layer, lay out expert 0's (gate, up, down)
   contiguously, then expert 1's, and so on. The result is not a stock-GGUF tensor layout, so
   it needs its own offset table — the runtime already has one (`core/src/moe/gguf_offsets.h`)
   and already reads by explicit offset, so this is a file-format change, not a runtime
   restructuring.
2. **Add a scatter read**: `preadv_at(fd, iov[3], off)` — one syscall, one contiguous 942 080 B
   file range, scattered into the three existing per-projection buffers at their canonical
   `e*nb2` offsets. `preadv` is in bionic from API 24; the S23 is far above that.

Net: memory layout unchanged, `mul_mat_id` untouched, cache keying `(layer, expert)`
untouched, quality untouched — and the read pattern moves from the 256k class to the 1 MiB
class. This is strictly cheaper and strictly safer than Round 0's H3 (co-activation packing),
which additionally needs traces, a clustering decision, and is workload-dependent. **H3 and
this are not competitors: this is the substrate H3 would later be built on**, because packing
*different* experts adjacently only pays once each *single* expert is one contiguous run.

**Open question for Round 3, and it is a real one:** does a single 942 KiB `preadv` scattered
into three destinations actually get serviced by UFS as one ~1 MiB request, or does the block
layer split it back into three? If it splits, N3's gain collapses to the syscall saving alone
and D4's whole premise with it. Answer with evidence about the Linux block layer and iovec
handling, not with an assumption — and say what would measure it.

## N4 — The re-read storm is real and is the biggest un-exploited number in the archive

Round 1 surfaced it from the F4.2 log [M] and neither BRIEF nor Round 0 built on it:

```
4 848 re-reads / 64 tokens = 75.8 per token
8 843 evictions / 64 tokens = 138.2 per token = 320 × 0.431
⇒ evictions ≈ misses (the cache is always full)
⇒ ~55% of ALL misses are re-loads of experts this same run already had and evicted
```

Treat this as ground truth for Round 3. It bears directly on whether the first move is a
cache-policy change, a bigger cache, or neither.

## N4b — STOP. The churn arithmetic does not close, and Round 2 has just re-ranked everything on it.

Round 2 answered Q1 by computing `75.8 re-reads/tok × 0.8984 MiB = 68.1 MiB/tok ≈ 80% of
traffic is self-inflicted churn`, and on the strength of that demoted layout work below cache
policy. **That figure cannot be right, and neither can the pair of counters it comes from.**

Source facts [V]:
- `expert_stream_source.cpp:166` — `n_entry = n_layer_ * n_expert_`: one cache entry per
  **(layer, expert)**, 40 × 256 = 10 240 entries. Not per projection.
- `expert_stream_source.cpp:728-736` — `evict_tail()` increments `evictions_` **once per whole
  entry**, and `entry_bytes()` sums all three projections = 942 080 B = 0.8984 MiB.
- `cli/main.cpp:838` — `MiB/token` is `moe_read_mib / n_generated`, i.e. total bytes over
  **prefill + decode** divided by **generated tokens only (64)**.
- `cli/main.cpp:857` — `re-reads/token` is `cache_rereads / n_generated`: same mixed
  denominator.

Now close the loop:

```
total read      = 84.73 MiB/tok × 64 = 5 423 MiB
⇒ expert loads  = 5 423 / 0.8984     = 6 036
evictions       = 8 843
insertions ≥ evictions + still-resident (2000 MiB / 0.8984 = 2 226)
                ≥ 11 069  ⇒  ≥ 9 944 MiB of reads
9 944 / 5 423   = 1.83×  UNACCOUNTED
```

An entry cannot be evicted without first being inserted, and it cannot be inserted without
its bytes being read. **Either `read_bytes` undercounts what the flash actually delivers, or
`evictions_` counts something other than whole-entry evictions.** Both possibilities matter,
and they point in opposite directions:

- If `read_bytes` undercounts, real traffic is **higher** than 84.73 MiB/tok, the byte-hit is
  **worse** than 70.9%, and the whole roofline in Round 1 §A.2 shifts — including the 82%
  hit-rate crossover that Round 1 used to bound the prize of all cache work.
- If `evictions_` over-counts, the churn story deflates and Round 2's re-ranking of policy
  above layout is unfounded.

**Provenance, which is its own warning.** These two lines appear in `PLAN.md` **twice**: at
:1683 attached to the **F4.2 run** (invalid 3-core regime, 0.93 tok/s, decode 1.070 s/tok) and
at :1385 attached to the **valid F4.3-bis run** (5.06 tok/s, decode 0.201 s/tok) — with byte-,
hit-, eviction- and re-read figures **identical to the digit**. That is either (a) genuinely
expected, because `--temp 0` with the same prompt and the same budget makes the expert access
sequence deterministic so only timing differs, or (b) a transcription of one run's cache line
into the other run's entry. **(a) is plausible and would be a useful fact in itself** — it
would mean cache behaviour is exactly reproducible and any A/B on it is clean. But it has
never been checked, and Rounds 1 and 2 both built on the number without asking.

**Round 3 must not build further on the 80% churn figure until this closes.** Instead:
1. Say which counter you believe is wrong and why, from the source (the file is at
   `C:/Users/gualt/Desktop/Kalsa/moe-experiments/BigMoeOnEdge/`; read
   `core/src/moe/expert_stream_source.cpp` around lines 280-300, 440-510, 700-740, 880-915,
   and 1330-1360, plus `core/src/io/file_reader.cpp`).
2. State the **one-line instrumentation** that settles it (a single printf of
   `clookups / chits / evictions / rereads / read_bytes / expert-loads` for one token).
3. Re-derive the churn share **both ways** and say whether the H2-vs-D4 ranking actually flips
   between them. If the ranking is the same under both, say so — that would make this a
   bookkeeping bug rather than a decision-relevant one, and we can proceed while it is fixed.

This is the third time in this project that a **derived** quantity inherited a bad input and
propagated into a decision. Treat the pattern as the finding.

## N5 — Correction to the arbiter's own brief, for the record

BRIEF.md originally carried 343 MB/token naive traffic and a 74% byte hit. Both were wrong.
The cause was charging the **always-on shared expert** to per-token flash traffic — counting 9
experts per layer instead of 8, when the shared expert is resident and read once at load:
`37×9×0.942 + 3×9×1.098 = 343`. The "~45 layers" figure in the old brief was then
back-inferred from that bad number and never existed. Corrected values (now in BRIEF.md §3):
**305.2 MB/token naive, 320 expert-loads/token, 70.9% byte hit, 40 layers.**

Round 0 caught the wrong number but misdiagnosed its origin as a stale layer count. Both the
correction and the misdiagnosis are worth knowing: this project's errors have repeatedly been
*derived* quantities inheriting a bad input, and the shape recurs.
