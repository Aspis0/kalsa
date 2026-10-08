# Hostile audit — `fbf33176c` (governor-bench: arm-L logits rows collected only when asked)

Read-only session, 2026-10-08. Target: `fbf33176c39120c9429ce1f83ef3da028773b8f6`, parent `9c11ebcbf`,
repo `/Users/marco/Projects/kalsallama-gov-loadstep`. Reviewed tree = HEAD = `fbf33176c`, `git status
--porcelain` empty. No edit, no commit, no device run.

## 0. What I ran

```
cmake --build build-host --target governor-bench > /tmp/a.log 2>&1; echo EXIT=$?
EXIT=0
```

`/tmp/a.log` carries no compiler diagnostic for the changed translation units; the single
`warning:` line is CMake's `Warning: ccache not found`. The tree was already built after the edit:
`build-host/tools/governor-bench/CMakeFiles/governor-bench.dir/governor-bench.cpp.o` mtime
`Oct 8 11:09:56 2026` vs source `governor-bench.cpp` mtime `Oct 8 11:09:33 2026`
(`governor-bench-run.cpp.o` 11:09:57, binary linked 11:14:59), so the commit compiles clean and my
run was a link-level no-op. The only other command was `git show`/`diff` of parent vs HEAD — the
full delta is exactly the two hunks in the commit, verified by `diff -u /tmp/parent-bench.cpp
tools/governor-bench/governor-bench.cpp` (only the arm-L call site and the A/G call site).

Headline: **no P0/P1 regression found; the removed arm-L collection is genuinely unconsumed in
every flag combination. Two P2 residuals and several P3 doc/style nits.**

## 1. Verdict table

| # | Claim under test | Verdict | Severity | Origin |
|---|---|---|---|---|
| F1 | The new flag-gated rule silently skips a check that used to run (dump, per-window `kl_*`, final `kld` line) | **REFUTED** | — | — |
| F2 | Arm-L rep 0 with no `--logits-out`/`--logits-ref` now stores nothing and loses no output | **CONFIRMED** | — (the fix) | new |
| F3 | `turn == 0` is right for arm L and unchanged for A/G/C | **CONFIRMED** | P3 (dead condition) | new |
| F4 | Rows requested on a long `--gen` are still unbounded, still 512,000 B/token, and the vector doubles | **CONFIRMED** | **P2** (P1 if a campaign pairs `--gen >= 2049` with the flags) | pre-existing, tolerated |
| F5 | The reference file is a second full row set loaded at startup, so KLD runs pay ~2× rows | **CONFIRMED** | **P2** | pre-existing, tolerated |
| F6 | "asked but nothing collected" is indistinguishable from "not asked" in the post-run block | **PLAUSIBLE** (no reachable trigger found) | P3 | pre-existing, touched |
| F7 | Comment arithmetic ("512 KB", "~1 GB over 2048 tokens") | **CONFIRMED** (512,000 B; 1.0486 GB) | P3 (decimal-vs-KiB) | new |
| F8 | Header placement / `inline` in the shared header with one caller / no test | **CONFIRMED** | P3 | new |
| F9 | "collecting implies greedy" (`governor-bench.h:65`) as a statement about the run | **PLAUSIBLE** (doc statement only; no alignment break found) | P3 | pre-existing |
| F10 | `--logits-ref == --logits-out` guard is arm-L-only while the flags are now "one rule for every arm" | **CONFIRMED** | P3 | pre-existing |
| F11 | `-r > 1` + `--logits-ref`: rows from rep 0 are held through reps 1..n-1 | **CONFIRMED** | P3 (part of F4) | pre-existing |

## 2. Angle 1 — consumers of `logits_rows` after the run loop

### 2.1 Enumeration: no check is lost

Every consumer is gated on the same two flags the helper tests, so the helper cannot turn a
requested check off. `governor-bench.h:80-82`:

```cpp
inline bool collect_logits_rows(const options & opts, int rep, int turn) {
    return rep == 0 && turn == 0 &&
           (!opts.logits_out.empty() || !opts.logits_ref.empty());
}
```

Consumers (all in `governor-bench.cpp` main):

- dump: `governor-bench.cpp:395` `if (!logits_rows.empty()) {` then `:396` `if (!opts.logits_out.empty() &&`
  `:397` `!governor_bench::logits_dump(opts.logits_out, logits_n_vocab, logits_rows)) {`
- final KLD gate + line: `:402` `if (!opts.logits_ref.empty()) {` … `:424`
  `const bool kld_pass = n_diverged == 0 && mean <= opts.kld_max;` … `:429`
  `opts.kld_max, kld_pass ? "PASS" : "FAIL");`
- per-window KL fields: `governor-bench-run.cpp:438`
  `if (ref_rows != nullptr && logits_rows != nullptr && row_count > 0) {`

Case matrix, old arm-L call `rep == 0 ? &logits_rows : nullptr` (parent `governor-bench.cpp:373`)
vs new `collect_logits_rows(opts, rep, 0)` (`:372` now):

| arm / rep | flags | old collected | new collects | consumer that ran before | consumer that runs now |
|---|---|---|---|---|---|
| L, rep 0 | none | yes (wasted) | no | none (`:396`/`:402` both false; `ref_rows` null) | none |
| L, rep 0 | `--logits-out` | yes | yes | dump | dump |
| L, rep 0 | `--logits-ref` | yes | yes | per-window `kl_*` + final `kld` | same |
| L, rep 0 | both | yes | yes | both | both |
| L, rep > 0 | any | no | no | none | none |
| A/C/G, rep 0 turn 0 | any | flag-gated | identical expression | — | — |
| A/C/G, otherwise | any | no | no | — | — |

The A/G/C side is a pure textual substitution: parent `governor-bench.cpp:383-384` was
`const bool collect = rep == 0 && turn == 0 && (!opts.logits_out.empty() || !opts.logits_ref.empty());`
and HEAD `:384` is `const bool collect = governor_bench::collect_logits_rows(opts, rep, turn);`.
Behaviour identical.

So the hostile hypothesis "some path now silently skips a check it used to do" is **REFUTED**: the
only delta is the arm-L rep-0 no-flags case, where every consumer was already a no-op. The commit
message's "Output line formats unchanged" also holds: that delta case printed exactly the same
stdout before and after (the pre-fix run printed nothing about its rows; it only grew by ~1 GB).
There is also no fabricated status: `status=PASS` at `:429` is reachable only with a reference loaded and
rows collected, and a divergence at row 0 yields `n_compared == 0, n_diverged == 1` → `FAIL`
(`governor-bench-logits.cpp:140-147` `if (row_argmax(ref_row, n_vocab_ref) != row_argmax(cur_row, n_vocab_cur)) {`
/ `++n_diverged;` / `break;`).

### 2.2 Residual: `-r > 1` scope, and the header promise (P3)

`logits_rows` is declared before the rep loop (`governor-bench.cpp:339` `std::vector<float> logits_rows;`,
loop starts `:352` `for (int rep = 0; rep < opts.repetitions && ok; ++rep) {`) and is never cleared
(grep for `logits_rows.clear`/`reserve`/`shrink` over `tools/governor-bench/*`: no hits). With
`--logits-ref` and the **default** `repetitions = 3` (`governor-bench.h:23` `int repetitions = 3;`):

- rep 0 window lines carry `kl_mean=… kl_max=… kl_diverged=…`; reps 1 and 2 print
  `leg_window arm=L rep=1 …` with no `kl_*` fields at all (`governor-bench-run.cpp:438` guard), silently;
- the final line is `kld arm=L … status=PASS` over rep 0's rows only (`:424-429`), and the line has no
  `rep=` field, so a 3-rep run reports one PASS that a reader can take as covering the run.

This is not introduced by `fbf33176c` (parent arm L also passed rows only on rep 0), but the commit
is where the rule is now stated authoritatively, and the statement contradicts the header's own
promise for `run_legs_turn` at `governor-bench.h:127-129`:

```cpp
// logging; logits rows are appended to *logits_rows when non-null, and when
// ref_rows is given every window line carries its KL range against the
// reference. Returns false on any decode failure.
```

With `-r 3 --logits-ref`, `ref_rows` IS given on reps 1-2 and NO window line carries a KL range.
Verdict: PLAUSIBLE as a doc/contract defect, P3. Fix would be one word in the `kld` line (`rep=0`)
or a doc clause; no code check is lost.

### 2.3 Residual: requested-but-empty is indistinguishable (P3, PLAUSIBLE)

`governor-bench.cpp:394-395` `// rows are only collected when a dump or a compare was asked for` /
`if (!logits_rows.empty()) {` means an explicitly requested dump or KLD compare is skipped in
silence (exit 0, no `kld` line, no error) whenever the collection produced zero rows. The only way
to reach that is `collect_row`'s silent early return, `governor-bench-run.cpp:304-308`:

```cpp
void collect_row(std::vector<float> & rows, llama_context * ctx, int32_t n_vocab) {
    const float * logits = llama_get_logits(ctx);
    if (!logits) { return; }
    rows.insert(rows.end(), logits, logits + n_vocab);
}
```

I could not construct a reachable trigger: `logits.data` is nulled only transiently inside
`llama_context::output_reserve` while reallocating (`src/llama-context.cpp:2283`
`logits.data = nullptr;`, followed by a new buffer in the same call), so after a successful decode
`llama_get_logits` returns non-null. Grade PLAUSIBLE (defensive), P3, pre-existing — but the commit's
own framing makes it sharper: "asked and got nothing" and "did not ask" now look identical at
`:395`. An `assert`/error when a flag is set and rows are empty would close it.

## 3. Angle 2 — `turn == 0` for arm L, unchanged for A/G

- Arm L is single-turn: the rep body `continue`s at `governor-bench.cpp:378` (`continue;`) and never
  enters the `for (int turn = 0; turn < governor_bench::k_turns …)` loop, so passing the literal `0`
  (`:372` `governor_bench::collect_logits_rows(opts, rep, 0) ? &logits_rows : nullptr;`) is correct in
  effect. The new in-block comment says so: `:369` `// one forced-rotation turn per rep; arm L's only
  turn is its turn 0`.
- A/G/C: `:384` receives the loop's `turn`, expression-identical to the parent (see 2.1).
- Hostile caveat (P3): `turn == 0` is a dead conjunct on the arm-L path — the caller hardcodes 0, so
  the helper can never observe arm L's second turn if the arm ever gains one; the guarantee lives in
  a comment and in the `continue`, not in code. `run_legs_turn` does not even take a `turn`
  parameter (`governor-bench.h:131` `int rep, std::vector<float> * logits_rows,`), so the two arms'
  notions of "turn 0" are not type-checked against each other. Fine today, a trap tomorrow.

## 4. Angle 3 — bytes per token that remain

Measured/derived at `n_vocab = 128000`, one row = `n_vocab * sizeof(float)` = 128000 × 4 =
**512,000 B** (decimal 512 KB / 500 KiB — the comment's unit, see F7). Arm L collects `gen` rows
(1 post-prefill row at `governor-bench-run.cpp:460` plus one per decode at `:513`, loop
`for (uint32_t i = 0; i + 1 < opts.generate_tokens; ++i)`).

| Allocation | Path | Bytes per token | Bounded by |
|---|---|---|---|
| `logits_rows` | only when a flag is set, only rep 0 (`governor-bench.cpp:372`, `:384-385`) | **0 B/token when unrequested** (the fix); **512,000 B/token when requested** | `gen` (nothing enforces a cap) |
| `ref_rows` | loaded whole at startup, `governor-bench.cpp:345-346`; `governor-bench-logits.cpp:109-110` `rows.resize(n_tokens * n_vocab)` + `read_exact(in, rows.data(), …)` | 512,000 B per reference row, once | reference file length |
| `std::vector<measurement> all` | `governor-bench.cpp:336`; appended `:388` after `print_turn` — arm L never reaches it (the `:378` `continue`) | 0 B/token (L); 56 B per turn (A/G/C), ≤ 9 | `k_turns × repetitions` |
| leg KV caches | three leg contexts are built regardless of `--legs`: `governor-bench-run.cpp:200` (NPU), `:204` (GPU), `:206` `legs.push_back({ llama_governor_engine::CPU, cpu_list, leg_context_params(opts, cpu_threads) });` | KV bytes/token per present leg (n_ctx-sized) | `n_ctx = k_prompt_tokens + opts.generate_tokens + 8` (`:39`), i.e. linear in `--gen` by design |
| governor stats / `per_engine[3]` / `window_*` scalars | `governor-bench-run.cpp:463-470` (`struct leg_stat`, `per_engine[3]`, `hops`, `hop_bytes`, `hop_us`, `window_us`, `window_row_begin`, `window_engine`); governor stats are one fixed struct (`src/llama-ext.h:478`) | 0 (no `push_back` per token; the governor's only `std::vector` members are built at construction: `src/llama-governor-legs.cpp:125-127` `legs.reserve(n_legs);`) | — |

Quantified residual (F4, **P2**):

- `--gen 256` (the campaign's KLD size): 256 × 512,000 B = **131.1 MB** for the dump, plus the same
  again for a 256-row reference → 262 MB.
- `--gen 2049`: **1.049 GB** of rows; `--gen 8193`: **4.19 GB** — the commit message's own
  "8193 tokens would need ~4 GB" is still true whenever a dump/compare is requested.
- Growth is by `rows.insert(rows.end(), logits, logits + n_vocab)` (`governor-bench-run.cpp:307`)
  with no `reserve`, so capacity doubles: a 2049-row run ends with capacity 4096 rows =
  **2.097 GB retained** (2× the bytes needed), and the reallocation that crosses 2048 rows has the
  old 1.048 GB buffer and the new 2.097 GB buffer live at once → a transient peak of ~3.15 GB of row
  storage (allocator-dependent; glibc/bionic munmap the old block afterwards, so RSS may fall back).
  For comparison, the recorded hard reset happened with `MemAvailable ≈ 400 MB` at ~1 GB of
  unrequested rows (PLAN.md, step-5 reset analysis: "MemAvailable hit ~400 MB at ~1500 tokens and
  the S23 HARD-RESET"). A `reserve` when collecting, or a streaming dump, would remove both the 2×
  capacity and the transient peak.
- The KLD workflow therefore still cannot run at long `--gen` on the S23: `--logits-ref` alone
  allocates the whole reference before any decode (`governor-bench.cpp:345`), and the run then holds
  rows + reference simultaneously. The current campaign avoids this only by convention
  (`--gen 128/256` with the logits flags, `--gen 2049/8193` without them — checked in
  `scratchpad/agents/onecopy-three-legs/**/run-*.sh`), not by any code guard or warning.
- Retention across reps (F11): with `-r > 1` and a flag set, rep 0's rows stay live through reps
  1..n-1 (no `clear`), so those reps are measured with up to 1 GB of ballast — the same footprint
  class the fix was meant to remove, only not growing. `-r 1` in every campaign script hides it.

## 5. Angle 4 — comment truth, placement, tests

- **Numbers check out** (F7): `governor-bench.h:77-78` `// n_vocab floats per generated token - 512 KB at n_vocab 128000 - so an` /
  `// unrequested collection grows the process by ~1 GB over 2048 tokens.` → 512,000 B and
  1.0486 GB. CONFIRMED. Nit: 512 KB decimal is 500 KiB; the repo's own PLAN uses the same decimal
  convention ("n_vocab 128000 x 4 B = 512 KB"), so this is consistent, P3 at most. The commit
  message's "~1 GB per 2048-token run (measured RssAnon +7 MB/s)" and the PLAN's independent
  "~600 KB per decoded token" agree with 512,000 B/row at ~14 tok/s; the ~88 KB/token difference is
  allocator slack, not a contradiction.
- **"One rule, used by every arm"** (`governor-bench.h:74`) is true of the call sites, but the helper
  is `inline` in a header included by two TUs while only `governor-bench.cpp` calls it
  (`governor-bench-run.cpp` includes the header for `options`/`run_state` and never calls it). A
  private policy function belongs in `governor-bench.cpp`'s anonymous namespace next to `median`
  (`:274` `template <typename F> double median(...)`) — or at least at the bottom with the other free declarations (`governor-bench.h:118-133`).
  As written it splits `struct options` (`:18-72`) from `struct measurement` (`:84-92`) in the middle
  of the data-model block. P3.
- **No test pins the new rule.** `tests/test-bench-logits.cpp` covers only the KL math; nothing calls
  `collect_logits_rows`, `run_legs_turn` or `run_turn` (grep over `tests/`). The regression this
  commit fixes (arm-L rows collected unrequested) can return silently, since the helper is a pure
  bool nobody asserts on. P3.
- **`governor-bench.h:65-66`** `// logits dump / KLD reference (any arm): collecting implies greedy` /
  `// sampling, so two runs stay token-aligned for the KLD compare` is now, as a statement about a
  run, false: with `-r 3` the A/G arms decode rep 0 turn 0 by `argmax` and every other turn through
  the sampler, because `governor-bench-run.cpp:314` `const bool greedy = logits_rows != nullptr;`
  follows the helper's decision. Both paths are effectively greedy (`make_sampler()` = temp 0 +
  fixed-seed dist, `governor-bench-run.cpp:98-104`), so I found no alignment break — but the sentence describes the
  caller's intent, not the run. Also note the usage text (`governor-bench.cpp:34`
  `"       (--logits-out/--logits-ref work on any arm and force greedy decoding;\n"`) still reads as
  a per-run property. PLAUSIBLE, P3.
- **F10**: the self-compare guard remains arm-L-only — `governor-bench.cpp:211`
  `if (out.arm == 'L' && !out.logits_ref.empty() && out.logits_out == out.logits_ref) {` — while the
  flags are now formally "one rule, used by every arm". `--arm C --logits-out x --logits-ref x`
  compares against the pre-run in-memory copy and then overwrites `x` with the run's rows
  (dump at `:396-401` runs before the compare at `:402`). P3, pre-existing.

## 6. Severity roll-up

- **P2, F4**: the requested path is still unbounded (512,000 B/token; 1.049 GB at `--gen 2049`,
  4.19 GB at `--gen 8193`), capacity doubles to 2× the bytes, transient peak ~3×, and no cap or
  warning exists. P1 if a campaign ever pairs a long `--gen` with `--logits-out`/`--logits-ref`.
- **P2, F5**: the reference side alone is 512,000 B/token loaded before the run, so a long KLD run
  needs ~2× the rows at once.
- **P3**: F3 (dead `turn==0` conjunct, untyped "turn 0" across arms), F6 (asked-but-empty silent),
  F7 (units), F8 (placement/`inline`/no test), F9 (doc trap), F10 (arm-L-only self-compare guard),
  F11 (rep-0 rows retained through later reps).
- Nothing P0/P1: the fix is correct for the case it targets, and the removed behaviour had no
  consumer.

## 7. What would falsify my verdicts (not run here)

- F1/F2: a device run of `--arm L --legs gpu --gen 2049 -r 1` (no flags) showing RssAnon growth
  ≈ 512 KB/token would mean another collector exists; the code has none left in the bench or in the
  governor's decode path.
- F4/F5: `--arm L --logits-out /tmp/x.gbl --gen 2049` (host) — expect ~1.05 GB live / ~2.1 GB
  capacity; on the S23 expect the same failure mode the unrequested run had.
- F6: force `llama_get_logits` to return null after a successful decode and check that the bench
  exits 0 with no dump and no message.

## 8. Limits

No device, no runtime experiment (the only command permitted was the build above), no RSS
measurement; all memory numbers are derived from the constants in the source and the row count.
The reference/one-copy campaign scripts were read for the flag/`--gen` combinations they use.
