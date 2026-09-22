/**
 * The inline "more" chip (gap 10 / row 16's last delta): pinned as ABSENT
 * WITH ITS REASON where the chip row lives, because the decision is only
 * worth anything if the next reader finds it — and because a chip whose
 * press duplicates the 350 ms hold would be a second door to the same room.
 */
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

const read = (path: string): string => readFileSync(path, "utf8");

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

const CHIPS = read(join(__dirname, "..", "ui", "shell", "TranscriptChips.tsx"));
const CHIPS_CODE = stripComments(CHIPS);

/** Every .ts/.tsx under the two new-app trees, so the absence is a walk. */
function sourcesUnder(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...sourcesUnder(path));
    else if (/\.tsx?$/.test(entry.name)) found.push(path);
  }
  return found;
}

describe("the chip row draws copy and read-aloud, and no third chip", () => {
  it("exactly the two shipped chips: copy and speak, both named boxes", () => {
    expect(CHIPS_CODE).toContain("transcript.copy.");
    expect(CHIPS_CODE).toContain("transcript.speak.");
    expect(CHIPS_CODE).not.toContain("transcript.more.");
    expect(CHIPS_CODE).toContain("styles.actionChipBox");
    // sample: the predicate fails on a row that added the chip
    expect("testID={`transcript.more.${id}`}".includes("transcript.more.")).toBe(true);
  });

  it("nothing in the new app consumes the controller's chat.more label", () => {
    const trees = [
      join(__dirname, "..", "host"),
      join(__dirname, "..", "ui", "shell"),
    ];
    const consumers = trees
      .flatMap((tree) => sourcesUnder(tree))
      .filter((path) => !path.endsWith(".test.ts") && read(path).includes("chat.more"));
    expect(consumers).toEqual([]);
    // sample: the predicate is the key, not the word
    expect('"chat.moreButton"'.includes('"chat.more"')).toBe(false);
  });

  it("the reason is recorded where the chip row lives: same handler as the hold, byte-identical", () => {
    expect(CHIPS).toContain("`Chat:5593-5624`");
    expect(CHIPS).toContain("second door to the same room");
    expect(CHIPS).toContain("`Chat:5332,5395`");
    // sample: prose that names the chip without the identical-handler reason
    // would fail the third needle.
    expect(CHIPS.includes("byte-identical")).toBe(true);
  });
});
