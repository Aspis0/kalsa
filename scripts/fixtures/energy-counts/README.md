# Exact token counts for the 2026-09 device-ngram-spec energy campaign

`manifest.csv` pins the exact `(prompt_tokens, gen_tokens)` per stem that
`scripts/energyPhaseSplit.mjs` consumes via `--counts-manifest`. The raw
count-run outputs are committed next to it (`<stem>_counts.txt`). This file
is the method of record: without it the counts existed only in untracked
evidence and no third party could reproduce them (audit
ENERGY-PHASE-AUDIT-2026-09-15, F3/F6).

## What the numbers are

- `prompt_tokens` = the server's `prompt_n` = `n_prompt_tokens_processed`:
  the prompt tokens actually added to batches, no cache reuse in these runs
  (`tmp/kalsallama-pin/tools/server/server-context.cpp:509`, reset at `:3309`,
  incremented per text token at `:3397`).
- `gen_tokens` = the server's `predicted_n` = `n_decoded`, incremented BEFORE
  the stop check, so the terminating EOS token is counted
  (`server-context.cpp:3739` non-speculative path, `:3881` draft-accept path;
  EOG handling `:1926-1928`). Both fields reach the client as
  `timings.prompt_n` / `timings.predicted_n` (`server-task.cpp:244/249`).

Values are self-consistent with the runs: `gen_tokens = 256 = n_predict` for
both REP stems (the text is truncated mid-item, i.e. the cap was hit), and
30 / 204 for the EOS-truncated PURE stems.

## Why a diagnostic build was needed

The pristine CLI cannot print counts: `cli_timings` holds only two doubles
(`tools/cli/cli-context.h:14-17`), the SSE handler stores only
`prompt_per_second`/`predicted_per_second` (`cli-context.cpp:376-380`), the
only print is the speed line (`:647-651`), and `cli.cpp:36` pins verbosity to
`LOG_LEVEL_ERROR`. A "verbose llama-cli run" is therefore NOT a usable count
source, and `parsePerfLines` could not parse one either (the fork's CLI
prints slot-prefixed `eval time = ... / N tokens`, not the upstream
`llama_perf_context_print: ... / N runs` line).

## The diagnostic patch — reference text only

The counting build was a scratch patch, NEVER COMMITTED; the patched binary
was deleted after the count runs and the pristine binaries restored
(md5-identical to the pre-patch build: `llama-cli`
`cca1187c7974655a50efe45d3cfd73d8`, `libllama-cli-impl.so`
`4e1eab9cd3d99a65373fe720193e4c24`). The exact scratch bytes are not
preserved; the reference text below reconstructs what the build did, in the
only place that matches the artifacts — the SSE timings handler in
`tools/cli/cli-context.cpp`:

```diff
--- tmp/kalsallama-pin/tools/cli/cli-context.cpp (pristine, b674-c6e2376)
+++ diagnostic build (scratch, never committed)
@@ -373,6 +373,12 @@
         if (chunk.contains("timings")) {
             const auto & t = chunk.at("timings");
             timings.prompt_per_second    = t.value("prompt_per_second",    0.0);
             timings.predicted_per_second = t.value("predicted_per_second", 0.0);
+            // scratch diagnostic: exact counts once per run, on the final
+            // chunk (the only one carrying a finish_reason)
+            if (t.contains("prompt_n") && t.contains("predicted_n")
+                && chunk.contains("choices") && chunk.at("choices").at(0).value("finish_reason", "") != "") {
+                printf("COUNTS prompt_n=%d predicted_n=%d\n", t.value("prompt_n", 0), t.value("predicted_n", 0));
+            }
         }
```

Evidence that matches the committed artifacts: each `<stem>_counts.txt`
contains exactly one `COUNTS` line, placed after the generated text —
consistent with an end-of-stream read of the final chunk's timings (the CLI
sets `timings_per_token: true`, `cli-context.cpp:356`; a per-chunk print
would have produced one line per token).

## How the counts were validated against the campaign

Cleaning a count-run output with the harness's own rules (drop the
`[ Prompt:` / `Exiting` / `Loading model` banner lines and the scratch
`COUNTS` line, strip trailing whitespace) gives a text md5-identical to ALL
THREE campaign reps of the same stem — the echoed prompt and generated
sequence are byte-identical, so the counts (including the EOS position) are
the counts of the runs whose energy gets split.

Manifest column notes: `count_run_gen_tps` is the count run's own speed line
(provenance only, never read by the tool); `campaign_gen_tps_r1..r3` are the
campaign reps' speed lines — the tool warns when a rep's speed line
disagrees with its manifest column (wrong manifest/campaign pairing).
`count_run_output` names the committed raw file.

## Reproducing the counts (if ever needed again)

Apply the reference patch to `tmp/kalsallama-pin/tools/cli/cli-context.cpp`,
rebuild the CLI for the device, run one llama-cli request per stem with the
same prompt and `n_predict` as the campaign, and record the `COUNTS` line.
Then restore the pristine sources and verify the rebuilt binaries'
md5s before measuring anything else.
