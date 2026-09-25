import { parsePairingQr } from "./pairingQr";

const REACHABLE = "http://192.168.1.10:4952";
const CODE = "ab".repeat(16);
const NONCE = "cd".repeat(32);
const NODE = "ef".repeat(32);

const square = (overrides: Record<string, unknown> = {}): string =>
  JSON.stringify({ v: 3, reachable: REACHABLE, code: CODE, nonce: NONCE, ...overrides });

describe("parsePairingQr", () => {
  test("a full v3 square maps onto the form's fields", () => {
    expect(parsePairingQr(square({ node: NODE }))).toEqual({
      ok: true,
      square: { reachable: REACHABLE, code: CODE, nonce: NONCE, node: NODE },
    });
  });

  test("an absent node maps to the empty string the manual form uses", () => {
    expect(parsePairingQr(square())).toEqual({
      ok: true,
      square: { reachable: REACHABLE, code: CODE, nonce: NONCE, node: "" },
    });
  });

  test("unknown top-level keys are tolerated, not rejected", () => {
    const result = parsePairingQr(square({ future_field: "ignored" }));
    expect(result).toEqual({
      ok: true,
      square: { reachable: REACHABLE, code: CODE, nonce: NONCE, node: "" },
    });
  });

  test("non-JSON text and JSON that is not an object are separate errors", () => {
    expect(parsePairingQr("not json")).toEqual({ ok: false, error: "notJson" });
    expect(parsePairingQr("[1,2]")).toEqual({ ok: false, error: "notObject" });
    expect(parsePairingQr('"v":3')).toEqual({ ok: false, error: "notJson" });
    expect(parsePairingQr("null")).toEqual({ ok: false, error: "notObject" });
    expect(parsePairingQr("3")).toEqual({ ok: false, error: "notObject" });
  });

  test("the version gate refuses every document that is not v3", () => {
    expect(parsePairingQr(square({ v: 2 }))).toEqual({ ok: false, error: "unsupportedVersion" });
    expect(parsePairingQr(square({ v: "3" }))).toEqual({ ok: false, error: "unsupportedVersion" });
    const withoutVersion = JSON.stringify({ reachable: REACHABLE, code: CODE, nonce: NONCE });
    expect(parsePairingQr(withoutVersion)).toEqual({ ok: false, error: "missingField" });
  });

  test.each(["reachable", "code", "nonce"] as const)("a missing or non-string %s is refused", (field) => {
    const payload: Record<string, unknown> = { v: 3, reachable: REACHABLE, code: CODE, nonce: NONCE };
    delete payload[field];
    expect(parsePairingQr(JSON.stringify(payload))).toEqual({ ok: false, error: "missingField" });
    expect(parsePairingQr(square({ [field]: 3 }))).toEqual({ ok: false, error: "missingField" });
  });

  test("the code must be exactly 32 lowercase hex characters", () => {
    expect(parsePairingQr(square({ code: "AB".repeat(16) }))).toEqual({ ok: false, error: "invalidCode" });
    expect(parsePairingQr(square({ code: "ab".repeat(15) }))).toEqual({ ok: false, error: "invalidCode" });
    expect(parsePairingQr(square({ code: `${"ab".repeat(15)}g` }))).toEqual({ ok: false, error: "invalidCode" });
  });

  test("the nonce must be exactly 64 lowercase hex characters", () => {
    expect(parsePairingQr(square({ nonce: "CD".repeat(32) }))).toEqual({ ok: false, error: "invalidNonce" });
    expect(parsePairingQr(square({ nonce: "cd".repeat(31) }))).toEqual({ ok: false, error: "invalidNonce" });
    expect(parsePairingQr(square({ nonce: "cd".repeat(33) }))).toEqual({ ok: false, error: "invalidNonce" });
  });

  test("a node that is present must be 64 lowercase hex characters", () => {
    expect(parsePairingQr(square({ node: "EF".repeat(32) }))).toEqual({ ok: false, error: "invalidNode" });
    expect(parsePairingQr(square({ node: "ef".repeat(31) }))).toEqual({ ok: false, error: "invalidNode" });
    expect(parsePairingQr(square({ node: null }))).toEqual({ ok: false, error: "invalidNode" });
    expect(parsePairingQr(square({ node: "" }))).toEqual({ ok: false, error: "invalidNode" });
  });

  test("reachable keeps its exact bytes: the MAC covers the string as shown", () => {
    const tricky = "HTTP://127.0.0.1:9500/pair?keep=this#fragment";
    expect(parsePairingQr(square({ reachable: tricky }))).toEqual({
      ok: true,
      square: { reachable: tricky, code: CODE, nonce: NONCE, node: "" },
    });
  });
});
