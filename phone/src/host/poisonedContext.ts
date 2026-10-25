/**
 * The poisoned-context release: an iOS suspension latches `has_error` inside
 * the resident context's ggml-metal state, so something has to take that
 * context away before anything decodes on it again. Both owners call THIS —
 * the background guard on the way back (`src/host/iosBackgroundGuard.ts`) and
 * the ensure path when a turn arrives first (`src/host/engineEnsure.ts`) —
 * because a poisoned context is not ready however `isEngineReady()` reads.
 *
 * The dispose itself is the shared `./residentContextRelease.ts`; all this
 * caller adds is the reason: a poisoned context is one the callers want gone
 * and one whose session must not be restored (that reset is the dispose's, so
 * the memory release cannot bypass it).
 *
 * Clearing the mark is NOT here: a fresh `initEngine` clears it (a new context
 * has a clean `has_error`), and the guard clears it for the release that is not
 * followed by a load — under the epoch it started with, so a newer suspension's
 * mark survives (`contextPoisonMark`).
 */
import type { LocalReleaseOutcome } from "../app/iosBackgroundPlan";
import { isContextPoisoned } from "../engine/LlamaService";
import { releaseResidentContext } from "./residentContextRelease";

export async function releasePoisonedContext(): Promise<LocalReleaseOutcome> {
  // The poison check is the "still wanted" predicate, so it is re-read after
  // the load wait: a load that finished while we waited built a fresh context
  // and cleared the mark, and this must not kill the fresh context.
  return releaseResidentContext(() => isContextPoisoned());
}
