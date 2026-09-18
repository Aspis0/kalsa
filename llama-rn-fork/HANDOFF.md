# HANDOFF — finishing the llama.rn fork migration (Steps 2c → 6)

Written 2026-09-17 ~16:30 EDT by the orchestrating session (the orchestrator; session NAMES
change on every restart — find the current one with ListAgents, e.g. kalsa-5b on 17/09 evening) for the Opus session
that takes the remaining steps. Everything in §1 was verified on disk at that time; re-verify
with the commands given before asserting any of it — both repos move.

The owner's rule for this handoff: **the executing session does the steps; the orchestrator
is called only where a step cannot proceed or a question needs a human/orchestrator
decision.** Escalation points are marked ⛔ ASK. Marco has told both peer sessions (KV and
fork execution) to ask the orchestrator for technical questions.

---

## 0. Rules that bind every step (do not skip)

All of `~/.claude/CLAUDE.md` applies (one tool call per message, Paseo-only delegation,
writer ≠ reviewer MODEL, one hostile audit per step, real exit codes, `git add` by explicit
path, a delegate's output is not evidence). Plus the migration-specific ones:

- **Do not touch on the app's `main` without warning Marco first:** `patches/`, `vendor/`,
  `native/kalsallama.pin`, `src/engine/LlamaService.ts`. They belong to the KV session
  (kalsa-0c on 17/09; re-check with ListAgents), which is HOLDING until this migration lands. Step 4 deletes three of them: it
  is announced, not sneaked in.
- **Push policy.** Committing is always fine. Pushes already authorised by Marco: fork
  `Aspis0/llama.rn` (any branch), app branches `llama-rn-fork` and `baseline-67c73d26c`
  (CI-only). **Pushing to app `main` needs his explicit go each time.** Never push to
  `mybigday/llama.rn`, never open upstream issues (`ggml-org`, `mybigday`).
- **Builds happen in CI** (`apk.yml` on `Aspis0/kalsa`, `workflow_dispatch`, inputs `abi` and `debuggable`, the latter defaulting to `false`).
  Local builds only for syntax gates. **One device check per fix**, on the S23, debuggable
  APK. No benchmark campaigns.
- **Docs at every step:** append to `kalsa-moe-experiments/docs/ALIVE.md` (diary, evidence,
  run ids, hashes) and update the status lines in `PLAN.md` §"17/09 sera — fork di llama.rn";
  commit the lab. Update the memory file
  `~/.claude/projects/-Users-marco-Projects-kalsa/memory/llama-rn-fork-migration-state.md`.
  Lab repo is private; app and fork repos are public — nothing private goes into their
  commit messages or docs.
- Italian in chat with Marco; English in code, commits, docs.
- **Time window.** The machine is on EDT. GLM (`Coder`, `Explorer`) is allowed 11:00–21:00
  local; outside that window Luna/DeepSeek only (see memory
  `night-window-luna-and-deepseek-only.md`; re-read `~/.paseo/config.json` at each dispatch).

### Roster and agents to RESUME (Paseo `send_agent_prompt`, never re-create)

| role | provider/model | settings | agent id | context it holds |
|---|---|---|---|---|
| Coder, fork | `zcode-acp/builtin:zai-coding-plan\GLM-5.3-Flash` | `modeId: yolo`, thinking high | `e39bdd71-2e22-4651-8cb5-24d933f61ab6` | wrote every fork commit since `eb9a6da7`; knows `sync-kalsallama.sh`, the gate, the rewire |
| Coder, app switch | same | same | `45ab2026-f055-4d36-8a2e-f2a495c44a0c` | wrote the 5 switch commits (engine id, plugin, lock) |
| Reviewer, fork | `pi/opencode-go/deepseek-v4.1-flash` | thinking max | `e5220fda-74fc-4a8d-9cb5-b6abb9ddf36a` | three hostile audits of the fork; knows the MTP/shared-KV premise |
| Reviewer, app | same | same | `bd1aa19c-afb5-46ad-8dfb-d07daba51f08` | audited the engine id |

Peer Claude sessions on this machine (ListAgents / SendMessage; names change on restart, so
always re-list before sending): the KV-cache session (kalsa-0c on 17/09; owns the four paths
above; holding), the orchestrator (kalsa-5b on 17/09 evening), kalsa-brain sessions (unrelated).
The KV session may work meanwhile ONLY on: native code in the fork on its own branch `kalsa-kv`
off `kalsa` (never directly on `kalsa`, never in `patches/`/`vendor/` on main), and JS/TS on
main outside the switch files; its device checks wait for the switch.

### The audit brief (paste into every review dispatch)

> Be hostile. Find everything wrong. Angles, in this order: security/secrets, privacy, bugs
> (null/off-by-one/equality/stale state), race conditions and atomicity, memory/resource leaks,
> edge cases (empty/first/last), test hygiene; dead code last. Methodology: line-by-line on the
> diff, removed-behaviour check (what did the old code do that the new one does not), cross-file
> tracer (every caller of every changed symbol), reuse/simplify/efficiency, altitude (does the
> design still hold). Verdict per finding: CONFIRMED / PLAUSIBLE / REFUTED, with **the line you
> read quoted verbatim and its `file:line`**. Reproduce claims with commands where possible.
> Read-only: do not edit, do not commit, do not delegate.

---

## 1. State of the world (verified 2026-09-17 16:10 EDT)

| what | where | state |
|---|---|---|
| Fork | `/Users/marco/Projects/llama.rn-kalsa`, branch `kalsa`, `origin`=Aspis0, `upstream`=mybigday | head `628f4517`, PUSHED (`origin/kalsa == kalsa`); `kalsa-step1@4b823e95` pushed too |
| Fork pin | `kalsallama.pin` at the fork root; marker `cpp/KALSALLAMA_SHA` | `134a35cf201f3a9c4b25eb32768198b8cb3f3c5d` (= kalsallama `main` HEAD today, 0 commits ahead) |
| Fork commits | `987799a1` kalsa patch set → `eb9a6da7` sync script → `bb4a2c60` hardening → `de67c015` allow-list +23 & llama-ext rewrite → `bff76818` rewire of the 10 API drifts → `49546c8d` honest gate → `a0bfc383` advisory draft rollback → `5d679fef` gate + opencl → `57c530cc` init probe (fenced draft → plain) → `628f4517` nextn off on fallback | all audited (four hostile audits + one targeted re-audit, all "ship") |
| App switch worktree | `/Users/marco/Projects/kalsa-fork-switch`, branch `llama-rn-fork`, branched from `5de99f3` | `0fc723b` → `ecc0c08` → `ed1994e` → `52f88b3` → `f39c757` (dep = fork `4b823e95`, old pin). Pushed. |
| App `main` | `/Users/marco/Projects/kalsa` (shared checkout, dirty with kalsa-07's untracked files — do not clean it) | `f0e4e2b`, 10 commits ahead of the branch point; only `ad7ff7d` touches a switch file (`apk.yml`/`e2e-emulator.yml`: the `assert-overlay-includes` step). **Not natively buildable since `c4d23be`** (rn-* API drift at the new pin) |
| Old-road baseline | app branch `baseline-67c73d26c` = `3ce0992` | run `35254554590` green; control `35258973938` byte-identical (NDK pipeline is reproducible) |
| Lab | `/Users/marco/Projects/kalsa-moe-experiments` (`69690b03`) | `llama-rn-fork/{manifest.sh, baseline-3ce0992.manifest, baseline-3ce0992.so.sha256, baseline-3ce0992.control.so.sha256, fork-f39c757.so.sha256}` |
| kalsallama | `/Users/marco/Projects/kalsallama`, `main` = pin | `origin` = Aspis0/kalsallama (private) |

**Proven.** Step 1 = "the fork at the old pin is the shipped engine": source 745/745 files
(only the marker's name differs) and binary **38/38 `.so` sha256-identical** (run
`35263920678` on `f39c757` vs `35254554590`). Non-vacuity of the comparison: a one-byte
mutation of the baseline list makes the diff exit 1.

**Not proven.** Anything about the new pin `134a35cf2` + the rewired rn-* files: it has never
been built in CI nor run on a phone. That is Step 2c, the success criterion of the whole
migration ("poter aggiornare a seconda dell'upstream senza rompere quasi niente").

**Measured, so do not re-litigate.** npm 11.16 writes `git+ssh://git@github.com/…#sha` into
the lock even for a `git+https://` spec; `npm ci` with an empty cache and
`GIT_SSH_COMMAND=/usr/bin/false` exits 0 (pacote clones hosted GitHub over https first). The
lock's ssh form is harmless on runners without keys. Integrity of a git dep is npm's own pack
digest and was identical across fresh installs.

---

## 2. Step 2b — close the rewire (DONE 2026-09-17 evening EDT: head `628f4517` pushed; verify, do not redo)

Goal: fork `kalsa` head = `49546c8d` + commit A ("the draft rollback is advisory; a slot
whose MTP init fails re-queues its prompt") + commit B ("gate parses ggml-opencl too; hexagon
headers resolve; setup action stops re-installing"), fourth hostile audit clean, pushed.

Check first:
```
cd /Users/marco/Projects/llama.rn-kalsa && git status --short && git log --oneline -4
git branch -r --contains HEAD | grep -q 'origin/kalsa' && echo PUSHED || echo NOT-PUSHED
```
If `NOT-PUSHED` or the two commits are missing, the orchestrator is still on it: ⛔ ASK
before touching the fork. If pushed, read ALIVE's last entries for the audit outcome and go
to §3.

Verification recipe for any fork commit (also used in §6):
```
cd /Users/marco/Projects/llama.rn-kalsa
KALSA_BMOE_DIR=/Users/marco/Projects/kalsa/native/bmoe/rn scripts/assert-cpp-includes.sh > /tmp/gate.log 2>&1; echo $?
grep -n 'OK\|PARTIAL\|FAIL' /tmp/gate.log | tail -3      # expect one "OK … TUs parse" line, no PARTIAL
KALSA_BMOE_DIR=/Users/marco/Projects/kalsa/native/bmoe/rn KALSALLAMA_SRC=/Users/marco/Projects/kalsallama \
  scripts/sync-kalsallama.sh verify > /tmp/verify.log 2>&1; echo $?
```
Both must be 0. `verify` proves `cpp/` == flatten(pin) + `scripts/kalsa-patches/*` and that
the marker equals the pin. The gate is ~100 s.

---

## 3. Step 2c — the first engine update (THE success criterion)

**Goal.** The app on `llama-rn-fork` moves from fork `4b823e95` (old pin) to the audited
`kalsa` head (pin `134a35cf2` + rewired rn-*). CI green, `.so` produced, one device check.

**Preconditions.** §2 pushed. Fork head audited.

**Do** (in the worktree, branch `llama-rn-fork`):
```
cd /Users/marco/Projects/kalsa-fork-switch && git status --short          # must be clean
FORK_SHA=$(git -C /Users/marco/Projects/llama.rn-kalsa rev-parse kalsa)
git -C /Users/marco/Projects/llama.rn-kalsa branch -r --contains $FORK_SHA | grep origin/kalsa   # must print
npm pkg set "dependencies.llama.rn=git+https://github.com/Aspis0/llama.rn.git#$FORK_SHA"
npm install > /tmp/npm-install.log 2>&1; echo $?
cat node_modules/llama.rn/cpp/KALSALLAMA_SHA                               # 134a35cf201f3a9c4b25eb32768198b8cb3f3c5d
grep -c 'kalsa-native-patches' node_modules/llama.rn/cpp/common/common.cpp # ≥ 1 (the marker assert-native-patch.sh looks for in the binary)
grep -n '"resolved"' package-lock.json | grep llama.rn                     # …#$FORK_SHA (ssh or https form, both fine)
node scripts/engine-build-id.js                                            # new id; differs from the one on f39c757
npx tsc --noEmit > /tmp/tsc.log 2>&1; echo $?
npx jest src/engine/engineIdentity.test.ts > /tmp/jest.log 2>&1; echo $?; tail -3 /tmp/jest.log
git add package.json package-lock.json
git commit -m "build: llama.rn at the fork's audited head (engine 134a35cf2, rn-* rewired for its memory and mtmd APIs): the first engine update"
git push origin llama-rn-fork
gh workflow run apk.yml --repo Aspis0/kalsa --ref llama-rn-fork -f abi=arm64-v8a -f debuggable=true   # debuggable defaults to false: the S23 policy and run-as need true
```
Then get the run id and watch it in the background (the tool timeout is 600 s; `gh run watch`
must run detached, e.g. Bash `run_in_background`, log to a file, and be re-armed if lost):
```
RUN=$(gh run list --repo Aspis0/kalsa --workflow apk.yml --branch llama-rn-fork -L1 --json databaseId -q '.[0].databaseId'); echo $RUN
gh run watch $RUN --repo Aspis0/kalsa --exit-status > /tmp/ci-update.log 2>&1; echo "exit=$?" >> /tmp/ci-update.log
```
The build takes ~45 min. Do not poll; do other work (e.g. prepare §4's docs diff).

**Nothing fires automatically on `llama-rn-fork`** (verified 2026-09-17 with kalsa-0c: `ci.yml`
pushes only on `feat/**`, `e2e-emulator.yml` on `main`/two legacy branches, everything else is
dispatch-only). "Green on the branch" means green on runs YOU dispatched. So dispatch both gates:
```
gh workflow run apk.yml --repo Aspis0/kalsa --ref llama-rn-fork -f abi=arm64-v8a -f debuggable=true   # debuggable defaults to false: the S23 policy and run-as need true
gh workflow run e2e-emulator.yml --repo Aspis0/kalsa --ref llama-rn-fork    # defaults = what a push to main runs (~35-40 min, ~40 logic harnesses + one real inference turn)
```
and run `npx tsc --noEmit` and the jest file locally with real exit codes (they run in no
workflow on this branch).

**Prove.**
1. `gh run view $RUN --json conclusion` = `success` for BOTH runs; in `apk.yml` the steps "Assert
   the native patch is in the binary" and "Build APK (arm64-v8a)" green; in `e2e-emulator.yml`
   the harness step and the inference turn green.
2. Hashes (recipe verified today):
   ```
   mkdir -p /tmp/apk-$RUN && cd /tmp/apk-$RUN && gh run download $RUN --repo Aspis0/kalsa
   mkdir x && (cd x && unzip -q -o ../*/app-release.apk 'lib/arm64-v8a/*')
   (cd x/lib/arm64-v8a && shasum -a 256 *.so | sort -k2) > /Users/marco/Projects/kalsa-moe-experiments/llama-rn-fork/fork-<app sha7>.so.sha256
   diff <(awk '{print $2}' …/baseline-3ce0992.so.sha256) <(awk '{print $2}' …/fork-<sha7>.so.sha256)   # same 38 names
   ```
   The hashes WILL differ from the baseline (new engine). Record which differ: expect every
   `librnllama*` and `libggml*`; JS-only libs identical. If a lib that does not link the engine
   differs, say so in ALIVE and find out why before moving on.
3. **Device check (one).** S23, `adb install -r` of the debuggable APK, load the shipped model
   (LFM), one chat turn; expect the usual tok/s band and no native crash in
   `adb logcat | grep -E 'KALSA|rnllama|GGML_ASSERT|SIGSEGV'`. Then, **only if a model with
   `mtp.defaultEnabled === true` is in the catalog and on the phone** (find it with
   `git grep -n 'defaultEnabled' src/`), one turn with it; what to expect depends on the
   target's memory type (grep the exact log texts from commits A and C in `cpp/rn-*.cpp`):
   - dense target (draft KV shared with the target): at pin `134a35cf2` kalsallama fences
     decode from a shared cache (`llama-kv-cache.cpp:757`, WIP tag `TAG_KV_CACHE_SHARE_CELLS`),
     so MTP cannot draft at all; expect ONE error line at init ("cannot decode from a KV cache
     shared with the target … running plain"), then a normal plain answer, no per-token
     `SPC_ERR`/`LLAMA_LOG_ERROR` lines, no `GGML_ASSERT`;
   - hybrid target (Qwen3-Next class, `other == nullptr`): MTP runs; expect draft tokens and
     no "refuses rollbacks" line (that line is reachable only if the cache's sharing changes
     after init).
   A completed answer either way. LFM has no MTP head, so the rewire's MTP paths cannot be
   exercised on it — say so in ALIVE rather than implying they were.
   ⛔ ASK if no MTP model is available: the orchestrator decides whether the evidence stays
   compile-only.

**If CI is red.** The defect is in the fork (rewire, gate, or a new drift), never patched in
the app: fix in the fork (resume Coder e39bdd71), audit (Reviewer e5220fda), push, re-bump the
sha in the app (same commands), new run. Record every red run id and its first error line.

**Record.** ALIVE: run id, sha pairs, which `.so` changed, device numbers. PLAN: Step 2c
status line. Memory file. Lab commit.

**Rollback.** `git revert <bump commit>` + `npm install` on the branch: back to `4b823e95`.

---

## 4. Step 3 — the switch lands on `main` (⛔ ASK: warn Marco BEFORE, get his go to push)

**Goal.** `main` depends on the fork; `postinstall` (overlay + patch-package) is gone;
`patches/`, `vendor/`, the pin and `sync-kalsallama.sh` stay on disk but are inert (they are
the rollback). One merge commit on `main`, reversible with one command.

**Preconditions.** §3 green on the branch. Tell Marco, in Italian, exactly: from this commit
`patches/` has no effect, `npm ci` no longer runs the overlay, the engine id changes once (all
KV sidecars regenerate once), and the KV session's four paths will be deleted in Step 4.
Wait for his go before pushing. Tell kalsa-07 the switch is about to land.

**Do.** First bring `main` into the branch, so conflicts are resolved and proven on the branch:
```
cd /Users/marco/Projects/kalsa-fork-switch && git fetch origin main
git merge --no-ff origin/main > /tmp/merge-main.log 2>&1; echo $?
git diff --name-only --diff-filter=U        # expected: at most .github/workflows/apk.yml
```
Conflict rule for `apk.yml`: keep BOTH — main's `assert-overlay-includes.sh` step after
`npm ci` (it reads the installed tree, still valid) and the branch's env/comment edits.
`src/engine/LlamaService.ts` is NOT touched by the switch; if the merge ever conflicts there,
stop: `f0e4e2b` pinned two literals in it (`if (AppState.currentState !== "active") {` with
`reason: "background"` and a `return;`, ~line 997) through `scripts/prefixPrewarmHarness.mjs`,
wired into `apk.yml`, `bench.yml` and `e2e-emulator.yml` — kalsa-0c owns that pin and re-aims it
on request; never weaken it. The branch forked at `5de99f3`, BEFORE that wiring, so none of the
three workflow files on the branch has the `node scripts/prefixPrewarmHarness.mjs` line yet; a
plain merge keeps it, a "take ours"/regenerated file drops it. After the merge, on the merged tree:
```
for w in apk bench e2e-emulator; do printf "%-14s " $w; grep -c prefixPrewarmHarness .github/workflows/$w.yml; done   # expect 1 1 1
```
The failure modes are not symmetric (kalsa-0c, 2026-09-17): dropped from `apk.yml` →
`matrixParityHarness` fails loudly; dropped from `bench.yml` → parity still passes, SILENT;
dropped from `e2e-emulator.yml` → the harness stops running on main and nothing catches it.
Then:
```
npm ci > /tmp/npm-ci.log 2>&1; echo $?; grep -c 'patch-package' /tmp/npm-ci.log   # 0
cat node_modules/llama.rn/cpp/KALSALLAMA_SHA
node scripts/engine-build-id.js               # same id as §3 (same installed tree)
npx tsc --noEmit > /tmp/tsc.log 2>&1; echo $?
npx jest src/engine/engineIdentity.test.ts > /tmp/jest.log 2>&1; echo $?
git commit … ; git push origin llama-rn-fork
gh workflow run apk.yml --repo Aspis0/kalsa --ref llama-rn-fork -f abi=arm64-v8a   # must be green again
gh workflow run e2e-emulator.yml --repo Aspis0/kalsa --ref llama-rn-fork           # the gate main will run: green BEFORE asking Marco's go
```
Then, in a scratch clone (never in the shared `/Users/marco/Projects/kalsa` checkout):
```
git clone -q https://github.com/Aspis0/kalsa.git /tmp/kalsa-switch && cd /tmp/kalsa-switch
git merge --no-ff origin/llama-rn-fork -m "build: the engine comes from Aspis0/llama.rn (cpp/ = kalsallama); no overlay, no patch-package

One engine copy. llama.rn is a git dependency pinned by sha; its cpp/ is kalsallama
<pin> flattened plus the kalsa native patch set as tracked source. postinstall is gone.
patches/, vendor/kalsallama-cpp/, native/kalsallama.pin and scripts/sync-kalsallama.sh
remain for one release as the rollback and are removed in the cleanup commit.
Engine id: kalsa-eng-v2 over the installed tree; every KV sidecar regenerates once."
npm ci > /tmp/npm-ci-main.log 2>&1; echo $?
node scripts/engine-build-id.js; npx tsc --noEmit > /tmp/tsc.log 2>&1; echo $?
```
Hand the merge sha to Marco; **push only on his go**: `git push origin main`.

**Prove (after the push).**
- `e2e-emulator.yml` runs on push to `main` (the only automatic gate on main): green, including
  `assert-overlay-includes.sh` and `assert-native-patch.sh`.
- `gh workflow run apk.yml --ref main -f abi=arm64-v8a`: green; its `.so` hashes ==
  §3's hashes (same fork sha, reproducible NDK) — that is the proof the merge did not change
  the engine.
- Tell kalsa-07 (SendMessage): the switch landed; KV work resumes; native changes now go to
  the fork (`rn-*`/`jsi/`) or to kalsallama + `scripts/sync-kalsallama.sh pin <sha>` in the
  fork, then a sha bump in the app; `patches/` and `vendor/` are dead — do not edit them.
- The shared checkout: whoever owns it runs `git pull --ff-only` and `npm ci`; do not do it
  for them.

**Record.** ALIVE, PLAN (Step 3 status), memory file; also mark as superseded in memory:
`kalsa-vendor-never-edited-by-hand.md`, the patch-package lines in
`kalsa-moe-stream-port.md`, `kalsa-engine-single-lineage.md`, `kalsa-repo-map.md` (edit them
to say "since <merge sha>: the fork is the only engine source"; do not delete history).

**Rollback.** `git revert -m 1 <merge sha> && npm ci` (postinstall returns, overlay and
patch-package run again, `vendor/`/`patches/` still there). One command, tested mentally
only — if it is ever needed, test it in the scratch clone before pushing the revert.

---

## 5. Step 4 — cleanup (after `main` CI is green on the switch; announce the deletions)

**Goal.** Remove the old road and its docs; add the provenance gate; the binary must not
change.

**Remove** (one commit, `git rm` by path):
- `patches/` (the whole dir), `vendor/kalsallama-cpp/` (715+ files), `native/kalsallama.pin`,
  `scripts/sync-kalsallama.sh`, `scripts/assert-vendor-pristine.sh`, devDependency
  `patch-package` (`package.json:74`) and its lock entries (`npm uninstall patch-package`).
- Keep: `scripts/assert-native-patch.sh` (binary marker), `scripts/assert-overlay-includes.sh`
  (reads the installed tree; rename the comment, not the file), `native/bmoe/` (compiled by the
  fork's CMake via `${RNLLAMA_LIB_DIR}/../../../native/bmoe`, `if(EXISTS)`),
  `plugins/withLlamaFromSource.js` (throws on opt-out since the switch).

**Add** `scripts/assert-engine-provenance.sh`, **wired into CI** in `e2e-emulator.yml` and
`apk.yml` right after `npm ci` (this reverses the original "manual gate" instruction: its
reasoning was that the lock's integrity binds the install, and a git dependency's `integrity`
is verified by nobody — measured in this migration — while what npm installs is the fork's
`npm pack` output, not its commit tree). It reads `package-lock.json` → `packages["node_modules/llama.rn"].resolved`, accept
both `git+ssh://git@github.com/Aspis0/llama.rn.git#<sha40>` and the https form; fetch
`https://codeload.github.com/Aspis0/llama.rn/tar.gz/<sha40>` into `/tmp`; `npm pack` that
tree (the fork has no `prepack`/`postinstall`, so pack is inert) and extract; sha256 manifest
of the tarball vs `node_modules/llama.rn` minus `android/.cxx`, `android/build`, `ios/build`,
`node_modules`; exit 1 with the first differing path. **Non-vacuity, in the commit message:**
flip one byte in `node_modules/llama.rn/cpp/rn-llama.cpp`, script exits 1 naming it, restore.
Write clean code: one file, < 150 lines, `set -euo pipefail`, no globals beyond the paths.

**Docs and comments to rewrite** (line numbers from `main@f0e4e2b`; re-grep):
`ARCHITECTURE.md:20-59` (the three-source section becomes one source: the fork, its pin, its
patch dir, `verify`), `REPOS.md:23-24`, `.github/workflows/apk.yml:52-56` and
`e2e-emulator.yml:65-69` (comment only), `dflash-ab.yml:10` (still credits
`patches/llama.rn+0.12.8.patch`), `bench.yml:107,181-183`, `build-kalsa-apk.yml:48-59`
(`KALSA_LLAMA_FROM_SOURCE: "1"` is now the only value; leave it or drop it, say which),
`scripts/engine-build-id.js` header (residual R1: it overclaims "a checkout and an npm install
hash the same" — npm also strips `*.orig`, `*.rej`, lockfiles; R2: completeness checks
existence, not emptiness; R3: `statSync` unwrapped). Memory files listed in §4.

**Prove.**
```
git grep -n 'patch-package\|sync-kalsallama\|assert-vendor-pristine\|kalsallama\.pin\|vendor/kalsallama-cpp' -- ':!archived' ':!docs' ':!node_modules'   # empty
npm ci > /tmp/npm-ci.log 2>&1; echo $?
bash scripts/assert-engine-provenance.sh > /tmp/prov.log 2>&1; echo $?     # 0, then the mutation → 1
```
CI: e2e on push (after Marco's go), `apk.yml` dispatch: `.so` hashes **identical** to Step
3's — the cleanup removed dead weight, nothing else. If a hash moves, the cleanup touched a
build input: find it before pushing anything else.

**Audit.** One hostile pass (Reviewer bd1aa19c or e5220fda; the writer must not be the same
model). Angle to stress: "removed behaviour" — what did `assert-vendor-pristine.sh`,
`postinstall` and the pin check guard that nothing guards now? The answer must be written
into ARCHITECTURE.md's "what we lose" table (PLAN.md has the draft table).

**Rollback.** `git revert <cleanup sha>` (brings the files back; they are inert anyway).

---

## 6. Step 5 — the update mechanism, exercised twice (separate session, NEVER with 3/4)

Two halves. Both end with an app sha bump, CI green, one device check. Record the number of
conflicts and the minutes spent: that number is the migration's real result.

### 6a. `bump` — a new kalsallama commit reaches the fork

Today kalsallama `main` == the pin (`134a35cf2`), so:
```
cd /Users/marco/Projects/llama.rn-kalsa && unset KALSALLAMA_SRC     # bump refuses KALSALLAMA_SRC by design
KALSA_BMOE_DIR=/Users/marco/Projects/kalsa/native/bmoe/rn scripts/sync-kalsallama.sh bump > /tmp/bump.log 2>&1; echo $?
git status --short | wc -l                                          # 0: idempotent at the same pin
```
That idempotence run is a valid first proof of the mechanism; do it now. The real exercise
happens when kalsa-07 lands a kalsallama commit on `main`: `bump` again, `verify` 0, gate OK,
commit `engine: kalsallama <sha7> (<one line of what changed>)`, push, app bump (§3 commands),
CI, device. If `bump` changes any file outside `cpp/` + `kalsallama.pin`, stop: that is a
script defect (⛔ ASK).

### 6b. `git merge v0.12.9` — upstream llama.rn reaches the fork

```
cd /Users/marco/Projects/llama.rn-kalsa && git checkout kalsa && git fetch upstream --tags
git diff --name-only v0.12.8 v0.12.9 -- cpp | grep -E '^cpp/(rn-|jsi/|ggml-ext\.h|anyascii)'   # the llama.rn-owned files upstream changed (7 expected)
git diff --stat v0.12.8 v0.12.9 -- . ':!cpp' | tail -1
PRE=$(git rev-parse HEAD)
git merge --no-commit --no-ff v0.12.9 > /tmp/merge.log 2>&1; echo $?
git diff --name-only --diff-filter=U | tee /tmp/conflicts.txt | wc -l   # RECORD
```
Resolution rules, in order:
1. **Engine files** (`cpp/**` except the 36 llama.rn-owned): resolve any way, e.g.
   `git checkout --theirs -- <paths>`; they are regenerated in step 3 below. Never hand-merge
   them.
2. **The 36 owned files** (`cpp/rn-*`, `cpp/jsi/`, `cpp/ggml-ext.h`, `cpp/anyascii.*`): read
   upstream's diff line by line against our hunks. Our hunks are commit `987799a1` (the kalsa
   patch set) plus `bff76818`/commit A (the rewire): `git show 987799a1 -- cpp/rn-slot.cpp`
   etc. Real risk: upstream 0.12.9 rn-* may call llama.cpp APIs newer than kalsallama's base;
   the gate's syntax pass catches it — fix on OUR side (adapt the call), never by editing
   engine files.
3. `package.json`: the merge may re-add `postinstall`/`prepack` (removed in the fork so
   pacote does not run `npm install` in the clone) — remove them again; keep the version bump.
   `.gitignore`: `lib/` must stay tracked (upstream ignores it). `.github/workflows/sync-llama-cpp.yml`
   was deleted in `bb4a2c60` (it would regenerate `cpp/` from upstream): delete it again if it
   returns.
4. Regenerate the engine and commit as one merge commit:
   ```
   KALSA_BMOE_DIR=/Users/marco/Projects/kalsa/native/bmoe/rn KALSALLAMA_SRC=/Users/marco/Projects/kalsallama \
     scripts/sync-kalsallama.sh pin 134a35cf201f3a9c4b25eb32768198b8cb3f3c5d > /tmp/pin.log 2>&1; echo $?
   KALSA_BMOE_DIR=… KALSALLAMA_SRC=… scripts/sync-kalsallama.sh verify > /tmp/verify.log 2>&1; echo $?
   npm ci > /tmp/npm-ci.log 2>&1; echo $?; npm run build > /tmp/bob.log 2>&1; echo $?   # src/ changed → lib/ changes
   # typecheck/test/lint mean something ONLY from fork commit 24fb7098 + 653e2ddb on:
   # before those, `sync` left its clone in tmp/ and all three tools read it.
   npm run typecheck > /tmp/tc.log 2>&1; echo $?; npm test -- --maxWorkers=2 > /tmp/jest.log 2>&1; echo $?
   git add -A cpp lib src package.json package-lock.json .gitignore .github   # explicit paths; check `git status` first
   git commit -m "merge: llama.rn v0.12.9 (N conflicts: <list>); engine regenerated from the pin"
   ```
   `verify` at 0 after the merge is the proof that no upstream engine code leaked into `cpp/`.
5. Hostile audit of the merge commit (Reviewer e5220fda): the 7 owned files, line by line,
   against both parents. Then push `kalsa`, app bump, CI, hashes (expect only `librnllama*`
   to change), one device check.

**Rollback.** Before push: `git reset --hard $PRE`. After: `git revert -m 1 <merge>`; the app
keeps its previous sha until you bump it.

**Record.** Conflict count, the files, the time, what upstream changed in rn-* and how it was
reconciled. This entry is what Marco reads to judge whether the migration paid off.

### INVENTORY of the dry run (18/09, branch `kalsa-v0129` off `kalsa@fada1ebe`, pin `70b4302bb`)

`git merge --no-commit --no-ff v0.12.9` → exit 1, **45 conflicted paths**: 42 content (UU) and 3
delete/modify (DU). Nothing is hand-merged yet; the branch is not pushed and `kalsa` is untouched.

**A. Engine files — 40 UU + 1 DU, resolve `--ours`, then regenerate.** Everything under `cpp/`
except the two binding files below: `common/` (8), `llama-*` + `llama.cpp` + `llama.h` (14),
`models/` (5), `tools/mtmd/` (7), `ggml-metal/` (4), `ggml-backend.cpp`, `ggml-cpu/ggml-cpu.cpp`,
`ggml-opencl/ggml-opencl.cpp`. These are upstream's vendored llama.cpp against ours: they are
regenerated from the pin, so `--ours` then `sync-kalsallama.sh pin 70b4302bb…` and a clean
`git status` is the whole proof. (The playbook line above suggests `--theirs`; prefer `--ours`, so
a skipped regeneration leaves our engine rather than upstream's.)
The DU is **`cpp/ggml-metal/ggml-metal.metal`**: deleted on our side because at this pin the shader
is split into `cpp/ggml-metal/kernels/*.metal` (23 files), still modified by upstream at v0.12.9.
Keep it deleted — and see §7: this is the same fact that breaks the iOS embed.

**B. Binding files — 2 UU, 5 hunks, and they are all ONE drift.** `cpp/rn-completion.cpp` (2 hunks,
at the two MTP rollback sites) and `cpp/rn-slot.cpp` (3 hunks). Upstream v0.12.9 replaced the raw
removal calls with the `common_memory` helper:
```
common_memory memory;
memory.init(parent_ctx->ctx, spec_ctx.get());
memory.seq_rm(seq_id, spec_n_past, -1);
```
while ours call `rn_seq_rm(...)` and branch on the result (`draft_rollback_fenced`, and a throw at
the target-side site). **Take OURS, and the reason is not taste:** that helper exists in our engine
too (`cpp/common/common.h:1018`), and its own comment at :1023 says `// aborts execution on
failure`. Upstream can abort; kalsa cannot — it is the same rule the threadpool SIGSEGV taught, one
layer up. Our `rn_seq_rm` (`cpp/rn-llama.h:33`) returns `llama_memory_seq_rm(llama_get_memory(ctx),
…)` as a bool, and the fenced path downgrades to "proposals stay verified by the target" instead of
killing the app. No API is missing on our side: the drift is upstream choosing a fatal wrapper.

**C. Deleted-in-ours infrastructure — 2 DU, keep deleted.** `scripts/bootstrap.sh` (upstream's
llama.cpp import; our `sync-kalsallama.sh` is its replacement — but read what v0.12.9 does to it
for the Metal embed before deleting, see §7) and `third_party/llama.cpp` (submodule we dropped).
`third_party/OpenCL-Headers` also collided (upstream submodule vs our real files); git parked
upstream's as `third_party/OpenCL-Headers~v0.12.9` — delete that, keep ours.

**D. Clean merges that still need reading (15 M).** `cpp/jsi/JSICompletion.h`,
`cpp/jsi/JSIRequestManager.h`, `cpp/jsi/RNLlamaJSI.cpp`, `cpp/rn-slot-manager.{cpp,h}`,
`cpp/models/{deepseek2,glm-dsa}.cpp`, `src/version.ts`, `src/__tests__/index.test.ts`, `jest/mock.js`,
`tests/parallel_decoding_test.cpp`, `scripts/patches/common.cpp.patch`, `example/ios/Podfile.lock`,
`package.json`, `package-lock.json`. **A textual clean merge is not a compiling merge**: five of the
nine binding-side files upstream touched landed without a conflict, and the API drift class lives
exactly there. `package.json` merged to `"version": "0.12.9"` with no `postinstall`/`prepack`/
`prepare` — our removals survived, verified by grep.

**The number Marco reads:** 45 conflicts, of which **only 5 hunks in 2 files need a human**; the
other 41 paths are mechanical (regenerate) or deletions we already decided. Time to this inventory:
~20 minutes, no build.

**RESOLVED the same morning — fork commit `3eb8ac2f` on `kalsa-v0129`** (dry run: not merged into
`kalsa`, not pushed, app dep untouched). Two sentences are the whole result of the migration:

> **After the regeneration none of the 40 engine files differs from the pre-merge tree.** That is
> the proof that no upstream engine code leaked into `cpp/`: `--ours` on the conflicts, then
> `sync-kalsallama.sh pin 70b4302bb…` (exit 0), then an empty diff.

> **After resolution both binding files are byte-identical to our pre-merge versions.** At v0.12.9
> upstream changed nothing in `rn-completion.cpp` / `rn-slot.cpp` except the five `common_memory`
> conversions we reject. So **v0.12.9's binding delta lives entirely in the seven files that merged
> textually** (`jsi/JSICompletion.h`, `jsi/JSIRequestManager.h`, `jsi/RNLlamaJSI.cpp`,
> `rn-slot-manager.{cpp,h}`, `src/version.ts`, `src/__tests__/index.test.ts`) — that is where the
> line-by-line read and the NDK gate must concentrate when Step 5 runs for real, not on the
> conflict list.

**The battery, run on the merged tree (18/09 midday) — and what it says about the battery itself.**
- The include gate passes at FULL coverage on the merged tree: `[includes] OK: … 7 rn + 6 jsi …`,
  307 TUs, exit 0. That is the load-bearing check and v0.12.9 clears it.
- `tsc --noEmit`: **0 errors under `src/`**. The 1783 it prints come from `tmp/kalsallama-src` —
  the clone cache `sync-kalsallama.sh` leaves inside the repo — plus `example/`, whose deps are not
  installed. `tmp/` is gitignored (`.gitignore:110`) but is NOT excluded from `tsconfig.json`, so
  **`npm run typecheck` in the fork is unusable as a gate on any machine where `pin` has run**.
  Same for jest: 136 of the 146 test files it collects live under `tmp/kalsallama-src`.
  Step 5's prescription ("npm run typecheck; npm test") therefore needs `tmp` and `example` excluded
  first, or it measures the clone cache.
- `src/__tests__/index.test.ts` fails — **and NOT because of the merge.** I checked instead of
  assuming: restoring the pre-merge test file and `jest/mock.js` into the merged tree makes it fail
  harder (11 of 11). The cause is `[RNLlama] Missing JSI bindings: llamaSetGovernorThermo,
  llamaGetGovernorStats`: our `src/index.ts` requires them and `jest/mock.js` has never declared
  them — in ANY version, ours, upstream's or the merge's (`grep -c` = 0 in all three). So the fork's
  own suite has been red on `kalsa` since the governor bindings landed, and nothing said so because
  the fork's `ci.yml` triggers only on `main`. Residual, with the fix: add the two names to
  `jest/mock.js`'s binding list on `kalsa`, in its own commit.

Also worth knowing: two engine files upstream had merged cleanly (`cpp/models/{deepseek2,glm-dsa}.cpp`)
were overwritten by the regeneration. A clean merge into an engine file is not a decision, it is
noise the pin erases. Still to do on that branch before it could ever be real: `npm ci`, build,
typecheck, tests, and a hostile audit of the merge commit.

---

## 7. Step 6 — iOS from source (after Step 4; never with Step 5)

**Facts verified 2026-09-17.**
- `llama-rn.podspec:33-44`: compiles `cpp/**` only with `RNLLAMA_BUILD_FROM_SOURCE=1`, else
  links `ios/rnllama.xcframework`, which the fork does not ship.
- `ios/CMakeLists.txt:20` sets `-DLM_GGML_METAL_EMBED_LIBRARY=1`; `:36` globs
  `cpp/ggml-metal/*.s` as the embedded library; `.gitignore:75` ignores
  `cpp/ggml-metal/ggml-metal-embed.s`.
- At pin `134a35cf2` kalsallama has **no** `ggml-metal.metal`: the shader is split into
  `ggml/src/ggml-metal/kernels/` (23 files, copied by the sync into `cpp/ggml-metal/kernels/`).
  The fork's `scripts/sync-kalsallama.sh:197-221` (`embed_metal_headers` and the `.s`
  generation) key on the monolithic `ggml-metal.metal` and `return 0` when it is absent — so
  the embed step is a silent no-op at this pin, and an iOS build from source will either fail
  at link (`lm_ggml_metallib_start` undefined) or run without a Metal library. This is the
  blocker; it did not exist at the old pin (which still had the single `.metal`).
- The fork's `ci.yml` triggers only on `main`; there is no CI for `kalsa`. The app has no iOS
  workflow.

**How the embed actually works at this pin (verified 18/09, on disk, not from memory).**
- **Upstream llama.rn has NOT adapted** — this closes the open question below. At `v0.12.9` and at
  `v0.13.0-rc.0` `scripts/bootstrap.sh` still inlines headers into ONE
  `cpp/ggml-metal/ggml-metal.metal` and dumps it with `od -An -vtx1 "$METAL_FILE"` into a single
  `.s` (v0.12.9 lines 449-473; rc.0 lines 511-535). rc.0 even deletes upstream's
  `ggml-metal/CMakeLists.txt` while still requiring a monolith that the split layout does not
  produce. **Step 5 therefore brings no fix; the fork has to do this itself.** (Web recon; the
  local half below is what I verified myself and is what the work depends on.)
- **Our engine already has the recipe**, and it is per kernel, not one blob:
  `/Users/marco/Projects/kalsallama/ggml/src/ggml-metal/CMakeLists.txt` at pin `70b4302bb` —
  `METALLIB_KERNEL_SOURCES` (:32) lists the `kernels/*.metal`; for each one it concatenates
  `kernels/common.h` (+ `dequantize.h`/`quantize.h` where needed), strips the internal includes,
  inlines `ggml-common.h` through the `__embed_ggml-common.h__` sentinel (:91-92), and emits
  `ggml-metal-embed-${kind}.s` (:72) that **`.incbin`s** the merged `.metal` between
  `_ggml_metallib_${kind}_start/_end` (:99-104). The section name stays shared
  (`__DATA,__ggml_metallib`, 16-char limit); only the symbols vary.
- **The runtime demands exactly those per-kind symbols**: `ggml/src/ggml-metal/ggml-metal-device.m:455`
  declares `extern const char ggml_metallib_##s##_start[]` for each kind through an X-macro. After
  the fork's prefixing these are `lm_ggml_metallib_<kind>_start/_end`. A single
  `_lm_ggml_metallib_start`, which is what the fork generates today, satisfies none of them.
- **The fork's two functions no-op in silence at this pin**: `embed_metal_headers` and
  `generate_metal_embed_s` both open with `[ -f "$metal_source" ] || return 0` — the monolith is
  absent, so they return success having done nothing, and `ios/CMakeLists.txt:36`'s `*.s` glob
  matches an empty set. Same family as the unexpanded glob in the app's include gate: a step that
  reports success for work it never did.
- **Licences**: kalsallama's own `LICENSE` is `MIT License` / `Copyright (c) 2023-2026 The ggml
  authors` (read locally); llama.rn's is MIT / `Copyright (c) 2023 Jhen-Jie Hong` (recon, with URLs
  at both tags). Nothing blocks adapting either recipe; per-file upstream headers stay as they are.

**Until Step 6 happens, read a green `verify` correctly**: the sync reports success on iOS embed
work it never does. `verify` passing says nothing about iOS.

**Two options, and the choice is Marco's at Step 6** (PLAN: "decisione di Marco prima di iOS").
- **A — tracked per-kind `.s`** (recommended below): self-contained, so it sits inside the
  engine-build-id digest and the provenance manifest and cannot drift unseen. Cost: one more thing
  `sync-kalsallama.sh` must regenerate at every pin, and a large diff on every bump.
- **B — generate at build time from `ios/CMakeLists.txt`**, reusing kalsallama's own
  `ggml-metal/CMakeLists.txt` recipe. Zero tracked artifacts and it follows the pin automatically.
  Cost: the iOS build depends on that recipe staying compatible across pins, and the provenance
  manifest cannot see a file that does not exist until build time.
Whichever wins, the two `[ -f "$metal_source" ] || return 0` in `sync-kalsallama.sh` must stop being
silent: at Step 6 an absent monolith is a *state*, not a reason to return success.

**What the sync must do differently.** Generate **one `.s` per kind** with `lm_`-prefixed kind
symbols, and prefer the `od`/`.byte` form over `.incbin`: a `.byte` blob is self-contained, so the
tracked artifact is the `.s` alone and no companion `.metal` has to survive packing — which also
puts it inside the engine-build-id digest and the provenance manifest. Then un-ignore
`.gitignore:75`. The alternative — porting the CMake rules into `ios/CMakeLists.txt` and generating
at build time — keeps nothing tracked and makes the iOS build depend on `sed`/`cat` behaving the
same on every machine. Whichever is chosen, the non-vacuity probe is the same: delete the generated
`.s`, and the iOS build must FAIL at link with `lm_ggml_metallib_<kind>_start` undefined, not build
a binary without a Metal library.

**Do, in order.**
1. Read how kalsallama itself embeds the split kernels now:
   `/Users/marco/Projects/kalsallama/ggml/src/ggml-metal/CMakeLists.txt` (search
   `GGML_METAL_EMBED_LIBRARY`); mirror that in the sync script so `pin` produces a tracked
   `cpp/ggml-metal/ggml-metal-embed.s` (un-ignore `.gitignore:75`) — or generate it at build
   time in `ios/CMakeLists.txt`. Check whether upstream llama.rn ≥ 0.12.9 already adapted its
   bootstrap (`git show v0.12.9:scripts/bootstrap.sh | grep -n metal`): if yes, Step 5 brings
   it and the fork only needs the sync script to follow. Prefer the tracked file: the manifest
   and the engine id then cover it.
2. App: the iOS equivalent of `plugins/withLlamaFromSource.js` — export
   `RNLLAMA_BUILD_FROM_SOURCE=1` for `pod install` (Podfile `ENV` via a config plugin or
   `ios/.xcode.env`), and throw on any opt-out, same as Android.
3. CI: `.github/workflows/ios.yml` (`workflow_dispatch`, `macos-26` like the fork's own
   `ci.yml`): `npx expo prebuild -p ios`, `pod install`, `xcodebuild -sdk iphonesimulator`
   (simulator: no signing), then `strings` on the built `librnllama` for `kalsa-native-patches`
   (the same marker `assert-native-patch.sh` checks on Android; extend that script or add a
   sibling). ⛔ ASK before anything that needs an Apple team/signing (device build) — Marco's
   decision, and it may cost money.
4. Prove: iOS CI green from source + marker present. Record in ALIVE with the run id.

**Rollback.** Additive; nothing on Android changes. Never in the same commit as a merge.

---

## 8. Known residuals and open notes (carry them, do not lose them)

- Upstream (PLAUSIBLE, from the second audit): for hybrid targets `common/speculative.cpp`
  treats the draft memory as shared (`is_mem_shared`) while the cache is not, so the draft's
  prompt catch-up is skipped — a performance issue, not correctness. Note for kalsallama; no
  upstream issue (rule).
- The rewire's MTP paths have compile-only evidence until a phone runs an MTP model (§3).
- `KALSA_LLAMA_FROM_SOURCE=0` (prebuilt jniLibs) is gone since the switch: the fork publishes
  no binaries. If ever needed: a fork release with a jniLibs tarball (not now).
- `assert-overlay-includes.sh` and the fork's `assert-cpp-includes.sh` do the same job on two
  trees; keep both (app: installed tree; fork: flatten before install).
- After Step 4 the engine id's inputs are: installed `node_modules/llama.rn/{android,bin,cpp,ios,lib,src,third_party}`
  (build dirs excluded), `native/`, the plugin, the version. The old inputs (patch, pin,
  overlay) are gone; a KV sidecar keyed on the old id regenerates once.

### Added 2026-09-18 by the executing session, during Step 2c (all verified on disk)

- **The gate must compile the way CI compiles.** Host clang and the NDK's libc++ disagree:
  `cpp/jsi/JSIParams.cpp`'s old `reasoning_budget_end.insert(..., begin(), end())` exits 0 on
  macOS clang (newer libc++ direct-initializes the element, so `vector<int>(token_id)` is legal
  and silently wrong) and 1 under the NDK. The syntax pass still runs on host clang, so this
  class of drift reaches CI. Fix: run the syntax pass with the NDK cross-compiler
  (`--target=aarch64-linux-android33`, discovered sysroot), host only as a loud PARTIAL fallback.
  **Coverage must never drop below the current count** — an attempt on 2026-09-18 replaced the
  306-TU gate with a 44-TU one and reported it as a success. Give this to the agent that wrote
  the gate, in the GLM window, not to a fallback model at midnight.
- **A missing SOURCE is invisible to every gate we have.** The include scan resolves the header,
  the syntax pass parses what exists; only the linker notices. `iqp.cpp` (never copied by the
  flatten: `copy_ggml_cpu` lists sources by name while headers are taken with a `for` over `*.h`)
  and `cpp/hash/{hash.cpp,sha256/sha256.c}` (shipped, in no target) cost one CI round each. The
  cheap general answer, run once per pin: the two mechanical diffs (what kalsallama ships in a
  copied directory vs what `cpp/` holds; what `cpp/` holds vs what the two CMakeLists compile)
  plus a whole-link symbol closure. Done for `4126b729`: the only unfilled symbol is
  `__dso_handle`, and the 15 uncopied sources have zero referenced symbols.
- **`ggml-feats.h` is the next `iqp.cpp`.** The flatten ships `cpp/ggml-cpu/arch/{arm,x86}/cpu-feats.cpp`
  but not `ggml/src/ggml-feats.h`, so those two cannot compile as shipped. No target compiles
  them today, so nothing is red — but the same asymmetry will bite at a pin that starts
  compiling them.
- **`rewind()` does not null the stale draft pointer.** `cpp/rn-completion.cpp:851-868`
  (`resetSpeculative`) frees `spec`/`spec_ctx` but leaves `params.speculative.draft.ctx_dft`;
  the nulling added by `628f4517` lives only in `fallBackToPlain` (`:884-885`). `nextTokenMTP`
  (`:1176`) re-inits before any read, so it is latent, not live.
- **`kalsallama@134a35cf2` could not build its OpenCL backend at all** (merge `3f3558b3b`,
  4 September, two brace defects). Fixed as `70b4302bb`. The lesson is about the gate we do not
  have, not about the fix: no CI job compiles the Adreno surface — `e2e-emulator.yml` builds
  x86_64 with OpenCL off, and `apk.yml` is dispatch-only. Two weeks of a broken GPU backend were
  invisible.
- **`native/kalsallama.pin` in the app stays at `134a35cf2`** while the engine is `70b4302bb`.
  Deliberate: it belongs to the KV session, it is inert on the fork road (only the engine id
  digests it, as a constant), and Step 4 deletes it. Do not "fix" it in isolation.
- **MTP cannot propose on the only catalog model that has an MTP head, by construction** (device,
  18/09): `cpp/rn-llama.cpp:846` sets `cparams.ctx_other = ctx` unconditionally when building the
  draft context, and for a target with hybrid/iSWA memory `llama-kv-cache-iswa.cpp:97` refuses to
  share cells — `llama_init_from_model` fails and `rn-llama.cpp` `fallBackToPlain:876` runs the turn
  plain. Verified on the S23 with Qwen3.5-4B (run log in ALIVE, 18/09 midday). **Evidence status:
  the fallback path is exercised on a device; the proposal path has never been exercised on a
  phone.** For Step 5: read how llama.rn v0.12.9 decides when to pass `ctx_other` — if upstream
  skips it for hybrid targets, that is a real line to take from them, unlike the aborting
  `common_memory` helper we reject.
- **Engine residual found by the fork's FIRST CI run on `kalsa` (35360547883, 18/09):**
  `cpp/llama-kv-cache-iswa.cpp:97` throws `std::runtime_error` while the file includes
  `<algorithm>` and `<cassert>` but not `<stdexcept>`. GCC on the runner rejects it
  (`'runtime_error' is not a member of 'std'`); clang on macOS and in the NDK accepts it because
  libc++ pulls the header in transitively, so no gate we own could see it. Same line in kalsallama
  `src/llama-kv-cache-iswa.cpp:97`, and the message ("cannot share iSWA cells with an incompatible
  memory type") is our own TAG_KV_CACHE_SHARE_CELLS code. One-line engine fix, rides with Step 5's
  pin bump alongside the null checks below. **The app is unaffected** — it builds with NDK clang.
  Until it lands, the fork's `test` job stays red on `kalsa` on purpose: gating the step would hide
  a defect a real compiler found.
- **Fork `kalsa` head moved on 18/09** to `653e2ddb` (was `fada1ebe`): `24fb7098` excludes the
  `tmp/` clone cache from tsconfig+jest, `45fee016` adds the two governor bindings the jest mock
  never declared, `a694adfc` runs the fork's own CI on `kalsa` (heavy jobs gated off this branch),
  `2e313c77` fixes `no-use-before-define` in `src/types.ts`, `653e2ddb` excludes `tmp/` from eslint
  too. **`kalsa-v0129` (the v0.12.9 dry run) and `gate-ndk` (the NDK gate) are both off `fada1ebe`
  and must be rebased onto the new head before they go anywhere.**
- **Engine-side residual, found by the KV session, not verified by me:** `cpp/common/common.cpp:1813-1815`
  takes two function pointers from `lm_ggml_backend_reg_get_proc_address` and calls them without a null
  check (`lm_ggml_threadpool_new_fn` twice, `free_fn` once). Engine code, so closing it costs a
  kalsallama commit and a new pin — not worth a round on its own. **Marco, 18/09: it rides with
  Step 5's pin bump, not a pin of its own.**
- **The threadpool crash would have hit the S23 too.** The device logcat shows `n_threads=5,
  n_threads_batch=5` — equal, so the JS never sends the batch count (`engineParams.ts:135-148`) and
  `cpuparams_batch` reached the engine as `-1`. The earlier claim that the phone was safe because
  "prefill 8 differs from decode 2" came from a delegate quoting a comment about another SoC and was
  false. Two paths reach the threadpool and they are SEQUENTIAL, not alternative:
  `common_init_from_params` → `common_threadpools::init` inside `loadModel` first (where the emulator
  died), then `attachThreadpoolsIfAvailable` from the bridge (`cpp/jsi/RNLlamaJSI.cpp:705`) on
  already-resolved params — a calm log line from the second says nothing about the first.
- **Phones are on charge overnight (18/09).** Every historical number (including "S23 unplugged
  100%, 34.4 C", 16/09) was measured unplugged; timings taken while charging are not comparable
  with that baseline. Say so next to any number rather than letting it be compared.

### Added 2026-09-18 midday — where the include gates actually run

- **The fork's `scripts/assert-cpp-includes.sh` is NOT in the fork's CI.** `.github/workflows/ci.yml`
  runs lint, typecheck, ts unit tests and the C++ unit tests (gated off `kalsa`); the include gate is
  never invoked. It is a **local / `sync-kalsallama.sh verify`** gate. Putting it in the fork's CI is
  a **follow-up, not done**: the runner would need an NDK, and `KALSA_BMOE_DIR` points into the app
  repo, so a fork-CI run would be PARTIAL (no rn-*, no jsi, no bmoe) unless the app's bmoe headers
  are fetched there. Do not claim "the gate runs in CI" of the fork.
- **The gate that does run on every push is the app's** `scripts/assert-overlay-includes.sh`
  (`apk.yml`, `e2e-emulator.yml`, right after `npm ci`). Until 2026-09-18 its syntax pass used the
  **host** clang++ and, with no clang++ on PATH, printed a NOTE and **exited 0** — a gate that parsed
  nothing reporting success, with the coverage floor (`parsed` / `rn_parsed`) sitting below that early
  exit where it could never run.
- Both scripts now resolve the NDK clang the same way (`ANDROID_NDK_HOME` / `ANDROID_NDK_ROOT`, else
  `/opt/homebrew/share/android-ndk`; `toolchains/llvm/prebuilt/*/bin/aarch64-linux-android<API>-clang++`,
  API default **33** = the app's `minSdkVersion`, `app.config.js:118`). `KALSA_GATE_SYNTAX_CXX=host`
  forces the fallback for debugging; `KALSA_GATE_REQUIRE_NDK=1` makes any fallback exit 1 naming what
  was missing, and the app's CI sets it on the gate step.

## 9. When to call the orchestrator (kalsa-c8) or Marco

- ⛔ Any push to app `main` → Marco's go, every time.
- ⛔ Deleting `patches/`, `vendor/`, the pin (Step 4) → announced to Marco in the Step 3
  warning; do not do Step 4 silently.
- ⛔ A red CI whose first error is not in a file the fork owns (`rn-*`, `jsi/`, scripts) →
  orchestrator: it means the pin itself does not build in llama.rn's layout.
- ⛔ `bump` or `pin` touching anything outside `cpp/` + `kalsallama.pin`.
- ⛔ No MTP-capable model on the phone for §3's device check.
- ⛔ Anything needing Apple signing, a macOS runner minute budget, or a new paid service.
- Everything else: decide, do, record, and say what you decided in ALIVE.
