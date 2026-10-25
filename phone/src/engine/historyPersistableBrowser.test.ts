import { toPersistableHistoryMessages } from "./historyPersistable";

/**
 * A held browser request is a stranger's site, a stranger's method and a
 * stranger's values (PHONE-CHAT-PROTOCOL §6). It lives in memory while the
 * person may still answer it and never reaches the disk — not the card, not the
 * secret value inside it, not the address it would have gone to.
 */
const CARD_ID = "3f9c1a77e2b04d5681aa90c3b7e4412d";

const BROWSER_CARD = {
  card: {
    cardId: CARD_ID,
    method: "POST",
    url: "https://shop.example/checkout?passphrase_2=hunter2",
    fields: [{ name: "passphrase_2", value: "hunter2", secret: true }],
    deadlineAtMs: 1767225900000,
  },
};

describe("a held browser request never reaches the phone's disk", () => {
  test("the answer is stored, the card is not", () => {
    const stored = toPersistableHistoryMessages([
      {
        id: "m1",
        role: "assistant",
        text: "ti chiedo prima di inviare",
        browserCards: [BROWSER_CARD],
      },
    ] as never);
    expect(stored).toHaveLength(1);
    const message = stored[0] as Record<string, unknown>;
    expect(message.text).toBe("ti chiedo prima di inviare");
    expect(message.browserCards).toBeUndefined();
  });

  test("nothing of the card survives in the stored text either", () => {
    const stored = toPersistableHistoryMessages([
      {
        id: "m1",
        role: "assistant",
        text: "va bene",
        browserCards: [BROWSER_CARD],
      },
    ] as never);
    expect(JSON.stringify(stored)).not.toContain("hunter2");
    expect(JSON.stringify(stored)).not.toContain("shop.example");
    expect(JSON.stringify(stored)).not.toContain(CARD_ID);
  });

  test("an answer that never raised a card is untouched by the strip", () => {
    const stored = toPersistableHistoryMessages([
      { id: "m1", role: "assistant", text: "va bene" },
    ] as never);
    expect((stored[0] as Record<string, unknown>).text).toBe("va bene");
  });

  test("a card that was answered is dropped whole, fate and all", () => {
    const stored = toPersistableHistoryMessages([
      {
        id: "m1",
        role: "assistant",
        text: "fatto",
        browserCards: [{ ...BROWSER_CARD, outcome: { code: "sent", host: "shop.example" } }],
      },
    ] as never);
    expect((stored[0] as Record<string, unknown>).browserCards).toBeUndefined();
  });
});