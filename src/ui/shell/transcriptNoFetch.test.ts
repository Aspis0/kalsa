/**
 * The two rules about the transcript's evidence that a rendered tree could not
 * prove, and that a screenshot could not see.
 *
 * 1. **No favicons and no previews — no request of any kind, and no storage
 *    (DESIGN.md §2.5, §2.4).** A chip that fetched an icon would tell every
 *    domain the user searched that the phone had looked at it; and the tool
 *    rows are volatile by decision, so nothing in this band may read or write
 *    the history path. Both are invisible in pixels — a fetching chip looks
 *    exactly like one that did not — so this is a SOURCE check: read the file,
 *    strip the comments, fail on the tokens that would mean a request or a
 *    store. The guards are themselves tested against samples, so a guard that
 *    quietly stopped matching cannot pass as green.
 *
 * 2. **The transcript is a leaf.** It imports nothing from `src/engine`,
 *    `src/app`, `src/screens` or `src/conversations`; the message shape it takes
 *    is its own (`transcriptTypes.ts`), and the two decisions it needs are pure
 *    modules beside it.
 */
import { readFileSync } from "fs";
import { join } from "path";

const read = (file: string): string => readFileSync(join(__dirname, file), "utf8");

/** Every file the transcript band is made of: added as the band grew (the
 *  renderer, inline spans and their styles; the edge fades), because a band
 *  file is a band file however decorative it is — new band files must be
 *  listed here. */
const BAND_FILES = [
  "Transcript.tsx",
  "TranscriptEdgeFade.tsx",
  "TranscriptParts.tsx",
  // Turn boxes + copy chip, split out of TranscriptParts when the long-press
  // landed (the seam that kept the stylesheet under the ratchet).
  "TranscriptTurns.tsx",
  "TranscriptEvidence.tsx",
  "TranscriptMarkdown.tsx",
  "TranscriptInline.tsx",
  "transcriptTypes.ts",
  "transcriptMarkdownStyles.ts",
  "toolLabels.ts",
  "sourceLinkPolicy.ts",
];

const SOURCES: Readonly<Record<string, string>> = Object.fromEntries(
  BAND_FILES.map((file) => [file, read(file)]),
);

const EVIDENCE = SOURCES["TranscriptEvidence.tsx"];

/**
 * Block and line comments removed before matching, so the prose that explains
 * the rules cannot trip them — the subject matter of these files IS a network
 * request. The line form is anchored to the start of a line on purpose: a `//`
 * inside a URL is not a comment.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

type Forbidden = { why: string; pattern: RegExp };

/** Every shape that would mean a request, a remote image, an asset or a store. */
const FORBIDDEN: readonly Forbidden[] = [
  { why: "calls fetch", pattern: /\bfetch\s*\(/ },
  { why: "opens a raw request", pattern: /\bXMLHttpRequest\b/ },
  { why: "uses an HTTP client", pattern: /\b(axios|superagent)\b/ },
  { why: "imports or draws an image component", pattern: /\b(Image|ImageBackground)\b/ },
  {
    why: "imports an image or web renderer",
    pattern: /expo-image|react-native-fast-image|react-native-webview/,
  },
  { why: "bundles an asset", pattern: /require\s*\(/ },
  { why: "touches the key-value store", pattern: /\bAsyncStorage\b/ },
  { why: "reads a local file", pattern: /FileSystem/ },
];

/** A sample of code that MUST match each rule, so the guard is not vacuous. */
const SAMPLES: Readonly<Record<string, string>> = {
  "calls fetch": "const response = await fetch(url);",
  "opens a raw request": "const request = new XMLHttpRequest();",
  "uses an HTTP client": "const client = axios.create();",
  "imports or draws an image component": "<Image source={{ uri: favicon }} />",
  "imports an image or web renderer": 'import { WebView } from "react-native-webview";',
  "bundles an asset": 'const LOGO = require("./favicon.png");',
  "touches the key-value store": 'import AsyncStorage from "@react-native-async-storage/async-storage";',
  "reads a local file": 'import * as FileSystem from "expo-file-system";',
};

function violations(source: string): string[] {
  const code = stripComments(source);
  return FORBIDDEN.filter((rule) => rule.pattern.test(code)).map((rule) => rule.why);
}

describe("the comment stripper the two guards depend on", () => {
  it("removes both comment forms", () => {
    expect(stripComments("// a fetch would go here\nconst x = 1;")).not.toContain("fetch");
    expect(stripComments("/* no fetch, ever */ const y = 2;")).not.toContain("fetch");
  });

  it("does not remove a `//` that is part of a string", () => {
    expect(stripComments('const u = "https://example.com/x";')).toContain("https://example.com/x");
  });
});

describe("the no-fetch, no-store rule (§2.5, §2.4)", () => {
  it("reads the files it claims to read", () => {
    expect(EVIDENCE).toContain("export function SourceChips");
    expect(EVIDENCE).toContain("export function ToolRows");
    expect(SOURCES["sourceLinkPolicy.ts"]).toContain("export function sourceChipDecision");
    expect(SOURCES["toolLabels.ts"]).toContain("export function toolRowLabel");
  });

  it("finds no request, no remote image, no asset and no store in any band file", () => {
    const found = Object.fromEntries(BAND_FILES.map((file) => [file, violations(SOURCES[file])]));
    expect(found).toEqual(Object.fromEntries(BAND_FILES.map((file) => [file, []])));
  });

  it("would catch each forbidden shape if one were added", () => {
    // The guard's own anti-rot check: every rule must have a sample, and every
    // sample must be caught. A rule added without a sample fails here.
    expect(Object.keys(SAMPLES).sort()).toEqual(FORBIDDEN.map((rule) => rule.why).sort());
    for (const [why, sample] of Object.entries(SAMPLES)) {
      expect(violations(sample)).toContain(why);
    }
  });

  it("hands a tappable address to the system browser and to nothing else", () => {
    const code = stripComments(EVIDENCE);
    // One call out of the app, and it is the reader's own tap.
    expect(code).toMatch(/\bLinking\.openURL\(/);
    expect(code.match(/\bLinking\./g)).toHaveLength(1);
  });

  it("takes both decisions from the pure modules instead of deciding inline", () => {
    expect(EVIDENCE).toMatch(/from "\.\/sourceLinkPolicy"/);
    expect(EVIDENCE).toMatch(/from "\.\/toolLabels"/);
  });
});

describe("the leaf rule", () => {
  const FORBIDDEN_IMPORTS = ["src/engine", "src/app", "src/screens", "src/conversations"];

  it("imports nothing from the engine, the app layer, a screen or a conversation store", () => {
    for (const file of BAND_FILES) {
      const code = stripComments(SOURCES[file]);
      const specifiers: string[] = [];
      const pattern = /^[ \t]*import\s[\s\S]*?from\s+"([^"]+)";?/gm;
      let match = pattern.exec(code);
      while (match !== null) {
        specifiers.push(match[1]);
        match = pattern.exec(code);
      }
      // Every one of these files imports something, so the check cannot pass by
      // finding no imports at all.
      expect(specifiers.length).toBeGreaterThan(0);
      for (const specifier of specifiers) {
        for (const forbidden of FORBIDDEN_IMPORTS) {
          expect(specifier).not.toContain(forbidden);
        }
      }
    }
  });
});
