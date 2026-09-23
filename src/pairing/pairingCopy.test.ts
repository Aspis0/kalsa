import { en } from "../i18n/en";
import { it } from "../i18n/it";

describe("pairing copy", () => {
  test("all desk refusals use one sentence without naming a cause", () => {
    expect(en.pairing.refused).toBe("Pairing was not accepted.");
    expect(it.pairing.refused).toBe("Il collegamento non è stato accettato.");
    expect(en.pairing.refused).not.toMatch(/code|expired|busy|wrong|queue/i);
    expect(it.pairing.refused).not.toMatch(/codice|scadut|occupat|errat|coda/i);
  });

  test("the post-completion state asks for confirmation on the computer", () => {
    expect(it.pairing.waiting).toBe("Conferma sul computer");
    expect(en.pairing.waiting).toBe("Confirm on your computer");
  });
});
