/**
 * The stamped date line at assembly: a stored turn replays the SAME line on
 * every later request (byte-identical, so the KV prefix survives), a turn
 * stored before the stamp existed replays unchanged, and only the current
 * turn's own stamp follows the send that carries it. The system prompt is
 * never touched — the line lives on user turns only.
 */
jest.mock("@react-native-async-storage/async-storage", () => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
  removeItem: jest.fn(async () => undefined),
}));
jest.mock("../engine/engineBackend", () => ({
  queueStaticPrefixPrewarm: jest.fn(async () => undefined),
  mintTurnId: jest.fn(() => "turn-1"),
  isRemoteEngineBackend: jest.fn(() => false),
}));
jest.mock("./engineBackendStream", () => ({ streamHostTurn: jest.fn(async () => undefined) }));
jest.mock("../memory/MemoryStore", () => ({
  trackMemoryInjection: jest.fn(),
  trackMemoryDnaBound: jest.fn(),
  trackMemoryEnabled: jest.fn(),
  getAndResetMemoryTelemetry: jest.fn(() => ({})),
  MEMORY_TELEMETRY_NOT_APPLICABLE: "na",
}));
jest.mock("../agent/webSearchTool", () => ({ mapSearchSourcesToChat: jest.fn() }));
jest.mock("../app/engineCallbackBridge", () => ({
  bridgeEngineCallbacks: (callbacks: unknown) => callbacks,
}));

import { streamHostTurn } from "./engineBackendStream";
import { streamEngineTurn } from "./engineTurnStream";
import { buildPersistableMessages, sanitizeHistoryMessages } from "./historyMessages";
import { validateHistoryMessages } from "./turnCorpus";
import type { EngineTurnDeps } from "./engineTurnDeps";
import type { CompactorRun } from "./engineTurnCompactor";
import type { Message } from "./hostMessage";
import type { EngineMessage } from "../engine/LlamaService";

const captured: EngineMessage[][] = [];
jest.mocked(streamHostTurn).mockImplementation(async (messages) => {
  captured.push(messages as EngineMessage[]);
});

const DEPS = {
  locale: "en",
  agentOptions: {},
  agentOptionsRef: { current: {} },
  recordDecodeSample: jest.fn(),
  memoryEnabledRef: { current: false },
  injectedFactsRef: { current: [] },
  t: (key: string) => key,
} as unknown as EngineTurnDeps;

const OLDEST_TURN = { role: "user", text: "old question" } as const;
const STORED_TURN = {
  role: "user",
  text: "history question",
  sentOn: "Sent on Thursday, 8 October 2026.",
} as const;
const REPLY = { role: "assistant", text: "an answer" } as const;

function runOver(input: {
  promptText: string;
  sentOn?: string;
  history?: ReturnType<typeof validateHistoryMessages>;
}): CompactorRun {
  return {
    inputs: {
      text: input.promptText,
      chatId: "chat-1",
      signal: new AbortController().signal,
      callbacks: { onDelta: jest.fn() },
      attachments: undefined,
      promptText: input.promptText,
      validatedHistory: input.history ?? [],
      contextMode: "off",
      hasImages: false,
      turnCiswireFlags: 0,
      sendOpts: input.sentOn ? { sentOn: input.sentOn } : undefined,
    },
    nativeClearedForAssemble: false,
    historyLengths: [],
    currentTurnChars: 0,
    legacyWindowStart: 0,
    measuredCharsPerToken: null,
    windowTokens: null,
    kvHeld: false,
    nPast: null,
    lastSaveTokens: null,
    loadedB: null,
    hasDigest: false,
    operativeContext: null,
    boundaryForAssemble: 0,
    windowSlideForCeiling: false,
    anchoredOn: false,
    persona: null,
    promptFacts: [],
  } as unknown as CompactorRun;
}

async function turn(input: Parameters<typeof runOver>[0]): Promise<EngineMessage[]> {
  captured.length = 0;
  await streamEngineTurn(DEPS, runOver(input), {
    armMemoryExtract: jest.fn(),
    finish: jest.fn(),
    markFailed: jest.fn(),
    setAssistantFull: jest.fn(),
  });
  expect(captured).toHaveLength(1);
  return captured[0];
}

describe("the stamped date line rides user turns at assembly", () => {
  test("a stored turn replays the same line; a turn without sentOn is unchanged", async () => {
    const messages = await turn({
      promptText: "what is today's date",
      sentOn: "Sent on Friday, 9 October 2026.",
      history: validateHistoryMessages([
        OLDEST_TURN,
        STORED_TURN,
        REPLY,
      ]),
    });
    const contents = messages.map((m) => m.content);
    expect(contents[0]).toBe("old question");
    expect(contents[1]).toBe("history question\n\nSent on Thursday, 8 October 2026.");
    expect(contents[contents.length - 1]).toBe(
      "what is today's date\n\nSent on Friday, 9 October 2026.",
    );
  });

  test("the stored line is byte-identical across two later sends on different days", async () => {
    const history = validateHistoryMessages([STORED_TURN, REPLY]);
    const dayA = await turn({ promptText: "first ask", sentOn: "Sent on Friday, 9 October 2026.", history });
    const dayB = await turn({ promptText: "second ask", sentOn: "Sent on Saturday, 10 October 2026.", history });
    expect(dayA[0].content).toBe(dayB[0].content);
    expect(dayA[0].content).toBe("history question\n\nSent on Thursday, 8 October 2026.");
  });

  test("a current turn without a stamp replays bare (never re-derived)", async () => {
    const messages = await turn({ promptText: "bare ask" });
    expect(messages[messages.length - 1].content).toBe("bare ask");
  });

  test("a stamp saved to disk and restored replays the same line after a reload", async () => {
    const live: Message[] = [
      { id: "u1", role: "user", text: "history question", createdAt: 1, sentOn: STORED_TURN.sentOn },
      { id: "a1", role: "assistant", text: "an answer", createdAt: 2 },
    ];
    const saved = JSON.parse(JSON.stringify(buildPersistableMessages(live)));
    const restored = sanitizeHistoryMessages(saved, "en");
    const messages = await turn({
      promptText: "after the reload",
      sentOn: "Sent on Saturday, 10 October 2026.",
      history: validateHistoryMessages(restored),
    });
    expect(messages[0].content).toBe("history question\n\nSent on Thursday, 8 October 2026.");
  });
});
