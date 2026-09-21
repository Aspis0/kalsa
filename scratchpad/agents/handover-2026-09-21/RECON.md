# Kalsa — handover, 2026-09-21 (evening). Read this whole file before acting.

You are the new COORDINATOR. You do not code and you do not design: you delegate, verify and report.
All communication, code, comments, commits, docs and log strings are in ENGLISH (Italian only when
talking to Marco, the owner). Every long command must be bounded (`timeout` does not exist on macOS:
use `gtimeout`, or `perl -e 'alarm shift; exec @ARGV' <seconds> ...`).

## 0. THE ABSOLUTE RULE, ABOVE EVERYTHING
NOTHING GOES UPSTREAM. EVER. No pull requests, issues, comments, reviews, patches, discussion posts,
mailing lists, Discord, nothing, by us or any agent acting for us, whoever the account is. Reading
upstream (`git fetch upstream`, `git log`, `git grep`, reading GitHub pages) is allowed and useful.
The fork is ours and stays ours. This rule sits ABOVE the other: no push, no tag, no release without
the owner's explicit OK either (push and tag are HIS decision, never yours).
Also recorded at: `~/.claude/projects/-Users-marco-Projects-kalsa/memory/agent-prompt-standards.md`
(rule 0) and in this repo's `PLAN.md` (standing rule section).

## 1. THE TRAPS that cost the previous session real time — do not repeat them
- **A worktree with a symlinked `node_modules` builds the WRONG JavaScript.** Metro follows the
  symlink and bundles the main checkout's sources, so your APK silently lacks your change. It
  happened twice. In any worktree, `node_modules` must be a REAL copy (`cp -cR`, ~25 s, APFS clone)
  or a real install. Before ANY device install, verify the bundle's provenance by reading the
  Metro sourcemap: every app source must be under YOUR worktree. If it is not, do not install.
- **Verify the installed APK by hash, not by name.** `adb shell pm path com.kalsa.app`, then
  `adb exec-out cat <path> | shasum -a 256`. A `-release`-named APK can still be DEBUGGABLE (that
  is what makes `run-as` work).
- **The app must be INSIDE a conversation** before a sent turn does anything. The home page says
  `Buon pomeriggio.` / `Cosa vuoi approfondire oggi?`; if you see those, no chat is open and the
  send produces markers but no turn. Check the UI dump, don't assume.
- **Engine invocation traps** (measured): `--slots` is NOT the slot count (that is `-np`); the slot
  save/restore route needs a JSON BODY (`-d '{"filename":"..."}'`) or it answers HTTP 500 and writes
  nothing; `--slot-save-path` is what enables the actions; the single-dash `-ctx-checkpoints` is
  REJECTED (use `--ctx-checkpoints` or `-ctxcp`).
- **A long-lived engine contaminates salt/checkpoint experiments** through its RAM prompt cache
  (this is upstream issue #27148, which our fork closes). One FRESH process per variant, always.
- **Do not invent agent profiles.** The configured ones (owner's `~/.paseo/config.json`): Skilled
  Coder = `pi` / `commandcode/deepseek/deepseek-v4.1-flash`; Explorer = same; Reviewer = `zcode-acp`
  / `builtin:zai-coding-plan\GLM-5.3-Flash` (mode `edit`, thinking `high`, feature `auto_accept`);
  Websearch = same as Reviewer (mode `yolo`); Free Coder open = `pi` / `mtplx/…ornith-1.5-35b-a3b-v2`.
  Provider rate limits bite: `commandcode/deepseek` returns 429s often, and the zai plan has a
  5-hour window. When an agent dies on a provider error, that is NOT a failed review or a failed run:
  resume it, do not treat it as a result.
- **Agents launched from the CLI do not notify you.** Poll (`paseo ls`, `get_agent_status`).
- **A false "I can see it" / "it passed" poisons everything.** Require evidence; an interrupted
  review is NOT a pass.

## 2. THE REPOS AND WHERE THINGS ARE
- `Aspis0/kalsa` — the PHONE app (`~/Projects/kalsa`, branch `main`) AND, on the `brain` branch, the
  DESKTOP app (a separate checkout at `~/Projects/kalsa-brain`, whose local branch is now renamed
  `brain`). `origin/main` = the phone app; `origin/brain` = the desktop. They are different
  lineages; never push one onto the other.
- `Aspis0/kalsallama` — the engine fork (`~/Projects/kalsallama`, `main`). `upstream.pushurl=DISABLED`.
- `Aspis0/kalsa.rn` — the binding fork (`~/Projects/llama.rn-kalsa`, `main`).
- `Aspis0/kalsa-moe-experiments` — the LAB (`~/Projects/kalsa-moe-experiments`): the two living docs
  (`PLAN.md`, `docs/ALIVE.md`), the frozen archive, the measurement cells and the reports under
  `scratchpad/agents/<cell>/REPORT.md`.
- The DESKTOP session ("the desk") is another Paseo session; coordinate with it, do not edit its
  work.

## 3. STATE, as of this handover
**Consolidation (done).** Every branch worth keeping is merged into the app's local `main`
(`e5788cf`), the engine's `main` (`9b39e43c7`), the fork's `main` (`0288dc27`) and the lab's `main`.
Worktrees: app 2 (main + brain), engine 1, fork 1, lab 1. `baseline-67c73d26c` is deliberately
excluded (pre-`vendor/` layout: merging it would undo the migration). NOTE: the app's `main` merges
are LOCAL-ONLY, not pushed — pushing is the owner's decision.

**Governor defects 5.1/5.2/5.3 (DONE, with evidence).**
- 5.1 engine `f2073505e`: a hot prefill now PAUSES (`-2`, non-latching) instead of being routed to
  the CPU. The test that asserted the defect was changed deliberately, old and new line quoted.
- 5.2 engine `61db879b8` + app `e5788cf`: the engine clears the latched plugged baseline on unplug;
  the app latches the battery temperature on the plug-in edge, converts tenths→degrees exactly once
  (the units trap: the engine reads DEGREES, the module returns TENTHS), refuses a baseline the
  engine would reject, and surfaces `failure_reason` in `KALSA_GOVERNOR` plus a
  `KALSA_GOVERNOR_FAILED` warn — the silent-failure defect is now visible.
- 5.3 engine `2b1ee43ab`: prefill routes by the REQUESTED engine and the stats name the context
  actually used. The test's config had to declare the GPU route to keep exercising the handoff.
- Proof: engine governor targets 8 built, 5 pass / 3 skip (no GPU backend in that build; hybrid
  needs `KALSA_HYBRID_GGUF`; mtp needs a model with MTP layers). App: `npx tsc --noEmit` clean,
  `npx jest --silent` 94 suites / 1213 tests green (was 1209).

**The METER (the app's energy trace) — works, with ONE blocker.**
What is PROVEN on the Jelly Star (`192.168.1.82:5555`): with `kalsa.bench.energy_trace = "1"` the app
writes `files/energy/<wall_clock_ms>-t<turnId>.csv`, schema `kalsa-governor-battery-trace-v2`, 9
columns, one row per second (median 1.016 s), voltage and charge counter matching the platform
exactly; with the key absent/`0` NO file appears (off-by-default proven with a turn in flight at
566–725 % CPU). The key is written with the repo's own helper (`scripts/ci-lib.sh` `sql_write`), and
the app must be force-stopped first (the helper enforces it).
THE BLOCKER: on the Jelly a turn does not complete — `KALSA_THINKING {"decodeTokPerSec":null}`,
ZERO tokens, `reason:"prefill"` for 1520 s, then `KALSA_STALL` → `Decoding Interrupted`; no crash,
no ANR. The owner states the Jelly with LFM has ALWAYS worked, so this is a REGRESSION we
introduced, not a phone limit. So the Meter has never been exercised over a turn that produced an
answer.
The two builds that matter: NEW = `/Users/marco/kalsa-local-artifacts/s23-repack-timing-app-release.apk`
sha256 `d56abe5f87cd352ad2e4f826203d1060be3fa8aa93e07c6a950606f51f3f1342`, pin `kalsa.rn#0288dc27`
= engine `4ccef2f85`; OLD ("policy") = sha256
`245c514c32f46acc8b04a9ceb5576d9507a64b614f6b8aa1b314f95bbbcfff3c`, built from `964dd53`, pin
`llama.rn#0f313bab`. The old APK is not on disk but is (probably) still installed on the S23 and can
be pulled with `pm path` + `adb exec-out cat`.
IN FLIGHT at handover: a coder is running a LADDER on the Jelly (verify the installed APK hash
first; be inside a chat; rung 0 = the smallest possible turn: new conversation, prompt `ok`, shortest
answer; then grow the OUTPUT only; then grow the INPUT only; report the first rung that fails; keep
the trace key ON so the first working rung also proves the Meter). If the ladder completes, the
failure needs a different trigger and the next step is the old-pin build (revert the dependency to
`llama.rn#0f313bab`, build with `/Users/marco/Projects/kalsa/local-artifacts/.build-s23-repack.sh`).

**Kernel / GPU (recon done, code unchanged).** Report 642 lines:
`~/Projects/kalsa-moe-experiments/scratchpad/agents/governor-gpu-recon/REPORT.md`. All six device-plan
defects still exist; TWO are asserted as CORRECT by passing tests
(`tests/test-governor-v0-turns.cpp:293-297`, `tests/test-governor-v02-router.cpp:141-147`), so fixing
them means deliberately turning a green suite red. On Android the GPU is reachable ONLY through the
governor (`resolveBackendPolicy` → `cpu-only / gpu-fit-gate-blind`, `n_gpu_layers=0`, the only
99-layer context is inside `load_governor_models`). The GPU `exit(1)` IS reachable in-app
(`ggml-opencl.cpp:1364`). The OpenCL program cache self-disables under Android's default temp dir,
and `GGML_OPENCL_USE_ADRENO_BIN_KERNELS` never enters the app build.

**The PLAN (the gate register, recovered).** `~/Projects/kalsa-moe-experiments/PLAN.md`:
G0 9 Sep; G1 15 Sep (closed early, 10 Sep: LFM2.5-2.6B is the model); G2 23 Sep (complete chat on the
CPU path); G3 29 Sep; G4 2 Oct; **M1 9 Oct** (first model complete and banked, reserve to 16 Oct);
M2 30 Oct; M3 20 Nov; a 12 Oct gate for the MiniCPM5 fine-tune decision. Critical path
G0→G1→G2→G3→G4→M1. **G2 is NOT claimed and M1 is NOT done.** GPU/V75/q4_K/NPU/governor are
evidence-gated in the 24–29 Sep window and are explicitly NOT "after M1".

**ENGINE DOOR / SALT (verified hostile cross-check, done).** Report 473 lines:
`~/Projects/kalsa-moe-experiments/scratchpad/agents/engine-door-salt-audit/REPORT.md`. Verdicts:
1 REAL (the context shift un-salts a slot; the fix is re-stamping from `slot.task->params.cache_salt`
at `server-context.cpp:3199`); 2 REAL for the salt wipe at `:2868` — but the sub-claim "the
update_cache branch is false whenever id_slot is given" is REFUTED; 3 REAL as code, benign today only
by accident; 4 REAL (FIFO eviction across namespaces); 5 REAL as code, not reachable through the
door (refuse, do not wrap); 6 PARTLY REAL — the mechanism is WRONG: under the defaults
(`slot_prompt_similarity = 0.1f`) `prompt_save` DOES copy the incumbent to the RAM cache first, so
the rescue is an accident of a default and needs an explicit save plus a survival assertion.
Chosen design: the restore takes the expected salt from the CALLER (plumbing `server-task.h:168-172`
+ `post_slots`, `server-context.cpp:5086-5115`), the shift re-stamps from `cache_salt` — ONE rule, TWO
changes. The save file carries NO device id, salt, checksum or model identity, so a well-formed
foreign file loads SILENTLY: corruption is caught, foreignness is not; cheapest fix is an
always-written owner/salt-hash stamp checked on restore (a format decision).
The branch question is CLOSED: `origin/b11010-merge` IS `2a290390d` and carries the inlet; only the
local ref was stale, and it has been fast-forwarded.

**SLOT SAVE/RESTORE NUMBERS (measured on the published engine `2a290390d`).** Report 526 lines:
`~/Projects/kalsa-moe-experiments/scratchpad/agents/slot-save-restore-measure/REPORT.md`.
One chat at 16k: **473 MiB with the default 32 checkpoints, 407 MiB with `--ctx-checkpoints 1`,
319 MiB with 0**; save median **0.55 s**, restore median **0.081 s**; after a restore the cache is
REUSED (`cache_n 14106`, 15 tokens re-evaluated on an identical continuation) not re-prefilled; the
conversation SURVIVES a full engine restart (`n_restored 16110`, cache reused, zero errors); a save is
LEGAL at any time but DEFERRED while the slot is busy (snapshot = end-of-generation state); a
mid-generation save took 8.13 s wall against 0.49 s engine time, so switching chats must wait for the
turn to finish. **`--ctx-checkpoints 1` is the right default** (warm resume identical to 32, 84 MiB
cheaper per chat); **0 is NOT a resume** (no checkpoint → the SWA/hybrid memory cannot be rewound →
`cache_n 0`, full 16,122-token re-prefill, 10.50 s). The flag default is 32, so the app MUST pass it
explicitly. A save taken after a turn's prefill carries a checkpoint at 16,117 and re-evaluates 10
tokens (0.21 s) — warm at the end, which is the only resume point the design cares about.

**The checkpoint attribution is DONE** in the engine: commit `9b39e43c7`, comments only (+22/−0), at
`tools/server/server-context.cpp:2394-2400` and `tools/server/tests/unit/test_slot_save.py:15-21`.
It says the appendix "follows the design of upstream PR `ggml-org/llama.cpp#26004` by Tough-Respawn
(2026-07-22, open, not merged, fixes #25913)", brought in by `51b9e6a7f`, and names our hardening
(size assertion, error instead of warning on a bad trailer, bounded reads, atomic temp-file-and-rename
path). Wording rule honoured: "follows the design of" — never "copied from".

**UX is NOT ours.** The owner runs his own UX session in the workspace `kalsa-ux`
(`~/Projects/kalsa-ux`, branch `ux-2026-09-21`): the whole interface is being redone FROM SCRATCH and
the ONLY survivor is the palette in `src/theme/tokens.ts` (the comment citing `labbook-v2.css` is
wrong — that file never existed anywhere, including the git history). It has written
`docs/DESIGN.md` (uncommitted, no push). The two measured viewports: Jelly 480×854 @220 dpi =
349×621 dp on a 3-inch screen (the hard case; the app area can shrink to 480×447 px), S23 1080×2340
@480 dpi = 360×780 dp. Design for the Jelly first: the logical widths are nearly identical (349 vs
360 dp), so a layout that breaks only on width hides its bug.

**The DESKTOP line**: pushed to `origin/brain` = `29461e3` (four commits: chats on disk, the
attribution, "this computer is device 1" with seven findings fixed and 748 tests green, plus the plan
for one chat resident). Its local branch is `brain` now (it used to be called `main` while tracking
`origin/brain`, which nearly caused a catastrophic push).

## 4. WHAT IS OPEN
1. **The Meter on the Jelly** — the ladder, then possibly the old-pin build (see above). This is the
   owner's priority: ONE door at a time, close it.
2. **The engine half of the disk-chat design**, requested by the desk: three numbers for the UX —
   how much is lost with two streams at once, whether idle slots occupy RAM, and whether the engine
   allows a different context window per slot. Not started.
3. Everything else on the governor (5.4 dead lanes, 5.5 the 1-token remainder, 5.6 CRITICAL's exit)
   is understood but NOT fixed, and belongs to the next step of the plan's Part 9 order.

## 5. THE DISCIPLINE the owner expects from you
- One door at a time: do not open a new front while one is open; close, then move.
- Delegate: Explorer → coder → independent reviewer. The Explorer must be told NOT to spawn
  sub-agents. Coder prompts carry the code-quality rules (no file past ~350–450 lines BY the change,
  no useless comments, minimal imports, no unrequested refactoring).
- A report written inside a Paseo worktree is destroyed when the worktree is archived: commit it or
  print the numbers.
- Long responses from a provider can be truncated: have agents write reports INCREMENTALLY, one
  section per response.
- Never benchmark while a phone is charging, never uninstall (`adb install -r` only), never clear app
  data, and leave every device as it was found.
- Tell the owner the truth about failures, including your own mistakes, with the evidence - and
  report what you could NOT verify as explicitly unverified.
