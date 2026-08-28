/**
 * Harness for src/chat/markdown.ts — pure parser, streaming safety, content-loss,
 * URL scheme gate, pathological timing, golden-output structure assertions.
 * Plain Node, no test framework.
 * Prints PASS/FAIL per check and === OVERALL: PASS/FAIL === ; exit non-zero on fail.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "../..");

let passed = 0;
let failed = 0;

function check(name, cond, detail = "") {
  if (cond) {
    console.log(`PASS  ${name}`);
    passed++;
  } else {
    console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
}

function compile() {
  // Compile markdown + util/url together: isSafeHttpUrl lives in util/url and
  // is re-exported from markdown. Harness assertions must hit the real app code.
  const r = spawnSync(
    "npx",
    [
      "tsc",
      "src/chat/markdown.ts",
      "src/util/url.ts",
      "--outDir",
      "scripts/.build",
      "--module",
      "nodenext",
      "--target",
      "es2020",
      "--moduleResolution",
      "nodenext",
      "--skipLibCheck",
      "--ignoreConfig",
      "--declaration",
      "false",
      "--rootDir",
      "src",
    ],
    { cwd: projectRoot, encoding: "utf8", shell: true },
  );
  if (r.status !== 0) {
    console.error("tsc failed:\n", r.stdout, r.stderr);
    process.exit(1);
  }
}

function resolveBuilt() {
  const candidates = [
    path.join(projectRoot, "scripts/.build/chat/markdown.js"),
    path.join(projectRoot, "scripts/.build/markdown.js"),
    path.join(projectRoot, "scripts/.build/src/chat/markdown.js"),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  console.error("Could not find compiled markdown.js. Tried:\n", candidates.join("\n"));
  process.exit(1);
}

/** Visible text = concat of every inline node's text (rules contribute nothing). */
function visibleText(blocks) {
  let out = "";
  for (const b of blocks) {
    if (b.type === "rule") continue;
    for (const n of b.inline) out += n.text;
  }
  return out;
}

/** Serialize inline nodes to a stable structure string for golden asserts. */
function inlineShape(nodes) {
  return nodes
    .map((n) => {
      if (n.type === "link") return `link(${JSON.stringify(n.text)}→${JSON.stringify(n.href)})`;
      if (n.type === "citation")
        return `citation(${n.index},${JSON.stringify(n.text)})`;
      return `${n.type}(${JSON.stringify(n.text)})`;
    })
    .join("|");
}

function blockShape(blocks) {
  return blocks
    .map((b) => {
      if (b.type === "rule") return "rule";
      if (b.type === "heading") return `heading(${b.level}:${inlineShape(b.inline)})`;
      if (b.type === "listItem")
        return `listItem(${b.ordered ? "ol" : "ul"},${JSON.stringify(b.marker)},d${b.depth}:${inlineShape(b.inline)})`;
      if (b.type === "quote") return `quote(${inlineShape(b.inline)})`;
      return `paragraph(${inlineShape(b.inline)})`;
    })
    .join("\n");
}

/** True if `vis` is a subsequence of `src` (content never invented, order preserved). */
function isSubsequence(vis, src) {
  let j = 0;
  for (let i = 0; i < vis.length; i++) {
    const ch = vis[i];
    while (j < src.length && src[j] !== ch) j++;
    if (j >= src.length) return false;
    j++;
  }
  return true;
}

/**
 * Soft content-loss: visible is a subsequence of src (still useful, but not
 * sufficient alone — see golden corpus).
 */
function assertNoContentLoss(src, blocks) {
  const vis = visibleText(blocks);
  if (!isSubsequence(vis, src)) {
    return { ok: false, reason: `visible not subsequence of src (visLen=${vis.length})` };
  }
  if (vis.length > src.length) {
    return { ok: false, reason: `visible longer than src` };
  }
  return { ok: true };
}

function allInlineTypes(blocks) {
  const set = new Set();
  for (const b of blocks) {
    if (b.type === "rule") continue;
    for (const n of b.inline) set.add(n.type);
  }
  return set;
}

/**
 * Golden corpus: exact expected visible text and/or block shape.
 * This catches "drop every odd character" and "drop tail after last [" parsers
 * that pass the weak subsequence invariant.
 */
const GOLDEN = [
  {
    name: "golden plain",
    src: "plain text only",
    visible: "plain text only",
    shape: 'paragraph(text("plain text only"))',
  },
  {
    name: "golden bold",
    src: "say **bold** now",
    visible: "say bold now",
    shape: 'paragraph(text("say ")|bold("bold")|text(" now"))',
  },
  {
    name: "golden italic star",
    src: "say *italic* now",
    visible: "say italic now",
    hasType: "italic",
  },
  {
    name: "golden italic underscore",
    src: "say _italic_ now",
    visible: "say italic now",
    hasType: "italic",
  },
  {
    name: "golden code",
    src: "use `code` here",
    visible: "use code here",
    hasType: "code",
  },
  {
    name: "golden link",
    src: "see [docs](https://example.com) ok",
    visible: "see docs ok",
    href: "https://example.com",
  },
  // Fix 1 — flanking
  {
    name: "golden intraword underscore snake",
    src: "_snake_case_identifier_",
    visible: "_snake_case_identifier_",
    noType: "italic",
  },
  {
    name: "golden foo_bar_baz literal",
    src: "foo_bar_baz",
    visible: "foo_bar_baz",
    noType: "italic",
  },
  {
    name: "golden a * b * c literal",
    src: "a * b * c",
    visible: "a * b * c",
    noType: "italic",
  },
  {
    name: "golden x * 2 = 4 literal",
    src: "x * 2 = 4",
    visible: "x * 2 = 4",
    noType: "italic",
  },
  // Fix 3 — escapes & ***
  {
    name: "golden escape star",
    src: "\\*not bold\\*",
    visible: "*not bold*",
    noType: "italic",
  },
  {
    name: "golden escape underscore",
    src: "\\_not italic\\_",
    visible: "_not italic_",
    noType: "italic",
  },
  {
    name: "golden triple star bold",
    src: "***bold italic***",
    visible: "bold italic",
    hasType: "bold",
    // no stray leading * in payload
    boldText: "bold italic",
  },
  {
    name: "golden double bold",
    src: "**just bold**",
    visible: "just bold",
    hasType: "bold",
  },
  // Fix 4 — link titles
  {
    name: "golden link with double-quoted title",
    src: '[text](https://example.com "title")',
    visible: "text",
    href: "https://example.com",
  },
  {
    name: "golden link with single-quoted title",
    src: "[text](https://example.com 'title')",
    visible: "text",
    href: "https://example.com",
  },
  // Empty link label still parses but visible is empty
  {
    name: "golden empty link label",
    src: "[](https://x)",
    visible: "",
    hasType: "link",
  },
  // Heading / list / quote / rule shapes
  {
    name: "golden heading",
    src: "# Hello",
    visible: "Hello",
    shape: 'heading(1:text("Hello"))',
  },
  {
    name: "golden ordered list",
    src: "1. first",
    visible: "first",
    shape: 'listItem(ol,"1.",d0:text("first"))',
  },
  {
    name: "golden rule",
    src: "---",
    visible: "",
    shape: "rule",
  },
  {
    name: "golden unclosed markers",
    src: "**abc",
    visible: "**abc",
  },
  {
    name: "golden unclosed bracket keeps tail",
    src: "hello [world and more text",
    visible: "hello [world and more text",
  },
  {
    name: "golden full alphabet retained",
    src: "abcdefghijklmnopqrstuvwxyz",
    visible: "abcdefghijklmnopqrstuvwxyz",
  },
  // Structural goldens — pin block count / markers / full href (Fix 6)
  {
    name: "golden two paragraphs block count",
    src: "first paragraph\n\nsecond paragraph",
    visible: "first paragraphsecond paragraph",
    blockCount: 2,
    shape:
      'paragraph(text("first paragraph"))\nparagraph(text("second paragraph"))',
  },
  {
    name: "golden mixed document structure",
    src: "# Title\n\nPara one.\n\nPara two.\n\n1. a\n2. b\n3. c\n\n> quote\n\n---",
    blockCount: 8,
    shape:
      'heading(1:text("Title"))\n' +
      'paragraph(text("Para one."))\n' +
      'paragraph(text("Para two."))\n' +
      'listItem(ol,"1.",d0:text("a"))\n' +
      'listItem(ol,"2.",d0:text("b"))\n' +
      'listItem(ol,"3.",d0:text("c"))\n' +
      'quote(text("quote"))\n' +
      "rule",
  },
  {
    name: "golden link with query and fragment",
    src: "[q](https://x.test/a?b=1&c=2#frag)",
    visible: "q",
    href: "https://x.test/a?b=1&c=2#frag",
  },
  {
    name: "golden ordered list four markers",
    src: "1. a\n2. b\n3. c\n4. d",
    visible: "abcd",
    blockCount: 4,
    markers: ["1.", "2.", "3.", "4."],
  },
  {
    name: "golden two links on one line",
    src: "see [one](https://a.test/1) and [two](https://b.test/2) end",
    visible: "see one and two end",
    hrefs: ["https://a.test/1", "https://b.test/2"],
  },
  // ── Citations `[N]` ─────────────────────────────────────────────────────
  {
    name: "golden citation basic multi",
    src: "Fact [1] and other [12].",
    // Citation nodes keep literal text so no-content-loss holds.
    visible: "Fact [1] and other [12].",
    shape:
      'paragraph(text("Fact ")|citation(1,"[1]")|text(" and other ")|citation(12,"[12]")|text("."))',
  },
  {
    name: "golden citation link wins over [N]",
    src: "[1](https://x.test/a)",
    visible: "1",
    href: "https://x.test/a",
    shape: 'paragraph(link("1"→"https://x.test/a"))',
    noType: "citation",
  },
  {
    name: "golden citation rejects non-numeric brackets",
    src: "[a] [] [1a] [ 1 ]",
    visible: "[a] [] [1a] [ 1 ]",
    shape: 'paragraph(text("[a] [] [1a] [ 1 ]"))',
    noType: "citation",
  },
  {
    name: "golden citation unterminated stays literal",
    src: "unterminated [1",
    visible: "unterminated [1",
    shape: 'paragraph(text("unterminated [1"))',
    noType: "citation",
  },
  {
    name: "golden citation zero index",
    // Parser records index 0; renderer falls back to literal (no sources[-1]).
    src: "[0]",
    visible: "[0]",
    shape: 'paragraph(citation(0,"[0]"))',
    hasType: "citation",
  },
  {
    name: "golden citation after bold before punctuation",
    src: "**bold**[2].",
    visible: "bold[2].",
    shape: 'paragraph(bold("bold")|citation(2,"[2]")|text("."))',
  },
  {
    name: "golden citation adjacent multi",
    src: "Combined [1][3] claim.",
    visible: "Combined [1][3] claim.",
    shape:
      'paragraph(text("Combined ")|citation(1,"[1]")|citation(3,"[3]")|text(" claim."))',
  },
];

async function main() {
  console.log("Compiling src/chat/markdown.ts …");
  compile();
  const modPath = resolveBuilt();
  console.log("Loading", modPath);
  const mod = await import(pathToFileURL(modPath).href);
  const { parseMarkdownBlocks, flattenBlockText, isSafeHttpUrl, parseInline } = mod;

  // ── Empty / whitespace ──────────────────────────────────────────────────
  check("empty string → []", parseMarkdownBlocks("").length === 0);
  check(
    "whitespace-only → []",
    parseMarkdownBlocks("   \n\t\n  ").length === 0 ||
      visibleText(parseMarkdownBlocks("   \n\t\n  ")).trim() === "",
  );
  check(
    "only markers unclosed stay literal",
    (() => {
      const b = parseMarkdownBlocks("**");
      const vis = visibleText(b);
      return vis === "**";
    })(),
  );

  // ── Block types ─────────────────────────────────────────────────────────
  {
    const b = parseMarkdownBlocks("# Hello");
    check("heading h1", b.length === 1 && b[0].type === "heading" && b[0].level === 1);
    check("heading h1 text", visibleText(b) === "Hello");
  }
  {
    const b = parseMarkdownBlocks("## Sub");
    check("heading h2", b[0]?.type === "heading" && b[0].level === 2);
  }
  {
    const b = parseMarkdownBlocks("### L3");
    check("heading h3", b[0]?.type === "heading" && b[0].level === 3);
  }
  {
    const b = parseMarkdownBlocks("###### Deep");
    check("heading h6 clamps to 3", b[0]?.type === "heading" && b[0].level === 3);
  }
  {
    const b = parseMarkdownBlocks("- item one");
    check(
      "unordered list",
      b[0]?.type === "listItem" && b[0].ordered === false && visibleText(b) === "item one",
    );
  }
  {
    const b = parseMarkdownBlocks("* star item");
    check("unordered *", b[0]?.type === "listItem" && !b[0].ordered);
  }
  {
    const b = parseMarkdownBlocks("+ plus item");
    check("unordered +", b[0]?.type === "listItem" && !b[0].ordered);
  }
  {
    const b = parseMarkdownBlocks("1. first");
    check(
      "ordered list 1.",
      b[0]?.type === "listItem" &&
        b[0].ordered === true &&
        b[0].marker === "1." &&
        visibleText(b) === "first",
    );
  }
  {
    const b = parseMarkdownBlocks("2) second");
    check("ordered list 2)", b[0]?.type === "listItem" && b[0].marker === "2)");
  }
  {
    const b = parseMarkdownBlocks("  - nested");
    check("list depth 1 via indent", b[0]?.type === "listItem" && b[0].depth === 1);
  }
  {
    const b = parseMarkdownBlocks("        - deep");
    check("list depth clamps to 1", b[0]?.type === "listItem" && b[0].depth === 1);
  }
  {
    const b = parseMarkdownBlocks("> quoted");
    check("blockquote", b[0]?.type === "quote" && visibleText(b) === "quoted");
  }
  {
    const b = parseMarkdownBlocks("---");
    check("rule ---", b.length === 1 && b[0].type === "rule");
  }
  {
    const b = parseMarkdownBlocks("***");
    check("rule ***", b[0]?.type === "rule");
  }
  {
    const b = parseMarkdownBlocks("___");
    check("rule ___", b[0]?.type === "rule");
  }
  {
    const b = parseMarkdownBlocks("Just a paragraph.");
    check("paragraph", b[0]?.type === "paragraph" && visibleText(b) === "Just a paragraph.");
  }

  // ── Inline types ────────────────────────────────────────────────────────
  {
    const b = parseMarkdownBlocks("say **bold** now");
    const types = allInlineTypes(b);
    check("inline bold", types.has("bold") && visibleText(b) === "say bold now");
  }
  {
    const b = parseMarkdownBlocks("say *italic* now");
    check("inline italic *", allInlineTypes(b).has("italic") && visibleText(b) === "say italic now");
  }
  {
    const b = parseMarkdownBlocks("say _italic_ now");
    check("inline italic _", allInlineTypes(b).has("italic") && visibleText(b) === "say italic now");
  }
  {
    const b = parseMarkdownBlocks("use `code` here");
    check("inline code", allInlineTypes(b).has("code") && visibleText(b) === "use code here");
  }
  {
    const b = parseMarkdownBlocks("see [docs](https://example.com) ok");
    const types = allInlineTypes(b);
    check("inline link", types.has("link") && visibleText(b) === "see docs ok");
    const link = b[0].inline.find((n) => n.type === "link");
    check("link href preserved", link?.href === "https://example.com");
  }

  // ── Fix 1: flanking rules ───────────────────────────────────────────────
  check(
    "flank: _snake_case_identifier_ literal",
    visibleText(parseMarkdownBlocks("_snake_case_identifier_")) === "_snake_case_identifier_" &&
      !allInlineTypes(parseMarkdownBlocks("_snake_case_identifier_")).has("italic"),
  );
  check(
    "flank: foo_bar_baz literal",
    visibleText(parseMarkdownBlocks("foo_bar_baz")) === "foo_bar_baz" &&
      !allInlineTypes(parseMarkdownBlocks("foo_bar_baz")).has("italic"),
  );
  check(
    "flank: a * b * c literal",
    visibleText(parseMarkdownBlocks("a * b * c")) === "a * b * c" &&
      !allInlineTypes(parseMarkdownBlocks("a * b * c")).has("italic"),
  );
  check(
    "flank: x * 2 = 4 literal",
    visibleText(parseMarkdownBlocks("x * 2 = 4")) === "x * 2 = 4",
  );
  check(
    "flank: say _italic_ now still italic",
    allInlineTypes(parseMarkdownBlocks("say _italic_ now")).has("italic") &&
      visibleText(parseMarkdownBlocks("say _italic_ now")) === "say italic now",
  );
  check(
    "flank: say *italic* now still italic",
    allInlineTypes(parseMarkdownBlocks("say *italic* now")).has("italic") &&
      visibleText(parseMarkdownBlocks("say *italic* now")) === "say italic now",
  );

  // ── Fix 3: escapes & *** ────────────────────────────────────────────────
  check(
    "escape: \\*not bold\\* literal stars",
    visibleText(parseMarkdownBlocks("\\*not bold\\*")) === "*not bold*" &&
      !allInlineTypes(parseMarkdownBlocks("\\*not bold\\*")).has("italic") &&
      !allInlineTypes(parseMarkdownBlocks("\\*not bold\\*")).has("bold"),
  );
  check(
    "escape: \\_not italic\\_ literal",
    visibleText(parseMarkdownBlocks("\\_not italic\\_")) === "_not italic_",
  );
  check(
    "escape: \\`code\\` literal",
    visibleText(parseMarkdownBlocks("\\`code\\`")) === "`code`",
  );
  check(
    "escape: \\[not a link\\]",
    visibleText(parseMarkdownBlocks("\\[not a link\\](https://x)")) === "[not a link](https://x)",
  );
  {
    const b = parseMarkdownBlocks("***bold italic***");
    const bold = b[0]?.inline?.find((n) => n.type === "bold");
    check(
      "triple-star: bold without stray *",
      bold?.text === "bold italic" && visibleText(b) === "bold italic",
      bold ? `got bold text=${JSON.stringify(bold.text)} vis=${JSON.stringify(visibleText(b))}` : "no bold node",
    );
  }

  // ── Fix 4: link titles ──────────────────────────────────────────────────
  {
    const b = parseMarkdownBlocks('[click](https://example.com "My Title")');
    const link = b[0]?.inline?.find((n) => n.type === "link");
    check(
      "link title double-quoted discarded from href",
      link?.href === "https://example.com" && link?.text === "click",
      link ? `href=${JSON.stringify(link.href)}` : "no link",
    );
  }
  {
    const b = parseMarkdownBlocks("[click](https://example.com 'My Title')");
    const link = b[0]?.inline?.find((n) => n.type === "link");
    check(
      "link title single-quoted discarded from href",
      link?.href === "https://example.com",
      link ? `href=${JSON.stringify(link.href)}` : "no link",
    );
  }
  {
    const linkNode = parseMarkdownBlocks('[t](https://example.com "x")')[0]?.inline?.find(
      (n) => n.type === "link",
    );
    check(
      "link title href still safe",
      !!linkNode && isSafeHttpUrl(linkNode.href) === true,
      linkNode ? `href=${JSON.stringify(linkNode.href)}` : "no link node",
    );
  }

  // ── Unclosed markers render literally ───────────────────────────────────
  check(
    "unclosed ** literal",
    visibleText(parseMarkdownBlocks("**abc")) === "**abc",
  );
  check(
    "unclosed ` literal",
    visibleText(parseMarkdownBlocks("`abc")) === "`abc",
  );
  check(
    "unclosed _ literal",
    visibleText(parseMarkdownBlocks("_abc")) === "_abc",
  );
  check(
    "unclosed * literal",
    visibleText(parseMarkdownBlocks("*abc")) === "*abc",
  );
  check(
    "unclosed [text]( literal",
    visibleText(parseMarkdownBlocks("[text](http://x")) === "[text](http://x",
  );
  check(
    "unclosed [text only",
    visibleText(parseMarkdownBlocks("[text only")) === "[text only",
  );

  // ── URL scheme gate ─────────────────────────────────────────────────────
  check("safe https", isSafeHttpUrl("https://example.com/a") === true);
  check("safe http", isSafeHttpUrl("http://example.com") === true);
  check("reject javascript:", isSafeHttpUrl("javascript:alert(1)") === false);
  check("reject data:", isSafeHttpUrl("data:text/html,hi") === false);
  check("reject file:", isSafeHttpUrl("file:///etc/passwd") === false);
  check("reject scheme-less", isSafeHttpUrl("example.com/path") === false);
  check("reject empty", isSafeHttpUrl("") === false);
  check("reject intent:", isSafeHttpUrl("intent://scan") === false);
  check("accept uppercase scheme", isSafeHttpUrl("HTTPS://example.com/a") === true);
  check("accept mixed-case scheme", isSafeHttpUrl("HtTp://example.com/a") === true);
  check("accept hyphen in host", isSafeHttpUrl("https://my-site.co.uk/a-b") === true);
  check("accept fragment", isSafeHttpUrl("https://example.com/a#frag") === true);
  check("accept query", isSafeHttpUrl("https://example.com/a?q=1&r=2") === true);
  check("reject scheme with no authority", isSafeHttpUrl("http:") === false);
  check("reject https:evil (no //)", isSafeHttpUrl("https:evil") === false);
  check("reject embedded space", isSafeHttpUrl("https://example.com/a b") === false);
  check("reject embedded tab", isSafeHttpUrl("https://example.com/a\tb") === false);
  check("reject embedded newline", isSafeHttpUrl("https://exa\nmple.com") === false);
  check("reject control char", isSafeHttpUrl("https://example.com/\u0001x") === false);
  check("reject DEL char", isSafeHttpUrl("https://example.com/\u007fx") === false);
  check("reject javascript: with fragment", isSafeHttpUrl("javascript:x#y") === false);
  check("reject protocol-relative", isSafeHttpUrl("//example.com") === false);

  // Fix 5 — invisible / format characters rejected; IDN + IPv6 still accepted
  check(
    "reject ZWSP authority rewrite",
    isSafeHttpUrl("https://example.com\u200b@evil.com") === false,
  );
  check("reject ZWNJ", isSafeHttpUrl("https://example.com\u200c/x") === false);
  check("reject ZWJ", isSafeHttpUrl("https://example.com\u200d/x") === false);
  check("reject LTR mark", isSafeHttpUrl("https://example.com\u200e/x") === false);
  check("reject RTL mark", isSafeHttpUrl("https://example.com\u200f/x") === false);
  check("reject WJ", isSafeHttpUrl("https://example.com\u2060/x") === false);
  check("reject BOM", isSafeHttpUrl("https://example.com\ufeff/x") === false);
  check("reject NEL U+0085", isSafeHttpUrl("https://example.com\u0085/x") === false);
  check("reject line separator U+2028", isSafeHttpUrl("https://example.com\u2028/x") === false);
  check("reject para separator U+2029", isSafeHttpUrl("https://example.com\u2029/x") === false);
  check("reject Mongolian vowel sep U+180E", isSafeHttpUrl("https://example.com\u180e/x") === false);
  check(
    "reject function application U+2061",
    isSafeHttpUrl("https://example.com\u2061/x") === false,
  );
  // Fix 7 — bidi overrides + soft hyphen rejected; IDN + IPv6 still accepted
  check(
    "reject RLO bidi override U+202E",
    isSafeHttpUrl("https://example.com\u202Ehttps://evil.com") === false,
  );
  check(
    "reject LRE bidi embedding U+202A",
    isSafeHttpUrl("https://example.com\u202A/x") === false,
  );
  check(
    "reject RLE bidi embedding U+202B",
    isSafeHttpUrl("https://example.com\u202B/x") === false,
  );
  check(
    "reject PDF bidi pop U+202C",
    isSafeHttpUrl("https://example.com\u202C/x") === false,
  );
  check(
    "reject LRO bidi override U+202D",
    isSafeHttpUrl("https://example.com\u202D/x") === false,
  );
  check(
    "reject soft hyphen U+00AD",
    isSafeHttpUrl("https://example.com\u00ADevil.com") === false,
  );
  check(
    "accept IDN Japanese",
    isSafeHttpUrl("https://\u4f8b\u3048.jp/\u30d1\u30b9?q=\u5024") === true,
  );
  check("accept IPv6 localhost", isSafeHttpUrl("https://[::1]:8080/x") === true);

  // ── Golden-output corpus (strict) ───────────────────────────────────────
  let goldenFails = 0;
  for (const g of GOLDEN) {
    let blocks;
    try {
      blocks = parseMarkdownBlocks(g.src);
    } catch (e) {
      goldenFails++;
      check(`golden: ${g.name}`, false, `threw ${e}`);
      continue;
    }
    const vis = visibleText(blocks);
    let ok = true;
    let detail = "";
    if (g.visible !== undefined && vis !== g.visible) {
      ok = false;
      detail = `visible got ${JSON.stringify(vis)} want ${JSON.stringify(g.visible)}`;
    }
    if (ok && g.shape !== undefined) {
      const sh = blockShape(blocks);
      if (sh !== g.shape) {
        ok = false;
        detail = `shape got ${JSON.stringify(sh)} want ${JSON.stringify(g.shape)}`;
      }
    }
    if (ok && g.hasType) {
      if (!allInlineTypes(blocks).has(g.hasType)) {
        ok = false;
        detail = `missing type ${g.hasType}`;
      }
    }
    if (ok && g.noType) {
      if (allInlineTypes(blocks).has(g.noType)) {
        ok = false;
        detail = `unexpected type ${g.noType}`;
      }
    }
    if (ok && g.href !== undefined) {
      const link = blocks[0]?.inline?.find((n) => n.type === "link");
      if (link?.href !== g.href) {
        ok = false;
        detail = `href got ${JSON.stringify(link?.href)} want ${JSON.stringify(g.href)}`;
      }
    }
    if (ok && g.hrefs !== undefined) {
      const got = [];
      for (const b of blocks) {
        if (b.type === "rule") continue;
        for (const n of b.inline) {
          if (n.type === "link") got.push(n.href);
        }
      }
      if (JSON.stringify(got) !== JSON.stringify(g.hrefs)) {
        ok = false;
        detail = `hrefs got ${JSON.stringify(got)} want ${JSON.stringify(g.hrefs)}`;
      }
    }
    if (ok && g.blockCount !== undefined) {
      if (blocks.length !== g.blockCount) {
        ok = false;
        detail = `blockCount got ${blocks.length} want ${g.blockCount}`;
      }
    }
    if (ok && g.markers !== undefined) {
      const got = blocks.filter((b) => b.type === "listItem").map((b) => b.marker);
      if (JSON.stringify(got) !== JSON.stringify(g.markers)) {
        ok = false;
        detail = `markers got ${JSON.stringify(got)} want ${JSON.stringify(g.markers)}`;
      }
    }
    if (ok && g.boldText !== undefined) {
      const bold = blocks[0]?.inline?.find((n) => n.type === "bold");
      if (bold?.text !== g.boldText) {
        ok = false;
        detail = `bold text got ${JSON.stringify(bold?.text)}`;
      }
    }
    check(`golden: ${g.name}`, ok, detail);
    if (!ok) goldenFails++;
  }
  check("golden corpus all pass", goldenFails === 0, `${goldenFails} failures`);

  // ── Soft no-content-loss over extended corpus ───────────────────────────
  const corpus = [
    "",
    "plain",
    "**b**",
    "*i*",
    "_u_",
    "`c`",
    "[t](https://a.com)",
    "# H",
    "## H2\n### H3",
    "- a\n- b",
    "1. x\n2. y",
    "> q",
    "---",
    "**unclosed",
    "`unclosed",
    "_unclosed",
    "[nope](javascript:x)",
    "mix **b** and `c` and *i*",
    "line1\n\nline2",
    "  - nested item with **bold**",
    "###### deep heading",
    "hello\r\nworld",
    "****",
    "a*b*c",
    "text with [link](https://x.test) end",
    "```not a fence here```",
    "1) paren ordered",
    "+ plus\n* star\n- dash",
    ">\n> empty-ish",
    "___",
    "_snake_case_identifier_",
    "foo_bar_baz",
    "a * b * c",
    "\\*escaped\\*",
    "***triple***",
    '[t](https://x.com "title")',
    "Fact [1] and other [12].",
    "[1](https://x.test/a)",
    "[a] [] [1a] [ 1 ]",
    "unterminated [1",
    "[0]",
    "**bold**[2].",
    "Combined [1][3] claim.",
  ];
  check("corpus size ≥ 20", corpus.length >= 20, `got ${corpus.length}`);

  let lossFails = 0;
  for (let i = 0; i < corpus.length; i++) {
    const s = corpus[i];
    let blocks;
    try {
      blocks = parseMarkdownBlocks(s);
    } catch (e) {
      lossFails++;
      console.log(`  loss throw on corpus[${i}]: ${e}`);
      continue;
    }
    const r = assertNoContentLoss(s, blocks);
    if (!r.ok) {
      lossFails++;
      console.log(`  loss fail corpus[${i}]: ${r.reason} src=${JSON.stringify(s)}`);
    }
    if (typeof flattenBlockText === "function" && flattenBlockText(blocks) !== visibleText(blocks)) {
      lossFails++;
    }
  }
  check("no-content-loss corpus", lossFails === 0, `${lossFails} failures`);

  // ── Streaming: every prefix of a realistic multi-block doc ──────────────
  const doc = [
    "# Title of the answer",
    "",
    "Here is a **bold** claim and some *italic* nuance with `code`.",
    "",
    "A cited fact [1] and a multi [1][3].",
    "",
    "Relevant links: [docs](https://example.com/docs) and more.",
    "",
    "## Steps",
    "",
    "1. First install the package",
    "2. Then run the server",
    "",
    "- bullet alpha",
    "- bullet beta",
    "  - nested gamma",
    "",
    "> A wise quote about streaming parsers.",
    "",
    "---",
    "",
    "Closing paragraph with _underscore_ emphasis.",
  ].join("\n");

  let streamFails = 0;
  let streamThrow = 0;
  for (let n = 0; n <= doc.length; n++) {
    const prefix = doc.slice(0, n);
    let blocks;
    try {
      blocks = parseMarkdownBlocks(prefix);
    } catch (e) {
      streamThrow++;
      streamFails++;
      continue;
    }
    const r = assertNoContentLoss(prefix, blocks);
    if (!r.ok) streamFails++;
  }
  check(
    "streaming prefixes never throw",
    streamThrow === 0,
    `${streamThrow} throws over ${doc.length + 1} prefixes`,
  );
  check(
    "streaming prefixes never lose content",
    streamFails === 0,
    `${streamFails} failures over ${doc.length + 1} prefixes`,
  );

  // Structural: once the streaming input is complete, block count is stable
  // (catches merges of blank-line-separated paragraphs that still pass subsequence).
  {
    const fullBlocks = parseMarkdownBlocks(doc);
    const fullCount = fullBlocks.length;
    const again = parseMarkdownBlocks(doc).length;
    check(
      "streaming corpus complete block count stable",
      fullCount === again && fullCount >= 8,
      `count=${fullCount} again=${again}`,
    );
    // Completed document must retain blank-line paragraph splits (not one wall).
    const paraCount = fullBlocks.filter((b) => b.type === "paragraph").length;
    check(
      "streaming corpus complete has multiple paragraphs",
      paraCount >= 2,
      `paragraphs=${paraCount}`,
    );
  }

  function retainedPayload(blocks) {
    let out = "";
    for (const b of blocks) {
      if (b.type === "rule") continue;
      for (const n of b.inline) {
        out += n.text;
        if (n.type === "link") out += n.href;
      }
    }
    return out;
  }
  let payloadRegression = 0;
  let prevPay = "";
  for (let n = 0; n <= doc.length; n++) {
    const prefix = doc.slice(0, n);
    const pay = retainedPayload(parseMarkdownBlocks(prefix));
    if (n > 0 && pay.length < prevPay.length - 4) {
      payloadRegression++;
    }
    prevPay = pay;
  }
  check(
    "streaming retained payload no catastrophic vanish",
    payloadRegression === 0,
    `${payloadRegression} regressions`,
  );

  // ── Pathological inputs (TIME_BUDGET_MS = 150) ──────────────────────────
  // Measured worst case after Fix 2 is ~7.6 ms; 150 leaves ~20× headroom and
  // would have caught the 2154 ms quadratic `[` regression.
  const TIME_BUDGET_MS = 150;

  {
    const big = "word ".repeat(20_000); // ~100 KB
    const t0 = performance.now();
    const blocks = parseMarkdownBlocks(big);
    const ms = performance.now() - t0;
    console.log(`  timing 100KB paragraph: ${ms.toFixed(2)} ms`);
    check("100KB paragraph parses", blocks.length >= 1);
    check(
      "100KB paragraph under budget",
      ms < TIME_BUDGET_MS,
      `${ms.toFixed(2)} ms >= ${TIME_BUDGET_MS}`,
    );
    check("100KB no content loss", assertNoContentLoss(big, blocks).ok);
  }

  {
    const asRule = "*".repeat(5000);
    const t0 = performance.now();
    const ruleBlocks = parseMarkdownBlocks(asRule);
    const msRule = performance.now() - t0;
    console.log(`  timing 5000 stars as rule line: ${msRule.toFixed(2)} ms`);
    check("5000 stars rule parses", ruleBlocks.length === 1 && ruleBlocks[0].type === "rule");
    check(
      "5000 stars rule under budget",
      msRule < TIME_BUDGET_MS,
      `${msRule.toFixed(2)} ms >= ${TIME_BUDGET_MS}`,
    );

    const inlineStress = `keep ${"*".repeat(5000)} end`;
    const t1 = performance.now();
    const inlineBlocks = parseMarkdownBlocks(inlineStress);
    const msInline = performance.now() - t1;
    console.log(`  timing 5000 stars inline stress: ${msInline.toFixed(2)} ms`);
    check("5000 stars inline parses", Array.isArray(inlineBlocks));
    check(
      "5000 stars inline under budget",
      msInline < TIME_BUDGET_MS,
      `${msInline.toFixed(2)} ms >= ${TIME_BUDGET_MS}`,
    );
    check("5000 stars inline no content loss", assertNoContentLoss(inlineStress, inlineBlocks).ok);
    check(
      "5000 stars keeps surrounding words",
      visibleText(inlineBlocks).includes("keep") && visibleText(inlineBlocks).includes("end"),
    );
  }

  {
    const deep = Array.from({ length: 200 }, (_, i) => `${" ".repeat(i % 8)}- item ${i}`).join(
      "\n",
    );
    const t0 = performance.now();
    const blocks = parseMarkdownBlocks(deep);
    const ms = performance.now() - t0;
    console.log(`  timing deep lists (200 lines): ${ms.toFixed(2)} ms`);
    check("deep lists parse", blocks.every((b) => b.type === "listItem"));
    check(
      "deep lists under budget",
      ms < TIME_BUDGET_MS,
      `${ms.toFixed(2)} ms >= ${TIME_BUDGET_MS}`,
    );
    check(
      "deep lists depth clamped",
      blocks.every((b) => b.depth === 0 || b.depth === 1),
    );
  }

  // Fix 2 / Fix 9: quadratic unclosed `[` inputs — must stay linear
  for (const n of [2000, 10000, 40000]) {
    const brackets = "[".repeat(n);
    const t0 = performance.now();
    const blocks = parseMarkdownBlocks(brackets);
    const ms = performance.now() - t0;
    console.log(`  timing '['.repeat(${n}): ${ms.toFixed(2)} ms`);
    check(
      `'['.repeat(${n}) under budget`,
      ms < TIME_BUDGET_MS,
      `${ms.toFixed(2)} ms >= ${TIME_BUDGET_MS}`,
    );
    check(
      `'['.repeat(${n}) preserves all brackets`,
      visibleText(blocks) === brackets,
      `visLen=${visibleText(blocks).length} want ${n}`,
    );
  }

  // parseInline export smoke
  if (typeof parseInline === "function") {
    const nodes = parseInline("a **b** c");
    check(
      "parseInline export",
      nodes.some((n) => n.type === "bold" && n.text === "b"),
    );
  }

  // ── Multi-block mix ─────────────────────────────────────────────────────
  {
    const b = parseMarkdownBlocks("# T\n\npara **x**\n\n- li\n\n---\n\n> q");
    check(
      "multi-block mix types",
      b.some((x) => x.type === "heading") &&
        b.some((x) => x.type === "paragraph") &&
        b.some((x) => x.type === "listItem") &&
        b.some((x) => x.type === "rule") &&
        b.some((x) => x.type === "quote"),
    );
  }

  console.log("");
  console.log(`=== OVERALL: ${failed === 0 ? "PASS" : "FAIL"} ===`);
  console.log(`(${passed} passed, ${failed} failed)`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
