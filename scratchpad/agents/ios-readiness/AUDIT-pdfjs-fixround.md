# Hostile re-audit — fix round `eeff5228` (pdf.js 5.7 audit remediation)

- **Worktree** `~/Projects/kalsa-expo-bump`, branch `expo57-bump`, HEAD `eeff5228` (worktree clean: `git status --short` → empty)
- **Parent** `86c22012` (the pdf.js 3.11 → 5.7.284 upgrade), previously audited in `AUDIT-pdfjs-upgrade.md`
- **Mode** READ-ONLY. No edits, no commits, no installs, no `vendor-pdfjs.mjs` run (it rewrites `assets/pdfjs`). Only this file was written; all experiments ran in `/tmp`.
- **Verdict up front**: the fix round is a real improvement — the silent 180 s stall is gone, the worker/Blob URLs are genuinely released, `useWorkerFetch:false` is now explicit, and the previously-unreproducible runtime claim is now a committed harness that I verified *executes the shipped bytes and fails when they are broken*. But **one of the two builders never destroys the document** (`var pdfDoc = pdf` shadows the teardown handle), the commit message and the file's own doc block claim a teardown that the text pipeline does not perform, the "no longer silent" CMap claim resolves to a field nobody reads, and two of my previous findings (CMap selection pin, version floor) plus the zero-sink invariant were silently left undone. The load-bearing device checks are still outstanding and still merge-gating.

Marks: **CONFIRMED** = I read the line, ran the command, or executed the real generated page; **PLAUSIBLE** = reasoned, evidence indirect; **REFUTED** = I hypothesised it and it is not true.

---

## 0. Commands run (real exit codes)

| command | exit | notes |
|---|---|---|
| `npx tsc --noEmit` | **0** | `/tmp/tsc_fix.log` empty |
| `npx jest --runInBand src/components/pdfjsAssets.test.ts src/components/PdfToImages.test.ts src/util/pdfBridgeProtocol.test.ts src/components/pdfjsRuntime.test.ts` | **0** | 4 suites / **32 tests** passed, 1.997 s (`/tmp/jest_fix.log`) |
| `node scripts/pdfjsRuntimeHarness.mjs` | **0** | 0.222 s real; JSON report `ok:true`, Latin + 你好, 3 factory calls, `missing:[]` |
| harness vs **truncated lib** (−200 B) | **1** | `pdfjsRuntimeHarness: SyntaxError: Unexpected end of input` |
| harness vs **truncated worker** (−200 B) | **1** | `pdfjsRuntimeHarness: Error: Setting up fake worker failed: "Unexpected end of input".` |
| harness vs **cmap removed** from carrier | **1** | `pdfjsRuntimeHarness: chinese text missing: ""` |
| harness vs **one cmap byte flipped** | **1** | `pdfjsRuntimeHarness: chinese text missing: ""` |
| harness vs **empty fonts carrier** | **1** | `pdfjsRuntimeHarness: pdf.js wanted unpacked assets: standardFontDataUrl/LiberationSans-Regular.ttf` |
| harness vs **missing manifest.json** | **0** | expected: the manifest guard lives in jest, not the harness |
| `node --experimental-vm-modules /tmp/pdfpage/drive.mjs` (my own driver: builds the **real** pages and executes the generated inline `<script>` in a `vm` with stubbed pdf.js/Worker/Blob/timers) | **0** | 7 scenarios, see §3.1 |
| repo byte-size probe (`/tmp/pdfpage/size.mjs`, real carriers + max `pdfB64`) | **0** | image page **10,715,461** chars, text page **10,722,051** chars |
| full jest suite | **not run** | per instruction |

---

## 1. Previous findings — verdict per action item

### A1. BLOCKER 4.1 — silent 180 s stall (worker that fails to load vs. slow PDF) — **FIXED**

`src/components/pdfExtractBootstrap.ts:138-147`
```
    pdfWorker.onerror = function(e){
      engineFail("pdf engine failed: " + ((e && e.message) || "worker error"));
    };
    pdfWorker.onmessageerror = function(){
      engineFail("pdf engine failed: worker message could not be decoded");
    };
    var watchdog = setTimeout(function(){
      engineFail("pdf engine failed to start (bootstrap watchdog)");
    }, ${ENGINE_WATCHDOG_MS});
```
`pdfExtractBootstrap.ts:43` `const ENGINE_WATCHDOG_MS = 60_000;`

Verified by execution, not by reading (my vm driver):
```
=== watchdog fires, doc resolves later (double settle?) ===
  posts: ["cspProbe","pdf engine failed to start (bootstrap watchdog)"]
=== worker onerror, doc NEVER resolves, watchdog fires 60s later ===
  posts: ["cspProbe","pdf engine failed: worker boom"]
  watchdog armed: 1 cleared: 0 fired: 1
```
Exactly one error post in every failure scenario; no double settle. See §3.2 for the one real gap (a `setTimeout` left armed).

### A2. 4.2 — worker never terminated / Blob URLs never revoked — **PARTIALLY FIXED (text builder destroys nothing)**

`pdfExtractBootstrap.ts:107-118`
```
  var pdfWorker = null, pdfLibUrl = null, pdfWorkerUrl = null, pdfDoc = null;
  var engineSettled = false;
  function releaseEngine(){
    if (engineSettled) return;
    engineSettled = true;
    if (pdfDoc) { try { var d = pdfDoc.destroy(); if (d && d.catch) d.catch(function(){}); } catch (e) {} }
```
Worker `terminate()` + both revokes now happen on every in-page settle — CONFIRMED by execution in all 7 scenarios (`calls: ["worker.terminate","revoke:…","revoke:…", …]`).

**But `pdfDoc.destroy()` never runs in the text pipeline.** `src/components/pdfExtractTextHtml.ts:24`
```
          var pdfDoc = pdf;
```
That `var` is inside the `boot().then(function(pdf){ … })` callback, so it declares a *new* binding that shadows the bootstrap's `var pdfDoc = null` (`pdfExtractBootstrap.ts:107`). `releaseEngine()` closes over the **outer** binding, which therefore stays `null` forever in text mode. The image builder does it right — `src/components/pdfExtractHtml.ts:104` `pdfDoc = pdf;` (no `var`).

Runtime proof (`doc.destroy` recorded by a spy proxy):
```
=== image mode, normal completion ===
  calls: ["worker.terminate","revoke…","revoke…","doc.destroy"]      ← destroyed
=== text mode + rasterize, normal completion ===
  calls: ["worker.terminate","revoke…","revoke…"]                     ← NOT destroyed
=== text mode + rasterize, page error mid-run ===
  calls: ["worker.terminate","revoke…","revoke…"]                     ← NOT destroyed
```
Corroborating smell: `pdfExtractTextHtml.ts:194` `if (!pdfDoc || engineSettled)` — the `!pdfDoc` guard is dead in text mode, i.e. the code was written assuming `pdfDoc` is shared. Both builders are covered by the same `describe.each` string test, which cannot see this (`PdfToImages.test.ts:100` `expect(html).toMatch(/pdfWorker\.terminate\(\)/)` matches the shared bootstrap for both).

### A3. 1.5 / 3.3 — `useWorkerFetch` set only by a pdf.js internal default — **FIXED**

`pdfExtractBootstrap.ts:155-158`
```
        // Explicit, not defaulted: pdf.js derives useWorkerFetch from an
        // identity check against its own DOMBinaryDataFactory, and the true
        // path evaluates isValidFetchUrl (URL.parse, missing below Safari 18).
        // false keeps the carriers the only data source.
        useWorkerFetch: false,
```
Pinned by test (`PdfToImages.test.ts:81` `expect(html).toMatch(/useWorkerFetch:\s*false/)`) and by the harness, which passes the same value (`pdfjsRuntimeHarness.mjs:191`). The `URL.parse` short-circuit dependency is gone with it.

### A4. 4.4 — image-mode render/getPage errors swallowed — **FIXED**

`pdfExtractHtml.ts:118-126` now has `.catch(function(e){ engineFail(String((e && e.message) || e)); })` on both chains; verified live: `posts: ["cspProbe","render boom"]` where the old code produced silence. Asymmetry with text mode is gone.

### A5. 4.5 — shadowed `total` — **FIXED** (`pdfExtractTextHtml.ts:88` `var len = 2; // "[]"`). A different shadow now exists — see N1.

### A6. 5.3 / brief §4 — CJK scope stated exactly — **PARTIALLY FIXED**

Correct part: `scripts/vendor-pdfjs.mjs:16-24` now says
```
 * - cmaps: ONLY the Simplified-Chinese predefined CMap family (Adobe-GB1, GB,
 *   GBK, GBT and UniGB variants). … NOT packed: Traditional Chinese
 *   (CNS/UniCNS, B5pc/ETen), Japanese (83pv/90ms-RKSJ/UniJIS) and Korean
 *   (KSC/UHC) predefined-CMap PDFs are unsupported …
```
That is the honest list the previous audit asked for, and it drops the false "smallest set that makes non-embedded CJK PDFs extractable".

Not-fixed part: "no longer silent" is true only for `console.log` + `onExtractMetrics`. Nothing user-facing or model-facing reads it — see N4.

### A7. 6.1 — harness not committed; no BinaryDataFactory contract test — **FIXED, and it is the strongest thing in the round**

`scripts/pdfjsRuntimeHarness.mjs:1-21` states the constraint and the substitution:
```
 * jest's CommonJS transform cannot import the ESM bundle from its ESM source,
```
(read: the header says exactly that; see `pdfjsRuntime.test.ts:10-12` for the jest-side statement). It copies the **vendored** bytes to `.mjs` and imports them (`pdfjsRuntimeHarness.mjs:151-157`), pins the contract from pdf.js's side (`cMapUrl/UniGB-UCS2-H.bcmap`, `standardFontDataUrl/LiberationSans-Regular.ttf`, bare filenames, `missing.length === 0`), and pins it from the factory side (`pdfjsAssets.test.ts:153-211` executes the *real embedded* factory source against the *real* carriers).

Proof it is not theatre: see the six corruption runs in §0 — every broken asset produces exit 1 with a named reason, **including a 200-byte truncation of the worker bundle**, which proves the worker bytes are executed too (Node's fake-worker path imports `workerSrc`).

### A8. 7.1 / 7.5 — dead imports, file split, duplication — **FIXED (imports), PARTIALLY FIXED (sizes, duplication)**

The six dead imports are gone (`PdfToImages.tsx:15-24` now imports only `MAX_PDF_PAGES, PAGE_TIMEOUT_MS, TOTAL_EXTRACTION_TIMEOUT_MS`; a per-symbol occurrence scan of all four touched files reports zero unused imports). Split: `pdfExtractBootstrap.ts` 177 / `pdfExtractHtml.ts` 145 / `pdfExtractTextHtml.ts` 213 — three files under the bar. But `PdfToImages.tsx` is **762 lines** (was 746; the round *added* ~16), and the render-and-chunk pipeline is still duplicated verbatim between `pdfExtractHtml.ts:112-141` and `pdfExtractTextHtml.ts:155-192` — which is exactly why A4 had to be fixed twice by hand.

### A9. 7.2 / 7.3 — false "destroy del documento" clause, Italian comments — **PARTIALLY FIXED (the replacement clause is also false)**

`PdfToImages.tsx:51-53`
```
 * - per-page timeout (30 s) and page caps; the WebView page tears the pdf.js
 *   engine down itself (document destroy, worker terminate, Blob URL revoke)
 *   on every settle path — see pdfExtractBootstrap.ts
```
"document destroy … on every settle path" is **not true** for the text builder (N1). Italian is gone: a word-list scan of `PdfToImages.tsx`, the three builder files, `pdfjsRuntimeHarness.mjs` and `vendor-pdfjs.mjs` returns no hits.

### A10. 5.2 gap 1 + gap 3, and action 9d/10 — CMap selection pin, version floor, zero-sink invariant — **NOT FIXED**

- `pdfjsAssets.test.ts:106-117` still requires **5 of 34** packed cmaps; adding 135 or swapping the family regenerates carrier + manifest together and passes.
- `pdfjsAssets.test.ts:56` `expect(versionAtLeast(manifest.pdfjsVersion, "4.2.67")).toBe(true);` — unchanged. The code now depends on 5.x-only behaviour (`workerPort`, `fetch({kind,filename})`, explicit `useWorkerFetch`); the honest floor is `>= 5.0`.
- No zero-`new Function`/zero-`eval` assertion exists anywhere. I re-verified the invariant by hand against the shipped bytes (`pdf.min.mjs.txt`: `eval(` 0, `new Function` 0; worker: `eval(` 0, `new Function` 1 = `FunctionBasedShading`, the same false positive as before), which is why I care that **no test** holds it.

---

## 2. Security

### 2.1 CSP is byte-identical to the audited parent — CONFIRMED no change, no new exposure

`pdfExtractHtml.ts:24-27` vs `86c22012:pdfExtractHtml.ts:51-54`, same four policy lines. `blob:` in `script-src` is still required by the two `URL.createObjectURL` calls, `worker-src blob:` by the module worker; `'unsafe-inline'` was already the residual exposure and the round did not widen it. WebView guards unchanged (`PdfToImages.tsx:682-705`: `originWhitelist={["about:"]}`, `allowFileAccess={false}`, `allowFileAccessFromFileURLs={false}`, `onShouldStartLoadWithRequest` → `about:blank` only). `assertCarrierSafe` still runs over **all five** carriers before a single character of the page is emitted (`pdfExtractHtml.ts:64-73`). No PDF-controlled byte reaches a script sink: no XFA, no annotation/text-layer DOM, and the only new string sink is a base64 carrier.

### 2.2 The new `cmapsMissing` field — validated and capped on the RN side — CONFIRMED

`pdfBridgeProtocol.ts:388-401`
```
    let cmapsMissing: string[] | undefined;
    if (m.cmapsMissing !== undefined) {
      if (!Array.isArray(m.cmapsMissing)) {
        return malformed("bad_cmaps_missing");
      }
      cmapsMissing = [];
      for (const name of m.cmapsMissing) {
        if (typeof name !== "string" || name.length === 0) {
          return malformed("bad_cmaps_missing");
        }
        if (cmapsMissing.length >= 8) break;
        cmapsMissing.push(name.length > 100 ? name.slice(0, 100) : name);
      }
    }
```
Bounded at 8 × 100 chars, type-checked, and the whole bridge message is length-capped upstream. Tests cover non-array, non-string element, empty name, 12×500 truncation (`pdfBridgeProtocol.test.ts:45-85`). One design note: an empty-string name returns `malformed`, and the component **silently ignores** malformed messages (`PdfToImages.tsx:441-446`) — so a hypothetical empty name would drop the whole `textPassDone` and cost a 30 s page timeout. Unreachable today (pdf.js always appends `.bcmap`), but the failure mode is a hang, not a skip.

### 2.3 Can `cmapsMissing` carry PDF-controlled strings into the model prompt? — CONFIRMED **no**

The name is PDF-controlled — `filename` is `` `${name}.bcmap` `` (`assets/pdfjs/pdf.worker.min.mjs.txt`, `fetchBuiltInCMap`), where `name` is the font's `/Encoding` Name **or** `Name.get(\`${registry}-${ordering}-UCS2\`)` built from the PDF's `/Registry` `/Ordering` **strings** (the classic `Adobe-GB1-UCS2` ToUnicode path). But nothing on the model side reads the field:

```
grep -rn "cmapsMissing" src/ | grep -v "\.test\."
  → only: pdfBridgeProtocol (parse/accumulator), pdfText.ts:78 (type), PdfToImages (write + log)
```
`summarizePdfExtraction` (`src/documents/extractionScope.ts:31-59`) ignores it; `webFetchTool.ts:1027-1060` reads `docs`/`skippedPages`/`documentPageCount` only; `documentChatHost.ts:54-72` builds its tool payload from `scope`. So the prompt is clean. **New**, the names do reach a log: `PdfToImages.tsx:366-369` `? \` cmapsMissing=${metrics.cmapsMissing.join(",")}\``. A `/Registry (a\nb)` string can therefore inject a newline into the `[pdf-extract]` line (log forging, not code execution). Severity low: I found no console interception or log shipping in this repo (`grep -rln "console.log = \|LogBox\|captureConsole" src/` → no hits), so it is Metro/logcat-local, and it is capped at 800 chars.

### 2.4 `worker.onerror` is a wider net than "the worker failed to load" — PLAUSIBLE (behaviour change, unmeasured)

`pdfExtractBootstrap.ts:139-141` posts `"pdf engine failed: " + e.message` for **any** uncaught worker error, including one raised mid-run by an engine bug on a hostile PDF. Before the round that class of failure hung to the 30 s/180 s timer with a neutral message; now it is attributed to "the engine" with the worker's message string (RN-capped to 500 chars at `pdfBridgeProtocol.ts:428`, rendered escaped through React). Failing fast is right; mis-attribution and the loss of the page that was in flight are a diagnostic regression worth knowing about. Also note this string, like `image_payload_cap`, reaches `setError` and is shown to the user verbatim (`PdfToImages.tsx:222-231`, `:642-643`) — the round adds **two new non-localized English strings** to a UI that has `errors.pdfExtractTimeout/Cap/Failed` in `src/i18n/{it,en}.ts`.

### 2.5 `isEvalSupported:false` — CONFIRMED dead claim in the comment the round edited around

`PdfToImages.tsx:447-451`
```
      // CSP self-probe (audit F3) — log-only, never a gate: extraction's own
      // mitigation is isEvalSupported:false reaching both compiled-code
      // new Function sinks, so a WebView that ignores meta CSP must degrade
```
No such option is passed — `pdfExtractBootstrap.ts:148-162` sends `data, useSystemFonts, useWasm, useWorkerFetch, cMapUrl, standardFontDataUrl, wasmUrl, BinaryDataFactory`. The option was real in the original mitigation (`3546f82a:src/components/PdfToImages.tsx:730`) and **no longer exists anywhere in pdf.js 5.7.284** — I grepped both vendored bundles for `isEvalSupported`: **zero hits**. So the CVE is genuinely closed by the version (as the previous audit verified), but the sentence now names a knob that cannot be set, and the defence-in-depth layer it claims ("must degrade to that layer") does not exist. Inherited from `86c22012`, not introduced here — but the round rewrote the doc block 15 lines above it.

---

## 3. Bugs, races, memory

### 3.1 N1 — CONFIRMED: the text pipeline never destroys the document (details in A2)

Impact, stated honestly: the worker — which owns the parsed PDF, `builtInCMapCache`, `standardFontDataCache`, decoded JBIG2/JPX modules — *is* terminated, so the heavy term goes away. What survives on the main thread is the `PDFDocumentProxy` graph (its page-proxy cache and its transport handlers) plus the factory instance's `this.decoded` base64-decoded carrier cache (`pdfExtractBootstrap.ts:96-98`), all reachable from the closure that `renderOne` and `window.__pdfRasterizePages` keep alive. `PdfTextExtractorHost.tsx:3` ("unmounts the WebView as soon as text docs arrive") keeps the retention window short, so this is a correctness-and-claim defect with low runtime blast radius today — but it is exactly the item the round was supposed to close, in the path the tool uses.

### 3.2 N2 — CONFIRMED (minor): the watchdog is not cleared when the engine fails early

`pdfExtractBootstrap.ts:145-147` arms the timer; `clearTimeout(watchdog)` exists only at `:169` (success) and `:172` (catch). `engineFail` (`:120-124`) has no reference to it. Execution confirms the leftover:

```
=== worker onerror, doc NEVER resolves, watchdog fires 60s later ===
  watchdog armed: 1 cleared: 0 fired: 1
  posts: ["cspProbe","pdf engine failed: worker boom"]     ← no double post
```
Harmless (the late fire is an `engineSettled` no-op, and the WebView is torn down anyway), but it is the "watchdog cleared on every path" question you asked: it is not, and the code reads as if it were.

### 3.3 N3 — CONFIRMED: 60 s is a defensible but *new* hard ceiling on document open, and the "slow first page" case is not what it bounds

The watchdog is armed before the library import and cleared the moment `getDocument().promise` resolves (`pdfExtractBootstrap.ts:145`, `:169`), i.e. it covers **import + xref/catalog parse**, not page rendering — so a legitimately slow *first page* is not cut off (that is still the 30 s `PAGE_TIMEOUT_MS`/`PdfToImages.tsx:322`). Two things to weigh:
- The hard input cap is `DEFAULT_MAX_BYTES = 5 * 1024 * 1024` (`PdfToImages.tsx:149`), so the "7 MB PDF" scenario is rejected long before the WebView (`PdfToImages.tsx:292`, `pdfTooLarge`). Worst case in the window is a 5 MiB document.
- That is still a **new failure mode**: a document that would previously have opened at, say, 75 s and extracted fine now dies at 60 s with `pdf engine failed to start (bootstrap watchdog)`. `86c22012` never had that ceiling. 60 s is generous for a 5 MiB open on a Helio G99, but it is a guess, and the honest fix is to state it as a budget with a measured p99 rather than a constant. Cheap improvement: name it in the report and consider deriving it from the RN total timer (180 s) rather than hard-coding it next to the JS.

### 3.4 Double settle — CONFIRMED none, in all five failure shapes I executed

`engineFail` checks `engineSettled` before `releaseEngine()` sets it, with no `await` between (`pdfExtractBootstrap.ts:120-124`), so a watchdog + late resolution, an `onerror` + late watchdog, and a `getPage` rejection each produce exactly one `{error}` post. The image builder's `releaseEngine(); post({done: true})` (`pdfExtractHtml.ts:112`) fires once (`posts: […,"page1","done","page2","done","done"]`), and `sendChunks`/`sendImageChunks` never straddle a settle.

### 3.5 Terminate-before-messages / revoke-before-import — CONFIRMED safe

`releaseEngine` revokes `pdfLibUrl` after `pdfjs` is already instantiated, and the only way to reach it while the import is in flight is `engineFail`, which posts and ends the run; the in-flight import then either resolves into a terminated worker (rejects → `engineFail` no-op) or never settles. No post follows a revoke; no pending `setTimeout(next,10)` chunk loop can outlive a settle in either builder because the loops are strictly sequential.

### 3.6 Memory — N1 above, plus the acknowledged live settle

`pdfExtractTextHtml.ts:43-45` is accurate:
```
            // Not a settle: the host may still inject a rasterize pass, so the
            // engine stays live until that done or the WebView is unmounted.
```
and `PdfToImages.tsx:376-378` returns (`finishDone`) for `mode === "text"` or no skipped pages, so the host does unmount. The HTML-size claim is now real and, for the first time, measured — but with two nits, see §6.3.

---

## 4. Privacy

- **No new network.** `useWorkerFetch:false` is explicit, `connect-src` still falls back to `default-src 'none'` (policy unchanged), and the harness proves the carriers are the only data source (`missing: []`). Nothing in the round adds a fetch, a URL, or a host.
- **New log surface** (§2.3): up to 800 chars of PDF-controlled ASCII in one `console.log`, local-only, no interception found.
- `pdfjsRuntimeHarness.mjs` writes only to `mkdtempSync(tmpdir())` and `rmSync`s in `finally`; no network, no repo writes. Fixtures are generated in-memory, so no new committed PDFs.

---

## 5. Tests

### 5.1 Does `pdfjsRuntime.test.ts` really execute `assets/pdfjs` bytes, and fail when they break? — CONFIRMED both

It spawns `process.execPath` on the harness (`pdfjsRuntime.test.ts:27-31`), which copies `assets/pdfjs/*.mjs.txt` to `.mjs` and imports them (`pdfjsRuntimeHarness.mjs:151-157`); six corruption runs, five hard failures (§0). One caveat it is honest about: Node takes pdf.js's fake-worker path (`pdfjsRuntimeHarness.mjs:180-183`), so `new Worker("blob:null/…", {type:"module"})` and `import()` of a Blob URL — the two primitives still lacking device evidence — are **not** covered by any test, in either direction.

### 5.2 Does it fail on env/ordering problems? — CONFIRMED clean

`pdfjsRuntime.test.ts` mutates no global and no env (`spawnSync` only); `pdfjsAssets.test.ts:167-171,205-210` snapshots and restores `globalThis.document` in a `finally`. Jest runs `testEnvironment: "node"`, so `document` is `undefined` before and after. No fake timers, no `Date.now` patching. CI runs `npx jest --runInBand` on Node 22 (`.github/workflows/ci.yml:33,43`), and the harness hard-fails below Node 22 (`pdfjsRuntimeHarness.mjs:37-39`), so the suite cannot silently pass on the wrong runtime.

### 5.3 Gaps that remain — CONFIRMED

- **No behaviour test for teardown.** `PdfToImages.test.ts:92-106` asserts substrings (`/pdfWorker\.terminate\(\)/`, `/URL\.revokeObjectURL\(pdfLibUrl\)/`) that live in the *shared* bootstrap, so they are identical for both builders and cannot detect N1. My vm driver does, in ~150 lines.
- **The `wasmUrl` kind is never triggered.** No fixture is a scanned JBIG2/JPX PDF, so `jbig2.wasm` delivery is proven only as bytes (`pdfjsAssets.test.ts:198`) and structurally (`kind ∈ KINDS`), never as a real `FetchBinaryData` round trip. A 2 KB JBIG2 fixture would close it.
- **`cmapsMissing` has no end-to-end test** — no test drives the parser+accumulator+`PdfToImages` path from a page message to the emitted result; `pdfBridgeProtocol.test.ts:45-85` covers the parser only.
- **Pre-existing, unchanged:** `PdfToImages.tsx` (the component, 762 lines, all the timer arbitration and unmount logic) still has **no render test** — the `jest.mock` scaffolding for it was removed in `86c22012` and never restored. The component is exactly where N1's consequence lands.

---

## 6. Code quality

### 6.1 Sizes and dead code
| file | lines |
|---|---|
| `PdfToImages.tsx` | **762** (bar is ~250; grew by 16 this round) |
| `pdfExtractBootstrap.ts` | 177 ✓ |
| `pdfExtractTextHtml.ts` | 213 ✓ |
| `pdfExtractHtml.ts` | 145 ✓ |
| `scripts/pdfjsRuntimeHarness.mjs` | 267 (scripts; repo convention) |

No unused imports (per-symbol occurrence scan). No dead exports: `pageHead`/`pageTail`/`PDF_HTML_CSP_META`/`PdfHtmlInput` all have consumers. No speculative abstraction was added — `pageHead`/`pageTail` is the one seam, and it is used by both builders.

### 6.2 Comment accuracy — two stale/false comments survive
- `PdfToImages.tsx:51-53` "document destroy … on every settle path" — false for the text builder (N1).
- `PdfToImages.tsx:41-43` "see pdfExtractHtml.ts for the loader, the CSP and the in-memory factory that serves CMaps / standard fonts / wasm decoders offline" — the factory moved to `pdfExtractBootstrap.ts` in this very commit; the loader and CSP are in `pdfExtractHtml.ts`.
- `PdfToImages.tsx:632` `// Total timer only: 150s safety net for hung bootstrap.` while `TOTAL_EXTRACTION_TIMEOUT_MS = 180_000` (`pdfBridgeProtocol.ts:104`) — pre-existing (present at `86c22012`), not touched, still wrong.
- Accurate and worth keeping: the `useWorkerFetch` rationale, the `workerPort`-vs-`workerSrc` paragraph, the "Not a settle" note, the SC-only-CMap comment at `pdfExtractBootstrap.ts:66-72`, and the harness header's honest statement of what it does and does not prove.

### 6.3 Commit message accuracy
| claim | verdict |
|---|---|
| "wires worker.onerror/onmessageerror to a named failure" | CONFIRMED, executed |
| "bounds library import + document open with a 60 s watchdog" | CONFIRMED; correct scoping (not the first page) — see N3 |
| "posts `pdf engine failed to start (bootstrap watchdog)`" | CONFIRMED |
| "the page now calls pdf.destroy() + worker.terminate() and revokes both Blob URLs on every in-page settle path: … and both builders' final done" | **FALSE for the text builder** — `pdf.destroy()` is never reached there (N1) |
| "The one page-live settle without a release is a finished text pass awaiting a possible rasterize injection" | CONFIRMED, and the only such case |
| "useWorkerFetch: false is now explicit … the offline carriers no longer depend on either internal" | CONFIRMED |
| "validated + capped in pdfBridgeProtocol" | CONFIRMED (8 × 100) |
| "surfaced on PdfRetrievalDocsResult.cmapsMissing (the requestPdfText tool-result path)" | **MISLEADING** — written, never read; it does not reach the tool result or the model (N4) |
| "in PdfDocumentExtractMetrics and the [pdf-extract] log" | CONFIRMED |
| "vendor-pdfjs.mjs header corrected accordingly" | CONFIRMED, and the correction is right |
| "harness … executes the VENDORED bytes from assets/pdfjs (not node_modules)" | CONFIRMED, and it fails when they break |
| "fixtures … <20 KB" | CONFIRMED (generated in-memory, ~1 KB) |
| "jest cannot import the ESM bundle from its CommonJS transform" | CONFIRMED (plausible mechanism; ts-jest/`transformIgnorePatterns` absent) |
| "pdfjsAssets.test.ts executing the real embedded factory source against the real carriers (hit bytes, miss rejection, missingCmaps recording)" | CONFIRMED, all three assertions exist and pass |
| "the shadowed `total` counter … is renamed `len`" | CONFIRMED — and a *new* shadow was introduced in the same commit (N1) |
| "Measured HTML size: max 10,715,459 (image) / 10,722,049 (text) … + 8,500 B of page scaffold" | **off**: measured max is **10,715,461 / 10,722,051** (2 chars short — consistent with measuring at `maxPages:1`, not 200), and the scaffold decomposition only holds for the image page; the text page's scaffold is **15,092** chars. Immaterial in magnitude, but the numbers were not produced by the committed code at its maximum input. |
| "the six dead imports are gone" | CONFIRMED |
| "remaining Italian comments in the touched blocks translated to English" | CONFIRMED (word-list scan clean) |
| "4 suites / 32 tests exit 0", "tsc --noEmit exit 0" | CONFIRMED, reproduced exactly |
| "node scripts/vendor-pdfjs.mjs exit 0 and regenerates byte-identically" | NOT RE-RUN (READ-ONLY); the drift assertions inside `pdfjsAssets.test.ts` pass (exit 0), which is the part that matters |
| "Still pending and still merge-gating: device evidence … and memory A/B" | CONFIRMED correct, and I agree they gate the merge |

---

## 7. Required before merge

1. **Delete the `var` on `pdfExtractTextHtml.ts:24`** (`pdfDoc = pdf;`), so `releaseEngine()` actually destroys the document in the text pipeline, then add a behaviour test (my vm driver is a working template) instead of the substring assertions at `PdfToImages.test.ts:100-103`. This is the only item that makes a *false statement in the code and the commit message* true.
2. **Either consume `cmapsMissing` or drop it from `PdfRetrievalDocsResult`.** As written it is a field the type declares and nothing reads; the brief asked for something "the host already has a path for". If it stays, wire it into `summarizePdfExtraction`'s scope and into the `document_chat`/tool copy so a short document says *why* it is short.
3. **Fix the three false/stale comments**: `PdfToImages.tsx:51-53`, `:41-43`, `:447-451` (drop `isEvalSupported` — the option does not exist in 5.7; say "5.7 removed the sinks" instead).
4. **Add the zero-`new Function`/zero-`eval` assertion** over `assets/pdfjs/*.mjs.txt` and raise the floor from `4.2.67` to `5.0` (A10). The CVE claim is currently held by a generated string and nothing else.
5. **Pin the CMap selection** (`expect(cmaps).toHaveLength(34)` or a sorted `toEqual`), so the SC-only scope cannot silently change.
6. **Cap `req.filename` on the page side** (`pdfExtractBootstrap.ts:88-93`) and stop silently truncating at 8 without saying so — a name list that stops at 8 with no marker under-reports exactly the case it exists to explain.
7. **Decide the 60 s budget explicitly** (N3) and put the measured document-open p99 for both phones in the report; if it is not measured, say it is a guess.
8. **Device evidence, still merge-gating** (unchanged from the previous audit, and now the only remaining coverage gap that matters): `blob:null` module worker + `import()` on the Jelly Star WebView and WKWebView 16.4; a scanned JBIG2/JPX PDF (also the missing wasm-kind test fixture); a 200-page text run and a 5 MiB PDF with memory numbers; and one Traditional-Chinese or Japanese predefined-CMap PDF to confirm the new `cmapsMissing` surfaces in a real run.

## 8. What is genuinely good here

- The harness is the right artifact and it is *real*: it executes the vendored lib **and** worker bytes, it fails loudly on five kinds of corruption, it pins the `BinaryDataFactory` contract from both sides, and it says plainly that Node takes the fake-worker path so it does not pretend to cover Blob workers. This closes the previous audit's worst evidence gap.
- The watchdog/`onerror` wiring is minimal, correctly ordered (armed before the import, cleared on both boot outcomes), and produces exactly one terminal message in every failure shape I could construct.
- `useWorkerFetch:false` + the comment explaining *why* turns a load-bearing dependency on a pdf.js internal into a stated, testable contract.
- The CMap scope is now written down honestly, in the code that decides it, including the two language families the previous commit message implied were covered.
- The image-mode `.catch` gap and the `total`/`len` shadow were fixed rather than reproduced; the split is along a real seam and stopped before inventing an abstraction.
- The commit message is candid about what remains unverified, and the measured HTML size is now in it even though the numbers are 2 chars off.