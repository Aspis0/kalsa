/**
 * The retry affordance under the strip — source pins, the shell's idiom
 * (there is no render harness, `stripWebSwitch.test.ts` the same): a failure
 * sentence that promises a tap must BE a control a finger and a screen
 * reader can find, its row must leave the bands through the same arithmetic
 * that draws it, and the cause line must not masquerade as a second failure.
 */
import { readFileSync } from "fs";
import { join } from "path";

const read = (name: string) => readFileSync(join(__dirname, name), "utf8");
const BAR = read("ModelBar.tsx");
const STRIP = read("ShellStrip.tsx");
const SHEET = read("ModelPillSheet.tsx");

describe("the failure sentence is a control a finger can find", () => {
  test("a real box with a testID, a button role, the sentence as its name, and the action as its hint", () => {
    expect(BAR).toContain('testID="shell.modelBar.retry"');
    expect(BAR).toContain('accessibilityRole="button"');
    expect(BAR).toContain("accessibilityLabel={view.status.label}");
    expect(BAR).toContain("accessibilityHint={view.status.retryLabel}");
    expect(BAR).toContain("MIN_TOUCH_TARGET");
    expect(BAR).not.toContain("hitSlop");
    // The accessible name is the sentence the control shows, so a screen reader
    // announces the same words as the sighted user sees (size included).
    expect(BAR).not.toMatch(/accessibilityLabel=\{view\.status\.retryLabel\}/);
  });

  test("it keeps the sentence's tone and gains the underline as its affordance", () => {
    expect(BAR).toContain("color: toneColor(view.status.tone, colors)");
    expect(BAR).toContain('textDecorationLine: "underline"');
  });

  test("the row's height reaches the bands only through statusRowHeight(view)", () => {
    // modelBarHeight (what Shell subtracts) and BOTH render branches must
    // call the same function, or the bar and the partition disagree.
    expect(BAR.match(/statusRowHeight\(view\)/g)).toHaveLength(3);
  });

  test("the pill sheet hands retry to the same model action as the pill, after it closes", () => {
    expect(STRIP).toContain("onRetryPress={onModelAction}");
    expect(SHEET).toContain("onRetryPress={onRetryPress ? () => closeThen(onRetryPress) : undefined}");
    // The download Alert must not be presented over the Modal still on screen.
    expect(SHEET).toContain("onDismiss={onModalDismiss}");
    // A stale queued action never fires on a re-open, a late dismissal while the
    // sheet is up does nothing, and leaving the screen runs the pending action.
    expect(SHEET).toContain("if (visible) afterDismiss.current = null;");
    expect(SHEET).toContain("if (!shownRef.current) runPending();");
    expect(SHEET).toContain("useEffect(() => () => runPending(), [runPending]);");
  });
});

describe("cause and consequence are visually distinguished", () => {
  test("while the status carries the alarm, the explanation line is drawn muted", () => {
    expect(BAR).toContain('view.status.tone === "bad" ? "muted" : "bad"');
  });

  test("the progress track keeps the page's grid: one padding constant for every row", () => {
    // Status, battery, progress, error and hint rows all sit on ROW
    // (STRIP_SIDE_PADDING) — the track cannot drift off the grid alone.
    expect(BAR.match(/\[ROW,/g)!.length).toBeGreaterThanOrEqual(5);
  });
});
