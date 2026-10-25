/**
 * The streaming caret (DESIGN.md §2.11): a thin accent bar after the last
 * segment of an answer that is still arriving. Its decision and motion values
 * are data in `./caretSpec`, pinned by `caretSpec.test.ts`; this file draws them.
 *
 * Three rules it keeps:
 *
 * - the blink is driven entirely by `CARET_BLINK` with linear timing and
 *   restarts from solid on every text change — "frozen solid as text arrives";
 * - reduce-motion is honoured (§2.11): while the system asks for it the caret
 *   is solid and still, never blinking;
 * - the glyph is hidden from assistive tech: a bar inside the reading flow
 *   would be announced mid-sentence and re-read on every token. The answer's
 *   text itself stays selectable copy — the design's requirement for a partial.
 */
import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Easing, Text } from "react-native";

import { CARET_BLINK, CARET_GLYPH } from "./caretSpec";

export function StreamCaret({ color, text }: { color: string; text: string }) {
  const opacity = useRef(new Animated.Value(CARET_BLINK.from)).current;
  const [reducedMotion, setReducedMotion] = useState(false);
  // The animated text node: a plain <Text> would receive the Animated.Value
  // object as a literal style and never move.
  const AnimatedText = useRef(Animated.createAnimatedComponent(Text)).current;

  useEffect(() => {
    let alive = true;
    void AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (alive) setReducedMotion(enabled);
      })
      .catch(() => undefined);
    const subscription = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      (enabled) => setReducedMotion(enabled),
    );
    return () => {
      alive = false;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    // Solid on arrival: every new text restarts the cycle at `from` (§2.11's
    // "frozen solid as text arrives"), and reduced motion stays solid.
    opacity.setValue(CARET_BLINK.from);
    if (reducedMotion) return;
    const half = CARET_BLINK.durationMs / 2;
    const blink = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: CARET_BLINK.to,
          duration: half,
          easing: Easing.linear,
          useNativeDriver: true,
          // A loop that registered an interaction would hold InteractionManager
          // for the whole turn; streaming must not throttle touch feedback.
          isInteraction: false,
        }),
        Animated.timing(opacity, {
          toValue: CARET_BLINK.from,
          duration: half,
          easing: Easing.linear,
          useNativeDriver: true,
          isInteraction: false,
        }),
      ]),
    );
    blink.start();
    return () => blink.stop();
  }, [opacity, reducedMotion, text]);

  return (
    <AnimatedText
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ color, opacity }}
    >
      {CARET_GLYPH}
    </AnimatedText>
  );
}
