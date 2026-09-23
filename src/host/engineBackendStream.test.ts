import { readFileSync } from "fs";
import { join } from "path";

const mockIsRemote = jest.fn<boolean, []>();
const mockStream = jest.fn<Promise<void>, unknown[]>();

jest.mock("../engine/engineBackend", () => ({
  isRemoteEngineBackend: () => mockIsRemote(),
  streamAssistantTurn: (...args: unknown[]) => mockStream(...args),
}));

import { streamHostTurn } from "./engineBackendStream";
import type { EngineCallbacks, EngineMessage, StreamTurnOptions } from "../engine/engineBackend";

const STREAM_CALL_SITE = readFileSync(join(__dirname, "engineTurnStream.ts"), "utf8");

describe("the host dispatches turns through engineBackend", () => {
  beforeEach(() => {
    mockIsRemote.mockReset();
    mockStream.mockReset();
    mockStream.mockResolvedValue(undefined);
  });

  test("remote turns omit both tool channels and the live call site uses this dispatcher", async () => {
    mockIsRemote.mockReturnValue(true);
    const messages: EngineMessage[] = [{ role: "user", content: "hello" }];
    const callbacks: EngineCallbacks = { onDelta: jest.fn(), onDone: jest.fn(), onError: jest.fn() };
    const signal = new AbortController().signal;
    const options = { tools: [{ name: "search" }], executeTool: jest.fn(), locale: "en" };

    await streamHostTurn(messages, callbacks, signal, options as unknown as StreamTurnOptions);

    expect(mockStream).toHaveBeenCalledWith(messages, callbacks, signal, {
      locale: "en",
      tools: undefined,
      executeTool: undefined,
    });
    expect(STREAM_CALL_SITE).toContain("streamHostTurn(");
  });

  test("local turns preserve the existing tool definitions", async () => {
    mockIsRemote.mockReturnValue(false);
    const options = { tools: [{ name: "search" }], executeTool: jest.fn() };

    const callbacks: EngineCallbacks = { onDelta: jest.fn(), onDone: jest.fn(), onError: jest.fn() };
    await streamHostTurn([], callbacks, undefined, options as unknown as StreamTurnOptions);

    expect(mockStream).toHaveBeenCalledWith([], callbacks, undefined, options);
  });
});
