/**
 * The validator is the one door history passes on its way to a send: the
 * pictures a user turn was sent with must survive it as the URIs they are
 * stored under, or the remote wire has nothing to show for an old turn.
 */
jest.mock("@react-native-async-storage/async-storage", () => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
  removeItem: jest.fn(async () => undefined),
}));

import { validateHistoryMessages } from "./turnCorpus";
import { assembleEngineHistory } from "../context/compactor";

describe("history keeps a user turn's pictures, as URIs", () => {
  test("image rows and rendered PDF pages travel with the turn, capped at five", () => {
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

    expect(messages[0].images).toEqual(["file:///a.jpg", "file:///p1.jpg", "file:///p2.jpg"]);
    expect(messages[1].images).toBeUndefined();
    expect(messages[2].images).toBeUndefined();
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
