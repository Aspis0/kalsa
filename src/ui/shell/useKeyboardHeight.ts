/**
 * The keyboard's height, as SETTLED React state.
 *
 * Why settled and not per frame: the shell re-partitions its three bands from
 * this number, so a value that changed on every frame of the IME's animation
 * would re-render the whole shell — transcript included — at animation rate.
 * `keyboardDidShow` fires once, when the keyboard has arrived, and
 * `keyboardDidHide` once when it has left; the travel between the two is a
 * listed gap, not an oversight (`docs/DESIGN.md` §2.7: smoothing it means
 * driving the band heights from one shared value on the UI thread, which is a
 * step of its own).
 *
 * Why this library and not React Native's own `Keyboard` event: the two report
 * DIFFERENT numbers and only one of them pairs with `bottomInsetFor`'s larger
 * rule. RN's payload is `imeInsets.bottom - systemBars.bottom`
 * (`ReactRootView.java`, `checkForKeyboardEvents`), i.e. the IME with the
 * navigation bar already taken out — so combining it with the safe-area bottom
 * inset by `max` leaves the composer one gesture bar under the keyboard. This
 * library subtracts the navigation bar only when it is NOT translucent
 * (`KeyboardAnimationCallback.kt`, `getCurrentKeyboardHeight`) and its provider
 * marks the bar translucent whenever the app runs edge-to-edge, which this app
 * does (`targetSdk 36` + `edgeToEdgeEnabled`). Under edge-to-edge its height is
 * therefore the full IME inset, the number the larger rule was written for and
 * the number `docs/DESIGN.md` §2.7 names. `App.tsx` already mounts the provider
 * and `AiChatPage.tsx` already reads the same library, so the shell adds an
 * import, not a dependency.
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
