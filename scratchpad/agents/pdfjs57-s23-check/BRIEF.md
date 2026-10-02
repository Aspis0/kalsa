# Brief: S23 device check of the pdf.js 5.7 upgrade (2026-10-02)

The Kalsa Android app extracts PDF text/images in a WebView running pdf.js. Local branch `expo57-bump` (worktree
~/Projects/kalsa-expo-bump, HEAD c39f105e on top of app main 0b7c5e71) upgrades the vendored pdf.js 3.11.174 -> 5.7.284
(CVE-2024-4367 fix, SC+TC cmaps, standard fonts, wasm, bootstrap watchdog). Audits: lab
`scratchpad/agents/ios-readiness/AUDIT-pdfjs-*.md`. This check decides whether it lands on main.

## Phone rules (from the S23 owner session 1d714246 - non-negotiable)
- Galaxy S23, wireless adb last at 192.168.1.152:35017 (rediscover with `dns-sd -B _adb-tls-connect._tcp` if refused).
- NEVER toggle airplane mode, Wi-Fi or wireless debugging (that killed the link this morning). No uninstall, no clear
  data. Never touch any other phone.
- Screen ON + Kalsa in foreground + Awake checked at every step. Stop and cool if skin/battery >= 44 C.
- Bench keys are at the owner's values (route=gpu, npu_lane=off, nativelog off, energy_trace=1, kvtranscript=1,
  devmodels absent): leave them exactly as found (read them at start and at end, report both).
- The charger is allowed today for functional checks: keep the SAME charging state for baseline and new APK, and
  record it.
- Raw evidence = grep-filtered lines only (`[pdf-extract]`, csp/cspProbe, `KALSA_` pdf/doc lines, errors). NEVER save
  a full logcat (debuggable builds log user content).

## Steps
1. Baseline FIRST on the installed debuggable APK (app main 0b7c5e71): confirm installed version/sha. Import via the
   app's document picker, each in a fresh chat, and time from pick to attachment ready (logcat timestamps):
   a. /sdcard/Download/kalsa-smoke-12p.pdf (12 pages, 48 KB; failed with "Timeout nel rendering della pagina PDF." on
      7ddf39ad), b. /sdcard/Download/kalsa-smoke.docx, then c-e below. Note per file: result, extracted chars/pages,
      errors, time, `meminfo` of the app before/after (PSS).
   c. a Chinese PDF (Simplified, ideally one with non-embedded fonts) and a Traditional Chinese one, d. a scanned
      (image-only) PDF, e. a large PDF (close to the 5 MiB cap, many pages). Create c-e on the Mac (e.g. with
      Python/reportlab or by downloading public-domain PDFs - no private data), push them to /sdcard/Download with
      names kalsa-pdfjs-*.pdf, and delete them from the phone at the end.
   Also: after a failure, retry the same file once and then the docx (the smoke saw retries silently no-op).
2. The new APK: CI run https://github.com/Aspis0/kalsa/actions/runs/37041488775 (apk.yml on tag tmp/pdfjs-c39f105e,
   arm64-v8a, debuggable). `gh run watch 37041488775 -R Aspis0/kalsa` (exit code), then
   `gh run download 37041488775 -R Aspis0/kalsa` into /tmp/pdfjs57-apk, verify the APK's embedded sha/version is
   c39f105e if the app exposes it. `adb install -r` (no uninstall). Then repeat a-e exactly, same order, same
   charging state. Must see the csp probe line reporting the CSP active, and no "pdf engine failed to start".
3. After the APK is downloaded: delete the temporary tag locally and remotely:
   `git -C ~/Projects/kalsa-expo-bump tag -d tmp/pdfjs-c39f105e` and
   `git -C ~/Projects/kalsa-expo-bump push origin :refs/tags/tmp/pdfjs-c39f105e` (exit codes).
4. Leave the NEW APK installed (say so), bench keys as found, screen state as found.

## Report
`~/Projects/kalsa-moe-experiments/scratchpad/agents/pdfjs57-s23-check/REPORT.md` (English, `~` not the home path):
a table baseline vs new per file (result, chars/pages, time, PSS delta, errors), the csp line, the grep-filtered
evidence lines with file:line in a raw/ folder (grep-filtered only), the bench keys before/after, charging state,
max temperature. Verdict: PASS / FAIL per file and overall. Do not commit the lab. Reply terse with the table.

Use | tail -5 on noisy commands and report real exit codes (`cmd > log 2>&1; echo $?`) - a pipe reports the pipe's
status. Any helper script: small, one responsibility, no dead code (Write clean code).
