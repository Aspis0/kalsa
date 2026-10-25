/**
 * What the screen costs, and that it stays linear.
 *
 * The route is unauthenticated and the body ceiling is 4 MiB, so a rule that
 * can go quadratic is a CPU sink anyone holding the URL can aim at it — the
 * first version of this pass needed minutes for the bodies below. These are
 * regression guards, not benchmarks.
 *
 * The guard is **linearity**, not an absolute number: four times the bytes must
 * not cost more than a few times the time. An absolute budget would measure the
 * harness (jest's module wrapper inflates a match-heavy path about fivefold, and
 * a busy machine moves wall clock), while the ratio holds in any environment and
 * is exactly the property that was broken. Absolute CPU time is printed for every
 * case anyway, so the numbers are on the record.
 */

import { keepPhoneLines } from "./phone-body";
import { scrubPhoneLine } from "./phone-json";
import { redactText } from "./redact";

const MIB = 1024 * 1024;
const LINE = 8192;
const BIG_LINES = 512; // 4 MiB
const SMALL_LINES = 128; // 1 MiB
/** What the worker can store, and so what the pass may hand back. */
const OUTPUT_CAP = 4 * MIB;

/** Linear means 4x the bytes costs about 4x the time; quadratic would cost
 *  16x. Six leaves room for measurement noise without admitting a curve. */
const MAX_SCALING = 6;
/** The slack is additive because the noise is: on a shared machine a 6 ms
 *  measurement moves by milliseconds, and a curve this guard exists to catch is
 *  four times that, not a fraction of it. */
const SCALING_SLACK_MS = 20;

/** A legitimate 4 MiB body: only a return to super-linear behaviour pushes it
 *  past this. */
const LEGIT_BUDGET_MS = 2_000;
/** One line of 4 MiB, which the phone gate drops on length and the pass drops
 *  on its per-line cap without ever scanning it. */
const SINGLE_LINE_BUDGET_MS = 50;
/**
 * The `http://h` + `@` bodies below. The ratio beside this is the real guard;
 * this ceiling only has to sit far below what the shape cost when the walk went
 * back to the scheme for every `@`, which was forty seconds a request. It is
 * generous because jest's module wrapper inflates these paths and a shared
 * machine moves wall clock — a body that is linear passes it by an order of
 * magnitude, and a quadratic one misses it by one.
 */
const CRED_BUDGET_MS = 5_000;

const STAMP = "2026-10-16T14:49:27.123Z";

/** `lines` lines of 8 KiB each — the worst line the desktop's own cap allows. */
function bodyOf(unit: string, lines = BIG_LINES): string {
  const line = unit.repeat(Math.ceil(LINE / unit.length)).slice(0, LINE);
  return Array(lines).fill(line).join("\n");
}

function cpuMs(fn: () => unknown): number {
  const before = process.cpuUsage();
  fn();
  const used = process.cpuUsage(before);
  return (used.user + used.system) / 1000;
}

/** Best of three: a single run can be interrupted by anything else on the box. */
function costOf(fn: () => unknown): number {
  fn();
  fn();
  return Math.min(cpuMs(fn), cpuMs(fn), cpuMs(fn));
}

/** Fewer repeats than `costOf`, for the bodies where one pass is seconds. */
function costOfBig(fn: () => unknown): number {
  fn();
  return Math.min(cpuMs(fn), cpuMs(fn));
}

describe("cost stays linear", () => {
  const cases: [string, string][] = [
    ["dots_at", "a.a@"],
    ["email_dom", `a@${"b.".repeat(20)}`],
    ["ip6", "1:"],
    ["ip6b", "a::"],
    ["ip6c", "::1:"],
    ["ipv4", "1.1.1."],
    ["users", "/Users/"],
    ["win", "C:\\Users\\"],
    ["url", "http://a?"],
    ["dash", "-@-"],
    ["pct", "%@a"],
    ["cr", "a@".repeat(2_000_000).replace(/@/g, "\r@")],
    ["combined", "a.a@1:a::C:\\Users\\%@1.1.1.http://a?/Users/"],
  ];
  for (const [name, unit] of cases) {
    test(`${name}: 4x the bytes does not cost 16x the time`, () => {
      const small = bodyOf(unit, SMALL_LINES);
      const big = bodyOf(unit, BIG_LINES);
      expect(big.length / small.length).toBeCloseTo(4, 1);
      const smallMs = costOf(() => redactText(small, OUTPUT_CAP));
      const bigMs = costOf(() => redactText(big, OUTPUT_CAP));
      console.log(
        `      ${name.padEnd(10)} ${smallMs.toFixed(1).padStart(6)} ms at 1 MiB, ` +
          `${bigMs.toFixed(1).padStart(6)} ms at 4 MiB — x${(bigMs / smallMs).toFixed(1)}`,
      );
      expect(bigMs).toBeLessThan(smallMs * MAX_SCALING + SCALING_SLACK_MS);
    });
  }

  test("a multi-megabyte single line is dropped, not scanned", () => {
    const line = `${STAMP} KALSA_LOAD {"pad":"${"a".repeat(4 * MIB)}"}`;
    const gate = costOf(() => keepPhoneLines(line));
    console.log(`      ${"gate".padEnd(10)} ${gate.toFixed(1).padStart(6)} ms for one 4 MiB line`);
    expect(gate).toBeLessThan(SINGLE_LINE_BUDGET_MS);
    // Dropped on its length, before the payload is ever parsed.
    expect(keepPhoneLines(line).dropped).toBe(1);
    const scrub = costOf(() => redactText(line, OUTPUT_CAP));
    console.log(`      ${"redact".padEnd(10)} ${scrub.toFixed(1).padStart(6)} ms for one 4 MiB line`);
    expect(scrub).toBeLessThan(SINGLE_LINE_BUDGET_MS);
  });
});

/**
 * The cases above hold the *line* fixed and vary how many there are, so they
 * cannot see a cost that grows with the length of one line. These hold the body
 * fixed and grow the line inside it: an `@` run after a pathless URL is what
 * took the credential walk from milliseconds to forty seconds a request.
 */
describe("cost stays linear inside one line", () => {
  const intraLine: [string, string][] = [
    // A pathless URL leaves the authority open; every `@` after it walked back
    // to the scheme and re-read the whole prefix.
    ["creds", `http://h${"@".repeat(LINE - 8)}`],
    // The same shape inside a realistic phone line.
    ["phone", `${STAMP} KALSA_X {"u":"http://h${"@".repeat(200)}"}`],
    // A credential per `@` is the other way to amplify.
    ["creds_pairs", `http://h${"a@".repeat((LINE - 8) / 2)}`],
  ];
  for (const [name, unit] of intraLine) {
    test(`${name}: a longer line does not cost a longer-than-linear time`, () => {
      const small = bodyOf(unit, SMALL_LINES);
      const big = bodyOf(unit, BIG_LINES);
      expect(big.length / small.length).toBeCloseTo(4, 1);
      // Wall clock, because this is a budget against a CPU sink an attacker
      // aims at the route, and the ratio is what a curve breaks.
      const smallMs = costOfBig(() => redactText(small, OUTPUT_CAP));
      const bigMs = costOfBig(() => redactText(big, OUTPUT_CAP));
      console.log(
        `      ${name.padEnd(11)} ${smallMs.toFixed(1).padStart(6)} ms at 1 MiB, ` +
          `${bigMs.toFixed(1).padStart(6)} ms at 4 MiB — x${(bigMs / smallMs).toFixed(1)}`,
      );
      expect(bigMs).toBeLessThan(smallMs * MAX_SCALING + SCALING_SLACK_MS);
      expect(bigMs).toBeLessThan(CRED_BUDGET_MS);
    });
  }

  test("the pass stops at the output cap instead of building the whole string", () => {
    // Every 3 characters become a 7-character marker, so this body is seven
    // times its own size once screened. It must be refused, not materialised.
    const body = bodyOf("@a1");
    const started = process.cpuUsage();
    const out = redactText(body, OUTPUT_CAP);
    const ms = (process.cpuUsage(started).user + process.cpuUsage(started).system) / 1000;
    console.log(`      ${"cap".padEnd(11)} ${ms.toFixed(1).padStart(6)} ms, ${out.text.length} chars kept`);
    expect(out.truncated).toBe(true);
    expect(out.text.length).toBeLessThanOrEqual(OUTPUT_CAP);
  });
});

/**
 * The JSON path is the other direction a body grows: every string value is
 * walked, parsed and written back, so the cost is the walk plus the parse, not
 * the scan alone. It is a per-line constant over the line, and this holds it to
 * the same ratio as everything else.
 */
test("a phone body dense in JSON escapes stays linear", () => {
  // Under the client's own 325-character clip, and every value one a serializer
  // would emit escaped: a mail, a Windows path, an encoded query.
  const line = (i: number) =>
    `${STAMP} KALSA_ROAD {"i":${i},"m":"marco@example.com","p":"C:\\\\Users\\\\marco\\\\x","u":"https://x.io/p?q=token","n":${i}}`;
  const one = line(1);
  expect(one.length).toBeLessThanOrEqual(325);
  const body = (bytes: number) => {
    const rows = Math.floor(bytes / (one.length + 1));
    return `${Array.from({ length: rows }, (_, i) => line(i)).join("\n")}\n`;
  };
  const small = body(MIB);
  const big = body(4 * MIB);
  expect(big.length / small.length).toBeCloseTo(4, 1);
  const screen = (bodyText: string) =>
    redactText(keepPhoneLines(bodyText).text, OUTPUT_CAP, scrubPhoneLine);
  // Nothing may be dropped by the gate, or this would measure the gate.
  expect(keepPhoneLines(big).dropped).toBe(0);
  const smallMs = costOfBig(() => screen(small));
  const bigMs = costOfBig(() => screen(big));
  console.log(
    `      ${"json".padEnd(11)} ${smallMs.toFixed(1).padStart(6)} ms at 1 MiB, ` +
      `${bigMs.toFixed(1).padStart(6)} ms at 4 MiB — x${(bigMs / smallMs).toFixed(1)}`,
  );
  expect(bigMs).toBeLessThan(smallMs * MAX_SCALING + SCALING_SLACK_MS);
  expect(bigMs).toBeLessThan(LEGIT_BUDGET_MS * 2);
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
    const ms = costOf(() => redactText(keepPhoneLines(body).text, OUTPUT_CAP));
    console.log(`      ${"phone".padEnd(10)} ${ms.toFixed(1).padStart(6)} ms for a 4 MiB phone body`);
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
    const ms = costOf(() => redactText(body, OUTPUT_CAP));
    console.log(`      ${"desktop".padEnd(10)} ${ms.toFixed(1).padStart(6)} ms for a 4 MiB desktop body`);
    expect(ms).toBeLessThan(LEGIT_BUDGET_MS);
  });
});