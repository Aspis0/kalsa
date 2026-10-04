/**
 * The room's sentences: one policy for every code — the table's sentence
 * when the language knows it, the app's own fallback when it does not, the
 * door's English never — and the waiting line built in the language's own
 * list.
 */
import { makeT } from "../../i18n";
import { IROH_MISSING_MESSAGE } from "../../room/roomError";
import { noteLine, queueLine } from "./roomNotes";

const en = makeT("en");
const it = makeT("it");

describe("noteLine", () => {
  test("a code the table knows reads in the household's words, both languages", () => {
    expect(noteLine(en, "already_pending")).toBe("You already have a question waiting for Kalsa.");
    expect(noteLine(en, "name_taken")).toBe(
      "Someone in this room already uses that name. Pick another.",
    );
    expect(noteLine(it, "name_taken")).toBe(
      "In questa stanza qualcuno usa già quel nome. Scegline un altro.",
    );
    expect(noteLine(it, "read_only")).toBe(
      "La stanza non accetta messaggi adesso. Riprova tra un momento.",
    );
  });

  test("a code nobody approved reads as the app's fallback; no code reads as nothing", () => {
    expect(noteLine(en, "queue_full")).toBe("Something did not work. Try again.");
    // The wire's codes resolve by own properties only.
    expect(noteLine(en, "constructor")).toBe("Something did not work. Try again.");
    expect(noteLine(en, null)).toBeNull();
    expect(noteLine(en, undefined)).toBeNull();
  });

  test("a door this phone cannot dial reads in the app's remote-brain words", () => {
    expect(noteLine(en, "door_unusable", IROH_MISSING_MESSAGE)).toBe(
      "This app can't reach a computer paired without an address. Update Kalsa on this phone, or pair again using the computer's address.",
    );
    expect(noteLine(it, "door_unusable", "remote_brain_network")).toBe(
      "Il tuo computer non risponde. Controlla che sia acceso e raggiungibile, poi riprova.",
    );
    // A message that is neither: the app's generic sentence, never the code.
    expect(noteLine(en, "door_unusable", "fetch failed: java.net.ConnectException")).toBe(
      "Could not reach your computer. Check the address and try again.",
    );
  });
});

describe("queueLine", () => {
  test("names who Kalsa answers next, and the language joins the rest", () => {
    expect(queueLine(en, "en", [])).toBeNull();
    expect(queueLine(en, "en", ["Marco"])).toBe("Kalsa will answer Marco next.");
    expect(queueLine(en, "en", ["Marco", "Luca"])).toBe(
      "Kalsa will answer Marco next, then Luca.",
    );
    expect(queueLine(en, "en", ["Marco", "Luca", "Sofia"])).toBe(
      "Kalsa will answer Marco next, then Luca and Sofia.",
    );
    expect(queueLine(it, "it", ["Marco", "Luca", "Sofia"])).toBe(
      "Kalsa risponderà prima a Marco, poi a Luca e Sofia.",
    );
  });
});
