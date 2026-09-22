/**
 * The turn-end memory extract, lifted from `AppShell.tsx:5443-5666`
 * (inside handleSendStream) as a factory over the turn's closures.
 *
 * The turn-end order this preserves is the KV-save effectiveness rule
 * (D2 row 11): (1) `armMemoryExtract` at onDone registers the job so a
 * concurrent next send waits, but does NOT queue extraction; (2) the chat
 * side awaits `saveEngineSession`; (3) `afterSessionSave` releases the
 * save gate and only then does extractMemory run — it checkpoint-restores
 * chat KV and can reuse the just-written .kvs. The 10 s gate timeout is
 * the deadlock backstop: a stranded gate would keep `memoryExtractRef`
 * set and deadlock the next send (AppShell:5550-5553).
 *
 * Adaptations from the original (reported): the closure variables
 * `signal` / `text` / `turnFailed` / `assistantFull` / `turnCiswireFlags`
 * arrive as the `turn` accessor object, and the module-local
 * `calendarExtractSkipSeq` comparison goes through turnCorpus's live
 * getters — reads happen at call time in both versions.
 */
import {
  extractMemory,
  type MemoryExtractResult,
  type MemoryExtractStopReason,
} from "../engine/LlamaService";
import { EXTRACT_MEMORY_MIN_TIMEOUT_MS } from "../engine/extractBudget";
import { createExtractAbort } from "../memory/extractAbort";
import { formatMemoryLine } from "../memory/memoryTelemetry";
import * as MemoryStore from "../memory/MemoryStore";
import { calendarExtractSkipped, fetchAllowlistTurnSeq } from "./turnCorpus";
import type { EngineTurnDeps } from "./engineTurnDeps";

/** The turn-local state the lifted body used to close over. */
export interface MemoryTurnContext {
  signal: AbortSignal;
  text: string;
  isFailed(): boolean;
  getAssistantFull(): string;
  getTurnFlags(): number;
}

export function createMemoryExtract(
  deps: EngineTurnDeps,
  turn: MemoryTurnContext,
): { arm: () => void; afterSessionSave: () => void } {
  const {
    locale,
    refreshMemoryFacts,
    memoryEnabledRef,
    memoryExtractRef,
    memoryExtractCancelRef,
  } = deps;
          let extractScheduled = false;
          type MemoryExtractDetails = {
            durationMs: number;
            timeoutMs: number;
            stopReason: MemoryExtractStopReason;
          };
          const noExtractDetails: MemoryExtractDetails = {
            durationMs: 0,
            timeoutMs: EXTRACT_MEMORY_MIN_TIMEOUT_MS,
            stopReason: "skipped_no_snapshot",
          };

          /**
           * Turn-end order (must preserve for KV save effectiveness):
           *   1) armMemoryExtract at onDone — registers memoryExtractRef so a
           *      concurrent next send waits, but does NOT yet queue extractMemory
           *   2) AiChatPage awaits saveEngineSession (FIFO)
           *   3) afterSessionSave releases the save-gate → extractMemory runs
           *
           * extractMemory checkpoint-restores chat KV (EXTRACT_MEMORY_PRESERVE_CHAT_KV).
           * Save-first still lets extract reuse the just-written .kvs instead of
           * a second snapshot. Gates: memory enabled, non-empty reply, not
           * aborted/failed, sendRunId (AiChatPage).
           */
          let releaseSaveGate: (() => void) | undefined;
          let extractGateSource = 0;
          const emitSettledMemoryTelemetry = async (
            snapshot?: ReturnType<typeof MemoryStore.snapshotMemoryTelemetry>,
            details: MemoryExtractDetails = noExtractDetails,
          ) => {
            let extractTelemetry = snapshot;
            if (!extractTelemetry) {
              // The turn-end reset clears this state before the extract job runs.
              // Re-read it here so the settled line is authoritative in both
              // directions (memory on and memory off).
              const settledMemoryEnabled = await MemoryStore.getEnabled();
              MemoryStore.trackMemoryEnabled(settledMemoryEnabled);
              const settledFacts = await MemoryStore.listFacts();
              MemoryStore.trackMemoryStoreSize(settledFacts.length);
              extractTelemetry = MemoryStore.snapshotMemoryTelemetry();
            }
            console.log(formatMemoryLine({
              ...extractTelemetry,
              ...(details.stopReason === "aborted_by_send"
                ? {
                    factsExtracted: 0,
                    factsStored: 0,
                    factsRejectedFull: 0,
                  }
                : {}),
              // Injection belongs to the turn, not to extraction.
              factsInjected: MemoryStore.MEMORY_TELEMETRY_NOT_APPLICABLE,
              dnaDeferred: MemoryStore.MEMORY_TELEMETRY_NOT_APPLICABLE,
              dnaInjected: MemoryStore.MEMORY_TELEMETRY_NOT_APPLICABLE,
              dnaBudgetTokens: MemoryStore.MEMORY_TELEMETRY_NOT_APPLICABLE,
              ciswireFlags: turn.getTurnFlags() || undefined,
              durationMs: details.durationMs,
              timeoutMs: details.timeoutMs,
              stopReason: details.stopReason,
            }, "KALSA_MEMORY_EXTRACT"));
          };
          const trackMemoryExtractJob = (extractJob: Promise<void>) => {
            memoryExtractRef.current = extractJob;
            void extractJob.finally(() => {
              if (memoryExtractRef.current === extractJob) {
                memoryExtractRef.current = null;
              }
            });
          };
          const armMemoryExtract = () => {
            if (extractScheduled) return;
            extractScheduled = true;
            if (turn.signal.aborted || turn.isFailed() || !turn.getAssistantFull().trim()) {
              // Snapshot before any await: this turn never had an extract job,
              // so a later turn's counters must not appear on its stop-reason line.
              MemoryStore.trackMemoryEnabled(memoryEnabledRef.current);
              MemoryStore.trackMemoryExtractStopReason(4);
              const earlyTelemetry = {
                ...MemoryStore.snapshotMemoryTelemetry(),
                factsExtracted: MemoryStore.MEMORY_TELEMETRY_NOT_APPLICABLE,
                factsStored: MemoryStore.MEMORY_TELEMETRY_NOT_APPLICABLE,
                factsRejectedFull: MemoryStore.MEMORY_TELEMETRY_NOT_APPLICABLE,
                factsInjected: MemoryStore.MEMORY_TELEMETRY_NOT_APPLICABLE,
                totalFactsInStore: MemoryStore.MEMORY_TELEMETRY_NOT_APPLICABLE,
                dnaDeferred: MemoryStore.MEMORY_TELEMETRY_NOT_APPLICABLE,
                dnaInjected: MemoryStore.MEMORY_TELEMETRY_NOT_APPLICABLE,
                dnaBudgetTokens: MemoryStore.MEMORY_TELEMETRY_NOT_APPLICABLE,
                extractParseOutcome: MemoryStore.MEMORY_TELEMETRY_NOT_APPLICABLE,
                extractGateSource: MemoryStore.MEMORY_TELEMETRY_NOT_APPLICABLE,
                extractStopReason: 4,
              };
              trackMemoryExtractJob(
                emitSettledMemoryTelemetry(earlyTelemetry, noExtractDetails),
              );
              return;
            }
            if (calendarExtractSkipped(fetchAllowlistTurnSeq)) return;

            const capturedAssistant = turn.getAssistantFull();
            const capturedUser = turn.text;
            const startEpoch = MemoryStore.getEpoch();

            const saveGate = new Promise<void>((resolve) => {
              releaseSaveGate = resolve;
            });
            // Cancel = release the gate (source 3) + abort the extraction's own
            // signal. stop/clearChat abort the TURN signal; forwarding it here is
            // what makes cancellation reach a completion that is already running
            // (audit 2026-09-10: the old listener released the gate only, and
            // extractMemory listens on this controller, not on the turn signal).
            const extractAbort = createExtractAbort({
              outer: turn.signal,
              onCancel: () => {
                if (releaseSaveGate && extractGateSource === 0) extractGateSource = 3;
                releaseSaveGate?.();
              },
            });
            memoryExtractCancelRef.current = extractAbort.cancel;
            // Safety valve (re-verify finding 1c): if NO path releases the gate
            // (rapid re-send inside the save window, a skipped save branch, a
            // Fabric-lane ordering glitch), the extract must still run — a
            // stranded gate keeps memoryExtractRef set and DEADLOCKS the next
            // send. Worst case of firing early: the save skips with
            // kv_not_chat, which is the pre-feature behavior, never a hang.
            const gateTimeoutId = setTimeout(() => {
              if (releaseSaveGate && extractGateSource === 0) extractGateSource = 2;
              releaseSaveGate?.();
            }, 10_000);

            const extractJob = (async () => {
              let extractResult: MemoryExtractResult | null = null;
              let extractDetails: MemoryExtractDetails = noExtractDetails;
              try {
                await saveGate;
                if (extractAbort.cancelled()) {
                  extractDetails = {
                    durationMs: 0,
                    timeoutMs: EXTRACT_MEMORY_MIN_TIMEOUT_MS,
                    stopReason: "aborted_by_send",
                  };
                  MemoryStore.trackMemoryExtractStopReason(1);
                  return;
                }
                if (turn.signal.aborted || turn.isFailed()) {
                  MemoryStore.trackMemoryExtractStopReason(1);
                  return;
                }
                if (!(await MemoryStore.getEnabled())) {
                  MemoryStore.trackMemoryExtractStopReason(2);
                  return;
                }
                if (MemoryStore.getEpoch() !== startEpoch) {
                  MemoryStore.trackMemoryExtractStopReason(3);
                  return;
                }

                MemoryStore.trackMemoryExtractStopReason(0);
                extractResult = await extractMemory(
                  capturedUser,
                  capturedAssistant,
                  locale,
                  extractAbort.signal,
                );
                extractDetails = {
                  durationMs: extractResult.durationMs,
                  timeoutMs: extractResult.timeoutMs,
                  stopReason: extractResult.stopReason,
                };

                // Track parse outcome BEFORE the early return; outcome codes are
                // documented with trackMemoryParseOutcome in MemoryStore.ts.
                MemoryStore.trackMemoryParseOutcome(extractResult.parseOutcome);

                if (extractResult.stopReason !== "done") return;

                // Single batched apply: re-checks epoch + enabled under the store mutex
                // so a clear/toggle-off during extract cannot be partially overwritten.
                if (extractResult.add.length === 0 && extractResult.remove.length === 0) return;
                if (MemoryStore.getEpoch() !== startEpoch) return;
                if (!(await MemoryStore.getEnabled())) return;

                const applied = await MemoryStore.applyExtractResults(
                  extractResult.add,
                  extractResult.remove,
                  startEpoch,
                );
                if (applied) {
                  await refreshMemoryFacts();
                }
              } catch {
                MemoryStore.trackMemoryParseOutcome(3);
                // ignore — extraction must never surface to the user
              } finally {
                // Record the gate source before taking the late-arriving snapshot.
                MemoryStore.trackMemoryExtractGateSource(extractGateSource);
                // Emit extract-complete telemetry even if the send signal aborted.
                await emitSettledMemoryTelemetry(undefined, extractDetails);

                clearTimeout(gateTimeoutId);
                if (memoryExtractCancelRef.current === extractAbort.cancel) {
                  memoryExtractCancelRef.current = null;
                }
                extractAbort.detach();
              }
            })();

            trackMemoryExtractJob(extractJob);
          };
          // AiChatPage: await saveEngineSession → afterSessionSave() (releases gate).
          const afterSessionSave = () => {
            const release = releaseSaveGate;
            if (release) {
              if (extractGateSource === 0) extractGateSource = 1;
              release();
              return;
            }
            // Fallback if arm ran without a gate (empty/aborted) or ordering glitch:
            // arm now and release immediately so extract is not silently dropped.
            armMemoryExtract();
            const releaseAfterArm = releaseSaveGate;
            if (releaseAfterArm) {
              if (extractGateSource === 0) extractGateSource = 1;
              releaseAfterArm();
            }
          };

  return { arm: armMemoryExtract, afterSessionSave };
}
