/**
 * Why this file exists: the first on-device run of the new root found the
 * drawer's Close button — a full-screen Pressable under everything —
 * unreachable. Two taps inside its own bounds, at (240,820) and (465,500),
 * left the drawer open while BACK (`Modal.onRequestClose`) closed it. The
 * a11y tree showed full-screen, non-clickable nodes above the button; the
 * touch analysis named one: the content layer is full-screen (`styles.fill`)
 * while its content is only the padded box, and as a touch target
 * (`pointerEvents="auto"`) `ReactViewGroup.onTouchEvent` returns true for it
 * (ReactViewGroup.kt:281), so every tap its children do not take is
 * swallowed before the scrim sees it. The fix is `box-none`: children keep
 * the touches, the layer itself never takes one, and no handler is added.
 *
 * This is a source check because jest runs on `node` with `.ts` only — the
 * same reason `transcriptJumpPill.test.ts` reads its `.tsx` files as text.
 * Comments are stripped first, so the prose about the fix cannot satisfy a
 * check. Every predicate is run against a sample that must fail it.
 */
import { readFileSync } from "fs";
import { join } from "path";

const read = (file: string): string => readFileSync(join(__dirname, file), "utf8");

const DRAWER = read("Drawer.tsx");

/** Comments removed, so the comment above the content layer cannot pass it. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

/** The opening tag of the animated layer keyed by `marker`, tags intact. */
function layerTag(source: string, marker: string): string {
  const at = source.indexOf(marker);
  if (at < 0) throw new Error(`the layer keyed by ${marker} is gone`);
  const start = source.lastIndexOf("<Animated.View", at);
  if (start < 0) throw new Error(`no <Animated.View> holds ${marker}`);
  const end = source.indexOf(">", at);
  if (end < 0) throw new Error(`no element closes over ${marker}`);
  return source.slice(start, end + 1);
}

/** The scrim's own Pressable: the one node a screen reader hears as Close. */
function scrimBlock(source: string): string {
  const start = source.indexOf("<Pressable");
  if (start < 0) throw new Error("the scrim's Close button is gone");
  const end = source.indexOf("/>", start);
  if (end < 0) throw new Error("the scrim's Close button never closes");
  return source.slice(start, end + 2);
}

/** The content layer passes taps through: full-screen box, padded content,
 *  and never a touch target in its own right. */
function contentLayerPassesTaps(tag: string): boolean {
  return /\? "box-none" : "none"\}/.test(tag) && !/\? "auto"/.test(tag);
}

/** It hosts the drawer's rows but must grow no handler of its own: the fix
 *  is a pointer-events mode, not a second close path. */
function carriesNoHandler(tag: string): boolean {
  return !/onPress|onResponder|onStartShouldSetResponder/.test(tag);
}

/** The scrim keeps the single announced Close affordance, its role, its name
 *  and the full-screen box the capture measured. */
function scrimClosesAndIsNamed(block: string): boolean {
  return (
    block.includes("onPress={onClose}") &&
    block.includes('accessibilityRole="button"') &&
    block.includes('accessibilityLabel={t("common.close")}') &&
    block.includes("styles.fill")
  );
}

/** BACK keeps working: the Modal's own close route. */
function backStillCloses(source: string): boolean {
  return source.includes("onRequestClose={onClose}");
}

/** The backdrop LAYER stays decoration: no accessible name of its own, so
 *  the screen reader hears the Close button, never a second node. */
function backdropLayerIsSilent(tag: string): boolean {
  return !/accessibility|accessible=|onAccessibilityTap/.test(tag);
}

describe("the drawer's scrim is reachable", () => {
  const code = stripComments(DRAWER);

  it("reads the file it claims, with both layers where the checks expect them", () => {
    expect(DRAWER).toContain("export function Drawer");
    expect(DRAWER).toContain("accessibilityViewIsModal");
    expect(layerTag(code, "fold.contentLive").length).toBeGreaterThan(0);
    expect(layerTag(code, "fold.backdropLive").length).toBeGreaterThan(0);
    expect(scrimBlock(code).length).toBeGreaterThan(0);
  });

  it("lets taps through the content layer: full-screen box, padded content", () => {
    expect(contentLayerPassesTaps(layerTag(code, "fold.contentLive"))).toBe(true);
  });

  it("keeps the content layer handler-free — pointer events, not a second close path", () => {
    expect(carriesNoHandler(layerTag(code, "fold.contentLive"))).toBe(true);
  });

  it("keeps the scrim the full-screen, named Close button, and BACK with it", () => {
    expect(scrimClosesAndIsNamed(scrimBlock(code))).toBe(true);
    expect(backStillCloses(code)).toBe(true);
  });

  it("keeps the backdrop layer out of the screen reader's way", () => {
    expect(backdropLayerIsSilent(layerTag(code, "fold.backdropLive"))).toBe(true);
  });

  it("would catch each defect this file was written for", () => {
    // The defect as it shipped: the content layer itself a touch target.
    const shipped =
      '<Animated.View pointerEvents={fold.contentLive ? "auto" : "none"} style={[styles.fill, pad]}>';
    expect(contentLayerPassesTaps(shipped)).toBe(false);
    // The wrong half of the same fix: "none" would silence the rows too.
    const dead =
      '<Animated.View pointerEvents={fold.contentLive ? "none" : "none"} style={[styles.fill, pad]}>';
    expect(contentLayerPassesTaps(dead)).toBe(false);
    // A handler bolted on instead of the cause-level fix:
    const secondPath =
      '<Animated.View onPress={onClose} pointerEvents={fold.contentLive ? "box-none" : "none"}>';
    expect(carriesNoHandler(secondPath)).toBe(false);
    // The Close button losing its name, its role, or its full-screen box:
    expect(scrimClosesAndIsNamed('<Pressable onPress={onClose} style={[styles.fill]} />')).toBe(false);
    expect(scrimClosesAndIsNamed('<Pressable accessibilityRole="button" style={[styles.fill]} />')).toBe(false);
    expect(scrimClosesAndIsNamed('<Pressable onPress={undefined} style={[styles.fill]} />')).toBe(false);
    // BACK rewired away from onClose:
    expect(backStillCloses("<Modal onRequestClose={() => {}}>")).toBe(false);
    // The backdrop layer growing an accessibility identity of its own:
    expect(
      backdropLayerIsSilent('<Animated.View accessibilityRole="button" pointerEvents={fold.backdropLive}>'),
    ).toBe(false);
  });
});
