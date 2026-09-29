import { callsKalsa } from "./callsKalsa";

const examples: Array<[string, boolean]> = [
  // §5's request example
  ["@Kalsa what time is it?", true],
  // the three casings the rule names
  ["@Kalsa", true],
  ["@kalsa", true],
  ["@KALSA", true],
  // punctuation and a trailing word after the token
  ["@kalsa, ciao", true],
  ["(@Kalsa)", true],
  ["@Kalsa's", true],
  // an address or a word hugging the @ or the token
  ["email@kalsa.io", false],
  ["josé2@Kalsa", false],
  ["café@Kalsa", false],
  ["@Kalsabot", false],
];

describe("every example §5 gives", () => {
  test.each(examples)("%s", (text, expected) => {
    expect(callsKalsa(text)).toBe(expected);
  });
});

describe("boundaries the rule decides", () => {
  test.each([
    ["say @Kalsa when it's ready", true],
    ["_@Kalsa", true],
    ["@Kalsa_x", false],
    ["one: email@kalsa.io, two: @Kalsa", true],
    ["𝕏@Kalsa", false],
    ["", false],
    ["no token here", false],
    ["@", false],
    ["@kals", false],
  ])("%s", (text, expected) => {
    expect(callsKalsa(text)).toBe(expected);
  });
});
