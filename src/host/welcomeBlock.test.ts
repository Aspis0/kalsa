/**
 * The welcome block as SOURCE, because this stack cannot render it (DESIGN.md,
 * "proof regime") — the same technique `shellLogoAsset.test.ts` uses for the
 * strip's raster. Three things would be invisible in a diff and fatal to the
 * user:
 *
 * 1. a wrong `require` path fails only at Metro's bundle time, and the block
 *    would ship without its picture (or with a broken one) — so the asset path
 *    is pulled out of the component and proven to exist, non-empty, with a
 *    JPEG signature;
 * 2. a card whose `onPress` does not reach the real send path would be the
 *    fake chip the owner forbade — so both halves of the wiring (block →
 *    `onSend`, surface → `sendHost.send`) are asserted;
 * 3. the gate must NOT live in the block (the host owns it) — if `historyLoaded`
 *    ever appears here, someone has moved the controller's gate to the wrong
 *    side of the seam.
 */
import { existsSync, readFileSync, statSync } from "fs";
import { join } from "path";

const read = (file: string): string => readFileSync(join(__dirname, file), "utf8");
const BLOCK = read("welcomeBlock.tsx");
const SURFACE = read("HostChatSurface.tsx");
/** The controller's plate, read for parity — read-only, never edited. */
const CHAT = readFileSync(join(__dirname, "..", "screens", "AiChatPage.tsx"), "utf8");

/** Comments removed, so prose that mentions the gate cannot satisfy (or fail)
 *  the code-level checks below. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

/** Every `require("<path>")` literal in the block, in source order. */
function requiredPaths(source: string): string[] {
  const paths: string[] = [];
  const pattern = /require\(\s*["']([^"']+)["']\s*\)/g;
  let match = pattern.exec(source);
  while (match !== null) {
    paths.push(match[1]);
    match = pattern.exec(source);
  }
  return paths;
}

const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);

describe("the welcome raster (the controller's own asset, Chat:191-194)", () => {
  const paths = requiredPaths(BLOCK);

  it("requires exactly one asset, so there is one thing to prove", () => {
    expect(paths).toHaveLength(1);
  });

  it("requires the path the controller required, and the file is on disk", () => {
    expect(paths[0]).toBe("../../assets/brand/light/empty-state.jpg");
    const asset = join(__dirname, String(paths[0]));
    expect(existsSync(asset)).toBe(true);
    expect(statSync(asset).isFile()).toBe(true);
    // A zero-byte or stub file renders as a broken plate, which is the defect.
    expect(statSync(asset).size).toBeGreaterThan(1024);
  });

  it("is a real JPEG, not a file that merely ends in .jpg", () => {
    const asset = join(__dirname, String(paths[0]));
    expect(readFileSync(asset).subarray(0, JPEG_MAGIC.length)).toEqual(JPEG_MAGIC);
  });

  it("degrades instead of breaking: the show-flag and the onError are both there", () => {
    const code = stripComments(BLOCK);
    expect(code).toContain("EMPTY_STATE_RASTER != null && !artFailed");
    expect(code).toMatch(/onError=\{\(\) => setArtFailed\(true\)\}/);
    // The image must be drawn only behind that flag — never bare.
    expect(code).toMatch(/\{showArt \? \(/);
  });
});

describe("a suggestion card sends for real (not into the field)", () => {
  it("the block fires onSend with the card's own text", () => {
    const code = stripComments(BLOCK);
    expect(code).toMatch(/onPress=\{\(\) => onSend\(suggestion\.text\)\}/);
    expect(code).toContain('testID={`chat.welcome.suggestion${index + 1}`}');
    expect(code).toContain('accessibilityRole="button"');
    expect(code).toContain("accessibilityLabel=");
  });

  it("the surface wires onSend to the existing send path, not to the draft", () => {
    const code = stripComments(SURFACE);
    expect(code).toMatch(/onSend=\{\(text\) => void sendHost\.send\(text\)\}/);
    // The fake the owner forbade: a card that only fills the composer.
    expect(code).not.toMatch(/onSend=\{[^}]*onDraftChange/);
  });

  it("the block is gated by the HOST with the controller's condition", () => {
    // The gate is `welcomeVisible(view.historyLoaded, …)` on the surface…
    expect(stripComments(SURFACE)).toMatch(
      /welcomeVisible\(view\.historyLoaded, view\.transcript\.length\)/,
    );
    // …and the block itself never learns the word: history is not its decision.
    expect(stripComments(BLOCK)).not.toContain("historyLoaded");
    // It reaches the transcript as its `empty` content — inside the band's own
    // scrolling content, never a fourth band.
    expect(stripComments(SURFACE)).toMatch(/<Transcript[^>]*empty=\{empty\}/);
  });

  it("is hour-gated copy, drawn from the pure module", () => {
    const code = stripComments(BLOCK);
    expect(code).toContain("greetingForHour(");
    expect(code).toContain("buildSuggestions(");
  });
});

/**
 * The plate's geometry, as source — because both defects that shaped it were
 * measured against pixels this stack cannot render, and each one is a layout
 * ENGINE behaviour no reader of the JSX would guess:
 *
 * 1. Yoga (the copy React Native 0.86 vendors, compiled standalone) resolves
 *    a `marginBottom` on an `aspectRatio` node BELOW its column: a 441.49 px
 *    column lays out a 430.67 px box, aspect intact — 8 dp of the card column
 *    gone from the box's right edge.
 * 2. React Native paints an absolutely-positioned image at the box's CONTENT
 *    size, anchored at the box origin, so padding on the box pulled another
 *    38.5 px (28 dp) off the photograph — right AND bottom.
 *
 * Stacked, they are the capture's 36 dp ragged edge (`host3-firstopen.png`:
 * the plate's paint ends at x=410 px, the cards reach x=460 px). So the box
 * carries neither margin nor padding, while the controller's composition
 * (AiChatPage:4033-4047) — 4:3, md inset, lg radius, xs gap, 70% cap — lives
 * on in the moved insets. These pins fail if anyone "restores" the original
 * style object and the ragged edge with it.
 */
describe("the plate's geometry: the controller's composition without the engine's traps", () => {
  const code = stripComments(BLOCK);
  const plateStyle =
    code.match(/style=\{\s*showArt\s*\?\s*\{[^}]*\}\s*:\s*undefined\s*\}/)?.[0] ?? "";

  it("the controller really does declare a 4:3 plate (the composition being reproduced)", () => {
    const controllerPlate =
      CHAT.match(/showEmptyArt\s*\?\s*\{[\s\S]*?aspectRatio: 4 \/ 3[\s\S]*?\n\s*\}/)?.[0] ?? "";
    // The match must actually be found: a line-number drift that hides the
    // block must fail here rather than pass by matching nothing.
    expect(controllerPlate.length).toBeGreaterThan(0);
    expect(controllerPlate).toContain("borderRadius: radius.lg");
    expect(controllerPlate).toContain("paddingHorizontal: spacing.md");
    expect(controllerPlate).toContain("paddingVertical: spacing.md");
    expect(controllerPlate).toContain("marginBottom: spacing.xs");
    expect(CHAT).toContain('maxWidth: showEmptyArt ? "70%" : undefined');
  });

  it("the host's plate box carries NEITHER margin NOR padding (trap 1 + trap 2)", () => {
    expect(plateStyle.length).toBeGreaterThan(0);
    expect(plateStyle).toContain("aspectRatio: 4 / 3");
    expect(plateStyle).toContain("borderRadius: radius.lg");
    expect(plateStyle).toContain('overflow: "hidden"');
    expect(plateStyle).not.toMatch(/margin|padding/);
  });

  it("both insets still exist, on nodes that cannot trigger the traps", () => {
    // The md inset moved onto the greeting text (same 14 dp from every edge of
    // the plate), the xs gap became the prompt's own margin-top (same 6 dp
    // between plate and prompt), and the 70% greeting cap stayed put.
    expect(code).toContain("padding: showArt ? spacing.md : 0");
    expect(code).toContain("marginTop: spacing.xs");
    expect(code).toContain('maxWidth: showArt ? "70%" : undefined');
  });

  it("no width, cap or side margin ever reaches the plate box (shared column edges)", () => {
    expect(plateStyle.length).toBeGreaterThan(0);
    // A width here would decouple the plate from the card column the cards
    // stretch to — the measured defect, restated as its inverse.
    expect(plateStyle).not.toMatch(/width|maxWidth|marginHorizontal|alignSelf/);
  });
});
