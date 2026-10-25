/**
 * The document parser's traps (step 3b): GFM pipe tables and fenced code, and
 * above all what they do while an answer is still arriving.
 *
 * The centrepiece is the prefix walk. A streaming answer is a sequence of
 * prefixes, and the failure this step is written against is a partial boundary
 * that swallows a line, prints one twice, reorders two, or invents a word. So
 * rather than assert a handful of hand-picked boundaries, the walk parses EVERY
 * prefix of a document that contains every construct, and requires the words it
 * produces to be exactly the words of that prefix, in order — under LF and again
 * under CRLF. A parser that ate the header row of a table, or drew a table row
 * twice while the separator row was half-arrived, cannot pass it.
 */
import {
  parseMarkdownDocument,
  type DocBlock,
  type TableRow,
} from "./markdownDocument";
import { parseMarkdownBlocks, type InlineNode } from "./markdown";

/** Concatenated plain text of one inline run — every node carries its `text`. */
const inline = (nodes: readonly InlineNode[]): string => nodes.map((node) => node.text).join("");

const rowText = (row: TableRow): string[] => row.map(inline);

/** The words a parse produces, in order, wherever they sit. */
function words(blocks: readonly DocBlock[]): string[] {
  const out: string[] = [];
  for (const block of blocks) {
    if (block.type === "code") {
      if (block.lang !== null) out.push(block.lang);
      out.push(...block.code.split(/\s+/));
    } else if (block.type === "prose") {
      for (const md of block.blocks) {
        if (md.type !== "rule") out.push(...inline(md.inline).split(/\s+/));
      }
    } else {
      for (const row of [block.header, ...block.rows]) {
        for (const cell of row) out.push(...inline(cell).split(/\s+/));
      }
    }
  }
  return out.filter((word) => word.length > 0);
}

/**
 * Alphanumeric tokens only, on both sides of the comparison: the parser is
 * allowed to fold syntax (`|`, `---`, a fence marker) and to drop a cell's
 * surrounding spaces, and it is not allowed to fold two words into one or to
 * lose one. Splitting on every non-alphanumeric makes a merge ("alfabravo")
 * fail loudly.
 */
const tokens = (text: string): string[] => text.split(/[^A-Za-z0-9]+/).filter((w) => w !== "");

const tokensOf = (blocks: readonly DocBlock[]): string[] => tokens(words(blocks).join(" "));

function table(src: string): Extract<DocBlock, { type: "table" }> {
  const blocks = parseMarkdownDocument(src);
  const found = blocks.filter(
    (block): block is Extract<DocBlock, { type: "table" }> => block.type === "table",
  );
  if (found.length !== 1) throw new Error(`expected one table, got ${found.length}`);
  return found[0]!;
}

function code(src: string): { lang: string | null; code: string } {
  const blocks = parseMarkdownDocument(src);
  const found = blocks.filter(
    (block): block is Extract<DocBlock, { type: "code" }> => block.type === "code",
  );
  if (found.length !== 1) throw new Error(`expected one code block, got ${found.length}`);
  return { lang: found[0]!.lang, code: found[0]!.code };
}

const types = (blocks: readonly DocBlock[]): string[] => blocks.map((block) => block.type);

/**
 * Every construct in one document: prose, a blank line, a list, a rule, a
 * three-column table with a short row and an escaped pipe, a quote, and a
 * fence at the end.
 *
 * Two constructs are deliberately absent, because both drop source text BY
 * DESIGN and would make the word-by-word comparison below measure the wrong
 * thing: a link (its destination is never printed) and a row with more cells
 * than the header (GFM ignores the extras — see the ragged-row test, which
 * asserts that fold on purpose). Emphasis is absent too: `alfa**bravo**` is two
 * words in the source and one joined word on screen, so it would be a source of
 * false alarms rather than of evidence.
 */
const SAMPLE =
  "alfa reports the method.\n" +
  "\n" +
  "- bravo is steady\n" +
  "- charlie is slow\n" +
  "\n" +
  "---\n" +
  "\n" +
  "| method | delta error | echo cost |\n" +
  "|---|---|---|\n" +
  "| one | foxtrot | golf |\n" +
  "| two | hotel |\n" +
  "| three \\| point | india | juliet |\n" +
  "\n" +
  "> mike holds flat\n" +
  "\n" +
  "```json\n" +
  '{ "lang": "lima" }\n' +
  "```\n" +
  "november closes the answer";

describe("streaming: every partial boundary (the reason the parser is pure)", () => {
  it("keeps every word, once, in order, at every prefix of the document", () => {
    // The sample has to be long enough for the walk to mean something.
    expect(tokens(SAMPLE).length).toBeGreaterThan(30);
    for (let end = 1; end <= SAMPLE.length; end += 1) {
      const prefix = SAMPLE.slice(0, end);
      expect(tokensOf(parseMarkdownDocument(prefix))).toEqual(tokens(prefix));
    }
  });

  it("does the same under CRLF, where a stray \\r would break every matcher", () => {
    const crlf = SAMPLE.replace(/\n/g, "\r\n");
    for (let end = 1; end <= crlf.length; end += 1) {
      const prefix = crlf.slice(0, end);
      expect(tokensOf(parseMarkdownDocument(prefix))).toEqual(tokens(prefix));
    }
  });
});

describe("fenced code (§2.2: no highlighting, no copy control)", () => {
  it("grows to the end of the text while no closing fence has arrived", () => {
    const blocks = parseMarkdownDocument('Intro\n```json\n{ "a": 1 }');
    expect(types(blocks)).toEqual(["prose", "code"]);
    expect(blocks[1]).toEqual({ type: "code", lang: "json", code: '{ "a": 1 }' });
  });

  it("takes the language as the fence's first word and nothing after it", () => {
    expect(code("```json title=x\n{}")).toEqual({ lang: "json", code: "{}" });
    expect(code("```\n{}\n```")).toEqual({ lang: null, code: "{}" });
  });

  it("renders an empty fence as an empty code block, never as prose", () => {
    expect(parseMarkdownDocument("```\n```")).toEqual([{ type: "code", lang: null, code: "" }]);
    expect(parseMarkdownDocument("```py\n```")).toEqual([{ type: "code", lang: "py", code: "" }]);
    expect(parseMarkdownDocument("```")).toEqual([{ type: "code", lang: null, code: "" }]);
  });

  it("closes on the same character only, and on a longer run of it", () => {
    expect(code("~~~js\nx\n~~~")).toEqual({ lang: "js", code: "x" });
    expect(code("```js\nx\n````")).toEqual({ lang: "js", code: "x" });
    // A tilde fence is not closed by backticks: the block runs to the end.
    expect(code("```js\nx\n~~~")).toEqual({ lang: "js", code: "x\n~~~" });
    // A backtick fence is not closed by three tildes either, and a closer with
    // text after it is content.
    expect(code("~~~js\nx\n```")).toEqual({ lang: "js", code: "x\n```" });
  });

  it("needs the fence at the start of a line", () => {
    expect(types(parseMarkdownDocument("text with ``` inside"))).toEqual(["prose"]);
    expect(types(parseMarkdownDocument("    ```json"))).toEqual(["prose"]);
    expect(types(parseMarkdownDocument("text\n```js\nx\n```"))).toEqual(["prose", "code"]);
  });

  it("never parses its content as inline markdown", () => {
    expect(code("```\n**not bold**\n```")).toEqual({ lang: null, code: "**not bold**" });
    expect(code("```\n| a | b |\n|---|---|\n```")).toEqual({
      lang: null,
      code: "| a | b |\n|---|---|",
    });
  });

  it("removes up to the opening fence's own indent from each line", () => {
    expect(code("  ```js\n    x\n  y\n  ```")).toEqual({ lang: "js", code: "  x\ny" });
  });
});

describe("pipe tables (§2.2: three columns at 349 dp scroll, they are never cut)", () => {
  it("appears the moment the separator row is complete", () => {
    const blocks = parseMarkdownDocument("| a | b |\n|---|---|");
    expect(types(blocks)).toEqual(["table"]);
    const found = table("| a | b |\n|---|---|");
    expect(rowText(found.header)).toEqual(["a", "b"]);
    expect(found.rows).toEqual([]);
  });

  it("falls back to a paragraph while the separator row is missing or half-typed", () => {
    for (const partial of ["| a | b |\n", "| a | b |\n|", "| a | b |\n|--", "| a | b |\n|---|"]) {
      const blocks = parseMarkdownDocument(partial);
      expect(types(blocks)).toEqual(["prose"]);
      // Nothing is dropped on the way: the pipes are still on screen.
      expect(words(blocks).join(" ")).toContain("a");
      expect(words(blocks).join(" ")).toContain("b");
    }
  });

  it("refuses a separator whose column count does not match the header", () => {
    expect(types(parseMarkdownDocument("| a | b |\n|---|---|---|"))).toEqual(["prose"]);
    expect(types(parseMarkdownDocument("| a | b | c |\n|---|---|"))).toEqual(["prose"]);
    // One dash is a valid separator cell; a letter in it is not.
    expect(types(parseMarkdownDocument("| a | b |\n|-|---|"))).toEqual(["table"]);
    expect(types(parseMarkdownDocument("| a | b |\n|--|--x|"))).toEqual(["prose"]);
  });

  it("does not need the leading and trailing pipes", () => {
    const found = table("a | b\n--- | ---\n1 | 2");
    expect(rowText(found.header)).toEqual(["a", "b"]);
    expect(found.rows.map(rowText)).toEqual([["1", "2"]]);
  });

  it("normalises a ragged row to the header's column count", () => {
    const found = table("| a | b | c |\n|---|---|---|\n| 1 |\n| 1 | 2 | 3 | 4 |");
    expect(found.rows.map(rowText)).toEqual([
      ["1", "", ""],
      ["1", "2", "3"],
    ]);
  });

  it("reads alignment from the separator row and defaults to none", () => {
    expect(table("| a | b | c |\n|:--|:-:|--:|\n").align).toEqual(["left", "center", "right"]);
    expect(table("| a |\n|---|\n").align).toEqual([null]);
  });

  it("keeps an escaped pipe inside its cell, and does not let `\\\\` escape one", () => {
    expect(rowText(table("| a \\| b |\n|---|\n| c \\| d |").header)).toEqual(["a | b"]);
    expect(rowText(table("| a \\\\| b |\n|---|---|").header)).toEqual(["a \\", "b"]);
  });

  it("splits a cell on a pipe inside a code span, as GFM does", () => {
    // Documented rather than liked: GitHub splits the row before it parses inline
    // content, so the code span does not protect the pipe.
    expect(rowText(table("| `a|b` | c |\n|---|---|---|").header)).toEqual(["`a", "b`", "c"]);
  });

  it("ends at the first line that is not a row, and re-reads that line", () => {
    const blocks = parseMarkdownDocument("| a | b |\n|---|---|\n| 1 | 2 |\nafter");
    expect(types(blocks)).toEqual(["table", "prose"]);
    expect(tokensOf(blocks)).toEqual(["a", "b", "1", "2", "after"]);
  });

  it("ends at a blank line", () => {
    const blocks = parseMarkdownDocument("| a | b |\n|---|---|\n| 1 | 2 |\n\nafter");
    expect(types(blocks)).toEqual(["table", "prose"]);
    expect(tokensOf(blocks)).toEqual(["a", "b", "1", "2", "after"]);
  });

  it("reads a line of one pipe as a row of empty cells", () => {
    const found = table("| a | b |\n|---|---|\n|");
    expect(found.rows.map(rowText)).toEqual([["", ""]]);
  });

  it("does not mistake a fence inside a cell for a code block", () => {
    const found = table("| a | b |\n|---|---|\n| ```x``` | y |");
    // Still a row, and its cell is ordinary inline content: the backticks are a
    // code span there, so the text they wrap is what the reader sees.
    expect(found.rows.map(rowText)).toEqual([["x", "y"]]);
    expect(found.rows[0]![0]![0]!.type).toBe("code");
  });

  it("ends at a line that opens a fence, and leaves that line to the fence", () => {
    const blocks = parseMarkdownDocument("| a | b |\n|---|---|\n```js\nx\n```");
    expect(types(blocks)).toEqual(["table", "code"]);
    expect(blocks[1]).toEqual({ type: "code", lang: "js", code: "x" });
  });
});

describe("the old parser is reused, not re-implemented", () => {
  it("reads a document with no table and no fence exactly as it always did", () => {
    const text = "# Title\n\n- one\n- two\n\n> quoted\n\n---\n\nplain *emphasis* and `code`";
    const blocks = parseMarkdownDocument(text);
    expect(types(blocks)).toEqual(["prose", "prose", "prose", "prose", "prose"]);
    const mine = blocks.flatMap((block) => (block.type === "prose" ? block.blocks : []));
    expect(mine).toEqual(parseMarkdownBlocks(text));
  });

  it("makes a blank line a paragraph gap and a single newline a soft line", () => {
    const blank = parseMarkdownDocument("one\n  \ntwo");
    expect(types(blank)).toEqual(["prose", "prose"]);
    const soft = parseMarkdownDocument("one\ntwo");
    expect(types(soft)).toEqual(["prose"]);
    expect(soft[0]!.type === "prose" && soft[0]!.blocks.length).toBe(2);
  });
});
