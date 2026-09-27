import {
  createPairingLinkDeduper,
  decodePairingInviteFragment,
  parsePairingInvite,
} from "./pairingInvite";
import { logPairingFail } from "./pairingFailLog";

const CODE = "41".repeat(16);
const JSON_WITH_NODE = JSON.stringify({
  v: 3,
  reachable: "http://127.0.0.1:8132",
  code: CODE,
  nonce: "42".repeat(32),
  node: "43".repeat(32),
});
const FRAGMENT = Buffer.from(JSON_WITH_NODE, "utf8").toString("base64url");

describe("pairing invites", () => {
  it("decodes the base64url fragment and rejects malformed or padded input", () => {
    expect(decodePairingInviteFragment(FRAGMENT)).toMatchObject({ ok: true });
    expect(decodePairingInviteFragment("%%bad")).toEqual({ ok: false, error: "invalidFragment" });
    expect(decodePairingInviteFragment(`${FRAGMENT}=`)).toEqual({ ok: false, error: "invalidFragment" });
    expect(decodePairingInviteFragment("a")).toEqual({ ok: false, error: "invalidFragment" });
    expect(decodePairingInviteFragment("a".repeat(16_385))).toEqual({ ok: false, error: "tooLarge" });
  });

  it("rejects a valid v3 square without a node", () => {
    const json = JSON.stringify({
      v: 3,
      reachable: "http://127.0.0.1:8132",
      code: CODE,
      nonce: "42".repeat(32),
    });
    const fragment = Buffer.from(json, "utf8").toString("base64url");
    expect(decodePairingInviteFragment(fragment)).toEqual({ ok: false, error: "missingNode" });
  });

  it.each([
    ["https link", `https://kalsa.io/pair#${FRAGMENT}`],
    ["app link", `kalsa://pair#${FRAGMENT}`],
    ["raw JSON", JSON_WITH_NODE],
  ])("accepts a pasted %s through the shared validator", (_label, value) => {
    expect(parsePairingInvite(value)).toMatchObject({ ok: true, square: { code: CODE, node: "43".repeat(32) } });
  });

  it("de-duplicates cold and warm delivery of the same link", () => {
    const shouldProcess = createPairingLinkDeduper();
    const link = `https://kalsa.io/pair#${FRAGMENT}`;
    expect(shouldProcess(link)).toBe(true);
    expect(shouldProcess(link)).toBe(false);
    expect(shouldProcess(`kalsa://pair#${FRAGMENT}`)).toBe(true);
  });

  it("keeps invite fragments and codes out of pairing log calls", () => {
    const log = jest.spyOn(console, "log").mockImplementation(() => undefined);
    const link = `https://kalsa.io/pair#${FRAGMENT}`;
    expect(parsePairingInvite(link).ok).toBe(true);
    logPairingFail("claim_network", null);
    const logged = JSON.stringify(log.mock.calls);
    expect(logged).not.toContain(FRAGMENT);
    expect(logged).not.toContain(CODE);
    log.mockRestore();
  });
});
