# Brief: pdf.js 5.7 fix round 2 (2026-10-02)

Kalsa React Native app, worktree ~/Projects/kalsa-expo-bump, branch expo57-bump, HEAD eeff5228 (fix round 1). Never
push, never `git add -A` (explicit paths), never touch ~/Projects/kalsa. Node 22 for every command:
`export PATH=/opt/homebrew/opt/node@22/bin:$PATH`.

First `git fetch origin` and rebase onto origin/main (now 0b7c5e71: binding pin kalsa.rn 6b87db16). Run `npm ci` after
the rebase (real exit code) and `bash scripts/assert-engine-provenance.sh` (must exit 0).

Read the re-audit `AUDIT-pdfjs-fixround.md` in this folder. Verify each finding against the code before fixing; if one
is wrong, say so with the quoted line. Fix:

1. BLOCKER N1: `pdfExtractTextHtml.ts:24` `var pdfDoc = pdf;` shadows the bootstrap handle
   (`pdfExtractBootstrap.ts:107`), so `releaseEngine()` never destroys the document in the text path. Assign the outer
   handle instead, and add a behaviour test that executes the generated page (both image and text mode, success and
   error) and asserts the teardown sequence includes doc.destroy, worker.terminate and both revokes. The auditor did
   this with a vm driver; do the same in a jest test.
2. Clear the bootstrap watchdog on every early-failure path (audit: armed at `:145`, cleared only at `:169/:172`).
3. Owner decision 2026-10-02: pack Simplified AND Traditional Chinese cmaps. Add the Traditional set from
   node_modules/pdfjs-dist/cmaps (Adobe-CNS1-*, B5*, B5pc*, CNS*, CNS1/CNS2*, ETen*, ETenms*, HKscs*, HKdla*, HKdlb*,
   HKgccs*, HKm314*, HKm471*, UniCNS-*; check the real file list and include every CNS1-collection cmap, nothing
   Japanese (Adobe-Japan1, 90ms, UniJIS, ...) or Korean (Adobe-Korea1, KSC, UniKS, ...)). Keep it in the existing
   carrier scheme (one more carrier or the existing cmaps carrier renamed - pick the simpler and say which), update
   scripts/vendor-pdfjs.mjs, manifest, drift test, and the scope comment: SC + TC packed; Japanese and Korean
   unsupported (owner deferred, see lab PLAN). Extend the runtime harness with one TC fixture (UniCNS-UCS2-H on a
   non-embedded MSung-Light or similar) that must extract its text. Report the exact new carrier size and the new max
   extraction HTML size.
4. cmapsMissing: either wire it to something a person sees (the existing extraction warning/tool-result text the model
   or UI already shows - find the real path) or drop the field; no dead data. Strip/escape PDF-controlled names before
   they reach console.log (log forging).
5. Stale/false comments: `PdfToImages.tsx:447-451` (isEvalSupported no longer exists in 5.7), `:51-53` teardown claim,
   `:41-43` factory file; fix the commit-message size claims for the new numbers.
6. A10: raise the manifest/version floor from 4.2.67 to the vendored major (5.x), and add the zero `new Function(` /
   `eval(` sink assertion over the vendored bundles (ignore identifiers like `new FunctionBasedShading`).
7. Leave the 60 s watchdog value, but state in its comment that it is a guess pending device timing.

Verification (real exit codes, `cmd > log 2>&1; echo $?`, then tail -5): `npx tsc --noEmit`, targeted jest on the PDF
test files only (no full suite), `node scripts/vendor-pdfjs.mjs` then `git diff --stat assets/pdfjs` (only the
intended carrier/manifest change), `node scripts/pdfjsRuntimeHarness.mjs`. One fix commit on top, message states facts
only, ending with a blank line then `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

Reply terse: each item -> done / refuted (quote) / not done (why), exit codes, sizes, final sha.

Write clean code. Small files (~<250 lines, one responsibility), minimal imports, no types or APIs nobody constructs
yet, no speculative abstraction, no dead code, comments only where they state a non-obvious fact. Do not run the full
jest suite; targeted filters only. Use | tail -5 on noisy commands and report real exit codes - a pipe reports the
pipe's status.
