/**
 * The typed bench console's intercept (gap 9): the branch that must take
 * `/bench …` and `bench:…` OUT of the model path, in the controller's own
 * position (claim held, before the content gate), with the controller's
 * reply ladder and this host's fence as the stale-run gate.
 *
 * AsyncStorage is mocked — benchConfig writes storage and this file must stay
 * loadable in node jest. `tryHandleBenchCommand` is wrapped, not replaced:
 * every test except the throw-ladder one runs the REAL handler.
 */
jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => undefined),
    removeItem: jest.fn(async () => undefined),
  },
}));

jest.mock("../bench/benchConfig", () => {
  const actual = jest.requireActual("../bench/benchConfig");
  return { ...actual, tryHandleBenchCommand: jest.fn(actual.tryHandleBenchCommand) };
});

import { tryHandleBenchCommand } from "../bench/benchConfig";
import { runBenchTurn, type BenchTurnHost } from "./benchTurn";
import { createTurnFence, type TurnFence, type TurnToken } from "./turnGuards";
import type { Message } from "./hostMessage";

function hostWith(initial: Message[] = []) {
  let list = initial;
  const state = {
    get messages() {
      return list;
    },
    draftsCleared: 0,
  };
  const host: BenchTurnHost = {
    setMessages: (updater) => {
      list = updater(list);
    },
    draft: "",
    clearDraft: () => {
      state.draftsCleared += 1;
    },
  };
  return { host, state };
}

function claimedFence(): { fence: TurnFence; token: TurnToken } {
  const fence = createTurnFence();
  return { fence, token: fence.beginRun() };
}

describe("runBenchTurn — prose passes through, bench commands are taken", () => {
  it("ordinary chat text is NOT intercepted: nothing appended, nothing cleared, false returned", async () => {
    const { host, state } = hostWith();
    const { fence, token } = claimedFence();
    const took = await runBenchTurn(fence, token, "explain the campaign rig", host);
    expect(took).toBe(false);
    expect(state.messages).toEqual([]);
    expect(state.draftsCleared).toBe(0);
    // sample: the predicate is the prefix rule, not "mentions bench"
    expect(await runBenchTurn(fence, token, "please bench this idea", host)).toBe(false);
  });

  it("takes both accepted prefixes: `/bench show` and slash-free `bench:show`", async () => {
    for (const text of ["/bench show", "bench:show"]) {
      const { host, state } = hostWith();
      host.draft = text; // the field sent exactly these words
      const { fence, token } = claimedFence();
      const took = await runBenchTurn(fence, token, text, host);
      expect(took).toBe(true);
      expect(state.messages).toHaveLength(2);
      expect(state.messages[0]).toMatchObject({ role: "user", text });
      expect(state.messages[1]).toMatchObject({ role: "assistant" });
      expect(state.messages[1].text.startsWith("bench:")).toBe(true);
      expect(state.messages[1].streaming).toBe(false);
      expect(state.draftsCleared).toBe(1);
    }
  });

  it("the field's draft clears only when the field sent the words (sendDraft rule)", async () => {
    const { host, state } = hostWith();
    host.draft = "words the user typed elsewhere";
    const { fence, token } = claimedFence();
    await runBenchTurn(fence, token, "/bench show", host);
    expect(state.draftsCleared).toBe(0);
  });

  it("the handler's answer reaches history verbatim (unknown sub → usage ladder)", async () => {
    const { host, state } = hostWith();
    const { fence, token } = claimedFence();
    await runBenchTurn(fence, token, "/bench nosuchsub", host);
    expect(state.messages[1].text).toContain('bench: unknown subcommand "nosuchsub"');
    expect(state.messages[1].text).toContain("bench usage:");
  });

  it("a stale fence token pushes nothing — the switch-during-await gate (Chat:2347-2352)", async () => {
    const { host, state } = hostWith();
    const { fence, token } = claimedFence();
    fence.invalidate(); // the conversation switched while the handler awaits
    const took = await runBenchTurn(fence, token, "/bench show", host);
    expect(took).toBe(true); // it WAS a bench command…
    expect(state.messages).toEqual([]); // …but the newer chat is untouched
  });

  it("a handler that throws answers `bench: failed` (controller Chat:2335), never rejects", async () => {
    const { host, state } = hostWith();
    const { fence, token } = claimedFence();
    (tryHandleBenchCommand as jest.Mock).mockRejectedValueOnce(new Error("storage exploded"));
    const took = await runBenchTurn(fence, token, "/bench show", host);
    expect(took).toBe(true);
    expect(state.messages).toHaveLength(2);
    expect(state.messages[1].text).toBe("bench: failed");
    // sample: the ladder is a fixed string, not a rethrow's message
    expect(state.messages[1].text).not.toContain("storage exploded");
  });
});
