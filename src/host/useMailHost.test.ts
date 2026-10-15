/**
 * What the mail sheet shows while a read is in flight: a read that answers
 * after Close, or after a newer Open, must never touch the sheet — and a
 * conversation switch or a pairing completing must not leave one chat's mail
 * over another's.
 */
type Deferred<T> = {
  resolve: (value: T) => void;
  promise: Promise<T>;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const openCalls: { id: string; signal: AbortSignal }[] = [];
const pending: Deferred<{ ok: boolean; value?: unknown; errorCode?: string }>[] = [];

jest.mock("../engine/remote/mailApi", () => ({
  MAIL_ROUTE_ABSENT: "mail.unavailable",
  readRemoteMail: jest.fn((id: string, signal: AbortSignal) => {
    const answer = deferred<{ ok: boolean; value?: unknown; errorCode?: string }>();
    pending.push(answer);
    openCalls.push({ id, signal });
    return answer.promise;
  }),
  sendRemoteMailDraft: jest.fn(),
}));

jest.mock("react-native", () => ({}));
jest.mock("expo-secure-store", () => ({ setItemAsync: jest.fn(async () => undefined) }));

import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { markPairingCompleted } from "../pairing/pairingCompletedAt";
import { useMailHost, type MailActions } from "./useMailHost";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

/** A record a card can draw: an id and a sender are what it needs. */
function record(id: string) {
  return { id, from: { name: "", address: "a@b.it" } };
}

let actions: MailActions | null = null;
function Probe(props: { conversationId: string; send: () => void }) {
  actions = useMailHost({
    send: props.send,
    askDraftText: "scrivi",
    conversationId: props.conversationId,
  });
  return null;
}

async function mount(conversationId = "chat-1"): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(
      React.createElement(Probe, { conversationId, send: () => undefined }),
    );
  });
  return renderer;
}

describe("a mail read in flight", () => {
  beforeEach(() => {
    openCalls.length = 0;
    pending.length = 0;
    actions = null;
  });

  it("answers only the Open that is still open", async () => {
    await mount();
    await act(async () => {
      void actions!.readMail("105");
      void actions!.readMail("106");
    });
    expect(openCalls.map((call) => call.id)).toEqual(["105", "106"]);

    // The older read answers last, as a slow computer would.
    await act(async () => {
      pending[1].resolve({ ok: true, value: { record: record("106"), body: "second" } });
    });
    await act(async () => {
      pending[0].resolve({ ok: true, value: { record: record("105"), body: "first" } });
    });

    expect(actions!.openMail).toEqual({
      status: "ready",
      mail: { record: expect.objectContaining({ id: "106" }), body: "second" },
    });
  });

  it("is abandoned on Close, and the computer's read is told so", async () => {
    await mount();
    await act(async () => {
      void actions!.readMail("105");
    });
    await act(async () => {
      actions!.closeMail();
    });

    expect(openCalls[0].signal.aborted).toBe(true);
    expect(actions!.openMail).toEqual({ status: "idle" });

    await act(async () => {
      pending[0].resolve({ ok: true, value: { record: record("105"), body: "ciao" } });
    });
    expect(actions!.openMail).toEqual({ status: "idle" });
  });

  it("is shut by a pairing completing, and the computer's read is told so", async () => {
    await mount();
    await act(async () => {
      void actions!.readMail("105");
    });
    await act(async () => {
      await markPairingCompleted(1_700_000_100_000);
    });

    expect(openCalls[0].signal.aborted).toBe(true);
    expect(actions!.openMail).toEqual({ status: "idle" });
    expect(actions!.openedFor).toBeUndefined();
  });

  it("does not survive a conversation switch", async () => {
    const renderer = await mount("chat-1");
    await act(async () => {
      void actions!.readMail("105");
      await pending;
    });
    await act(async () => {
      await renderer.update(
        React.createElement(Probe, { conversationId: "chat-2", send: () => undefined }),
      );
    });

    expect(actions!.openMail).toEqual({ status: "idle" });
    expect(openCalls[0].signal.aborted).toBe(true);
  });
});