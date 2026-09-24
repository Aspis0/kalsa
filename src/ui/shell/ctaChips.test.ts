/**
 * D1 row 26: the CTA chips are drawn, and they are TEXT, not buttons. Three
 * silent failures this pins: the chip becoming a pressable with no action
 * behind it, the field never reaching the band, or its label being lost by
 * the host-to-transcript projection.
 */
import { readFileSync } from "fs";
import { join } from "path";
import { toTranscriptMessage } from "../../host/messageMapper";

const read = (file: string): string => readFileSync(join(__dirname, file), "utf8");
const TURNS = read("TranscriptTurns.tsx");
const TRANSCRIPT = read("Transcript.tsx");
const TYPES = read("transcriptTypes.ts");

/** Comments removed, so the prose saying "not a button" cannot pass the check. */
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

describe("the CTA renderer under the answer", () => {
  const code = stripComments(TURNS);
  const start = code.indexOf("ctas && ctas.length > 0");
  const end = code.indexOf("{stop ?", start);
  const block = start >= 0 && end > start ? code.slice(start, end) : "";

  it("exists, after the sources and before the stop line", () => {
    // A reader that finds nothing makes every assertion below vacuous.
    expect(block.length).toBeGreaterThan(0);
    expect(code.indexOf("{stop ?")).toBeGreaterThan(start);
  });

  it("each chip is a named, labelled text node with a stable testID", () => {
    expect(block).toContain('accessibilityRole="text"');
    expect(block).toContain("accessibilityLabel={cta.label}");
    expect(block).toContain("testID={`transcript.cta.");
    expect(block).toContain("styles.ctaRow");
  });

  it("the chip carries NO press — a control that does nothing never ships", () => {
    expect(block).not.toContain("Pressable");
    expect(block).not.toContain("onPress");
    // Sample: the two checks above are not vacuous.
    expect(/onPress/.test('<Pressable onPress={() => undefined} ctas &&')).toBe(true);
  });

  it("the band hands the mapper's field to the answer, and the type carries it", () => {
    expect(TRANSCRIPT).toContain("ctas={message.ctas}");
    expect(TYPES).toContain("ctas?: readonly TranscriptCta[]");
  });

  it("a mapped CTA keeps its spoken label while the new renderer exposes no action", () => {
    const mapped = toTranscriptMessage(
      { id: "a1", role: "assistant", text: "Ready", createdAt: 1, ctas: [
        { kind: "output", label: "Open report", id: "output-1" },
      ] },
      { thinkingStatus: "Thinking" },
    );
    expect(mapped.ctas).toEqual([{ label: "Open report", kind: "output", id: "output-1" }]);
    expect(block).not.toContain("Pressable");
    expect(block).not.toContain("onPress");
  });
});
