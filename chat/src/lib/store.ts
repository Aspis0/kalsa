import type { Conversation, ConversationMeta } from "./types";

const INDEX_KEY = "kalsa.chat.index.v1";
const PREFIX = "kalsa.chat.";

export interface ConversationStore {
  list(): ConversationMeta[];
  get(id: string): Conversation | undefined;
  put(conversation: Conversation): void;
  remove(id: string): void;
  rename(id: string, title: string): void;
  subscribe(listener: () => void): () => void;
}

function readIndex(): ConversationMeta[] {
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((row): row is ConversationMeta => {
      if (!row || typeof row !== "object") return false;
      const meta = row as Record<string, unknown>;
      return (
        typeof meta.id === "string" &&
        typeof meta.title === "string" &&
        typeof meta.preview === "string" &&
        typeof meta.updatedAt === "number" &&
        typeof meta.search === "string"
      );
    });
  } catch {
    return [];
  }
}

function validConversation(value: unknown): value is Conversation {
  if (!value || typeof value !== "object") return false;
  const conv = value as Record<string, unknown>;
  return (
    typeof conv.id === "string" &&
    typeof conv.title === "string" &&
    typeof conv.preview === "string" &&
    typeof conv.updatedAt === "number" &&
    typeof conv.search === "string" &&
    Array.isArray(conv.messages)
  );
}

export function createStore(): ConversationStore {
  const listeners = new Set<() => void>();
  const notify = (): void => listeners.forEach((listener) => listener());

  return {
    list: readIndex,
    get(id) {
      try {
        const raw = localStorage.getItem(`${PREFIX}${id}`);
        const parsed: unknown = raw ? JSON.parse(raw) : null;
        return validConversation(parsed) ? parsed : undefined;
      } catch {
        return undefined;
      }
    },
    put(conversation) {
      try {
        localStorage.setItem(`${PREFIX}${conversation.id}`, JSON.stringify(conversation));
        const meta: ConversationMeta = {
          id: conversation.id,
          title: conversation.title,
          preview: conversation.preview,
          updatedAt: conversation.updatedAt,
          search: conversation.search,
        };
        const index = readIndex().filter((row) => row.id !== conversation.id);
        index.unshift(meta);
        localStorage.setItem(INDEX_KEY, JSON.stringify(index));
      } catch {
        // Storage can be full or disabled; the session keeps working in memory.
      }
      notify();
    },
    remove(id) {
      try {
        localStorage.removeItem(`${PREFIX}${id}`);
        localStorage.setItem(INDEX_KEY, JSON.stringify(readIndex().filter((row) => row.id !== id)));
      } catch {
        // Nothing else can be done when storage refuses the write.
      }
      notify();
    },
    rename(id, title) {
      const conversation = this.get(id);
      if (conversation) this.put({ ...conversation, title, search: conversation.search });
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export function uid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
}
