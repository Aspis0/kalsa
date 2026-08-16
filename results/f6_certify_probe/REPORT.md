# F6 certify probe — can the target's greedy token be certified with fewer than 6 experts?

**VERDICT: DEAD on bytes.** Agreement at j=3 is **0.8120**, squarely inside the
pre-declared dead band (0.75–0.85), against a GO threshold of ≈0.95. No value of
j reaches the byte break-even with any margin worth building on.

This was a kill-or-go probe, not a cell: no pre-registration, no p-value, no claim
beyond the curve below. Terminated early by owner decision once the verdict was
determined; k=1 never ran and k=5 is partial (see *Completeness* below).

## Provenance

| item | value |
|---|---|
| model | `Qwen3.6-35B-A3B-KEXP.gguf`, sha256 `ac44e20c1783b9105b83246fd8ce59892b47a265b84e1323a8a501929877721a` |
| binary | `build-pc\cli\bmoe-cli.exe` (332 800 B), `-t 4 -c 4096` |
| method | EXACT-RESTART via `--session`, d0 (no drop), max_gen 16 |
| gold | `results/selfspec_f0/streams/*_target.pieces.json` (k=6, d0.65) |
| prompt sets | fact (203), creative (234), longfact (300), code (300) = **1037 positions** |
| started / killed | 2026-08-16 13:39 / 19:2x |

**Harness correctness check (declared before the run):** k=2 must land near F0's
known 0.6905. It landed on **0.6905** (716/1037) — the same value to four decimals.
The harness is measuring what it claims to measure, which is what makes the DEAD
verdict trustworthy rather than a suspected bug.

## The curve

Agreement = fraction of positions where argmax under top-`j` experts equals argmax
under the full k=6.

| j | agreement | n | implied avg experts | **β** | break-even |
|---|---|---|---|---|---|
| 2 | 0.6905 | 1037 | 3.24 | **0.540** | < 0.56 |
| 3 | 0.8120 | 1037 | 3.56 | **0.594** | < 0.56 |
| 4 | 0.8640 | 1037 | 4.27 | **0.712** | < 0.56 |
| 5 | 0.8685 | 555 (partial) | 5.13 | **0.855** | < 0.56 |

Per prompt set:

| j | fact | creative | longfact | code |
|---|---|---|---|---|
| 2 | 0.5665 | 0.5214 | 0.8467 | 0.7500 |
| 3 | 0.7143 | 0.7094 | 0.8967 | 0.8733 |
| 4 | 0.8177 | 0.7906 | 0.9200 | 0.8967 |
| 5 | 0.8571 | 0.8547 | 0.9153 (partial) | — |

`implied avg experts` uses the fallback policy named in the probe design — *certify
at j, else fall back to the full 6, reusing the j already loaded* — i.e.
`avg = rate·j + (1−rate)·6`, and `β = avg/6`. This is the **optimistic** reading on
three counts, all of which push the true β up:

1. **Argmax agreement is an upper bound on certifiability, not the certification
   rate.** Real certification must *prove* the top-1 logit beats every other token
   given a bound on what the unloaded experts could contribute. That test is
   strictly stricter than "the argmax happened to coincide". The true rate is
   materially below every number in the table; we cannot say by how much (see
   *What we could not measure*).
2. It assumes the fallback fully reuses the j experts already read. If a fallback
   must re-read, the j=3 cost becomes 3 + 6 = 9, not 6.
3. It ignores the cost of the bound computation itself.

## Reading the result

Only **j ≤ 3** could ever have worked: at j=4 the floor is already 4/6 = 0.667 > 0.56
and at j=5 it is 5/6 = 0.833, so **even perfect agreement at j≥4 fails the byte
test by construction**. That reduces the whole question to j=2 and j=3.

- **j=3 → β = 0.594.** Misses break-even by 6%, on the optimistic side of an upper
  bound. Dead.
- **j=2 → β = 0.540.** Nominally under the 0.56 threshold — by 3.6%. This is not a
  margin, it is noise sitting on top of an upper bound that we know overstates the
  real rate. Building a technique on it would be building on the error bar.

The domain split is worth recording because it is the same shape F0 found: longfact
and code certify far better (0.85–0.92) than fact and creative (0.52–0.86). Whatever
survives here survives on *predictable continuation text*, not on the hard tokens.

## The baseline moves — and this is what actually retires the technique

The probe design flagged it in advance: *if expert skipping makes verification
cheap, the same trick makes plain decoding cheap too, so the baseline moves.*

The CalaQwen drop curve running in parallel confirms the premise from the other
side. Dropping cold experts at 0.8 costs **+0.0109 macro bpb (+1.6%)** against
k6 d0 (0.6781 → 0.6889), still `GATE_PASS`. Quality does not need six experts.

So the honest comparison for β is not against plain k=6 decoding — it is against
plain *thresholded* decoding, which already reads far fewer expert bytes and needs
no drafting, no verification, no rollback, and no frozen recurrent state. Measured
against that baseline, certification at β ≈ 0.54–0.59 of a k=6 token is not a
saving at all.

**Note on scope:** the +1.6% bpb figure is a *quality* measurement. The byte saving
that `--drop-cold-experts` is designed to deliver is the flag's purpose but is not
measured in that cell; quoting a byte number for it requires its own measurement.
The argument above rests on the direction, not on an unmeasured magnitude.

## What we could not measure

The probe asked for the **top-1 vs top-2 logit margin** under partial expert sets —
the quantity that actually predicts the average expert count under an adaptive
policy, far better than fixed-j agreement does. **The engine cannot emit it.**
`engine_top2_logits: false` in `RUN_META.json`. What it can emit:

- `BMOE_PROGRESS.delta_text` — the greedy piece only
- `BMOE_DONE` aggregates
- `--ppl-csv` → `pos, token_id, logprob` **of the gold token only**

No margin data was fabricated or approximated. This is a real gap: an adaptive
scheme could in principle beat the fixed-j numbers above, and we have not measured
it. It does not change the verdict, because the j≥4 floor argument is structural and
holds regardless of margins, and j≤3 has no room — but it is the one door this probe
leaves unopened, and it would need an engine change to open.

## Completeness

- j=2, 3, 4: **complete**, 1037/1037 positions each, all four prompt sets.
- j=5: **partial**, 555/1037 (fact 203, creative 234, longfact 118/300, code not
  run). Reported as partial; it changes nothing, since j=5 fails on the structural
  floor before any measurement.
- j=1: **never ran.** Killed before it started.
- No timings are reported from this probe: it shared the machine with the drop
  curve. The measured quantities (argmax agreement) are deterministic and unaffected
  by contention.

## What this retires

F6 was the escape hatch for the self-speculative line. The algebra says speculation
can at best tie plain decoding unless β < 1, and for our measured regime
(γ=4, α=1/3, L≈3) unless β < 0.56. F6 asked whether cheap certification could
deliver that. **It cannot.**

That closes the byte case for self-speculative decoding on this architecture. What
survives from F5 is unchanged and still real: acceptance nearly doubles as a
*correction* mechanism (8.6% → 24.6% loop alpha) and the frozen recurrent state
saves a measured **251.25 MiB** of RAM. Those were never byte-throughput claims and
are not touched by this result.

The probe cost about five hours and killed a technique that would have cost weeks to
build. That is the outcome a kill-or-go probe exists to produce.
