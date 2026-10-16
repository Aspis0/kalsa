/**
 * What the screen costs. The redaction pass runs on an unauthenticated 4 MiB
 * body, so these are regression guards, not benchmarks: the adversarial inputs
 * are the ones that made the first version quadratic, and the budgets are loose
 * enough not to be flaky but far below what a quadratic rule would need.
 */

import { keepPhoneLines } from "./phone-body";
import { redactText } from "./redact";

const MIB = 1024 * 1024;
/** The adversarial budget. Every case here measured under 1 ms once the rules
 *  were bounded, so 50 ms is a real ceiling with room for a slow machine. */
const ADVERSARIAL_BUDGET_MS = 50;
/** A full legitimate body. The quadratic version needed minutes for this; the
 *  bounded one takes tens of milliseconds, so this only catches a return to
 *  super-linear behaviour. */
const LEGIT_BUDGET_MS = 2_000;

const STAMP = "2026-10-16T14:49:27.123Z";

function timed(fn: () => unknown): number {
  const started = performance.now();
  fn();
  return performance.now() - started;
}

/** Best of three: a single run on a shared machine can be interrupted. */
function bestOfThree(fn: () => unknown): number {
  let best = Infinity;
  for (let i = 0; i < 3; i++) best = Math.min(best, timed(fn));
  return best;
}

function report(ms: number, budget: number): void {
  // Printed so a failing budget says what it actually cost, not just that it did.
  console.log(`      ${ms.toFixed(1)} ms (budget ${budget} ms)`);
}

describe("adversarial bodies stay inside the budget", () => {
  test("a 400k run of the local-part character class", () => {
    // The EMAIL rule used to backtrack a whole run at every start position.
    const ms = bestOfThree(() => redactText("a".repeat(400_000)));
    report(ms, ADVERSARIAL_BUDGET_MS);
    expect(ms).toBeLessThan(ADVERSARIAL_BUDGET_MS);
  });

  test("20k repeated schemes", () => {
    // The URL rule used to expand a lazy `*?` looking for `?`/`#` at each one.
    const ms = bestOfThree(() => redactText("https://".repeat(20_000)));
    report(ms, ADVERSARIAL_BUDGET_MS);
    expect(ms).toBeLessThan(ADVERSARIAL_BUDGET_MS);
  });

  test("a multi-megabyte single JSON line", () => {
    const line = `${STAMP} KALSA_LOAD {"pad":"${"a".repeat(4 * MIB)}"}`;
    const gate = bestOfThree(() => keepPhoneLines(line));
    report(gate, ADVERSARIAL_BUDGET_MS);
    expect(gate).toBeLessThan(ADVERSARIAL_BUDGET_MS);
    // It is dropped before the payload is ever parsed, and redacting it is cheap.
    expect(keepPhoneLines(line).dropped).toBe(1);
    const scrub = bestOfThree(() => redactText(line));
    report(scrub, ADVERSARIAL_BUDGET_MS);
    expect(scrub).toBeLessThan(ADVERSARIAL_BUDGET_MS);
  });

  test("single-character runs that trigger every rule", () => {
    for (const filler of [".", ":", "@", "/", "\\"]) {
      const ms = bestOfThree(() => redactText(filler.repeat(4 * MIB)));
      report(ms, ADVERSARIAL_BUDGET_MS);
      expect(ms).toBeLessThan(ADVERSARIAL_BUDGET_MS);
    }
  });
});

describe("a full legitimate body", () => {
  test("a 4 MiB phone body is gated and redacted in linear time", () => {
    // Real client lines, 288 characters each: the phone clips its record at 300.
    const line = (i: number) =>
      `${STAMP} KALSA_LOAD {"i":${i},"component":"engine","stage":"load","pad":"${"abcdefghij".repeat(20)}"}`;
    const body = Array.from({ length: Math.ceil(4 * MIB / 325) }, (_, i) => line(i))
      .join("\n")
      .slice(0, 4 * MIB);
    expect(body.length).toBeGreaterThan(3.5 * MIB);
    const ms = bestOfThree(() => redactText(keepPhoneLines(body).text));
    report(ms, LEGIT_BUDGET_MS);
    expect(ms).toBeLessThan(LEGIT_BUDGET_MS);
  });

  test("a 4 MiB desktop body is redacted in linear time", () => {
    const body = Array.from(
      { length: Math.ceil(4 * MIB / 120) },
      (_, i) =>
        `${STAMP} engine stage load ok seq=${i} took 12ms elapsed=0.014s stage=prefill component=engine backend=cpu`,
    )
      .join("\n")
      .slice(0, 4 * MIB);
    expect(body.length).toBeGreaterThan(3.9 * MIB);
    const ms = bestOfThree(() => redactText(body));
    report(ms, LEGIT_BUDGET_MS);
    expect(ms).toBeLessThan(LEGIT_BUDGET_MS);
  });
});