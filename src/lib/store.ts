import type { ChatMessage, Conversation } from "./types";

/**
 * The ONLY module that knows where conversations live. The rest of the app
 * talks to a ConversationStore; a future backend replaces createStore()
 * without touching any component.
 */
export interface ConversationStore {
  list(): Conversation[];
  get(id: string): Conversation | undefined;
  put(conversation: Conversation): void;
  remove(id: string): void;
  subscribe(listener: () => void): () => void;
}

export function uid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
}

const STORAGE_KEY = "crescent-chat.conversations.v1";

function isValidMessage(value: unknown): value is ChatMessage {
  if (typeof value !== "object" || value === null) return false;
  const m = value as Record<string, unknown>;
  return (
    typeof m.id === "string" &&
    m.id.length > 0 &&
    (m.role === "user" || m.role === "assistant") &&
    typeof m.content === "string"
  );
}

function cleanMessage(value: unknown): ChatMessage | null {
  if (!isValidMessage(value)) return null;
  return {
    id: value.id,
    role: value.role,
    content: value.content,
    createdAt: typeof value.createdAt === "number" ? value.createdAt : 0,
    ...(typeof value.stopped === "boolean" ? { stopped: value.stopped } : {}),
  };
}

function cleanConversation(value: unknown): Conversation | null {
  if (typeof value !== "object" || value === null) return null;
  const c = value as Record<string, unknown>;
  if (typeof c.id !== "string" || c.id.length === 0) return null;
  if (!Array.isArray(c.messages)) return null;
  return {
    id: c.id,
    title: typeof c.title === "string" && c.title ? c.title : "Untitled conversation",
    createdAt: typeof c.createdAt === "number" ? c.createdAt : 0,
    updatedAt: typeof c.updatedAt === "number" ? c.updatedAt : 0,
    messages: c.messages.map(cleanMessage).filter((m): m is ChatMessage => m !== null),
  };
}

function readAll(): Conversation[] {
  return readRaw()
    .map(cleanConversation)
    .filter((c): c is Conversation => c !== null);
}

function readRaw(): unknown[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function titleFor(firstText: string): string {
  const oneLine = firstText.replace(/\s+/g, " ").trim();
  if (!oneLine) return "New conversation";
  return oneLine.length > 46 ? `${oneLine.slice(0, 46).trimEnd()}…` : oneLine;
}

export function createStore(): ConversationStore {
  let cache: Conversation[] | null = null;
  const listeners = new Set<() => void>();

  function all(): Conversation[] {
    if (cache === null) {
      cache = readAll().sort((a, b) => b.updatedAt - a.updatedAt);
    }
    return cache;
  }

  function persist(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(all()));
    } catch {
      // Storage full or unavailable: the session keeps working in memory.
    }
    listeners.forEach((l) => l());
  }

  return {
    list() {
      return [...all()];
    },
    get(id) {
      return all().find((c) => c.id === id);
    },
    put(conversation) {
      const rest = all().filter((c) => c.id !== conversation.id);
      cache = [conversation, ...rest].sort((a, b) => b.updatedAt - a.updatedAt);
      persist();
    },
    remove(id) {
      cache = all().filter((c) => c.id !== id);
      persist();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
