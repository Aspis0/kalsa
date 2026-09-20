# Phase-stamp sidecars + schema v3 three-bucket split — hostile audit, Fase 2a — `522903c` (branch `energy-framework`) + fork `ba33d8b` (branch `kalsa/energy-phase-stamps`)

App commit under audit: `522903cc1ce8973db7e032629a8707d0ae4bb6e9` — `bench(energy): phase-stamp
sidecars + schema v3 three-bucket split`, 4 files, +557/−44 (`docs/ENERGY-SCHEMA.md`,
`scripts/device-ngram-spec.sh`, `scripts/energyPhaseSplit.mjs`, `scripts/energyPhaseSplitHarness.mjs`).
Worktree `/Users/marco/Projects/kalsa-ngram-spec`, branch `energy-framework`, clean.
Fork commit under audit: `ba33d8b04b7e5cf18db381a7a6501c4ecfe0f611` — `cli: duration-only phase
stamps behind KALSA_PHASE_STAMPS (default off)`, 2 files, +77/−1 (`tools/cli/cli-context.{h,cpp}`),
exactly one commit above the pin `67c73d26cb4ce53d8f04b199b523bf05d18fbd61`.
Date: 2026-09-15. Mode: read-only; every command ran against the two worktrees without writing to
them, all scratch under `/tmp/kalsa-audit-2a/` (on macOS `/tmp` → `/private/tmp`, which turned out
to matter, see F9); no commit, no push, no branch, no `adb`, no device access. Both worktrees are
still clean after the audit (`git status --porcelain` → 0 lines in each). The one build I did (the
fork's own translation unit) wrote its object file to `/tmp`. This report lives at
`/tmp/kalsa-audit-2a/AUDIT-2a-SHIP.md` only.

Scope: the twelve claims as stated by the author. I am the adversarial reviewer: every claim below
is either backed by a command I ran or marked untested. Where a claim survived I say what I could
not reach; where it fell, I give the counterexample.

**Verdict: SHIP** with nine non-blocking findings (F1–F9). No claim is falsified in a way that makes
a published number wrong on the intended campaign path. The three findings worth acting on before
the first stamped campaign are F1 (a stderr write that can reach the greedy-gate text), F3 (a stamp
count override with no cross-check) and the two doc sentences in F2/F5.

---

## Findings

### F1 — The stamps *can* reach the captured `_rN.txt`, contrary to the commit message and claim 9 (MEDIUM)

The fork commit message says: *"Written to a side file, never stdout or stderr, because stdout is
the generated text the harness compares byte-for-byte and stderr is merged into the same `_<rep>.txt`
capture."* The diff contradicts its own message in the same hunk:

```
$ grep -n "fprintf" tools/cli/cli-context.cpp
463:            fprintf(stderr, "warning: KALSA_PHASE_STAMPS: failed to open '%s'; continuing without phase stamps\n",
478:        fprintf(stderr, "warning: KALSA_PHASE_STAMPS: failed to write '%s'; continuing without phase stamps\n",
```

The harness merges that stderr into the captured text (`scripts/device-ngram-spec.sh:188`:
`... </dev/null > "$out" 2>&1`), and `clean_out()` — unchanged by this commit — filters only
`^\[ Prompt:`, `^Exiting`, `^Loading model`. I replayed the filter offline on a real rep capture
with the warning appended:

```
$ cat .../LFM2.5-1.2B-Instruct-Q4_K_M_none_PURE_r1.txt /tmp/kalsa-audit-2a/warnline.txt \
    | grep -v '^\[ Prompt:\|^Exiting\|^Loading model' | sed -e 's/[[:space:]]*$//' -e '/^$/d' \
    | grep -n KALSA_PHASE_STAMPS
32:warning: KALSA_PHASE_STAMPS: failed to open /data/local/tmp/ngramspec/x.stamps; continuing without phase stamps
```

So the line survives into the byte-for-byte comparison. Worse, the warning text embeds the **per-arm
path** (`${tag}_r$i.stamps`): if the same failure hits the `none` baseline and a speculative arm, the
two captures differ by the arm name in that line, and `check_correctness()` reports a **false greedy
gate failure attributed to the arm** — the exact defect class the `F1 (audit)` comment in that file
was written to prevent. The trigger is narrow (the open fails only if `$BENCH_DIR` becomes
unwritable, e.g. a full `/data`), and the failure is loud rather than silent, hence MEDIUM not fatal.
The invariant as written — "cannot reach the captured text" — is false.

### F2 — Anchor correctness: `mark_N` is later than the engine's last token, so both reconstructed boundaries are shifted late by an unmodelled lag Δ′ (MEDIUM, claim 6)

I read the server at the pin (`tools/server/server-context.cpp` in
`/Users/marco/Projects/kalsallama-wt-phase-stamps`, which is `67c73d2` for that file):

| line | code | meaning |
|---|---|---|
| 3036-3037 | `slot.t_start_process_prompt = ggml_time_us();` | slot start, first prompt batch build begins (tokenization, chat template, HTTP request and queueing are already behind us) |
| 3333 | `slot.t_prompt_processing = (t_now - slot.t_start_process_prompt) / 1e3;` | running value while prompt batches are built |
| 3742-3745 | `t_start_generation = t_now;` (measured *after* `common_sampler_sample` + `common_sampler_accept`) then `t_prompt_processing = (t_start_generation - t_start_process_prompt)/1e3` | **prompt_ms = prompt batch processing through the first token's sampling** |
| 3749 / 3847 | `t_token_generation = max(1, t_now - t_start_generation)/1e3` | **predicted_ms = first token sample → last token sample** (speculative path uses the post-acceptance timestamp) |
| 490 (`release()`) | `t_token_generation = (ggml_time_us() - t_start_generation)/1e3` | only reached *after* `send_final_response` (3760-3766), so the value the CLI receives is the pre-teardown one |
| 505-517 (`get_timings`), 2093 | `res->timings = slot.get_timings()` | what the final chunk carries |

Two consequences the doc does not state:

1. **The reconstructed boundaries are `mark_N − predicted_ms` and `mark_N − predicted_ms − prompt_ms`,
   i.e. the engine's true boundaries shifted right by Δ′ = mark_N − (last token's sample time).**
   Δ′ contains the final streaming work, the CLI's speed-line print, process teardown, the `adb shell`
   return, the stamps `adb pull`, and the mark's own `adb shell` + `cut /proc/uptime`. Therefore the
   bucket named `decode` contains post-generation teardown and adb latency, the first Δ′ of real
   decode energy sits in `prefill`, and the first Δ′ of prompt processing sits in `load+idle`.
   The doc's nominal blocks are self-consistent (they are defined relative to `mark_N`), but the
   sentence *"the engine's measured `predicted_ms`"* invites the reading that the bucket **is** the
   engine interval, which it is not. This commit also **increases** Δ′: the stamps pull was inserted
   between the CLI command and the mark write,

   ```
   HEAD 183-190:  stamps=...; adb shell "rm -f $stamps"; adb shell "...llama-cli..."; adb pull "$stamps" "$OUT/"
   HEAD 208-209:  adb shell "echo r$i $(cut -d' ' -f1 /proc/uptime) >> $BENCH_DIR/$tag.marks"
   PIN  183-186:  adb shell "...llama-cli..."                     (no pull in between)
   ```

   so the v3 mark sits one adb round trip later than the v2 mark relative to the engine's clock.
   Magnitude: **not measured — it needs the device, which this audit is not allowed to touch.**
   On the campaign's own geometry (decode 3.3–71 s, prompt ≲ 20 s) a plausible 0.05–0.5 s Δ′ is
   0.1–2 % of `decode` and up to ~10 % of a short `prefill`.

2. **Contamination by bucket, named as the brief asks.** `prefill` = prompt-batch assembly + all
   prompt `llama_decode` calls + KV-cell writes + the model's mmap page faults on the first prompt
   (they happen inside the first forward pass) + the first token's sampler chain — this matches the
   doc's "prompt evaluation through the first generated token" and the doc's mmap claim is right.
   *Not* in `prefill`: tokenization of the prompt file, chat-template rendering, the HTTP
   round-trip, slot queueing (all before `t_start_process_prompt`) → they land in `load+idle`, as the
   doc's "any model loading before the prompt is accepted" allows. The first token's *text emission*
   and stop-string scan happen after `t_start_generation` → `decode`. `w_decode` includes the
   boundary sample whose interval is charged to `prefill` (unchanged v2 convention, still documented).

   Also: the durations are `CLOCK_MONOTONIC`-derived (claim 2's own citations), so the reconstruction
   is only valid while nothing suspends mid-rep; a suspend inside a rep would make `prompt_ms`/
   `predicted_ms` shorter than the `/proc/uptime` window they are subtracted from. The keep-awake
   wrapper makes this unlikely, but the rationale comment's stated hazard applies to the durations
   themselves, not only to a hypothetical absolute CLI timestamp.

### F3 — Stamp counts silently override the manifest; no cross-check exists (MEDIUM, claim 7)

In `splitStampedRep()`: `genTokens = stamp?.predictedN ?? perf.genTokens ?? manifestEntry?.genTokens ?? cliGenTokens`.
The stamp wins with no consistency check against the counts the tool just loaded, while the *t/s*
pairing check (`manifest campaign_gen_tps_rN` vs the speed line) is kept. Measured on a real
campaign stem with a doctored stamp (`predicted_n=7` where the tracked manifest says 30), the
tracked manifest still on the command line:

```
$ node scripts/energyPhaseSplit.mjs <copy of LFM2.5-1.2B-Instruct-Q4_K_M_none_PURE> \
      --counts-manifest scripts/fixtures/energy-counts/manifest.csv
    r1: tok=51/7   ptr=1.189  decode=8.322  warn=prefill bucket low-resolution: 2 interval(s) ... (coverage 2.08/2.00 s = 104%)
    r2: tok=51/30  ptr=0.183  ...          (v2 fallback)
    r3: tok=51/30  ptr=0.242  ...
```

`j_per_tok_decode` is inflated **6.5×** on r1 with **no warning about the disagreement** (the only
in-band note is an unrelated prefill-coverage note). Related silent case (same class, synthetic):
`predicted_n=99999999999999999999` is accepted and publishes `gen_tokens=100000000000000000000`,
`j_per_tok_decode=0.000`, warnings cell **empty**; `prompt_n=0` is likewise accepted silently.
Guarded correctly: `predicted_n=0` → `FATAL ... gen_tokens = 0 <= 0 with a count source present`,
exit 1, no file. The doc documents the override ("stamped engine counts when available") but nothing
detects a stamp from the wrong run — the one failure mode the per-rep file naming and the pre-run
`rm -f` are meant to make impossible.

### F4 — The commit regains v2 byte-identity by silently reverting an audit-mandated warning caveat (LOW, claim 3 passes but its commit-message claim does not)

Claim 3 verifies: HEAD regenerates all four committed sidecars byte-identically.

```
$ cp device-ngram-spec-out/* ⇒ /tmp/…/v2run ; node scripts/energyPhaseSplit.mjs /tmp/…/v2run \
      --counts-manifest scripts/fixtures/energy-counts/manifest.csv
$ for f in v2run/*.phases.csv; do cmp -s "$f" device-ngram-spec-out/$(basename $f) && echo IDENTICAL; done
IDENTICAL LFM2.5-1.2B-Instruct-Q4_K_M_none_PURE.phases.csv
IDENTICAL LFM2.5-1.2B-Instruct-Q4_K_M_none_REP.phases.csv
IDENTICAL LFM2.5-2.6B-Q4_K_M_none_PURE.phases.csv
IDENTICAL LFM2.5-2.6B-Q4_K_M_none_REP.phases.csv
```

But the v2 text is **not** identical to the immediate predecessor's. Running `HEAD~1`'s tool on the
same bytes (my own invocation, `/private/tmp` so the guard fires):

```
< HEAD~1: ... the sanctioned use (the same bias on both arms only when the
<          sibling arm's decode bucket has similar coverage — compare decode_s_int first)
---
> HEAD:   ... the sanctioned use
```

`git log -S "compare decode_s_int first" -- scripts/energyPhaseSplit.mjs` names exactly two commits:

```
522903c bench(energy): phase-stamp sidecars + schema v3 three-bucket split
f88a961 docs(energy): audit R4 note fixes (N1, N4, N5, N6)
```

So `f88a961` added the caveat as the R4/N6 fix, and this commit removes it — because the tracked
sidecars (untouched since `0d06ee0`) carry the pre-`f88a961` text. The commit message's
*"Unstamped stems keep the exact v2 arithmetic and output"* is false as written (arithmetic yes,
output no), and the in-band row warning loses the "compare `decode_s_int` first" guidance that the
doc still carries two paragraphs up. The sidecars are tracked files: regenerating them was available.

### F5 — Doc vs code: the mixed stem's fallback is **not** reported per row on stderr (LOW, claim 5)

`docs/ENERGY-SCHEMA.md` (v3 section): *"A mixed stem writes v3 … The command also reports that
fallback per row on stderr."* The code does the opposite: the per-row stderr loop is guarded by
`if (phaseStampTexts.size === 0)` — i.e. it fires only for a **fully unstamped** stem, where there is
no mix to explain. Measured:

```
$ node scripts/energyPhaseSplit.mjs synth/s4z_mixed --prompt-tokens 99 --gen-tokens 99 2>&1 >/dev/null
energyPhaseSplit: WARNING: --counts-manifest is the preferred count source; ...
energyPhaseSplit: wrote synth/s4z_mixed/s4z_mixed.phases.csv (3 rep rows)      # no per-row fallback line for the mixed stem

$ rm synth/s1_naive/s1_naive_r1.stamps ; node scripts/energyPhaseSplit.mjs synth/s1_naive ... 2>&1 >/dev/null
energyPhaseSplit: s1_naive: r1: phase stamps absent; falling back to kalsa-energy-rep-v2 arithmetic   # fully unstamped: the line appears
```

The row warnings cell *does* name the fallback correctly in all cases (verified in the mixed
fixture: r1 stamped, r2 "phase stamps absent; fell back to …", r3 "phase stamps no valid phase stamp
line; fell back to …", `j_prefill=0.000`, "prefill bucket unavailable"). Only the stderr sentence is
wrong.

### F6 — An empty decode bucket publishes `0.000 J` and `0.000 J/tok` in v3 where v2 published empty cells (LOW)

Same geometry, one fixture with a stamp (`decode_start` past the last sample) and one without:

```
s3c_emptytail (v3): decode_s=5.000  decode_s_int=0.000  j_decode=0.000  j_per_tok_decode=0.000
                    warn: ... decode bucket low-resolution: 0 interval(s) ... ; decode bucket has no intervals ...
s3c_emptytail (v2 twin): decode_s=5.000  decode_s_int=''  j_decode=''  j_per_tok_decode=''
                    warn: decode segment has no samples (decode_s shorter than the tail gap to the mark)
```

v2's "unavailable" became v3's "zero", warned but printable, and a consumer that drops the last
column reads a hard 0 J/tok. `row.j_per_tok_decode = genTokens > 0 ? fmt(jDecode / genTokens) : ""`
never sees `jDecode === null`.

### F7 — The shared low-resolution warning carries a decode-only sentence into the load and prefill buckets, and coverage is printed above 100 % without comment (LOW/NIT)

`lowResolutionWarning()` appends the same `LOWRES_TAIL` ("`j_per_tok_decode` is
sampling-granularity dominated …") to **every** bucket, including `load+idle` and `prefill`, whose
energies never feed `j_per_tok_decode`. Real output (sparse stamped rep, three buckets warned):

```
load+idle bucket low-resolution: 0 interval(s) attributed to load+idle (coverage 0.00/29.00 s = 0%);
  j_per_tok_decode is sampling-granularity dominated — … ; prefill bucket low-resolution: 0 interval(s)
  attributed to prefill (coverage 0.00/10.00 s = 0%); j_per_tok_decode is … ; decode bucket low-resolution: …
```

The straddle rule also means the *earlier* bucket over-covers: measured `coverage 20.00/13.00 s =
154 %` (p == d fixture) and `2.08/2.00 s = 104 %` (real stem + doctored stamp). The doc defines
coverage as `_s_int / _s` and warns below 0.7; nothing says it can exceed 1, and the warning branch
tests only the low side.

### F8 — Guards: nominal overshoot is fatal and refuses the stem; integrated overshoot/shortfall is absorbed with warnings (LOW, claim 8)

* `prefillDur + decodeDur > windowSpan` → fatal, whole stem refused, no file:
  `FATAL s3b_over: … stamped phase duration (40.000 s) exceeds window span (30.000 s) - timings incoherent with the window`, exit 1.
* A phase shorter than the sampler cadence is absorbed into its neighbour and warned, not refused
  (prompt 0.200 s / predicted 0.200 s over a 29 s window, mark 130.00, samples 100/129/129.5):
  `load_idle_s=29.600 prefill_s=0.200 decode_s=0.200` with **all 29.5 J in `load+idle`**
  (`_int` 29.500/0.000/0.000), warnings: three low-resolution lines, "window has 1 sample(s);
  integration degenerate", "implied decode power 0.00 W … outside the 0.1-20 W sanity band".
  So `prefill_s`/`decode_s` can be non-zero with zero energy behind them, and the *only* headline
  number that trips is the power band — the `_s_int` columns are the ones that expose it.
  The guard compares against the nominal span `end − start`, never against the sampled window, so
  the sampled window can be arbitrarily smaller (see the 1-sample fixture above) without a fatal.

### F9 — Pre-existing: the tool silently does nothing, exit 0, when invoked through a symlinked path (NIT)

`if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();` compares a
URL built from the *textual* argv against the *resolved* module URL. On macOS `/tmp` is a symlink to
`/private/tmp`, so

```
$ node /tmp/kalsa-audit-2a/prev/scripts/energyPhaseSplit.mjs /tmp/…/v2run-prev --counts-manifest …
PREV exit=0        # 0 bytes stdout, 0 bytes stderr, no file written
$ cd /private/tmp/kalsa-audit-2a && node prev/scripts/energyPhaseSplit.mjs v2run-prev …
PREV exit=0        # 50 lines stdout, 5 lines stderr, four files written
```

Not introduced by this commit (identical guard at `HEAD~1` and earlier), and the campaign's
`node scripts/energyPhaseSplit.mjs` invocation is unaffected — but "exit 0, nothing produced" is
precisely the silent-failure class this framework has been auditing, and CI/scripts that call the
tool by absolute path through a symlinked checkout would hit it.

---

## The twelve claims

| # | claim | verdict | evidence |
|---|---|---|---|
| 1 | DEFAULT-OFF: nothing written, byte-identical to the pin | **HOLDS (by construction, not executed)** | `cli-context.cpp:32-37` only assigns the path when the env var is non-empty (`path && path[0]`, so `=""` is off too); `write_phase_stamp()` returns at `:457` before any I/O when the path is empty; it is the only consumer of the new fields and the only caller sits behind `have_final_timings`; the two `fprintf(stderr)` calls (`:463`, `:478`) are unreachable with the path empty; the only other reader of `cli_timings` (`:717-722`) still uses only `prompt_per_second`/`predicted_per_second`; `if (stream_error) return false;` is equivalent to the old `return !stream_error;`. I could not *execute* the binary (aarch64/Linux, no device) — see "Not tested". |
| 2 | NO CLOCK: duration-only, no time source in the write path, rationale factually right | **HOLDS** | no time API anywhere in the added code (`git show ba33d8b` + `grep -n "fprintf\|ggml_time_us\|chrono\|time(" tools/cli/cli-context.cpp`); `ggml/src/ggml.c:567-570` is `clock_gettime(CLOCK_MONOTONIC)` on the POSIX path; `scripts/energy-sample.sh` reads `t_s` from `/proc/uptime` and `scripts/device-ngram-spec.sh` writes `mark_N` from `cut -d' ' -f1 /proc/uptime` — same clock; kernel commit `1d98a5fa11e9a66a7cf7b03f73cab60184781065` is `fs/proc/uptime.c: uptime_proc_show(): use get_monotonic_boottime()` (i.e. boottime, suspend included). Caveat: the durations themselves are CLOCK_MONOTONIC-derived (F2). |
| 3 | V2 BYTE-IDENTITY: four sidecars regenerate byte-identically | **HOLDS** | 4/4 `cmp -s` clean from the committed campaign bytes with no stamps present; nuance F4 (the verified text is the pre-`f88a961` text, so `HEAD~1`'s output does *not* match the sidecars). |
| 4 | EXACT PARTITION: three buckets sum to whole-window J exactly; counts partition exactly | **HOLDS for the values, with the printing grid as the only residual** | own integrator: raw `j_load_idle + j_prefill + j_decode − j_whole = 0.00e+00` on every fixture; published cells sum to `roundJ(j_whole)` (measured −3.40e-04 J = 0.0007 % on a non-round fixture — printing, not algebra); `_s_int` durations sum to the window duration exactly; `n_load_idle+n_prefill+n_decode = window samples` exactly; interval partition exact (every interval index in exactly one bucket, 31 samples → 30 intervals on the divergence fixture). |
| 5 | INTERVAL SEMANTICS: doc == code, re-derived | **HOLDS except F5** | implemented, from the code (`energyPhaseSplit.mjs:421-434`, slice/count logic `:455-457`) and confirmed by my own integration: **load+idle** = intervals `[t_k, t_{k+1})` with `k < p`, `p` = index of the first sample with `t ≥ prefill_start` (so the interval straddling `prefill_start` is in full); **prefill** = intervals with `p ≤ k ≤ d−1`, `d` = index of the first sample with `t ≥ decode_start` (the interval straddling `decode_start` is in full); **decode** = intervals with `k ≥ d` = fully inside `[decode_start, mark_N)`; the phantom interval `[t_{n−1}, mark_N)` is in no bucket; `p = d` ⇒ prefill empty, `d = n` ⇒ decode empty. Doc agreement: the nominal block, the "full sample interval lies inside" paragraph, the straddle sentence, the tool footer (`:918-922`) and the column table all match. Only the stderr sentence in the mixed-stem paragraph is wrong (F5). |
| 6 | ANCHOR CORRECTNESS | **HOLDS as defined, with named contamination** | server citations in F2 confirm `prompt_ms` ends just after the first token's sample and `predicted_ms` runs to the last token's sample, so "prompt evaluation through the first generated token" is exact, and the mmap claim is right. Contamination: Δ′ (teardown + adb) → `decode`; the same Δ′ of decode → `prefill`; the same Δ′ of prompt → `load+idle`; tokenization/HTTP/queueing → `load+idle`; first-token sampling → `prefill` (by construction); last-token emission/final response → `decode`. Δ′ unmeasured (needs the device). |
| 7 | STAMP HANDLING ROBUSTNESS | **HOLDS for format, FAILS for semantics** | multi-line: last line wins **and** warns (two *differing* lines → `decode_s=2.000`, `gen_tokens=3` from the second line, warning "multiple phase stamp lines; using the last line"); empty `""`, whitespace-only, malformed decimals, negative `-2000.000`, clock-like `phase t=…`: all → "no valid phase stamp line; fell back to kalsa-energy-rep-v2 arithmetic" + "prefill bucket unavailable" in-band, exit 0, v3 header; absurd `prompt_ms=99999` / over-window: **fatal**, exit 1, no file, reason on stderr; mixed stem: per-row in-band fallback, no stderr line (F5); **silent numbers: yes** — huge/zero counts and the stamp/manifest count override (F3), and `0.000` instead of empty for an empty bucket (F6). |
| 8 | GUARDS | **HOLDS** | fatal: nominal `prefill+decode > span` (measured, exit 1, no file), `gen_tokens ≤ 0` from any source; warned/absorbed: integrated shortfall or overshoot, sub-cadence phases, empty buckets, `coverage > 1` (F7/F8). |
| 9 | GREEDY-GATE SAFETY | **FALSIFIED in the absolute form** | the stamp *file* cannot reach `_rN.txt` (it is opened on the device path, stdout untouched); but the fork writes to stderr on both failure paths and that text survives `clean_out` (F1). `clean_out()` itself is byte-identical to the pin (`git diff HEAD~1 HEAD -- scripts/device-ngram-spec.sh` touches only `run_arm`). |
| 10 | HARNESS REGRESSIONS | **HOLDS (static analysis; no device)** | the added lines (`stamps=`, `adb shell "rm -f $stamps"`, the env prefix, `adb pull … || blog`) all sit inside the rep loop *before* the existing failure checks; every return/exit between the sampler start (`:178`) and stop is unchanged and still calls `energy_stop` (`:193`, `:202`, and the tail `:212`); the `|| blog` cannot skip anything; stale-file removal and the pull-failure log are non-fatal. The added pull does delay `mark_N` relative to the engine (F2). |
| 11 | TEST INTEGRITY | **HOLDS** | `node scripts/energyPhaseSplitHarness.mjs` → `PASS (85 passed, 0 failed)`; parsed all `check()` call sites in both revisions: 75→86 sites, **0 removed, 0 renamed**, 74 common checks with **byte-identical assertion text** (0 of 74 changed), 11 added (`stamps: …` ×3, `v3: …` ×8); `function check()` unchanged; the only edited constant is `LOWRES_TAIL`, which tracks the code's own text change (F4). Both peers still pass: `energySchemaHarness` 77/0, `matrixParityHarness` 15/0; CI runs them (`apk.yml:98-99`, `bench.yml:156-157`). |
| 12 | HYGIENE | **HOLDS** | `tmp/kalsallama-pin` is a plain (untracked, gitignored) snapshot with no `.git`; `git archive 67c73d2 \| tar -x` into `/tmp` then `diff -rq` against it → **no differences over 3174 files**; every README-cited line resolves (`cli-context.cpp:376` `if (chunk.contains("timings")) {`, `:356` `timings_per_token`, `:647-651` speed line, `cli-context.h:14-17`, `cli.cpp:36`, `server-context.cpp:509/3309/3397/3739/3881`, `server-task.cpp:244/249`); `md5 -q tmp/build-android/bin/llama-cli` = `cca1187c7974655a50efe45d3cfd73d8` and `…/libllama-cli-impl.so` = `4e1eab9cd3d99a65373fe720193e4c24`; the fork commit's parent is the pin and it touches exactly the two declared files; **formatting CI would not reject the change** — the only clang-format job in the fork (`build-webgpu.yml:45-59`) is scoped to `find ggml/src/ggml-webgpu`; I installed clang-format 22.1.0 in `/tmp` and ran it read-only: the added lines are *not* format-clean and the file was already not (`--dry-run --Werror` violations 128→180 for `.cpp`, 9→15 for `.h`, including untouched lines at `:1`, `:23`, `:124-126`), so a future `clang-format` sweep would rewrite both old and new code. |

---

## Independent re-integration (required work, no repo module imported)

Own CSV parser, own marks/speed/stamp parsers, own right-Riemann integrator
(`/tmp/kalsa-audit-2a/audit2a.py`: interval `[t_k, t_{k+1})` carries the power of sample `k+1`,
`p = |i·v|/1e12`; no `import` from the repo, `energySchema.mjs` only *read* to know the convention
under test).

**Real campaign bytes (v2, four stems × 3 reps).** 12/12 rows match the committed sidecar within the
3-decimal print grid (max cell delta 4.76e-04 J), raw `j_pre + j_decode = j_whole` to `< 1e-9`, and
the interval partition is exact. Sample: 1.2B/PURE r1 `j_pre 16.093384 / j_decode 5.520912` vs
sidecar `16.093 / 5.521`; 2.6B/REP r3 `31.945138 / 167.138322` vs `31.945 / 167.138`.

**Synthetic divergence stem (`s1_naive`, the case the brief asks for: the naive and the implemented
reading of the interval set differ).** 31 samples at 1 Hz from t=100, mark at 130.40, stamp
`prompt_ms=4000, predicted_ms=6000` ⇒ `prefill_start=120.40` (inside `[120,121)`), `decode_start=124.40`
(inside `[124,125)`), `p=21`, `d=25`, `n=31`; powers 3 W (t<120), 1 W (prefill region), 2 W (decode
region):

| bucket | implemented set (code) | tool (measured) | naive "right-endpoint" reading | naive − implemented |
|---|---|---|---|---|
| load+idle | intervals 0…20 | **59.000 J** (`_int` 21.000 s, n=21) | 58.000 J | −1.000 J (−1.69 %) |
| prefill | intervals 21…24 | **5.000 J** (`_int` 4.000 s, n=4) | 4.000 J | −1.000 J (−20.00 %) |
| decode | intervals 25…29 | **10.000 J** (`_int` 5.000 s, n=6) | 12.000 J | +2.000 J (+20.00 %) |
| sum | | 74.000 J = whole 74.000000000 J | 74.000 J | 0 |

`|tool − implemented| = 0.0` on all three buckets; `|tool − naive| = 1.0 / 1.0 / 2.0 J`. So the code
implements the straddle-to-the-earlier-bucket rule (identical to the 2 J / 1 J of the two boundary
intervals), and the size of the ambiguity if a reader follows the "right-endpoint sample at/after
`decode_start`" phrasing is **+20 % on the decode bucket** at this cadence — the same defect class as
the F1 retraction in `ENERGY-PHASE-AUDIT-2026-09-15.md`, now confined to the naive reading, not to
the code.

---

## Non-blocking notes (N-class)

| # | severity | note |
|---|---|---|
| N1 | LOW | The v3 doc section names no binary prerequisite. `scripts/device-ngram-spec.sh:35` defaults `LOCAL_BIN` to `tmp/build-android/bin`, whose `libllama-cli-impl.so` contains **0** occurrences of `KALSA_PHASE_STAMPS` (the author's `tmp/build-android-phase-stamps/bin/libllama-cli-impl.so` contains 3, and `docs/ENERGY-FRAMEWORK-STATUS.md:100` says the cross-build into that dir is owed). Run with defaults, the campaign produces **no stamps at all**: v2 rows + one "phase stamps absent" stderr line per row + one "phase stamps pull FAILED" line per rep. Detectable, but the failure mode is "the campaign silently becomes a v2 campaign". |
| N2 | NIT | The `last line wins` rule + `app` mode pairs the *last* request's timings with a text that may contain earlier requests. The harness's `-st` (`common/arg.cpp:1677-1682`, `cli-context.cpp:725-727`) makes it exactly one request per process today, so the pairing is safe only by harness construction; the tool cannot detect a multi-request stamps file (it warns only that there were several lines). |
| N3 | NIT | In a v3 fallback row, `load_idle_s` and `prefill_s` are empty while `j_load_idle` is populated and `decode_s` carries the v2 anchor; a consumer summing the nominal durations gets nothing. (The v3 column table only defines them as "nominal stamped bucket durations", so it is not a contradiction.) |
| N4 | NIT | A v3 stem mixes count provenances *within one file*: the stamped row uses the engine's counts, the fallback rows use the manifest/CLI flags (measured: `tok=51/7` next to `tok=51/30`). Documented, but it makes "REP-vs-REP only" comparisons inside a mixed stem quietly non-comparable when the count sources disagree. |
| N5 | NIT | The v2 section's `coverage < 0.7` rule and the new per-bucket rule share one message; the warning tail is copy-pasted per bucket (F7), so a 3-bucket low-resolution row carries the same sentence three times. |
| N6 | NIT | `scripts/fixtures/energy-counts/README.md` is the counts method-of-record and is untouched by this commit; it still states that the CLI cannot carry counts, and the R4 N2 hunk-count nit (`@@ -376,6 +376,12 @@` vs a 5-old/11-new body) is still open. An addendum pointing at the stamp sidecar would keep the two documents from diverging. |
| N7 | NIT | The harness `blog`s a pull failure per rep; with N1 in play that is 1 extra `adb` round trip per rep *and* a misleading "FAILED" line. |

---

## Not tested, and why

* **Claim 1's "byte-identical behaviour" was not executed.** The stamped CLI is an
  aarch64/Linux binary; it cannot run on this macOS host and the brief forbids device access (both
  phones in use), so `KALSA_PHASE_STAMPS` unset could not be demonstrated at runtime. I did
  independently **compile** the fork's `tools/cli/cli-context.cpp` with the exact flags the author's
  own build used (`/opt/homebrew/share/android-commandlinetools/ndk/27.1.12297006/…/clang++
  --target=aarch64-none-linux-android28 … -Wall -Wextra -Wpedantic -Wcast-qual
  -Wmissing-declarations -O3`, `-Werror=format-security`): exit 0, no warnings, object written to
  `/tmp`, so the default-off path is verified by source + compiler, not by execution.
* **Δ′ (claim 6) is unmeasured.** It requires a device run; I could only establish that it is
  strictly positive, includes the newly inserted `adb pull`, and is unmodelled by the tool.
* **Claims 9 and 10 were verified statically** (source reading, control-flow enumeration, an offline
  replay of `clean_out` on a real capture). Their end-to-end behaviour — greedy gate, sampler
  start/stop, leaked-sampler hygiene — needs a device session.
* **No real stamped campaign data exists.** `find /Users/marco/Projects -name "*.stamps"` → 0 hits,
  so every v3 check runs on fixtures I built; one of them (`s5_real`) reuses a real stem's CSV,
  marks and speed lines, and the harness's `STAMPED_CSV` expectation was re-derived by hand and
  matches my integrator (6/6/8 J, sum 20 J = whole).
* **The Android build as a whole** was not reproduced; I used the author's `tmp/build-android-phase-stamps`
  (built 23:12-23:18, contains the new strings) for existence evidence and compiled the touched TU myself.
* **Clang-format CI**: answered with clang-format 22.1.0 installed in a `/tmp` venv rather than the
  project's pinned runner, and by reading the only workflow that runs clang-format as a check
  (`build-webgpu.yml`, scoped to `ggml/src/ggml-webgpu`); the fork has no clang-format job for
  `tools/cli` at all.

## Commands executed (read-only; scratch under `/tmp/kalsa-audit-2a/`)

```
# app side
git -C kalsa-ngram-spec status --porcelain ; git show --stat HEAD ; git show HEAD > app.diff
git show cc612ef:scripts/energyPhaseSplit.mjs > …/pin/scripts/…   # and energySchema.mjs
git show HEAD~1:scripts/… > …/prev/scripts/…                      # predecessor run
node scripts/energyPhaseSplit.mjs <copy of device-ngram-spec-out> --counts-manifest scripts/fixtures/energy-counts/manifest.csv
node …/pin/scripts/energyPhaseSplit.mjs … ; node …/prev/scripts/energyPhaseSplit.mjs …
for f in v2run/*.phases.csv; do cmp -s "$f" device-ngram-spec-out/$(basename $f); done
node scripts/energySchemaHarness.mjs ; node scripts/energyPhaseSplitHarness.mjs ; node scripts/matrixParityHarness.mjs
node scripts/energyAggregate.mjs device-ngram-spec-out-ngram-2026-09 | md5 ; wc -c agg.err
python3 /tmp/kalsa-audit-2a/audit2a.py   # own parser/integrator (imported by the three part_*.py scripts)
python3 /tmp/kalsa-audit-2a/part_a_v2.py ; python3 /tmp/kalsa-audit-2a/part_b_synth.py ; python3 /tmp/kalsa-audit-2a/part_c_synth.py
python3 …/extract_checks.py prev-harness.mjs head-harness.mjs   # check-name/assertion diff
git log -S "compare decode_s_int first" -- scripts/energyPhaseSplit.mjs
git diff HEAD~1 HEAD -- scripts/device-ngram-spec.sh scripts/energyPhaseSplitHarness.mjs
grep -n "phases.csv" scripts/energyAggregate.mjs
# fork side
git -C kalsallama-wt-phase-stamps show HEAD ; git show --name-only --format="" HEAD ; git rev-parse HEAD^
grep -n "KALSA_PHASE_STAMPS\|fprintf\|ggml_time_us" tools/cli/cli-context.cpp
sed -n '3036p;3333p;3742,3749p;3847p;490p;505,517p' tools/server/server-context.cpp   # anchor semantics
sed -n '570p' ggml/src/ggml.c ; grep -n "clock_gettime" ggml/src/ggml.c
cd /tmp/kalsa-audit-2a && bash compile_cmd.sh   # NDK clang++ -fsyntax-only-equivalent, object → /tmp, exit 0
git archive 67c73d2 | tar -x -C …/pin-export && diff -rq …/pin-export kalsa-ngram-spec/tmp/kalsallama-pin
md5 -q tmp/build-android/bin/llama-cli tmp/build-android/bin/libllama-cli-impl.so
strings -a tmp/build-android/bin/libllama-cli-impl.so | grep -c KALSA_PHASE_STAMPS    # 0
strings -a tmp/build-android-phase-stamps/bin/libllama-cli-impl.so | grep -c KALSA_PHASE_STAMPS  # 3
/tmp/kalsa-audit-2a/clangfmt/bin/clang-format --dry-run --Werror tools/cli/cli-context.{h,cpp}   # 180 / 15
grep -rn "clang-format" .github/workflows/*.yml        # only build-webgpu.yml, scoped to ggml/src/ggml-webgpu
# harness text-filter replay (claim 9)
cat <real _rN.txt> <warning line> | grep -v '^\[ Prompt:\|^Exiting\|^Loading model' | sed -e 's/[[:space:]]*$//' -e '/^$/d'
```

## Final verdict

**SHIP.** All twelve claims survive in the form they can be tested here, with two honest
qualifications and nine non-blocking findings. The partition, the interval-set derivation, the
guards, the harness integrity (74 common checks byte-identical, 11 added, `check()` untouched), the
v2 byte-identity of the four sidecars, the pin/binary hygiene and the fork's buildability all verify
under my own tooling. The defects are: one stderr write that can leak into the greedy-gate text
(F1), an unmodelled positive boundary shift Δ′ that makes the "prefill"/"decode" names approximate
and that this commit *widens* by one adb round trip (F2), a stamp count override with no
cross-check that can publish a 6.5× wrong per-token figure silently (F3), a silent revert of the
R4/N6 warning caveat that bought the byte-identity in F4's claim 3, one wrong doc sentence (F5),
and zero-versus-empty plus warning-text warts (F6–F9).

**Recommended before the first stamped campaign (not blocking, in this order):**

1. F3 — warn when the stamp's `prompt_n`/`predicted_n` disagree with the loaded manifest entry for
   the stem (one line in `splitStampedRep`); this is the only finding that can publish a wrong
   number without a flag.
2. F5 + F2 — two doc sentences: drop/replace "The command also reports that fallback per row on
   stderr", and state that the nominal boundaries are `mark_N`-anchored, hence shifted late by the
   CLI-exit + adb lag (so the `prefill` bucket contains a sliver of decode and `load+idle` a sliver
   of prompt).
3. F1 + F6 — route the two stamp warnings through a path the harness filters (or filter them in
   `clean_out`), and emit an empty `j_per_tok_decode` instead of `0.000` when the decode bucket has
   no intervals.
4. F4 — either restore the R4 caveat and regenerate the two affected tracked sidecars, or say in the
   commit message that the caveat was dropped to keep v2 byte-identity.
5. N1 — one line in the v3 doc naming the binary prerequisite (`LOCAL_BIN=tmp/build-android-phase-stamps/bin`),
   so a default invocation cannot silently produce a v2 campaign.
