/**
 * The mapper's picture half: whether a user turn's attachments cross as
 * images (only when the host says they rode), how PDF pages become rows in
 * order, and that a restored row never draws a source it no longer has. The
 * rest of the mapper's rules live in `messageMapper.test.ts`.
 */
import { en } from "../i18n/en";
import { toTranscriptMessage, toTranscriptMessages, type MapperOptions } from "./messageMapper";
import type { Message } from "./hostMessage";

const opts = (extra?: Partial<MapperOptions>): MapperOptions => ({
  thinkingStatus: en.chat.thinkingStatus as string,
  ...extra,
});

const base = (over: Partial<Message>): Message => ({
  id: "m1",
  role: "user",
  text: "hello",
  createdAt: 1_700_000_000_000,
  ...over,
});

describe("the pictures a user turn was sent with", () => {
  const withRows = base({
    attachments: [
      { id: "i", kind: "image", name: "a.jpg", uri: "file:///a.jpg" },
      { id: "d", kind: "document", name: "n.docx", uri: "", libraryDocId: "doc" },
      { id: "p", kind: "pdf", name: "p.pdf", uri: "file:///p.pdf", pages: ["file:///p1.jpg", "file:///p2.jpg"] },
    ],
  });

  test("crosses only when the host says they rode, images and PDF pages in row order", () => {
    expect(toTranscriptMessage(withRows, opts()).images).toBeUndefined();
    expect(toTranscriptMessage(withRows, opts({ showImages: true })).images).toEqual([
      { id: "i", name: "a.jpg", uri: "file:///a.jpg" },
      { id: "p-0", name: "p.pdf", uri: "file:///p1.jpg" },
      { id: "p-1", name: "p.pdf", uri: "file:///p2.jpg" },
    ]);
  });

  test("a restored row keeps its name and no URI: nothing is drawn, never an empty source", () => {
    const restored = base({
      attachments: [{ id: "i", kind: "image", name: "a.jpg", uri: "" }],
    });
    expect(toTranscriptMessage(restored, opts({ showImages: true })).images).toBeUndefined();
  });

  test("the mapping cache is keyed on the flag: flipping it re-maps the same message", () => {
    const shown = toTranscriptMessages([withRows], opts({ showImages: true }))[0];
    const hidden = toTranscriptMessages([withRows], opts({ showImages: false }))[0];
    expect(shown.images).toHaveLength(3);
    expect(hidden.images).toBeUndefined();
  });
});
