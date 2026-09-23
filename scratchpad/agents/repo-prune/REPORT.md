# Repo prune report - checkout inventory and space reclamation

Date: 2026-09-21
Agent role: CODER, filesystem maintenance (no commits, no pushes, no ref/branch/stash/reflog changes, no `git gc`)
Disk: `/System/Volumes/Data` 926 Gi total, 880 Gi used, **22 Gi free (98%)** at time of audit.

Summary: **0 bytes deleted.** Every deletion candidate failed at least one of the
mandatory safety checks (source of ours, `.md` files, live reference, or unestablished
ownership). One item (candidate 4, dead worktree registrations) was verified and found
already clean: nothing to prune. Details and a PROPOSED list follow.

---

## (a) Full inventory table

| Path | Size | Tracked? | Modified? | Owner / live? | Decision |
|---|---|---|---|---|---|
| `/Users/marco/Projects/kalsa` | 15 GB | git main checkout (`e5788cf`) | 6 dirty entries | LIVE (main checkout) | DO NOT TOUCH |
| `/Users/marco/.paseo/worktrees/1vffp1wo/remote-brain` | 8.0 GB | worktree of `kalsa`, branch `remote-brain` (`ce71e78`) | 0 | LIVE (other session) | DO NOT TOUCH |
| `/Users/marco/Projects/kalsa-ux` | 9.3 GB | worktree of `kalsa`, branch `ux-2026-09-21` (`0f0b5f9`) | 0 at audit time (owner reported ~45; may have been committed since) | LIVE (UX session) | DO NOT TOUCH |
| `/Users/marco/Projects/kalsallama` | 6.4 GB | git main checkout (`833cde99b`) | 10 dirty entries | LIVE (shared, dirty) | DO NOT TOUCH |
| `/Users/marco/Projects/kalsallama-wt-1068` | 1.4 GB | worktree of `kalsallama`, detached `1068eb03d` | 0 | LIVE (device measurement running NOW) | DO NOT TOUCH |
| `/Users/marco/Projects/kalsallama-wt-q6k` | 174 MB | worktree of `kalsallama`, detached `914b34a7e` | 0 | LIVE (kernel-fix coder working NOW) | DO NOT TOUCH |
| `/Users/marco/Projects/llama.rn-kalsa` | 2.2 GB | git checkout, only copy of binding | 2 dirty entries | LIVE (only checkout) | DO NOT TOUCH |
| `/Users/marco/Projects/kalsa-moe-experiments` | 7.3 GB | git checkout, lab | 26 dirty entries | LIVE (lab - never delete) | DO NOT TOUCH (report written here only) |
| `/Users/marco/Projects/kalsa-device-build` | 2.9 GB | NOT a git repo (0 tracked files) | N/A (not a repo; ownership of `kalsallama-pin/` unestablished) | Referenced by LIVE scripts in `kalsa` (see below) | **LEFT IN PLACE -> PROPOSED (1)** |
| `/Users/marco/Projects/kalsallama-wt-opencl-degrade` | 174 MB | worktree of `kalsallama`, branch state `909243206`, ref `kalsa-opencl-upload-degrade` | 0 | Registered worktree, not on live list | LEAVE (its build dir's report/works depend on it) |
| `/Users/marco/Projects/kalsallama-wt-opencl-degrade-build` | 10 MB | NOT a git repo (pure CMake/Ninja build dir) | N/A | Its `CMakeCache.txt` points at `kalsallama-wt-opencl-degrade`; that worktree's report cites this dir | LEAVE (per task item 2: too small to matter, referenced) |
| `/Users/marco/Projects/kalsa-wt-build-fixes` | 11 GB | worktree of `kalsa`, detached `e5788cf` | 3 modified tracked + 1 untracked (see section c) | Evidence of reproducibility gap (hand-pinned vendor engine) | **DO NOT DELETE (not authorized; evidence)** |
| Dead worktree registrations in `kalsa` / `kalsallama` | - | - | - | - | **None found; prune dry-run empty; no prune run** |

Out of scope, noted only because they sit in `~/Projects` and were not in the brief:
`kalsa-brain`, `_kalsa_archive`, `road-probe`, `litert-study`, `paperlab-lab`, and the
unrelated `pubspark*` / `PubVia` / `PubSpark website` / `kairos` / `cisw*` trees. No
action taken or proposed on any of them.

---

## (b) What was actually deleted

**Nothing.** No `rm -rf` was executed, no worktree registration was removed.

Pre-deletion evidence was still collected for candidate 1 as instructed; it is included
here because the listing and size breakdown are the basis for the PROPOSED item.

### Candidate 1: `/Users/marco/Projects/kalsa-device-build` - NOT deleted

Top-level listing (pre-inspection):

```
build-android/                  1.4G   CMake Android build tree (bin/ holds llama binaries)
build-android-phase-stamps/     1.4G   second CMake Android build tree (phase-stamp variant)
kalsallama-pin/                 160M   full engine SOURCE snapshot (no .git)
counts-scratch-backup/          5.0M   llama-cli + libllama-cli-impl.so backup binaries
campaign-dir-md5-after-split.txt      measurement-output MD5 manifest (device-ngram-spec-out/...)
campaign-dir-md5-before-split.txt     same, before split
counts-scratch-bin-md5-{before,after,restored}.txt
build2.log build3.log reconfigure.log reconfig2.log
tuned-runner.sh wait-and-run.sh
total                            2.9G
```

Why the deletion condition ("pure build directory, no source of ours, no uncommitted
work") is FALSE, three independent reasons:

1. **Source of ours is present.** `kalsallama-pin/` is a complete engine source
   snapshot: 2,783 `.md` files including our `KALSA_FORK.md`, `AGENTS.md`, `CLAUDE.md`.
   I diffed it against `kalsallama` main HEAD (`833cde99b`): 44 differing/extra paths,
   including `KALSA_FORK.md` and `src/llama-governor-metrics.{cpp,h}` present only in
   the pin at that comparison point, plus modified OpenCL kernels
   (`ggml/src/ggml-opencl/kernels/*.cl`). It also does NOT match the current tip of
   `kalsa-gpu-opencl-v73` (1,920 differing paths). So the pin may be a state that no
   longer exists byte-for-byte in any ref. Ownership unestablished.
2. **Live scripts default into it.** In the main (LIVE) `kalsa` checkout:
   - `scripts/device-ngram-spec.sh:36` -> `LOCAL_BIN=$HOME/Projects/kalsa-device-build/build-android/bin`
   - `scripts/device-energy-sweep.sh:63` -> `LOCAL_BIN=$HOME/Projects/kalsa-device-build/build-android-phase-stamps/bin`

   Deleting the directory would break the default binary path of two device scripts.
3. **Measurement evidence lives there.** `campaign-dir-md5-*.txt` are MD5 manifests of
   `device-ngram-spec-out/` results; `counts-scratch-*.txt` record a before/after/restored
   binary split. These look like experiment provenance.

Checks that DID pass: not a git repository (nothing tracked, nothing to un-commit);
`lsof +D` found 0 open files; no process cwd inside.

Verdict: STOP -> PROPOSED item (1).

### Candidate 4: dead worktree registrations - verified, nothing to prune

`git worktree list` output:

- `kalsa`: `Projects/kalsa` [main], `.paseo/worktrees/1vffp1wo/remote-brain`,
  `Projects/kalsa-ux`, `Projects/kalsa-wt-build-fixes` - **all 4 paths exist on disk**.
- `kalsallama`: `Projects/kalsallama` [main], `Projects/kalsallama-wt-1068`,
  `Projects/kalsallama-wt-opencl-degrade`, `Projects/kalsallama-wt-q6k` -
  **all 4 paths exist on disk**.

`git worktree prune -n -v` (dry run, read-only) printed nothing in both repos.
No dead registration exists, so per the task rule ("only then may you run
`git worktree prune`") the command was **not** executed. Zero registrations removed.

---

## (c) PROPOSED list - requires Marco's authorization

### PROPOSED (1): reclaim build output inside `kalsa-device-build`, keep the evidence - up to 2.8 GB

Safe subset (rebuildable CMake output only):

- `build-android/` - 1.4 GB
- `build-android-phase-stamps/` - 1.4 GB
- subtotal: **~2.8 GB**

Must be KEPT if approved only partially:

- `kalsallama-pin/` - 160 MB (source snapshot, possibly unique state, ownership unknown)
- `counts-scratch-backup/` + all `*.txt` MD5 manifests + `*.log` + `*.sh` - ~5 MB
  (measurement/build provenance)

Precondition: either repoint `LOCAL_BIN` defaults in the two live `kalsa` scripts, or
accept that a fresh measurement run must pass `LOCAL_BIN=` explicitly (the binaries in
`*/bin` would be gone until rebuilt).

### PROPOSED (2): reclaim build output inside `kalsa-wt-build-fixes` - up to ~5.9 GB, tree and evidence preserved

The task asked for a size breakdown, the modified-file list, and what could be reclaimed
INSIDE the tree. Nothing here was deleted.

Size breakdown (total 11 GB):

| Component | Size |
|---|---|
| `node_modules/` | 9.1 GB |
| - `node_modules/llama.rn/android/build` (native build artifacts) | 3.7 GB |
| - `node_modules/llama.rn/vendor/` (**THE EVIDENCE - engine snapshot pinned to `1068eb03d`**) | 176 MB |
| - `node_modules/llama.rn/` other (src, cpp, bin, lib) | ~6 MB |
| - `node_modules/expo-modules-core` | 744 MB |
| - `node_modules/whisper.rn` | 733 MB |
| - `node_modules/react-native-reanimated` | 635 MB |
| - `node_modules/react-native-worklets` | 422 MB |
| - `node_modules/react-native-gesture-handler` | 166 MB |
| - remaining packages | ~0.5 GB |
| `android/` | 2.2 GB |
| - `android/app/build` (APK/intermediates) | 2.1 GB |
| - `android/.gradle` | 25 MB |
| - `android/` other | <1 MB |
| `modules/kalsa-thermal/android/build` + `modules/kalsa-lifecycle/android/build` | 2.2 MB |
| `device-kill-campaign/` (measurement output) | 31 MB |
| `src/` | 4.2 MB |
| `assets/` | 4.1 MB |
| `scripts/` | 3.2 MB |
| `modules/` (sources) | 2.3 MB |
| `archived/` | 1.7 MB |
| `device-*-out*/` measurement outputs (6 dirs) | ~1.3 MB |
| `.expo/`, logs, config, everything else | <1 MB |

Modified files (the brief said 4; precise state is 3 modified + 1 untracked):

```
 M AGENTS.md                         |  8 ++++++--
 M src/engine/governorInputs.test.ts | 18 ++++++----------
 M src/engine/governorInputs.ts      | 10 +++++-----
?? .build-s23-repack.sh              (untracked, 4.0K)
HEAD: e5788cfee46dd76dacd6893913d6c5f67b6ec762 "governor : supply the real plugged idle baseline (defect 5.2, app)"
```

The diffs are device-coordination text in `AGENTS.md` and governor input changes;
owner not established by me -> left untouched.

Evidence confirmed intact: `node_modules/llama.rn/vendor/VERSIONS` carries the
"LOCAL OVERRIDE (2026-09-21)" note: `LLAMA_CPP_REF/COMMIT=1068eb03d...`, exported via
`git archive 1068eb03d`, with an explicit warning not to run `npm run sync:vendor` /
`npm install` because that would revert the tree to the old pin. This is the
reproducibility-gap evidence; it was not modified.

Reclaimable WITHOUT harming the tree or the evidence (all pure build output):

| Item | Gain |
|---|---|
| `node_modules/llama.rn/android/build` | 3.7 GB |
| `android/app/build` | 2.1 GB |
| `android/.gradle` | 25 MB |
| `modules/*/android/build` | 2.2 MB |
| **Total** | **~5.9 GB** |

Hard constraints for any approved cleanup here:

- Do NOT delete all of `node_modules/` (9.1 GB): a fresh `npm install` would re-fetch
  the engine and silently revert `vendor/` to the old pin, destroying the evidence the
  `VERSIONS` note protects. Deleting only `node_modules/llama.rn/android/build` is safe
  (verified real directory, not a symlink; `ls -ld` shows `drwxr-xr-x`).
- Do NOT touch `vendor/` (176 MB), `src/`, `scripts/`, `device-*-out*/`,
  `device-kill-campaign/`, the 3 modified files, or the untracked script.
- Note: `.build-s23-repack.sh` claims "node_modules is symlinked from the main clone",
  but in this tree `node_modules` and `node_modules/llama.rn/android/build` are both
  real directories. The comment is stale or the symlink step never ran; verify before
  any path-level deletion.

### PROPOSED (3): `kalsallama-wt-opencl-degrade-build` - 10 MB, leave

Pure CMake/Ninja build dir (0 `.md`, not a repo), `CMAKE_HOME_DIRECTORY` points at
`kalsallama-wt-opencl-degrade` (exists, registered), and that worktree's report cites
this directory. Per the brief: not worth the effort. Decision: leave in place.

---

## (d) Total freed

**0 bytes.** Nothing deleted, nothing pruned. Space is tight (22 Gi free at 98%), so
PROPOSED (1) and (2) together offer about **8.7 GB** once Marco authorizes them.

---

## (e) Proposed naming/registration rule for future worktrees (proposal only)

1. One prefix per repo, one worktree per active task:
   `<repo>-wt-<task>` for engine/worktrees (`kalsallama-wt-1068`), `<repo>-<topic>` for
   long-lived app branches (`kalsa-ux`). No ad-hoc names.
2. Build output never lives in a sibling top-level directory. Use
   `<worktree>/build/` or `<worktree>/../<worktree>-build/` ONLY as a CMake binary dir,
   containing nothing but compiler output - no source snapshots, no manifests, no logs
   we care about (write those to the lab scratchpad instead).
3. Hard cap: 3 worktrees per repo (main + 2 active). Starting a fourth requires
   finishing or pruning one first.
4. Every worktree registration gets removed (`git worktree remove`) in the same session
   that created it, once its report lands in the lab. `git worktree prune -n` run weekly
   as a check.
5. Evidence artifacts (hand-pinned trees, VERSIONS overrides, MD5 manifests) live in the
   lab with a pointer file, never inside a directory that looks deletable.

---

# SECTION 2 - Follow-up: reclaim, pin provenance, live scripts (2026-09-21, same session)

Tasks A, B, C as assigned. Same safety rules held: no commits, no pushes, no ref/branch/stash/reflog changes, nothing in the lab deleted, ambiguity reported instead of acted on.

## TASK A - Reclaim provably rebuildable output inside `kalsa-wt-build-fixes`

Deleted exactly three build-output directories, nothing else.

Before (recorded with `du -sh` immediately before deletion):

```
2.1G    android/app/build
3.5G    node_modules/llama.rn/android/build
 25M    android/.gradle
sum: ~5.6 GiB
```

(Original report estimated `llama.rn/android/build` at 3.7 GB; re-measured 3.5G at deletion time.)

After (`ls -d` on all three: "No such file or directory"; parent sizes):

```
71M      android            (was 2.2G)
2.2G     node_modules/llama.rn   (was 5.8G)
5.8G     kalsa-wt-build-fixes total   (was 11G)
```

Freed: **~5.6 GiB measured** (2.1 + 3.5 + 0.025, `du -sh` rounding). Disk free moved from 22 GiB to 67 GiB during the window, but other sessions were active in the same period, so the system-wide delta is NOT attributed solely to this task.

### sha256 proof - the evidence file did not move

`node_modules/llama.rn/vendor/VERSIONS`:

```
BEFORE: 7f11591aed194b6c5ab02e2369fd93ce0d0e04f78db192667cfe91807e9497d5  node_modules/llama.rn/vendor/VERSIONS
AFTER:  7f11591aed194b6c5ab02e2369fd93ce0d0e04f78db192667cfe91807e9497d5  node_modules/llama.rn/vendor/VERSIONS
```

Identical. `vendor/` still 176 MB, still contains 3 occurrences of `1068eb03d` (the LOCAL OVERRIDE pin).

### git status proof - worktree state unchanged

```
BEFORE:  M AGENTS.md
         M src/engine/governorInputs.test.ts
         M src/engine/governorInputs.ts
         ?? .build-s23-repack.sh
AFTER:   M AGENTS.md
         M src/engine/governorInputs.test.ts
         M src/engine/governorInputs.ts
         ?? .build-s23-repack.sh
```

Identical: same 3 modified tracked files + 1 untracked. Nothing inside `node_modules` was touched except `llama.rn/android/build`.

## TASK B - Provenance of `kalsallama-pin`: SETTLED, exact tree exists in the repo

### Method (stated as required)

1. Built the snapshot's root tree hash with a THROWAWAY index: `GIT_INDEX_FILE=<tmp> git --git-dir=/Users/marco/Projects/kalsallama/.git --work-tree=<snapshot> add -A -f` then `git write-tree`. The real index was never touched (separate `GIT_INDEX_FILE`, file removed afterwards).
2. Compared that root tree hash against every candidate ref (`git rev-parse <ref>^{tree}`), against all 7,550 tags (`git tag` loop), and against the root tree of every commit reachable under all refs (`git log --all --format='%T %H'`).
3. Independent content-level confirmation: `git archive <commit> | tar -x` into a temp dir + `diff -rq` against the snapshot.

### Result

Snapshot root tree = **`2f19ca7fe063f35c9768d41017e9f8e08090add4`**

None of the 7 named candidate refs holds it at their tip:

| Ref | Root tree | Match? |
|---|---|---|
| `8537d097c` | `b32eab190d40...` | no |
| `b11010-merge` | `649518ca3683...` | no |
| `2361be359` | `fa72a4a3283a...` | no |
| `2a290390d` | `649518ca3683...` | no |
| `4ccef2f85` (official pin) | `f08f8f1702de...` | no |
| `1068eb03d` | `e0aa0333a60b...` | no |
| `833cde99b` (main tip) | `b8ad51fe24cb...` | no |

BUT the tree exists elsewhere in the repo. ANSWER: **YES - refs in `kalsallama` hold that exact tree.**

- Tags **`archive/kalsa/gemm-f32-mul-q4k`** and **`main-b10081-67c73d2`** both point at commit **`67c73d26cb4ce53d8f04b199b523bf05d18fbd61`** ("opencl: compute the Adreno q4_K GEMM product in f32", 2026-09-07T13:19:01-04:00), whose root tree is `2f19ca7f...`.
- Commit **`b51d1e0554b49052174110a4064ab833eb9ed6d4`** ("Merge branch 'kalsa/gemm-f32-mul'", 2026-09-16) has the SAME root tree and is reachable from `main`, `origin/main`, `b11010-merge`, `kalsa-gpu-opencl-v73`, `kalsa-opencl-q6k-f32-product`, `kalsa-opencl-upload-degrade`, `kalsa-slot-and-metal`, `mtp-ctx-other`, `opencl-moe-masks`.
- Content confirmation (independent of tree hashing):
  - `diff -rq archive(67c73d2) vs snapshot` -> **0 differing paths**
  - `diff -rq archive(b51d1e0) vs snapshot` -> **0 differing paths**

**Residual differences: none.** The snapshot is byte-for-byte reproducible from refs that are contained in `main`.

**Verdict: it is SAFE to delete `kalsallama-pin/`** from a provenance standpoint - 100% of its content lives in refs (tags + `main`). No preservation copy was made because the "no ref holds it" condition did NOT occur; if Marco still wants a belt-and-braces copy before deletion, say so and I will tar it to `scratchpad/agents/repo-prune/raw/`.

**I did not delete it** - this round's Task B asked for a verdict, not a deletion, and the parent directory remains on the PROPOSED list.

### The two files that made you stop - direct answers

- **`KALSA_FORK.md`** (blob `b772e1e6...`): our fork's branch/ownership map - records that the repo is `Aspis0/kalsallama`, the branch map, push rules, CI state. Content EXISTS in refs: blobs identical at commits `550b4796f` (2026-09-04) and `204e78259` (tag **`archive/kalsa/governor-v0`**), reachable from `main`.
- **`src/llama-governor-metrics.{cpp,h}`** (blobs `22bfd785...` / `39a49598...`): the governor's per-phase counter tally - `llama_governor_counter_sample` (cpu_us, read_bytes, read_us, stall_us, management_us) with pre/post/delta sampling around prefill/decode. Content EXISTS in refs: identical blobs at commits `40051f8ae` and `f7bb1369a`, both "feat(governor): implement tri-engine runtime contract v0.2" (2026-09-03/04), reachable from `main`.

Earlier confusion (report v1: "present only in the pin") was an artifact of diffing against a single older commit (`33c3817c`, which predates those files); the follow-up blob-reachability check (`git rev-list --all --objects` + per-commit blob compare) shows all three blobs are reachable from refs. Correction recorded here.

## TASK C - The two live scripts (read-only, no edits made)

**Still live: yes.**

- Both scripts edited **today** (`device-ngram-spec.sh` and `device-energy-sweep.sh`, mtime 2026-09-21 09:38).
- Referenced by reports as recent as today: `scratchpad/agents/s23-governor-smoke/REPORT.md` (Sep 21 16:14) discusses `device-energy-sweep.sh` explicitly; also cited in `discharge-recon`, `commit-map-app`, `s23-repack-timing/RECON`, and in-repo docs (`docs/ENERGY-SCHEMA.md`, `scripts/energyAggregate.mjs`, `scripts/ngramSpecAggregate.mjs`, archived ENERGY-* audits of Sep 15-16).
- Last campaign outputs: `kalsa/device-ngram-spec-out/results.txt` and siblings written **Sep 16 08:46**; the binaries in `kalsa-device-build/*/bin` were built **Sep 15**.

**What breaks if `kalsa-device-build/` goes:**

- `device-ngram-spec.sh:36` default `LOCAL_BIN=$HOME/Projects/kalsa-device-build/build-android/bin` (11 files present) and `device-energy-sweep.sh:63` default `.../build-android-phase-stamps/bin` (9 files present) would point at a missing directory; the scripts would fail when they push `LOCAL_BIN` contents to the phone (`/data/local/tmp/...`). Runs that pass `LOCAL_BIN=` explicitly are unaffected.

**What a fix would need (2-line change, not made):**

1. Pick a canonical bin location. Candidates exist but need verification: `/Users/marco/Projects/kalsallama/build-android/bin` and `.../build-snapdragon/bin` contain `libllama-cli-impl.so`, but `build-android-phase-stamps` is a phase-stamp-instrumented build - the energy-sweep default must keep that instrumentation, so it likely needs a rebuild rather than a blind repoint.
2. Change the single `LOCAL_BIN=` default line in each script (lines 36 and 63), then update the path references in `docs/ENERGY-SCHEMA.md` and any report that documents the default.

## Section 2 totals

- Deleted in this round: 3 build directories, **~5.6 GiB freed** (measured).
- Cumulative freed across both rounds: **~5.6 GiB** (round 1 freed 0 bytes).
- Snapshot preserved copy: **not made** (verdict: content fully recoverable from refs `archive/kalsa/gemm-f32-mul-q4k`, `main-b10081-67c73d2`, and `main` at `b51d1e05`).
- Still PROPOSED for Marco: (1) rest of `kalsa-device-build` (build trees 2.8 GB + script repoint decision, snapshot now cleared as safe), (2) nothing else outstanding from Task A (done), (3) `kalsallama-wt-opencl-degrade-build` 10 MB leave as-is.
