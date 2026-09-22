/**
 * Conversation-list operations for the new host: pure functions over an
 * index state, plus store-backed operations over an injected index store.
 *
 * Semantics re-expressed from AppShell: switch = setActive with unknown
 * ids a no-op (:2371); create = fresh empty meta activated, but appended
 * instead of recency-sorted — display order is derived at render by
 * filterConversations and re-derived on load by parseConversationsState,
 * so the stored array no longer needs (or may take) a sort on every write;
 * delete = survivor or none, and the index is written BEFORE the messages
 * key is removed (:2477 vs :2486) — a crash may orphan a key, never leave
 * a row pointing at a wiped one; touch = in-place update of the ACTIVE
 * meta (:2530-2544) with NO reordering.
 *
 * The epoch bump that must precede an ACTIVE conversation's key deletion
 * lives in historyWrite.bumpThenDeleteKey; the host wraps this module's
 * store.deleteMessages with it (AppShell bumps only when deletingActive,
 * :2505-2506).
 */
import {
  type ConversationMeta,
  type ConversationsState,
  createEmptyConversationMeta,
  emptyConversationsState,
  filterConversations,
  removeConversation,
  setActive,
} from "../conversations/ConversationsStore";

/**
 * Minimal index-store surface: read/write of `kalsa.conversations.v1` and
 * the quarantine-aware delete of one conversation's messages key.
 */
export interface ConversationIndexStore {
  read(): Promise<ConversationsState>;
  write(state: ConversationsState): Promise<void>;
  /** False: the sweep could not run, some quarantine slot may survive. */
  deleteMessages(id: string): Promise<boolean>;
}

export interface DeleteConversationResult {
  state: ConversationsState;
  /** True when the key removal failed or its sweep was incomplete. */
  deleteIncomplete: boolean;
}

/** Read the index; a failing or corrupt store yields the empty state, never a throw. */
export async function readConversations(
  store: ConversationIndexStore,
): Promise<ConversationsState> {
  try {
    return await store.read();
  } catch {
    return emptyConversationsState();
  }
}

/** Drawer list: recency-sorted, keyword AND-filtered (empty query → everything). */
export function listConversations(
  state: ConversationsState,
  query = "",
): ConversationMeta[] {
  return filterConversations(state.items, query);
}

/**
 * Switch to `id`. Unknown or empty ids leave the state unchanged, so the
 * active id can never point outside the index. Same-id switch is a content
 * no-op; the host skips its flush/session work by comparing ids itself.
 */
export function switchConversation(
  state: ConversationsState,
  id: string,
): ConversationsState {
  return setActive(state, id);
}

/**
 * Fresh empty conversation, appended and activated. The id comes from
 * nextConversationId (timestamp + random) unless the caller injects a
 * factory — ids are never drawn from a pool, so a deleted key cannot be
 * handed out again.
 */
export function createConversation(
  state: ConversationsState,
  opts?: { now?: number; newId?: () => string },
): ConversationsState {
  const meta = createEmptyConversationMeta(opts?.now);
  if (opts?.newId) meta.id = opts.newId();
  return { activeId: meta.id, items: [...state.items, meta] };
}

/**
 * First non-active conversation `isOccupied` reports empty — the "New chat"
 * scan (AppShell:2427-2441): reuse an idle thread instead of growing the
 * index with empty rows. The active conversation itself is never a
 * candidate.
 */
export async function findIdleConversation(
  state: ConversationsState,
  isOccupied: (id: string) => Promise<boolean>,
): Promise<string | null> {
  for (const item of state.items) {
    if (item.id === state.activeId) continue;
    if (!(await isOccupied(item.id))) return item.id;
  }
  return null;
}

/**
 * Delete a conversation: index first, then its messages key. Deleting the
 * active conversation activates the most recent survivor, or none ("") when
 * the index empties — seeding a replacement row is the caller's create.
 */
export async function deleteConversation(
  store: ConversationIndexStore,
  state: ConversationsState,
  id: string,
): Promise<DeleteConversationResult> {
  if (!id || !state.items.some((item) => item.id === id)) {
    return { state, deleteIncomplete: false };
  }
  const next = removeConversation(state, id);
  await store.write(next);
  try {
    return { state: next, deleteIncomplete: !(await store.deleteMessages(id)) };
  } catch {
    return { state: next, deleteIncomplete: true };
  }
}

/**
 * Touch the ACTIVE conversation with fresh title/preview/searchBlob. The
 * meta is replaced in place: positions are kept, so a touch never reorders
 * the index; an empty incoming title keeps the existing one; hasMessages
 * flips true (a touch means messages exist).
 */
export function touchConversation(
  state: ConversationsState,
  meta: { title: string; preview: string; searchBlob: string },
  now: number = Date.now(),
): ConversationsState {
  const id = state.activeId;
  if (!id) return state;
  const index = state.items.findIndex((item) => item.id === id);
  if (index === -1) return state;
  const existing = state.items[index];
  const touched: ConversationMeta = {
    ...existing,
    title: meta.title || existing.title,
    updatedAt: now,
    preview: meta.preview,
    searchBlob: meta.searchBlob,
    hasMessages: true,
  };
  const items = state.items.slice();
  items[index] = touched;
  return { activeId: id, items };
}
