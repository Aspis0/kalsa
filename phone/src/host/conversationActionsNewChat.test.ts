/**
 * New chat: the UI must move first, and the old chat's KV save must stay
 * correct anyway.
 *
 * The stall was ~1 s on "New chat" (iPhone sim): the tap awaited the storage
 * read, the full-history stringify + hash, and a save that queues behind the
 * engine FIFO — all before `applyConversations`. Now the switch, the bind and
 * the drawer happen in the tap's own tick and the save is enqueued there too,
 * carrying the conversation id and the history key it must use.
 */
import { createConversationActions, type ConversationActionCtx } from "./conversationActions";
import { readFileSync } from "fs";
import { join } from "path";

const events: string[] = [];
let saveDeferred: (() => void) | null = null;

/**
 * A save that records when it was CALLED and stands in for the queued job:
 * releasing it runs the gates, then a deferred history read, then resolves.
 */
const captured: { conversationId?: string; bootKey: string }[] = [];
const saveEngineSession = jest.fn((modelId: string, history: unknown) => {
  // First statement of persistChatKvSession: the identity is taken NOW.
  captured.push({
    conversationId: jest.requireMock("../engine/sessionPersistence").getSessionConversationId(),
    bootKey: jest.requireMock("../engine/sessionPersistence").getBootMessagesKey(),
  });
  events.push(`save:called:${typeof history === "function" ? "thunk" : "hash"}`);
  return new Promise<boolean>((resolve) => {
    saveDeferred = async () => {
      if (typeof history === "function") await (history as () => Promise<unknown>)();
      events.push("save:resolved");
      resolve(true);
    };
  });
});

let bootKey = "kalsa.messages.chat-old";
/** What `setSessionConversationId` holds — what the save captures at call time. */
let sessionConversationId: string | undefined = "chat-old";

jest.mock("react-native", () => ({ Alert: { alert: jest.fn() }, Keyboard: { dismiss: jest.fn() } }));
jest.mock("lucide-react-native", () => new Proxy({}, { get: (_t, key) => String(key) }));
jest.mock("../i18n", () => ({ useLocale: () => ({ t: (k: string) => k }) }));
jest.mock("../conversations/ConversationsStore", () => ({
  createEmptyConversationMeta: () => ({ id: "chat-new", hasMessages: false }),
  conversationHasPersistedMessages: async () => true,
  getDefaultConversationsStorage: () => ({}),
  messagesKey: (id: string) => `kalsa.messages.${id}`,
  removeConversation: (state: any) => state,
  setActive: (state: any, id: string) => ({ ...state, activeId: id }),
  upsertMeta: (state: any, meta: any) => ({ ...state, items: [...state.items, meta] }),
}));
jest.mock("../engine/sessionPersistence", () => ({
  computeHistoryHashFromMessages: (msgs: unknown[]) => `hash:${msgs.length}`,
  getBootMessagesKey: () => bootKey,
  getSessionConversationId: () => sessionConversationId,
  readBootMessages: jest.fn(async (key: string) => {
    events.push(`read:${key}`);
    return [{ role: "user", content: "ciao" }];
  }),
}));
jest.mock("../engine/engineBackend", () => ({
  getActiveModelId: () => "model-a",
  isEngineReady: () => true,
  restoreEngineSession: jest.fn(),
  saveEngineSession: (...args: unknown[]) => saveEngineSession(...(args as [string, string])),
  invalidateConversationSessions: jest.fn(),
}));
jest.mock("../chat/historyQuarantine", () => ({ deleteConversationHistory: jest.fn() }));
jest.mock("./turnCorpus", () => ({ resetCompactorChat: jest.fn() }));
jest.mock("./conversationRowActions", () => ({ buildDrawerConversationItems: () => [] }));

function actions(over: Partial<ConversationActionCtx> = {}) {
  const applyConversations = jest.fn((next: any) => {
    events.push(`apply:${next.activeId}`);
  });
  const bindActiveConversation = jest.fn((id: string) => {
    events.push(`bind:${id}`);
    // The real bind repoints the boot-history key AND the session conversation
    // id; both are what the save must have captured before it was called.
    bootKey = `kalsa.messages.${id}`;
    sessionConversationId = id;
  });
  const ctx = {
    t: ((key: string) => key) as any,
    conversationsRef: {
      current: {
        activeId: "chat-old",
        items: [{ id: "chat-old", hasMessages: true }],
      },
    } as any,
    applyConversations,
    bindActiveConversation,
    clearChatSearch: jest.fn(),
    flushPartial: jest.fn(),
    isActiveChatEmpty: () => false,
    bumpPersistEpoch: jest.fn(),
    sendingInFlightRef: { current: false },
    setDrawerOpen: jest.fn(),
    setActiveOverlay: jest.fn(),
    ...over,
  } as unknown as ConversationActionCtx;
  return { api: createConversationActions(ctx), applyConversations, bindActiveConversation };
}

beforeEach(() => {
  events.length = 0;
  saveDeferred = null;
  bootKey = "kalsa.messages.chat-old";
  sessionConversationId = "chat-old";
  captured.length = 0;
  saveEngineSession.mockClear();
});

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("New chat", () => {
  it("switches, binds and closes before the save resolves", async () => {
    const { api } = actions();
    api.handleNewConversation();

    // Everything the tap owes the user is already done, with the save still in
    // flight: no await between them.
    expect(events).toEqual([
      "apply:chat-new",
      "save:called:thunk",
      "bind:chat-new",
    ]);

    saveDeferred?.();
    await settle();
    expect(events[events.length - 1]).toBe("save:resolved");
  });

  it("captures the conversation id and the key of the chat being left", () => {
    const { api } = actions();
    api.handleNewConversation();

    // The save ran BEFORE the bind, so both identities are the old chat's —
    // writing them under the new chat's stem is the bug this ordering avoids.
    expect(captured).toEqual([
      { conversationId: "chat-old", bootKey: "kalsa.messages.chat-old" },
    ]);
    expect(sessionConversationId).toBe("chat-new");
  });

  it("hands the save the key of the chat being left, not the new one", async () => {
    const { api } = actions();
    api.handleNewConversation();
    expect(bootKey).toBe("kalsa.messages.chat-new");
    saveDeferred?.();
    await settle();

    // The bind moved the key to chat-new before the job ran; the old chat's
    // history is what its .kvs meta must describe.
    const readBootMessages = jest.requireMock("../engine/sessionPersistence").readBootMessages;
    expect(readBootMessages).toHaveBeenCalledWith("kalsa.messages.chat-old");
  });

  it("resolves the history inside the save, never on the tap", async () => {
    const { api } = actions();
    api.handleNewConversation();
    // No read yet: the thunk is the save's to run, in its queued job.
    expect(events).not.toContain("read:kalsa.messages.chat-old");

    saveDeferred?.();
    await settle();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [, thunk] = saveEngineSession.mock.calls[0] as any[];
    expect(events).toContain("read:kalsa.messages.chat-old");
    expect(await thunk()).toEqual({ historyHash: "hash:1", historyMessageCount: 1 });
  });
});

/**
 * The ordering claim behind the change, as source: the save takes the identity
 * of the chat being left BEFORE it queues, and the queue is one FIFO chain, so
 * the send that follows the new chat runs after this save — never beside it.
 * llama.rn is why this is a source guard rather than an import test.
 */
describe("the save the tap enqueues", () => {
  const read = (name: string) =>
    readFileSync(join(__dirname, "..", "engine", name), "utf8");

  it("captures the conversation id before it queues the job", () => {
    const source = read("chatKvSessionSave.ts");
    expect(source.indexOf("getSessionConversationId()")).toBeLessThan(
      source.indexOf("state.withEngineJob("),
    );
  });

  it("queues on the one chain, so a later job cannot overtake it", () => {
    const source = read("LlamaService.ts");
    expect(source).toContain("engineJobChain = run.catch(() => undefined)");
  });
});