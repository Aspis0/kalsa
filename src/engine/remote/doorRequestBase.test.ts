/**
 * The URL a door's requests name: the saved address whenever one exists
 * (module presence never consulted), the iroh stand-in origin only for a
 * pairing that saved none and still has its road, and a typed error for a
 * doorless record whose road is gone — distinct from a manual door with
 * no address, which the user can still type one for.
 */

jest.mock("../../remote/irohBridge", () => ({
  irohModulePresent: jest.fn(() => true),
}));

import { irohModulePresent } from "../../remote/irohBridge";
import { IROH_TUNNEL_URL } from "../../pairing/pairingUrls";
import { doorRequestBase } from "./doorRequestBase";
import type { RemoteDoorConfig } from "./remoteDoorConfig";

const NODE = "ab".repeat(32);

function pairedDoor(overrides: Partial<RemoteDoorConfig>): RemoteDoorConfig {
  return {
    url: "",
    pairedCredential: "cd".repeat(32),
    node: NODE,
    pairedVia: "iroh",
    source: "pairing",
    pairing: { localId: "p-lid-base", removed: false },
    ...overrides,
  };
}

describe("doorRequestBase", () => {
  beforeEach(() => {
    (irohModulePresent as jest.Mock).mockReturnValue(true);
  });

  test("a saved address names itself, whatever the module answers", () => {
    const door = pairedDoor({ url: "https://desk.example", node: null, pairedVia: null });
    expect(doorRequestBase(door)).toEqual({ ok: true, base: "https://desk.example" });
    (irohModulePresent as jest.Mock).mockReturnValue(false);
    expect(doorRequestBase(door)).toEqual({ ok: true, base: "https://desk.example" });
  });

  test("a pairing that saved no address names the iroh stand-in origin", () => {
    expect(doorRequestBase(pairedDoor({}))).toEqual({ ok: true, base: IROH_TUNNEL_URL });
  });

  test("a doorless pairing whose iroh road is gone fails with its own code", () => {
    (irohModulePresent as jest.Mock).mockReturnValue(false);
    expect(doorRequestBase(pairedDoor({}))).toEqual({
      ok: false,
      error: "remote_brain_iroh_missing",
    });
  });

  test("a doorless record without a usable node has no road either", () => {
    expect(doorRequestBase(pairedDoor({ node: null, pairedVia: null }))).toEqual({
      ok: false,
      error: "remote_brain_iroh_missing",
    });
  });

  test("a doorless https-paired record fails closed: the road could still fall back to the network", () => {
    expect(doorRequestBase(pairedDoor({ pairedVia: "https" }))).toEqual({
      ok: false,
      error: "remote_brain_iroh_missing",
    });
  });

  test("a doorless record whose node is gone fails closed even paired over iroh", () => {
    expect(doorRequestBase(pairedDoor({ node: null, pairedVia: "iroh" }))).toEqual({
      ok: false,
      error: "remote_brain_iroh_missing",
    });
  });

  test("a manual door with no address keeps the url-missing code", () => {
    const door = pairedDoor({
      url: "",
      pairedCredential: null,
      node: null,
      pairedVia: null,
      source: "manual",
      pairing: null,
    });
    expect(doorRequestBase(door)).toEqual({ ok: false, error: "remote_brain_url_missing" });
  });
});
