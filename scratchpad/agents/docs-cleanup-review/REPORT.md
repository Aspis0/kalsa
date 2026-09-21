# Adversarial docs-cleanup review

Scope: LAB `governor-audit-recheck` at `612827e8`, and APP
`/Users/marco/.paseo/worktrees/1vffp1wo/app-docs-cleanup` at `fc8a9c2`. The review was
read-only apart from creating this report.

Overall result: the two large LAB files were frozen without byte loss, and most pin,
ancestry, governor-gate, model, and archive-target facts are confirmed. The cleanup is
not clean: the living plan contains a false/ambiguous engine-use statement and an
over-broad archive rule, the memory correction contains one false worktree count and is
not additive in place, APP `REPOS.md` has stale branch counts and a contradictory heading,
frozen APP text retains old paths, and Italian remains in edited/new documentation.

## 1. Freeze fidelity — CONFIRMED

The archived files are byte-identical to the pre-move Git blobs; no line was lost.

Evidence:

```text
$ git show 6fd5a952^:PLAN.md | sha256sum
ff612f3ae919ed4099a487204efbf72f2eb7d6c73adaa5bb4b43d098e1633b5a  -
$ sha256sum archived/PLAN-2026-09-full.md
ff612f3ae919ed4099a487204efbf72f2eb7d6c73adaa5bb4b43d098e1633b5a  archived/PLAN-2026-09-full.md
$ cmp <(git show 6fd5a952^:PLAN.md) archived/PLAN-2026-09-full.md; echo cmp_plan=$?
cmp_plan=0
$ git show 6fd5a952^:PLAN.md | wc -l; wc -l archived/PLAN-2026-09-full.md
    3162
    3162 archived/PLAN-2026-09-full.md

$ git show 6fd5a952^:docs/ALIVE.md | sha256sum
984f55c8f428fbb27bdc5f2a2520ff2c6889e93de678d44ab78b375fe40a12c3  -
$ sha256sum archived/ALIVE-2026-09-full.md
984f55c8f428fbb27bdc5f2a2520ff2c6889e93de678d44ab78b375fe40a12c3  archived/ALIVE-2026-09-full.md
$ cmp <(git show 6fd5a952^:docs/ALIVE.md) archived/ALIVE-2026-09-full.md; echo cmp_alive=$?
cmp_alive=0
$ git show 6fd5a952^:docs/ALIVE.md | wc -l; wc -l archived/ALIVE-2026-09-full.md
    7773
    7773 archived/ALIVE-2026-09-full.md
```

The command compared each archive to `git show 6fd5a952^:<old-path>`, not merely to the
working copy.

## 2. New living docs — REFUTED

### Claims confirmed

The requested pins and ancestry are correct at `PLAN.md:56-57,70-73,83-94` and
`docs/ALIVE.md:21`:

```text
$ git rev-parse origin/main
54297994aa1f8a68f8d6058b8ea705cb1e862d32
$ git show origin/main:package.json | nl -ba | sed -n '47,51p'
    49    "llama.rn": "github:Aspis0/llama.rn#0f313bab464ef28a58a8b4b2a37a5d4c1968b54e",
$ git -C /Users/marco/Projects/llama.rn-kalsa show 0f313bab:vendor/VERSIONS | grep -E 'LLAMA_CPP_(REPO|COMMIT)'
LLAMA_CPP_REPO=https://github.com/Aspis0/kalsallama
LLAMA_CPP_COMMIT=8537d097c32e7307d82540b6da8eb448d7e07107
$ git -C /Users/marco/Projects/kalsallama merge-base --is-ancestor 2361be35970dfd3cf5f83f5c11381cc00bb491b1 8537d097c32e7307d82540b6da8eb448d7e07107; echo '2361be359 -> 8537d097c exit='$?
2361be359 -> 8537d097c exit=0
$ git -C /Users/marco/Projects/kalsallama merge-base --is-ancestor 26c7affb76b6fc547fa72d2af3f6b7d2cff6997e 8537d097c32e7307d82540b6da8eb448d7e07107; echo '26c7affb7 -> 8537d097c exit='$?
26c7affb7 -> 8537d097c exit=0
```

The `b11010-merge` creation/merge claim is also supported by the engine reflog:

```text
2361be359 b11010-merge@{2026-09-19 10:54:32 -0400}: branch: Created from HEAD
6b6d4a980 refs/heads/b11010-merge@{2026-09-19 11:09:54 -0400}: commit (merge): Merge tag 'b11010' into b11010-merge
```

The governor default-off and sensor gate claim at `PLAN.md:102-106` is supported by the
APP source:

```text
src/engine/governorRuntime.ts:3:export const GOVERNOR_ENABLED_KEY = "kalsa.governor.enabled";
src/engine/governorRuntime.ts:17:    const value = await AsyncStorage.getItem(GOVERNOR_ENABLED_KEY);
src/engine/governorRuntime.ts:18:    return value === "1" || value?.toLowerCase() === "true";
src/engine/LlamaService.ts:2310:    const governorLoad =
src/engine/LlamaService.ts:2314:      governorThermo.sensor_valid &&
```

The kernel call-site details at `PLAN.md:91-94` are present at the stated binding pin:

```text
gemv_moe_q4_k_f32_ns.cl:99:  get_scale_min_k4(j, sc, &sv, &mn, mask_d6, mask_d4, mask_hi2);
gemv_moe_q4_k_f32_ns.cl:219: get_scale_min_k4(j, sc, &sv, &mn, mask_d6, mask_d4, mask_hi2);
gemm_moe_q4_k_q8_1_dp4a.cl:142: get_scale_min_k4(j, sc, &sv, &mn, mask_d6, mask_d4, mask_hi2);
gemm_moe_q4_k_f32_ns.cl:250: get_scale_min_k4(j, sc, &sv, &mn, mask_d6, mask_d4, mask_hi2);
```

### Findings

1. `PLAN.md:15-16` says the missing piece is that “the app does not use” the engine,
   immediately after saying the app consumes the forked binding. That is false or, at
   minimum, materially ambiguous: the APP has the binding as a Git dependency and imports
   it in the engine path.

   ```text
   $ git show HEAD:package.json | nl -ba | sed -n '47,51p'
       49    "llama.rn": "github:Aspis0/llama.rn#0f313bab464ef28a58a8b4b2a37a5d4c1968b54e",
   $ git grep -n 'from "llama.rn"' HEAD -- src/engine | head -2
   HEAD:src/engine/EmbeddingService.ts:35:import { initLlama } from "llama.rn";
   HEAD:src/engine/LlamaService.ts:13:} from "llama.rn";
   ```

   If “it” means the governor, it must say governor, not engine.

2. `PLAN.md:41-44` says every other Markdown file is frozen under `archived/`, then
   explicitly exempts live `analysis/` and `scratchpad/` records. The broad sentence is
   false on disk.

   ```text
   $ git ls-files '*.md' | rg -v '^(archived/|PLAN\.md$|docs/ALIVE\.md$)' | wc -l
       1112
   $ find analysis -maxdepth 1 -type f -name '*.md' -print | sort
   analysis/CISWIRE-CHAR3GRAM-KV-AND-THERMAL-2026-09-19.md
   analysis/FORK-VENDOR-MIGRATION.md
   analysis/GOVERNOR-DEVICE-PLAN.md
   analysis/README-governor-kv-contract.md
   analysis/README-qwen-think-replay.md
   analysis/XIAOMI-QWEN-FITGATE-AND-CISWIRE-TOKEN-OVERFLOW-2026-09-20.md
   ```

3. `PLAN.md:143-145` lists “Catalog gate threshold” and “S23 cable” as owner-suspended,
   but neither has a record or source pointer. A repository-wide search finds each only in
   the new PLAN:

   ```text
   $ rg -n -i -F 'Catalog gate threshold' --glob '*.md' .
   ./PLAN.md:143:- **Catalog gate threshold.** The prefill-cost admission threshold for the catalog is deferred;
   $ rg -n -i -F 'S23 cable' --glob '*.md' .
   ./PLAN.md:145:- **S23 cable.** The S23 measurement lane is blocked on a cable/host decision.
   ```

   These are UNVERIFIABLE as owner decisions, not established facts.

4. `PLAN.md:156` claims every `analysis/*.md` is one dated-session document. The output
   above disproves that: `README-governor-kv-contract.md` and
   `README-qwen-think-replay.md` are contract/procedure documents, not dated session
   records.

5. The date/owner assertions at `PLAN.md:13`, `PLAN.md:27`, and `docs/ALIVE.md:5` are
   stated as facts but have no source pointer or command output in the living docs. The
   pin and archive line counts are sourced; these owner/date/count assertions are not.

## 3. Claude memories — REFUTED

The backup is complete by both count and filename set, but the edits are not additive in
the active files: original lines were replaced. The backup is the only preserved copy.

```text
$ find /Users/marco/.claude/projects/-Users-marco-Projects-kalsa/memory -maxdepth 1 -type f -name '*.md' | wc -l
187
$ find /Users/marco/.claude/projects/-Users-marco-Projects-kalsa/memory.bak-20260920 -maxdepth 1 -type f -name '*.md' | wc -l
187
$ comm -3 <(find /Users/marco/.claude/projects/-Users-marco-Projects-kalsa/memory -maxdepth 1 -type f -name '*.md' -exec basename {} \; | sort) \
    <(find /Users/marco/.claude/projects/-Users-marco-Projects-kalsa/memory.bak-20260920 -maxdepth 1 -type f -name '*.md' -exec basename {} \; | sort)
[no output]
$ for f in /Users/marco/.claude/projects/-Users-marco-Projects-kalsa/memory/*.md; do b=/Users/marco/.claude/projects/-Users-marco-Projects-kalsa/memory.bak-20260920/$(basename "$f"); if [ -f "$b" ] && ! cmp -s "$f" "$b"; then basename "$f"; fi; done
MEMORY.md
context-git-status-snapshot-goes-stale.md
fork-opencl-moe-kernel-does-not-compile.md
governor-plan-is-unparked-but-its-numbers-are-not.md
kalsa-main-only-since-2026-09-09.md
kalsa-repo-map.md
llama-rn-fork-migration-state.md
state-2026-09-16.md
```

For example, `memory/MEMORY.md:4` replaces the old “all repos clean and pushed” and
“fix outside the pin” text rather than appending a correction block. The corresponding
`diff -u memory.bak-20260920/MEMORY.md memory/MEMORY.md` contains those old lines with `-`
and the replacement with `+`.

The corrected pin/branch claims are supported: the fix commits are ancestors of
`8537d097c`, APP `origin/main` is `5429799`, local `main` is `745bf82` and the engine/binding
checkouts have the stated untracked files. However, a new false claim was introduced:

```text
$ nl -ba memory/kalsa-main-only-since-2026-09-09.md | sed -n '11,16p'
    13  > 2026-09-20 `git for-each-ref refs/heads` returns 27 local branches, and
    14  > `git for-each-ref refs/remotes/origin` returns 16 remote branches plus `origin/HEAD`;
    15  > also has 15 registered worktrees.
$ git -C /Users/marco/Projects/kalsa worktree list --porcelain | rg '^worktree ' | wc -l
16
```

Required correction: `memory/kalsa-main-only-since-2026-09-09.md:15` says 15 but the disk
has 16 registered worktrees.

## 4. APP repository — REFUTED

### Rename purity and targets

The 16 moves in `d633cd4` are all `R100`; the commit also edited `docs/README.md` and one
other reference, so the whole commit is not rename-only, but the moves themselves are pure.

```text
$ git show --stat -M d633cd4
rename ENERGY-2B-SELF-AUDIT-2026-09-15.md => archived/ENERGY-2B-SELF-AUDIT-2026-09-15.md (100%)
rename ENERGY-PHASE-AUDIT-2026-09-15.md => archived/ENERGY-PHASE-AUDIT-2026-09-15.md (100%)
rename ENERGY-PHASE-AUDIT-R3-2026-09-15.md => archived/ENERGY-PHASE-AUDIT-R3-2026-09-15.md (100%)
rename ENERGY-PHASE-AUDIT-R4-2026-09-15.md => archived/ENERGY-PHASE-AUDIT-R4-2026-09-15.md (100%)
rename ENERGY-PHASE-STAMP-AUDIT-2026-09-15.md => archived/ENERGY-PHASE-STAMP-AUDIT-2026-09-15.md (100%)
rename ENERGY-PHASE-STAMP-AUDIT-R2-2026-09-15.md => archived/ENERGY-PHASE-STAMP-AUDIT-R2-2026-09-15.md (100%)
rename ENERGY-PHASE-STAMP-AUDIT-R3-2026-09-15.md => archived/ENERGY-PHASE-STAMP-AUDIT-R3-2026-09-15.md (100%)
rename ENERGY-SCHEMA-AUDIT-2026-09-15.md => archived/ENERGY-SCHEMA-AUDIT-2026-09-15.md (100%)
rename ENERGY-SWEEP-FLIPCHECK-2026-09-16.md => archived/ENERGY-SWEEP-FLIPCHECK-2026-09-16.md (100%)
rename ENERGY-SWEEP-INSTRUMENT-AUDIT-2026-09-16.md => archived/ENERGY-SWEEP-INSTRUMENT-AUDIT-2026-09-16.md (100%)
rename ENERGY-V3-CAMPAIGN-AUDIT-2026-09-16.md => archived/ENERGY-V3-CAMPAIGN-AUDIT-2026-09-16.md (100%)
rename {docs => archived/docs}/CORE-PLACEMENT-PILOT-2026-09-16.md (100%)
rename {docs => archived/docs}/ENERGY-FRAMEWORK-STATUS.md (100%)
rename {docs => archived/docs}/ENERGY-PERPHASE-FINDINGS.md (100%)
rename {docs => archived/docs}/NGRAM-SPEC-FINDINGS.md (100%)
rename {docs => archived/docs}/S23-ENERGY-BLOCKER.md (100%)
```

All 16 destinations exist and all 16 old paths are absent from the final tree.

### Findings

1. `REPOS.md:11` says “The three live ones” while `REPOS.md:3-4,18` says four are live
   and lists four. This heading was not corrected.

2. `REPOS.md:22` says 26 local and 17 remote branches. On the stated APP checkout, the
   local branch count is 27 and the remote branch-name count is 16 (17 refs only when the
   symbolic `origin/HEAD` is included):

   ```text
   $ git -C /Users/marco/Projects/kalsa for-each-ref --format='%(refname)' refs/heads | wc -l
   27
   $ git -C /Users/marco/Projects/kalsa for-each-ref --format='%(refname)' refs/remotes/origin | rg -v '/HEAD$' | wc -l
   16
   $ git -C /Users/marco/Projects/kalsa for-each-ref --format='%(refname)' refs/remotes/origin | wc -l
   17
   ```

3. Live references were repaired, but frozen APP text still contains old paths. These are
   not content losses, but they are broken path references if a reader follows them:

   ```text
   $ git grep -n -F 'docs/ENERGY-FRAMEWORK-STATUS.md' HEAD
   HEAD:README.md:59:See [`archived/docs/ENERGY-FRAMEWORK-STATUS.md`](archived/docs/ENERGY-FRAMEWORK-STATUS.md).
   HEAD:archived/ENERGY-PHASE-STAMP-AUDIT-2026-09-15.md:322:| N1 | LOW | The v3 doc section names no binary prerequisite. `scripts/device-ngram-spec.sh:35` defaults `LOCAL_BIN` to `tmp/build-android/bin`, whose `libllama-cli-impl.so` contains **0** occurrences of `KALSA_PHASE_STAMPS` (the author's `tmp/build-android-phase-stamps/bin/libllama-cli-impl.so` contains 3, and `docs/ENERGY-FRAMEWORK-STATUS.md:100` says the cross-build into that dir is owed). Run with defaults, the campaign produces **no stamps at all**: v2 rows + one "phase stamps absent" stderr line per row + one "phase stamps pull FAILED" line per rep. Detectable, but the failure mode is "the campaign silently becomes a v2 campaign". |
   HEAD:archived/ENERGY-PHASE-STAMP-AUDIT-R3-2026-09-15.md:5:Note: HEAD moved to `662509f` (docs/ENERGY-FRAMEWORK-STATUS.md only) at 00:00:37 during this
   $ git grep -n -F 'docs/ENERGY-PERPHASE-FINDINGS.md' HEAD
   HEAD:archived/ENERGY-V3-CAMPAIGN-AUDIT-2026-09-16.md:217:The committed figure is `docs/ENERGY-PERPHASE-FINDINGS.md:68-70` — "2.20–2.21x per decode token
   HEAD:archived/docs/ENERGY-FRAMEWORK-STATUS.md:33:- `docs/ENERGY-SCHEMA.md`: the contract. `docs/ENERGY-PERPHASE-FINDINGS.md`:
   ```

   The live `README.md`, `docs/README.md`, `docs/KV-WINDOW-AND-THERMAL-2026-09-17.md`, and
   `src/context/compactor.ts` references use `archived/...` and are correct.

### APP facts confirmed

The corrected default-model answer is true: `src/engine/ModelRegistry.ts:241-273` names
LFM2.5 2.6B and marks it `default: true`; `src/domain/askAssistant.js:33` now gives that
answer and Qwen 3.5 4B as the alternative. Tracked-file counts also match:

```text
kalsa tracked_files=3424
kalsallama tracked_files=3664
kalsa-moe-experiments tracked_files=50900
kalsallama local=5, origin/main...HEAD=0 210
```

The 16 archive destinations are present, and the old paths are absent, as shown above.

## 5. Language rule — REFUTED

The governing rule is `/Users/marco/Projects/kalsa/AGENTS.md:7-9`:

```text
Language: ALL agent communication, code comments, commit messages, docs,
and log/stderr strings must be in English. Italian is ONLY for direct
conversation with Marco. Never let Italian leak into code or docs.
```

The two new living docs pass a marker scan: `rg -n` for common Italian markers produced no
output for `PLAN.md` or `docs/ALIVE.md`.

Violations remain in changed/new docs:

1. `analysis/GOVERNOR-DEVICE-PLAN.md:3` added Italian in the changed header:

   ```text
   +> ## SOTTO AUDIT — 19/09/2026 — 7 REFUTED, 2 non verificabili, 6 derive di citazione
   ```

   The same edited document still has Italian in `:1,5,17-28` and throughout its body.

2. The newly added `scratchpad/agents/docs-repo-cleanup-inventory/REPORT.md` contains
   Italian quotations, for example `:25-30`, `:423-426`, and `:435-442`:

   ```text
   REPORT.md:25:| 2 | `MEMORY.md:4` + `MEMORY.md:9` | "il fix OpenCL MoE e' FUORI dal pin sul ramo `opencl-moe-masks`" / "NON e' nel pin" | same as #1 — fix is in the pin | **critical** |
   REPORT.md:30:| 7 | `MEMORY.md:4` | "**tutti i repo puliti e pushati**" | `kalsa` local main diverged (ahead 1/behind 4, `git status --short --branch`); `llama.rn-kalsa` 2 untracked (`pnpm-lock.yaml`, `pnpm-workspace.yaml`); `kalsallama` 2 untracked (`CMakeUserPresets.json`, `pkg-snapdragon/`) | high |
   REPORT.md:423:> **STATO AL 20/09, verificato sul disco (non dalla memoria):** il fix esiste nel fork
   ```

3. The edited active memory index also adds mixed Italian in `memory/MEMORY.md:4`
   (`Owner in sospeso`, `due bug app trovati`, and similar text). If project memories are
   governed by the same documentation rule, this is another violation.

The Italian in the two frozen archive blobs was pre-existing and byte-preservation was
required; it was not introduced by the move. That preservation conflicts with a literal
English-only rule and needs an explicit archive exception if the rule is absolute.

## 6. Over-claims, unverifiable claims, and silent drops — REFUTED

No silent byte/line loss was found in the two LAB freezes, and no APP archive destination was
lost. The remaining issues are provenance and scope:

- `PLAN.md:15-16` over-claims that the app does not use the engine; the package and imports
  prove otherwise.
- `PLAN.md:41` over-claims the archive rule; its own `:43-44` and the disk show live Markdown
  outside `archived/`.
- `PLAN.md:143-145` gives two owner-scope decisions without records.
- `PLAN.md:156` mischaracterizes analysis documents as all dated-session records.
- `PLAN.md:50` asserts that every fact was read from disk on a historical date. That timing
  assertion is not reproducible from the current tree; it is an unverifiable provenance
  claim, even where the underlying current values are true.
- The new docs do not silently copy the governor's quantitative numbers as established:
  `PLAN.md:111-113` and `docs/ALIVE.md:33-36` explicitly say re-verification is pending.

## Required fixes, in order

1. Correct `PLAN.md:15-16`, narrow the two-doc rule at `:41`, and add source/owner records
   for the two unsourced suspended items and the owner/date assertions.
2. Correct the false `memory/kalsa-main-only-since-2026-09-09.md:15` worktree count; decide
   whether memory corrections must be additive in the active files rather than only backed up.
3. Correct APP `REPOS.md:11,22` and either repair or explicitly annotate the stale paths in
   frozen APP audit text.
4. Translate the Italian added to the governor header, inventory report, and edited memory
   text, or obtain an explicit English-rule exception for exact historical quotations and
   frozen archives.
