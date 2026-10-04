/**
 * The one dispose of the RESIDENT local chat context, for the owners that give
 * it back to the OS: the iOS background release (a suspension poisoned it —
 * `poisonedContext.ts`) and the iOS memory-warning release (`iosMemoryGuard.ts`
 * — give the memory back before jetsam takes the process).
 *
 * The sequence is the idle discard's (`foregroundIdle.ts:162-188`): capture the
 * chat gate's ownership token BEFORE any await (a stale release must not idle a
 * newer load's gate), wait out a load another owner holds (`loadSettle` — that
 * load is building the very context being judged), dispose through the
 * native-op FIFO, release the chat slot the disposed context held.
 *
 * The caller passes its own reason for the release, re-read AFTER the wait:
 * a load that finished while we waited built a fresh context, and a send that
 * claimed the engine in that window is a turn this must not kill. What is NOT
 * here is each owner's bookkeeping around the release — the poison mark and
 * the boot-history reset belong to the background release, not to every
 * dispose. The reload belongs to the ensure path every send already runs.
 */
import type { LocalReleaseOutcome } from "../app/iosBackgroundPlan";
import { disposeEngine, isEngineHung, isEngineReady } from "../engine/LlamaService";
import {
  getChatGeneration,
  markChatReleased,
  runNativeOp,
} from "../engine/llamaContextGate";
import { waitForInFlightChatLoad } from "./loadSettle";

export async function releaseResidentContext(
  /** False means the release is no longer wanted: the caller's reason is gone
   *  or a newer owner holds the engine. Returned as `absent`, never thrown. */
  stillWanted: () => boolean,
): Promise<LocalReleaseOutcome> {
  const chatGen = getChatGeneration();
  await waitForInFlightChatLoad();
  if (!stillWanted()) return "absent";
  if (getChatGeneration() !== chatGen || !isEngineReady()) return "absent";
  try {
    await runNativeOp(() => disposeEngine());
  } catch {
    // A dispose that threw leaves the engine hung (initEngine refuses) and
    // the context unusable; the caller keeps whatever mark it held.
    return "withheld";
  }
  // The 60 s safety timeout with native work still active refuses the release
  // and requires a restart (`LlamaService.ts:3144`): not released, mark kept.
  if (isEngineHung()) return "withheld";
  markChatReleased(chatGen);
  return "released";
}
