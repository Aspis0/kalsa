# Brief: pdf.js 5.7 audit fix round (2026-10-02)

Fix round on the pdf.js 3.11 -> 5.7.284 upgrade in the Kalsa React Native app. Worktree ~/Projects/kalsa-expo-bump,
branch expo57-bump, commit 749f3591. Never push, never `git add -A` (explicit paths), never touch ~/Projects/kalsa.

First: `git fetch origin` and rebase the branch onto origin/main (now 4ff8df26: CI on Node 22). Use Node 22 for every
command: `export PATH=/opt/homebrew/opt/node@22/bin:$PATH`.

Read the hostile audit: `AUDIT-pdfjs-upgrade.md` in this folder (its 10 pre-merge actions). Verify each finding against
the code yourself before fixing; if you think one is wrong, say so with the quoted line instead of fixing it. Fix:

1. BLOCKER silent 180 s stall: with GlobalWorkerOptions.workerPort pdf.js skips its error listener/handshake. Add a
   short bootstrap watchdog (library import + worker ready) that fails with a DISTINCT error (e.g. "pdf engine failed
   to start") instead of waiting for TOTAL_EXTRACTION_TIMEOUT_MS; also wire the Worker's `error` event to that failure.
2. Terminate the module worker yourself on every settle path (success, error, timeout, cancel) - pdf.destroy() does
   not on the port path. Revoke the Blob URLs.
3. Pass `useWorkerFetch: false` explicitly in getDocument (no network depends on an internal default).
4. CJK scope: only Simplified-Chinese cmaps are packed (Kalsa's languages are IT/FR/ES/EN/ZH). Keep that scope, but a
   missing cmap must not yield silently empty text: surface it (a per-document flag/warning the host already has a
   path for, or an error) and document the exact packed set (SC only; Traditional Chinese, Japanese, Korean
   predefined-CMap PDFs unsupported) in the code comment and commit message.
5. Tests: commit the Node harness that ran the vendored 5.7 legacy build (Latin non-embedded Helvetica + SC
   UniGB-UCS2-H -> 你好) as a real jest test that executes the VENDORED bytes from assets/pdfjs (not node_modules),
   with tiny fixture PDFs generated in the test or committed (<20 KB). Pin the BinaryDataFactory contract (the method
   names/shape pdf.js 5.7 calls). If jest cannot import ESM, use a node script invoked from a jest test via
   child_process, and say which.
6. Hygiene: remove dead imports (PdfToImages.tsx ~20-25), fix the stale "destroy del documento" comment, translate
   Italian comments in blocks you touch to English, keep comments factual.
7. pdfExtractHtml.ts is 433 lines: split by responsibility only if there is a natural seam (e.g. the in-page bootstrap
   script vs the HTML/CSP builder); no new abstractions.
8. Put the HTML size (~10.7 M chars per extraction) honestly in the commit message.

Verification (real exit codes, `cmd > log 2>&1; echo $?`, then tail -5): `npx tsc --noEmit`, targeted jest on the PDF
test files only (no full suite), `node scripts/vendor-pdfjs.mjs` + drift test. Then one fix commit on top of the
rebased 749f3591 with a message that states facts only (end with a blank line then
`Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`).

Reply terse: each audit action -> done / refuted (quote) / not done (why), exit codes, final sha.

Write clean code. Small files (~<250 lines, one responsibility), minimal imports, no types or APIs nobody constructs
yet, no speculative abstraction, no dead code, comments only where they state a non-obvious fact. Do not run the full
jest suite; targeted filters only. Use | tail -5 on noisy commands and report real exit codes - a pipe reports the
pipe's status.
