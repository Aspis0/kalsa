/**
 * The `/bench …` / `bench:…` typed-command exchange (controller
 * `AiChatPage.tsx:2317-2374`): the measurement harness types these into the
 * composer, and the controller took them with a branch in `handleSend` that
 * never calls the model — the reply is the config console's own string, the
 * Q&A pair still lands in history for the harness logs.
 *
 * The interception belongs in the host's send path, not held: everything the
 * commands WRITE lives in `benchConfig`, and the host's engine paths already
 * READ those knobs (`engineEnsure.ts:96,131`, `engineLoad.ts:27`,
 * `agentTurnOptions.ts:33`, `engineTurnCompactor.ts:23`,
 * `engineTurnSlide.ts:24`, `useModelHost.ts:25`) — no bench screen or flag
 * stands between the command and its effect. `sendHost.send` calls this with
 * the claim and the fence token already held, before the content gate, which
 * is the controller's own position for the branch.
 */
import { isBenchCommand, tryHandleBenchCommand } from "../bench/benchConfig";
import { sendClearsDraft } from "./sendDraft";
import { nextMsgId, type Message } from "./hostMessage";
import type { TurnFence, TurnToken } from "./turnGuards";

export interface BenchTurnHost {
  setMessages: (updater: (prev: Message[]) => Message[]) => void;
  /** The field's text at send: the draft clears only if it sent the words
   *  (`sendDraft.ts` — this host's pinned rule for every send path). */
  draft: string;
  clearDraft: () => void;
}

/**
 * Runs the exchange and returns true when the text WAS a bench command; the
 * send path then returns without touching the model. Never throws — the
 * controller's ladder (`Chat:2330-2336`) answers `bench: error` (handler
 * fell over), `bench: not a command` (the handler rejected the text) or
 * `bench: failed` (the handler threw).
 */
export async function runBenchTurn(
  fence: TurnFence,
  token: TurnToken,
  text: string,
  host: BenchTurnHost,
): Promise<boolean> {
  if (!isBenchCommand(text)) return false;
  let reply = "bench: error";
  try {
    reply = (await tryHandleBenchCommand(text)) ?? "bench: not a command";
  } catch {
    reply = "bench: failed";
  }
  const userMsgId = nextMsgId("u");
  const assistantId = nextMsgId("a");
  const now = Date.now();
  // The push is gated on the fence token the send claimed: a conversation
  // switch that invalidated the run while the handler awaited writes nothing
  // (the controller's deferred updater checked its runId + generation the
  // same way, `Chat:2347-2352`).
  host.setMessages((prev) =>
    fence.apply(token, prev, (state) => [
      ...state,
      { id: userMsgId, role: "user", text, createdAt: now },
      { id: assistantId, role: "assistant", text: reply, streaming: false, createdAt: now + 1 },
    ]),
  );
  if (sendClearsDraft(host.draft, text)) host.clearDraft();
  return true;
}
