import { decideSessionDiskSpace } from "./sessionDiskSpaceDecision";
import type {
  SessionDiskGateInput,
  SessionDiskGateResult,
} from "./sessionPersistence";
import type { SpaceEvictionResult } from "./sessionPool";

const diskInput: SessionDiskGateInput = { nPast: 12 };

function gateResult(
  overrides: Partial<SessionDiskGateResult> = {},
): SessionDiskGateResult {
  return {
    ok: false,
    reason: "short",
    usedTokens: 12,
    requiredBytes: 10_000,
    freeBytes: 9_000,
    ...overrides,
  };
}

function shortGateResult(
  overrides: Partial<SessionDiskGateResult> = {},
): SessionDiskGateResult {
  return gateResult({
    requiredBytes: 10_000,
    freeBytes: 9_000,
    ...overrides,
  });
}

function gateResultForReason(
  reason: "no_size" | "disk_unreadable" | "gate_error",
): SessionDiskGateResult {
  if (reason === "disk_unreadable") {
    return gateResult({
      reason,
      usedTokens: 12,
      requiredBytes: 10_000,
      freeBytes: null,
    });
  }
  return gateResult({
    reason,
    usedTokens: null,
    requiredBytes: null,
    freeBytes: null,
  });
}

function evictionResult(
  overrides: Partial<SpaceEvictionResult> = {},
): SpaceEvictionResult {
  return {
    status: "covered",
    bytes: 0,
    requiredDeficitBytes: 0,
    ...overrides,
  };
}

function makeGate(result: SessionDiskGateResult) {
  return jest.fn(async (_input: SessionDiskGateInput) => result);
}

function makeEvictor(result: SpaceEvictionResult) {
  return jest.fn(
    async (_stem: string, _input: SessionDiskGateInput) => result,
  );
}

describe("decideSessionDiskSpace", () => {
  it.each(["no_size", "disk_unreadable", "gate_error"] as const)(
    "refuses %s without calling the evictor",
    async (reason) => {
      const gate = makeGate(gateResultForReason(reason));
      const evict = makeEvictor(evictionResult());

      const result = await decideSessionDiskSpace(
        { stem: "private-stem", diskInput },
        { gate, evict },
      );

      expect(result).toEqual({
        proceed: false,
        log: { reason: "disk", diskReason: reason },
      });
      expect(evict).toHaveBeenCalledTimes(0);
      expect(gate).toHaveBeenCalledTimes(1);
      expect(gate).toHaveBeenCalledWith(diskInput);
    },
  );

  it("proceeds without touching the evictor when the first gate passes", async () => {
    const gate = makeGate(
      gateResult({ ok: true, reason: null, freeBytes: 20_000 }),
    );
    const evict = makeEvictor(evictionResult());

    await expect(
      decideSessionDiskSpace({ stem: "private-stem", diskInput }, { gate, evict }),
    ).resolves.toEqual({ proceed: true });
    expect(evict).toHaveBeenCalledTimes(0);
    expect(gate).toHaveBeenCalledTimes(1);
    expect(gate).toHaveBeenCalledWith(diskInput);
  });

  it("labels a null first-gate reason as gate_error", async () => {
    const gate = makeGate(gateResult({ reason: null }));
    const evict = makeEvictor(evictionResult());

    await expect(
      decideSessionDiskSpace({ stem: "private-stem", diskInput }, { gate, evict }),
    ).resolves.toEqual({
      proceed: false,
      log: { reason: "disk", diskReason: "gate_error" },
    });
    expect(evict).toHaveBeenCalledTimes(0);
    expect(gate).toHaveBeenCalledTimes(1);
    expect(gate).toHaveBeenCalledWith(diskInput);
  });

  it("proceeds after covered eviction and exactly one re-read", async () => {
    const gate = jest
      .fn()
      .mockResolvedValueOnce(shortGateResult())
      .mockResolvedValueOnce(
        gateResult({ ok: true, reason: null, freeBytes: 20_000 }),
      );
    const evict = makeEvictor(evictionResult({ bytes: 512 }));

    await expect(
      decideSessionDiskSpace(
        { stem: "other-stem", diskInput },
        { gate, evict },
      ),
    ).resolves.toEqual({ proceed: true });
    expect(evict).toHaveBeenCalledTimes(1);
    expect(evict).toHaveBeenCalledWith("other-stem", diskInput);
    expect(gate).toHaveBeenCalledTimes(2);
    expect(gate).toHaveBeenNthCalledWith(1, diskInput);
    expect(gate).toHaveBeenNthCalledWith(2, diskInput);
  });

  it("proceeds after not_needed eviction and exactly one re-read", async () => {
    const gate = jest
      .fn()
      .mockResolvedValueOnce(shortGateResult())
      .mockResolvedValueOnce(
        gateResult({ ok: true, reason: null, freeBytes: 20_000 }),
      );
    const evict = makeEvictor(
      evictionResult({ status: "not_needed", bytes: 0 }),
    );

    await expect(
      decideSessionDiskSpace(
        { stem: "third-stem", diskInput },
        { gate, evict },
      ),
    ).resolves.toEqual({ proceed: true });
    expect(evict).toHaveBeenCalledTimes(1);
    expect(evict).toHaveBeenCalledWith("third-stem", diskInput);
    expect(gate).toHaveBeenCalledTimes(2);
    expect(gate).toHaveBeenNthCalledWith(1, diskInput);
    expect(gate).toHaveBeenNthCalledWith(2, diskInput);
  });

  it("refuses uncoverable eviction with short as diskReason", async () => {
    const gate = makeGate(shortGateResult());
    const evict = makeEvictor(
      evictionResult({ status: "uncoverable", bytes: 0, requiredDeficitBytes: 0 }),
    );

    const result = await decideSessionDiskSpace(
      { stem: "private-stem", diskInput },
      { gate, evict },
    );

    expect(result).toEqual({
      proceed: false,
      log: {
        reason: "disk",
        diskReason: "short",
        diskEvictionStatus: "uncoverable",
      },
    });
    expect(evict).toHaveBeenCalledTimes(1);
    expect(gate).toHaveBeenCalledTimes(1);
    expect(gate).toHaveBeenCalledWith(diskInput);
  });

  it.each(["evict_failed", "gate_unreadable"] as const)(
    "refuses %s with the eviction status as diskReason",
    async (status) => {
      const gate = makeGate(shortGateResult());
      const evict = makeEvictor(
        evictionResult({
          status,
          bytes: 2_048,
          requiredDeficitBytes: 4_096,
        }),
      );

      await expect(
        decideSessionDiskSpace(
          { stem: "private-stem", diskInput },
          { gate, evict },
        ),
      ).resolves.toEqual({
        proceed: false,
        log: {
          reason: "disk",
          diskReason: status,
          diskEvictionStatus: status,
          diskRequiredDeficitBytes: 4_096,
          diskFreedBytes: 2_048,
        },
      });
      expect(evict).toHaveBeenCalledTimes(1);
      expect(gate).toHaveBeenCalledTimes(1);
      expect(gate).toHaveBeenCalledWith(diskInput);
    },
  );

  it("reports the known residual shortfall using strict-gate arithmetic", async () => {
    const gate = jest
      .fn()
      .mockResolvedValueOnce(shortGateResult())
      .mockResolvedValueOnce(
        shortGateResult({ freeBytes: 8_765 }),
      );
    const evict = makeEvictor(evictionResult({ bytes: 2_048 }));

    await expect(
      decideSessionDiskSpace(
        { stem: "private-stem", diskInput },
        { gate, evict },
      ),
    ).resolves.toEqual({
      proceed: false,
      log: {
        reason: "disk",
        diskReason: "short",
        diskFreedBytes: 2_048,
        diskResidualShortfallBytes: 1_236,
      },
    });
    expect(evict).toHaveBeenCalledTimes(1);
    expect(gate).toHaveBeenCalledTimes(2);
    expect(gate).toHaveBeenNthCalledWith(1, diskInput);
    expect(gate).toHaveBeenNthCalledWith(2, diskInput);
  });

  it("uses -1 for an unknown residual shortfall", async () => {
    const gate = jest
      .fn()
      .mockResolvedValueOnce(shortGateResult())
      .mockResolvedValueOnce(
        gateResult({
          reason: "disk_unreadable",
          usedTokens: 12,
          requiredBytes: 10_000,
          freeBytes: null,
        }),
      );
    const evict = makeEvictor(evictionResult({ bytes: 0 }));

    await expect(
      decideSessionDiskSpace(
        { stem: "private-stem", diskInput },
        { gate, evict },
      ),
    ).resolves.toEqual({
      proceed: false,
      log: {
        reason: "disk",
        diskReason: "disk_unreadable",
        diskFreedBytes: 0,
        diskResidualShortfallBytes: -1,
      },
    });
    expect(evict).toHaveBeenCalledTimes(1);
    expect(gate).toHaveBeenCalledTimes(2);
    expect(gate).toHaveBeenNthCalledWith(1, diskInput);
    expect(gate).toHaveBeenNthCalledWith(2, diskInput);
  });

  it("does not put zero-valued optional eviction fields in the refusal", async () => {
    const gate = makeGate(shortGateResult());
    const evict = makeEvictor(
      evictionResult({ status: "drop_failed", bytes: 0, requiredDeficitBytes: 0 }),
    );

    const result = await decideSessionDiskSpace(
      { stem: "private-stem", diskInput },
      { gate, evict },
    );

    expect(result).toEqual({
      proceed: false,
      log: {
        reason: "disk",
        diskReason: "drop_failed",
        diskEvictionStatus: "drop_failed",
      },
    });
    if (!result.proceed) {
      expect(result.log).not.toHaveProperty("diskRequiredDeficitBytes");
      expect(result.log).not.toHaveProperty("diskFreedBytes");
    }
    expect(evict).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toContain("private-stem");
    expect(gate).toHaveBeenCalledWith(diskInput);
  });
});
