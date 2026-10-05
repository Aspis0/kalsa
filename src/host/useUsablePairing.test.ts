/**
 * The pairing rule the pill reads: a pairing is usable only while the ACTIVE
 * record — the one `getPairingCredential` returns, the record Settings'
 * "Where it responds" control and the remote door both route through — is
 * present and no room has refused it (`removed`). The hook must also see a
 * pairing completed while the chat is open (the pairing screen runs over this
 * chat) and must never let a store failure flip a good answer.
 */
import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));

jest.mock("../pairing/pairingCredentialStore", () => ({
  getPairingCredential: jest.fn(),
}));

import { markPairingCompleted } from "../pairing/pairingCompletedAt";
import { getPairingCredential } from "../pairing/pairingCredentialStore";
import type { PairingRecord } from "../pairing/pairingRecord";
import { usablePairing, useUsablePairing } from "./useUsablePairing";

const read = getPairingCredential as jest.MockedFunction<typeof getPairingCredential>;

const STAMP = 1_700_000_100_000;
const RECORD: PairingRecord = {
  localId: "p1",
  credential: "ab".repeat(32),
  doorUrl: "https://desk.example",
  node: null,
  pairedVia: null,
  roomId: null,
};

describe("the usability rule", () => {
  test("no record and a removed record are both unusable", () => {
    expect(usablePairing(null)).toBe(false);
    expect(usablePairing({ ...RECORD, removed: true })).toBe(false);
    expect(usablePairing(RECORD)).toBe(true);
  });
});

describe("the live answer", () => {
  let renderer: ReactTestRenderer;
  let seen: boolean[];

  const latest = () => seen[seen.length - 1];
  const mount = async () => {
    seen = [];
    const Probe = () => {
      seen.push(useUsablePairing());
      return null;
    };
    await act(async () => {
      renderer = create(React.createElement(Probe));
    });
  };

  beforeEach(() => {
    read.mockReset();
  });

  afterEach(async () => {
    // A case may have unmounted already; a second unmount is not an error.
    await act(async () => {
      try {
        renderer.unmount();
      } catch {
        // already unmounted
      }
    });
  });

  test("a usable active record reads true", async () => {
    read.mockResolvedValueOnce(RECORD);
    await mount();
    expect(latest()).toBe(true);
  });

  test("a removed active record reads false", async () => {
    read.mockResolvedValueOnce({ ...RECORD, removed: true });
    await mount();
    expect(latest()).toBe(false);
  });

  test("a pairing completed over the open chat re-reads the store", async () => {
    read.mockResolvedValueOnce(null).mockResolvedValueOnce(RECORD);
    await mount();
    expect(latest()).toBe(false);

    await act(async () => {
      await markPairingCompleted(STAMP);
    });

    expect(read).toHaveBeenCalledTimes(2);
    expect(latest()).toBe(true);
  });

  test("a store failure keeps the last answer", async () => {
    read.mockResolvedValueOnce(RECORD).mockRejectedValueOnce(new Error("keystore"));
    await mount();
    expect(latest()).toBe(true);

    await act(async () => {
      await markPairingCompleted(STAMP);
    });

    expect(latest()).toBe(true);
  });
});
