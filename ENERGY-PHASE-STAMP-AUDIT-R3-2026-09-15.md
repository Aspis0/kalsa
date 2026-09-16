# Micro flip-check — 2a round 3 (R1 + R2 + doc sentences)

Branch `energy-framework`, audited commits `c1cb693` + `c1c6653` (parent `708499f`, SHIP).
Read-only; scratch `/tmp/kalsa-flip-2a-r3/`. No commit, no push, no device/adb.
Note: HEAD moved to `662509f` (docs/ENERGY-FRAMEWORK-STATUS.md only) at 00:00:37 during this
audit; `c1c6653` is its ancestor and `scripts/energyPhaseSplit.mjs` md5 still equals
`c1c66532:scripts/energyPhaseSplit.mjs` (59234fbfcbc327cdc75f3e24ecf849ee).

## 1. R1 closed — stamp vs `--prompt-tokens/--gen-tokens` cross-check

Fixture A (the R2 counterexample: doctored stamp 51/7, no manifest):

```
$ node scripts/energyPhaseSplit.mjs /tmp/kalsa-flip-2a-r3/r1_doctored --prompt-tokens 51 --gen-tokens 30
exit 0
r1 warnings: phase stamp predicted_n (7) differs from --gen-tokens (30); load+idle bucket low-resolution: …
```

Fixture B (both counts disagree, stamp 7/7 vs CLI 51/30):

```
$ node scripts/energyPhaseSplit.mjs /tmp/kalsa-flip-2a-r3/r1_both --prompt-tokens 51 --gen-tokens 30
r1 warnings: phase stamp prompt_n (7) differs from --prompt-tokens (51);
             phase stamp predicted_n (7) differs from --gen-tokens (30); …
```

Parent `708499f` on the same fixture, same flags: exit 0, no count warning, `j_per_tok_decode=2.255`
— identical to the R2 report. Honest stamp (51/30) with the same flags: no count warning
(the only warnings are the pre-existing low-resolution ones).

**NIT-1 (new, non-blocking).** When `--counts-manifest` covers the stem, the tool prints "ignoring
--prompt-tokens/--gen-tokens … (manifest takes precedence)" but still cross-checks them:

```
$ node scripts/energyPhaseSplit.mjs <real 1.2B PURE + stamp> --counts-manifest …manifest.csv \
      --prompt-tokens 999 --gen-tokens 999
energyPhaseSplit: ignoring --prompt-tokens/--gen-tokens where the manifest has the stem …
r1 warnings: phase stamp prompt_n (51) differs from --prompt-tokens (999); phase stamp predicted_n (30) differs from --gen-tokens (999); …
```

One-line gate if wanted: pass `manifestEntry ? undefined : cliPromptTokens` (and the `gen` twin) at
`scripts/energyPhaseSplit.mjs:325,328`. No repo caller combines the two flags, so campaign impact is nil.

## 2. R2 closed — one-sample decode tail

Fixture: samples 50/51/52 at 1 W, `r1 54.00`, stamp `prompt_ms=1000 predicted_ms=2500` →
`decode_start = 51.5`, exactly one sample (t=52) in the bucket.

| column | parent `708499f` | HEAD |
|---|---|---|
| `decode_s_int` | `0.000` | `""` |
| `j_decode` | `0.000` | `""` |
| `j_per_tok_decode` | `0.000` | `""` |
| `w_decode` | `1.000` | `""` |
| `n_decode` | `1` | `1` |
| warning | (no "no intervals") | `decode bucket has no intervals (decode_s is shorter than the tail gap to the mark)` |

Zero-sample geometry (`decode_start = 53.0`) still behaves: all decode cells empty, `n_decode=0`,
same reason, exit 0. Negative control: the HEAD harness run against the parent tool fails exactly
the two new checks — `FAIL (92 passed, 2 failed)` — so they are real guards, not vacuous.

## 3. Doc sentences (`docs/ENERGY-SCHEMA.md:261-269`)

> "On this geometry, a plausible 0.05–0.5 s lag is about 0.07–15% of decode because the committed
> decode durations span 71.111 s down to 3.297 s; the short fast-end bucket dominates the range. It
> can also be up to about 10% of a short prefill. The mark is restored to the v2 order before the
> stamp pull, so v3 and v2 remain comparable on the decode side, but their residual lags are not
> identical: v3 removes the host-side output, speed, and log checks before the mark and adds the
> sidecar write inside the CLI. In this geometry that makes v3 a few milliseconds smaller, so the
> direction favours v3."

Verified: committed `decode_s` spans 3.297–71.111 s (12 rows; median 41.39) → 0.05 s = 0.070 %,
0.5 s = 15.17 % of decode; the ≥30 s rows give 0.07–1.5 %. The old "identical in v2 and v3" and
"0.1–2 % of decode" wordings are absent from `docs/` and `scripts/`. The causal description matches
the R2 audit's verified fork diff.

## 4. Regression gates

```
$ node scripts/energySchemaHarness.mjs   → PASS (77 passed, 0 failed)   [was 77]
$ node scripts/energyPhaseSplitHarness.mjs → PASS (94 passed, 0 failed) [was 90]
```

Archived-revision runs: `522903c` = 85/0, `708499f` = 90/0, HEAD = 94/0 — 85→90→94 confirmed.
Text diff `708499f` → `c1cb693`: **4 checks added, 0 removed, 0 modified** ("CLI count mismatch
fixture exits 0", "stamped counts win but name CLI count disagreements", "one-sample decode tail
exits 0", "one-sample decode tail publishes empty energy cells"). `c1cb693` → `c1c6653`: comment
renumbering only (three `── N.` lines). No assertion weakened. The only changed assertion in the
earlier, already-audited step was `byStem.size === 7 → 8`, tracking the added negative-count fixture.
Minor gap: the one-sample check asserts `decode_s_int/j_decode/j_per_tok_decode/n_decode/warnings`
but not `w_decode` (col 17).

## 5. v2 sidecars, no stamps present (independent reproduction)

Four stems copied from `device-ngram-spec-out/` into a fresh dir, zero `*.stamps`; tool run with
`--counts-manifest scripts/fixtures/energy-counts/manifest.csv`; `cmp` against the committed files:

```
IDENTICAL LFM2.5-1.2B-Instruct-Q4_K_M_none_PURE.phases.csv
IDENTICAL LFM2.5-1.2B-Instruct-Q4_K_M_none_REP.phases.csv
IDENTICAL LFM2.5-2.6B-Q4_K_M_none_PURE.phases.csv
IDENTICAL LFM2.5-2.6B-Q4_K_M_none_REP.phases.csv
```

A second run into a second dir is byte-stable. Worktree clean (`git status --porcelain` empty).

## 6. Binaries and pin unchanged

```
tmp/build-android/bin/llama-cli            cca1187c7974655a50efe45d3cfd73d8   (mtime Sep 15 18:57)
tmp/build-android/bin/libllama-cli-impl.so 4e1eab9cd3d99a65373fe720193e4c24  (mtime Sep 15 18:57)
```

Both match the R2 baselines exactly. Pin: `git -C ../kalsallama archive 67c73d26 | tar -x` +
`diff -rq` → **0 differences over 3174 files**; tree md5 `34438a177f1ab1da6a48edc2751781f2`; no pin
file newer than the R2 audit.

## Not tested

- The fork-side millisecond magnitude of the v3-vs-v2 lag ("a few milliseconds smaller") is a
  hedged estimate; the fork is out of audit scope and no device runs were made.
- The v2-path one-sample decode class noted in R2 (untouched by design; no committed v2 sidecar
  exercises it — all 12 committed decode buckets have real intervals).
- The running device campaign (explicitly untouched), and the new `662509f` status-doc commit
  beyond confirming it does not touch the audited files.

## Verdict

**SHIP.** R1 and R2 are closed with independent reproductions and negative controls; docs are honest,
harnesses gained 4 checks with none weakened, sidecars byte-identical, binaries and pin unchanged.
NIT-1 (cross-check firing against flags the same run declares ignored) and the missing `w_decode`
assertion are cosmetic; neither blocks the campaign.
