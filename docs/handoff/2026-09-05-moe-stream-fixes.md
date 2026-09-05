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
