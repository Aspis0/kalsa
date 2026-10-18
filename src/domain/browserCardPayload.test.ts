import {
  cleanLabel,
  readDestination,
  isBrowserCardExpired,
  monotonicNowMs,
  normalizeBrowserCard,
  normalizeBrowserOutcome,
  readBrowserAnswer,
  SECRET_DOTS,
  utf8Length,
} from "./browserCardPayload";

const CARD_ID = "3f9c1a77e2b04d5681aa90c3b7e4412d";

function wire(over: Record<string, unknown> = {}) {
  return {
    card_id: CARD_ID,
    method: "POST",
    url: "https://shop.example/checkout",
    fields: [
      { name: "size", value: "L", secret: false },
      { name: "passphrase_2", value: "hunter2", secret: true },
    ],
    asked_at_ms: 1767225600000,
    answer_in_ms: 300000,
    ...over,
  };
}

describe("a held request, kept only in the shape a card draws", () => {
  test("a card the contract names is read whole, the secret value included", () => {
    const card = normalizeBrowserCard(wire());
    expect(card).not.toBeNull();
    expect(card!.cardId).toBe(CARD_ID);
    expect(card!.method).toBe("POST");
    expect(card!.fields).toEqual([
      { name: "size", label: null, value: "L", secret: false },
      { name: "passphrase_2", label: null, value: "hunter2", secret: true },
    ]);
  });

  test("a card nobody could answer is dropped, not drawn broken", () => {
    // No id: every button on the card acts on it.
    expect(normalizeBrowserCard(wire({ card_id: "" }))).toBeNull();
    expect(normalizeBrowserCard(wire({ card_id: "not-hex-at-all-0000000000000000" }))).toBeNull();
    expect(normalizeBrowserCard(wire({ method: "" }))).toBeNull();
    expect(normalizeBrowserCard(wire({ url: "" }))).toBeNull();
    expect(normalizeBrowserCard(wire({ answer_in_ms: undefined }))).toBeNull();
    expect(normalizeBrowserCard(wire({ fields: "size=L" }))).toBeNull();
    expect(normalizeBrowserCard(null)).toBeNull();
    expect(normalizeBrowserCard([{ card_id: CARD_ID }])).toBeNull();
  });

  test("one field over its cap refuses the WHOLE card: a payload shown short is a lie", () => {
    const long = "x".repeat(8 * 1024 + 1);
    expect(
      normalizeBrowserCard(wire({ fields: [{ name: "body", value: long, secret: false }] })),
    ).toBeNull();
    expect(
      normalizeBrowserCard(
        wire({
          fields: [
            { name: "size", value: "L", secret: false },
            { name: "note", value: long, secret: false },
          ],
        }),
      ),
    ).toBeNull();
    // At the cap it is kept: the value is what the site would really receive.
    expect(
      normalizeBrowserCard(
        wire({ fields: [{ name: "body", value: "x".repeat(8 * 1024), secret: false }] }),
      ),
    ).not.toBeNull();
    expect(
      normalizeBrowserCard(wire({ fields: new Array(201).fill({ name: "a", value: "b" }) })),
    ).toBeNull();
  });

  test("an address over 8 KiB is refused whole: the cap is the computer's", () => {
    const long = `https://shop.example/?q=${"x".repeat(8 * 1024)}`;
    expect(long.length).toBeGreaterThan(8 * 1024);
    expect(normalizeBrowserCard(wire({ url: long }))).toBeNull();
    // At the cap it is kept.
    const atCap = `https://shop.example/?q=${"x".repeat(8 * 1024 - 24)}`;
    expect(atCap.length).toBe(8 * 1024);
    expect(normalizeBrowserCard(wire({ url: atCap }))).not.toBeNull();
  });

  test("a field with no value is not an empty field", () => {
    expect(normalizeBrowserCard(wire({ fields: [{ name: "size" }] }))).toBeNull();
  });
});

describe("what became of a card", () => {
  test("an outcome names the card it belongs to", () => {
    expect(normalizeBrowserOutcome({ card_id: CARD_ID, code: "declined" })).toEqual({
      cardId: CARD_ID,
      outcome: { code: "declined", host: "" },
    });
  });

  test("a host rides a sent request only, and only ever bare", () => {
    expect(normalizeBrowserOutcome({ card_id: CARD_ID, code: "sent", host: "shop.example" })).toEqual(
      { cardId: CARD_ID, outcome: { code: "sent", host: "shop.example" } },
    );
    // A path, a query, a port and a user@ are all a stranger's page, not a host.
    expect(normalizeBrowserOutcome({ card_id: CARD_ID, code: "sent", host: "shop.example/x" })).toBeNull();
    expect(normalizeBrowserOutcome({ card_id: CARD_ID, code: "sent", host: "shop.example:8443" })).toBeNull();
    expect(normalizeBrowserOutcome({ card_id: CARD_ID, code: "sent", host: "me@shop.example" })).toBeNull();
    // A host on an outcome that owes the person none is dropped, and the card
    // still learns it is over — a slip must not leave live buttons on a card
    // nobody will ever answer.
    expect(normalizeBrowserOutcome({ card_id: CARD_ID, code: "expired", host: "shop.example" })).toEqual({
      cardId: CARD_ID,
      outcome: { code: "expired", host: "" },
    });
    // A sent with no host is not a thing that happened.
    expect(normalizeBrowserOutcome({ card_id: CARD_ID, code: "sent" })).toBeNull();
  });

  test("a code the contract does not name still CLOSES the card, with no host", () => {
    // Dropping it would leave the card on screen asking a question nobody will
    // ever answer; the generic sentence closes it without inventing a meaning.
    expect(normalizeBrowserOutcome({ card_id: CARD_ID, code: "constructor" })).toEqual({
      cardId: CARD_ID,
      outcome: { code: "constructor", host: "" },
    });
    expect(normalizeBrowserOutcome({ card_id: CARD_ID, code: "posted" })).toEqual({
      cardId: CARD_ID,
      outcome: { code: "posted", host: "" },
    });
    // An outcome with no code at all is not an outcome.
    expect(normalizeBrowserOutcome({ code: "declined" })).toBeNull();
    expect(normalizeBrowserOutcome({ card_id: CARD_ID })).toBeNull();
  });

  test("the answer's own body reads as an outcome or as a failure, and nothing else", () => {
    expect(readBrowserAnswer({ code: "sent", host: "shop.example" })).toEqual({
      ok: true,
      outcome: { code: "sent", host: "shop.example" },
    });
    expect(readBrowserAnswer({ code: "declined" })).toEqual({
      ok: true,
      outcome: { code: "declined", host: "" },
    });
    expect(readBrowserAnswer({ error: "card_expired" })).toEqual({
      ok: false,
      errorCode: "card_expired",
    });
    // An unknown code is still an answer: the card closes with the generic
    // sentence rather than as a failure the person cannot act on.
    expect(readBrowserAnswer({ code: "invented" })).toEqual({
      ok: true,
      outcome: { code: "invented", host: "" },
    });
    // A `sent` with no host is not a thing that happened: unreadable.
    expect(readBrowserAnswer({ code: "sent" })).toEqual({
      ok: false,
      errorCode: "browser.unreadable",
    });
  });
});

describe("the destination the computer sent", () => {
  test("a destination is the host as it arrives, the port and whether it is secure", () => {
    expect(readDestination({ host: "xn--bcher-kva.example", port: null, secure: true })).toEqual({
      host: "xn--bcher-kva.example",
      port: null,
      secure: true,
    });
    expect(readDestination({ host: "shop.example", port: 8080, secure: false })).toEqual({
      host: "shop.example",
      port: 8080,
      secure: false,
    });
  });

  test("a missing port is no port", () => {
    expect(readDestination({ host: "shop.example", secure: true })?.port).toBeNull();
  });

  test("anything that is not a destination the phone may draw is no destination at all", () => {
    const bad = [
      undefined,
      "shop.example",
      { host: "", port: null, secure: true },
      { host: "shop example", port: null, secure: true },
      { host: "shop.bücher.example", port: null, secure: true },
      { host: "h".repeat(254), port: null, secure: true },
      { host: "shop.example", port: 0, secure: true },
      { host: "shop.example", port: 65536, secure: true },
      { host: "shop.example", port: 80.5, secure: true },
      { host: "shop.example", port: "80", secure: true },
      { host: "shop.example", port: null },
      { host: "shop.example", port: null, secure: "yes" },
    ];
    for (const raw of bad) expect(readDestination(raw)).toBeNull();
  });

  test("the card carries its destination, and a card with none is still a card", () => {
    const withIt = normalizeBrowserCard({ ...wire(), destination: { host: "shop.example", port: null, secure: true } });
    expect(withIt?.destination?.host).toBe("shop.example");
    const without = normalizeBrowserCard(wire());
    expect(without).not.toBeNull();
    expect(without?.destination).toBeNull();
  });

  test("the phone reads no host from the address: a destination is what decides it", () => {
    const card = normalizeBrowserCard({ ...wire({ url: "https://evil.example/x" }) });
    expect(card?.destination).toBeNull();
    expect(card?.url).toBe("https://evil.example/x");
  });
});

describe("the bounds a label is held to", () => {
  test("the wire bound is UTF-8 bytes, not characters", () => {
    expect(utf8Length("abc")).toBe(3);
    expect(utf8Length("è")).toBe(2);
    expect(utf8Length("€")).toBe(3);
    expect(utf8Length("😀")).toBe(4);
    // Eighty accented letters are 160 bytes: within the bound, and the card keeps them.
    expect(cleanLabel("è".repeat(80))).toBe("è".repeat(60));
    // 130 accented letters are 260 bytes: over the bound, so there is no label at all.
    expect(cleanLabel("è".repeat(130))).toBeNull();
  });

  test("format and control characters are removed, as the computer removes them", () => {
    expect(cleanLabel("Via\u061Cromana\u200B")).toBe("Via romana");
    expect(cleanLabel("\u2066Via\u2069 Roma")).toBe("Via Roma");
    expect(cleanLabel("Indirizzo\u0000\n\u202Eevil")).toBe("Indirizzo evil");
    expect(cleanLabel("\u200B\u061C\uFEFF")).toBeNull();
  });
});

describe("a field's label", () => {
  test("a label reaches the field, capped and as text; no label is null", () => {
    const card = normalizeBrowserCard({
      card_id: CARD_ID,
      method: "POST",
      url: "https://shop.example/order",
      fields: [
        { name: "custname", value: "Giulia", secret: false, label: "Nome e cognome" },
        { name: "csrf", value: "a-token", secret: false },
        { name: "note", value: "x", secret: false, label: 7 },
      ],
      answer_in_ms: 1000,
    });
    expect(card?.fields.map((one) => one.label)).toEqual(["Nome e cognome", null, null]);
  });

  test("a label over the cap is no label, and never refuses the card", () => {
    const card = normalizeBrowserCard({
      card_id: CARD_ID,
      method: "POST",
      url: "https://shop.example/order",
      fields: [{ name: "a", value: "b", secret: false, label: "x".repeat(241) }],
      answer_in_ms: 1000,
    });
    expect(card).not.toBeNull();
    expect(card?.fields[0].label).toBeNull();
  });
});

describe("the budget, counted on THIS phone's clock", () => {
  test("the deadline is the arrival plus the duration, never the computer's stamp", () => {
    // Two computers, two wildly different clocks, the same five minutes.
    const early = normalizeBrowserCard(wire(), 1_000)!;
    const late = normalizeBrowserCard(wire(), 9_000_000_000)!;
    expect(early.deadlineAtMs).toBe(301_000);
    expect(late.deadlineAtMs).toBe(9_000_300_000);
    // `asked_at_ms` is the computer's, for its logs: it is never read here.
    expect(early).not.toHaveProperty("askedAtMs");
  });

  test("a card the phone's clock is a day out on still arrives alive", () => {
    // The failure this replaces: an absolute deadline read off a foreign clock
    // expires the card before anyone has touched it.
    const card = normalizeBrowserCard(wire(), 0)!;
    expect(isBrowserCardExpired(card, 0)).toBe(false);
    expect(isBrowserCardExpired(card, 299_999)).toBe(false);
    expect(isBrowserCardExpired(card, 300_000)).toBe(true);
    expect(isBrowserCardExpired(card, 300_001)).toBe(true);
  });

  test("a card that arrived with no time left is over on arrival", () => {
    const card = normalizeBrowserCard(wire({ answer_in_ms: 0 }), 1_000)!;
    expect(card.deadlineAtMs).toBe(1_000);
    expect(isBrowserCardExpired(card, 1_000)).toBe(true);
  });

  test("a negative budget is refused rather than counted backwards", () => {
    expect(normalizeBrowserCard(wire({ answer_in_ms: -1 }))).toBeNull();
    expect(normalizeBrowserCard(wire({ answer_in_ms: "300000" }))).toBeNull();
  });

  test("monotonicNowMs is a number that does not run backwards on its own", () => {
    const first = monotonicNowMs();
    expect(typeof first).toBe("number");
    expect(Number.isFinite(first)).toBe(true);
    expect(monotonicNowMs()).toBeGreaterThanOrEqual(first);
  });
});