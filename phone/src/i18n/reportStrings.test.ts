/**
 * The report strings: approved copy, en/it key parity (it is `typeof en`, so
 * the parity is also compile-time), and the {id} interpolation the panel shows
 * after a 201.
 */

jest.mock("@react-native-async-storage/async-storage", () => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
  removeItem: jest.fn(async () => undefined),
}));

import { en, it as itCatalog, translate } from "./index";

const REPORT_KEYS = [
  "privacy",
  "send",
  "sending",
  "sentWithId",
  "errRateLimited",
  "errTryTomorrow",
  "errSend",
  "errEmpty",
  "crashUncleanTitle",
  "crashUncleanBody",
  "notNow",
] as const;

describe("the report strings", () => {
  it("en and it carry exactly the approved report keys", () => {
    expect(Object.keys(en.report).sort()).toEqual([...REPORT_KEYS].sort());
    expect(Object.keys(itCatalog.report).sort()).toEqual([...REPORT_KEYS].sort());
  });

  it("keeps the approved privacy sentence exact in both locales", () => {
    expect(en.report.privacy).toBe(
      "The log never contains your messages, Kalsa's answers, your files, or any code or key.",
    );
    expect(itCatalog.report.privacy).toBe(
      "Il log non contiene mai i tuoi messaggi, le risposte di Kalsa, i tuoi file, né codici o chiavi.",
    );
  });

  it("interpolates {id} in sentWithId for both locales", () => {
    expect(translate("en", "report.sentWithId", { id: "ABCD2345" })).toBe(
      "Sent. Your report number is ABCD2345 — tell us this number.",
    );
    expect(translate("it", "report.sentWithId", { id: "ABCD2345" })).toBe(
      "Inviato. Il numero della tua segnalazione è ABCD2345: dicci questo numero.",
    );
  });

  it("serves the approved crash-prompt strings for both locales", () => {
    expect(translate("en", "report.crashUncleanTitle")).toBe(
      "Kalsa did not close normally last time",
    );
    expect(translate("it", "report.crashUncleanTitle")).toBe(
      "Kalsa non si è chiusa normalmente l'ultima volta",
    );
    expect(translate("en", "report.crashUncleanBody")).toBe(
      "If something went wrong, sending the log helps us fix it.",
    );
    expect(translate("it", "report.crashUncleanBody")).toBe(
      "Se qualcosa è andato storto, inviare il log ci aiuta a correggerlo.",
    );
    expect(translate("en", "report.notNow")).toBe("Not now");
    expect(translate("it", "report.notNow")).toBe("Non ora");
  });

  it("serves the plain report keys for both locales", () => {
    expect(translate("en", "report.send")).toBe("Send the log");
    expect(translate("it", "report.send")).toBe("Invia il log");
    expect(translate("en", "report.errEmpty")).toBe("There is nothing to send yet.");
    expect(translate("it", "report.errEmpty")).toBe("Non c'è ancora niente da inviare.");
    expect(translate("en", "report.errRateLimited")).toBe("Wait a minute and try again.");
    expect(translate("it", "report.errRateLimited")).toBe("Aspetta un minuto e riprova.");
    expect(translate("en", "report.errTryTomorrow")).toBe(
      "We received too many reports today. Try again tomorrow.",
    );
    expect(translate("it", "report.errTryTomorrow")).toBe(
      "Oggi abbiamo ricevuto troppe segnalazioni. Riprova domani.",
    );
    expect(translate("en", "report.errSend")).toBe(
      "Could not send. Check the internet connection and try again.",
    );
    expect(translate("it", "report.errSend")).toBe(
      "Impossibile inviare. Controlla la connessione e riprova.",
    );
    expect(translate("en", "report.sending")).toBe("Sending…");
    expect(translate("it", "report.sending")).toBe("Invio…");
  });
});
