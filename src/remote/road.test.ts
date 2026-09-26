import { chooseRoad, isValidNodeHex, logRoadDecision } from "./road";

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
    logRoadDecision("iroh", "connected", NODE);
    const calls = log.mock.calls.filter((args) => args[0] === "KALSA_ROAD");
    expect(calls).toHaveLength(1);
    const payload = calls[0][1] as string;
    expect(JSON.parse(payload)).toEqual({
      road: "iroh",
      reason: "connected",
      node8: NODE.slice(0, 8),
    });
    expect(payload).not.toContain(NODE);
  });

  test("a fallback line names connect_failed and keeps the node truncated", () => {
    logRoadDecision("https", "connect_failed", NODE);
    expect(lastLine()).toEqual({
      road: "https",
      reason: "connect_failed",
      node8: NODE.slice(0, 8),
    });
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
