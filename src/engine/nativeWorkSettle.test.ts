/**
 * The settle bus: a listener hears every notification, an unsubscribed one
 * hears none, and unsubscribing from inside a callback cannot skip a sibling.
 */
import {
  notifyNativeWorkSettled,
  subscribeNativeWorkSettled,
} from "./nativeWorkSettle";

describe("nativeWorkSettle", () => {
  it("notifies every subscriber and stops after unsubscribe", () => {
    const first = jest.fn();
    const second = jest.fn();
    const unsubscribeFirst = subscribeNativeWorkSettled(first);
    const unsubscribeSecond = subscribeNativeWorkSettled(second);

    notifyNativeWorkSettled();
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);

    unsubscribeFirst();
    notifyNativeWorkSettled();
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(2);

    unsubscribeSecond();
    notifyNativeWorkSettled();
    expect(second).toHaveBeenCalledTimes(2);
  });

  it("lets a listener unsubscribe inside the notification", () => {
    const later = jest.fn();
    const unsubscribe = subscribeNativeWorkSettled(() => unsubscribe());
    subscribeNativeWorkSettled(later);

    expect(() => notifyNativeWorkSettled()).not.toThrow();
    expect(later).toHaveBeenCalledTimes(1);
  });
});
