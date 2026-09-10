# EMBEDDING-COMPLETION-LOG-RECON — 2026-09-10

**Base**: main at `f99fe4506a3072c6d18b625bdaca815615bf7421`
**Scope**: terminal background-embedding completion telemetry (historical symptom: 707 chunks without a `done` line)
**Trigger**: ALIVE line 3752 ("Embedding in background arrivato a 707 chunk senza riga `done` prima del force-stop") + line 553 ("Remaining product work includes the documented embedding completion-log gap")
**Reviewer**: autonomous recon (read-only, code not modified)
**Status**: Historical symptom clarified: the 707-chunk run ended by force-stop/SIGKILL, not a missing surviving-process exit; all surviving-process exits already log `done` exactly once. The deterministic progress fix is pushed as app commit `1edf5c662715a357c7aa74d16b9b2ab787688f6e`.

---

## 1. Next unblocked M1 item — why this

The PLAN timeline places session/cache work at 16-18 Sep and G2 (complete chat) at 21-23 Sep. The memory-cancel fix (SHIP) and session-identity fix (SHIP) are pushed. The embedding completion-log gap is explicitly flagged as remaining product work at ALIVE line 553, alongside the now-fixed abort propagation. It is a diagnostic/observability gap — not a blocking feature, but the only concrete unblocked engineering item identified in the live docs that is both: (a) explicitly called out, and (b) not yet addressed by any in-progress work.

Other candidates (session restore measurement, governor activation, GPU/NPU lanes) are either gated by device access or belong to later timeline windows (24-29 Sep). This item can be resolved entirely on Mac/CI.

---

## 2. Current code trace — all exits

### 2.1 The embedding job lifecycle (AppShell.tsx:1488-1920)

The job is an async IIFE inside `withReadLatch`. Key log lines:

| Line | Log | When |
|------|-----|------|
| 1543 | `[embed] start` | Job begins |
| 1685 | `[embed] plan {toEmbed, totalChunks}` | Chunks enumerated |
| 1755 | `[embed] chunk ok` | Per chunk — every chunk |
| 1512 | `[embed] done {embedded, indexChunks, reason}` | **Terminal — exactly once** |

### 2.2 Every exit path and whether `done` fires

| Exit | Line(s) | `done` reason | Fires? |
|------|---------|---------------|--------|
| Loop completes (all chunks embedded) | 1910 | `"completed"` | ✓ |
| `vec === 0` (embedder refused/failed) | 1765 → break → 1910 | `"partial"` or `"failed"` | ✓ |
| Vector rejected (zero/bad dims) | 1797 → break → 1910 | `"partial"` or `"failed"` | ✓ |
| Cap reached | 1807 → return | `"partial"` | ✓ |
| Abort: signal/gen stale | 1705 → return | `"aborted"` | ✓ |
| Abort: doc deleted | 1713 → return | `"aborted"` | ✓ |
| Abort: RAM gate | 1722 → return | `"partial"` or `"aborted"` | ✓ |
| Abort: signal after RAM gate | 1736 → return | `"aborted"` | ✓ |
| Abort: thermal hard gate | 1745 → return | `"partial"` or `"aborted"` | ✓ |
| Abort: signal after chunk embed | 1750 → return | `"aborted"` | ✓ |
| Abort: map ownership lost | 1842 → return | `"aborted"` | ✓ |
| Abort: doc deleted at commit | 1829 → return | `"aborted"` | ✓ |
| Abort: doc deleted post-write | 1888 → return | `"aborted"` | ✓ |
| Abort: signal after write | 1863 → return | `"aborted"` | ✓ |
| Exception in job body | 1917 | `"partial"` or `"failed"` | ✓ |

**Every code path calls `logEmbedDone`.** There is no missing exit.

### 2.3 The 707-chunk scenario — why `done` was never logged

The 707 `[embed] chunk ok` lines were printed (one per chunk). Then the app was force-stopped. The process was killed before the job reached any terminal path.

The `embedDocumentChunk` call (line 1739) invokes `embedWithContext` → native `embedding()`. The native call is **not cancellable** (EmbeddingService.ts:208 comment: "Native embedding()/release() is not cancellable; recovery = process restart"). If the native call is in progress when force-stop fires:
1. The process is killed
2. The async function never resolves
3. The `finally` block (line 1920) may or may not run depending on the kill timing
4. The `[embed] done` log is never printed

This is **not a code bug** — it is a process-lifecycle limitation. Force-stop kills the process; no async cleanup can guarantee execution after a SIGKILL.

### 2.4 What IS missing: progress telemetry

The embedding job logs `[embed] chunk ok` for every chunk but has **no periodic progress log**. For a 707-chunk job:
- `[embed] start` → 707× `[embed] chunk ok` → (force-stop) → no `[embed] done`
- There is no heartbeat, no "chunk 100/707" progress line, no periodic summary

Without a progress log, it is impossible to determine from logs alone:
- Whether the job was still running at force-stop (or had already completed)
- How many chunks were actually processed (you must count `chunk ok` lines)
- Whether the job was stuck or progressing normally

---

## 3. Exactly-once semantics

`logEmbedDone` is called exactly once per job execution:
- Early returns (abort/cap/delete) call it before returning
- The loop exit calls it after the loop
- The catch block calls it on exception
- The `finally` block does NOT call it (it only releases the read latch and clears `embedJobInFlightRef`)

The `terminalReason` variable is initialized to `"completed"` and only changed to `"partial"` or `"failed"` on specific break paths. The defensive check at line 1907 catches any path that forgot to set it.

**No double-fire risk**: each exit path either returns or breaks, and `logEmbedDone` is the last logging call before the exit.

---

## 4. Tests needed

### 4.1 Existing coverage

- `embeddingPure.test.ts`: tests pure functions only (hash, prefix, plan, degrade). No job lifecycle tests.
- No test for `logEmbedDone` being called on any exit path.
- No test for the `terminalReason` defensive check at line 1907.

### 4.2 Recommended tests

A unit test for the embedding job's terminal logging would be complex (requires mocking the full AppShell state machine). The practical approach is a **harness test** that verifies the log contract:

1. **Harness: `embedCompletionHarness.mjs`** — parses `[embed]` log lines from a CI log or fixture and asserts:
   - Every `[embed] start` has a matching `[embed] done`
   - No `[embed] done` appears without a preceding `[embed] start`
   - `[embed] done` reason is one of: `"completed"`, `"partial"`, `"failed"`, `"aborted"`

2. **Unit test for `terminalReason` invariant** — mock the loop to break at various points and verify `logEmbedDone` is called with the correct reason.

### 4.3 What cannot be tested locally

The force-stop scenario (process killed mid-native-embedding) cannot be unit-tested. It requires a device test where the app is force-stopped during embedding. The harness can only verify that the log contract holds for normal exits.

---

## 5. Smallest safe patch

### 5.1 Add periodic progress logging (low risk, high diagnostic value)

In the embedding loop (AppShell.tsx, after `embeddedCount += 1` at line 1790), add a periodic progress log:

```typescript
if (embeddedCount % 50 === 0 || embeddedCount === toEmbed.length) {
  console.log(
    `[embed] progress {"docId":${JSON.stringify(entry.id)},"embedded":${embeddedCount},"total":${toEmbed.length}}`,
  );
}
```

This gives visibility into long-running embedding jobs without adding a timer or heartbeat. A 707-chunk job would produce progress lines at 50, 100, 150, ..., 700, 707 chunks. If the process is killed, the last progress line shows how far the job got.

**Blast radius**: one log line every 50 chunks. No behavior change.

### 5.2 Optionally: log `done` in the `finally` block as a fallback

The `finally` block (line 1920) could call `logEmbedDone` as a fallback if it hasn't been called yet:

```typescript
finally {
  // Fallback: if no terminal path fired (process survived a non-standard exit),
  // log done so the contract is complete.
  if (!doneLogged) {
    logEmbedDone(embeddedCount > 0 ? "partial" : "failed");
  }
  releaseRead();
  embedJobInFlightRef.current = false;
}
```

This requires a `doneLogged` boolean set by `logEmbedDone`. It covers the case where the async function resumes after an unexpected suspension (not a force-stop — SIGKILL still kills the process).

**Blast radius**: one boolean + one conditional in finally. No behavior change for normal paths.

### 5.3 What NOT to do

- Do not add a timer-based heartbeat — it adds complexity and the periodic log (5.1) achieves the same diagnostic value.
- Do not try to make native `embedding()` cancellable — the comment at EmbeddingService.ts:208 explicitly documents this as a known limitation with process-restart as recovery.
- Do not add a "last chunk timestamp" to the `done` log — the `embeddedCount` already tells you how many chunks completed.

---

## 6. Behavior risk assessment

### 6.1 Risk: `done` logged twice

**Not possible** with the current code. Each exit path either returns or breaks before reaching another exit. The `finally` block fallback (§5.2) would only fire if no other path called `logEmbedDone` — the `doneLogged` flag prevents double-fire.

### 6.2 Risk: progress log floods logcat

At 50-chunk intervals, a 707-chunk job produces ~14 progress lines. A 200-chunk job produces ~4. This is negligible compared to the 707 `[embed] chunk ok` lines already logged.

### 6.3 Risk: `finally` fallback changes telemetry

The fallback only fires on non-standard exits (not force-stop). In practice, the only non-standard exit would be a thrown exception that bypasses the catch block — which should not happen given the try/catch structure. The fallback is defensive, not behavioral.

---

## 7. Verdict: **SHIP-for-implementation**

The embedding completion logging is architecturally correct — every exit path calls `logEmbedDone`. The 707-chunk gap was caused by a force-stop killing the process mid-native-embedding, not by a missing code path. The diagnostic gap is the absence of periodic progress logging, which makes it impossible to determine job progress from logs alone.

**Recommended patch**: add periodic progress logging (§5.1). Optional: add `finally` fallback (§5.2). Both are low-risk, no behavior change.

**Severity**: INFORMATIONAL — diagnostic improvement, not a correctness fix.

**Not blocking M1**: the embedding job works correctly; the gap is observability, not behavior.

---

## 8. Limitations

1. **Static analysis only**: no device testing. The force-stop scenario is inferred from the ALIVE report, not reproduced.
2. **No device or Mac build evidence in this recon**: it records the pre-fix trace against `f99fe45`. The deterministic progress patch was later implemented, audited, and pushed as app commit `1edf5c662715a357c7aa74d16b9b2ab787688f6e`; it does not make terminal `done` survive force-stop/SIGKILL.
3. **Harness coverage**: no existing test covers the embedding job's terminal logging. The recommended harness (§4.2) would be new.
