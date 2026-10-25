/**
 * The links-as-text mark on an answer from the computer's turn route. It is
 * persisted (`historyPersistable.ts` keeps the record's own fields), and the
 * loader must read it back, or a reload makes a link from a mail the model
 * read tappable again.
 */
import { buildPersistableMessages, sanitizeHistoryMessages } from "./historyMessages";

describe("the links-as-text mark survives save → disk → restore", () => {
  test("an answer marked linksAsText stays marked", () => {
    const saved = buildPersistableMessages([
      { id: "a1", role: "assistant", text: "vedi [qui](https://x.it)", createdAt: 1, linksAsText: true },
    ]);
    const onDisk = JSON.parse(JSON.stringify(saved)) as unknown;
    const restored = sanitizeHistoryMessages(onDisk, "en");

    expect(restored).toHaveLength(1);
    expect(restored[0].linksAsText).toBe(true);
  });

  test("a stored value other than strict true restores no mark", () => {
    const onDisk = [
      { id: "a1", role: "assistant", text: "vedi [qui](https://x.it)", createdAt: 1, linksAsText: "yes" },
    ];
    const restored = sanitizeHistoryMessages(onDisk, "en");

    expect(restored).toHaveLength(1);
    expect(restored[0]).not.toHaveProperty("linksAsText");
  });

  test("a user record never restores the mark", () => {
    const onDisk = [{ id: "u1", role: "user", text: "leggi la mail", createdAt: 1, linksAsText: true }];
    const restored = sanitizeHistoryMessages(onDisk, "en");

    expect(restored).toHaveLength(1);
    expect(restored[0]).not.toHaveProperty("linksAsText");
  });
});
