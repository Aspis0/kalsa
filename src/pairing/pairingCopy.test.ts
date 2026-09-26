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

  test("the post-completion state asks for confirmation on the computer", () => {
    expect(it.pairing.waiting).toBe("Conferma sul computer");
    expect(en.pairing.waiting).toBe("Confirm on your computer");
  });
});
