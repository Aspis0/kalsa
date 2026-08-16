# EXPLORATORY — not a claim. F5 arm D1 — does stateless drafting pay on flash (Xiaomi 14)?

**No.** Self-speculation loses on this phone. Best freeze-ON arm is **0.44×**
plain decode on mean effective tok/s (γ=3) and **0.37×** on the fastest
replicate. The freeze still does what P1/P2 said: it nearly doubles loop alpha
(13.9 % → 23.6 % at γ=4) and drops draft-context RS from 314.06 → 62.81 MiB.
That is a RAM result, already measured on PC. It is not a speed result.

This cell is **exploratory**. It is not pre-registered, produces **no claim**,
and no p-value is computed. A win here would have justified a later ABBA cell.
There is no win, so there is nothing to pre-register.

## Why this cell exists

F5 P1/P2 (`results/selfspec_f5_pc/`) measured 251.25 MiB saved at γ=4 and a
loop-alpha lift that does not decay across a chat. On a DRAM-bound host
self-speculation *lost* (5.89 vs 1.81 effective tok/s). The speed case was
always flash: a k=2 draft reads a third of the expert bytes, so verify-batch
amortisation might pay where I/O is the tax. D1 is that measurement.

This phone is the **least favourable** device we own for that bet. Cold I/O
stall share on CalaQwen here is 6.0 % (`results/kf_calaqwen_xiaomi/`; Marco
8.7 %). A technique that pays by reading fewer bytes has almost no stall left
to remove. A null is the expected outcome. It is what we got.

## Provenance

| item | value |
|---|---|
| git | `kalsa/selfspec-f1` @ `b3eb60c08b1e5533d0e939b1e0a35995c2550cdb` |
| host binary | `BigMoeOnEdge-selfspec-f1/build-android-f5/cli/bmoe-cli` |
| sha256 | `a94d12ae8d343542a2c48eff408be8494052ccb957fe314ff0983e9091151123` |
| on-device | `/data/local/tmp/f5_d1/bin/bmoe-cli` (sha verified **before** first run) |
| ABI / NDK | arm64-v8a, android-29, NDK 27.1.12297006, `armv8.2-a+dotprod+fp16` |
| E4 campaign tree | `BigMoeOnEdge-selfspec-f1/build/` **not touched** (mtime still 2026-08-16 00:44) |
| device | Xiaomi 14 (23127PN0CG / houji), `adb-625689a2-9xEOfw._adb-tls-connect._tcp` |
| model | `/data/local/tmp/gdn_750/taskb/Qwen3.6-35B-A3B-KEXP.gguf` (13 416 430 592 B) |
| prompt | `p_longfact.txt` (same F0/F5-PC prefix), `--chatml --no-think` |
| window | 2026-08-16 12:09:53 → 13:15:32 local (EDT) |

`--help` on device listed `--selfspec-freeze-recurrent` before the first
measurement. `print_info: arch = qwen35moe` on every run; freeze engagement is
the allocator, not the arch string: freeze-ON draft ctx is `n_rs_seq = 0` /
62.81 MiB, freeze-OFF is `n_rs_seq = 4` / 314.06 MiB. No "not hybrid" warning.
The skip-write canary (`nop'd 0 store nodes`) stayed silent on every freeze-ON
run.

`BigMoeOnEdge-selfspec-f1/build/` (E4 binary, published sha `6ae38f4b192a0786…`)
was not opened. Device payload went to a **new** directory
`/data/local/tmp/f5_d1/bin`. Campaign binaries under `/data/local/tmp/gdn_750/`
and `/data/local/tmp/kf_general/` were not overwritten.

## Protocol

Campaign flags, n=200, interleaved so thermal/cache drift hits every arm:

```
-n 200 --temp 0 -c 4096 --ubatch 512 -t 4
--moe-stream --cache-mb 2000 --dense-weights anon --overlap --io-threads 4
--n-expert-used 6 --drop-cold-experts 0.65
--chatml --no-think --prompt-file p_longfact.txt
```

| arm | extra |
|---|---|
| a_plain | *(none)* |
| b_off | `--selfspec-draft-k 2 --selfspec-gamma 4` |
| c_on | `+ --selfspec-freeze-recurrent` |
| d_on_g3 | `--selfspec-draft-k 2 --selfspec-gamma 3 --selfspec-freeze-recurrent` |

Order: a, b, c, d, a, b, c, d, a, b, c, d. Three reps each. UNPLUGGED the
whole window (`svc power stayon true` during, restored false at the end).
Battery floor 45 %, thermal abort 43 °C, wait above 40 °C. Floor and abort
were not hit. Peak pre-run temp 39.9 °C; end 40.1 °C / 46 %.

**Validity gate (every run):** numeric `generation: N tokens, X s/token` AND
N ≥ 150 AND wall ≥ 60 s AND not faster than 0.15 s/tok. Retry up to 3, then
FAIL — a short or empty run does not enter the table. All **12 / 12 VALID on
try=1**. Every run emitted exactly 200 tokens.

Driver: `run_d1.ps1` + on-device `run_one.sh` (VmHWM poll). Raw stdouts:
`out/*_r{1,2,3}.txt`. Timeline: `STATUS.txt`.

## Per-run table

Effective tok/s **includes draft cost** (the `→ X tok/s effective` line).
`s/tok` is the decode-only number the harness also prints. Alpha is
`mtp_accepted/mtp_drafted`. RSS is `/proc/pid/status` VmHWM.

| run | arm | eff tok/s | decode s/tok | draft s/tok | alpha | tok/ver | MiB/tok | peak RSS MiB | wall s | batt → | °C |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| r1 | a_plain | **2.001** | 0.500 | — | — | — | 35.60 | 5338 | 135 | 70 % | 28.9 |
| r1 | b_off | 0.65 | 0.596 | 0.940 | 57/411 = 13.9 % | 1.40 | 174.39 | 6408 | 363 | 69 % | 31.1 |
| r1 | c_on | 0.74 | 0.474 | 0.870 | 96/407 = 23.6 % | 1.92 | 132.95 | 6243 | 328 | 66 % | 35.8 |
| r1 | d_on_g3 | 0.75 | 0.460 | 0.882 | 93/317 = 29.3 % | 1.87 | 109.92 | 6427 | 333 | 64 % | 37.5 |
| r2 | a_plain | 1.505 | 0.665 | — | — | — | 35.60 | 6151 | 179 | 62 % | 38.3 |
| r2 | b_off | 0.52 | 0.635 | 1.289 | 57/411 = 13.9 % | 1.40 | 174.39 | 6212 | 452 | 61 % | 38.7 |
| r2 | c_on | 0.63 | 0.520 | 1.072 | 96/407 = 23.6 % | 1.92 | 132.95 | 6442 | 386 | 59 % | 38.7 |
| r2 | d_on_g3 | 0.70 | 0.483 | 0.954 | 93/317 = 29.3 % | 1.87 | 109.92 | 6116 | 355 | 56 % | 39.3 |
| r3 | a_plain | 1.457 | 0.686 | — | — | — | 35.60 | 6371 | 183 | 54 % | 39.6 |
| r3 | b_off | 0.52 | 0.652 | 1.277 | 57/411 = 13.9 % | 1.40 | 174.39 | 6571 | 454 | 53 % | 39.7 |
| r3 | c_on | 0.60 | 0.529 | 1.126 | 96/407 = 23.6 % | 1.92 | 132.95 | 6007 | 403 | 51 % | 39.8 |
| r3 | d_on_g3 | 0.71 | 0.478 | 0.926 | 93/317 = 29.3 % | 1.87 | 109.92 | 6474 | 354 | 48 % | 39.9 |

End: 46 %, 40.1 °C, still unplugged.

Acceptance counts are **bit-identical across the three reps of each arm**.
Greedy is deterministic; that is the expected signature, and it is also a
check that thermal drift moved the clock and not the loop. Bytes/token and
tokens/verify are likewise identical within an arm. The clock is the noisy
column; the counts are the evidence.

## Arm means (n=3, no inference)

| arm | mean eff tok/s | vs a_plain | mean decode s/tok | mean draft s/tok | alpha | tok/ver | MiB/tok | draft `n_rs_seq` / RS |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| a_plain | **1.654** | 1.00× | 0.617 | — | — | — | 35.60 | — / 62.81 (single ctx) |
| b_off | 0.563 | **0.34×** | 0.628 | 1.169 | 13.9 % | 1.40 | 174.39 | 4 / 314.06 |
| c_on | 0.657 | **0.40×** | 0.508 | 1.023 | 23.6 % | 1.92 | 132.95 | **0 / 62.81** |
| d_on_g3 | 0.720 | **0.44×** | 0.474 | 0.920 | 29.3 % | 1.87 | 109.92 | **0 / 62.81** |

Even the most favourable single cell — d_on_g3 r1 at 0.75 tok/s, phone still
cool — loses to the *slowest* plain replicate (1.457 tok/s) by 0.51×.

## What the freeze does on flash (same shape as PC, smaller prize)

| | freeze OFF (b) | freeze ON γ=4 (c) | freeze ON γ=3 (d) |
|---|---:|---:|---:|
| loop alpha | 13.9 % | **23.6 %** (1.70×) | **29.3 %** |
| tokens / verify | 1.40 | **1.92** | 1.87 |
| MiB / token | 174.39 | 132.95 (−24 %) | **109.92** (−37 %) |
| draft RS buffer | 314.06 MiB | **62.81 MiB** | **62.81 MiB** |
| target RS buffer | 314.06 (γ=4) | 314.06 (γ=4) | 251.25 (γ=3) |

The 251.25 MiB draft-side saving at γ=4 is reproduced from the engine's own
allocator, same numbers as P1/P2. Peak RSS moves in the right direction on
some pairs (b_r1 6408 → c_r1 6243, −165 MiB) and not on others. VmHWM on
Android includes file cache and is not a clean instrument for a 250 MiB
delta on a 6 GiB working set. **Quote the RS buffer, not the RSS column, for
the RAM fact.**

Prefill nearly doubles with self-speculation (plain mean 20.5 s for 304
tokens; selfspec 44–48 s) because `ctx_dft` prefills the same prefix. Paid
before the first token, independent of the freeze. On a 200-token answer it
is already a large fraction of wall; on a short answer it cannot amortise.

## Why flash does not pay here

Plain decode on r1 is **compute-bound**: 0.469 s compute of 0.500 s/token,
flash I/O 0.123 s/token of which most is overlapped. That is the same phone
that showed a 6.0 % cold stall share on this model last week.

A k=2 draft is still a full forward pass. c_on runs 407 drafts + 104 verify
decodes to emit 200 tokens — roughly two drafts and half a verify per
emitted token. Drafting alone costs **0.87–1.29 s per emitted token**, which
is already more than a whole plain decode (0.50–0.69 s). The verify batch
then has to win that back by skipping decode steps. At 1.92 tokens/verify it
does not come close.

Reading fewer expert bytes per draft is real (c 133 vs a 36 MiB/token is the
extra passes, not a denser stream; d cuts that to 110 by drafting less).
There is almost no I/O stall for those missing bytes to remove. The extra
compute stays.

This is the same qualitative hole as P1/P2 on DRAM (0.37×). Flash did not
open a different regime on this device.

## The γ=3 prediction

Registered from E4 (`docs/f5-stateless-loop-spec.md` §5): extend γ only
while the prefix-acceptance product exceeds k_d/k_v, which predicts **γ=3
optimal at k=2** and γ=4 already overshooting.

Directionally yes, on this exploratory sample:

- d_on_g3 mean 0.720 vs c_on 0.657 effective tok/s
- higher alpha (29.3 % vs 23.6 %) because the late slots that fail are not
  drafted
- 17 % fewer bytes (109.92 vs 132.95 MiB/token)
- slightly fewer tokens/verify (1.87 vs 1.92) — γ=3 verifies a shorter
  block, so the per-cycle win is a bit smaller, but the discarded 4th draft
  was a loser

The gap is a few hundredths of a tok/s against a 0.9 tok/s hole vs plain.
It does not change the product question. It is consistent with the
prediction and too small to chase on this phone.

## Verdict

`F5_D1_EXPLORATORY(selfspec_loses, best=0.44x_mean, r1=0.37x, n=3)`

- **Self-speculation loses on Xiaomi 14 flash.** Say that plainly. Do not
  dress the alpha lift or the RAM saving as a speed result.
- Freeze-ON vs freeze-OFF is the same qualitative win as P1/P2 (alpha
  13.9 → 23.6 %, 24 % fewer bytes, `n_rs_seq = 0`). That is the RAM / loop-
  correctness story, already published from the PC arms.
- γ=3 is a hair faster than γ=4 and matches the registered prediction in
  direction. It still loses to plain by more than 2×.
- A null is publishable and was the prior. This phone's cold stall share is
  6–9 %. We did not tune to rescue the result.
- **Do not pre-register an ABBA speed cell from this.** There is no speed
  win to confirm. D3 (hand the 251.25 MiB back as `--cache-mb`) is a
  different question and was not run.

## Honesty ledger

- Exploratory. Not a cell. No Wilcoxon, no p, no ship statement.
- r1 is the cool/fast regime (plain 2.00 tok/s); r2/r3 sit under the
  governor (plain 1.46–1.51). Interleaving is what makes the comparison
  fair — every arm ate the same drift.
- `--chatml --no-think` is load-bearing. Without it this model emits EOG
  after one token and every wall-clock number becomes a prefill
  measurement (P1/P2 Result 4, retracted). The gate would have caught
  that; it did not have to.
- Architecture string `qwen35moe` is the GGUF tag. Hybrid-ness is the
  recurrent allocator. We quote the allocator.
- Peak RSS is reported because it was asked for. It is too noisy to carry
  the 251.25 MiB claim. The RS buffer line is the claim, and it matches PC
  bit-for-bit.
- Draft cost is so large that "decode tok/s" without it (c_on r1 = 2.11)
  would have *looked* like a win against plain 2.00. That number excludes
  the thing that loses. Effective tok/s is the only speed column that
  means anything. F1 already named this trap.

Data: `out/*.txt`, `STATUS.txt`, `run_d1.ps1`, `run_one.sh`.
