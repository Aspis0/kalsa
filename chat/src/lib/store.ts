import type { ChatMessage, Conversation, ConversationMeta, ToolRun } from "./types";
import type { Attachment, AttachmentKind } from "./attachments";

/**
 * The ONLY module that knows where conversations live. The rest of the app
 * talks to a ConversationStore; a future backend replaces createStore()
 * without touching any component.
 *
 * Shape (v2): an INDEX of capped metadata (one small key, read for every
 * list/search) plus one key PER CONVERSATION for its messages. The list and
 * the search never touch a message payload.
 *
 * Deliberate deviation, documented: list() returns ConversationMeta[], not
 * Conversation[] — returning full payloads from list() would nullify the
 * split above. Method names and the single-seam rule are unchanged.
 */
export interface ConversationStore {
  /** Index only. Never parses a message payload. */
  list(): ConversationMeta[];
  /** Full conversation; messages validated on read. */
  get(id: string): Conversation | undefined;
  put(conversation: Conversation): void;
  remove(id: string): void;
  /** Retitle without touching the message payload (index-only). */
  rename(id: string, title: string): void;
  /** Attachments of one conversation (active and history). Small; no cache. */
  getAttachments(convId: string): Attachment[];
  /** Insert or replace one attachment; history beyond 20 falls off. */
  putAttachment(convId: string, attachment: Attachment): void;
  /** Detach into history (kept, re-attachable) — never deletes the text. */
  removeAttachment(convId: string, attachmentId: string): void;
  /** Last persist failure, if any (quota). Null after a successful write. */
  getWriteError(): string | null;
  clearWriteError(): void;
  subscribe(listener: () => void): () => void;
}

export function uid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
}

const PREFIX = "crescent-chat.";
const INDEX_KEY = "crescent-chat.index.v2";
const MIGRATED_KEY = "crescent-chat.migrated.v2";
const OLD_KEY = "crescent-chat.conversations.v1";

function attachKey(convId: string): string {
  return `crescent-chat.attach.${convId}.v2`;
}

const ATTACH_KINDS: AttachmentKind[] = ["txt", "md", "pdf", "docx", "pptx"];

function cleanAttachment(value: unknown): Attachment | null {
  if (typeof value !== "object" || value === null) return null;
  const a = value as Record<string, unknown>;
  if (typeof a.id !== "string" || !a.id) return null;
  if (typeof a.name !== "string" || !a.name) return null;
  if (typeof a.text !== "string") return null;
  if (!ATTACH_KINDS.includes(a.kind as AttachmentKind)) return null;
  if (typeof a.chars !== "number" || typeof a.tokens !== "number") return null;
  if (typeof a.attachedAt !== "number" || typeof a.active !== "boolean") return null;
  if (a.pages !== undefined && typeof a.pages !== "number") return null;
  return {
    id: a.id,
    name: a.name,
    kind: a.kind as AttachmentKind,
    ...(typeof a.pages === "number" ? { pages: a.pages } : {}),
    chars: a.chars,
    tokens: a.tokens,
    text: a.text,
    attachedAt: a.attachedAt,
    active: a.active,
  };
}
const PREVIEW_CHARS = 140;
const SEARCH_CHARS = 500;
/** Every conversation payload key starts with this; nothing else may. */
const MSG_PREFIX = "crescent-chat.msgs.";
/**
 * How long an unnamed payload is left alone before the sweep may take it. Long
 * enough that a write in progress in another window, or a page loading while
 * one is, is never mistaken for junk; short enough that the junk the sweep is
 * for — left by an older build — is gone the first time the store opens.
 */
const SWEEP_GRACE_MS = 60_000;

function msgKey(id: string): string {
  return `${MSG_PREFIX}${id}.v2`;
}

/**
 * Whether the index **on disk** names this conversation. The index in memory is
 * the wrong question: a write the disk refused still lands there for the rest
 * of the session, so asking it would call an unfiled conversation filed.
 */
function namedOnDisk(id: string): boolean {
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    if (!raw) return false;
    const parsed: unknown = JSON.parse(raw);
    return (
      Array.isArray(parsed) && parsed.some((meta) => (meta as { id?: unknown }).id === id)
    );
  } catch {
    return false;
  }
}

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
    ...(typeof value.reasoning === "string" && value.reasoning
      ? { reasoning: value.reasoning }
      : {}),
    ...(typeof value.reasoningMs === "number" ? { reasoningMs: value.reasoningMs } : {}),
    ...(Array.isArray(value.toolRuns) ? cleanToolRuns(value.toolRuns) : {}),
  };
}

/** Tool runs read back from disk are kept only if whole: a half-written run
    would render as a call with no answer, which reads like a broken tool.

    `running` is a live state, not a stored one. `put` and `get` both come
    through here, so a run on its way to disk is already marked interrupted —
    otherwise a crash while a tool was in flight would leave "Searching the
    web…" on screen forever after the next reload. */
function cleanToolRuns(value: unknown[]): { toolRuns?: ToolRun[] } {
  const runs: ToolRun[] = [];
  for (const run of value) {
    if (typeof run !== "object" || run === null) continue;
    const r = run as Record<string, unknown>;
    if (typeof r.id !== "string" || typeof r.name !== "string") continue;
    if (typeof r.arguments !== "string" || typeof r.result !== "string") continue;
    if (r.state !== "running" && r.state !== "ok" && r.state !== "failed" && r.state !== "refused") continue;
    runs.push({
      id: r.id,
      name: r.name,
      arguments: r.arguments,
      result:
        r.state === "running" && r.result === "" ? "Stopped before this finished." : r.result,
      state: r.state === "running" ? "failed" : r.state,
    });
  }
  return runs.length > 0 ? { toolRuns: runs } : {};
}

function cleanMeta(value: unknown): ConversationMeta | null {
  if (typeof value !== "object" || value === null) return null;
  const m = value as Record<string, unknown>;
  if (typeof m.id !== "string" || m.id.length === 0) return null;
  if (typeof m.title !== "string") return null;
  return {
    id: m.id,
    title: m.title,
    createdAt: typeof m.createdAt === "number" ? m.createdAt : 0,
    updatedAt: typeof m.updatedAt === "number" ? m.updatedAt : 0,
    preview: typeof m.preview === "string" ? m.preview : "",
    search: typeof m.search === "string" ? m.search : "",
    hasMessages: m.hasMessages === true,
  };
}

function plainPreview(text: string): string {
  const noFences = text.replace(/```[\s\S]*?```/g, (block) => {
    const inner = block
      .replace(/```\w*\n?|\n?```$/g, "")
      .trim()
      .split("\n");
    return inner[0] ?? "";
  });
  return noFences
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^>\s?/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

function describe(messages: ChatMessage[]): Pick<ConversationMeta, "preview" | "search" | "hasMessages"> {
  const texts = messages.map((m) => m.content.trim()).filter((t) => t.length > 0);
  const preview = plainPreview(texts.at(-1) ?? "").slice(0, PREVIEW_CHARS);
  const recent = texts.slice(-2).join("\n");
  return { preview, hasMessages: texts.length > 0, search: recent.slice(-SEARCH_CHARS) };
}

function metaFor(conversation: Conversation): ConversationMeta {
  const clean = conversation.messages
    .map(cleanMessage)
    .filter((m): m is ChatMessage => m !== null);
  const described = describe(clean);
  const searchBase = `${conversation.title}\n${described.search}`.slice(-SEARCH_CHARS);
  return {
    id: conversation.id,
    title: conversation.title,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    preview: described.preview,
    search: searchBase,
    hasMessages: described.hasMessages,
  };
}

export function titleFor(firstText: string): string {
  const oneLine = firstText.replace(/\s+/g, " ").trim();
  if (!oneLine) return "New conversation";
  return oneLine.length > 46 ? `${oneLine.slice(0, 46).trimEnd()}…` : oneLine;
}

export function createStore(): ConversationStore {
  let index: ConversationMeta[] | null = null;
  let writeError: string | null = null;
  const listeners = new Set<() => void>();
  const payloadCache = new Map<string, ChatMessage[]>();

  function notify(): void {
    listeners.forEach((l) => l());
  }

  function readIndex(): ConversationMeta[] {
    if (index === null) {
      migrateOnce();
      const loaded = loadIndex();
      if (loaded === null) {
        // Nothing is cached and nothing is swept: the list reads as empty
        // because we cannot see it, and that is not a reason to delete
        // anything. The next read tries again, so a repaired index comes back
        // and the payloads are still there.
        return [];
      }
      index = loaded;
      sweepOrphans(index);
    }
    return index;
  }

  /**
   * Payloads the index does not name. A key like that is a conversation nothing
   * can open, nothing ever rewrites and nothing ever removes — and it keeps
   * consuming the quota that stopped the write in the first place. The undo in
   * `put` stops new ones appearing; this clears any left by an older build, or
   * by a write that failed between the two keys.
   *
   * Only unnamed payloads older than `SWEEP_GRACE_MS` are touched. `put` writes
   * the payload and the index in two statements, and a second window (or a
   * reload) that reads the index between them would otherwise see a fresh,
   * unnamed payload and delete a conversation another window is in the middle
   * of filing. Whether the two writes can be observed apart is a timing
   * argument nobody should have to rely on; a grace period means they cannot be
   * punished even if they are.
   */
  function sweepOrphans(named: ConversationMeta[]): void {
    try {
      const wanted = new Set(named.map((meta) => msgKey(meta.id)));
      const cutoff = Date.now() - SWEEP_GRACE_MS;
      const orphans: string[] = [];
      for (let at = 0; at < localStorage.length; at += 1) {
        const key = localStorage.key(at);
        if (key === null || !key.startsWith(MSG_PREFIX) || wanted.has(key)) continue;
        if (newestMessage(key) < cutoff) orphans.push(key);
      }
      for (const key of orphans) localStorage.removeItem(key);
    } catch {
      // Storage that cannot be read cannot be swept; nothing else to do.
    }
  }

  /**
   * When this payload was last written to, as far as it can say. A payload with
   * no readable messages has no date, and 0 makes it the oldest thing on the
   * machine — which is what it is: there is nothing in it to keep.
   */
  function newestMessage(key: string): number {
    try {
      const raw = localStorage.getItem(key);
      if (raw === null) return 0;
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return 0;
      return parsed.reduce((newest, message) => {
        const at = (message as { createdAt?: unknown })?.createdAt;
        return typeof at === "number" && at > newest ? at : newest;
      }, 0);
    } catch {
      return 0;
    }
  }

  /**
   * The index, or null when there is nothing readable there. The difference is
   * what stops the orphan sweep from deleting real work: an index that says
   * "these conversations" is evidence, and an index we cannot read is not
   * evidence of anything — least of all that every payload should go.
   */
  function loadIndex(): ConversationMeta[] | null {
    try {
      const raw = localStorage.getItem(INDEX_KEY);
      if (raw === null) return null;
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return null;
      return parsed
        .map(cleanMeta)
        .filter((m): m is ConversationMeta => m !== null)
        .sort((a, b) => b.updatedAt - a.updatedAt);
    } catch {
      return null;
    }
  }

  function readPayload(id: string): ChatMessage[] {
    const cached = payloadCache.get(id);
    if (cached) return cached;
    try {
      const raw = localStorage.getItem(msgKey(id));
      if (!raw) return [];
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      const clean = parsed.map(cleanMessage).filter((m): m is ChatMessage => m !== null);
      payloadCache.set(id, clean);
      return clean;
    } catch {
      return [];
    }
  }

  /** One-shot v1 -> v2 migration. Never repeats (flag), never loses data:
      the old key is removed only after the new index reads back whole. */
  function migrateOnce(): void {
    try {
      if (localStorage.getItem(MIGRATED_KEY) === "1") return;
      const raw = localStorage.getItem(OLD_KEY);
      if (!raw) {
        localStorage.setItem(MIGRATED_KEY, "1");
        return;
      }
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        localStorage.setItem(MIGRATED_KEY, "1");
        return;
      }
      const metas: ConversationMeta[] = [];
      for (const item of parsed) {
        if (typeof item !== "object" || item === null) continue;
        const c = item as Record<string, unknown>;
        if (typeof c.id !== "string" || c.id.length === 0 || !Array.isArray(c.messages)) continue;
        const messages = c.messages.map(cleanMessage).filter((m): m is ChatMessage => m !== null);
        const meta = metaFor({
          id: c.id,
          title: typeof c.title === "string" && c.title ? c.title : "Untitled conversation",
          createdAt: typeof c.createdAt === "number" ? c.createdAt : 0,
          updatedAt: typeof c.updatedAt === "number" ? c.updatedAt : 0,
          messages,
        });
        localStorage.setItem(msgKey(meta.id), JSON.stringify(messages));
        payloadCache.set(meta.id, messages);
        metas.push(meta);
      }
      metas.sort((a, b) => b.updatedAt - a.updatedAt);
      localStorage.setItem(INDEX_KEY, JSON.stringify(metas));
      const check: unknown = JSON.parse(localStorage.getItem(INDEX_KEY) ?? "[]");
      if (!Array.isArray(check) || check.length !== metas.length) return;
      localStorage.removeItem(OLD_KEY);
      localStorage.setItem(MIGRATED_KEY, "1");
    } catch {
      // Anything failed: flag unset, old key kept, retried on next load.
    }
  }

  function writeThrough(mutator: () => void): boolean {
    try {
      mutator();
      writeError = null;
      return true;
    } catch {
      writeError =
        "Browser storage is full — new messages are kept for this session only and will be lost on reload.";
      return false;
    }
  }

  if (typeof window !== "undefined") {
    // A second window wrote: drop every cache so the next read sees it.
    window.addEventListener("storage", (event) => {
      if (event.key !== null && !event.key.startsWith(PREFIX)) return;
      index = null;
      payloadCache.clear();
      notify();
    });
  }

  return {
    list() {
      return [...readIndex()];
    },
    get(id) {
      const meta = readIndex().find((m) => m.id === id);
      if (!meta) return undefined;
      return {
        id: meta.id,
        title: meta.title,
        createdAt: meta.createdAt,
        updatedAt: meta.updatedAt,
        messages: [...readPayload(id)],
      };
    },
    put(conversation) {
      const messages = conversation.messages
        .map(cleanMessage)
        .filter((m): m is ChatMessage => m !== null);
      const meta = metaFor({ ...conversation, messages });
      const ok = writeThrough(() => {
        localStorage.setItem(msgKey(meta.id), JSON.stringify(messages));
        const rest = readIndex().filter((m) => m.id !== meta.id);
        const next = [meta, ...rest].sort((a, b) => b.updatedAt - a.updatedAt);
        try {
          localStorage.setItem(INDEX_KEY, JSON.stringify(next));
        } catch (error) {
          // The index is what makes the payload reachable. Writing the index
          // first instead would be worse — a listed conversation that opens
          // empty — so the payload is undone, but only when nothing names it:
          // for a conversation the index already knows, the payload on disk is
          // still reachable and holds the newest turn.
          if (!namedOnDisk(meta.id)) localStorage.removeItem(msgKey(meta.id));
          throw error;
        }
        index = next;
        payloadCache.set(meta.id, messages);
      });
      if (!ok) {
        // Keep the session coherent in memory even though the disk refused.
        const rest = readIndex().filter((m) => m.id !== meta.id);
        index = [meta, ...rest].sort((a, b) => b.updatedAt - a.updatedAt);
        payloadCache.set(meta.id, messages);
      }
      notify();
    },
    remove(id) {
      const ok = writeThrough(() => {
        localStorage.removeItem(msgKey(id));
        localStorage.removeItem(attachKey(id));
        const next = readIndex().filter((m) => m.id !== id);
        localStorage.setItem(INDEX_KEY, JSON.stringify(next));
        index = next;
      });
      if (!ok) {
        index = readIndex().filter((m) => m.id !== id);
      }
      payloadCache.delete(id);
      notify();
    },
    rename(id, title) {
      // Index-only: the search field is always "title\nbody", so the body
      // half survives the retitle without loading the payload.
      const ok = writeThrough(() => {
        const next = readIndex().map((m) =>
          m.id === id
            ? { ...m, title, updatedAt: Date.now(), search: `${title}\n${m.search.split("\n").slice(1).join("\n")}` }
            : m,
        );
        localStorage.setItem(INDEX_KEY, JSON.stringify(next));
        index = next;
      });
      if (!ok) {
        index = readIndex().map((m) => (m.id === id ? { ...m, title } : m));
      }
      notify();
    },
    getAttachments(convId) {
      try {
        const raw = localStorage.getItem(attachKey(convId));
        if (!raw) return [];
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed
          .map(cleanAttachment)
          .filter((a): a is Attachment => a !== null)
          .sort((a, b) => b.attachedAt - a.attachedAt);
      } catch {
        return [];
      }
    },
    putAttachment(convId, attachment) {
      const clean = cleanAttachment(attachment);
      if (!clean) return;
      const rest = this.getAttachments(convId).filter((a) => a.id !== clean.id);
      const next = [clean, ...rest];
      const active = next.filter((a) => a.active);
      const history = next.filter((a) => !a.active).slice(0, 20);
      const capped = [...active, ...history].sort((a, b) => b.attachedAt - a.attachedAt);
      writeThrough(() => {
        localStorage.setItem(attachKey(convId), JSON.stringify(capped));
      });
      notify();
    },
    removeAttachment(convId, attachmentId) {
      const next = this.getAttachments(convId).map((a) =>
        a.id === attachmentId ? { ...a, active: false } : a,
      );
      writeThrough(() => {
        localStorage.setItem(attachKey(convId), JSON.stringify(next));
      });
      notify();
    },
    getWriteError() {
      return writeError;
    },    clearWriteError() {
      writeError = null;
      notify();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
