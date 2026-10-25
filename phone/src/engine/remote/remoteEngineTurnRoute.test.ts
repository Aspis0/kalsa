/**
 * The turn route end to end through RemoteEngine on the iroh road: what the
 * phone sends on `/kalsa/chat/turn`, what it does with a computer that refuses
 * that route, and what a turn's frames reach the host as.
 */

jest.mock("@react-native-async-storage/async-storage", () => {
  const store: Record<string, string> = {};
  return {
    getItem: async (key: string) => store[key] ?? null,
    setItem: async (key: string, value: string) => {
      store[key] = value;
    },
    __reset: () => {
      for (const key of Object.keys(store)) delete store[key];
    },
  };
});
jest.mock("./remoteSecret", () => ({ getRemoteBrainToken: jest.fn(async () => null) }));
jest.mock("../../pairing/pairingCredentialStore", () => ({ getPairingCredential: jest.fn() }));
jest.mock("../../remote/irohBridge", () => ({
  irohModulePresent: jest.fn(() => true),
  openIrohTunnel: jest.fn(),
}));
jest.mock("./remoteImageBytes", () => ({
  readRemotePictures: jest.fn(async () => new Map()),
  storedPictureSizes: jest.fn(async () => new Map()),
}));

import { disposeRemoteEngine, initRemoteEngine, streamRemoteAssistantTurn } from "./RemoteEngine";
import { openIrohTunnel } from "../../remote/irohBridge";
import { getPairingCredential } from "../../pairing/pairingCredentialStore";
import { setRemoteServerModelId } from "./remoteSettings";
import { forgetTurnRouteVerdict } from "./turnRoute";
import type { IrohTunnel } from "../../remote/irohHttp";
import type { EngineCallbacks } from "../LlamaService";

const NODE = "ab".repeat(32);
const CREDENTIAL = "cd".repeat(32);
const DOOR_URL = "https://desktop.tailnet.ts.net:9443";

function ascii(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length);
  for (let i = 0; i < value.length; i++) bytes[i] = value.charCodeAt(i) & 0xff;
  return bytes;
}

function text(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += String.fromCharCode(byte);
  return out;
}

function jsonResponse(body: string): Uint8Array {
  return ascii(`HTTP/1.1 200 OK\r\nContent-Length: ${body.length}\r\n\r\n${body}`);
}

function sseResponse(frames: string[]): Uint8Array {
  const head = "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nTransfer-Encoding: chunked\r\n\r\n";
  const body = frames.map((frame) => `${frame.length.toString(16)}\r\n${frame}\r\n`).join("");
  return ascii(`${head}${body}0\r\n\r\n`);
}

function notFound(): Uint8Array {
  return ascii("HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n");
}

/** One canned response per read; an exhausted queue is EOF. */
class FakeTunnel implements IrohTunnel {
  readonly writes: Uint8Array[] = [];
  shutdowns = 0;

  constructor(private readonly reads: Uint8Array[]) {}

  async write(bytes: Uint8Array): Promise<void> {
    this.writes.push(bytes);
  }

  async read(max: number): Promise<Uint8Array> {
    if (this.reads.length === 0) return new Uint8Array(0);
    const next = this.reads.shift() as Uint8Array;
    if (next.length <= max) return next;
    this.reads.unshift(next.subarray(max));
    return next.subarray(0, max);
  }

  async shutdown(): Promise<void> {
    this.shutdowns++;
  }
}

type TurnCapture = {
  deltas: string[];
  tools: unknown[];
  cards: unknown[];
  drafts: unknown[];
  done: boolean;
  failure: Error | null;
};

function captureTurn(): { callbacks: EngineCallbacks; seen: TurnCapture } {
  const seen: TurnCapture = {
    deltas: [],
    tools: [],
    cards: [],
    drafts: [],
    done: false,
    failure: null,
  };
  return {
    seen,
    callbacks: {
      onDelta: (chunk) => seen.deltas.push(chunk),
      onTool: (tool) => seen.tools.push(tool),
      onMailCards: (cards) => seen.cards.push(cards),
      onMailDraft: (draft) => seen.drafts.push(draft),
      onDone: () => {
        seen.done = true;
      },
      onError: (error) => {
        seen.failure = error;
      },
    },
  };
}

describe("the turn route through RemoteEngine", () => {
  beforeEach(async () => {
    const asyncStorage = jest.requireMock("@react-native-async-storage/async-storage") as {
      __reset: () => void;
    };
    asyncStorage.__reset();
    forgetTurnRouteVerdict();
    (globalThis as { fetch?: typeof fetch }).fetch = jest.fn() as unknown as typeof fetch;
    (getPairingCredential as jest.Mock).mockResolvedValue({
      doorUrl: DOOR_URL,
      credential: CREDENTIAL,
      node: NODE,
      pairedVia: "iroh",
    });
    (openIrohTunnel as jest.Mock).mockReset();
    await setRemoteServerModelId("ornith");
    jest.spyOn(console, "log").mockImplementation(() => undefined);
  });

  afterEach(async () => {
    await disposeRemoteEngine();
    jest.restoreAllMocks();
  });

  /** The probe's two GETs, then whatever the turn asked for. */
  async function withDoorTunnels(turns: FakeTunnel[]): Promise<void> {
    (openIrohTunnel as jest.Mock)
      .mockResolvedValueOnce(new FakeTunnel([jsonResponse("{}")]))
      .mockResolvedValueOnce(new FakeTunnel([jsonResponse('{"data":[{"id":"ornith"}]}')]));
    for (const tunnel of turns) {
      (openIrohTunnel as jest.Mock).mockResolvedValueOnce(tunnel);
    }
    await initRemoteEngine("", "kalsa-remote-mail", { locale: "it" });
  }

  test("a text-only turn rides the turn route, and its frames reach the host", async () => {
    const turn = new FakeTunnel([
      sseResponse([
        'event: turn\ndata: {"turn":"t-1"}\n\n',
        'event: reasoning\ndata: {"text":"cerco"}\n\n',
        'event: delta\ndata: {"text":"hai "}\n\n',
        'event: tool_run\ndata: {"id":"1","name":"mail_list","state":"ok"}\n\n',
        'event: cards\ndata: {"kind":"cards","items":[{"id":"105"}],"bulk":1}\n\n',
        'event: draft\ndata: {"draft_id":"abc","to":"m@x.it"}\n\n',
        'event: delta\ndata: {"text":"2 mail"}\n\n',
        "event: done\ndata: {}\n\n",
      ]),
    ]);
    await withDoorTunnels([turn]);
    const { callbacks, seen } = captureTurn();

    await streamRemoteAssistantTurn(
      [{ role: "user", content: "quali mail ho?" }],
      callbacks,
      undefined,
      { locale: "it", turnId: "t-turn" },
    );

    expect(seen.failure).toBeNull();
    expect(seen.done).toBe(true);
    expect(seen.deltas.join("")).toBe("hai 2 mail");
    expect(seen.tools).toEqual([{ name: "mail_list" }]);
    expect(seen.cards).toHaveLength(1);
    expect(seen.drafts).toHaveLength(1);
    expect(text(turn.writes[0])).toContain("POST /kalsa/chat/turn HTTP/1.1\r\n");
    // The wire carries the conversation, the phone's language and what this
    // phone can draw, and no system prompt: the computer brings its own.
    const body = text(turn.writes[0]).split("\r\n\r\n")[1] ?? "";
    expect(JSON.parse(body)).toEqual({
      messages: [{ role: "user", content: "quali mail ho?" }],
      language: "it",
      capabilities: ["browser_card"],
    });
  });

  test("a turn that answers for a mail pins itself to that mail", async () => {
    const turn = new FakeTunnel([sseResponse(["event: done\ndata: {}\n\n"])]);
    await withDoorTunnels([turn]);
    const { callbacks } = captureTurn();

    await streamRemoteAssistantTurn(
      [{ role: "user", content: "Scrivi una risposta a questa mail." }],
      callbacks,
      undefined,
      { locale: "it", turnId: "t-reply", mailReplyFor: "105" },
    );

    const body = text(turn.writes[0]).split("\r\n\r\n")[1] ?? "";
    expect(JSON.parse(body).reply_for).toBe("105");
  });

  test("a computer that does not know the route answers the turn the old way", async () => {
    const refused = new FakeTunnel([notFound()]);
    const oldWay = new FakeTunnel([
      sseResponse([
        'data: {"choices":[{"delta":{"content":"ciao"}}]}\n\n',
        'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
        "data: [DONE]\n\n",
      ]),
    ]);
    await withDoorTunnels([refused, oldWay]);
    const { callbacks, seen } = captureTurn();

    await streamRemoteAssistantTurn(
      [{ role: "user", content: "ciao" }],
      callbacks,
      undefined,
      { locale: "it", turnId: "t-fallback" },
    );

    // The refusal is not a failure a person ever sees: the turn is answered.
    expect(seen.failure).toBeNull();
    expect(seen.done).toBe(true);
    expect(seen.deltas.join("")).toBe("ciao");
    expect(text(refused.writes[0])).toContain("POST /kalsa/chat/turn HTTP/1.1\r\n");
    // The retry rode its own tunnel: the refusal carried only the turn route.
    expect(text(oldWay.writes[0])).toContain("POST /v1/chat/completions HTTP/1.1\r\n");
    expect(refused.writes).toHaveLength(1);
  });

  test("the refusal is remembered: the next turn asks once, the old way", async () => {
    await withDoorTunnels([
      new FakeTunnel([notFound()]),
      new FakeTunnel([
        sseResponse([
          'data: {"choices":[{"delta":{"content":"uno"}}]}\n\n',
          'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
          "data: [DONE]\n\n",
        ]),
      ]),
    ]);
    const first = captureTurn();
    await streamRemoteAssistantTurn(
      [{ role: "user", content: "uno" }],
      first.callbacks,
      undefined,
      { locale: "it", turnId: "t-1" },
    );
    const second = new FakeTunnel([
      sseResponse([
        'data: {"choices":[{"delta":{"content":"due"}}]}\n\n',
        'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
        "data: [DONE]\n\n",
      ]),
    ]);
    (openIrohTunnel as jest.Mock).mockResolvedValueOnce(second);
    const next = captureTurn();
    await streamRemoteAssistantTurn(
      [{ role: "user", content: "due" }],
      next.callbacks,
      undefined,
      { locale: "it", turnId: "t-2" },
    );

    expect(next.seen.failure).toBeNull();
    expect(next.seen.deltas.join("")).toBe("due");
    expect(text(second.writes[0])).toContain("POST /v1/chat/completions HTTP/1.1\r\n");
  });

  test("a turn with pictures never asks a route that cannot take them", async () => {
    const imageBytes = jest.requireMock("./remoteImageBytes") as {
      readRemotePictures: jest.Mock;
      storedPictureSizes: jest.Mock;
    };
    imageBytes.storedPictureSizes.mockImplementation(async (uris: readonly string[]) => {
      return new Map(uris.map((uri) => [uri, 1024]));
    });
    imageBytes.readRemotePictures.mockImplementation(async (uris: readonly string[]) => {
      const map = new Map<string, { uri: string; bytes: number; dataUri: string }>();
      uris.forEach((uri) => {
        map.set(uri, { uri, bytes: 3, dataUri: "data:image/jpeg;base64,AAAA" });
      });
      return map;
    });
    // The turn establishes its own tunnel first, and the vision probe then
    // opens a second one rather than stealing it: a picture turn asks /props
    // whether the desk can see, and never asks the turn route.
    const probe = new FakeTunnel([jsonResponse('{"modalities":{"vision":true}}')]);
    const turn = new FakeTunnel([
      sseResponse([
        'data: {"choices":[{"delta":{"content":"foto"}}]}\n\n',
        'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
        "data: [DONE]\n\n",
      ]),
    ]);
    await withDoorTunnels([turn, probe]);
    const { callbacks, seen } = captureTurn();

    await streamRemoteAssistantTurn(
      [{ role: "user", content: "questa foto", images: ["file:///a.png"] }],
      callbacks,
      undefined,
      { locale: "it", turnId: "t-pic" },
    );

    expect(seen.failure).toBeNull();
    expect(seen.deltas.join("")).toBe("foto");
    expect(text(turn.writes[0])).toContain("POST /v1/chat/completions HTTP/1.1\r\n");
  });
});