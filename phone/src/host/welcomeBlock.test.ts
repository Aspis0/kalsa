/** The v2 empty state is a full-width photograph, or a same-size tint block. */
import { existsSync, readFileSync, statSync } from "fs";
import { join } from "path";

const read = (file: string) => readFileSync(join(__dirname, file), "utf8");
const BLOCK = read("welcomeBlock.tsx");
const SURFACE = read("HostChatSurface.tsx");
const TRANSCRIPT = read("../ui/shell/Transcript.tsx");
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);
const clean = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

describe("the photo-only first-open block", () => {
  it("bundles the real JPEG used by the rendered target", () => {
    const match = BLOCK.match(/require\("([^\"]+)"\)/);
    expect(match?.[1]).toBe("../../assets/brand/light/empty-state.jpg");
    const path = join(__dirname, String(match?.[1]));
    expect(existsSync(path)).toBe(true);
    expect(statSync(path).size).toBeGreaterThan(1024);
    expect(readFileSync(path).subarray(0, JPEG_MAGIC.length)).toEqual(JPEG_MAGIC);
  });

  it("fills the transcript column at 4:3 with a 16 dp image radius", () => {
    const code = clean(BLOCK);
    expect(code).toContain('width: "100%"');
    expect(code).toContain("aspectRatio: 4 / 3");
    expect(code).toContain("borderRadius: radius.image");
    expect(code).toContain("backgroundColor: colors.tint");
    expect(code).not.toMatch(/padding|margin/);
  });

  it("shows only the image: no greeting, prompt, suggestions, or overlay text", () => {
    const code = clean(BLOCK);
    expect(code).toContain('testID="chat.welcome"');
    expect(code).not.toMatch(/\b(Text|Pressable)\b/);
    expect(code).not.toContain("greeting");
    expect(code).not.toContain("suggestion");
    expect(code).toContain('accessible={false}');
    expect(code).toContain('importantForAccessibility="no"');
  });

  it("falls back to the same rounded tint block if Metro or decoding fails", () => {
    expect(BLOCK).toContain("EMPTY_STATE_RASTER !== undefined && !artFailed");
    expect(clean(BLOCK)).toMatch(/onError=\{\(\) => setArtFailed\(true\)\}/);
    expect(clean(BLOCK)).toMatch(/showArt \? \([\s\S]*?<Image[\s\S]*?\) : null/);
  });
});

describe("the host owns the empty-history gate and transcript placement", () => {
  it("waits for settled empty history, then mounts the photo inside Transcript", () => {
    expect(clean(SURFACE)).toContain("welcomeVisible(view.historyLoaded, view.transcript.length)");
    expect(clean(SURFACE)).toContain("<WelcomeBlock mode={mode} />");
    expect(clean(SURFACE)).toMatch(/<Transcript[^>]*empty=\{empty\}/);
    expect(clean(TRANSCRIPT)).toContain("? empty");
    expect(clean(SURFACE)).not.toContain("onSend=");
  });
});
