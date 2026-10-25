/**
 * The stamp format: a fixed Date must produce the exact line the model is
 * shown, in English, from the LOCAL date parts — never UTC (a UTC render
 * near midnight stamps tomorrow for a UTC+ user) and never Intl (the line
 * is stored and replayed byte-identical; a locale-dependent month name
 * would make the replay diverge from the send).
 */
import { appendSentOnLine, formatSentOnLine } from "./sentOnLine";

describe("formatSentOnLine", () => {
  test("8 October 2026 renders as the canonical line", () => {
    expect(formatSentOnLine(new Date(2026, 9, 8, 23, 59))).toBe(
      "Sent on Thursday, 8 October 2026.",
    );
  });

  test("a second date, across a month boundary, keeps weekday and month consistent", () => {
    expect(formatSentOnLine(new Date(2026, 0, 5, 0, 1))).toBe(
      "Sent on Monday, 5 January 2026.",
    );
  });

  test("single-digit days carry no zero pad", () => {
    expect(formatSentOnLine(new Date(2025, 11, 31))).toBe(
      "Sent on Wednesday, 31 December 2025.",
    );
  });
});

describe("appendSentOnLine", () => {
  test("a stored stamp rides after the words, on its own line", () => {
    expect(appendSentOnLine("hello", "Sent on Thursday, 8 October 2026.")).toBe(
      "hello\n\nSent on Thursday, 8 October 2026.",
    );
  });

  test("an absent stamp leaves the text byte-identical (old turns)", () => {
    expect(appendSentOnLine("hello", undefined)).toBe("hello");
    expect(appendSentOnLine("hello", null)).toBe("hello");
  });
});
