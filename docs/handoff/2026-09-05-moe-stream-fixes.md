# Handoff → app session (feat/moe-stream) — fixes requested 2026-09-05

Review of the ten commits pushed today (A1, B1-B6, C1+C2) by the governor session.
Verdict: right direction; four things to fix before the branch gets a CI build.

## F1 — Orphan model sweep must not delete silently at boot (C1+C2, 7b71d18)
`sweepOrphanModelDirs()` (src/engine/ModelDownloader.ts, called from AppShell at boot)
deletes every dir under `models/` whose name is not a catalog id, best-effort, no notice.
Fine with zero users; after ship, every catalog prune silently deletes gigabytes the user
downloaded. Turn it into a versioned migration: detect orphans at boot, NEVER delete on
its own; surface a one-time notice/setting ("N models no longer in catalog, X GB —
Delete / Keep"), never touch the currently selected model dir until the user re-selects,
keep the resume-key cleanup. Pure-function tests for the detection; UI path tested for
the two choices.

## F2 — CI on push for the branch (process)
None of the ten commits has a CI run: every workflow is `workflow_dispatch`, and
`e2e-emulator.yml` triggers only on push to `main` / `v4.2-context-compaction`. Jest green
≠ CI green. (a) Add `feat/moe-stream` to `e2e-emulator.yml` `on.push.branches`. (b) Add a
light `ci.yml` (typecheck `tsc --noEmit` + jest) on push to `feat/**` — minutes, not the
35-min emulator. Do NOT add E2E-on-push for `feat/governor-in-app` (pushed often; APK
dispatch is its gate).

## F3 — Privacy model documented with its limit (B1-A′ b28294b, B3 17c6afc)
Filtering moved from stored facts to egress (web_search/web_fetch url+query, fail-closed,
bench bypass only in `__DEV__`): correct for on-device AI. Write it down in the privacy
section of the living doc, including the honest limit: a regex cannot catch a paraphrase
the model composes into a search query. Verify (test) that the web_search gate also
blocks a query containing a stored memory fact verbatim; add the test if missing.

## F4 — src/engine is shared now; declare it and prepare the merge
C1+C2 rewrote ModelRegistry / llamaContextGate / contextProfile and touched
LlamaService — the governor session's area. Merge-tree against `feat/governor-in-app`:
ONE conflict, `src/engine/ModelRegistry.ts`, LFM2.5-2.6B entry (governor adds measured
`kvBytesPerToken: 6656`; C1+C2 adds `sizeClass`/`recommendForTiers`). Both must survive.
Rule from now: changes under `src/engine/` get a heads-up in PLAN/handoff before push;
`src/engine/governor*`, the governor sections of LlamaService, `patches/`, `plugins/`,
`native/` stay with the governor session.

## Report format
Per fix: commit sha, files, `npx tsc --noEmit > /tmp/tsc.log 2>&1; echo $?`, targeted jest
filters (never the full suite), exit codes, terse. No `git add -A`. Then hand back: the
governor session dispatches APK build + E2E on `feat/moe-stream`.

## F4 — src/engine ownership (merge prep, 2026-09-05)

`src/engine/` is now **shared** between the moe-stream session and the governor session
(merge-tree against `feat/governor-in-app` shows ONE conflict, the `lfm2.5-2.6b` entry in
`ModelRegistry.ts`). Rule from now:

- **Changes under `src/engine/` get a PLAN/handoff heads-up before push.** The moe-stream
  session may edit it, but must flag it first so the merge stays clean.
- **Governor-owned, do not touch:** `src/engine/governor*`, the governor sections of
  `LlamaService.ts`, `patches/`, `plugins/`, `native/`.

F4 added `kvBytesPerToken: 6656` (governor-measured) to the `lfm2.5-2.6b` entry alongside its
existing `sizeClass` / `recommendForTiers` — both fields must survive the merge with
`feat/governor-in-app`.

## Status 2026-09-05 ~10:15 EDT — fixes landed, CI gate RED
Five commits on origin/feat/moe-stream (92632a7 F1 detect-only migration, e5f8335 F2 ci.yml,
e7aa0c6 F3 doc+test, f44c36f F4 kvBytesPerToken 6656, bd8e4e9 F1 keep-set merge). Verified:
detect-only at boot + `deleteOrphanDirs` only from the Settings banner; `kalsa.web`… n/a;
`kvBytesPerToken: 6656` adjacent to `sizeClass` in the LFM entry; e2e on push for the branch;
ci.yml typecheck+jest on `feat/**`.
The new gate fired on its first push and is RED: `npx tsc --noEmit` →
`src/app/AppShell.tsx(18,3)` and `src/screens/documents/DocumentDetailView.tsx(23,3)`:
`Module '"…/documents/DocumentLibrary"' has no exported member 'isDocumentUnreadable'`.
`git grep isDocumentUnreadable` on the branch finds only the two import sites and three call
sites — no definition anywhere. Broken since B5 (070b5f9), before the fixes: the branch has
never typechecked since then. E2E on push fails at the same step.
APK build + E2E dispatch by the governor session is DEFERRED until typecheck is green.

## Status 2026-09-05 ~10:40 EDT — typecheck GREEN, E2E still RED, APK dispatched
aa12471 exports `isDocumentUnreadable`; ci.yml (typecheck + jest) is GREEN (run 33971861312).
APK build dispatched by the governor session: run 33972096001 (abi arm64-v8a, debuggable=false).
E2E on push at aa12471 (run 33971861291) FAILS in "Typecheck + logic harnesses": the harness
compiles `src/bench/benchConfig.ts` standalone (scripts/.build) without React Native globals →
`src/bench/benchConfig.ts(465,14): error TS2304: Cannot find name '__DEV__'` (introduced by
B3 17c6afc, "bench bypass only in __DEV__"). App-wide tsc passes because RN types declare
`__DEV__`; the harness tsconfig does not. Fix belongs to the app session; E2E re-dispatch by
the governor session waits for it.

## Status 2026-09-05 ~10:50 EDT — APK build RED on the same __DEV__ error
APK run 33972096001 (aa12471) failed at "Typecheck + logic harnesses" with the identical
`src/bench/benchConfig.ts(465,14): error TS2304: Cannot find name '__DEV__'`. apk.yml runs the
same harness gate as e2e-emulator.yml, so the `__DEV__` fix unblocks both. Once the app session
pushes it and ci.yml + E2E-on-push are green, the governor session re-dispatches apk.yml.

## Status 2026-09-05 ~12:10 EDT — E2E GREEN, APK build re-dispatched
659a644 (`isDevBuild()` instead of bare `__DEV__`): ci.yml GREEN (33972399509) and E2E on push
GREEN with real inference (33972399507). APK build re-dispatched by the governor session:
run 33976887711 (arm64-v8a, debuggable=false). Handoff closed once that APK run is green.

## CLOSED 2026-09-05 ~12:55 EDT — APK build GREEN
apk.yml run 33976887711 on 659a644: success (16:07→16:50 UTC), artifact
`kalsa-apk-arm64-v8a-659a644d5e9233a29405d534fcb2fe8e85ea2ed2` 57,627,793 B (release, not
debuggable). With ci.yml and E2E-on-push green at the same sha, all five fixes are closed.
Open for the app session going forward: any change under `src/engine/` gets a heads-up first
(F4 rule); the governor branch merge resolves the ModelRegistry LFM entry keeping both fields.
