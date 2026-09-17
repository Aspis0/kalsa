import type { Conversation } from "./types";

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

function readAll(): Conversation[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (c): c is Conversation =>
        typeof c === "object" &&
        c !== null &&
        typeof (c as Conversation).id === "string" &&
        Array.isArray((c as Conversation).messages),
    );
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
