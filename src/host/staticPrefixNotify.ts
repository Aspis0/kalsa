/**
 * The static-prefix notifier's skip-first rule (D2 row 21): the effect must
 * NOT notify on mount / remount — only when the locale or a tool flag really
 * flips. The old code kept the skip in a ref inside the component
 * (`AppShell.tsx:2357-2366`); here it is a one-use factory so the rule is a
 * testable value instead of an effect-ordering accident.
 */
export type StaticPrefixNotifier<L, T> = (locale: L, tools: T[]) => void;

export function createStaticPrefixNotifier<L, T>(
  notify: StaticPrefixNotifier<L, T>,
): StaticPrefixNotifier<L, T> {
  let skipNext = true;
  return (locale, tools) => {
    if (skipNext) {
      skipNext = false;
      return;
    }
    notify(locale, tools);
  };
}
