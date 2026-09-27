import { readFileSync } from "fs";
import { join } from "path";

import {
  chooseRoad,
  irohDialReason,
  IROH_DIAL_ERROR_REASONS,
  isValidNodeHex,
  logIrohDial,
  logRoadDecision,
} from "./road";

const NODE = "ab".repeat(32);

describe("road choice", () => {
  test("no node is the HTTPS road and never asks about the module", () => {
    const present = jest.fn(() => true);
    expect(chooseRoad(null, present)).toEqual({ road: "https", reason: "no_node" });
    expect(chooseRoad(undefined, present)).toEqual({ road: "https", reason: "no_node" });
    expect(chooseRoad("", present)).toEqual({ road: "https", reason: "no_node" });
    expect(present).not.toHaveBeenCalled();
  });

  test("a malformed node is the HTTPS road, still without loading the module", () => {
    const present = jest.fn(() => true);
    expect(chooseRoad(NODE.toUpperCase(), present).road).toBe("https");
    expect(chooseRoad("ab".repeat(31), present).road).toBe("https");
    expect(chooseRoad("zz".repeat(32), present).road).toBe("https");
    expect(chooseRoad(123 as unknown as string, present).road).toBe("https");
    expect(present).not.toHaveBeenCalled();
  });

  test("a valid node with the module absent is the HTTPS road", () => {
    expect(chooseRoad(NODE, () => false)).toEqual({
      road: "https",
      reason: "module_absent",
    });
  });

  test("a valid node with the module present is the iroh road, and only then", () => {
    const present = jest.fn(() => true);
    expect(chooseRoad(NODE, present)).toEqual({ road: "iroh", node: NODE });
    expect(present).toHaveBeenCalledTimes(1);
  });
});

describe("the KALSA_ROAD line", () => {
  let log: jest.SpyInstance;

  beforeEach(() => {
    log = jest.spyOn(console, "log").mockImplementation(() => undefined);
  });
  afterEach(() => log.mockRestore());

  const lastLine = (): { road: string; reason: string; node8?: string } => {
    const call = log.mock.calls.find((args) => args[0] === "KALSA_ROAD");
    expect(call).toBeDefined();
    return JSON.parse((call as unknown[])[1] as string);
  };

  test("an iroh line carries road, reason and at most the node's first 8 hex", () => {
    logRoadDecision("iroh", "module_absent", NODE);
    const calls = log.mock.calls.filter((args) => args[0] === "KALSA_ROAD");
    expect(calls).toHaveLength(1);
    const payload = calls[0][1] as string;
    expect(JSON.parse(payload)).toEqual({
      road: "iroh",
      reason: "module_absent",
      node8: NODE.slice(0, 8),
    });
    expect(payload).not.toContain(NODE);
  });

  test("an HTTPS line without a node carries no node field at all", () => {
    logRoadDecision("https", "no_node", null);
    expect(lastLine()).toEqual({ road: "https", reason: "no_node" });
  });
});

describe("isValidNodeHex", () => {
  test("accepts exactly 64 lowercase hex characters", () => {
    expect(isValidNodeHex("0f".repeat(32))).toBe(true);
    expect(isValidNodeHex("0F".repeat(32))).toBe(false);
    expect(isValidNodeHex("0f".repeat(31))).toBe(false);
    expect(isValidNodeHex(null)).toBe(false);
    expect(isValidNodeHex(undefined)).toBe(false);
    expect(isValidNodeHex(42)).toBe(false);
  });
});

describe("iroh dial diagnostic", () => {
  test.each([
    ["KALSA_IROH_DEADLINE", "deadline"],
    ["KALSA_IROH_ABORTED", "aborted"],
    ["KALSA_IROH_NO_MODULE", "no_module"],
    ["KALSA_IROH_LINKAGE", "linkage"],
    ["KALSA_IROH_INVALID_NODE_HEX", "invalid_node"],
    ["KALSA_IROH_TRANSPORT", "transport"],
    ["KALSA_IROH_IO", "io"],
    ["KALSA_IROH_ENTROPY", "entropy"],
    ["KALSA_IROH_KEY_CORRUPT", "key_corrupt"],
    ["KALSA_IROH_CONFIG", "config"],
    ["KALSA_IROH_CLOSED", "closed"],
    ["KALSA_IROH_ASYNC_CONTEXT", "async_context"],
    ["KALSA_IROH_OTHER", "other"],
  ])("maps code %s to %s", (code, reason) => {
    expect(irohDialReason({ code, message: "raw error is ignored" })).toBe(reason);
  });

  test("an unknown or missing code maps to other", () => {
    expect(irohDialReason({ code: "SOME_NEW_NATIVE_CODE" })).toBe("other");
    expect(irohDialReason(new Error("deadline fired"))).toBe("other");
    expect(Object.values(IROH_DIAL_ERROR_REASONS)).not.toContain(undefined);
  });

  test("every Kotlin rejection code has a closed-enum mapping", () => {
    const kotlin = readFileSync(
      join(__dirname, "../../modules/kalsa-iroh/android/src/main/java/expo/modules/kalsairoh/KalsaIrohModule.kt"),
      "utf8",
    );
    const nativeCodes = [...new Set(kotlin.match(/"KALSA_IROH_[A-Z_]+"/g) ?? [])];
    expect(nativeCodes).toHaveLength(11);
    for (const literal of nativeCodes) {
      expect(IROH_DIAL_ERROR_REASONS).toHaveProperty(literal.slice(1, -1));
    }
  });

  test("one line includes only diagnostic fields and the node8 prefix", () => {
    const log = jest.spyOn(console, "log").mockImplementation(() => undefined);
    const credential = "credential-secret";
    const code = "pairing-code-secret";
    const nonce = "pairing-nonce-secret";
    const rawError = "private native error";
    logIrohDial("desk", NODE, "transport", 123.4);

    expect(log).toHaveBeenCalledTimes(1);
    const [tag, serialized] = log.mock.calls[0] as [string, string];
    expect(tag).toBe("KALSA_ROAD");
    const payload = JSON.parse(serialized) as Record<string, unknown>;
    expect(payload).toEqual({
      road: "iroh",
      lane: "desk",
      stage: "dial",
      reason: "transport",
      ms: 123,
      node8: NODE.slice(0, 8),
    });
    expect(serialized).not.toContain(NODE);
    for (const secret of [credential, code, nonce, rawError]) {
      expect(serialized).not.toContain(secret);
    }
    log.mockRestore();
  });
});
