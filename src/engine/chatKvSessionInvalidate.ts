import { getSessionConversationId } from "./sessionPersistence";
import {
  deleteLegacyModelSession, deleteSessionsForConversation,
  deleteSessionsForModelConversation
} from "./sessionPool";
import type { ChatKvSessionState } from "./chatKvSessionState";

/** Delete on-disk sessions for a model or a conversation, queued on the engine job chain. */
/**
 * Drop on-disk KV for this model + the active conversation (all env-hash
 * variants + legacy per-model file). clearChat / empty-chat background.
 * Serialized on the engine job chain so a queued save cannot resurrect
 * the file after invalidation. Never throws.
 */
export async function invalidateModelSessions(
  state: ChatKvSessionState,
  modelId: string,
): Promise<void> {
  if (!modelId) return;
  const conv = getSessionConversationId();
  return state.withEngineJob(async () => {
    try {
      if (state.activeModelId === modelId) {
        await state.dropHoldAfterOptionalNativeClear(state.context);
        state.bakedUserTails = [];
        state.bakeUnprefixedHealed = false;
      }
      if (conv) {
        await deleteSessionsForModelConversation(modelId, conv);
      } else {
        await deleteLegacyModelSession(modelId);
      }
    } catch {
      // never throw
    }
  });
}

/** Drop every pooled session for a conversation (any model / env hash). */
export async function invalidateConversationSessionFiles(
  state: ChatKvSessionState,
  conversationId: string,
): Promise<void> {
  if (!conversationId) return;
  const wasActive = getSessionConversationId() === conversationId;
  return state.withEngineJob(async () => {
    try {
      if (wasActive) await state.dropHoldAfterOptionalNativeClear(state.context);
      await deleteSessionsForConversation(conversationId);
    } catch {
      // never throw
    }
  });
}
