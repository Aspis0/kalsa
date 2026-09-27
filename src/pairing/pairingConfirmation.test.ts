/**
 * The confirmation poll with a fake desk: which /props answers mean
 * allowed, pending, retry or nothing at all; how long the loop waits;
 * and that the probe rides the paired door's road exactly once.
 */

jest.mock("../remote/doorRoad", () => ({
  establishDoorRoad: jest.fn(),
  doorFetchFor: jest.fn(),
}));

import { establishDoorRoad, doorFetchFor } from "../remote/doorRoad";
import type { SavedPairingCredential } from "./pairingCredentialStore";
import {
  confirmationVerdict,
  pairedPropsProbe,
  pollForAllowance,
  type ConfirmationOptions,
  type ConfirmationPhase,
  type ConfirmationResponse,
} from "./pairingConfirmation";

const PAIRED: SavedPairingCredential = {
  credential: "ab".repeat(32),
  doorUrl: "https://desktop.tailnet.ts.net:9443",
  node: "cd".repeat(32),
  pairedVia: "iroh",
};

describe("the desk's verdict in one /props response", () => {
  test("401 is no verdict yet — refused and revoked are also 401", () => {
    expect(confirmationVerdict({ status: 401, bodyEmpty: false })).toBe("pending");
  });

  test("403 with an empty body is the transport asking to try again", () => {
    expect(confirmationVerdict({ status: 403, bodyEmpty: true })).toBe("retry");
  });

  test("403 with a body is allowed — the contract's any-other-status rule", () => {
    expect(confirmationVerdict({ status: 403, bodyEmpty: false })).toBe("allowed");
  });

  test("every other status means allowed — a 200 and an asleep engine's 503 alike", () => {
    expect(confirmationVerdict({ status: 200, bodyEmpty: false })).toBe("allowed");
    expect(confirmationVerdict({ status: 503, bodyEmpty: false })).toBe("allowed");
  });
});

/** The fake desk: each call shifts one answer, the last one repeats. */
function fakeDoor(sequence: Array<ConfirmationResponse | "network">) {
  let index = 0;
  return jest.fn(async () => {
    const next = sequence[Math.min(index, sequence.length - 1)];
    index += 1;
    if (next === "network") throw new Error("connection refused");
    return next;
  });
}

function poll(
  probe: ConfirmationOptions["probe"],
  overrides: Partial<ConfirmationOptions> = {},
): { outcome: Promise<ConfirmationOutcomeResult>; phases: ConfirmationPhase[] } {
  const phases: ConfirmationPhase[] = [];
  const outcome = pollForAllowance({
    probe,
    intervalMs: 1,
    capMs: 60_000,
    unreachableAfter: 3,
    onPhase: (phase) => phases.push(phase),
    ...overrides,
  });
  return { outcome, phases };
}

type ConfirmationOutcomeResult = Awaited<ReturnType<typeof pollForAllowance>>;

const OK_200: ConfirmationResponse = { status: 200, bodyEmpty: false };

describe("polling the paired door until the owner answers", () => {
  test("401, 401, 200 — two refusals then the allow", async () => {
    const door = fakeDoor([{ status: 401, bodyEmpty: false }, { status: 401, bodyEmpty: false }, OK_200]);
    const { outcome, phases } = poll(door);

    expect(await outcome).toEqual({ result: "paired" });
    expect(door).toHaveBeenCalledTimes(3);
    expect(phases[0]).toEqual({ phase: "waiting" });
  });

  test("401, 503 — an asleep engine still proves the owner allowed", async () => {
    const door = fakeDoor([{ status: 401, bodyEmpty: false }, { status: 503, bodyEmpty: false }]);
    const { outcome } = poll(door);

    expect(await outcome).toEqual({ result: "paired" });
    expect(door).toHaveBeenCalledTimes(2);
  });

  test("403-empty, 200 — a busy listener is retried, not judged", async () => {
    const door = fakeDoor([{ status: 403, bodyEmpty: true }, OK_200]);
    const { outcome, phases } = poll(door);

    expect(await outcome).toEqual({ result: "paired" });
    expect(phases.every((phase) => phase.phase === "waiting")).toBe(true);
  });

  test("403 with a body pairs at once — only 401 waits, only 403-empty retries", async () => {
    const door = fakeDoor([{ status: 403, bodyEmpty: false }]);
    const { outcome } = poll(door);

    expect(await outcome).toEqual({ result: "paired" });
    expect(door).toHaveBeenCalledTimes(1);
  });

  test("401 until the cap ends as not confirmed, the waiting phase all along", async () => {
    const door = fakeDoor([{ status: 401, bodyEmpty: false }]);
    const { outcome, phases } = poll(door, { capMs: 15 });

    expect(await outcome).toEqual({ result: "not_confirmed" });
    expect(door.mock.calls.length).toBeGreaterThan(1);
    expect(phases.every((phase) => phase.phase === "waiting")).toBe(true);
  });

  test("three straight transport failures show the unreachable phase and a later answer clears it", async () => {
    const door = fakeDoor(["network", "network", "network", { status: 401, bodyEmpty: false }, OK_200]);
    const { outcome, phases } = poll(door);

    expect(await outcome).toEqual({ result: "paired" });
    expect(phases.map((phase) => phase.phase)).toEqual(["waiting", "unreachable", "waiting"]);
  });

  test("an aborted signal ends the poll without another probe", async () => {
    const controller = new AbortController();
    const door = jest.fn(async () => {
      controller.abort();
      return { status: 401, bodyEmpty: false } satisfies ConfirmationResponse;
    });
    const { outcome, phases } = poll(door, { signal: controller.signal });

    expect(await outcome).toEqual({ result: "aborted" });
    expect(door).toHaveBeenCalledTimes(1);
    expect(phases).toEqual([{ phase: "waiting" }]);
  });
});

describe("the probe rides the paired door's road once", () => {
  const establishMock = establishDoorRoad as jest.MockedFunction<typeof establishDoorRoad>;
  const fetchForMock = doorFetchFor as jest.MockedFunction<typeof doorFetchFor>;

  beforeEach(() => {
    establishMock.mockReset();
    fetchForMock.mockReset();
  });

  test("one GET /props with the bearer, road established once for every tick", async () => {
    const isBodyEmpty = jest.fn(async () => false);
    const fetcher = jest.fn(async () => ({
      ok: true,
      status: 200,
      isBodyEmpty,
      json: async () => ({}),
    }));
    establishMock.mockResolvedValue({ road: "https" });
    fetchForMock.mockReturnValue(fetcher);
    const controller = new AbortController();
    const probe = pairedPropsProbe(PAIRED, controller.signal);

    const first = await probe();
    const second = await probe();

    expect(first).toEqual({ status: 200, bodyEmpty: false });
    expect(second.status).toBe(200);
    expect(establishMock).toHaveBeenCalledTimes(1);
    expect(establishMock).toHaveBeenCalledWith(PAIRED, controller.signal);
    expect(fetcher).toHaveBeenCalledTimes(2);
    const [url, init] = fetcher.mock.calls[0] as unknown as [
      string,
      { headers: Record<string, string> },
    ];
    expect(url).toBe("https://desktop.tailnet.ts.net:9443/props");
    expect(init.headers.Authorization).toBe(`Bearer ${PAIRED.credential}`);
    // A 200 body is never read: only the 403 case needs emptiness.
    expect(isBodyEmpty).not.toHaveBeenCalled();
  });

  test("a 403 reads the body exactly once, to tell busy from unattributable", async () => {
    const isBodyEmpty = jest.fn(async () => false);
    const fetcher = jest.fn(async () => ({
      ok: false,
      status: 403,
      isBodyEmpty,
      json: async () => ({}),
    }));
    establishMock.mockResolvedValue({ road: "https" });
    fetchForMock.mockReturnValue(fetcher);
    const probe = pairedPropsProbe(PAIRED);

    await expect(probe()).resolves.toEqual({ status: 403, bodyEmpty: false });
    expect(isBodyEmpty).toHaveBeenCalledTimes(1);
  });

  test("a road that refuses to establish makes the tick unreachable and is retried next tick", async () => {
    establishMock.mockRejectedValueOnce(new Error("dial refused")).mockResolvedValueOnce({ road: "https" });
    fetchForMock.mockReturnValue(jest.fn(async () => ({ ok: true, status: 200, isBodyEmpty: async () => false, json: async () => ({}) })));
    const probe = pairedPropsProbe(PAIRED);

    await expect(probe()).rejects.toThrow("dial refused");
    await expect(probe()).resolves.toEqual({ status: 200, bodyEmpty: false });
    expect(establishMock).toHaveBeenCalledTimes(2);
  });
});
