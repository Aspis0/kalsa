/**
 * The turn's recap line (PHONE-CHAT-PROTOCOL §3.2) is kept with its answer. It is saved
 * with the record like the other answer fields, and read back only as a valid line, so a
 * reopened chat shows the same line and a corrupt record shows none.
 */
import { buildPersistableMessages, sanitizeHistoryMessages } from "./historyMessages";

describe("the recap line survives save → disk → restore", () => {
  test("an answer's line is saved and read back as it was", () => {
    const saved = buildPersistableMessages([
      { id: "a1", role: "assistant", text: "fatto", createdAt: 1, recap: "Kalsa ha: aperto httpbin.org" },
    ]);
    const onDisk = JSON.parse(JSON.stringify(saved)) as unknown;
    const restored = sanitizeHistoryMessages(onDisk, "en");

    expect(restored).toHaveLength(1);
    expect(restored[0].recap).toBe("Kalsa ha: aperto httpbin.org");
  });

  test("a stored value that is not a valid line restores no line", () => {
    const onDisk = [
      { id: "a1", role: "assistant", text: "fatto", createdAt: 1, recap: 42 },
      { id: "a2", role: "assistant", text: "fatto", createdAt: 2, recap: "\u0000​" },
      { id: "a3", role: "assistant", text: "fatto", createdAt: 3, recap: "x".repeat(501) },
    ];
    const restored = sanitizeHistoryMessages(onDisk, "en");

    expect(restored).toHaveLength(3);
    for (const message of restored) expect(message).not.toHaveProperty("recap");
  });

  test("a line only ever belongs to an answer, never to what the person wrote", () => {
    const restored = sanitizeHistoryMessages(
      [{ id: "u1", role: "user", text: "ciao", createdAt: 1, recap: "Kalsa ha: niente" }],
      "en",
    );
    expect(restored[0]).not.toHaveProperty("recap");
  });
});
