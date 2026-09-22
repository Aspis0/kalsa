/**
 * The send's text composition (`sendComposition.ts`) — each test names the
 * lie it catches: an attachment-only send that reaches the engine with an
 * empty string, doc hints in the wrong shape, or EITHER of the two vision
 * notices missing (or both, which the one-slot notice could not survive).
 */
import { composeSendText } from "./sendComposition";
import type { LocalAttachment } from "./hostMessage";

const image: LocalAttachment = { id: "i", kind: "image", name: "a.jpg", uri: "file:///a" };
const doc: LocalAttachment = {
  id: "d",
  kind: "document",
  name: "fisica.pdf",
  uri: "",
  libraryDocId: "doc-7",
};
const pdfPage: LocalAttachment = {
  id: "p",
  kind: "pdf",
  name: "paper.pdf",
  uri: "file:///p",
  pages: ["file:///p1"],
  pageCount: 1,
};
const pdfNoPages: LocalAttachment = { id: "p2", kind: "pdf", name: "q.pdf", uri: "file:///q" };

const base = {
  research: false,
  visionCapable: true,
  attachedFileLabel: "Look at the attached file.",
};

describe("the model-facing text (Chat:2471-2477)", () => {
  it("typed words pass through untouched when nothing needs annotating", () => {
    expect(composeSendText({ ...base, trimmed: "what is entropy", attachments: [] })).toEqual({
      modelText: "what is entropy",
      notice: null,
    });
  });

  it("an attachment-only send falls back to the controller's attached-file line, never \"\"", () => {
    const out = composeSendText({ ...base, trimmed: "", attachments: [image] });
    expect(out.modelText).toBe("Look at the attached file.");
  });

  it("doc hints annotate the question, on their own line, in the controller's shape", () => {
    const out = composeSendText({ ...base, trimmed: "summarize this", attachments: [doc] });
    expect(out.modelText).toBe('summarize this\n\n[document:doc-7 name="fisica.pdf"]');
  });

  it("an attachment-only send with a document still reaches the engine as the hint alone", () => {
    const out = composeSendText({ ...base, trimmed: "", attachments: [doc] });
    expect(out.modelText).toBe('[document:doc-7 name="fisica.pdf"]');
  });

  it("research keeps its question ahead of the hints", () => {
    const out = composeSendText({
      ...base,
      research: true,
      trimmed: "deep research corals",
      attachments: [doc],
    });
    expect(out.modelText).toBe('corals\n\n[document:doc-7 name="fisica.pdf"]');
  });

  it("an image alone adds no hint line — the fallback carries the empty caption", () => {
    const out = composeSendText({ ...base, trimmed: "", attachments: [image, pdfPage] });
    expect(out.modelText).toBe("Look at the attached file.");
  });
});

describe("exactly ONE notice, and only the right one (Chat:2438-2468)", () => {
  it("vision input on a blind model → visionUnsupportedNotice", () => {
    expect(
      composeSendText({ ...base, visionCapable: false, trimmed: "look", attachments: [image] })
        .notice,
    ).toBe("chat.visionUnsupportedNotice");
    expect(
      composeSendText({
        ...base,
        visionCapable: false,
        trimmed: "",
        attachments: [pdfPage],
      }).notice,
    ).toBe("chat.visionUnsupportedNotice");
  });

  it("research over vision input on a SEEING model → deepResearchIgnoringImages", () => {
    expect(
      composeSendText({
        ...base,
        research: true,
        trimmed: "deep research corals",
        attachments: [image],
      }).notice,
    ).toBe("chat.deepResearchIgnoringImages");
  });

  it("blind + research yields ONLY the unsupported line — the one-slot notice cannot carry two", () => {
    expect(
      composeSendText({
        ...base,
        visionCapable: false,
        research: true,
        trimmed: "deep research corals",
        attachments: [image],
      }).notice,
    ).toBe("chat.visionUnsupportedNotice");
  });

  it("no vision input → no notice, research or not (documents and page-less PDFs are not vision)", () => {
    expect(composeSendText({ ...base, trimmed: "hi", attachments: [doc] }).notice).toBeNull();
    expect(
      composeSendText({ ...base, trimmed: "hi", attachments: [pdfNoPages] }).notice,
    ).toBeNull();
    expect(
      composeSendText({
        ...base,
        research: true,
        trimmed: "deep research x",
        attachments: [doc],
      }).notice,
    ).toBeNull();
  });
});
