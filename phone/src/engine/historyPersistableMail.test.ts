import { toPersistableHistoryMessages } from "./historyPersistable";

const MAIL_CARDS = {
  kind: "cards",
  items: [{ id: "105", from: { name: "Banca", address: "a@b.it" } }],
  bulk: 0,
};

const MAIL_DRAFT = { draftId: "abc", replyToId: "105", to: "a@b.it", body: "va bene" };

describe("mail never reaches the phone's disk", () => {
  test("the answer is stored, the cards and the draft are not", () => {
    const stored = toPersistableHistoryMessages([
      {
        id: "m1",
        role: "assistant",
        text: "hai 2 mail",
        mail: MAIL_CARDS,
        mailDraft: MAIL_DRAFT,
      },
    ]);
    expect(stored).toHaveLength(1);
    const message = stored[0] as Record<string, unknown>;
    expect(message.text).toBe("hai 2 mail");
    expect(message.mail).toBeUndefined();
    expect(message.mailDrafts).toBeUndefined();
  });

  test("an answer without mail is untouched by the strip", () => {
    const stored = toPersistableHistoryMessages([
      { id: "m1", role: "assistant", text: "ciao" },
    ]);
    expect(stored).toEqual([{ id: "m1", role: "assistant", text: "ciao" }]);
  });

  test("the link mark stays: a reopened turn-route answer is still turn-route", () => {
    const stored = toPersistableHistoryMessages([
      { id: "m1", role: "assistant", text: "vedi [qui](https://x.it)", linksAsText: true },
    ]) as Record<string, unknown>[];
    expect(stored[0].linksAsText).toBe(true);
  });
});