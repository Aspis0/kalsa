STRONG — isolated-coding 15/20 (gate >=14 = CANDIDATE_STRONG). Language smoke also passes: EN code-explain is clearly good (7/7 = 2); IT is usable (9/10 = 2, one short/wrong-content 1). ES/FR sample all 2. Not a language KILL.

# Mellum2 F0c — language smoke + 20-task isolated-coding suite

PC only. No phones. LFM2.5 PPL pipeline was left untouched (this job was
single-stream, `-t 4`, normal priority). Previous F0 agent already verified
the official GGUF and the PC load smoke; those were **not** redone.

## Gate vs pre-declared thresholds

| gate | threshold | measured | result |
|---|---|---|---|
| isolated-coding suite | >=14 STRONG / 10–13 MAYBE / <10 KILL | **15/20** | **STRONG** |
| EN code-explain | must be clearly good | 7/7 scored 2 | PASS |
| IT | usable (Italian, coherent); EN mid-answer is not a kill | 9×2 + 1×1; replies in Italian | PASS |

SKU-premise verdict for a coding SKU: **CANDIDATE_STRONG**.

## Assets (not re-hashed this session)

```
b04281c27de5d968d577f310d982273b1b13bdbd8117b3ecffffeebfe222f0a7
  models/Mellum2-12B-A2.5B-Instruct-Q4_K_M.gguf
  8,071,293,600 bytes   (official JetBrains Instruct Q4_K_M)
035ac1a68cff7ffaee243946f66443a95cf436dd8185b14fb458f58f689c1518
  build-llama-pc/bin/llama-cli.exe          10,752 bytes
29c93b7e36f3cba84bf000b72b35bdb3305182d2c09b0bd7a463f901c0f1ad74
  build-llama-pc/bin/llama-cli-impl.dll     1,678,848 bytes
a06b49a231e11ffab5d3b748fcb75f9bfca27359e3de5ea2d5a8bddcea8f4eeb
  build-llama-pc/bin/llama.dll              2,225,152 bytes
```

CLI banner: `build : b9967-e5605f3bd`. Arch loads as Mellum. Isolated load
smoke (previous agent, same binary+weights): **24.2 t/s decode**, exits
cleanly with `-st`. This session's one-prompt re-smoke (READY, n=16) also
exited rc=0 in 33.8 s wall.

Recorded in `results/mellum2_f0/shas.txt`.

## How we ran

- Binary: `build-llama-pc/bin/llama-cli.exe` (not bmoe-cli).
- Sampler: greedy `--temp 0 --top-k 1 --top-p 1 --min-p 0`.
- Chat template: `-cnv -st --jinja` (model's own template).
- Threads: `-t 4 -tb 4 -ngl 0`. Modest on purpose — LFM2.5 PPL was live.
- stdin: Python `subprocess.DEVNULL` (do **not** use PowerShell
  `Start-Process` with `NUL` from the repo root — there is a literal `NUL`
  file there). cwd = the `llama-cli.exe` directory.
- Parser adaptations this session (previous agent hit both):
  1. Conversation banner + `> prompt` echo stripped via `-o` Assistant block.
  2. Perf line is now `[ Prompt: X t/s | Generation: Y t/s ]` — parsed.
     Token counts are **not** emitted by this CLI; we record t/s + char/word
     size. `--perf` did not restore the old `eval time = N ms / M runs` line.
  3. Trailing markdown ` ``` ` that the model glued onto otherwise-valid
     unified diffs is stripped before pytest (without that, 01/03/04/07/09/10/11
     were false FAIL). Re-score did **not** re-run inference.

n_predict: 384 language / 768 coding. ctx 4096.

Artifacts: `results/mellum2_f0/` (per-task `*.prompt.txt` + `*.gen.txt` +
`*.meta.json`, `language/scores.csv`, `suite.csv`, `run.log`, `rescore.log`).

## Informal speed

| condition | decode t/s | notes |
|---|---:|---|
| isolated load smoke (prev. agent) | **24.2** | n≈few tokens, no other GPU/CPU hog |
| this session, READY n=16 | 9.6 | LFM2.5 PPL already on the box |
| language 30 prompts, mean | **10.3** | range 8.1–12.0 |
| suite 20 prompts, mean | **10.4** | range 8.3–11.7 |

Wall per prompt is ~25–70 s (model reload every call). 15_extract hit 103 s
because it dumped a long malformed multi-file diff up to n=768.

The 24.2 figure is the one to quote as "PC CPU, this build, this GGUF, idle
box". The ~10 t/s figures are contended and are **not** a model regression.

---

## Step 1 — language / chat smoke (30 prompts)

Heuristic 0/1/2 then human spot-check. I overrode nothing except confirming
it_08 really is a 1 (Italian, but it **inverts** the ask: "completa il
progetto entro 2 giorni" instead of slipping a deadline).

| lang | n | scores | mean | verdict |
|---|---:|---|---:|---|
| EN chat | 8 | 8×2 | 2.00 | good |
| EN code-explain | 7 | 7×2 | 2.00 | **clearly good** (kill-gate) |
| IT mix | 10 | 9×2 + 1×1 | 1.90 | **usable** |
| ES | 3 | 3×2 | 2.00 | usable / good on this sample |
| FR | 2 | 2×2 | 2.00 | usable / good on this sample |

Full table: `results/mellum2_f0/language/scores.csv`.

### EN code-explain (the kill-gate)

All seven name the mechanism correctly. Spot-checked:

- `en_10` (`if n or m == 0`): precedence, `n or (m == 0)`, shows the
  counter-example, gives `n == 0 or m == 0`. Clean extract, no banner.
- `en_09` (`sorted(..., key=lambda x: (-x[1], x[0]))`): primary desc on
  field 1, secondary asc on field 0.

The other five (Set-unique, `xs.pop(i)` while iterating, pandas
`groupby.transform`, silent `except` + `return True`, lookbehind regex)
all scored 2 by the same needle+length heuristic and read as on-topic in
the log. I did not find an EN code-explain that was vague or wrong.

### IT

Replies in Italian. Not native-slick:

- `it_03` (`lista[::-1]`): correct reverse, slightly confused about what
  the middle `:` means. Still usable.
- `it_04` (`if user = None`): identifies `=` vs `==`, then says
  "l'assegnazione richiede due simboli" (backwards wording) but still
  recommends `is None`. Usable, not a teaching SKU.
- `it_08`: Italian Slack one-liner, **wrong request**. Score 1.
- No mid-answer collapse into English on the 10 IT prompts. Technical
  tokens (`None`, `==`, SQL) stay in English, which is fine.

### ES / FR

- `es_03` (`await time.sleep`): Spanish, correctly says use `asyncio.sleep`.
- `fr_01` (`if (a = b)`): French, assignment vs comparison, truthy
  consequence. Good.

Official recon said "English + programming languages only" and "no
published multilingual number". On this 15-prompt non-EN sample the model
is **better than that claim**. It is not a reason to ship it as a
multilingual chat SKU; it is enough that Italian users will not bounce
off a coding assistant.

### vs Marco1c (qualitative, Marco was not re-run)

Marco1c is the general on-device chat reference and is more casually
fluent in IT. Mellum2 is an SE assistant that happens to speak IT/ES/FR
well enough. For the coding SKU that is the right trade: EN code-explain
here is stronger than we need, IT is above the "usable" bar. Do not treat
this as a Marco replacement for open-domain Italian chat.

---

## Step 2 — 20-task isolated-coding suite

Scorecard: `results/mellum2_f0/suite.csv`.

| id | family | pass | fmt diff | how scored | note |
|---|---|---:|---|---|---|
| 01_last_n | bugfix | 1 | yes | pytest | `n==0` early return. Fence-stripped. |
| 02_collect | bugfix | 1 | yes | pytest | `bucket=None` + rebind. Clean diff. |
| 03_inclusive_sum | bugfix | 1 | yes | pytest | `range(a, b+1)`. |
| 04_clamp | bugfix | 1 | yes | pytest | `max(lo, min(x, hi))`. |
| 05_get_last | bugfix | **0** | yes | pytest FAIL | **no-op diff** — only "changed" the docstring, left `xs[len(xs)]`. |
| 06_percent | bugfix | **0** | yes | pytest FAIL | **no-op diff** — left `part // whole * 100`. |
| 07_unique_order | bugfix | 1 | yes | pytest | first-seen order. |
| 08_factorial | bugfix | 1 | yes | pytest | base case `0! = 1`. |
| 09_fizzbuzz | fromdoc | 1 | yes | pytest | standard 15/3/5. |
| 10_lcp | fromdoc | 1 | yes | pytest | |
| 11_parens | fromdoc | 1 | yes | pytest | |
| 12_chunk_js | fromdoc | 1 | yes | node | `RangeError` on size<1. |
| 13_deepget_js | fromdoc | 1 | yes | node | dot path, empty path, null. |
| 14_rename | refactor | **0** | yes | pytest PASS, structural FAIL | **added** `normalize_email` and kept `do_the_thing`. |
| 15_extract | refactor | **0** | yes | pytest FAIL | understood `is_even`, emitted unusable multi-file `@@`-without-lines diff + tried to edit tests. |
| 16_simplify | refactor | **0** | yes | pytest PASS, structural FAIL | early returns, but still a nested `if` (indent 12 > 8). |
| 17_comprehension | refactor | 1 | yes | pytest + structural | `[n for n in nums if n > 0]`. |
| 18_review_sql | review | 1 | n/a | **manual** | names f-string SQL injection in `get_user`. |
| 19_review_bsearch | review | 1 | n/a | **manual** | `hi = len(xs)` should be `len(xs)-1`, OOB. |
| 20_review_is | review | 1 | n/a | **manual** | `is "ready"` identity vs `==`. |

### By family

| family | pass | n |
|---|---:|---:|
| bugfix | 6 | 8 |
| fromdoc | **5** | 5 |
| refactor | 1 | 4 |
| review | **3** | 3 |
| **total** | **15** | **20** |

### Format-following (product-relevant)

Asked for a unified diff on 17 tasks (not the 3 reviews). **17/17**
produced something that `looks_like_diff`. After fence-strip, 14 of those
applied as a real patch; 05 and 06 applied as no-ops; 15 was a malformed
multi-hunk dump and fell through to extract.

Failure pattern that matters for a PR-workflow SKU:

1. **No-op "I touched the docstring" diffs** (05, 06). Looks like a patch,
   changes nothing. A real merge bot would accept the diff and ship the bug.
2. **Refactor compliance** is the weak family (1/4). Rename-by-duplication,
   extract-with-broken-diff, simplify-not-flat-enough.
3. Trailing ` ``` ` is common. Harmless if the client strips fences;
   fatal if you `patch -p0` blindly.

From-docstring and planted-bug review are the strong families. That
matches JetBrains' "SE assistant" pitch more than "autonomous refactor
agent".

### Tokens generated

This llama-cli build does not print `eval time / N tokens`. Approximate
size of the generations we scored:

- language: 26,999 chars / 4,261 words across 30 replies
- suite: 9,486 chars / 1,417 words across 20 replies

Several language answers hit the 384-token cap (wall ~50 s at ~10 t/s,
~1.1–1.5k chars, mid-sentence cut). Coding replies were usually shorter
than 768.

---

## Optional step 3 — Apple Metal appendix (research only, no Mac access)

Do not treat any number below as measured. This is paste-ready for the
owner's M1 Max.

Metal is **on by default** in llama.cpp on macOS
([docs/build.md](https://github.com/ggml-org/llama.cpp/blob/master/docs/build.md)).
Disable only with `-DGGML_METAL=OFF`. The Q4_K_M file is 8.07 GB; it fits
in 32 GB or 64 GB unified memory with headroom. Offload **all** 28 layers
(`-ngl 99`). M1 Max memory bandwidth is 400 GB/s on the 32-core GPU SKU.

```bash
# 0) build (Metal default). Pin near PC build b9967 / e5605f3bd if you
#    want the same CLI banner parser.
git clone https://github.com/ggml-org/llama.cpp
cd llama.cpp
# git checkout e5605f3bd   # optional pin
cmake -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build --config Release -t llama-cli llama-bench -j 8

# 1) copy the verified GGUF
#    Mellum2-12B-A2.5B-Instruct-Q4_K_M.gguf
#    sha256 b04281c27de5d968d577f310d982273b1b13bdbd8117b3ecffffeebfe222f0a7
#    8071293600 bytes

# 2) bench — this is the number that matters
./build/bin/llama-bench \
  -m "$HOME/models/Mellum2-12B-A2.5B-Instruct-Q4_K_M.gguf" \
  -ngl 99 -t 8 \
  -p 512 -n 128

# 3) 30-second chat smoke (greedy, official chat template)
./build/bin/llama-cli \
  -m "$HOME/models/Mellum2-12B-A2.5B-Instruct-Q4_K_M.gguf" \
  -ngl 99 -t 8 -c 4096 -n 32 \
  --temp 0 --top-k 1 --top-p 1.0 --min-p 0.0 \
  -cnv -st --jinja --simple-io \
  -p "Say the word READY and nothing else."

# 4) optional: replay one coding task from the PC suite
./build/bin/llama-cli \
  -m "$HOME/models/Mellum2-12B-A2.5B-Instruct-Q4_K_M.gguf" \
  -ngl 99 -t 8 -c 4096 -n 768 \
  --temp 0 --top-k 1 \
  -cnv -st --jinja --simple-io \
  -f /path/to/results/mellum2_f0/suite/tasks/01_last_n/prompt.txt
```

What to write down: `llama-bench` `pp512` and `tg128` (mean ± std), peak
memory from Activity Monitor, and whether `-ngl 99` actually put every
layer on Metal (`llm_load_tensors: ... Metal ...`). Compare tg128 to this
report's **idle PC CPU 24.2 t/s**. Do not compare to the ~10 t/s
contended numbers.

If `llama-cli` on Mac prints the same `[ Prompt: X t/s | Generation: Y t/s ]`
banner, strip it the same way before scoring.

---

## What this is not

- Not an S23 / phone number. Mandate was PC only.
- Not a Thinking-SKU eval. Instruct, no `<think>`.
- Not a third-party coding-bench (LiveCodeBench etc.). 20 short isolated
  tasks with deterministic tests.
- Not a claim that refactors are solved (1/4).
- Token counts from libllama were not available on this CLI.

## Bottom line

Mellum2 Instruct Q4_K_M, on our llama.cpp PC build, **clears the coding-SKU
F0 gate**. 15/20 isolated tasks, including a perfect 5/5 from-docstring
and 3/3 planted-bug reviews. Language is not the fail-fast the recon
feared: EN code-explain is solid, IT is usable. The live risk for the
product workflow is **format-looking diffs that do not change the bug**,
and weak local refactors — not "can't write FizzBuzz" and not "can't
speak Italian".

DONE
