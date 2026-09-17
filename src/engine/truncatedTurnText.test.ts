/**
 * Unit tests for the empty-turn guard (src/engine/truncatedTurnText.ts).
 *
 * A forced-open round truncated inside its think block produces reasoning but
 * zero visible text; the user must still end the turn with something.
 */

import { visibleTurnText } from "./truncatedTurnText";

const MARKER = "Generazione interrotta.";

describe("truncatedTurnText.visibleTurnText", () => {
  test("truncated think-only round → interruption marker, never an empty turn", () => {
    expect(
      visibleTurnText({
        finalText: "",
        streamedVisibleLength: 0,
        thinking: "The user wants me to plan a trip…",
        interruptedMarker: MARKER,
      }),
    ).toBe(MARKER);
  });

  test("normal answer passes through untouched", () => {
    expect(
      visibleTurnText({
        finalText: "Ciao! Ecco il tuo itinerario.",
        streamedVisibleLength: 0,
        thinking: "reasoning",
        interruptedMarker: MARKER,
      }),
    ).toBe("Ciao! Ecco il tuo itinerario.");
  });

  test("prior rounds already streamed text → no marker appended", () => {
    expect(
      visibleTurnText({
        finalText: "",
        streamedVisibleLength: 42,
        thinking: "reasoning",
        interruptedMarker: MARKER,
      }),
    ).toBe("");
  });

  test("empty final with NO reasoning → unchanged (no lying marker)", () => {
    expect(
      visibleTurnText({
        finalText: "",
        streamedVisibleLength: 0,
        thinking: "",
        interruptedMarker: MARKER,
      }),
    ).toBe("");
  });

  test("whitespace-only reasoning does not trigger the marker", () => {
    expect(
      visibleTurnText({
        finalText: "",
        streamedVisibleLength: 0,
        thinking: "  \n\t ",
        interruptedMarker: MARKER,
      }),
    ).toBe("");
  });
});
