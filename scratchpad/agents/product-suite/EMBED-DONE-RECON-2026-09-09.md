# Recon: Embedding "done" log gap (Jelly 9/09, ~27k-token PDF)

## 1. Where the log lines come from

The background embed job lives entirely in **`src/app/AppShell.tsx`**, inside the
`scheduleBackgroundEmbed` callback (line 1468). It iterates one document at a time.
Each successfully embedded chunk emits (line 1738-1740):

```ts
console.log(
  `[embed] chunk ok {"docId":${JSON.stringify(entry.id)},"chunkId":${JSON.stringify(chunk.chunkId)},"dims":${vec.length}}`,
);
```

The "done" line is emitted by the `logEmbedDone` closure (line 1648-1652):

```ts
const logEmbedDone = (reason: typeof terminalReason) => {
  console.log(
    `[embed] done {"docId":${JSON.stringify(entry.id)},"embedded":${embeddedCount},"indexChunks":${index.chunkCount},"reason":${JSON.stringify(reason)}}`,
  );
  ...
};
```

## 2. Who starts the job, what ends it

**Start:** `scheduleBackgroundEmbed(entry)` is called (line 1261) right after a doc is
imported (`addDoc`), and also from `rebuildSemanticIndex` (line 1954). It is
**single-flight** (line 1473: `if (embedJobInFlightRef.current) return`).

**Condition that ends the loop:**
The `for (const chunk of toEmbed)` loop (line 1679) exits normally when every chunk is
embedded. It exits early on these paths, **all of which call `logEmbedDone`** before
returning:

| Path | logEmbedDone reason | Line |
|---|---|---|
| Signal/gen stale / doc deleted / thermal gate / RAM gate | "aborted" or "partial" | 1685, 1693, 1702, 1711, 1716, 1725, 1822, 1843, 1869, 1880 |
| `vec` is null (embedder failed/aborted) | "partial" or "failed" | 1735→break |
| Vector rejected (bad dims/zero) | "partial" or "failed" | 1796→break |
| Cap reached | "partial" | 1787→return |
| Loop completes normally | "completed" (or "partial" if defensive check) | 1884-1890 |

**`logEmbedDone` is ALWAYS called** before any `return` from inside the try block.

## 3. The outer catch — the one place "done" is NOT logged

```ts
} catch {                          // ← line 1891
  // eslint-disable-next-line no-console
  console.log(
    `[embed] skip: job exception {"docId":${JSON.stringify(entry.id)}}`,
  );
} finally {                        // ← line 1897
  releaseRead();
  embedJobInFlightRef.current = false;
}
```

This catch block catches **every** exception from the entire try block (lines 1506–1890).
It logs `[embed] skip: job exception` but **never calls `logEmbedDone`**. If this catch
fires, there is no `[embed] done` line in the log.

## 4. Can anything in the loop body actually throw?

I traced every async call and synchronous operation in the loop body:

| Operation | Throws? | Evidence |
|---|---|---|
| `embedDocumentChunk(text, {signal})` (line 1719) | **No** — has outer try/catch, returns null on error | `EmbeddingService.ts:762-823` — catch returns null |
| `index.addVectors(...)` (line 1752) | **No** — pure sync, validates inputs, returns `{added, skippedByCap}` | `semanticIndex.ts:209-280` — no throw paths |
| `writeVectorIndexFile(...)` (line 1859) | **No** — wrapped in try/catch at line 1858, docstring says "Never throws" | `documentStorage.ts:284-345` — catch cleans tmp |
| `mustSkipEmbedForRam()` (line 1696) | **No** — has inner try/catch, returns true on error | `AppShell.tsx:1437-1451` |
| `ensureEmbedderDownloaded(signal)` (line 1530) | **No** — delegates to `getEmbeddingModelStatus` which has try/catch | `EmbeddingService.ts:139-152` |
| `stillCurrent()`, `signal.aborted` checks | **No** — pure comparisons | n/a |
| `docSemanticByIdRef.current.get/set/has` | **No** — Map operations | n/a |
| `logEmbedDone(reason)` (line 1890) | **No** — console.log + try/catch telemetry | `AppShell.tsx:1648-1677` |

**No operation in the loop body can throw an unhandled exception.** The outer catch at
line 1891 should be unreachable under normal conditions.

## 5. Concurrency with chat completions

**Does an in-flight embed block or get preempted by the user's next message?**

The user's next chat message triggers a chat-model load, which calls
`bumpEmbedJobGeneration()` (line 3479). This increments `embedJobGenerationRef` and
aborts the job's AbortController (lines 1047-1049):

```ts
const bumpEmbedJobGeneration = useCallback(() => {
  embedJobGenerationRef.current += 1;
  try { embedJobAbortRef.current?.abort(); } catch { /* ignore */ }
  embedJobAbortRef.current = null;
}, []);
```

The embed loop checks `stillCurrent()` (line 1680: `jobGen === embedJobGenerationRef.current`)
and `signal.aborted` (line 1680) **before every chunk**. When either fires, it logs
`[embed] abort mid-job: signal/gen` and calls `logEmbedDone("aborted")` (lines 1681-1686).

The native `embedDocumentChunk` also checks `isAborted(signal)` before every native call
and returns null on abort (EmbeddingService.ts:774, 786, 800, 810).

**Key point:** the embed and chat model use the **same `llamaContextGate`** (shared
native barrier). When the chat model starts loading, it bumps the generation, which
aborts the embed job's native calls. The embed job **does not block** chat — it gets
preempted gracefully and logs its partial progress before yielding.

## 6. What happens to retrieval while embedding is in progress?

Each chunk is committed individually: after embedding, the vector is added to the
in-memory `SemanticVectorIndex` and written to the durable sidecar file (lines 1848-1866):

```ts
docSemanticByIdRef.current.set(entry.id, index);
docEmbedHashesByIdRef.current.set(entry.id, existing);
await writeVectorIndexFile(entry.id, index.toJSON());
```

Retrieval (`document_chat` tool) reads the same `docSemanticByIdRef` map. So **dense
retrieval works incrementally** — even if the job is aborted mid-way, all chunks embedded
so far are available for retrieval. This matches the observation: the document is "later
usable via retrieval" even without a done line.

## 7. Verdict: **LOGGING GAP**

The `[embed] done` line is **always** produced on every normal exit path (loop complete,
abort, cap, failure, partial). The only path that skips it is the unreachable outer catch
at line 1891 — but no operation in the loop body can throw (all have internal try/catch).

The most likely explanation: **the `[embed] done` line was produced but not captured** in
the user's log stream. On React Native (Hermes), `console.log` goes to the native logging
backend (Logcat/NSLog). Log rotation, buffer truncation, or a log-cat filter that stops
after N lines could truncate the final line. The user was counting `[embed] chunk ok`
lines (707 of them) and the `[embed] done` line, being the very last log output of the
job, was lost to buffer rotation or was not grepped for.

**The document IS fully usable because:**
1. Each chunk is committed to the in-memory map and durable file **as it completes**
   (lines 1848-1866), not batched at the end.
2. Retrieval reads the live map, so all 707+ chunks are available immediately.
3. The `finally` block (line 1897) always clears `embedJobInFlightRef`, so no engine
   resource is leaked.

**If we wanted to make the done line unmissable** (defensive hardening, not a bug fix):
Add `logEmbedDone` to the outer catch block at line 1891, and/or add a final
`logEmbedDone` in the `finally` block as a safety net. This would ensure the done line
appears even if an unexpected exception somehow escapes.

## Summary

| Question | Answer |
|---|---|
| Is the "done" log always called? | Yes, on all normal paths (lines 1685, 1693, 1702, 1711, 1716, 1725, 1787, 1822, 1843, 1869, 1880, 1890) |
| Can anything in the loop throw? | No — all async ops have internal try/catch (evidence per row in §4) |
| Does the outer catch fire? | Only if something throws — currently unreachable (§4) |
| Does embed block chat? | No — chat load bumps generation → embed aborts gracefully (§5) |
| Is retrieval available mid-embed? | Yes — vectors committed per-chunk to live map (§6) |
| **Verdict** | **LOGGING GAP** — done line produced but not captured in log stream |
