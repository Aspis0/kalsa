# SELFSPEC F0 — method plan (setup only)

Status: `PLANNED`. This file is how the 300-token grid will be run. The grid
has **not** been started (live LFM PPL, see `PC_BUSY.txt`).

Mandate: `mandates/selfspec-f0-acceptance.md`.
Assets: `results/selfspec_f0/ASSETS.md`.

## 1. Question

Is low-k KEXP a viable *draft* for full-k KEXP?

- Target: same GGUF, k=6, drop 0.65, campaign flags.
- Draft: same GGUF, k=2 (try drop 0.65 and drop off).
- Number that decides: **pooled teacher-forced greedy acceptance**.
- Pre-declared gate (`mandates/selfspec-f0-acceptance.md:29-30`):
  pooled acceptance ≥ 60% at γ ≤ 4, else the lane is dead.

This is **not** `--mtp` and **not** `--ngram`. Those already exist on this
binary (`bmoe-cli --help`, also `BigMoeOnEdge/docs/telemetry.md:138-170`)
and draft from the MTP head / n-gram table. The mandate is a different
draft source: the same weights at a smaller `--n-expert-used`.

## 2. What the binary actually offers

Binary: `build-pc/cli/bmoe-cli.exe` `--version` = `0.19.0`
sha `42cd907c38fb223d1b04c7070a0c9a6e3b200e186afc19439189651dcac74f69`
(see `ASSETS.md`). `--help` read this session.

| flag | present | usable for this? |
| --- | --- | --- |
| `--session` | yes | keep model loaded; JSON stdin protocol |
| `--n-expert-used N` | yes | k=6 vs k=2. **Process-level**, not per request |
| `--ppl-decode PATH` | yes | teacher-forces gold tokens on the decode path |
| `--ppl-csv PATH` | yes | `pos,token_id,logprob` of the **gold** token only |
| `--progress` | yes | per-token `delta_text`, no `token_id` |
| `--csv PATH` | yes | timings, no predicted token id |
| `--temp 0` | yes (default greedy) | required |
| logits dump | **NO** | not in `--help`; not in `cli/main.cpp` |

Session protocol (`BigMoeOnEdge/docs/telemetry.md:426-438`):

```
{"cmd":"generate","id":<int>,"prompt":"<string>","n_predict":<int>,"think":<bool>,"clear_kv":<bool>}
{"cmd":"close"}
```

`n_expert_used` is reported once on `BMOE_READY` and is the process override
(`telemetry.md:467-470`). Switching k requires a new process.

`--ppl-decode` **is** exact teacher-forcing internally
(`BigMoeOnEdge/core/src/engine/session.cpp:1911-2014`): one token per
decode, gold next token forced, phase 0 on the first token of a window and
phase 1 after (drop-cold / cache participate). The CSV write is only

```
pos,token_id,logprob
```

(`session.cpp:1950, 2010-2011`). `log_softmax_at` already walks the vocab
for `max_logit` (`session.cpp:1953-1960`) but does **not** emit argmax or a
greedy-hit bit. Gold logprob is `-log Z`, never 0, even when gold is the
argmax — so acceptance **cannot** be recovered from `--ppl-csv`.

`--ppl-decode` also tokenizes the file as raw text with `add_special=true`
(`session.cpp:1929-1931`) and does **not** apply `--chatml`.

Generate() with `--chatml` re-renders a *user* turn and starts a fresh
assistant completion (`session.cpp:1071-1116`). There is no request field
that means “append these gold assistant tokens and score the next one”.
`clear_kv=false` continues a *conversation* (new user message), not a
mid-completion prefix (`session.md:27-34`, `telemetry.md:437-438`).

**Conclusion:** no logits dump; `--ppl-decode` is the right *compute* path
but the wrong *record*; `--session` can teacher-force only by rebuilding
the prefix as raw prompt text.

## 3. Chosen method — EXACT-RESTART (raw completion)

Label: **EXACT-RESTART**. Not windowed unless cost explodes (fallback
below, labeled **WINDOWED-W16**).

Both arms run **without `--chatml`**. The four prompt files are used as
raw prefixes. Mid-sequence teacher-force is then `prompt + gold_text[:t]`,
which `--chatml` cannot express (it would wrap that string as a new user
turn and change the condition).

This is a documented deviation from the device campaign wrap
(`reports/moe-calaqwen-scheda.md:6` includes `--chatml --no-think`).
Acceptance is “does k=2 greedily emit the same next piece as k=6 on the
same prefix?”. A constant chat wrap does not change that question as long
as both arms match. Mixing chatml-target with raw-draft would be a lie;
we will not do that.

### 3.1 Target streams (k=6 drop 0.65)

One `--session` process, campaign flags, k=6. Per prompt:
`clear_kv=true`, `n_predict=300`, `think=false`.

```
build-pc/cli/bmoe-cli.exe
  -m models/Qwen3.6-35B-A3B-KEXP.gguf
  -t 4 -c 4096 --ubatch 512 --temp 0
  --moe-stream --cache-mb 2000 --dense-weights anon
  --overlap --io-threads 4
  --n-expert-used 6 --drop-cold-experts 0.65
  --progress --csv results/selfspec_f0/streams/<id>_target.csv
  --session
```

Campaign flag source: `PLAN.md:27` plus `--temp 0` from
`reports/moe-calaqwen-scheda.md:6`. `--chatml --no-think` omitted on
purpose (§3). `-t 4` stays at the campaign thread count (do not use 8
while the LFM job is also at `-t 8`).

Save, per prompt:

- `streams/<id>_target.jsonl` — every `BMOE_PROGRESS` / `BMOE_DONE` line
- `streams/<id>_target.txt` — `BMOE_DONE.text`
- `streams/<id>_target.pieces.json` — ordered list of `delta_text`
  (one generated token-piece per decode; `telemetry.md:76-78`)
- the `--csv` file

`n_gen` may be < 300 on EOS. Score whatever was actually produced.
Record `n_prompt` from `BMOE_DONE`.

### 3.2 Draft teacher-force (k=2)

Two draft processes (k cannot change in-session):

1. **primary:** `--n-expert-used 2 --drop-cold-experts 0.65`
2. **secondary:** `--n-expert-used 2` (drop off)

Same other flags as the target, including `--session --progress`.

Algorithm (EXACT-RESTART):

```
pieces = target.pieces          # gold token-pieces
t = 0
while t < len(pieces):
    prefix = prompt + join(pieces[0:t])
    send generate(prompt=prefix, n_predict=len(pieces)-t, clear_kv=true)
    collect draft_pieces from BMOE_PROGRESS.delta_text
    m = longest i s.t. draft_pieces[0:i] == pieces[t:t+i]
    mark positions t .. t+m-1 accepted
    if t+m < len(pieces):
        mark position t+m rejected
        t = t+m+1               # force the gold piece we missed
    else:
        break
```

Why this is exact: a generate() from `prompt+gold[:t]` is one greedy
decode of P(· | gold prefix). Matching pieces are the same condition the
next step would have had; a mismatch is a true reject; the next restart
forces the gold piece and continues. This is per-position teacher-forcing
implemented as restart-after-mismatch, not a windowed approximation.

Compare **pieces**, not retokenized full strings. Generate does not emit
token ids (`telemetry.md:10-15`, `--csv` header at `telemetry.md:263-268`).

Join / BOS caveat: each restart tokenizes `prefix` with `add_special=true`
(`session.cpp:1128-1130`), same as a one-shot. The join
`prompt + join(pieces[0:t])` can theoretically merge a boundary byte pair
differently than the original generate. Mitigation: record `n_prompt` on
every restart; if it is not monotone in `t` or jumps by more than
`t + n_prompt_0 + small_slack`, flag `JOIN_MISALIGN` on that row and do
not silently count it as a reject.

### 3.3 Fallback if cost explodes — WINDOWED-W16

If EXACT-RESTART wall time is clearly exploding (many rejects × long
prefills), switch that prompt to **WINDOWED-W16** and label every row:

- restart only at `t = 0, 16, 32, ...`
- `n_predict=16` (or remaining)
- score the 16 positions against gold; do not claim the unmeasured
  interior starts
- still report the γ=2..6 prefix-accept rates *inside* each window
  (those are exact for those starts)

Do not mix unlabeled EXACT and WINDOWED rows in the pooled gate.

A 3-line addition to `--ppl-csv` (`argmax_id` or `greedy_hit`) would make
one `--ppl-decode` pass strictly better. That is engine work, not this
setup, and is not required to start the grid. Not a GEMV change.

### 3.4 What we will not do

- Phones, SSH, PLAN.md, git push, GGUF writes.
- Start the grid while `PC_BUSY.txt` still applies.
- Kill MarcoKEXP / LFM / other PC jobs.
- Use `--mtp` / `--ngram` as a substitute measurement.
- Re-open GEMV / k4-split kernels.
- Hash the 12.5 GiB KEXP file while the LFM PPL is resident.

## 4. Prompts (4)

| id | path | size | sha256 |
| --- | --- | ---: | --- |
| fact | `results/marco_phase1/speed_s23/prompts/p_fact.txt` | 361 | `b5301c32c0bd8aae4cf5c25d667a52eef05b940a459a2e9c82b1b6134cf0dcbd` |
| creative | `results/marco_phase1/speed_s23/prompts/p_creative.txt` | 268 | `761db0d07cbc312acb35fb8c64894be83f38a3a7f0ba14e2100ef6a44a29c871` |
| longfact | `results/selfspec_f0/prompts/p_longfact.txt` | 1202 | `24694e05189a25581384e9ab3dd6e80e92bdacf728a1a33c2a5e5f4cd3524f37` |
| code | `results/selfspec_f0/prompts/p_code.txt` | 1628 | `fc9467a37f595de422ec3255a4b0bb48586da741a0fad0d207a66a35569dbaa8` |

Diversity: short factual, short creative, long technical exposition, long
code+spec. The two new files are longer prefixes (1202 / 1628 vs 361 / 268)
so the accept-vs-position curve is not only a short-prompt story.

## 5. Metrics and gate

Per prompt, per draft config, write `acceptance/<id>_<draft>.csv`:

```
pos,accepted,restart_id,n_prompt,draft_piece,gold_piece,join_flag
```

Then:

- per-prompt accept rate α = mean(accepted)
- pooled α = sum accepted / sum positions (not the mean of rates)
- accept vs position (bucket 0-49, 50-99, …)
- for γ ∈ {2,3,4,5,6}: empirical
  - token accept rate inside a γ-window starting at every measured t
  - P(full γ accepted)
  - mean accepted prefix length
- independence model (labeled MODEL, not measured):
  E[tokens/step] = (1 − α^{γ+1}) / (1 − α)   for α < 1, else γ+1
  (standard speculative bonus: γ draft tokens + 1 verified correction)

Gate interpretation (both will be printed; the mandate text is
`mandates/selfspec-f0-acceptance.md:29`):

1. **Primary (MTP-style):** pooled token acceptance
   `n_accepted / n_drafted` at γ ≤ 4 ≥ 0.60.
   This matches how this engine already reports `--mtp`
   (`telemetry.md:145-147, 458-459`: `mtp_accepted / mtp_drafted`).
2. **Stricter (full-window):** P(all 4 draft tokens accepted) ≥ 0.60
   would require α ≳ 0.88 under independence. If someone reads the gate
   that way, say so explicitly rather than silently failing the lane.

k=3 is run **only if** k=2 primary pooled α < 0.60
(`mandates/selfspec-f0-acceptance.md:24`).

## 6. Speed model (grid, not setup)

Device numbers already on disk — **do not treat as PC measurements**:

| claim | value | source |
| --- | --- | --- |
| S23 CPU k6d065 cache-2000 med tok/s | 5.861 | `reports/moe-adopt-kexp.md:59` |
| S23 CPU k6 cache-1000 N3 med tok/s | 2.901 | `reports/moe-k4-split.md:311` |
| S23 GPU-split k6 cache-1000 med tok/s | 2.025 | `reports/moe-k4-split.md:311` |

PC k=2 vs PC k=6 must be **measured** on this host with the same binary
and `--cache-mb 2000` (`mandates/selfspec-f0-acceptance.md:27-28`).
Until that run exists, no PC tok/s will be invented.

Combined model (after those measurements):

```
t_step(γ) = t_draft(γ) + t_verify(γ+1)
E[tok/s]  = E[tokens/step] / t_step(γ)
```

`t_draft` for this lane is a k=2 generate of γ tokens (or γ forwards).
`t_verify` is a k=6 batched verify of γ+1 positions — **not implemented
in this setup**; the F0 number is acceptance. Speedup arithmetic uses
measured single-token k2/k6 times as a stand-in and is labeled STAND-IN
until a real verify batch exists. Device ratios will differ from PC
(`mandates/selfspec-f0-acceptance.md:28`).

## 7. Run order when the PC is free

1. Re-poll. If `bmoe-cli -t 8` or a job that opened Qwen KEXP is live,
   refresh `PC_BUSY.txt` and stop.
2. Target session: 4 prompts × n=300 greedy k=6 d0.65.
3. Draft session k=2 d0.65: EXACT-RESTART on those streams.
4. Draft session k=2 drop-off: same.
5. If k=2 d0.65 pooled α < 0.60: k=3 d0.65.
6. Short PC speed cells: k=6 and k=2, one long prompt, n=64, `-t 4`,
   `--cache-mb 2000`, for the ratio only.
7. Write `acceptance/*.csv`, the vs-position curve, the γ table,
   `reports/moe-selfspec-f0.md`, flip `STATUS.txt` to `DONE` or `DEAD`.

Threads: `-t 4`. Compile `-j4` if anything is built (nothing in setup).

## 8. Setup inventory

| file | role |
| --- | --- |
| `STATUS.txt` | `PLANNED` |
| `PC_BUSY.txt` | live LFM PPL pids; not BLOCKED_PC |
| `ASSETS.md` | model size/path, binary shas, version |
| `METHOD_PLAN.md` | this file |
| `prompts/p_longfact.txt` | new long prompt |
| `prompts/p_code.txt` | new long prompt |
