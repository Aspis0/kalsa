import {
  normalizeMailCards,
  normalizeMailDraft,
  normalizeMailRead,
  senderLine,
} from "./mailPayload";

const ITEM = {
  id: "105",
  from: { name: "Banca", address: "no-reply@banca.it" },
  subject: "Bonifico in arrivo",
  gist: "Dicono che è un bonifico.",
  date: "oggi 09:12",
  labels: { label: "suspicious", reasons: ["display_spoof", "unknown_code"] },
};

describe("the mail a remote answer brings", () => {
  test("a card keeps what it draws and the reasons it warns with", () => {
    const cards = normalizeMailCards({ kind: "cards", items: [ITEM], bulk: 3 });
    expect(cards).toEqual({
      kind: "cards",
      items: [
        {
          id: "105",
          from: { name: "Banca", address: "no-reply@banca.it" },
          subject: "Bonifico in arrivo",
          gist: "Dicono che è un bonifico.",
          date: "oggi 09:12",
          label: "suspicious",
          reasons: ["display_spoof", "unknown_code"],
        },
      ],
      bulk: 3,
    });
  });

  test("a card the phone cannot act on is not drawn at all", () => {
    // No id: open and draft-a-reply act on it, so a card without one misleads.
    expect(normalizeMailCards({ kind: "cards", items: [{ ...ITEM, id: "" }] })).toBeNull();
    // No address: the card would say who wrote it and could not.
    expect(
      normalizeMailCards({ kind: "cards", items: [{ ...ITEM, from: { name: "Banca" } }] }),
    ).toBeNull();
    // Nothing to draw.
    expect(normalizeMailCards({ kind: "cards", items: [] })).toBeNull();
    expect(normalizeMailCards(null)).toBeNull();
  });

  test("a bulk count is a count, or it is nothing", () => {
    expect(normalizeMailCards({ kind: "cards", items: [ITEM], bulk: "3" })?.bulk).toBe(0);
    expect(normalizeMailCards({ kind: "cards", items: [ITEM], bulk: -2 })?.bulk).toBe(0);
    expect(normalizeMailCards({ kind: "cards", items: [ITEM], bulk: 4 })?.bulk).toBe(4);
  });

  test("a draft without a recipient or an id is not a draft", () => {
    expect(normalizeMailDraft({ draft_id: "abc", to: "m@x.it" })).toMatchObject({
      draftId: "abc",
      to: "m@x.it",
    });
    expect(normalizeMailDraft({ draft_id: "abc" })).toBeNull();
    expect(normalizeMailDraft({ to: "m@x.it" })).toBeNull();
  });

  test("an opened mail reads through the same card, body beside it", () => {
    const opened = normalizeMailRead({ record: ITEM, body: "Buongiorno" });
    expect(opened?.record.id).toBe("105");
    expect(opened?.body).toBe("Buongiorno");
    expect(normalizeMailRead({ record: { id: "105" }, body: "x" })).toBeNull();
  });

  test("a sender with no name is its address", () => {
    expect(senderLine({ name: "", address: "a@b.it" })).toBe("a@b.it");
    expect(senderLine({ name: "Banca", address: "a@b.it" })).toBe("Banca <a@b.it>");
  });
});