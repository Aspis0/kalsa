# Hostile audit — commit `749f3591` (pdf.js 3.11.174 → 5.7.284 legacy ESM)

- **Worktree** `~/Projects/kalsa-expo-bump`, branch `expo57-bump`, HEAD `749f3591`
- **Parent** `7ea8719f` (audit already on file: `AUDIT-pdfjs-cve.md`)
- **Mode** READ-ONLY. No edits, no commits, no installs. Only this file was written.
- **Verdict** the CVE is genuinely closed, the offline data path is correct against the real 5.7 API, and the asset pipeline is reproducible and hash-pinned. But the change ships **two load-bearing browser primitives that were never executed on either device**, and it removes pdf.js's own worker-liveness detection without replacing it, so the most likely production failure is a **silent 180-second stall**. It also leaves six dead imports, a stale "destroy the document" comment that is now doubly wrong, and a 2.6× larger HTML string pushed through Hermes → native → WebView with no measurement.

Marks: **CONFIRMED** = read the line / ran the command; **PLAUSIBLE** = reasoned, evidence indirect; **REFUTED** = I hypothesised it and it is not true.

---

## 0. Commands run (real exit codes)

| command | exit |
|---|---|
| `npx tsc --noEmit` | **0** (`/tmp/tsc_pdf.log`, empty) |
| `npx jest --runInBand src/components/pdfjsAssets.test.ts src/components/PdfToImages.test.ts src/util/pdfBridgeProtocol.test.ts` | **0** — 3 suites / 25 tests passed |
| node sha256 recompute of all 51 `inputs` + 5 `outputs` + drift simulation | **0** (all match; see §5) |
| `grep -c "\b<SYMBOL>\b" src/components/PdfToImages.tsx` | **0** for dead-import proof |
| `npx eslint …` | **2** — *repo has no eslint config at all*; `eslint-disable-next-line react-hooks/exhaustive-deps` comments are no-ops |
| full jest suite | **not run**, per instruction |

---

## 1. Security

### 1.1 CVE-2024-4367 is actually closed in the shipped bytes — CONFIRMED

Not by version-string assertion; by scanning the vendored bundles for the sinks themselves.

```
pdf.min.mjs.txt      new Function( : 0     eval( : 0
pdf.worker.min.mjs.txt  new Function( : 0   eval( : 0
```

A naive `new Function` grep returns **1 hit in the worker** — it is a false positive: `case Vn: return new FunctionBasedShading(...)`. `FunctionBasedShading` is a *PostScript shading* class name, not a code-compilation sink. Both the Type-1 glyph compiler and the PostScript function compiler are gone, exactly as the commit message claims. The remaining dynamic-code surface is one core-js global-detection chain that is short-circuited in any browser:

`pdf.worker.min.mjs`:
```
4576(e){var check=function(e){return e&&e.Math===Math&&e};
e.exports=check("object"==typeof globalThis&&globalThis)||check("object"==typeof window&&window)||...
```
`globalThis` exists at both floors (Chrome 71 / Safari 12.1), so `Function("return this")` is never evaluated. The CSP's lack of `'unsafe-eval'` does not break the bundle.

`assertCarrierSafe` also holds for the real assets — verified independently of the test:
```
pdf.min.mjs.txt </script>:0 <!--:0   cmaps-cn.txt </script>:0 <!--:0 json-parseable: yes
```

### 1.2 Does `blob:` in `script-src`/`worker-src` let a malicious PDF run code? — CONFIRMED no

`pdfExtractHtml.ts:53-56`:
```
export const PDF_HTML_CSP_META =
  `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; ` +
  `script-src 'unsafe-inline' 'wasm-unsafe-eval' blob:; worker-src blob:; ` +
```

`blob:` in `script-src` is required (the library is loaded by `import()` of a blob) and buys an attacker exactly nothing on its own: `blob:` is a *scheme source*, it does not relax the eval ban, and the only blobs that exist are the two the page itself creates from build-controlled carriers. `script-src 'unsafe-inline'` remains the real residual exposure, and it is unchanged from `33812d0b`. The question that decides it is whether any PDF-controlled byte can reach a script-execution sink in this page. Checked:

```
pdf.min.mjs.txt   innerHTML: 0   document.write: 0   new Image(: 0
pdf.worker.min.mjs  innerHTML: 0   document.write: 0
```

- No XFA (`enableXfa` never set → `false`), so `XfaFactory`/`XfaLayer` — the only place pdf.js turns PDF strings into DOM/HTML — is unreachable. Its `new Image({})` and `URL.createObjectURL` sites are XFA-only.
- No annotation layer, no text layer DOM, no form rendering.
- The one PDF-adjacent string→CSS sink is `@font-face`:
  ```
  const d=`@font-face {font-family:"${o}";src:${`url(data:font/opentype;base64,${btoa(l)});`}}`;
  ```
  and `o` there is a build-time test-font name, not PDF-derived. Real fonts use `this.loadedName`, which pdf.js generates. And CSS injection is not script execution anyway.
- The font data path is `data:`-only, matching `font-src data:`:
  ```
  const t=`url(data:${this.mimetype};base64,${this.data.toBase64()});`;
  ```

`'wasm-unsafe-eval'` is a narrow, justified grant — **CONFIRMED** by construction: the only `WebAssembly.instantiate` inputs in the bundle are `this.#B`, which is populated *only* from the vendored carriers:
```
static async #N(e,t,n){const a="jbig2.wasm";
this.#B=await this.#D.sendWithPromise("FetchBinaryData",{kind:"wasmUrl",filename:a});
return n((await WebAssembly.instantiate(this.#B,t)).instance)
```
A hostile PDF controls the *image data* fed to those two fixed, trusted binaries; it cannot supply the binaries. Support at the floors is real: caniuse reports `'wasm-unsafe-eval'` as **Chrome 97+, Safari 16.0+/iOS 16.0+** (https://caniuse.com/mdn-http_headers_content-security-policy_script-src_wasm-unsafe-eval), so iOS 16.4 and any Chrome-97+ WebView are covered.

Residual risk worth stating in the report, not as a blocker: JBIG2/JPX decoding runs a memory-unsafe decoder over attacker-controlled compressed data inside the WebView process. That class of risk is not reduced by this commit (3.11 had the same decoders), it is only newer. `useWasm:true` buys scanned-document fidelity at that price; the trade is legitimate but should be written down as a decision, not only as a justification for the CSP keyword.

### 1.3 Does the CSP self-probe still work? — CONFIRMED working, and it is deliberately **not** fail-closed

`pdfExtractHtml.ts:96-98`:
```
  var cspBlocked = false;
  try { new Function(""); } catch (e) { cspBlocked = true; }
  post({ kind: "cspProbe", blocked: cspBlocked });
```
With no `'unsafe-eval'` in `script-src`, `new Function("")` throws `EvalError` → `blocked:true`. Ordering is still correct (probe precedes `boot()`), and `PdfToImages.tsx:411-418` returns early on `cspProbe` so it neither arms the page timer nor touches the accumulator. **But**: the probe is log-only by design (`PdfToImages.tsx:404-406`: "audit F3 — log-only, never a gate"), so "fail closed" is the wrong expectation to carry forward from the earlier audit. Nothing gates on it, in this commit or the previous one.

### 1.4 PDF content → RN bridge: no new unvalidated path — CONFIRMED

`src/util/pdfBridgeProtocol.ts` is untouched by this commit (not in the diff), and its caps still hold: raw message length `MAX_PAGE_PAYLOAD_BYTES + 4096`, chunk data `CHUNK_SIZE + 1024`, `MAX_BRIDGE_MESSAGES = 10_000`, error strings sliced to 500, `documentPageCount` clamped to 1e6, every projected text item re-validated by `projectTextItem` with `str` capped at `MAX_ITEM_STR_CHARS` and unknown fields dropped. The WebView-side budgets are enforced *before* `JSON.stringify` (`pdfExtractHtml.ts:288-303`), which is the correct order.

Navigation controls are intact and unchanged: `PdfToImages.tsx:666` `originWhitelist={["about:"]}` and `PdfToImages.tsx:689` `onShouldStartLoadWithRequest={(request) => request.url === "about:blank"}`. The page posts only fixed message shapes. Error strings derived from pdf.js (which can embed object ids and font names) are length-capped at 500 and rendered through React, so they are escaped. No finding.

### 1.5 The one security-adjacent regression the commit did not notice — CONFIRMED

`getDocument` is called with a **custom** `BinaryDataFactory`, which makes pdf.js's `useWorkerFetch` default `false` — correct, and it is what keeps everything in memory (§2). But the page never sets `useWorkerFetch` explicitly. `pdfExtractHtml.ts:108` states the dependency as a comment:

```
  // over FetchBinaryData (useWorkerFetch defaults false for non-DOM factories).
```

The real contract, `src/display/api.js` @ v5.7.284:
```js
const useWorkerFetch =
  typeof src.useWorkerFetch === "boolean"
    ? src.useWorkerFetch
    : … || !!( BinaryDataFactory === DOMBinaryDataFactory && cMapUrl && cMapPacked &&
              standardFontDataUrl && … && isValidFetchUrl(...) && isValidFetchUrl(...) );
```
and the doc comment for the option says:
```
 * @property {boolean} [useWorkerFetch] - Enable using the Fetch API in the
 *   worker-thread …  If `true`, the `BinaryDataFactory` option is ignored.
```

So the entire offline-data design rests on an **undocumented identity comparison against a class the app does not control**. If a future pdf.js changes that default, the failure is silent and *security-relevant*: cmaps/fonts/wasm stop coming from the carriers and pdf.js falls back to `DOMBinaryDataFactory`, i.e. real `fetch()` — blocked by `connect-src 'none'`, so extraction degrades to no CJK, no standard fonts, no wasm decoders, with no error. One line (`useWorkerFetch: false`) converts a fragile inference into an explicit, documented, testable contract. The test suite pins the *string* `BinaryDataFactory:\s*PdfAssetsBinaryDataFactory` but never pins `useWorkerFetch`.

---

## 2. Privacy / network

### 2.1 `connect-src` really does fall back to `default-src 'none'` — CONFIRMED

The policy has no `connect-src` and `default-src 'none'`, so `connect-src` = `'none'`; MDN's fetch-directive table confirms `default-src` fallback for `script-src` and, by the same rule, `connect-src`. That covers `fetch`, XHR, WebSocket, EventSource, beacon, and `img`/`font` are separately narrowed to `data:`/`blob:`.

### 2.2 Nothing in the shipped bundles can reach the network on this configuration — CONFIRMED

I traced every candidate:

- `DOMBinaryDataFactory._fetch` (the only `fetchData` on the main thread) is unreachable: it is only instantiated when `BinaryDataFactory === DOMBinaryDataFactory`.
- The worker's `fetchBinaryData(e){const t=await fetch(e);…}` is reachable **only** when `useWorkerFetch === true`, which it is not.
- `fetchSync` (3 occurrences, worker) is used by `QCMS` and `CmykICCBasedCS`. `QCMS.setOptions` explicitly disables itself off the factory path:
  ```
  static setOptions({useWasm:e,useWorkerFetch:t,wasmUrl:n}){if(t){this.#C=e;this.#I=n}else this.#C=!1}
  ```
  With `useWorkerFetch === false`, `#C = false`, `isUsable` is false, and `${wasmUrl}qcms_bg.wasm` is never fetched. `iccUrl` is never passed, so `CGATS001Compat-v2-micro.icc` is likewise unreachable. **The commit message's claim that qcms "degrades to the same non-ICC conversion 3.11 always used" is CONFIRMED by the source, not just asserted.**
- The `*_nowasm_fallback.js` URL imports are the only other network-capable path:
  ```
  static async #P(e){const t=`${this.#I}jbig2_nowasm_fallback.js`;
  let n=null;try{n=(await import( t)).default()}catch(e){warn(...)}e(n)}
  ```
  `wasmUrl` is the fake string `"in-memory/wasm/"`. Resolved against a blob-module worker base (`blob:null/…`, an opaque-path URL) relative resolution **throws a `TypeError`**, which the surrounding `try/catch` swallows into a `warn`. Degradation, not exfiltration. (`wasmUrl` is also not in the page's `connect-src`, so CSP would block it as a module fetch regardless.)

**Worth stating explicitly, because it is the load-bearing property**: the no-network guarantee does **not** depend on blob workers inheriting the owner's CSP. It depends on `useWorkerFetch === false`. Even if a WebView gave the blob worker an empty CSP, the worker would still have nothing to fetch. Do not rely on the inheritance when this is re-reviewed.

### 2.3 The `cMapUrl`/`standardFontDataUrl`/`wasmUrl` parameters are decorative — PLAUSIBLE (low severity)

`pdfExtractHtml.ts:150-152` passes `"in-memory/cmaps/"`, `"in-memory/fonts/"`, `"in-memory/wasm/"`, but `PdfAssetsBinaryDataFactory`'s constructor ignores its arguments entirely:
```js
function PdfAssetsBinaryDataFactory(){
  this.maps = { cMapUrl: assetMap("pdfjs-cmaps"), standardFontDataUrl: assetMap("pdfjs-fonts"), wasmUrl: assetMap("pdfjs-wasm") };
  this.decoded = {};
}
```
Because the class overrides `fetch`, `BaseBinaryDataFactory.fetch`'s "Ensure that the `cMapUrl` API parameter is provided" guard never runs, so these three values are never read by the factory. Harmless today, and `PdfToImages.test.ts:88-91` asserts on them, which cements a fiction: a reader will assume the fake prefixes route something. Either drop them or say in one line that they exist only so pdf.js's default-`useWorkerFetch` computation sees them (it does not, per §1.5) — in which case drop them.

---

## 3. Compatibility

### 3.1 "5.7 is the newest pdf.js that still runs in our floors; 6.x needs Chrome ≥ 125 / Safari ≥ 18" — **CONFIRMED, exactly**

`gulpfile.mjs` at tag **v5.7.284**:
```js
const ENV_TARGETS = [
  "last 2 versions",
  "Chrome >= 118",
  "Firefox ESR",
  "Safari >= 16.4",
  "Node >= 22",
  "> 1%", "not IE > 0", "not dead",
];
```
PR mozilla/pdf.js#21152 (`[api-major] Update the minimum supported browsers, and remove no longer needed polyfills`, merged 2026-05-01) is the 6.0 change that removes exactly those two lines and leaves `"Chrome >= 125"` / `"Safari >= 18"`. So:

- iOS floor is `Safari >= 16.4` for 5.7 — the app's `deploymentTarget: "16.4"` (`app.config.js:18`) lands exactly on it. **Zero headroom**: the floor is met by construction, not by margin.
- Android floor is `Chrome >= 118` (a WebView from ~Oct 2023), not the vague "1xx" in the commit message.

The commit message's browser-floor reasoning is the best-supported claim in the change. It should say `Chrome >= 118` instead of "1xx".

### 3.2 Android: "System WebView can be old?" — CONFIRMED it can, and there is no gate

`android/gradle.properties:66` `android.minSdkVersion=33`. WebView is updated through Play Store independently of the OS image, so an API-33 handset can be running a 2021 WebView. Nothing in this change (or the previous mitigation) enforces or detects a minimum WebView version. The honest statement of the risk is: *below Chrome 118 the change is out of pdf.js's tested envelope*; in practice the two hardest primitives (module workers, `import()`) landed at Chrome 80 and Chrome 63 respectively, and `Promise.withResolvers` is core-js-polyfilled in the legacy build (verified: module `4628(e,t,n){…a({target:"Promise",stat:!0},{withResolvers:…})}`). So an old WebView will probably still parse and boot, and then fail somewhere less obvious. **PLAUSIBLE**, and unmeasured — this belongs in the report as a stated floor, not as an assumption.

### 3.3 The legacy build is *not* actually transpiled down to Safari 16.4 — CONFIRMED, and it matters

Feature scan of the vendored legacy bundles for APIs newer than the claimed floor:

| API | occurrences | floor |
|---|---|---|
| `URL.parse` | 8 (lib) / 2 (worker) | Safari 18, Chrome 126 — MDN: "Baseline 2024 … Since September 2024 … might not work in older devices or browsers" |
| `Uint8Array.fromBase64` | 1 (lib) / 1 (worker) | Chrome 140 / Safari 18 |

All `URL.parse` sites are URL-handling helpers (`createValidAbsoluteUrl`, `updateUrlHash`, `isValidFetchUrl`, `getResponseOrigin`, `getPdfFilenameFromUrl`, `PDFWorker._isSameOrigin`), and the two `Uint8Array.fromBase64` sites are `decompressSignature` (lib) and an XFA `imageEdit` field (worker). None are reached by this page — **but only because `O === DOMBinaryDataFactory` short-circuits before `isValidFetchUrl(g, document.baseURI)` is evaluated.** That is a second, independent reason §1.5 matters: on a WebView without `URL.parse`, if that short-circuit ever stops happening, `getDocument` throws a `TypeError` on the load path.

### 3.4 Module workers and `import()` of blob modules at the floors — supported by the engines, **unverified in this app**

- Module workers: caniuse `wf-js-modules-workers` → **Safari 15+/iOS 15+, Chrome 80+**. Above the floors.
- Dynamic `import()`: caniuse `es6-module-dynamic-import` → **iOS Safari 11+**. Above the floors.
- The vendored worker is a *self-contained* module — 0 static imports, 0 `importScripts`, only the 2 fallback `import()`s — so blob resolution has nothing relative to resolve. Verified:
  ```
  pdf.worker.min.mjs  importScripts: 0   static import stmt: 0   dynamic import() : 2
  ```
- The document really is at an opaque origin on both platforms, which is the whole reason `workerPort` was chosen:
  - Android, `RNCWebViewManagerImpl.kt:390-395` — `val baseUrl = if (source.hasKey("baseUrl")) source.getString("baseUrl") else ""` then `view.loadDataWithBaseURL(baseUrl, html, …)`. Per the Android contract, a non-http base URL is treated as `about:blank`.
  - iOS, `RNCWebViewImpl.m:841-845` — `baseURL = [NSURL URLWithString:@"about:blank"]; [_webView loadHTMLString:html baseURL:baseURL];`
  So blob URLs are `blob:null/<uuid>`. pdf.js's own comment on the alternative confirms the reasoning is right:
  ```
  // Check if URLs have the same origin. For non-HTTP based URLs, returns false.
  this._isSameOrigin = (baseUrl, otherUrl) => { const base = URL.parse(baseUrl);
    if (!base?.origin || base.origin === "null") { return false; } … };
  ```
  With `workerSrc` set to a blob, pdf.js would take that `false` branch and wrap the blob in a second blob (`await import("blob:null/…")`). `workerPort` skips `_isSameOrigin`, `_createCDNWrapper` and `URL.parse` entirely. **The `workerPort` decision is correct and the comment at `pdfExtractHtml.ts:133-134` is accurate.**

  **PLAUSIBLE / unverified:** I could not find a primary source stating that `new Worker("blob:null/…", {type:"module"})` and `import("blob:null/…")` are exercised at WKWebView 16.4 / an API-33 WebView. The commit message itself lists this as pending: "Device checks still required (see report): blob module worker + import on both WebViews". That admission is the correct one, and it should gate the merge, not trail it.

---

## 4. Bugs, races, memory

### 4.1 **BLOCKER** — a worker that fails to load is indistinguishable from a slow PDF, and costs 180 seconds — CONFIRMED

This is the sharpest defect in the change.

`pdfExtractHtml.ts:135-141` hands pdf.js a live `Worker` object. pdf.js's port path performs **no handshake and installs no error listener** (minified `pdf.min.mjs`):
```
async #os(t){this.#tr=t;this.#is=new MessageHandler("main","worker",t);this.#is.on("ready",()=>{});this.#hs()}
```
`#hs()` resolves the worker promise immediately. Compare the `workerSrc` path, which pdf.js builds precisely for this:
```
const e=new Worker(t,{type:"module"}),i=new MessageHandler("main","worker",e),
  terminateEarly=()=>{n.abort();i.destroy();e.terminate(); … else this.#ds()},
  n=new AbortController;
e.addEventListener("error",()=>{this.#ns||terminateEarly()},{signal:n.signal});
i.on("test",t=>{n.abort();if(!this.destroyed&&t){ … }else terminateEarly()});
```
i.e. an `error` listener, a round-trip `test` handshake, and a fake-worker fallback. `workerPort` opts out of **all three**, and the page adds none.

Consequence chain, all CONFIRMED by reading the code:
1. If `new Worker(blobUrl, {type:"module"})` *constructs* but the module fails to load (CSP refusal, opaque-origin rejection, a parse error in the blob), the constructor does not throw.
2. `boot()` resolves `getDocument(params).promise`, which never settles; nothing is ever posted.
3. `PdfToImages.tsx` arms **no page timer until the first message** (`// Do not arm the page timer until the first WebView message`), so the only bound is `TOTAL_EXTRACTION_TIMEOUT_MS = 180_000`.
4. The user gets `errors.pdfExtractTimeout` / `PdfExtractError("timeout")` — the same message a genuinely slow PDF produces, after three minutes, per attempt, with no diagnostic.

The upside is that a *construction* failure is reported cleanly, so not everything is silent:
```
  } catch (e) { post({error: String((e && e.message) || e)}); }
```

Minimum fix, all inside `sharedBootstrap`: keep the `Worker` reference, add `worker.onerror` / `worker.onmessageerror` handlers that `post({error:"pdf_worker_failed"})`, and add a bootstrap watchdog (`setTimeout` → `post({error:"pdf_bootstrap_timeout"})`) armed before `boot()` and cleared when `getDocument` resolves. Turns a 180 s mystery into a 10 s named failure.

### 4.2 **BLOCKER-adjacent** — the module worker is never terminated, even by `pdf.destroy()` — CONFIRMED

`pdfExtractHtml.ts` never calls `revokeObjectURL`, `terminate()`, `pdf.destroy()`, `pdf.cleanup()` or `page.destroy()`:
```
$ grep -n "destroy()|cleanup()|revokeObjectURL|terminate()" src/components/PdfToImages.tsx src/components/pdfExtractHtml.ts
(no output)
```
Adding `pdf.destroy()` would **not** fix the worker. `src/display/api.js` @ v5.7.284:
```js
destroy() {
  this.destroyed = true;
  // We need to terminate only web worker created resource.
  this.#webWorker?.terminate();
  this.#webWorker = null;
  PDFWorker.#workerPorts.delete(this.#port);
  this.#port = null;
  …
}
```
`#webWorker` is assigned only in `#initialize()` (the `workerSrc` path). With `workerPort`, `#initializeFromPort(port)` runs instead and `#webWorker` stays `null`. **So the 1.28 MB module worker plus its heap — the parsed PDF, the `builtInCMapCache`, the `standardFontDataCache`, the decoded JBIG2/JPX modules — lives until the WebView is destroyed.** Only the page owns the `Worker` handle and only the page can `terminate()` it; it does not.

I checked whether this is masked by the hosts unmounting promptly. It is, and this hypothesis is **REFUTED** as a cross-request leak: `pdfTextService.ts` clears the host on every terminal path (`resolvePdfTextRequest` → `clearHostRequest()`, `settleReject` → `clearHostRequest()`, and the abort/timeout paths both route through `settleReject`), and `documentCover.tsx:109` does the same for `DocumentCoverHost`. Both hosts set `request` to `null`, so `PdfToImages` unmounts and the WebView goes away. **The leak is therefore intra-extraction, not cumulative — but it is still the peak-memory term, and §4.3 is about peak.**

### 4.3 The HTML payload tripled and nobody measured it — CONFIRMED as arithmetic, PLAUSIBLE as impact

| | assets inlined | max HTML string |
|---|---|---|
| 3.11.174 (parent) | 1,407,216 B | ~8.44 M chars |
| 5.7.284 (this commit) | **3,681,500 B** | **~10.71 M chars** |

```
assets/pdfjs: cmaps-cn.txt 389,503 | manifest.json 9,684 | pdf.min.mjs.txt 496,989
              pdf.worker.min.mjs.txt 1,286,284 | standard-fonts.txt 1,032,840 | wasm.txt 475,884
pdfB64 cap = DEFAULT_MAX_BYTES(5 MiB) * 1.34 = 7,025,459      // PdfToImages.tsx:150, 289
=> 3,681,500 + 7,025,459 + ~3,000 ≈ 10.71 M chars
```
A 10.7 M-char string crosses Hermes → the JSON-serialised native props → `loadDataWithBaseURL`/`loadHTMLString` → the WebView's HTML parse, and is then held in React state (`PdfToImages.tsx:653` `{html && !error ? (`) for the extraction's lifetime. Inside the page the peak is roughly: HTML source (10.7 M) + the carrier text nodes (3.68 M) + `JSON.stringify(pdfB64)` (7.0 M) + the JSON literal (7.0 M) + `atob` binary string (7.0 M) + `Uint8Array` (5.2 M) + decoded asset caches (`this.decoded`, `pdfExtractHtml.ts:125`) ≈ **45 MB in a WebView process**, on a Helio G99 handset, before pdf.js's own working set.

The commit message quantifies only the APK delta (`+2.27 MB app size`) and says the HTML "carries the same bytes" without costing that out. This needs a device A/B on both phones (never while charging, per the project rule) with `getTextContent`/render timings, and ideally a look at the Jelly Star's memory ceiling under the 200-page text path. **The repo already has `scripts/anti_oom_harness.mjs`; nothing in this change uses the established harness discipline.**

### 4.4 Image-mode render errors are swallowed — CONFIRMED, pre-existing, re-authored here

`pdfExtractHtml.ts:207` and `:214`:
```js
        pdf.getPage(pageNum).then(function(page){
          …
          page.render({canvasContext: ctx, viewport: viewport}).promise.then(function(){
            var b64 = canvas.toDataURL("image/jpeg", 0.8).split(",")[1];
```
Neither chain has a `.catch`. A single hostile/broken page therefore produces no `post()` at all and the run dies on `PAGE_TIMEOUT_MS` with "timed out" instead of the real cause. Text mode gets this right — `pdfExtractHtml.ts:311` and `:315` both have `.catch(function(e){ post({error: …}) })`, and `renderOne` has one at `:409`. The image path was carried over verbatim into the new file; since this commit rewrote it line by line, the asymmetry should have been fixed rather than reproduced.

### 4.5 `var total` shadowing in the text pass — CONFIRMED harmless, worth fixing

`pdfExtractHtml.ts:203` `var total = Math.min(pdf.numPages, MAX_PAGES);` vs `pdfExtractHtml.ts:292` `var total = 2; // "[]"`. The inner one lives in the `getTextContent().then(function(tc){…})` scope, so the outer `total` used by `if (current >= total)` in `extractPage` is unaffected — I traced it, there is no bug. It is a landmine for the next reader of a 433-line template string.

### 4.6 Unmount / in-flight races — REFUTED as new problems

`doneRef` + `inFlightWritesRef` + `pendingGlobalDoneRef` + the cleanup closure in `PdfToImages.tsx:265-283` are unchanged by this commit and still correct: the effect body resets every per-document ref before the async load, the cleanup trips `doneRef` so late JPEG `.then` deletes instead of calling `onPage`, and the HTML effect arms only the total timer. No new race was introduced by moving the builders.

---

## 5. Asset pipeline

### 5.1 Manifest hashes match the files on disk — CONFIRMED by independent recomputation

I did not trust the test; I recomputed all 51 `inputs` against `node_modules/pdfjs-dist` and all 5 `outputs` against `assets/pdfjs`:
```
pdfjsVersion: 5.7.284
inputs: 51  mismatches: 0
outputs: 5  mismatches: 0
manifest outputs raw total: 3681500
assets/pdfjs disk total:     3691184   (= 3681500 + 9684 manifest)
```
And the trust root is real: `package-lock.json` pins `node_modules/pdfjs-dist` to `5.7.284` with `integrity: sha512-h4EdYQczmGhbOlqc3PPZwxevn7ApdWPbo…`. Chain: lockfile integrity hash → node_modules bytes → manifest `inputs` → manifest `outputs` → committed asset → Metro `assetExts` → the base64 in the WebView. That is stronger provenance than the engine gate used elsewhere in this repo, and it deserves to be said out loud.

### 5.2 The drift test genuinely fails on drift — CONFIRMED for byte drift, with two real gaps

Byte-level drift cannot pass: the assertions compare `{file, sha256, bytes}` with `toEqual`, so any single changed byte fails. A `package.json` bump without re-running the vendor script fails via `expect(appPkg.devDependencies["pdfjs-dist"]).toBe(manifest.pdfjsVersion)`; a `node_modules` tamper fails the `inputs` test.

Gap 1 — the selection is only half-pinned. `pdfjsAssets.test.ts:107-131` requires 5 named cmaps out of 34, asserts `fonts` length 14, and pins `wasm` exactly. Adding 135 cmaps, or swapping the GB1 family for Japanese, regenerates both the carrier and `manifest.selections` together and **passes**. The CVE pin `versionAtLeast(manifest.pdfjsVersion, "4.2.67")` is also weaker than the code needs: the loader depends on 5.x behaviour (`workerPort`, the `fetch({kind, filename})` contract, the short-circuit in §1.5), none of which 4.2.67 guarantees. The honest floor for *this* code is `>= 5.0`.

Gap 2 — nothing verifies the vendored ESM is *valid JavaScript*. `pdfjsAssets.test.ts:141-148` does:
```ts
const boot = html.slice(html.lastIndexOf("<script>") + 8, html.lastIndexOf("</script>"));
expect(() => new Function(boot)).not.toThrow();
```
That slice is the **last** `<script>` — the bootstrap, not the 1.78 MB of carriers. The inline comment's claim that this "proves the REAL 1.8 MB of vendored JS passes the carrier guard" is technically right (the guard runs inside `buildPdfHtml`, so building the page would throw) but the sentence attributes it to `new Function(boot)`, which does not look at the vendored JS at all. A truncated or corrupted `.mjs.txt` would be caught only by the hash test, and only while `node_modules` is installed.

Gap 3 — **the CVE pin is the wrong kind of pin.** `versionAtLeast(…, "4.2.67")` trusts a string in `manifest.json`, which is a *generated* file. It is a good provenance pin and a weak security pin. The security-relevant assertion — "the shipped bytes contain zero `new Function`/`eval` sinks" — is what §1.1 verified by hand in two minutes and is not in the suite. A two-line test over `assets/pdfjs/*.mjs.txt` would make the CVE claim self-enforcing rather than asserted by a version floor that a vendor-script rerun could theoretically rewrite.

### 5.3 Only Simplified-Chinese cmaps are packed — CONFIRMED, and the stated scope is wrong

`vendor-pdfjs.mjs:23-26` says:
```
 * - cmaps: the Simplified-Chinese predefined CMap family (Adobe-GB1, GB,
 *   GBK, GBT and UniGB variants) — the smallest set that makes non-embedded
 *   CJK PDFs extractable offline; Traditional (CNS/UniCNS) is deliberately
 *   not selected.
```
"the smallest set that makes non-embedded **CJK** PDFs extractable" is false, and the omission list is incomplete. Measured against the installed `cmaps/` (169 files, 1,167,747 B raw):

```
selected raw bytes: 291547        (34 of 169 files — 25% of the set, 20% of the bytes)
90ms-RKSJ-H.bcmap          ABSENT      (Japanese, Shift-JIS)
UniJIS2004-UTF32-H.bcmap   ABSENT      (Japanese, Unicode)
KSCms-UHC-H.bcmap          ABSENT      (Korean)
B5pc-H.bcmap               ABSENT      (Traditional Chinese, Big5)
ETen-B5-H.bcmap            ABSENT      (Traditional Chinese)
CNS-EUC-H.bcmap            ABSENT      (Traditional Chinese)
```
So **Japanese and Korean PDFs are not addressed anywhere** — neither the vendor comment nor the commit message names them. The commit message's heading is `CJK (audit F8): predefined non-embedded CMaps now work offline - the 34 Simplified-Chinese bcmaps …`; the body is honest, the heading is not.

Failure mode, precisely: a missing file is not a crash. `fetchBuiltInCMap` rejects → `createBuiltInCMap` throws → the font load fails → pdf.js substitutes its error font (`loadFont(…){const errorFont=async()=>new TranslatedFont({loadedName:"g_font_err…`). The document still "succeeds"; the affected pages extract as **empty text**, land in `skippedPages`, and get image-fallback-rasterized in `textWithImageFallback`, or — on the `mode="text"` tool path — return silently short text with `truncated` still `false`. A silent wrong answer, which is worse than a loud failure for a tool result.

Is it acceptable? Shipping all 169 would add ~876 KB raw (~1.17 MB base64) to the inline HTML — the wrong trade for this architecture, and the *size* argument is a legitimate one. But the correct response to "we cannot ship all of them" is to **state the omission in the user-facing surface** (a doc whose text came back short because its CMaps are not bundled), not only in a code comment. Right now the only place it is recorded is a comment in a vendor script, and the commit message over-claims the scope.

---

## 6. Tests

### 6.1 Do they test the real thing? Mostly a rebuilt subject — CONFIRMED

`PdfToImages.test.ts` is now 117 lines of pure string assertions over a stub input:
```ts
const INPUT: PdfHtmlInput = { libSrc: "export const pdfjsStub = 1;", workerSrc: "// worker stub", … };
```
`pdfjsAssets.test.ts` is the only file that touches the real bytes, and it touches them as **hashes and as string carriers**. Concretely missing:

- **Nothing executes the vendored pdf.js.** No test runs `getDocument` with the page's exact params. The commit message says "a Node harness ran the vendored 5.7 legacy build with the page's exact getDocument params and extracted Latin … and Chinese (… predefined UniGB-UCS2-H -> 你好)". That harness is **not in the repo** — `ls scripts/ | grep -i pdf` returns only `vendor-pdfjs.mjs`. The strongest correctness claim in the commit is therefore unreproducible by a reviewer, which is exactly the claim most worth reproducing. The repo's own convention (`scripts/*Harness.mjs`, compile-from-disk, exit 1 on fail) makes adding it trivial and non-controversial.
- **Nothing tests `PdfAssetsBinaryDataFactory` against pdf.js's real contract.** `PdfToImages.test.ts:82-89` regex-matches the *identifier* `BinaryDataFactory:\s*PdfAssetsBinaryDataFactory`; it would pass if the class name were misspelled at the definition site or if `fetch` took the wrong shape. I verified the contract by hand against the bundle and it is **correct** — `fetch({kind, filename})` with `kind ∈ {"cMapUrl","standardFontDataUrl","wasmUrl"}`:
  ```
  async fetch({kind:t,filename:e}){switch(t){case"cMapUrl":case"standardFontDataUrl":case"wasmUrl":break;…
  sendWithPromise("FetchBinaryData",{kind:"cMapUrl",filename:`${e}${this.options.cMapPacked?".bcmap":""}`})
  sendWithPromise("FetchBinaryData",{kind:"standardFontDataUrl",filename:n})     // n = getFontName(name)
  sendWithPromise("FetchBinaryData",{kind:"wasmUrl",filename:"jbig2.wasm"})     // / "openjpeg.wasm"
  ```
  and the map keys are bare filenames, matching exactly. But the verification is mine, not the suite's. A test that calls `fetch({kind:"cMapUrl",filename:"UniGB-UCS2-H.bcmap"})` against the real carrier and asserts real decoded bytes would pin the whole contract in five lines.
- **The component has no tests at all.** This is *not* a regression — the pre-commit file was also builder-only (96 lines, four `test(` calls, all string assertions). But the commit removed the seven `jest.mock(...)` stubs (`react-native`, `react-native-webview`, `expo-asset`, `expo-file-system/legacy`, `../i18n`, `../theme/typography`, `../ui/labTheme`) that were the only scaffolding for ever rendering the component. 746 lines of bridge handling, timeout arbitration, unmount cleanup and in-flight write ordering remain untested, and `mode="text"` (the tool path, now the only production caller of `textWithImageFallback`'s builder) has never been covered.
- `canvasContext` render form: `PdfToImages.test.ts:92-95` asserts the literal string `page.render({canvasContext: ctx, viewport: viewport})`. Verified against 5.7 that this still works — `render({canvasContext:t,canvas:e=t.canvas,viewport:i,…})` — and the type says `canvasContext` is retained "for backwards compatibility". A string assertion on a deprecated-but-supported form is the right kind of test here. No finding.

### 6.2 Env mutation not restored? — CONFIRMED none

`grep -n "process.env" src/components/PdfToImages.test.ts src/components/pdfjsAssets.test.ts src/util/pdfBridgeProtocol.test.ts` → no matches. No fake timers, no `Date.now` patching, no global mutation, no `jest.spyOn` restore concerns. The tests are pure and order-independent. Clean.

### 6.3 The CSP test is a genuine improvement — CONFIRMED

`PdfToImages.test.ts:36-52` pins the **exact** policy string rather than five `toContain` fragments, and separately asserts `expect(policy).not.toMatch(/'unsafe-eval'/)` with the comment "Quoted form only: 'wasm-unsafe-eval' must not satisfy this check." That is the right way to write a regression test for a policy this narrow — a future edit that appends `'unsafe-eval'` fails immediately. The old test would have accepted `'wasm-unsafe-eval'` appended next to `'unsafe-inline'` without noticing what it had done.

---

## 7. Code quality

### 7.1 Six dead imports — CONFIRMED

`src/components/PdfToImages.tsx:20-25`:
```ts
  CHUNK_SIZE,
  MAX_CHUNKS_PER_PAGE,
  MAX_ITEM_STR_CHARS,
  MAX_ITEMS_PER_PAGE,
  MAX_PAGE_PAYLOAD_BYTES,
  MAX_TOTAL_TEXT_BYTES,
```
Each appears **exactly once in the file** — only in the import statement:
```
CHUNK_SIZE: 1   MAX_CHUNKS_PER_PAGE: 1   MAX_ITEM_STR_CHARS: 1
MAX_ITEMS_PER_PAGE: 1   MAX_PAGE_PAYLOAD_BYTES: 1   MAX_TOTAL_TEXT_BYTES: 1
(MAX_PDF_PAGES: 3, PAGE_TIMEOUT_MS: 3  ← genuinely used)
```
They became dead the moment the HTML builders moved to `pdfExtractHtml.ts`. Nothing catches it: `tsconfig.json` has `"strict": true` but no `noUnusedLocals`, and `npx eslint` exits **2** because the repo has **no eslint config file at all** — so the four `// eslint-disable-next-line react-hooks/exhaustive-deps` comments in `PdfToImages.tsx` are decorative. The extraction left `PdfToImages.tsx` at 746 lines (`wc -l`) and created `pdfExtractHtml.ts` at 433, so the "one file per responsibility, <250 lines" bar the brief sets is missed by both, and the split made the file *longer* in aggregate (+123 lines net for the same logic).

### 7.2 Stale comment: "destroy del documento a fine lavoro" — CONFIRMED, and now doubly wrong

`src/components/PdfToImages.tsx:55`:
```
 * - timeout per pagina (30s), cap pagine, destroy del documento a fine lavoro
```
There is no destroy anywhere (§4.2). The claim was already false in the parent; this commit had the file open, rewrote the surrounding doc block (lines 40-51), and left it. It is now worse than stale: even adding `pdf.destroy()` would not terminate the module worker. Either implement the teardown or delete the clause.

### 7.3 Italian in code comments, in a block this commit edited — CONFIRMED (project-rule violation)

`src/components/PdfToImages.tsx:52`:
```
 * - PDF trasferito come base64 iniettato (URI locali `file://` letti da RN —
```
`AGENTS.md`: "ALL agent communication, code comments, commit messages, docs … must be in English." The diff touched exactly this doc-comment region (lines 40-51 in the new file, the `pdf.min.js.txt` → `pdf.min.mjs.txt` rewrite) and left the Italian line standing. New code in `pdfExtractHtml.ts` and `vendor-pdfjs.mjs` is fully English, so the rule is being followed on new lines and not on old ones — which is precisely how the drift accumulates.

### 7.4 Commit message accuracy — CONFIRMED accurate on every checkable claim

I went looking for the usual sins and did not find them.

| claim | verdict |
|---|---|
| "both new Function sinks … are gone from the bundle" | CONFIRMED (§1.1) |
| "6.x needs Chrome >= 125 / Safari >= 18 … legacy build" | CONFIRMED (§3.1, gulpfile + PR #21152) |
| "the legacy build also polyfills Promise.withResolvers" | CONFIRMED (core-js module `4628` present) |
| "qcms … degrades to the same non-ICC conversion 3.11 always used" | CONFIRMED (`QCMS.setOptions` disables itself off the factory path) |
| "with useWasm:false … import(wasmUrl+…_nowasm_fallback.js) which cannot be served offline" | CONFIRMED (relative resolution throws against a blob base; CSP would block it anyway) |
| "vendored payloads 1,407,216 B -> 3,681,500 B" | CONFIRMED to the byte (§4.3) |
| "pdfjsAssets.test.ts pins version, every input/output hash, the selections" | CONFIRMED |
| "a Node harness ran the vendored 5.7 … extracted … 你好" | **UNVERIFIABLE** — harness not committed |
| "294 suites / 3072 tests green" | plausible; `tsc --noEmit` exit 0 and the 3 targeted suites exit 0 reproduce locally, but the suite-wide number was not re-run here |
| "Device checks still required" | honest and correct — and §3.4/§4.1 say those checks are **merge-blocking**, not follow-up |

The only inaccuracy is scope wording, not fact: the heading `CJK (audit F8)` over a Simplified-Chinese-only payload (§5.3), and "Android System WebView 1xx" where the real floor is `Chrome >= 118` (§3.1).

### 7.5 Dead code / duplication — CONFIRMED, minor

`buildPdfHtml`'s `renderPage`/`sendChunks` (`pdfExtractHtml.ts:204-234`) and `buildPdfHtmlTextMode`'s `renderOne`/`sendImageChunks` (`:377-420`) are near-identical render-and-chunk pipelines in two template strings. Consolidating them means one bug fix instead of two — §4.4 is exactly the kind of asymmetry that duplication causes (text mode has `.catch`, image mode does not). Template-string HTML is inherently untestable in isolation, which is why the extraction into `pdfExtractHtml.ts` was right; it just stopped one step short.

---

## Required before merge

1. **Worker-liveness watchdog** in `sharedBootstrap`: keep the `Worker` handle, add `onerror`/`onmessageerror` → `post({error:"pdf_worker_failed"})`, plus a bootstrap timeout → `post({error:"pdf_bootstrap_timeout"})`. Kill the 180 s mystery stall (§4.1).
2. **Device evidence for the two primitives**: `blob:null` module worker + `import()` on Jelly Star (API 33 WebView) and on the S23's WKWebView 16.4, plus a scanned JBIG2/JPX PDF, plus a 200-page text run and a 5 MB PDF, with timings and memory. The commit already says these are required — treat that as the gate (§3.4, §4.3).
3. **Set `useWorkerFetch: false` explicitly** in `getDocument` and assert it in `PdfToImages.test.ts`. One line; removes a load-bearing dependency on a pdf.js internal and on the `URL.parse` short-circuit (§1.5, §3.3).
4. **Terminate the worker and revoke both blob URLs** in `done`/`error`; keep the handle (§4.2).
5. **Fix the image-mode missing `.catch`** at `pdfExtractHtml.ts:207` and `:214` (§4.4).
6. **Commit the harness** that ran the 5.7 build and produced 你好, following the `scripts/*Harness.mjs` convention. Without it the central correctness claim of the commit is unreviewable (§6.1).
7. **Add a `BinaryDataFactory` contract test** against the real carrier — five lines, pins the entire offline-data design (§6.1).
8. **State the CJK scope honestly**: Japanese and Korean are absent as well as Traditional; correct the `vendor-pdfjs.mjs:24-26` comment and the commit heading, and decide whether the UI must say so when text comes back short (§5.3).
9. **Housekeeping**: drop the six dead imports, delete or implement the "destroy del documento" clause, translate `PdfToImages.tsx:52`, and raise the manifest floor from `4.2.67` to `5.0` (§7.1, §7.2, §7.3, §5.2).
10. **Optional but cheap**: a zero-`new Function`/zero-`eval` assertion over `assets/pdfjs/*.mjs.txt`. That converts the CVE claim from a version floor into an invariant on the shipped bytes (§5.2).

## What is genuinely good here

Not everything is a problem, and the audit would be dishonest without saying so:

- The vendored-asset provenance chain is stronger than anything else in this repo's dependency discipline (lockfile integrity → node_modules → manifest `inputs`/`outputs` → committed bytes) and I verified all 56 hashes independently.
- The `workerPort` choice over `workerSrc` is right, and the comment explaining why is technically accurate — it is the only correct fix for the `blob:null` double-wrap.
- The 5.7 → 6.0 browser-floor reasoning is exact and matches pdf.js's own `ENV_TARGETS`, not a guess.
- Writing the custom `BinaryDataFactory` against the real 5.7 `fetch({kind, filename})` contract is correct on every kind and every filename form, including `cMapPacked` suffixing.
- The commit message is candid about what was **not** verified. That is rarer than it should be and it made this audit much easier.
- The CSP test tightened from five `toContain` fragments to one exact-policy assertion plus a negative check that `'wasm-unsafe-eval'` cannot satisfy `'unsafe-eval'`. That is the correct shape for a policy regression test.
- Manifest hashes, `tsc --noEmit`, and the three targeted suites all reproduce green locally.
