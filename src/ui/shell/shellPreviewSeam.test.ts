/**
 * The pinned shell's bottom seam is PREVIEW chrome, and this is the check that
 * keeps it that way.
 *
 * The pinned case exists nowhere but in `ShellPreview`, so the seam that marks
 * the pinned shell's bottom edge must be drawn there and nowhere the running
 * interface renders — a hairline under the shell is harness affordance, and
 * `Shell.tsx` growing it would be the app acquiring chrome for a test. The
 * seam must also be inert and silent: a decorative line may not take touches
 * and may not become an accessibility node.
 *
 * A SOURCE check, the technique `transcriptMarkdownSource.test.ts` and
 * `sourceChipBox.test.ts` use: read the files, strip the comments (the prose
 * about a rule cannot satisfy the rule), and match the wiring. Every predicate
 * is exercised against a sample that must fail it, so a check that stopped
 * matching cannot pass as green.
 */
import { readFileSync } from "fs";
import { join } from "path";

const read = (file: string): string => readFileSync(join(__dirname, file), "utf8");

const PREVIEW = read("ShellPreview.tsx");
const SHELL = read("Shell.tsx");

/** Comments removed, so the comment that says "preview chrome" is not itself
 *  the thing proving the seam is preview chrome. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

/** The seam's own JSX element, from its `<View` back to its self-close. */
function seamBlockOrNull(source: string): string | null {
  const anchor = source.indexOf("previewStyles.seam");
  if (anchor < 0) return null;
  const start = source.lastIndexOf("<View", anchor);
  const end = source.indexOf("/>", anchor);
  if (start < 0 || end < 0) return null;
  return source.slice(start, end + 2);
}

/** Inert, and never announced: no press handlers, no roles, no names, and the
 *  subtree is explicitly excluded from accessibility. */
function isInertAndSilent(block: string): boolean {
  return (
    block.includes('pointerEvents="none"') &&
    block.includes('importantForAccessibility="no"') &&
    !/onPress|onStartShouldSetResponder|onTouch/.test(block) &&
    !/accessibilityRole|accessibilityLabel|accessible=\{true\}/.test(block)
  );
}

/** The seam exists only while a pin is in force — the case it exists for. */
function isGatedOnThePin(preview: string): boolean {
  return preview.includes("{pinned === undefined ? null : (");
}

/** The app's shell renders no seam of any kind. */
function appDrawsNoSeam(shell: string): boolean {
  return !/seam/i.test(shell);
}

describe("the pinned shell's bottom seam", () => {
  const preview = stripComments(PREVIEW);
  const shell = stripComments(SHELL);
  const block = seamBlockOrNull(preview);

  it("reads the two files it claims to read", () => {
    expect(PREVIEW).toContain("export function ShellPreview");
    expect(SHELL).toContain("export function Shell");
    expect(block).not.toBeNull();
    // Non-vacuous: the extracted element is the seam's, not a stray View.
    expect(block!).toContain("previewStyles.seam");
  });

  it("is drawn in the preview only, gated on the pin, and never by the app", () => {
    expect(isGatedOnThePin(preview)).toBe(true);
    expect(appDrawsNoSeam(shell)).toBe(true);
  });

  it("is inert and silent: no touches, no accessibility node", () => {
    expect(isInertAndSilent(block!)).toBe(true);
  });

  it("would catch a ported, interactive or announced seam", () => {
    expect(
      isInertAndSilent(
        '<View accessibilityRole="none" onPress={f} style={[previewStyles.seam, s]} />',
      ),
    ).toBe(false);
    expect(
      isInertAndSilent('<View pointerEvents="none" style={[previewStyles.seam]} />'),
    ).toBe(false);
    expect(isGatedOnThePin("<View style={[previewStyles.seam]} />")).toBe(false);
    expect(appDrawsNoSeam("const seam = 1;")).toBe(false);
    expect(seamBlockOrNull("<View style={{ flex: 1 }} />")).toBeNull();
  });
});
