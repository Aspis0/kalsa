# S23 device check — pdf.js 3.11.174 → 5.7.284 (expo57-bump, c39f105e) — 2026-10-02

**Verdict: FAIL overall.** On the Galaxy S23 the new APK's PDF import pipeline never completes:
all 8 PDF attempts (5 files + 3 protocol retries) mount the WebView, log the CSP probe
(`[pdf-extract] csp=true`), then die silently — no metrics, no done, no error notice, no
attachment, no rendered page. The docx path works. The baseline (0b7c5e71) attached 3 of 4
synthetic PDFs in ≤ 2 s each. The upgrade must not land on main until the WebView bootstrap
stall is fixed and re-checked on this device.

- New APK: CI run 37041488775 (`apk.yml`, tag `tmp/pdfjs-c39f105e`), artifact
  `kalsa-apk-arm64-v8a-debuggable-c39f105eabe9da34cfced0b4b7a593480f5470f1`,
  `gh run watch` exit 0; installed with `adb install -r` (exit 0, `lastUpdateTime 14:34`).
  The temp tag was deleted locally and remotely afterwards (exit 0 / exit 0).
- Baseline APK: installed `base.apk` sha256 `29b2ee997fe180aea227426f1a4fff72e08b7f215b7a5a95ff9311f0b92c4dd9`
  — byte-identical to the CI artifact for 0b7c5e71 (run 37028997487). versionName 0.1.0 on both;
  the app exposes no git sha at runtime, so the digest match is the identity proof.

## Results per file (import via the app's document picker, one fresh chat each)

| file | baseline 0b7c5e71 | new c39f105e | verdict per file |
|---|---|---|---|
| a. `kalsa-smoke-12p.pdf` (12 pp, 48 KB) | **FAIL** ×2 — pick opens the file (FUSE +0.2 s), "Lettura pagine…" chip on retry, then chip cleared with **no attachment, no error notice, no `[pdf-extract]` line, no rendered page** (≤ 46 s) | **FAIL** ×2 — csp probe +1.0 s, then silent stall ≥ 7 min (attempt 1); retry fails at ≤ 2 s with visible toast "Estrazione del testo PDF non riuscita." | FAIL both — pre-existing, file-specific; new build at least surfaces the error |
| b. `kalsa-smoke.docx` | **PASS** — attached ≤ 2 s, ready ≤ 8 s; library row: `kind txt, docCount 1, sizeBytes 174, estimatedTokens 44, status ok` | **PASS** — attached ≤ 2 s, ready ≤ 8 s | PASS both |
| c. `kalsa-pdfjs-zh-hans.pdf` (3 pp, STSong-Light non-embedded) | **PASS (attach)** — chip + vision toast at +2.1 s; 3 page JPEGs rendered +0.6 s; no text metrics logged, chars not measurable on baseline | **FAIL** ×2 — csp probe +0.6 s, WebView destroyed +0.3 s later, silent stall ≥ 5 min, no chip, no error | baseline PASS / new **FAIL** |
| d. `kalsa-pdfjs-scanned.pdf` (3 pp, image-only) | **PASS (attach)** — chip + vision toast at +2 s; 3 page JPEGs rendered | **FAIL** ×2 — same silent stall (≥ 2 min, ≥ 75 s) | baseline PASS / new **FAIL** |
| e. `kalsa-pdfjs-large.pdf` (113 pp, 4.74 MB ≈ under the 5 MiB cap) | **PASS (attach)** — chip + vision toast at +2 s; text-mode, first 5 pages rasterized (MAX_PDF_PAGES=5) by +1.8 s; PSS +136 MB | **FAIL** ×2 — same silent stall (≥ 2 min, ≥ 75 s); zero new page JPEGs | baseline PASS / new **FAIL** |

Chars/pages on baseline PDFs are not recoverable from evidence: the `[pdf-extract] pages=…`
metrics line never fired on 0b7c5e71 either; hard proof of conversion is the rendered
`cache/pdf-page-*.jpg` files (3 + 3 + 3 + 5 across c/d/e) plus the composer chips.

## The CSP gate and the failure signature (new APK)

Required line — present on every attempt, e.g.:

```
10-02 14:35:20.944 I/ReactNativeJS(16763): [pdf-extract] csp=true
```

("pdf engine failed to start" appears nowhere — but only because the engine dies without logging.)
Failure signature, identical on all 8 attempts: pick lands (MediaProvider FUSE open +0.2 s) →
WebView created → `[pdf-extract] csp=true` +0.6–1.0 s → WebView destroyed ≤ 1.5 s after creation
(`onFirstWebViewCreated` 14:51:44.578 → `onLastWebViewDestroyed` 14:51:44.873 on the c-retry) →
then nothing, forever. No `[pdf-extract] pages=` metrics, no onError notice (one exception: the
smoke retry's generic toast), no chip; the bootstrap watchdog never fires. This is the silent
stall the hostile audit predicted for the 5.7 WebView bootstrap; on this device the fixrounds
did not close it. The one visible difference vs baseline is that baseline's WebView survived
long enough to render pages; the new one dies within ~0.3 s of the probe.

## Conditions, keys, hygiene

- Charging: **AC powered the whole session, both phases** (`AC powered: true` at every check,
  battery 100 %). Same state for baseline and new, as required.
- Temperature (battery): 28.4–29.7 °C across the session; **max 29.7 °C** — never near the 44 °C stop gate.
- Bench keys, start vs end (AsyncStorage `kalsa.bench.*`, read via `run-as` RKStorage):
  `route=gpu, npu_lane=off, nativelog=off, energy_trace=1, kvtranscript=1, devmodels absent` —
  **identical before and after; untouched.**
- Screen ON + Kalsa foreground + Awake verified before every import; left as found (Kalsa
  foreground, screen on, Awake). **The NEW APK is left installed** (lastUpdateTime 14:34).
- The four `kalsa-pdfjs-*.pdf` test files were deleted from `/sdcard/Download` (rm exit 0 ×4);
  the pre-existing `kalsa-smoke-*` files and `kalsa-share-v2-20260909.pdf` were left in place.
- No uninstall, no clear-data, no airplane/Wi-Fi/wireless-debugging toggles; only the S23 was touched.
- Evidence is grep-filtered lines only (this folder's `raw/`); no full logcat was saved anywhere.
  UI screenshots stayed in /tmp and are not part of the evidence.

## PSS (TOTAL PSS, kB, `dumpsys meminfo com.kalsa.app`)

The engine loads/unloads between turns, so deltas include reload noise — read as magnitude only.

| point | baseline | new c39f105e |
|---|---|---|
| before a | 680 776 | 3 744 087 (fresh relaunch, startup-inflated — not comparable) |
| after a | 741 911 | 836 618 |
| around b | 749 170 (after) | 795 656 (before c) |
| before → after d | 716 730 → 729 686 | 847 528 → (before e) 820 350 |
| before → after e | 704 810 → 840 396 (+135 586) | 820 350 → 1 015 077 (+194 727) |

## Raw evidence (`raw/`, grep-filtered; file:line = grep -n)

- `base_a_first.log`, `base_a_retry.log` — baseline (a): FUSE open, no app-side PDF line.
- `base_b_docx.log` — baseline (b): FUSE open (docx OK, chip evidence was UI-side).
- `base_c_zhhans.log` — baseline (c): FUSE + MediaProvider's own `pdf_document_jni` lines (picker side).
- `base_d_scanned.log`, `base_e_large.log` — baseline (d)/(e): FUSE + WebView create/destroy ~1.4 s (completed).
- `base_cache_listing.txt` — DocumentPicker copies of every pick + the 14 rendered `pdf-page-*.jpg` (baseline).
- `new_a.log` … `new_e_retry.log` — new APK, one file per attempt: FUSE + `[pdf-extract] csp=true`, nothing else.
- `new_c_retry_webview_lifecycle.log` — WebView created 14:51:44.578, destroyed 14:51:44.873.
- `new_cache_picks.txt` — new-phase DocumentPicker copies; **no** `pdf-page-*.jpg` added after 14:34.

## Notes for whoever debugs the stall

- The stall is not file-specific: text-only (zh-hans, large), image-only (scanned) and the
  historic smoke file all stall; the docx path (no WebView) is fine.
- Not order-dependent: it happened on attempts 1 through 8 across 30 minutes in one app session.
- Baseline's WebView ran the whole pipeline in ≤ 1.8 s (page JPEGs on disk), so device resources
  are not the constraint; the 5.7 page dies right after its CSP probe, before any document work.
- One confound left open: on the new APK no converting chip was ever visible, while baseline's
  first smoke attempt showed "Lettura pagine…" — the mount path may differ between builds.

~ scratchpad/agents/pdfjs57-s23-check/REPORT.md — lab not committed, per brief.
