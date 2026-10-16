/**
 * The pass is stable on its own output.
 *
 * The screen runs once per body, so this is not a correctness property the route
 * depends on — it is what lets a stored report be re-screened without markers
 * moving under the owner. An earlier version failed 288 of 30 000 random inputs:
 * an address rule read the character before a match, and a marker ends in `>`,
 * so `<email>::` turned into `<ip6>` the second time round.
 *
 * The generator is seeded, so a failure is a shape someone can paste rather than
 * a rumour about a machine.
 */

import { scrubPhoneLine, scrubPlainLine } from "./phone-json";
import { redactText } from "./redact";

const OUTPUT_CAP = 4 * 1024 * 1024;

/** The raw scanner, and the transform that adds percent-decoding and the
 *  invisible-character strip. Both have to be stable on their own output: the
 *  second is what a phone payload goes through, and it rewrites text rather than
 *  only replacing tokens. */
const raw = (text: string): string => redactText(text, OUTPUT_CAP).text;
const plain = (text: string): string => redactText(text, OUTPUT_CAP, scrubPlainLine).text;
const phone = (text: string): string => redactText(text, OUTPUT_CAP, scrubPhoneLine).text;

const CASES = 20_000;

/** A linear congruential generator: one number, reproducible everywhere. */
function seeded(seed: number): () => number {
  let state = seed;
  return () => ((state = (state * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
}

/** The characters that decide every rule, plus enough prose to surround them. */
const ALPHABET = [
  ..."abz09:@/.\\-_?#% \t\"'()<>{}[]=,;hHmMpP",
  ..."ABZusér中",
  "\u{1f600}", // a surrogate pair, which is two code units above ASCII
  "\u0000\u0009\u200b\ufeff", // what the invisible-character strip removes
  "\\u0040\\/", // what the tolerant JSON unescape resolves
];

function randomLine(next: () => number): string {
  const length = 1 + Math.floor(next() * 40);
  let line = "";
  for (let i = 0; i < length; i += 1) {
    line += ALPHABET[Math.floor(next() * ALPHABET.length)];
  }
  return line;
}

describe("redacting twice changes nothing", () => {
  test("the markers this pass writes do not become new matches", () => {
    // The shapes that failed before, written out rather than left to chance.
    const known = [
      "<email>::@B",
      "<ip6>::1",
      "<cred>@host",
      "/Users/<user>/x",
      "<query> <ip> <ip6> <email> <cred>@ <user>",
      "<email>:: <ip>:: <query>::",
      // The address `>` guard exists for these: an address may end before a `>`
      // but not start after one, or a marker's `>` would begin an address.
      "marco@example.com::1",
      "<ip> <email> 10.0.0.1",
      "<ip><::1><2001:db8::1>",
    ];
    for (const input of known) {
      for (const scrub of [raw, plain, phone]) {
        const once = scrub(input);
        expect(scrub(once)).toBe(once);
      }
    }
  });

  test(`${CASES} seeded lines survive a second pass, on all three routes`, () => {
    const unstable: Record<string, string[]> = { raw: [], plain: [], phone: [] };
    const next = seeded(0x2f6e2b1);
    for (let i = 0; i < CASES; i += 1) {
      const input = randomLine(next);
      for (const [name, scrub] of [["raw", raw], ["plain", plain], ["phone", phone]] as const) {
        const once = scrub(input);
        if (scrub(once) !== once) unstable[name].push(input);
      }
    }
    expect(unstable).toEqual({ raw: [], plain: [], phone: [] });
  });

  test("a line that has no trigger is returned exactly", () => {
    // Nothing invented: the pass replaces what it recognises and leaves the rest.
    for (const line of ["engine ready", "two log files joined", "stage=prefill backend=cpu"]) {
      for (const scrub of [raw, plain, phone]) {
        expect(scrub(`${line}\n`)).toBe(`${line}\n`);
      }
    }
  });
});