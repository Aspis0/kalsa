import {
  runSendStream,
  type SendEngine,
  type SendEngineEmit,
  type SendRequest,
  type SendUiHandlers,
} from "./sendStream";

const REQUEST: SendRequest = { text: "hello" };

function uiRecorder() {
  const tokens: [string, string][] = [];
  const tools: string[] = [];
  const sources: unknown[][] = [];
  const ui: SendUiHandlers = {
    onToken: (delta, full) => tokens.push([delta, full]),
    onTool: (name) => tools.push(name),
    onSources: (list) => sources.push(list as unknown[]),
  };
  return { ui, tokens, tools, sources };
}

describe("sendStream — terminal classification", () => {
  it("forwards token, tool and sources until the engine resolves (baseline done path)", async () => {
    const save = () => undefined;
    const engine: SendEngine = async (_req, emit) => {
      emit.onDelta("He", "He");
      emit.onDelta("llo", "Hello");
      emit.onTool?.("web_search");
      emit.onSources?.([{ title: "s1" }]);
      return { afterSessionSave: save };
    };
    const h = uiRecorder();

    const result = await runSendStream(engine, REQUEST, h.ui, new AbortController().signal);

    expect(result).toEqual({ kind: "done", afterSessionSave: save });
    expect(h.tokens).toEqual([["He", "He"], ["llo", "Hello"]]);
    expect(h.tools).toEqual(["web_search"]);
    expect(h.sources).toEqual([[{ title: "s1" }]]);
  });

  it("resolves interrupted — not done — when an abort lands after tokens, keeping the save hook (prevents: a stopped turn's partial dropped or its turn-end save skipped)", async () => {
    const controller = new AbortController();
    const save = () => undefined;
    const engine: SendEngine = async (_req, emit) => {
      emit.onDelta("partial", "partial");
      controller.abort();
      return { afterSessionSave: save };
    };
    const h = uiRecorder();

    const result = await runSendStream(engine, REQUEST, h.ui, controller.signal);

    expect(result.kind).toBe("interrupted");
    expect(result.kind === "interrupted" && result.afterSessionSave).toBe(save);
    expect(h.tokens).toHaveLength(1);
  });

  it("resolves aborted with chat.sendAborted when no token ever arrived (prevents: abort read as success — regen keeps no reply and drops the previous one)", async () => {
    const controller = new AbortController();
    const engine: SendEngine = async (_req, _emit, signal) => {
      // Old engines resolve through onDone after an abort (LlamaService:4554).
      expect(signal.aborted).toBe(false);
      controller.abort();
    };
    const h = uiRecorder();

    const result = await runSendStream(engine, REQUEST, h.ui, controller.signal);

    expect(result).toEqual({ kind: "aborted", reasonKey: "chat.sendAborted" });
    expect(h.tokens).toHaveLength(0);
  });

  it("keeps a backend's named failure over the abort default (prevents: the real failure reason overwritten by chat.sendAborted)", async () => {
    const controller = new AbortController();
    const engine: SendEngine = async (_req, emit) => {
      emit.onFailed?.("chat.modelLoadFailed");
      controller.abort();
    };

    const result = await runSendStream(engine, REQUEST, uiRecorder().ui, controller.signal);

    expect(result).toEqual({ kind: "aborted", reasonKey: "chat.modelLoadFailed" });
  });

  it("a resolving backend's onFailed becomes failed with its key — never a rejection (prevents: failure swallowed as success, skipping rollback and the user message)", async () => {
    const save = () => undefined;
    const engine: SendEngine = async (_req, emit) => {
      emit.onFailed?.("chat.serviceUnreachable");
      return { afterSessionSave: save };
    };

    const result = await runSendStream(engine, REQUEST, uiRecorder().ui, new AbortController().signal);

    expect(result.kind).toBe("failed");
    expect(result.kind === "failed" && result.reasonKey).toBe("chat.serviceUnreachable");
    // Failed turns still adopt the save hook (AiChatPage:2723).
    expect(result.kind === "failed" && result.afterSessionSave).toBe(save);
  });

  it("a throwing engine becomes failed with the default key (prevents: rejected promise escaping and killing the turn's finally)", async () => {
    const engine: SendEngine = async () => {
      throw new Error("engine exploded");
    };

    const result = await runSendStream(engine, REQUEST, uiRecorder().ui, new AbortController().signal);

    expect(result.kind).toBe("failed");
    expect(result.kind === "failed" && result.reasonKey).toBe("chat.serviceUnreachable");
    expect(result.kind === "failed" && result.message).toBe("engine exploded");
  });
});

describe("sendStream — post-terminal silence", () => {
  it("drops events emitted after the terminal result (prevents: late engine callbacks painting a message after abort)", async () => {
    let held: SendEngineEmit | null = null;
    const engine: SendEngine = async (_req, emit) => {
      emit.onDelta("before", "before");
      held = emit;
    };
    const h = uiRecorder();

    await runSendStream(engine, REQUEST, h.ui, new AbortController().signal);
    (held as SendEngineEmit | null)?.onDelta("late", "beforelate");
    (held as SendEngineEmit | null)?.onTool?.("late_tool");
    (held as SendEngineEmit | null)?.onFailed?.("chat.serviceUnreachable");

    expect(h.tokens).toEqual([["before", "before"]]);
    expect(h.tools).toEqual([]);
  });

  it("the first failure key wins (prevents: a generic follow-up key masking the original failure)", async () => {
    const engine: SendEngine = async (_req, emit) => {
      emit.onFailed?.("chat.modelLoadFailed");
      emit.onFailed?.("chat.serviceUnreachable");
    };

    const result = await runSendStream(engine, REQUEST, uiRecorder().ui, new AbortController().signal);

    expect(result).toEqual({ kind: "failed", reasonKey: "chat.modelLoadFailed", afterSessionSave: undefined });
  });
});
