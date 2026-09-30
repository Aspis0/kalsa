/**
 * The controllable XhrLike the room-stream tests drive — test-only, and
 * never imported by the app. A test plays the door by hand through the
 * same callbacks RN's XHR fires: head (status + headers), body chunks,
 * refusal, cut.
 */
import type { XhrLike } from "../engine/remote/openaiTransport";

const HEADERS_RECEIVED = 2;
const LOADING = 3;
const DONE = 4;

export class FakeRoomXhr implements XhrLike {
  static instances: FakeRoomXhr[] = [];
  static reset(): void {
    FakeRoomXhr.instances = [];
  }
  static latest(): FakeRoomXhr {
    const xhr = FakeRoomXhr.instances[FakeRoomXhr.instances.length - 1];
    if (xhr === undefined) throw new Error("no fake xhr opened");
    return xhr;
  }

  readyState = 0;
  status = 0;
  responseText = "";
  timeout = 0;
  method = "";
  url = "";
  readonly requestHeaders: Record<string, string> = {};
  responseHeaders: Record<string, string> = {};
  sent = false;
  aborted = false;
  onreadystatechange: ((this: XhrLike) => void) | null = null;
  onprogress: ((this: XhrLike) => void) | null = null;
  onerror: ((this: XhrLike) => void) | null = null;
  ontimeout: ((this: XhrLike) => void) | null = null;
  onabort: ((this: XhrLike) => void) | null = null;

  constructor() {
    FakeRoomXhr.instances.push(this);
  }

  open(method: string, url: string): void {
    this.method = method;
    this.url = url;
  }

  setRequestHeader(name: string, value: string): void {
    this.requestHeaders[name] = value;
  }

  send(): void {
    this.sent = true;
  }

  abort(): void {
    this.aborted = true;
    this.onabort?.();
  }

  getResponseHeader(name: string): string | null {
    return this.responseHeaders[name.toLowerCase()] ?? null;
  }

  /** The response head: status, headers (names lowercased like the road does). */
  head(status: number, headers: Record<string, string> = {}): void {
    this.status = status;
    this.readyState = HEADERS_RECEIVED;
    this.responseHeaders = Object.fromEntries(
      Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]),
    );
    this.onreadystatechange?.();
  }

  /** Body bytes as they arrive. */
  chunk(text: string): void {
    this.responseText += text;
    this.readyState = LOADING;
    this.onprogress?.();
    this.onreadystatechange?.();
  }

  /** The body ends (a cut stream, or the end of a refusal's body). */
  end(): void {
    this.readyState = DONE;
    this.onreadystatechange?.();
  }

  /** The transport itself failed. */
  fail(): void {
    this.onerror?.();
  }
}

/** Point the global XHR the HTTPS road uses at the fake; call in beforeEach. */
export function installFakeRoomXhr(): void {
  FakeRoomXhr.reset();
  (globalThis as { XMLHttpRequest?: unknown }).XMLHttpRequest = FakeRoomXhr;
}
