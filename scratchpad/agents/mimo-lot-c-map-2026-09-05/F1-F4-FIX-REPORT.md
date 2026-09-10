# F1–F4 Fix Report — feat/moe-stream

Created 2026-09-05. Four local commits on `feat/moe-stream` (not pushed — parent pushes).
No `git add -A`; each commit staged named paths only.

---

## F1 — Orphan sweep → migration (no silent delete)

**sha** `92632a7`

**Files**
- `src/engine/ModelDownloader.ts` — export `catalogKeepIds`/`MODELS_DIR`/`clearOrphanResumeKeys`;
  removed `sweepOrphanModelDirs()` + `OrphanSweepResult` (autonomous boot delete gone).
- `src/engine/ModelDownloader.orphanMigration.ts` (new) — detect-only engine: `detectOrphansAtBoot`,
  `filterOrphansExcludingSelected`, `load/save/clearPendingOrphanMigration`,
  `rememberKeptOrphanIds`/`loadKeptOrphanIds`, `estimateOrphanSizeBytes`, `deleteOrphanDirs`.
  Versioned keys `kalsa.models.orphanMigration.v1` + `kalsa.models.orphanKeep.v1`.
- `src/engine/ModelDownloader.orphan.test.ts` — updated: pure detection + exclude-selected,
  both Keep/Delete outcomes, no-delete assertions.
- `src/components/OrphanModelMigrationBanner.tsx` (new) — one-time Delete/Keep notice in Models.
- `src/screens/SettingsScreen.tsx` — render banner in Models section.
- `src/app/AppShell.tsx` — boot call now `detectOrphansAtBoot(getActiveModelId())` (detect-only).
- `src/i18n/en.ts`, `src/i18n/it.ts` — `models.orphanNoticeTitle/Body/Delete/Keep`.

**tsc** `npx tsc --noEmit > /tmp/tsc-F1.log 2>&1; echo EXIT:$?` → **EXIT 0**

**Jest** `npx jest --runInBand ModelDownloader.orphan` → **EXIT 0**, 13 tests

---

## F2 — CI on push

**sha** `e5f8335`

**Files**
- `.github/workflows/ci.yml` (new) — `push: branches: [feat/**]` + PRs, `paths-ignore` md/docs,
  jobs: `npx tsc --noEmit` + `npx jest --runInBand`. No emulator (minutes-scale).
- `.github/workflows/e2e-emulator.yml` — added `feat/moe-stream` to `on.push.branches`
  (kept `main`, `v4.2-context-compaction`). `feat/governor-in-app` intentionally NOT added.

**tsc** `npx tsc --noEmit > /tmp/tsc-F2.log 2>&1; echo EXIT:$?` → **EXIT 0**

**Jest** workflow-only change (no source); YAML validated. No jest run needed.

---

## F3 — Privacy doc + memory-fact gate test

**sha** `e7aa0c6`

**Files**
- `src/rules/runToolGate.test.ts` — new test: `web_search` with `memoryFacts:[FACT]` and a query
  containing FACT **verbatim** → blocked with `ruleId: "echo-of-memory-fact"` (lastUserMessage
  kept short so echo-of-context abstains; not relied upon).
- `README.md` — `## Privacy` documents egress filter (web_search query + web_fetch url+query),
  fail-closed on eval errors, `kalsa.bench.toolgate=0` only in `__DEV__`, honest limit.
- `docs/KALSA.md` — new `## 2.2 Privacy — network egress filter (fail-closed)`.

**tsc** `npx tsc --noEmit > /tmp/tsc-F3.log 2>&1; echo EXIT:$?` → **EXIT 0**

**Jest** `npx jest --runInBand runToolGate` → **EXIT 0**, 13 tests

---

## F4 — Shared engine + merge prep

**sha** `f44c36f`

**Files**
- `src/engine/ModelRegistry.ts` — `lfm2.5-2.6b` gains `kvBytesPerToken: 6656` (governor-measured)
  alongside existing `sizeClass` / `recommendForTiers` (both must survive the
  feat/governor-in-app merge).
- `docs/handoff/2026-09-05-moe-stream-fixes.md` (experiments repo, `f4c97176`) — F4 note:
  `src/engine/` changes need PLAN/handoff heads-up before push; `governor*`, governor LlamaService
  sections, `patches/`, `plugins/`, `native/` stay governor-owned.

**tsc** `npx tsc --noEmit > /tmp/tsc-F4.log 2>&1; echo EXIT:$?` → **EXIT 0**

**Jest** `npx jest --runInBand ModelDownloader` → **EXIT 0**, 18 tests (2 suites)

---

## Summary

| Fix | sha | tsc | jest (targeted) |
|-----|-----|-----|-----------------|
| F1 | `92632a7` | 0 | `ModelDownloader.orphan` → 0 (13) |
| F2 | `e5f8335` | 0 | workflow-only |
| F3 | `e7aa0c6` | 0 | `runToolGate` → 0 (13) |
| F4 | `f44c36f` | 0 | `ModelDownloader` → 0 (18) |

Four commits local on `feat/moe-stream`; **not pushed** — parent will push (all four). Governor
session then dispatches APK build + E2E on `feat/moe-stream`.