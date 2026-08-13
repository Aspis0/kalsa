/**
 * Conversation index — pure state model + AsyncStorage helpers.
 *
 * No React Native imports at module scope (Node harness must stay clean).
 * Persistence uses an injected AsyncStorage-like `{ getItem, setItem, removeItem }`;
 * the default wrapper lazy-requires `@react-native-async-storage/async-storage`
 * only when called (same pattern as DocumentLibrary).
 *
 * Future: a retrieve-other-chats tool (search_past_chats) can reuse
 * filterConversations + searchBlob and inject the top 2–3 hits (~200 tokens)
 * onto the current user message (format B), never the system prompt.
 * Do not dump other chats into every turn — 2B/4B context is tiny.
 * Do not couple that tool to compaction / ciswire bench knobs.
 *
 * Personas (Phase 3): user-authored {id,name,instructions} in
 * kalsa.personas.v1. Anyone can type their own; a later "store" is just
 * import-by-URL into that same list. Inject instructions on the last user
 * message (format B), never buildSystemPrompt. Cap ~2k chars.
 */

import { filterByTokens } from "../util/filterByTokens";

export type ConversationMeta = {
  id: string;
  title: string;
  updatedAt: number;
  preview: string;
  searchBlob: string;
  /** True when this chat has at least one persisted message. Optional on old indexes. */
  hasMessages?: boolean;
};

export type ConversationsState = {
  activeId: string;
  items: ConversationMeta[];
};

/** AsyncStorage key for the conversation index. */
export const INDEX_KEY = "kalsa.conversations.v1";

/** Pre-multi-chat history key. Left in place after migrate so a botched copy is recoverable. */
export const LEGACY_MESSAGES_KEY = "kalsa.messages.v1";

/** Written after the first successful migrate so legacy is never a source of truth again. */
export const MIGRATED_KEY = "kalsa.conversations.migrated";

/** Cap for index searchBlob so the conversation list stays small. */
export const SEARCH_BLOB_CAP = 8_000;

const TITLE_MAX = 48;
const PREVIEW_MAX = 80;

/** Structural match for AsyncStorage (injected in tests / production). */
export type KeyValueStorage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem?(key: string): Promise<void>;
};

/**
 * Keep only `[A-Za-z0-9._-]` (same alphabet as cover paths).
 * Throws when the result is empty.
 */
export function sanitizeConversationId(id: string): string {
  if (typeof id !== "string") {
    throw new Error("conversation id required");
  }
  const safe = id.replace(/[^A-Za-z0-9._-]/g, "_");
  if (!safe) {
    throw new Error("empty conversation id");
  }
  return safe;
}

/** Per-conversation messages key: `kalsa.messages.` + sanitized id. */
export function messagesKey(id: string): string {
  return `kalsa.messages.${sanitizeConversationId(id)}`;
}

/** Unique id: `conv-` + epoch ms + random (filename-safe). */
export function nextConversationId(): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `conv-${Date.now()}-${rand}`;
}

function clipChars(text: string, max: number): string {
  const chars = Array.from(text);
  if (chars.length <= max) return chars.join("");
  return chars.slice(0, max).join("");
}

/** First line, trim, max ~48 chars. Empty / whitespace-only → "" (UI shows untitled). */
export function titleFromFirstUserText(text: string): string {
  if (typeof text !== "string") return "";
  const firstLine = text.replace(/\r\n/g, "\n").split("\n")[0] ?? "";
  const trimmed = firstLine.trim();
  if (!trimmed) return "";
  return clipChars(trimmed, TITLE_MAX);
}

/** Last non-empty message text, collapsed whitespace, ~80 chars. */
export function previewFromMessages(
  messages: Array<{ text?: unknown }> | null | undefined,
): string {
  if (!Array.isArray(messages)) return "";
  for (let i = messages.length - 1; i >= 0; i--) {
    const raw = messages[i]?.text;
    if (typeof raw !== "string") continue;
    const cleaned = raw.replace(/\s+/g, " ").trim();
    if (!cleaned) continue;
    return clipChars(cleaned, PREVIEW_MAX);
  }
  return "";
}

/** Lowercase join of message texts, capped so the index stays small. */
export function searchBlobFromMessages(
  messages: Array<{ text?: unknown }> | null | undefined,
): string {
  if (!Array.isArray(messages)) return "";
  const parts: string[] = [];
  for (const m of messages) {
    if (typeof m?.text !== "string") continue;
    const trimmed = m.text.trim();
    if (trimmed) parts.push(trimmed);
  }
  if (parts.length === 0) return "";
  return clipChars(parts.join("\n").toLowerCase(), SEARCH_BLOB_CAP);
}

function sortByRecency(items: ConversationMeta[]): ConversationMeta[] {
  return items.slice().sort((a, b) => {
    const bu = typeof b.updatedAt === "number" && Number.isFinite(b.updatedAt) ? b.updatedAt : 0;
    const au = typeof a.updatedAt === "number" && Number.isFinite(a.updatedAt) ? a.updatedAt : 0;
    return bu - au;
  });
}

/**
 * Keyword AND filter. Tokens shorter than 3 chars are ignored when any
 * token is ≥3 chars. Empty query → all items, recency-sorted.
 * Non-empty query whose tokens were all dropped → includes match on
 * title + searchBlob (never "show all").
 */
export function filterConversations(
  items: ConversationMeta[],
  query: string,
): ConversationMeta[] {
  const list = sortByRecency(Array.isArray(items) ? items : []);
  return filterByTokens(list, query, (item) => [item.title, item.searchBlob]);
}

export function emptyConversationsState(): ConversationsState {
  return { activeId: "", items: [] };
}

export function createEmptyConversationMeta(
  nowMs: number = Date.now(),
): ConversationMeta {
  return {
    id: nextConversationId(),
    title: "",
    updatedAt:
      typeof nowMs === "number" && Number.isFinite(nowMs) ? Math.floor(nowMs) : Date.now(),
    preview: "",
    searchBlob: "",
    hasMessages: false,
  };
}

/** Insert or replace by id; items stay recency-sorted. Does not mutate `state`. */
export function upsertMeta(
  state: ConversationsState,
  meta: ConversationMeta,
): ConversationsState {
  const items = Array.isArray(state?.items) ? state.items : [];
  if (!meta || typeof meta.id !== "string" || meta.id.length === 0) {
    return { activeId: state?.activeId ?? "", items: items.slice() };
  }
  let sanitized: ConversationMeta;
  try {
    sanitized = sanitizeMeta(meta);
  } catch {
    return { activeId: state?.activeId ?? "", items: items.slice() };
  }
  const next = items.filter((item) => item.id !== sanitized.id);
  next.push(sanitized);
  return {
    activeId: state?.activeId ?? "",
    items: sortByRecency(next),
  };
}

/** Set activeId when the id exists; otherwise no-op. */
export function setActive(
  state: ConversationsState,
  id: string,
): ConversationsState {
  const items = Array.isArray(state?.items) ? state.items : [];
  if (typeof id !== "string" || id.length === 0) {
    return { activeId: state?.activeId ?? "", items: items.slice() };
  }
  if (!items.some((item) => item.id === id)) {
    return { activeId: state?.activeId ?? "", items: items.slice() };
  }
  return { activeId: id, items: items.slice() };
}

/**
 * Drop an id. If it was active, activeId becomes the most recent remaining
 * (or "" when the list is empty). Does not mutate `state`.
 */
export function removeConversation(
  state: ConversationsState,
  id: string,
): ConversationsState {
  const items = Array.isArray(state?.items) ? state.items : [];
  if (typeof id !== "string" || id.length === 0) {
    return { activeId: state?.activeId ?? "", items: items.slice() };
  }
  const next = items.filter((item) => item.id !== id);
  if (state?.activeId !== id) {
    return { activeId: state?.activeId ?? "", items: next };
  }
  const sorted = sortByRecency(next);
  return { activeId: sorted[0]?.id ?? "", items: next };
}

export function serializeConversationsState(state: ConversationsState): string {
  const items = Array.isArray(state?.items)
    ? state.items
        .map((item) => {
          try {
            return sanitizeMeta(item);
          } catch {
            return null;
          }
        })
        .filter((item): item is ConversationMeta => item !== null)
    : [];
  const activeId =
    typeof state?.activeId === "string" && items.some((item) => item.id === state.activeId)
      ? state.activeId
      : (sortByRecency(items)[0]?.id ?? "");
  return JSON.stringify({ activeId, items });
}

export function parseConversationsState(
  raw: string | null | undefined,
): ConversationsState {
  if (!raw || typeof raw !== "string") return emptyConversationsState();
  try {
    const obj = JSON.parse(raw) as { activeId?: unknown; items?: unknown };
    if (!obj || typeof obj !== "object" || !Array.isArray(obj.items)) {
      return emptyConversationsState();
    }
    const items: ConversationMeta[] = [];
    for (const item of obj.items) {
      const meta = tryParseMeta(item);
      if (meta) items.push(meta);
    }
    const sorted = sortByRecency(items);
    const activeId =
      typeof obj.activeId === "string" && sorted.some((item) => item.id === obj.activeId)
        ? obj.activeId
        : (sorted[0]?.id ?? "");
    return { activeId, items: sorted };
  } catch {
    return emptyConversationsState();
  }
}

/** True when a persisted array has at least one user/assistant message with text. */
export function legacyMessagesAreValid(raw: string | null | undefined): boolean {
  if (!raw || typeof raw !== "string") return false;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed) || parsed.length === 0) return false;
    return parsed.some((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return false;
      const rec = item as { role?: unknown; text?: unknown };
      return (
        (rec.role === "user" || rec.role === "assistant") &&
        typeof rec.text === "string"
      );
    });
  } catch {
    return false;
  }
}

/**
 * True when the persisted messages payload looks non-empty.
 * Peeks length / trivial tokens only — never JSON.parse (new-chat empty-scan).
 */
export function persistedMessagesAreNonEmpty(raw: string | null | undefined): boolean {
  if (!raw || typeof raw !== "string") return false;
  const trimmed = raw.trim();
  if (!trimmed || trimmed === "[]" || trimmed === "null") return false;
  return trimmed.length > 2;
}

export async function conversationHasPersistedMessages(
  storage: KeyValueStorage,
  id: string,
): Promise<boolean> {
  let raw: string | null = null;
  try {
    raw = await storage.getItem(messagesKey(id));
  } catch {
    return false;
  }
  return persistedMessagesAreNonEmpty(raw);
}

/**
 * One-shot copy of `kalsa.messages.v1` into `kalsa.messages.default` + index.
 * Runs only when the index key is ABSENT (empty/corrupt index is not a migrate).
 * Does not overwrite `kalsa.messages.default` if that key already exists.
 * Writes `kalsa.conversations.migrated` so legacy is never a source of truth again.
 * Does not delete the legacy key (recoverable if this copy is botched).
 */
export async function migrateLegacyIfNeeded(
  storage: KeyValueStorage,
): Promise<ConversationsState | null> {
  let indexRaw: string | null = null;
  try {
    indexRaw = await storage.getItem(INDEX_KEY);
  } catch {
    return null;
  }
  // Present — even empty or corrupt — means already migrated.
  if (indexRaw !== null) return null;

  try {
    const tomb = await storage.getItem(MIGRATED_KEY);
    if (tomb != null && String(tomb).length > 0) return null;
  } catch {
    return null;
  }

  let legacyRaw: string | null = null;
  try {
    legacyRaw = await storage.getItem(LEGACY_MESSAGES_KEY);
  } catch {
    return null;
  }
  if (!legacyMessagesAreValid(legacyRaw)) return null;

  // Stable id so existing compactor keys under "default" keep working.
  const id = "default";
  const destKey = messagesKey(id);
  let destRaw: string | null = null;
  try {
    destRaw = await storage.getItem(destKey);
  } catch {
    return null;
  }

  const sourceRaw = destRaw === null ? (legacyRaw as string) : destRaw;
  if (destRaw === null) {
    await storage.setItem(destKey, legacyRaw as string);
  }

  let messages: Array<{ role?: unknown; text?: unknown }> = [];
  try {
    const parsed = JSON.parse(sourceRaw) as unknown;
    if (Array.isArray(parsed)) {
      messages = parsed as Array<{ role?: unknown; text?: unknown }>;
    }
  } catch {
    messages = [];
  }

  const firstUser = messages.find(
    (m) => m && m.role === "user" && typeof m.text === "string" && m.text.trim(),
  );
  const meta: ConversationMeta = {
    id,
    title: titleFromFirstUserText(
      typeof firstUser?.text === "string" ? firstUser.text : "",
    ),
    updatedAt: Date.now(),
    preview: previewFromMessages(messages),
    searchBlob: searchBlobFromMessages(messages),
    hasMessages: messages.length > 0,
  };
  const state: ConversationsState = { activeId: id, items: [meta] };
  await storage.setItem(INDEX_KEY, serializeConversationsState(state));
  await storage.setItem(MIGRATED_KEY, "1");
  return state;
}

export async function loadConversationsState(
  storage: KeyValueStorage,
): Promise<ConversationsState> {
  try {
    const migrated = await migrateLegacyIfNeeded(storage);
    if (migrated) return migrated;
    const raw = await storage.getItem(INDEX_KEY);
    return parseConversationsState(raw);
  } catch {
    return emptyConversationsState();
  }
}

export async function saveConversationsState(
  storage: KeyValueStorage,
  state: ConversationsState,
): Promise<void> {
  await storage.setItem(INDEX_KEY, serializeConversationsState(state));
}

/**
 * Default storage wrapper — lazy-requires AsyncStorage so this module stays
 * import-clean under plain Node (harness / tsc --ignoreConfig).
 */
export function getDefaultConversationsStorage(): KeyValueStorage {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const AsyncStorage = require("@react-native-async-storage/async-storage")
    .default as KeyValueStorage;
  return AsyncStorage;
}

// ── internals ──────────────────────────────────────────────────────────────

function sanitizeMeta(meta: ConversationMeta): ConversationMeta {
  const id = sanitizeConversationId(meta.id);
  if (id !== meta.id) {
    throw new Error("conversation id contains invalid characters");
  }
  return {
    id,
    title: typeof meta.title === "string" ? meta.title : "",
    updatedAt:
      typeof meta.updatedAt === "number" && Number.isFinite(meta.updatedAt)
        ? Math.floor(meta.updatedAt)
        : Date.now(),
    preview: typeof meta.preview === "string" ? meta.preview : "",
    searchBlob: typeof meta.searchBlob === "string" ? meta.searchBlob : "",
    ...(typeof meta.hasMessages === "boolean" ? { hasMessages: meta.hasMessages } : {}),
  };
}

function tryParseMeta(item: unknown): ConversationMeta | null {
  if (!item || typeof item !== "object" || Array.isArray(item)) return null;
  const o = item as Record<string, unknown>;
  if (typeof o.id !== "string" || o.id.length === 0) return null;
  if (o.id.replace(/[^A-Za-z0-9._-]/g, "_") !== o.id) return null;
  try {
    return sanitizeMeta({
      id: o.id,
      title: typeof o.title === "string" ? o.title : "",
      updatedAt: typeof o.updatedAt === "number" ? o.updatedAt : Date.now(),
      preview: typeof o.preview === "string" ? o.preview : "",
      searchBlob: typeof o.searchBlob === "string" ? o.searchBlob : "",
      hasMessages: typeof o.hasMessages === "boolean" ? o.hasMessages : undefined,
    });
  } catch {
    return null;
  }
}
