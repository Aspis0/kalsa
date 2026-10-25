/**
 * The never-empty floor, as a pure function: what the turn shows when the
 * model would not say anything in words.
 *
 * The failure this closes (iPhone log, LFM2.5 2.6B) was a web turn that
 * gathered good sources and still closed on "Generazione interrotta." — an
 * interruption that never happened, over work the turn had already paid for.
 */

import { buildSourcesAnswer } from "./answerFloor";

const LEAD = "Here's what I found:";

describe("buildSourcesAnswer", () => {
  test("a lead line and one line per source, title then URL", () => {
    expect(
      buildSourcesAnswer(
        [
          { title: "Capital of Madagascar", url: "https://example.org/a" },
          { title: "Antananarivo", url: "https://example.org/b" },
        ],
        LEAD,
      ),
    ).toBe(
      `${LEAD}\nCapital of Madagascar — https://example.org/a\nAntananarivo — https://example.org/b`,
    );
  });

  test("empty for no sources, so the caller keeps its canned message", () => {
    expect(buildSourcesAnswer([], LEAD)).toBe("");
    expect(buildSourcesAnswer(undefined, LEAD)).toBe("");
  });

  test("empty when no source is renderable at all", () => {
    // Source objects are tool output: shape is best-effort, never a contract.
    expect(buildSourcesAnswer([{}, null, "junk", 7], LEAD)).toBe("");
    expect(buildSourcesAnswer([{ title: "   ", url: "  " }], LEAD)).toBe("");
  });

  test("a source with only a URL, or only a title, still gets a line", () => {
    expect(buildSourcesAnswer([{ url: "https://example.org/only-url" }], LEAD)).toBe(
      `${LEAD}\nhttps://example.org/only-url`,
    );
    expect(buildSourcesAnswer([{ title: "Only a title" }], LEAD)).toBe(
      `${LEAD}\nOnly a title`,
    );
  });

  test("a blank lead line does not leave a hole at the top of the bubble", () => {
    expect(buildSourcesAnswer([{ url: "https://example.org/a" }], "   ")).toBe(
      "https://example.org/a",
    );
  });

  test("capped: a floor, not a reading list", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      title: `Source ${i}`,
      url: `https://example.org/${i}`,
    }));
    const out = buildSourcesAnswer(many, LEAD);
    expect(out.split("\n")).toHaveLength(6); // lead + 5
    expect(out).toContain("Source 4");
    expect(out).not.toContain("Source 5");
  });

  test("unrenderable entries do not spend a slot on the cap", () => {
    const out = buildSourcesAnswer(
      [{ title: "" }, {}, { title: "Real", url: "https://example.org/r" }],
      LEAD,
    );
    expect(out).toBe(`${LEAD}\nReal — https://example.org/r`);
  });
});

describe("a floor is a list, so it has no repeats in it", () => {
  test("the same page twice is one line, whichever way the URL is spelled", () => {
    const out = buildSourcesAnswer(
      [
        { title: "Madagascar", url: "https://example.org/a" },
        { title: "Madagascar (alt)", url: "https://Example.org/a#section" },
        { title: "Different page", url: "https://example.org/b" },
      ],
      LEAD,
    );
    expect(out.split("\n")).toEqual([
      LEAD,
      "Madagascar — https://example.org/a",
      "Different page — https://example.org/b",
    ]);
  });

  test("trailing punctuation glued to a URL is not a second source", () => {
    expect(
      buildSourcesAnswer(
        [
          { title: "One", url: "https://example.org/a" },
          { title: "One again", url: "https://example.org/a." },
        ],
        LEAD,
      ).split("\n"),
    ).toEqual([LEAD, "One — https://example.org/a"]);
  });

  test("a URL-less card repeated by title is one line", () => {
    // The ledger keys on URL alone, so it cannot collapse this one.
    const out = buildSourcesAnswer(
      [{ title: "Report 2026" }, { title: "report  2026" }, { title: "Other" }],
      LEAD,
    );
    expect(out.split("\n")).toEqual([LEAD, "Report 2026", "Other"]);
  });
});

describe("titles are labels, not documents", () => {
  test("newlines and runs of whitespace collapse to one line", () => {
    expect(
      buildSourcesAnswer(
        [{ title: "  Weekly\n\twrap-up\r\n  for the  city  ", url: "https://example.org/a" }],
        LEAD,
      ),
    ).toBe(`${LEAD}\nWeekly wrap-up for the city — https://example.org/a`);
  });

  test("a very long title is cut with an ellipsis", () => {
    const long = "x".repeat(400);
    const line = buildSourcesAnswer([{ title: long, url: "https://example.org/a" }], LEAD)
      .split("\n")[1];
    expect(line).toContain("…");
    expect(line.split(" — ")[0].length).toBe(100);
  });
});