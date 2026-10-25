import { streamOpenAiChat, type RemoteFinish, type XhrLike } from "./openaiTransport";
import type { TurnSseEvent } from "./turnSse";

function fakeXhr(): XhrLike & { sent: string | undefined } {
  const xhr: XhrLike & { sent: string | undefined } = {
    readyState: 0,
    status: 0,
    responseText: "",
    timeout: 0,
    sent: undefined,
    open() {},
    setRequestHeader() {},
    send(body?: string) {
      xhr.sent = body;
    },
    abort() {},
    onreadystatechange: null,
    onprogress: null,
    onerror: null,
    ontimeout: null,
    onabort: null,
  };
  return xhr;
}

/** Deliver a response the way RN does: headers once, body in as many reads
 *  as the peer chose, and the load at the end of it. */
function begin(xhr: XhrLike, status: number) {
  xhr.readyState = 2;
  xhr.status = status;
  xhr.onreadystatechange?.call(xhr);
}

function push(xhr: XhrLike, chunk: string) {
  xhr.responseText += chunk;
  xhr.onprogress?.call(xhr);
}

function respond(xhr: XhrLike, status: number, chunks: string[]) {
  begin(xhr, status);
  for (const chunk of chunks) push(xhr, chunk);
  xhr.readyState = 4;
  xhr.onreadystatechange?.call(xhr);
}

/** RN fires the load before the transport's success is emitted: the finish
 *  lands one tick later, and a test that does not wait for it is testing the
 *  wrong moment. */
function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function startTurn(xhr: XhrLike, body: string) {
  const events: TurnSseEvent[] = [];
  const finishes: RemoteFinish[] = [];
  const handle = streamOpenAiChat(
    {
      dialect: "turn",
      completionsUrl: "http://127.0.0.1:8000/kalsa/chat/turn",
      body,
      requestId: "kalsa-turn-test",
      inactivityMs: 0,
    },
    {
      onDelta: () => undefined,
      onTurnEvent: (event) => events.push(event),
      onFinish: (finish) => finishes.push(finish),
    },
    () => xhr,
  );
  return { handle, events, finishes };
}

describe("the turn route over the chat transport", () => {
  afterEach(() => jest.restoreAllMocks());

  test("the body goes on the wire verbatim and the stream ends on done", async () => {
    jest.spyOn(console, "warn").mockImplementation(() => undefined);
    const xhr = fakeXhr();
    const body = JSON.stringify({ messages: [{ role: "user", content: "ciao" }] });
    const { handle, events, finishes } = startTurn(xhr, body);

    expect(xhr.sent).toBe(body);
    respond(xhr, 200, [
      'event: turn\ndata: {"turn":"t-1"}\n\n',
      'event: delta\ndata: {"text":"ciao "}\n\nevent: delta\ndata: {"text":"mondo"}\n\n',
      'event: tool_run\ndata: {"id":"1","name":"mail_list","state":"ok"}\n\n',
      'event: cards\ndata: {"kind":"cards","items":[{"id":"105"}],"bulk":0}\n\n',
      'event: draft\ndata: {"draft_id":"abc","to":"m@x.it"}\n\n',
      "event: done\ndata: {}\n\n",
    ]);

    // `done` is the transport's own terminal marker: it ends the stream and
    // reaches no handler.
    expect(events.map((event) => event.kind)).toEqual([
      "turn",
      "delta",
      "delta",
      "tool_run",
      "cards",
      "draft",
    ]);
    await tick();
    expect(finishes).toEqual([{ kind: "complete", finishReason: null }]);
    expect(handle.isClosed()).toBe(true);
  });

  test("a frame split across two reads is one frame, not two answers", async () => {
    const xhr = fakeXhr();
    const { events, finishes } = startTurn(xhr, "{}");
    begin(xhr, 200);
    push(xhr, 'event: delta\ndata: {"text":"cia');
    // Nothing yet: the frame has no terminator, so no word may have arrived.
    expect(events).toEqual([]);
    push(xhr, 'o"}\n\nevent: done\ndata: {}\n\n');
    xhr.readyState = 4;
    xhr.onreadystatechange?.call(xhr);
    expect(events).toEqual([{ kind: "delta", text: "ciao" }]);
    await tick();
    expect(finishes).toEqual([{ kind: "complete", finishReason: null }]);
  });

  test("an error frame ends the turn with the code, not a generic one", () => {
    jest.spyOn(console, "warn").mockImplementation(() => undefined);
    const xhr = fakeXhr();
    const { finishes } = startTurn(xhr, "{}");
    respond(xhr, 200, ['event: error\ndata: {"code":"no_runner"}\n\n']);
    expect(finishes[0]?.kind).toBe("error");
    expect(finishes[0]?.error?.message).toBe("no_runner");
  });

  test("a 404 before any byte is a refusal the engine can fall back from", () => {
    const xhr = fakeXhr();
    const { finishes } = startTurn(xhr, "{}");
    respond(xhr, 404, [""]);
    expect(finishes[0]?.kind).toBe("error");
    expect(finishes[0]?.error?.message).toBe("remote_brain_http_404");
  });
});