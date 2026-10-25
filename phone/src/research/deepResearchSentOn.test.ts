/**
 * The planner reads the turn's date line after the question, the same way a
 * chat turn does; retrieval keeps the bare question so the stamp never becomes
 * a search term.
 */
jest.mock("../documents/DocumentLibrary", () => ({ formatPassageCitation: jest.fn(() => "") }));

import type { LibraryDoc } from "../documents/DocumentLibrary";
import { runDeepResearch, type DeepResearchCompleteOnce } from "./deepResearch";

const STAMP = "Sent on Thursday, 8 October 2026.";

const doc = { id: "doc-1", sourceId: "doc-1", name: "notes.pdf" } as unknown as LibraryDoc;

describe("deep research reads the date line", () => {
  test("the planner's user prompt ends with the stamp, after a blank line", async () => {
    const completeOnce = jest.fn<ReturnType<DeepResearchCompleteOnce>, Parameters<DeepResearchCompleteOnce>>(
      async () => ({ text: "", aborted: false }),
    );
    await runDeepResearch({
      question: "what does the library say about rivers",
      sentOn: STAMP,
      locale: "en",
      docs: [doc],
      execute: jest.fn(async () => ({ strategy: "error", error: "none" })) as never,
      completeOnce,
      nCtx: 4096,
    });
    expect(completeOnce.mock.calls[0][0].user).toBe(
      `what does the library say about rivers\n\n${STAMP}`,
    );
  });
});
