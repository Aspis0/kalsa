/**
 * The keyboard's height, as SETTLED React state.
 *
 * Settled, not per frame: the shell re-partitions its three bands from this
 * number, so a per-frame value would re-render the whole shell at animation
 * rate. The travel between `keyboardDidShow` and `keyboardDidHide` is a
 * listed gap, not an oversight (DESIGN.md §2.7).
 *
 * This library and not React Native's own `Keyboard` event: the two report
 * DIFFERENT numbers and only this one pairs with `bottomInsetFor`'s larger
 * rule — RN's payload is the IME minus the navigation bar, so `max` against
 * the safe-area inset would leave the composer one gesture bar under the
 * keyboard, while this library reports the FULL IME under edge-to-edge, which
 * this app runs. The provider is already mounted (`App.tsx`), so the shell
 * adds an import, not a dependency.
 *
 * `keyboardHeight` is in dp, and 0 while the keyboard is down.
 */
import { useEffect, useState } from "react";

import { KeyboardEvents } from "react-native-keyboard-controller";

/** A height the bands can use: finite and positive, or nothing. */
function usableHeight(height: number): number {
  return Number.isFinite(height) && height > 0 ? height : 0;
}

export function useKeyboardHeight(): number {
  const [height, setHeight] = useState(0);

  useEffect(() => {
    const shown = KeyboardEvents.addListener("keyboardDidShow", (event) => {
      setHeight(usableHeight(event.height));
    });
    const hidden = KeyboardEvents.addListener("keyboardDidHide", () => {
      setHeight(0);
    });

    return () => {
      shown.remove();
      hidden.remove();
    };
  }, []);

  return height;
}
