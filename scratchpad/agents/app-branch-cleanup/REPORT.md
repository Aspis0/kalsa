# App branch cleanup - 2026-09-23

Owner order (chat, 2026-09-23): the app repo `Aspis0/kalsa` keeps only three branches -
the UX design line, remote-brain, and main. Full pre-cleanup inventory (every ref with its full
sha, ancestry and patch-id uniqueness against `e206a945`): `inventory-before.md` in this folder.

## Method

- Every branch was classified against `origin/engine-pin-kalsallama` = `e206a945b` (the audited
  chain commit: binding `5b966218`, engine `1577495b9`), which contains both the old
  `origin/main` (`54297994a`) and the unpushed local `main` (`e5788cfee`, 61 commits ahead).
- A branch was deleted only if it is an ancestor of `e206a945b`, or after its tip was preserved
  as an `archive/<name>` tag on origin (the repo's existing convention, lightweight tags).
- Worktrees holding a branch were switched to a detached HEAD at the same commit; no file was
  touched and no worktree was removed.

## Archive tags pushed (verified with `git ls-remote`)

| tag | sha | why |
|---|---|---|
| `archive/kalsa-governor-trend` | `8e7ed2c25` | 3 commits not in main; trend producer, not shipped as a trigger (PLAN) |
| `archive/chat` | `f45a8d78b` | 25 commits not in main (Vite+React+TS chat UI, Tauri probe) |
| `archive/baseline-67c73d26c` | `3ce099254` | 1 commit not in main (baseline with engine `67c73d26c`) |
| `archive/kalsa-governor-policy-consolidate` | `0db9dc682` | content in main by patch-id; sha cited in reports |
| `archive/landing-check-fix` | `b1fe88b1a` | content in main by patch-id; sha cited in reports |
| `archive/kalsa-app-gpu-v73` | `7e04002a0` | content in main by patch-id; sha cited in reports |
| `archive/wip/ciswire-corpus` | `d36e3c735` | content in main by patch-id; tip otherwise unreachable |

## Result

- Local branches: 36 -> 3 (`main` `e5788cfee`, `remote-brain` `ce71e78cd`, `ux-2026-09-21` `a7ea2c7c3`).
- Remote branches deleted: 16. Remaining on origin: `main` `54297994a`, `remote-brain` `ce71e78cd`,
  `engine-pin-kalsallama` `e206a945b`, `brain` `76afcd41c`.
- Detached worktrees (files untouched): `kalsa-wt-bench-apk` and `kalsa-wt-landing` at `e206a945b`,
  `kalsa-wt-gov-policy` at `0db9dc682`, `kalsa-wt-gov-trend` at `8e7ed2c25`,
  `kalsa-wt-landing-check` at `b1fe88b1a`.

## Owner-approved second step (2026-09-23, "si", done and verified with `git ls-remote`)

1. `origin/main` fast-forwarded `54297994a` -> `e206a945b` (no force; 67 commits). Then
   `engine-pin-kalsallama` deleted on origin.
2. `ux-2026-09-21` pushed to origin at `a7ea2c7c3` (no upstream set, so the UX worktree's config is
   unchanged). No workflow triggers on that branch.
3. `brain` KEPT on the owner's word: it is the Kalsa Brain desktop line, pushed from
   `~/Projects/kalsa-brain`, where another session is working. It is not `remote-brain`.
   **CORRECTION (same day):** an earlier version of this line said the two "diverge (733 and 331
   commits unique by patch-id)", and that is wrong. `brain` is an ORPHAN history: `git merge-base
   origin/brain e206a945b` prints nothing. It is the desktop Tauri app (`chat/ crates/ dev/ docs/
   src-tauri/`). The e5788cf "merge-base" I had used came from `git log -1 $(git merge-base ...)`
   with an empty substitution, which printed HEAD. `remote-brain` is the phone app's tree with the
   phone-side client `src/engine/remote/` (30 files); its merge-base with main is `9d3db1076`, it is
   189 commits ahead of `e206a945b` and **419** behind. (I first wrote 413. The shared `.git` of
   `~/Projects/kalsa` was SHALLOW, cut at `a5ae74b` since 2026-09-18; after
   `git fetch --unshallow` it reads 189/419, matching the Brain session. Ancestry checks on a shallow
   repo can only give false negatives, so no deletion above relied on a wrong positive.) The owner wants one brain branch; being
   settled with the Brain session (`54b9712e`).

Final origin heads: `main` `e206a945b`, `remote-brain` `ce71e78cd`, `ux-2026-09-21` `a7ea2c7c3`,
`brain` `76afcd41c`.

Consequences:
- The push to `main` triggered E2E emulator run `35859509509` on `e206a945b`.
- `build-kalsa-apk.yml:6` triggers on push to `[engine-pin-kalsallama, bench-dev-models]`, and
  that was the only reference to the deleted name in the tree. APK builds now need
  `workflow_dispatch` on `main` until the trigger is moved. The move is folded into the app-CI
  debt (`scratchpad/agents/app-ci-setup-android/`).

## Not touched

The main checkout `~/Projects/kalsa` carries an uncommitted diff dated 2026-09-21 17:22
(`src/engine/governorInputs.ts`, its test, `src/engine/LlamaService.ts`, `AGENTS.md`), which
belongs to the governor/Meter line (per the UX session: workspace `wks_574fe04a8d256ca4`, closed
agent `3bb61cff`). Local `main` there stays at `e5788cfee`.
