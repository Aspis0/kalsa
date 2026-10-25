import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

import { GUIDE_HTML } from "./guide";

const DEFAULT_MARKDOWN = path.resolve(__dirname, "../../../kalsa-brain/docs/ALPHA-TESTERS.md");
const markdownPath = process.env.ALPHA_TESTERS_MD ?? DEFAULT_MARKDOWN;

// CI checks out this repo alone, and the tester guide lives in kalsa-brain. The
// release gate (release.mjs) runs the same --check locally, so the skip is
// announced here and never silent.
const markdownFound = existsSync(markdownPath);
if (!markdownFound) {
  // Written to stderr: jest's console capture hides console output in a
  // multi-project run, and the skip must show in the CI log.
  process.stderr.write(
    `SKIPPED guide --check: tester guide markdown not found at ${markdownPath}; set ALPHA_TESTERS_MD to its path. release.mjs still enforces it.\n`,
  );
}
const describeWithMarkdown = markdownFound ? describe : describe.skip;

describeWithMarkdown("guide.ts is generated from the tester guide", () => {
  test("committed guide.ts matches what the markdown produces", () => {
    const res = spawnSync(process.execPath, ["scripts/build-guide.mjs", markdownPath, "--check"], {
      cwd: __dirname,
      encoding: "utf8",
    });
    expect({ status: res.status, stderr: res.stderr }).toEqual({ status: 0, stderr: "" });
  });
});

describe("guide content", () => {
  test("sections 1-6 and 8 in order, each with its anchor; 7 is dropped", () => {
    const ids = [...GUIDE_HTML.matchAll(/<h2 id="([^"]+)">/g)].map((m) => m[1]);
    expect(ids).toEqual(["requirements", "mac", "windows", "first-start", "phone", "problems", "uninstall"]);
    expect(GUIDE_HTML).not.toContain("Download Kalsa at");
  });

  test("the install sections carry the #mac and #windows anchors", () => {
    expect(GUIDE_HTML).toContain('<h2 id="mac">2. Install on Mac</h2>');
    expect(GUIDE_HTML).toContain('<h2 id="windows">3. Install on Windows</h2>');
  });

  test("the phone section only says the apps come later", () => {
    expect(GUIDE_HTML).toContain('<h2 id="phone">5. Phone</h2>\n<p>The Kalsa apps for Android and iOS will be released later.</p>');
    expect(GUIDE_HTML).not.toContain("<!--");
  });

  test("no markdown syntax survives the conversion", () => {
    expect(GUIDE_HTML).not.toContain("**");
    expect(GUIDE_HTML).not.toContain("`");
    expect(GUIDE_HTML).not.toMatch(/^#/m);
    expect(GUIDE_HTML).not.toContain("[Guide text pending]");
  });

  test("lists, quotes, code and bold are rendered", () => {
    expect(GUIDE_HTML).toContain("<ol><li>");
    expect(GUIDE_HTML).toContain("<ul><li>");
    expect(GUIDE_HTML).toContain("<blockquote><p>During the alpha");
    expect(GUIDE_HTML).toContain("<code>~/Library/Logs/ai.kalsa.brain/</code>");
    expect(GUIDE_HTML).toContain("<strong>System Settings → Privacy &amp; Security</strong>");
  });

  test("the guide itself makes no network reference", () => {
    expect(GUIDE_HTML).not.toMatch(/https?:\/\//);
    expect(GUIDE_HTML).not.toContain("<script");
  });
});
