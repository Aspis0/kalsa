/**
 * The pairing completion stamp: the SecureStore round-trip with corrupt
 * values refused, and the single-purpose notification the open
 * conversation subscribes to (a listener failing must not break the
 * pairing; unsubscribe must stop delivery).
 */
import {
  getPairingCompletedAt,
  markPairingCompleted,
  subscribePairingCompleted,
} from "./pairingCompletedAt";

jest.mock("expo-secure-store", () => {
  const store: Record<string, string> = {};
  return {
    getItemAsync: async (key: string) => store[key] ?? null,
    setItemAsync: async (key: string, value: string) => {
      store[key] = value;
    },
    __corrupt: (key: string, value: string) => {
      store[key] = value;
    },
  };
});

const secureStore = jest.requireMock("expo-secure-store") as {
  __corrupt: (key: string, value: string) => void;
};

describe("pairingCompletedAt", () => {
  test("round-trips the stamp and refuses corrupt values", async () => {
    expect(await getPairingCompletedAt()).toBeNull();
    await markPairingCompleted(1_700_000_100_000);
    expect(await getPairingCompletedAt()).toBe(1_700_000_100_000);
    secureStore.__corrupt("kalsa.pairing.completedAt.v1", "not-a-number");
    expect(await getPairingCompletedAt()).toBeNull();
    secureStore.__corrupt("kalsa.pairing.completedAt.v1", "-5");
    expect(await getPairingCompletedAt()).toBeNull();
  });

  test("a completed pairing notifies its subscribers, once each", async () => {
    const first = jest.fn();
    const second = jest.fn();
    const unsubscribe = subscribePairingCompleted(first);
    subscribePairingCompleted(second);
    await markPairingCompleted();
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    unsubscribe();
    await markPairingCompleted();
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(2);
  });

  test("a throwing listener neither breaks the pairing nor the others", async () => {
    const heard = jest.fn();
    subscribePairingCompleted(() => {
      throw new Error("listener bug");
    });
    subscribePairingCompleted(heard);
    await expect(markPairingCompleted(123)).resolves.toBeUndefined();
    expect(heard).toHaveBeenCalledTimes(1);
    expect(await getPairingCompletedAt()).toBe(123);
  });
});
