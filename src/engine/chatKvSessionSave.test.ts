/**
 * The KV-session save, driven for real: the engine FIFO, the lifecycle gate and
 * a deferred history read.
 *
 * The new-chat path enqueues its save without awaiting it, so two properties
 * have to hold and neither is visible from the call site:
 *
 *  1. the conversation id and the history key are captured at CALL time — a
 *     bind that runs after the call cannot repoint the stem;
 *  2. the engine job is enqueued in the caller's tick — so a completion that
 *     arrives later queues behind it.
 *
 * (2) has a hole the caller cannot close: the save is lifecycle-OUTER, so its
 * engine job is enqueued only once the lifecycle gate grants it. A send takes
 * no lifecycle lock (`streamAssistantTurn` → `withEngineJob` directly), so
 * while the gate is held a send CAN reach the engine chain first. The save
 * then writes whatever the engine holds — the new chat's primed KV — under the
 * old chat's stem and the old chat's history hash, and the next open of that
 * chat matches the hash and serves the wrong context. The guard below is what
 * turns that window into a refusal.
 *
 * Everything the save touches is mocked, because llama.rn and the file system
 * are not loadable here; the state is a real FIFO (a promise chain) and the
 * lifecycle gate is a gate the test holds open.
 */
import type { ChatKvSessionState } from "./chatKvSessionState";

const writes: string[] = [];
let sessionConversationId: string | undefined = "chat-old";
let stemFor = (id: string | undefined): string => `stem-${id ?? "none"}`;

jest.mock("expo-file-system/legacy", () => ({
  deleteAsync: jest.fn(async () => undefined),
  getInfoAsync: jest.fn(async () => ({ exists: false })),
  moveAsync: jest.fn(async () => undefined),
}));

jest.mock("./sessionPersistence", () => ({
  SESSION_FORMAT_VERSION: 1,
  ensureSessionsDir: jest.fn(async () => undefined),
  estimateSessionBytes: () => 1024,
  getSessionConversationId: () => sessionConversationId,
  historyHash: (text: string) => `h:${text}`,
  isSameSessionSave: () => false,
  markSessionDivergesAtLastExchange: jest.fn(async () => true),
  rememberSuccessfulSessionSave: (_prev: unknown, next: unknown) => next,
  resolveSessionDiskTokens: () => 128,
  sessionDiskGate: {},
  sessionFileExists: jest.fn(async () => true),
  sessionFilePath: (stem: string) => `/sessions/${stem}.kvs`,
  sessionNativeSaveCoversNPast: () => true,
  shouldSaveSession: () => ({ save: true, preservePrefix: false }),
  warnUnexpectedSessionFailure: jest.fn(),
  writeSessionMeta: jest.fn(async () => true),
}));

jest.mock("./sessionDiskSpaceDecision", () => ({
  decideSessionDiskSpace: async () => ({ proceed: true }),
}));
jest.mock("./sessionPool", () => ({
  deleteLegacyModelSession: jest.fn(async () => undefined),
  evictSessionPool: jest.fn(async () => undefined),
  evictSessionPoolForSpace: jest.fn(),
  readSessionPoolBudgetBytes: jest.fn(async () => 1024),
  touchSessionUse: jest.fn(async () => undefined),
}));
jest.mock("./ttftFlags", () => ({ BAKE_FORMAT_B_USER_PREFIX: false }));
jest.mock("./sessionDiskCalibration", () => ({
  recordSessionDiskSample: (current: unknown) => current,
}));
jest.mock("./sessionDiskCalibrationStore", () => ({
  saveSessionDiskCalibration: jest.fn(async () => undefined),
}));
jest.mock("./sessionDiskFallback", () => ({ registrySessionBytesPerToken: () => null }));
jest.mock("./chatKvSessionShared", () => ({
  activeSessionStem: (_state: unknown, _modelId: string, conversationId?: string) =>
    stemFor(conversationId),
  logGovernorSessionSkip: jest.fn(),
  noteChatNPast: jest.fn(),
  sessionDiskGateInput: async () => ({
    calibration: null,
    bytesPerToken: null,
  }),
  sessionErrorReason: () => "error:test",
}));

const { persistChatKvSession } = require("./chatKvSessionSave") as typeof import("./chatKvSessionSave");

/** A state whose two locks behave like the real ones: FIFO promise chains. */
function fakeState(): ChatKvSessionState & {
  release: () => void;
  runJob: (fn: () => Promise<unknown>) => Promise<unknown>;
  contextSave: jest.Mock;
} {
  let engineChain: Promise<unknown> = Promise.resolve();
  let lifecycleChain: Promise<unknown> = Promise.resolve();
  let releaseLifecycle: () => void = () => undefined;
  const lifecycleHeld = new Promise<void>((resolve) => {
    releaseLifecycle = resolve;
  });

  const contextSave = jest.fn(async (path: string) => {
    writes.push(path);
    return 128;
  });

  const state = {
    activeCacheTypeK: null,
    activeCacheTypeV: null,
    activeEngineBuild: "build-1",
    activeEngineCtx: 4096,
    activeEngineKnob: undefined,
    activeGovernorActive: false,
    activeModelFileId: "model-file",
    activeModelId: "model-a",
    activeMtpNMax: undefined,
    activeSpecType: undefined,
    bakedUserTails: [],
    chatKvDiskCurrent: false,
    context: { saveSession: contextSave } as never,
    disposing: false,
    isContextPoisoned: () => false,
    kvHoldsChatSession: true,
    // The hold names its conversation (see the invariant LlamaService keeps);
    // a held KV with no owner is a state the save refuses, so the fake must
    // start with a real one.
    lastAssembleConvId: "chat-old",
    kvReproState: { reproducible: true, divergesAtLastExchange: false },
    lastAssembleBoundary: undefined,
    lastChatNPast: 128,
    lastPromptEnvHash: "env-1",
    lastSuccessfulSessionSave: null,
    withEngineJob<T>(fn: () => Promise<T>): Promise<T> {
      const run = engineChain.then(fn, fn);
      engineChain = run.catch(() => undefined);
      return run;
    },
    withLifecycleLock<T>(fn: () => Promise<T>): Promise<T> {
      const next = lifecycleChain.then(() => lifecycleHeld).then(fn, fn);
      lifecycleChain = next.catch(() => undefined);
      return next;
    },
    release: () => releaseLifecycle(),
    /** What a send does: straight onto the engine chain, no lifecycle lock. */
    runJob: (fn: () => Promise<unknown>) => state.withEngineJob(fn),
    contextSave,
  };
  return state as unknown as ChatKvSessionState & {
    release: () => void;
    runJob: (fn: () => Promise<unknown>) => Promise<unknown>;
    contextSave: jest.Mock;
  };
}

const fact = { historyHash: "hash-old", historyMessageCount: 3 };

beforeEach(() => {
  writes.length = 0;
  sessionConversationId = "chat-old";
  stemFor = (id) => `stem-${id ?? "none"}`;
});

describe("every hold names its conversation", () => {
  const fs = require("fs");
  const path = require("path");
  const read = (name: string) =>
    fs.readFileSync(path.resolve(__dirname, name), "utf8");

  it("the turn's hold names the turn's conversation, adopted or not", () => {
    const source = read("LlamaService.ts");
    // The old code took the hold unconditionally and named the owner only on
    // adoption, so every unadopted turn left a held KV with a stale owner.
    expect(source).toContain("function holdChatSession(convId: string): void");
    expect(source).toMatch(/holdChatSession\(pendingAssembleConvId\);/);
    // And nothing else turns the hold on.
    const on = [...source.matchAll(/kvHoldsChatSession = true;/g)];
    expect(on.length).toBe(1);
    expect(source.slice(source.indexOf("function holdChatSession") - 400, source.indexOf("function holdChatSession")).includes("kvHoldsChatSession = true;")).toBe(false);
  });

  it("a pooled restore drops the hold: its .kvs holds a chat we cannot name", () => {
    const source = read("LlamaService.ts");
    const pooled = source.slice(source.indexOf("Restored from the pooled .kvs"));
    expect(pooled.slice(0, 700)).toContain("kvHoldsChatSession = false;");
  });

  it("a disk restore takes the hold only when it can name the conversation", () => {
    const source = read("chatKvSessionLoad.ts");
    expect(source).toContain("state.kvHoldsChatSession = restoredConvId.length > 0;");
    expect(source).toContain("state.lastAssembleConvId = restoredConvId;");
  });
});

describe("the save a new chat enqueues", () => {
  it("captures the conversation id at call time, before any bind", async () => {
    const state = fakeState();
    const saved = persistChatKvSession(state, "model-a", async () => fact);

    // The bind runs while the lifecycle gate is still held — exactly the
    // ordering the UI path uses.
    sessionConversationId = "chat-new";
    state.release();

    await expect(saved).resolves.toBe(true);
    // The stem belongs to the chat being LEFT, not the one on screen. The
    // native save writes to `<path>.tmp` and renames after, so the tmp path is
    // what identifies the stem the job resolved.
    expect(writes).toEqual(["/sessions/stem-chat-old.kvs.tmp"]);
  });

  it("resolves the deferred history inside the job, never at the call", async () => {
    const state = fakeState();
    const thunk = jest.fn(async () => fact);
    const saved = persistChatKvSession(state, "model-a", thunk);

    // Not called yet: the job has not started.
    expect(thunk).not.toHaveBeenCalled();
    state.release();
    await saved;
    expect(thunk).toHaveBeenCalledTimes(1);
  });

  it("queues behind a send that arrives while the lifecycle gate is held", async () => {
    const state = fakeState();
    const order: string[] = [];
    const saved = persistChatKvSession(state, "model-a", async () => {
      order.push("save");
      return fact;
    });

    // A send in the new chat: no lifecycle lock, straight onto the engine
    // chain. This is the overtake the gate allows.
    const sent = state.runJob(async () => {
      order.push("send");
    });

    state.release();
    await Promise.all([saved, sent]);

    // The send ran first — the save could not prevent it, so the guard below
    // is what keeps it from writing the send's KV under the old stem.
    expect(order).toEqual(["send", "save"]);
  });

  it("refuses to write a KV the engine has moved on from", async () => {
    const state = fakeState();
    // The save belongs to the chat being left; the engine now holds the new
    // chat's primed KV (what a send produced while the gate was held).
    const saved = persistChatKvSession(state, "model-a", async () => fact);

    sessionConversationId = "chat-new";
    (state as unknown as { lastAssembleConvId: string }).lastAssembleConvId = "chat-new";
    state.release();

    // Refused: the previous good .kvs stays, and no wrong-context file appears.
    await expect(saved).resolves.toBe(false);
    expect(writes).toEqual([]);
  });

  it("refuses a held KV that cannot say which chat it holds", async () => {
    const state = fakeState();
    // A legacy meta, a pooled restore or an unadopted turn used to leave the
    // hold on with no owner: the save could then write it under whatever chat
    // the save was for. The hold now names its conversation everywhere, so an
    // unnamed hold is refused rather than guessed at.
    (state as unknown as { lastAssembleConvId?: string }).lastAssembleConvId = undefined;
    const saved = persistChatKvSession(state, "model-a", async () => fact);

    state.release();
    await expect(saved).resolves.toBe(false);
    expect(writes).toEqual([]);
  });

  it("writes when the engine still holds the chat the save was made for", async () => {
    const state = fakeState();
    const saved = persistChatKvSession(state, "model-a", async () => fact);

    state.release();
    await expect(saved).resolves.toBe(true);
    expect(writes).toEqual(["/sessions/stem-chat-old.kvs.tmp"]);
  });
});