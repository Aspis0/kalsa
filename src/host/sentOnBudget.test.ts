/**
 * The window budget prices each date line where it is replayed: a history
 * user turn carries its OWN stamp, and only the send being built carries the
 * send's stamp. Charging the send's line to every history turn over-counts
 * the walk by one line per turn — the window then shrinks for no reason.
 */
jest.mock("../engine/engineBackend", () => ({
  chatKvIsHeld: jest.fn(() => false),
  discardChatKvForWindowSlide: jest.fn(async () => true),
  getActiveEngineNCtx: jest.fn(() => 4096),
  getActiveModelId: jest.fn(() => "test-model"),
  getLoadedAssembleBoundary: jest.fn(() => null),
  isRemoteEngineBackend: jest.fn(() => false),
}));
jest.mock("../engine/LlamaService", () => ({
  chatKvLastSaveTokens: jest.fn(() => 0),
  chatKvNPast: jest.fn(() => 0),
  getAttemptedAssembleStart: jest.fn(() => null),
}));
jest.mock("../screens/PersonasScreen", () => ({ builtinCopyFromT: jest.fn(() => ({})) }));

import { prepareEngineWindow } from "./engineTurnWindow";
import { validateHistoryMessages } from "./turnCorpus";
import type { EngineTurnDeps, TurnInputs } from "./engineTurnDeps";

const STORED_STAMP = "Sent on Thursday, 8 October 2026.";
const SEND_STAMP = "Sent on Friday, 9 October 2026.";

const DEPS = {
  t: (key: string) => key,
  locale: "en",
  memoryEnabledRef: { current: false },
  memoryFactsRef: { current: [] },
  personasStateRef: { current: {} },
  activePersonaIdRef: { current: "" },
  currentModel: { id: "test-model", preserveThinking: false },
} as unknown as EngineTurnDeps;

function inputs(overrides: Partial<TurnInputs>): TurnInputs {
  return {
    chatId: "chat-1",
    hasImages: false,
    contextMode: "off",
    promptText: "now",
    attachments: undefined,
    validatedHistory: [],
    sendOpts: undefined,
    ...overrides,
  } as unknown as TurnInputs;
}

describe("the window budget charges each date line where it is replayed", () => {
  test("a history user turn is charged its own stamp, and no other turn's", async () => {
    const validatedHistory = validateHistoryMessages([
      { role: "user", text: "old question", sentOn: STORED_STAMP },
      { role: "user", text: "bare question" },
      { role: "assistant", text: "an answer" },
    ]);
    const frame = await prepareEngineWindow(
      DEPS,
      inputs({ validatedHistory, sendOpts: { sentOn: SEND_STAMP } }),
    );
    expect(frame.historyLengths[0]).toBe("old question".length + 2 + STORED_STAMP.length);
    expect(frame.historyLengths[1]).toBe("bare question".length);
  });

  test("the send being built is charged its own stamp once, in its current turn", async () => {
    const frame = await prepareEngineWindow(
      DEPS,
      inputs({ promptText: "now", sendOpts: { sentOn: SEND_STAMP } }),
    );
    expect(frame.currentTurnChars).toBe("now".length + 2 + SEND_STAMP.length);
  });
});
