import { WINDOW_CHARS_PER_TOKEN, windowCeilingTokens } from "../context/windowProfile";
import { toolRoundCrossesCeiling } from "./toolRoundCeiling";

describe("toolRoundCrossesCeiling", () => {
  const nCtx = 8192;
  const ceilingChars = windowCeilingTokens(nCtx) * WINDOW_CHARS_PER_TOKEN;

  test("the first round is never stopped by this guard", () => {
    expect(
      toolRoundCrossesCeiling({ round: 0, nCtx, promptChars: 10_000_000 }),
    ).toBe(false);
  });

  test("a later round above the ceiling stops the loop", () => {
    expect(
      toolRoundCrossesCeiling({ round: 1, nCtx, promptChars: ceilingChars + 1 }),
    ).toBe(true);
    expect(
      toolRoundCrossesCeiling({ round: 2, nCtx, promptChars: ceilingChars + 1 }),
    ).toBe(true);
  });

  test("a later round at or below the ceiling keeps going", () => {
    expect(
      toolRoundCrossesCeiling({ round: 1, nCtx, promptChars: ceilingChars }),
    ).toBe(false);
  });

  test("no engine → guard inert", () => {
    expect(
      toolRoundCrossesCeiling({ round: 1, nCtx: 0, promptChars: 10_000_000 }),
    ).toBe(false);
  });

  test("a loop appending tool results stops before crossing the ceiling", () => {
    // Start at 6000 tokens (under the 6144 ceiling); each round adds a capped
    // tool result, so the second round's prompt would cross it.
    let promptChars = 6000 * WINDOW_CHARS_PER_TOKEN;
    let rounds = 0;
    for (let round = 0; round < 3; round += 1) {
      if (toolRoundCrossesCeiling({ round, nCtx, promptChars })) break;
      rounds += 1;
      promptChars += 2600;
    }
    expect(rounds).toBe(1);
  });
});
