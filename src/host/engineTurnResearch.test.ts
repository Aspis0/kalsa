const mockRunDeepResearch = jest.fn();
jest.mock("../research/deepResearch", () => ({
  runDeepResearch: (...args: unknown[]) => mockRunDeepResearch(...args),
}));

import { readFileSync } from "fs";
import { join } from "path";
import { runEngineResearchTurn } from "./engineTurnResearch";
import type { EngineResearchTurnInput } from "./engineTurnResearch";

const ENGINE_TURN = readFileSync(join(__dirname, "engineTurn.ts"), "utf8");

function input(overrides: Partial<EngineResearchTurnInput> = {}): EngineResearchTurnInput {
  return {
    requested: true,
    remoteBackend: false,
    locale: "en",
    text: "Research this",
    docs: [{ id: "d1", sourceId: "d1", name: "Notes", kind: "txt", addedAt: 1, sizeBytes: 1, docCount: 1, fileUri: "file:///notes" }],
    executeTool: jest.fn(async () => ({ text: "" })),
    completeOnce: jest.fn(async () => ({ text: "plan", aborted: false })),
    nCtx: 4096,
    signal: new AbortController().signal,
    currentModelId: "local-model",
    refuseRemote: jest.fn(),
    onStatus: jest.fn(),
    onDelta: jest.fn(),
    finish: jest.fn(),
    invalidateSession: jest.fn(),
    ...overrides,
  };
}

describe("the engine research phase is local-only and still runs locally", () => {
  beforeEach(() => mockRunDeepResearch.mockReset());

  test("remote research is refused before the research pipeline or tool executor", async () => {
    const remote = input({ remoteBackend: true });
    const handled = await runEngineResearchTurn(remote);

    expect(handled).toBe(true);
    expect(remote.refuseRemote).toHaveBeenCalledTimes(1);
    expect(remote.executeTool).not.toHaveBeenCalled();
    expect(mockRunDeepResearch).not.toHaveBeenCalled();
    expect(remote.finish).toHaveBeenCalledTimes(1);
    expect(ENGINE_TURN).toContain("requested: sendOpts?.research");
    expect(ENGINE_TURN).toContain("remoteBackend: isRemoteEngineBackend()");
  });

  test("a local research send reaches its engine tool executor", async () => {
    const local = input();
    mockRunDeepResearch.mockImplementation(async (opts: { execute: (name: string, args: Record<string, unknown>) => Promise<unknown> }) => {
      await opts.execute("document_chat", { query: "Research this" });
      return { kind: "report", text: "Found it", partial: false };
    });

    const handled = await runEngineResearchTurn(local);

    expect(handled).toBe(true);
    expect(local.executeTool).toHaveBeenCalledWith("document_chat", { query: "Research this" }, undefined, "Research this");
    expect(mockRunDeepResearch).toHaveBeenCalledTimes(1);
    expect(local.invalidateSession).toHaveBeenCalledWith("local-model");
    expect(local.finish).toHaveBeenCalledTimes(1);
    expect(ENGINE_TURN).toContain("runEngineResearchTurn({");
    expect(ENGINE_TURN).toContain("executeTool: agentOptionsRef.current.executeTool");
  });
});
