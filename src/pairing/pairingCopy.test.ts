import { en } from "../i18n/en";
import { it } from "../i18n/it";

describe("pairing copy", () => {
  test("all desk refusals use one plain sentence without naming a cause", () => {
    expect(en.pairing.refused).toBe(
      "Can't reach your computer, or it refused the pairing. Try again.",
    );
    expect(it.pairing.refused).toBe(
      "Non riesci a raggiungere il tuo computer, oppure ha rifiutato il collegamento. Riprova.",
    );
    expect(en.pairing.refused).not.toMatch(/code|expired|busy|wrong|queue/i);
    expect(it.pairing.refused).not.toMatch(/codice|scadut|occupat|errat|coda/i);
  });

  test("the wait names the Allow action and the computer, never a bare state", () => {
    expect(en.pairing.waitingAllow).toBe(
      "Waiting for you to press Allow on {computer}",
    );
    expect(it.pairing.waitingAllow).toBe(
      "In attesa che tu prema Consenti su {computer}",
    );
    // Nothing in the pending state may sound like the pairing already
    // succeeded (the owner read "connected" before pressing Allow).
    expect(en.pairing.waitingAllow).not.toMatch(/connected/i);
    expect(it.pairing.waitingAllow).not.toMatch(/conness|collegato/i);
  });

  test("the generic computer name is a whole sentence, preposition and all", () => {
    // "su il tuo computer" and "a il tuo computer" are not Italian: the article
    // belongs to the label, so it contracts with the preposition. A hostname
    // keeps the plain preposition, which is why these are separate strings.
    expect(en.pairing.waitingAllowComputer).toBe(
      "Waiting for you to press Allow on your computer",
    );
    expect(it.pairing.waitingAllowComputer).toBe(
      "In attesa che tu prema Consenti sul tuo computer",
    );
    expect(en.pairing.pairedWithComputer).toBe("Paired with your computer");
    expect(it.pairing.pairedWithComputer).toBe("Collegato al tuo computer");
    for (const sentence of [it.pairing.waitingAllowComputer, it.pairing.pairedWithComputer]) {
      expect(sentence).not.toMatch(/\b(su|a) il tuo computer\b/);
    }
  });

  test("only the poll's paired verdict says paired, and it names the computer", () => {
    expect(en.pairing.pairedWith).toBe("Paired with {computer}");
    expect(it.pairing.pairedWith).toBe("Collegato a {computer}");
  });

  test("the invite field has a heading of its own, not the button's words twice", () => {
    expect(en.pairing.pasteInvite).toBe("Paste invite");
    expect(en.pairing.pasteInviteHeading).toBe("Paste the invite link");
    expect(it.pairing.pasteInvite).toBe("Incolla invito");
    expect(it.pairing.pasteInviteHeading).toBe("Incolla il link di invito");
    expect(it.pairing.pasteInviteHeading).not.toBe(it.pairing.pasteInvite);
  });

  test("a tailnet ceremony names its host in the status, in both catalogues", () => {
    expect(en.pairing.withHost).toBe("Pairing with {host}…");
    expect(it.pairing.withHost).toBe("Collegamento con {host}…");
  });
});
