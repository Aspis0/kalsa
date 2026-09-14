import { streamOpenAiChat, type RemoteFinish, type XhrLike } from "./openaiTransport";

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

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function start(
  xhr: XhrLike,
  extra?: { signal?: AbortSignal; requestId?: string; inactivityMs?: number },
) {
  const deltas: string[] = [];
  const finishes: RemoteFinish[] = [];
  const handle = streamOpenAiChat(
    {
      baseUrl: "http://127.0.0.1:8000",
      model: "ornith",
      messages: [{ role: "user", content: "hi" }],
      maxTokens: 4096,
      temperature: 0.7,
      requestId: extra?.requestId ?? "kalsa-remote-test",
      signal: extra?.signal,
      inactivityMs: extra && "inactivityMs" in extra ? extra.inactivityMs : 0,
    },
    {
      onDelta: (d) => {
        if (d.content) deltas.push(d.content);
      },
      onFinish: (f) => {
        finishes.push(f);
      },
    },
    () => xhr,
  );
  return { handle, deltas, finishes };
}

describe("streamOpenAiChat", () => {
  test("sends stream:true and a client request id", () => {
    const xhr = fakeXhr();
    const { handle } = start(xhr);
    expect(handle.requestId).toBe("kalsa-remote-test");
    expect(xhr._headers["X-Request-Id"]).toBe("kalsa-remote-test");
    const body = JSON.parse(xhr._body ?? "{}");
    expect(body.stream).toBe(true);
    expect(body.max_tokens).toBe(4096);
  });

  test("complete only after onload AND [DONE]", async () => {
    const xhr = fakeXhr();
    const { deltas, finishes } = start(xhr);
    xhr.responseText =
      'data: {"choices":[{"delta":{"content":"p"}}]}\n\n' +
      'data: {"choices":[{"delta":{"content":"ong"}}]}\n\n' +
      "data: [DONE]\n\n";
    xhr.readyState = 3;
    xhr.status = 200;
    xhr.onprogress?.call(xhr);
    expect(deltas.join("")).toBe("pong");
    expect(finishes).toHaveLength(0);
    xhr.readyState = 4;
    xhr.onreadystatechange?.call(xhr);
    expect(finishes).toHaveLength(0);
    await flush();
    expect(finishes[0]?.kind).toBe("complete");
  });

  test("DONE-before-error: onerror wins over scheduled success", async () => {
    const xhr = fakeXhr();
    const { finishes } = start(xhr);
    xhr.responseText = "data: [DONE]\n\n";
    xhr.readyState = 4;
    xhr.status = 200;
    xhr.onreadystatechange?.call(xhr);
    xhr.onerror?.call(xhr);
    await flush();
    expect(finishes).toHaveLength(1);
    expect(finishes[0]?.kind).toBe("error");
    expect(finishes[0]?.error?.message).toBe("remote_brain_network");
  });

  test("EOF without [DONE] is interrupted, partial kept", async () => {
    const xhr = fakeXhr();
    const { deltas, finishes } = start(xhr);
    xhr.responseText = 'data: {"choices":[{"delta":{"content":"hi"}}]}\n\n';
    xhr.readyState = 4;
    xhr.status = 200;
    xhr.onreadystatechange?.call(xhr);
    await flush();
    expect(deltas.join("")).toBe("hi");
    expect(finishes[0]?.kind).toBe("interrupted");
  });

  test("finish_reason content_filter is truncated", async () => {
    const xhr = fakeXhr();
    const { finishes } = start(xhr);
    xhr.responseText =
      'data: {"choices":[{"delta":{"content":"x"},"finish_reason":"content_filter"}]}\n\n';
    xhr.readyState = 4;
    xhr.status = 200;
    xhr.onreadystatechange?.call(xhr);
    await flush();
    expect(finishes[0]?.kind).toBe("truncated");
    expect(finishes[0]?.finishReason).toBe("content_filter");
  });

  test("finish_reason length is truncated", async () => {
    const xhr = fakeXhr();
    const { finishes } = start(xhr);
    xhr.responseText =
      'data: {"choices":[{"delta":{"content":"ab"},"finish_reason":"length"}]}\n\n';
    xhr.readyState = 4;
    xhr.status = 200;
    xhr.onreadystatechange?.call(xhr);
    await flush();
    expect(finishes[0]?.kind).toBe("truncated");
    expect(finishes[0]?.finishReason).toBe("length");
  });

  test("length+[DONE]: explicit finish_reason wins over synthetic [DONE]", async () => {
    const xhr = fakeXhr();
    const { finishes } = start(xhr);
    xhr.responseText =
      'data: {"choices":[{"delta":{"content":"ab"},"finish_reason":"length"}]}\n\n' +
      "data: [DONE]\n\n";
    xhr.readyState = 4;
    xhr.status = 200;
    xhr.onreadystatechange?.call(xhr);
    await flush();
    expect(finishes[0]?.kind).toBe("truncated");
    expect(finishes[0]?.finishReason).toBe("length");
  });

  test("content_filter+[DONE]: explicit finish_reason wins", async () => {
    const xhr = fakeXhr();
    const { finishes } = start(xhr);
    xhr.responseText =
      'data: {"choices":[{"delta":{"content":"x"},"finish_reason":"content_filter"}]}\n\n' +
      "data: [DONE]\n\n";
    xhr.readyState = 4;
    xhr.status = 200;
    xhr.onreadystatechange?.call(xhr);
    await flush();
    expect(finishes[0]?.kind).toBe("truncated");
    expect(finishes[0]?.finishReason).toBe("content_filter");
  });

  test("stop+[DONE] is complete", async () => {
    const xhr = fakeXhr();
    const { finishes } = start(xhr);
    xhr.responseText =
      'data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\n' +
      "data: [DONE]\n\n";
    xhr.readyState = 4;
    xhr.status = 200;
    xhr.onreadystatechange?.call(xhr);
    await flush();
    expect(finishes[0]?.kind).toBe("complete");
    expect(finishes[0]?.finishReason).toBe("stop");
  });

  test("[DONE]-only is complete with no finish_reason", async () => {
    const xhr = fakeXhr();
    const { finishes } = start(xhr);
    xhr.responseText = "data: [DONE]\n\n";
    xhr.readyState = 4;
    xhr.status = 200;
    xhr.onreadystatechange?.call(xhr);
    await flush();
    expect(finishes[0]?.kind).toBe("complete");
    expect(finishes[0]?.finishReason).toBeNull();
  });

  test("reason-without-DONE is still terminal", async () => {
    const xhr = fakeXhr();
    const { finishes } = start(xhr);
    xhr.responseText =
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n';
    xhr.readyState = 4;
    xhr.status = 200;
    xhr.onreadystatechange?.call(xhr);
    await flush();
    expect(finishes[0]?.kind).toBe("complete");
    expect(finishes[0]?.finishReason).toBe("stop");
  });

  test("status 0 is failure", async () => {
    const xhr = fakeXhr();
    const { finishes } = start(xhr);
    xhr.responseText = "data: [DONE]\n\n";
    xhr.readyState = 4;
    xhr.status = 0;
    xhr.onreadystatechange?.call(xhr);
    await flush();
    expect(finishes[0]?.kind).toBe("error");
    expect(finishes[0]?.error?.message).toBe("remote_brain_http_0");
  });

  test("HTTP 500 is error", async () => {
    const xhr = fakeXhr();
    const { finishes } = start(xhr);
    xhr.readyState = 2;
    xhr.status = 500;
    xhr.onreadystatechange?.call(xhr);
    expect(finishes[0]?.kind).toBe("error");
    expect(finishes[0]?.error?.message).toBe("remote_brain_http_500");
  });

  test("HTTP 3xx with [DONE] is error, not complete", async () => {
    const xhr = fakeXhr();
    const { finishes } = start(xhr);
    xhr.responseText =
      'data: {"choices":[{"delta":{"content":"nope"}}]}\n\n' +
      "data: [DONE]\n\n";
    xhr.readyState = 4;
    xhr.status = 302;
    xhr.onreadystatechange?.call(xhr);
    await flush();
    expect(finishes[0]?.kind).toBe("error");
    expect(finishes[0]?.error?.message).toBe("remote_brain_http_302");
  });

  test("error-event frame on HTTP 200 is error", async () => {
    const xhr = fakeXhr();
    const { finishes } = start(xhr);
    xhr.responseText = 'event: error\ndata: {"error":{"message":"nope"}}\n\n';
    xhr.readyState = 3;
    xhr.status = 200;
    xhr.onprogress?.call(xhr);
    expect(finishes[0]?.kind).toBe("error");
    expect(finishes[0]?.error?.message).toBe("nope");
  });

  test("malformed JSON frame is error", async () => {
    const xhr = fakeXhr();
    const { finishes } = start(xhr);
    xhr.responseText = "data: {not json}\n\n";
    xhr.readyState = 3;
    xhr.status = 200;
    xhr.onprogress?.call(xhr);
    expect(finishes[0]?.kind).toBe("error");
  });

  test("partial JSON across progress events then completes", async () => {
    const xhr = fakeXhr();
    const { deltas, finishes } = start(xhr);
    xhr.status = 200;
    xhr.readyState = 3;
    xhr.responseText = 'data: {"choices":[{"delta":{"content":"he';
    xhr.onprogress?.call(xhr);
    expect(deltas).toEqual([]);
    xhr.responseText =
      xhr.responseText + 'llo"}}]}\n\ndata: [DONE]\n\n';
    xhr.onprogress?.call(xhr);
    expect(deltas.join("")).toBe("hello");
    xhr.readyState = 4;
    xhr.onreadystatechange?.call(xhr);
    await flush();
    expect(finishes[0]?.kind).toBe("complete");
  });

  test("reentrant abort in onDelta does not deliver later frames", async () => {
    const xhr = fakeXhr();
    const deltas: string[] = [];
    const finishes: RemoteFinish[] = [];
    let abortFn: () => void = () => undefined;
    const handle = streamOpenAiChat(
      {
        completionsUrl: "http://127.0.0.1:8000/v1/chat/completions",
        model: "ornith",
        messages: [{ role: "user", content: "hi" }],
        maxTokens: 8,
        temperature: 0,
        requestId: "reenter",
        inactivityMs: 0,
      },
      {
        onDelta: (d) => {
          if (d.content) deltas.push(d.content);
          if (d.content === "one") abortFn();
        },
        onFinish: (f) => {
          finishes.push(f);
        },
      },
      () => xhr,
    );
    abortFn = handle.abort;
    xhr.status = 200;
    xhr.readyState = 3;
    xhr.responseText =
      'data: {"choices":[{"delta":{"content":"one"}}]}\n\n' +
      'data: {"choices":[{"delta":{"content":"two"}}]}\n\n' +
      "data: [DONE]\n\n";
    xhr.onprogress?.call(xhr);
    expect(deltas).toEqual(["one"]);
    expect(finishes[0]?.kind).toBe("interrupted");
  });

  test("abort mid-frame flushes complete frames only", async () => {
    const xhr = fakeXhr();
    const { handle, deltas, finishes } = start(xhr);
    xhr.status = 200;
    xhr.readyState = 3;
    xhr.responseText =
      'data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: {"choices":[{"delta":{"content":"xx';
    xhr.onprogress?.call(xhr);
    expect(deltas.join("")).toBe("ok");
    handle.abort();
    expect(finishes[0]?.kind).toBe("interrupted");
    expect(deltas.join("")).toBe("ok");
  });

  test("network error", () => {
    const xhr = fakeXhr();
    const { finishes } = start(xhr);
    xhr.onerror?.call(xhr);
    expect(finishes[0]?.kind).toBe("error");
    expect(finishes[0]?.error?.message).toBe("remote_brain_network");
  });

  test("abort-before-send never opens a request", () => {
    const xhr = fakeXhr();
    const controller = new AbortController();
    controller.abort();
    const { finishes } = start(xhr, { signal: controller.signal });
    expect(finishes[0]?.kind).toBe("interrupted");
    expect(xhr._body).toBeUndefined();
  });

  test("inactivity timeout fires without progress", async () => {
    jest.useFakeTimers();
    try {
      const xhr = fakeXhr();
      const { finishes } = start(xhr, { inactivityMs: 120_000 });
      expect(finishes).toHaveLength(0);
      jest.advanceTimersByTime(120_000);
      expect(finishes[0]?.kind).toBe("error");
      expect(finishes[0]?.error?.message).toBe("remote_brain_timeout");
    } finally {
      jest.useRealTimers();
    }
  });

  test("setup/send throw emits terminal error and cleans idle timer", async () => {
    jest.useFakeTimers();
    try {
      const xhr = fakeXhr();
      xhr.send = () => {
        throw new Error("send_boom");
      };
      const { finishes } = start(xhr, { inactivityMs: 120_000 });
      expect(finishes).toHaveLength(1);
      expect(finishes[0]?.kind).toBe("error");
      expect(finishes[0]?.error?.message).toBe("send_boom");
      jest.advanceTimersByTime(120_000);
      expect(finishes).toHaveLength(1);
    } finally {
      jest.useRealTimers();
    }
  });

  test("progress resets idle timer and complete cleans it", async () => {
    jest.useFakeTimers();
    try {
      const xhr = fakeXhr();
      const { finishes } = start(xhr, { inactivityMs: 120_000 });
      jest.advanceTimersByTime(60_000);
      xhr.status = 200;
      xhr.readyState = 3;
      xhr.responseText = 'data: {"choices":[{"delta":{"content":"hi"}}]}\n\n';
      xhr.onprogress?.call(xhr);
      jest.advanceTimersByTime(60_000);
      expect(finishes).toHaveLength(0);
      xhr.responseText += "data: [DONE]\n\n";
      xhr.readyState = 4;
      xhr.onreadystatechange?.call(xhr);
      jest.runOnlyPendingTimers();
      expect(finishes).toHaveLength(1);
      expect(finishes[0]?.kind).toBe("complete");
      jest.advanceTimersByTime(120_000);
      expect(finishes).toHaveLength(1);
    } finally {
      jest.useRealTimers();
    }
  });
});
