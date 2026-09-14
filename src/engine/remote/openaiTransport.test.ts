import { streamOpenAiChat, type XhrLike } from "./openaiTransport";

function fakeXhr(): XhrLike & { _body?: string; _headers: Record<string, string> } {
  const xhr = {
    readyState: 0,
    status: 0,
    responseText: "",
    timeout: 0,
    _headers: {} as Record<string, string>,
    _body: undefined as string | undefined,
    open() {},
    setRequestHeader(name: string, value: string) {
      this._headers[name] = value;
    },
    send(body?: string) {
      this._body = body;
    },
    abort() {},
    onreadystatechange: null as XhrLike["onreadystatechange"],
    onprogress: null as XhrLike["onprogress"],
    onerror: null as XhrLike["onerror"],
    ontimeout: null as XhrLike["ontimeout"],
    onabort: null as XhrLike["onabort"],
  };
  return xhr;
}

describe("streamOpenAiChat", () => {
  test("sends stream:true, a client request id, and does not reconnect on abort", () => {
    const xhr = fakeXhr();
    const deltas: string[] = [];
    let done = 0;
    let errors = 0;
    const handle = streamOpenAiChat(
      {
        baseUrl: "http://127.0.0.1:8000",
        model: "ornith",
        messages: [{ role: "user", content: "hi" }],
        maxTokens: 4096,
        temperature: 0.7,
        requestId: "kalsa-remote-test",
      },
      {
        onDelta: (d) => {
          if (d.content) deltas.push(d.content);
        },
        onError: () => {
          errors += 1;
        },
        onDone: () => {
          done += 1;
        },
      },
      () => xhr,
    );
    expect(handle.requestId).toBe("kalsa-remote-test");
    expect(xhr._headers["X-Request-Id"]).toBe("kalsa-remote-test");
    const body = JSON.parse(xhr._body ?? "{}");
    expect(body.stream).toBe(true);
    expect(body.max_tokens).toBe(4096);

    xhr.responseText =
      'data: {"choices":[{"delta":{"content":"p"}}]}\n\n' +
      'data: {"choices":[{"delta":{"content":"ong"}}]}\n\n' +
      "data: [DONE]\n\n";
    xhr.readyState = 3;
    xhr.status = 200;
    xhr.onprogress?.call(xhr);
    expect(deltas.join("")).toBe("pong");
    expect(done).toBe(1);

    xhr.readyState = 4;
    xhr.onreadystatechange?.call(xhr);
    expect(done).toBe(1);
    expect(errors).toBe(0);

    handle.abort();
    expect(done).toBe(1);
  });
});
