# EMBEDDING-PROGRESS-FIX — 2026-09-10

**Repo**: shared checkout `/Users/marco/Projects/kalsa`
**Base**: `f99fe4506a3072c6d18b625bdaca815615bf7421` (parent of the landed commit; verified unchanged before staging)
**Scope**: deterministic progress telemetry for the long background-embedding job
**Constraint honored**: no `finally` fallback, no claim that `[embed] done` can be
guaranteed after process death
**Audit**: MiMo independent audit — **SHIP, zero corrections**
**Status**: implemented, tested, **committed and pushed** as
`1edf5c662715a357c7aa74d16b9b2ab787688f6e` (message
`chore(embed): add deterministic progress telemetry`); `HEAD == origin/main`
verified after push. See §8 for the full landing and verification record.

---

## 1. What was asked and what was deliberately not done

Hostile recon (`EMBEDDING-COMPLETION-LOG-RECON-2026-09-10.md`) established that
all 14 surviving-process exits already call `logEmbedDone` exactly once, and that
the historical 707 chunk-without-`done` was a force-stop / SIGKILL. Therefore this
change addresses **only the real diagnostic gap**:

- deterministic progress telemetry at every 50 successfully embedded chunks and
  at the final successfully embedded chunk;
- each line carries doc id, embedded count, and planned total;
- behavior and exactly-once terminal logging are untouched.

Deliberately **not** done (per instruction and per recon):

- no `finally { if (!doneLogged) logEmbedDone(...) }` fallback;
- no assertion that `done` is guaranteed after process death (a SIGKILL cannot run
  JavaScript cleanup, so such a claim would be false);
- no timer/heartbeat;
- no change to `embedDocumentChunk`, native cancellation, or any exit path.

---

## 2. Implementation

### 2.1 New pure predicate (smallest testable extraction)

`src/engine/embeddingPure.ts` — added at the end of the pure-helper module:

```ts
/** Cadence of deterministic background-embed progress telemetry. */
export const EMBED_PROGRESS_INTERVAL = 50;

export function shouldLogEmbedProgress(
  embeddedCount: number,
  plannedTotal: number,
  interval: number = EMBED_PROGRESS_INTERVAL,
): boolean {
  if (!Number.isInteger(embeddedCount) || !Number.isInteger(plannedTotal)) {
    return false;
  }
  if (!Number.isInteger(interval) || interval <= 0) return false;
  if (embeddedCount <= 0 || plannedTotal <= 0) return false;
  if (embeddedCount > plannedTotal) return false;
  if (embeddedCount === plannedTotal) return true;
  return embeddedCount % interval === 0;
}
```

Semantics:

- **interval**: true at every `interval`-th successful chunk (default 50);
- **final**: true at `embeddedCount === plannedTotal`, so a completed job always
  emits one terminal progress line even when the total is not a multiple of 50;
- **no duplicate**: when the final count is also a multiple of 50, both rules match
  the same count and the predicate returns a single `true` (one log line, not two);
- invalid / non-integer / out-of-range inputs return `false`.

The predicate is pure and monotonic: for an increasing `embeddedCount`, each
qualifying value is true exactly once, so inline logging cannot duplicate a line.

### 2.2 Call site (one log line per qualifying count)

`src/app/AppShell.tsx` — immediately after `embeddedCount += 1` in the embed loop
(line 1820), the loop now emits:

```ts
if (shouldLogEmbedProgress(embeddedCount, toEmbed.length)) {
  console.log(
    `[embed] progress {"docId":${JSON.stringify(entry.id)},"embedded":${embeddedCount},"total":${toEmbed.length}}`,
  );
}
```

This is the placement recommended by the recon report (post-increment, i.e. after
the chunk's vector was successfully produced and added). `embeddedCount` is the
same counter used by the terminal `[embed] done` line, so progress and terminal
telemetry agree by construction.

For the historical 707 chunk job this yields progress at 50, 100, …, 700, and 707
(14 lines), even if the process is later force-stopped.

### 2.3 Re-export

`src/engine/EmbeddingService.ts` — `shouldLogEmbedProgress` was added to the
existing `embeddingPure` import and to the public re-export block, matching the
established pattern so app callers can import from `EmbeddingService` alone.
`AppShell.tsx` imports it from there.

### 2.4 Files changed

```
 scripts/embeddingServiceHarness.mjs | 31 +++++++++++++++++++++++++-
 src/app/AppShell.tsx                | 11 ++++++++++
 src/engine/EmbeddingService.ts      |  2 ++
 src/engine/embeddingPure.test.ts    | 44 +++++++++++++++++++++++++++++++++++++
 src/engine/embeddingPure.ts         | 30 +++++++++++++++++++++++++
 5 files changed, 117 insertions(+), 1 deletion(-)
```

No new files were created; all touched paths are tracked and visible to git (see §5).

---

## 3. Tests (focused, meaningful)

### 3.1 Jest — `src/engine/embeddingPure.test.ts`

Added two tests (4 existing + 2 new = 6):

1. **interval/final semantics**: `50/707`, `100/707` true; `51/707`, `99/707`
   false; final `707/707` true (non-multiple); short job `30/30` true; boundary
   finals `50/50`, `100/100` true; invalid inputs (`0`, `-50`, `708/707`, `1.5`,
   `interval=0`) false.
2. **no-duplicate over a sequence**: iterating `embedded = 1..250` yields exactly
   `[50, 100, 150, 200, 250]`; iterating `1..100` yields `[50, 100]` (final not
   double-counted); a 12-chunk job yields only `[12]`.

Command and result:

```
$ npx jest src/engine/embeddingPure.test.ts
Test Suites: 1 passed, 1 total
Tests:       6 passed, 6 total
```

### 3.2 Full Jest suite

```
$ npx jest
Test Suites: 68 passed, 68 total
Tests:       646 passed, 646 total
```

(646 vs 644 before: the 2 new tests. No regressions.)

### 3.3 TypeScript

```
$ npx tsc --noEmit
TSC_EXIT=0
```

### 3.4 Harness — `scripts/embeddingServiceHarness.mjs`

The existing embedding-pure harness was extended with one case that exercises the
new predicate (compiled from disk, same mechanism as the other pure helpers). The
new case asserts interval hits, final hits, invalid inputs, and the
no-duplicate boundary sequence.

```
$ node scripts/embeddingServiceHarness.mjs
...
PASS shouldLogEmbedProgress fires at 50-multiples and final, once each
...
22 passed, 1 failed
HARNESS_EXIT=1
```

**The single failure is pre-existing and unrelated.** It reads
`src/documents/documentChatTool.ts` and asserts a `DenseUnavailableReason` union
member `"hung"`; that symbol no longer exists in that file. Proof it is not caused
by this change: I stashed all five modified files and re-ran the harness at the
untouched base:

```
$ git stash push -m progress-fix-temp -- <5 modified files>
$ node scripts/embeddingServiceHarness.mjs
21 passed, 1 failed
FAIL documentChatTool DenseUnavailableReason includes hung → degradedNoEmbedder
$ git stash pop
```

The same check fails at base with 21/1; with this change it is 22/1. The change
adds one passing check and does not touch `documentChatTool.ts`. This stale harness
check is outside the scope of the embedding-progress fix and was left untouched.

### 3.5 Other relevant existing harnesses

```
$ node scripts/semanticIndexHarness.mjs
29 passed, 0 failed   (EXIT=0)

$ node scripts/retrievalLoopHarness.mjs
=== OVERALL: PASS ===  (EXIT=0)

$ node scripts/documentLibraryHarness.mjs
118 passed, 0 failed  (EXIT=0)
```

---

## 4. Behavior-preservation argument

- The only production-code addition is a conditional `console.log`; no control
  flow, return value, index mutation, RAM/thermal gate, or abort path changes.
- `logEmbedDone` and every existing terminal exit are untouched. There is still
  exactly one `done` per surviving-process exit, and there is still **no** `done`
  for a killed process.
- `embeddedCount` is incremented before the new log, exactly as before; the
  counter's value and all downstream uses are unchanged.
- No `finally` fallback was added.
- No timer or background work was introduced, so there is no new lifecycle or
  battery surface.

---

## 5. Git visibility

```
$ git status --porcelain -- <5 modified files>
 M scripts/embeddingServiceHarness.mjs
 M src/app/AppShell.tsx
 M src/engine/EmbeddingService.ts
 M src/engine/embeddingPure.test.ts
 M src/engine/embeddingPure.ts

$ git check-ignore -v src/engine/embeddingPure.ts src/engine/embeddingPure.test.ts scripts/embeddingServiceHarness.mjs
(no output; exit=1 → none ignored)
```

All new source/test content lives in already-tracked files, is not matched by any
ignore rule, and is visible in `git status`. Nothing was committed or pushed; HEAD
is still `f99fe4506a3072c6d18b625bdaca815615bf7421`.

---

## 6. Limitations / notes for the independent MiMo audit

1. **No device test.** The force-stop scenario is still only inferred from the
   ALIVE report; this change is statically verified on Mac via Jest, `tsc`, and
   the harnesses. It does not and cannot make `done` survive SIGKILL.
2. **Progress counts "embedded", not "committed".** The line fires right after
   `embeddedCount += 1`, before the map-ownership/commit checks. This matches the
   recon recommendation and the existing `[embed] done` accounting, which also
   counts a successfully produced vector even on a later commit abort. If the
   auditor prefers "committed" semantics, the call would have to move after the
   commit block; that is a deliberate semantic choice, not an oversight.
3. **Partial jobs.** For a job that stops early (abort/cap/reject), progress only
   fires on the 50-multiple boundaries reached; the final reached count is already
   reported by the terminal `[embed] done` line, so no separate "last embedded"
   progress line is needed.
4. **Pre-existing harness failure** (`documentChatTool` stale check) is documented
   and proven to predate this change; it should be fixed or removed in its own
   change, not folded into this diff.
5. **Not in scope**: any change to `logEmbedDone`, its reasons, its telemetry
   (`embed.native`), or the native embedding cancellation limitation.

---

## 7. Verdict

The real diagnostic gap is closed with the smallest testable extraction: a pure
predicate plus one log line. Exactly-once terminal logging and all existing
behavior are preserved; the force-stop limitation is stated honestly rather than
papered over. The diff (117 insertions, 1 deletion across 5 tracked files) is
minimal. Independent MiMo audit returned **SHIP with zero corrections**. The exact
audited diff was committed and pushed (commit
`1edf5c662715a357c7aa74d16b9b2ab787688f6e`, parent `f99fe45`, message
`chore(embed): add deterministic progress telemetry`); `HEAD == origin/main` was
re-fetched and confirmed. No `finally` fallback, no commit of untracked/archived
or output files, no CI dispatch, no APK/build/device action.

---

## 8. Landing and verification record

### 8.1 Pre-commit gate

- `HEAD` at start: `f99fe4506a3072c6d18b625bdaca815615bf7421`.
- `origin/main` at start: `f99fe4506a3072c6d18b625bdaca815615bf7421` (equal).
- Branch: `main`.
- Staged exactly the five tracked files (inspection below); `git diff --name-only`
  (unstaged) empty and no untracked path staged.

Staged stat:

```
 scripts/embeddingServiceHarness.mjs | 31 +++++++++++++++++++++++++-
 src/app/AppShell.tsx                | 11 ++++++++++
 src/engine/EmbeddingService.ts      |  2 ++
 src/engine/embeddingPure.test.ts    | 44 +++++++++++++++++++++++++++++++++++++
 src/engine/embeddingPure.ts         | 30 +++++++++++++++++++++++++
 5 files changed, 117 insertions(+), 1 deletion(-)
```

The staged diff was inspected in full and byte-matches the audited content. No
untracked/archived/output file was included.

### 8.2 Commit and push

```
$ git commit -m "chore(embed): add deterministic progress telemetry"
[main 1edf5c6] chore(embed): add deterministic progress telemetry
 5 files changed, 117 insertions(+), 1 deletion(-)

$ git push origin main
To https://github.com/Aspis0/kalsa.git
   f99fe45..1edf5c6  main -> main
```

### 8.3 Post-push verification

- `HEAD` = `1edf5c662715a357c7aa74d16b9b2ab787688f6e`
- `local main` = `1edf5c662715a357c7aa74d16b9b2ab787688f6e`
- `origin/main` (after `git fetch origin main`) = `1edf5c662715a357c7aa74d16b9b2ab787688f6e`
- `HEAD == origin/main`: **YES**; tree SHAs equal
  (`36c9425e35f49583dbdd5c41f7f2b6436cc4ef23`).
- Commit parent = `f99fe4506a3072c6d18b625bdaca815615bf7421` (the required base).

`git show --name-status HEAD`:

```
1edf5c6 chore(embed): add deterministic progress telemetry
M	scripts/embeddingServiceHarness.mjs
M	src/app/AppShell.tsx
M	src/engine/EmbeddingService.ts
M	src/engine/embeddingPure.test.ts
M	src/engine/embeddingPure.ts
```

Exactly five files; no `archived/`, `out/`, `device-decode-lineup-out/`,
`results/ciswire-campaign/`, or `n3.txt` path in the commit (grep confirmed none).

`git ls-tree HEAD` blob SHAs:

| Path | Mode | Blob |
|---|---|---|
| `scripts/embeddingServiceHarness.mjs` | 100644 | `f92c603758873ecb487d316b218baed2662845a5` |
| `src/app/AppShell.tsx` | 100644 | `7dd37999ca99e4645c38efc2b8595b4930937312` |
| `src/engine/EmbeddingService.ts` | 100644 | `a939db0314a7e7610660944a4e15900a614fd508` |
| `src/engine/embeddingPure.test.ts` | 100644 | `2d9436c41d44a2b61b045bd98f24ade550889a9b` |
| `src/engine/embeddingPure.ts` | 100644 | `ee2ef24d49c707067798c1d9db8f4607d73ec9e3` |

`git cat-file -t HEAD:<path>` returned `blob` for all five. These blob SHAs equal
the index hashes shown in the inspected staged diff (`f92c603`, `7dd3799`,
`a939db0`, `2d9436c`, `ee2ef24`).

### 8.4 Working-tree residuals

- `git diff HEAD --name-only`: empty (no tracked residual).
- `git status`: `nothing added to commit but untracked files present`; the only
  entries are the **pre-existing** untracked paths that were present before this
  work (`archived/docs/AUDIT_HARNESS_GLM.md`,
  `archived/docs/AUDIT_HARNESS_GLM_REAUDIT.md`,
  `archived/docs/remeasure-2026-08-25/`, `archived/docs/repo-audit-2026-08-28/`,
  `device-decode-lineup-out/`, `n3.txt`, `out/`, `results/ciswire-campaign/`).
  None were staged or committed.
- No CI dispatch, no APK/build/device action was performed.

### 8.5 Scope controls

This report, `PLAN.md`, `docs/ALIVE.md`, and the recon/reaudit reports are the
five explicitly scoped documentation paths for the experiments-repository
landing commit. No evidence directory or `.share_hist` file is in scope.
