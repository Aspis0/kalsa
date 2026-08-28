# Mandate: finish the Fase 4 compaction-survival benchmark and decide the default

You are picking up a benchmark that is **built, wired, and stalled**. Nothing here needs
designing from scratch — it needs debugging, running to completion, and judging.

Repo: `C:/Users/gualt/Desktop/Kalsa/ai-chat` (React Native / Expo, Android-first,
on-device LLM chat via llama.rn 0.12.8, models Qwen3.5 2B/4B GGUF).

## Why this matters (the decision at the end)

Kalsa has a context-compaction subsystem — rolling summary + query-time BM25 digest +
retriever — modelled on the pattern from the owner's private `Aspis0/CisWire` project:
facts re-injected **every turn** rather than periodically, sub-budget with deterministic
deferral instead of mid-truncation.

The design lesson was already measured and recorded in `docs/RESEARCH_CONTEXT_LOSS.md`:

| arm | recall |
|---|---|
| CisWire (facts re-injected every turn) | 100% |
| Kalsa (frozen BM25 digest) | 33.3% |

Conclusion recorded there: *BM25 retrieval works; it is the FREEZE that costs recall.*
The freeze was duly revoked on 2026-08-03 — the digest is now query-time every turn.

**But the whole subsystem ships DISABLED.** `src/app/AppShell.tsx` (around the
`COMPACTION_ENABLED_KEY` read, currently ~3574) enables it only when the stored
value is exactly `"1"` or `"true"`; nothing ever writes that key except the
Settings toggle (`src/screens/SettingsScreen.tsx`, currently ~360). On a fresh
install it is off, so for every user who does not go hunting in Settings,
roughly 68 KB of context machinery does nothing.

It is off because nobody ever produced the number that would justify turning it on.
**Your job is to produce that number.**

## Exact state (verified 2026-08-09, do not re-derive)

- Harness: `scripts/ci-bench.sh` drives ONE arm and writes `out/bench/result.json`.
  Env contract is documented in its header: `PHASE` (fase0|fase4), `ARM`, `SEED`,
  `BLOCK_FORMAT`, `THINKING`, `COMPACTION` (on|off, fase4 only), `RUNS_PER_ARM`,
  `MODEL_DIR`/`MODEL_FILE`, `APK_PATH`.
- Workflow: `.github/workflows/bench.yml`, `workflow_dispatch` with inputs
  `phase` (fase0|fase4), `model` (qwen3.5-2b|qwen3.5-4b), `runs_per_arm`.
  Fase 4 uses a fixed 3-seed matrix × 2 arms (baseline = compaction off,
  v42 = compaction on). The APK is built ONCE by the `build` job and downloaded by
  each arm — never rebuilt per arm, because one inference turn costs ~8.6 min on a
  2-vCPU runner.
- Aggregation: `scripts/benchAggregate.mjs` exists.
- **Last execution, run `30863711482` (2026-08-03):**
  - Fase 0: **6/6 arms green.**
  - Fase 4: **1/6 green** (`v42, seed 1`). The other five — `v42/2`, `v42/3`,
    `baseline/1`, `baseline/2`, `baseline/3` — all failed at the step
    **"Run bench arm on emulator"**.
  - The `aggregate` job reported success anyway, i.e. it happily aggregated a single
    surviving arm. Treat that output as meaningless.
  - Earlier runs to consult: `30857206440`, `30855749210`, `30854040258` (failures),
    `30845010783` (success).

Note the failure pattern: **every `baseline` (compaction OFF) arm failed**, and two of
three `v42` arms failed. That asymmetry is a clue — start there rather than assuming
flaky infrastructure.

## What to do

1. **Diagnose the five failures.** Pull the logs
   (`gh run view 30863711482 --log-failed`, and the artifacts if the workflow uploads
   them). Find the actual cause before changing anything. Likely candidates, unranked:
   emulator/job timeout on a slower arm, a UI-wait that never matches, the seeding of
   `kalsa.context.compaction` not being applied for the `off` arm, model download
   flakiness, a probe that only exists when compaction is on.
2. **Fix it**, in the smallest change that addresses the real cause. Prefer fixing the
   harness over weakening the experiment (do not, for example, drop a probe because it
   is flaky — a flaky probe is a broken probe).
3. **Re-run Fase 4 to completion**: both arms, all three seeds, model `qwen3.5-2b`
   (the 2B is the fast model; the plan says final validation on device with the 4B, but
   that is not this task).
4. **Aggregate and judge.** The plan (`docs/RESEARCH_CONTEXT_LOSS.md`, Fase 4) calls for
   a one-sided permutation test, the same method used for the CisWire result. Report per
   probe: fact recall (exact-token grep), `web_search` tool call at turn 9 with a valid
   query, miniapp JSON (`miniapp_v1`) validity, language adherence, and honesty on an
   invented question. Also report **prefill / time-to-first-token**, which the plan
   explicitly requires — the cache-friendliness claim lives or dies there.
5. **Write the result** into `docs/RESEARCH_CONTEXT_LOSS.md` as a dated section with the
   table and p-values, and give a clear recommendation on the default.

## The trap to avoid (this bit is not boilerplate)

**Prove the mechanism was actually active before believing any result — especially a
null one.** Two separate mechanisms in this project turned out to be elaborate,
well-tested code paths that never executed: llama.rn's core pinning is a no-op on
Android because ggml gates affinity on a glibc-only macro, and llama.cpp's
`--reasoning-budget` CLI flag is parsed and then ignored because only the server ever
fills the tags it depends on. In both cases the flag was accepted and the code looked
correct.

So, for this benchmark specifically: before trusting a "no difference between arms"
outcome, confirm from the run artifacts that the `v42` arm really had compaction ON and
the `baseline` arm really had it OFF — the app requires the stored value to be exactly
`"1"` (or `"true"`); anything else, including `1` written as a number or `"on"`, reads
as disabled. A cheap positive control: the two arms should differ in the assembled
prompt, and that difference should be visible in the logs. If both arms produce
identical prompts, you are measuring nothing, and reporting that honestly is worth more
than a table of null results.

## Constraints

- **Do not ship an APK.** CI-first; the owner tests builds when they choose to.
- Commit and push are fine; CI must be green. English in code, comments and commit
  messages; Italian when talking to the owner.
- Do not open issues or pull requests against any upstream project (llama.cpp,
  llama.rn, …). Local patches under `patches/` only.
- git user.email is the noreply address already configured globally — do not change it.
- If the benchmark ends up saying compaction does NOT help, say so plainly and recommend
  leaving the default off. A negative result that is trustworthy is the goal; a positive
  result that is not is worthless.

## Deliverable

1. The root cause of the five failures, stated concretely.
2. A complete Fase 4 run: 2 arms × 3 seeds, all green, with the run ID.
3. The aggregated table with p-values, plus prefill/TTFT.
4. A recommendation on `kalsa.context.compaction`'s default, with the evidence for it.
5. The positive-control evidence that the two arms genuinely differed.
