/**
 * The one release of a poisoned local context: an iOS suspension latches
 * `has_error` inside the resident context's ggml-metal state, so something has
 * to take that context away before anything decodes on it again. Both owners
 * call THIS — the background guard on the way back
 * (`src/host/iosBackgroundGuard.ts`) and the ensure path when a turn arrives
 * first (`src/host/engineEnsure.ts`) — because a poisoned context is not ready
 * however `isEngineReady()` reads.
 *
 * The sequence is the idle discard's (`foregroundIdle.ts:162-188`): wait out a
 * chat load another owner holds (`loadSettle`) so the context it is building is
 * the one judged, dispose through the native-op FIFO, reset the boot history
 * hash so the reload cannot compare a stale H0 against the .kvs, release the
 * chat slot the disposed context held. The reload itself belongs to the caller:
 * a released engine is reloaded by the ensure path every send already runs.
 *
 * Clearing the mark is NOT here: a fresh `initEngine` clears it (a new context
 * has a clean `has_error`), and the guard clears it for the release that is not
 * followed by a load — under the epoch it started with, so a newer suspension's
 * mark survives (`contextPoisonMark`).
 */
import type { LocalReleaseOutcome } from "../app/iosBackgroundPlan";
import {
  disposeEngine,
  isContextPoisoned,
  isEngineHung,
  isEngineReady,
} from "../engine/LlamaService";
import {
  getChatGeneration,
  markChatReleased,
  runNativeOp,
} from "../engine/llamaContextGate";
import { resetBootHistoryHash } from "../engine/sessionPersistence";
import { waitForInFlightChatLoad } from "./loadSettle";

export async function releasePoisonedContext(): Promise<LocalReleaseOutcome> {
  // Ownership token captured BEFORE any await: a stale release must not idle a
  // newer load's gate (`foregroundIdle.ts:103`). A changed token means a newer
  // owner disposed what was poisoned and built its own context.
  const chatGen = getChatGeneration();
  await waitForInFlightChatLoad();
  // A load that finished while we waited built a fresh context and cleared the
  // mark: nothing poisoned is resident now, and this must not kill the fresh
  // context.
  if (!isContextPoisoned()) return "absent";
  if (getChatGeneration() !== chatGen || !isEngineReady()) return "absent";
  try {
    await runNativeOp(() => disposeEngine());
  } catch {
    // A dispose that threw leaves the engine hung (initEngine refuses);
    // the mark has to stay so its KV is never written out.
    return "withheld";
  }
  // The 60 s safety timeout with native work still active refuses the release
  // and requires a restart (`LlamaService.ts:3144`): not released, mark kept.
  if (isEngineHung()) return "withheld";
  resetBootHistoryHash();
  markChatReleased(chatGen);
  return "released";
}
