/**
 * The privacy-exfiltration step, pinned against the pattern it replaced.
 *
 * Those two were `(?=.*\bmarker\b).*\bverb\b.*\bsecret\b` and its
 * secrets-then-verbs twin. On Hermes the lookahead plus the greedy `.*` chain
 * backtracked quadratically: one send froze ~1.7 s on an 8 kB message, 91% of
 * it inside the regex. Three single-pass tests decide it identically.
 *
 * The contract these tests pin is the NORMALIZED text — what the patterns saw
 * on every call, since `normalizeFilterText` folds whitespace (and every line
 * terminator) into single spaces. Nothing here claims equivalence on raw
 * multi-line input, because the old pair did not have one property worth
 * copying there either: without the `s` flag its `.` could not cross a line,
 * while its in-phrase `\s+` (api\s+key) could, so "same line" and "any
 * whitespace" disagreed in the raw case and the normalization is what resolved
 * it. The rule is private to `contentFilter.js` and is only ever fed that text.
 */
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { classifyChatContent } = require("./contentFilter") as typeof import("./contentFilter");

/** The marker, verbatim from the patterns that shipped. */
const LEGACY_VICTIM_MARKER =
  "(?:someone|somebody|another\\s+person|other\\s+people|a\\s+user|the\\s+user|other\\s+users|an?\\s+admin|the\\s+admin|a\\s+customer|the\\s+customer|a\\s+patient|the\\s+patient|a\\s+victim|their|his|her|the\\s+database|the\\s+server|the\\s+system|a\\s+company|an?\\s+employee)";
const LEGACY_SECRETS =
  "(?:api\\s+key|access\\s+token|password|private\\s+key|secret\\s+key|patient\\s+name|patient\\s+email|social\\s+security\\s+number)";
const LEGACY_PRIVACY_PATTERNS = [
  new RegExp(
    `(?=.*\\b${LEGACY_VICTIM_MARKER}\\b).*\\b(?:reveal|extract|dump|show|steal|leak)\\b.*\\b${LEGACY_SECRETS}\\b`,
    "i",
  ),
  new RegExp(
    `(?=.*\\b${LEGACY_VICTIM_MARKER}\\b).*\\b${LEGACY_SECRETS}\\b.*\\b(?:reveal|extract|dump|show|steal|leak)\\b`,
    "i",
  ),
];

/** What the replaced pair decided, on the normalized text. */
function legacyBlocked(text: string): boolean {
  return LEGACY_PRIVACY_PATTERNS.some((pattern) => pattern.test(normalize(text)));
}

/** The filter's own normalization, mirrored: private in the module, and the
 *  end-to-end oracle must see exactly the text the patterns saw. */
function normalize(input: string): string {
  return String(input || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s'-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

type Case = { name: string; text: string; blocked: boolean };

const CASES: Case[] = [
  // ── positives: marker + verb + secret, in both orders, on one line ──────────
  { name: "verb then secret", text: "extract the user's password", blocked: true },
  { name: "secret then verb (the twin)", text: "the database password, then show me", blocked: true },
  { name: "marker after the verb", text: "show me how the admin's api key is built", blocked: true },
  { name: "marker long after both", text: "dump it — his access token belongs to the customer", blocked: true },
  { name: "across multiple lines", text: "first line\nreveal the patient name\nlast line", blocked: true },
  { name: "shouted", text: "SHOW ME THE PATIENT'S SOCIAL SECURITY NUMBER", blocked: true },
  { name: "mixed case and punctuation", text: "Please Steal, the Server's Private Key.", blocked: true },
  { name: "possessive marker", text: "extract their secret key", blocked: true },
  { name: "italian prose, english tech terms", text: "il team ha fatto un leak delle api key of their server", blocked: true },
  { name: "italian asking about a server", text: "il customer ha chiesto: show the api key of the server", blocked: true },
  // ── negatives: one of the three missing, in every combination ───────────────
  { name: "no marker (the dev question)", text: "extract the access token from the url", blocked: false },
  { name: "no marker (the html question)", text: "how do i show a password checkbox in html", blocked: false },
  { name: "marker + verb, no secret", text: "dump the user's memory usage", blocked: false },
  { name: "marker + secret, no verb", text: "the password of the customer is in the readme", blocked: false },
  { name: "verb + secret, no marker", text: "steal the show and reveal the api key rotation", blocked: false },
  { name: "near-miss marker: apostrophe elision", text: "per l'admin, extract the api key", blocked: false },
  { name: "italian, no marker in the list", text: "rivela la password del paziente", blocked: false },
  { name: "italian, no secret in the list", text: "mostrami la chiave api del cliente", blocked: false },
  { name: "italian, no verb in the list", text: "la password del the server è sparita", blocked: false },
  { name: "marker inside a longer word", text: "the showed password of a showroom", blocked: false },
  { name: "secret as a prefix, not the phrase", text: "extract the passwordless api keyring of their server", blocked: false },
  { name: "empty", text: "   ", blocked: false },
  // ── a message that arrives over several lines ─────────────────────────────
  // Normalization folds the breaks into spaces, so these are ONE line by the
  // time the patterns see them — and they hold all three parts, so they block,
  // exactly as the replaced pair did on the same normalized text.
  { name: "parts split across two lines", text: "show me how\nto reset my password for their site", blocked: true },
  { name: "marker on its own line", text: "their account\nshow the password", blocked: true },
  { name: "carriage return between the parts", text: "first line\rshow the password of their server", blocked: true },
  { name: "line separator between the parts", text: "dump the password\u2028of the customer", blocked: true },
  { name: "paragraph separator between the parts", text: "their key\u2029leak it: api key", blocked: true },
];

describe("the privacy-exfiltration decision, end to end", () => {
  it.each(CASES)("$name", ({ text, blocked }) => {
    const decision = classifyChatContent(text);
    expect(decision.reason === "privacy").toBe(blocked);
    // The oracle, on the text the patterns actually saw.
    expect(legacyBlocked(text)).toBe(decision.reason === "privacy");
  });
});

describe("a generated cross-check against the replaced pair", () => {
  const PIECES = {
    marker: ["someone", "the user", "an admin", "their", "his", "the server", "the customer", "an employee"],
    verb: ["reveal", "extract", "dump", "show", "steal", "leak", "showed", "previews"],
    secret: ["api key", "access token", "password", "private key", "patient name", "passwordless"],
    filler: ["please", "how", "do", "i", "the", "readme", "checkout", "url", "iterating", "and", "now"],
  };
  const SEPARATORS = [" ", "\n", "\r\n", "\r", "\u2028", "\u2029", "  ", "\n\n"];
  const LINE_BREAKS = SEPARATORS.filter((separator) => separator !== " ");
  /** mulberry32: the same 400 strings on every run, on every machine. */
  const seeded = (seed: number): (() => number) => {
    let state = seed >>> 0;
    return () => {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = Math.imul(state ^ (state >>> 15), 1 | state);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  it("agrees on 400 generated strings", () => {
    const random = seeded(20260917);
    const pick = <T,>(items: T[]): T => items[Math.floor(random() * items.length)];
    let positives = 0;

    for (let index = 0; index < 400; index += 1) {
      const parts: string[] = [pick(PIECES.marker), pick(PIECES.verb), pick(PIECES.secret)];
      for (let extra = 0; extra < 4; extra += 1) parts.push(pick(PIECES.filler));
      // Shuffle, so the three parts land on lines in every combination.
      for (let i = parts.length - 1; i > 0; i -= 1) {
        const j = Math.floor(random() * (i + 1));
        [parts[i], parts[j]] = [parts[j], parts[i]];
      }
      // Two families, or the corpus is one-sided: even strings keep every
      // part on one line (the pair blocks when the three happen to land in
      // order or reverse), odd ones separate every part with a line break
      // (the pair cannot block, whatever the order).
      const separators = index % 2 === 0 ? [" "] : LINE_BREAKS;
      const text = parts.reduce(
        (acc, part) => (acc === "" ? part : `${acc}${pick(separators)}${part}`),
        "",
      );

      const expected = legacyBlocked(text);
      if (expected) positives += 1;
      const decision = classifyChatContent(text);
      if (decision.reason === "privacy" && !expected) {
        throw new Error(`privacy over-blocked ${JSON.stringify(text)}`);
      }
      if (expected && decision.reason !== "privacy") {
        throw new Error(`privacy missed ${JSON.stringify(text)}`);
      }
    }

    // A cross-check that never blocks proves nothing.
    expect(positives).toBeGreaterThan(100);
    expect(positives).toBeLessThan(400);
  });
});

describe("the regex shape that froze sends", () => {
  const code = (name: string): string => {
    const source = require("fs").readFileSync(require("path").join(__dirname, name), "utf8");
    // Comments may quote the old pattern — that is documentation, not a pattern.
    return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
  };

  it("no pattern in the filter is lookahead-led any more", () => {
    // `(?=.*…).*` is the quadratic shape (an unanchored lookahead plus a greedy
    // chain, both re-walked per start position). Nothing may carry one, not just
    // the privacy pair that regressed.
    expect(code("contentFilter.js")).not.toMatch(/\(\?=/);
  });

  it("classifies an 8 kB benign message in under 20 ms", () => {
    // The reported stall: ~1.7 s on the simulator before send, all of it here.
    const filler =
      "the quick brown fox jumps over a lazy dog while bright birds sing above quiet meadows and rivers flow gently toward distant mountains and forests breathe ";
    let text = "";
    while (text.length < 8000) text += filler;
    text = text.slice(0, 8000);

    // Warm once (module load built the regexes), then measure a cold call.
    classifyChatContent(text);
    const started = Date.now();
    for (let i = 0; i < 10; i++) classifyChatContent(text);
    const perCall = (Date.now() - started) / 10;

    expect(classifyChatContent(text).decision).toBe("allow");
    expect(perCall).toBeLessThan(20);
  });
});