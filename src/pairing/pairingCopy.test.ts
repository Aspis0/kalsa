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

  test("only the poll's paired verdict says paired, and it names the computer", () => {
    expect(en.pairing.pairedWith).toBe("Paired with {computer}");
    expect(it.pairing.pairedWith).toBe("Collegato a {computer}");
    expect(en.pairing.yourComputer).toBe("your computer");
    expect(it.pairing.yourComputer).toBe("il tuo computer");
  });

  test("a tailnet ceremony names its host in the status, in both catalogues", () => {
    expect(en.pairing.withHost).toBe("Pairing with {host}…");
    expect(it.pairing.withHost).toBe("Collegamento con {host}…");
  });
});
