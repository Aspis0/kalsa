/**
 * The validator is the one door history passes on its way to a send: the
 * pictures a user turn was sent with must survive it as the URIs they are
 * stored under, or the remote wire has nothing to show for an old turn. Only
 * what that wire may carry survives — a document's rendered pages never
 * cross, so they are not stored to ride later.
 */
jest.mock("@react-native-async-storage/async-storage", () => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
  removeItem: jest.fn(async () => undefined),
}));

import { validateHistoryMessages } from "./turnCorpus";
import { assembleEngineHistory } from "../context/compactor";

describe("history keeps a user turn's pictures, as URIs", () => {
  test("image rows travel with the turn; a document's PDF pages never do", () => {
    const messages = validateHistoryMessages([
      {
        role: "user",
        text: "look",
        attachments: [
          { id: "i", kind: "image", name: "a.jpg", uri: "file:///a.jpg" },
          { id: "p", kind: "pdf", name: "p.pdf", uri: "file:///p.pdf", pages: ["file:///p1.jpg", "file:///p2.jpg"] },
          { id: "d", kind: "document", name: "n.docx", uri: "", libraryDocId: "doc" },
        ],
      },
      { role: "assistant", text: "ok" },
      { role: "user", text: "and this" },
    ]);

    expect(messages[0].images).toEqual(["file:///a.jpg"]);
    expect(messages[1].images).toBeUndefined();
    expect(messages[2].images).toBeUndefined();
  });

  test("the wire's own five-picture cap holds at this door too", () => {
    const attachments = Array.from({ length: 6 }, (_, i) => ({
      id: `i${i}`,
      kind: "image" as const,
      name: `a${i}.jpg`,
      uri: `file:///a${i}.jpg`,
    }));
    const [user] = validateHistoryMessages([{ role: "user", text: "look", attachments }]);
    expect(user.images).toEqual(attachments.slice(0, 5).map((a) => a.uri));
  });

  test("the assembly carries them into the engine window", () => {
    const [user] = validateHistoryMessages([
      {
        role: "user",
        text: "look",
        attachments: [{ id: "i", kind: "image", name: "a.jpg", uri: "file:///a.jpg" }],
      },
    ]);
    const assembled = assembleEngineHistory([user], {
      compactionEnabled: false,
      hasImages: true,
      legacyWindowStart: 0,
    });
    expect(assembled).toEqual([
      { role: "user", content: "look", images: ["file:///a.jpg"] },
    ]);
  });
});
