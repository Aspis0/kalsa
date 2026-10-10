// Run with: node --test scripts/markdown-subset.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";

import { parseBlocks, renderBlock, renderInline } from "./markdown-subset.mjs";

function rejects(source, label) {
  assert.throws(() => parseBlocks(source), new RegExp(`unsupported markdown at line \\d+: ${label}`));
}

test("each construct outside the subset throws with its label", () => {
  rejects("![logo](https://kalsa.io/x.png)", "image");
  rejects("an _emphasised_ word", "underscore emphasis");
  rejects("a *single* word", "single-asterisk emphasis");
  rejects("~~gone~~", "strikethrough");
  rejects("[site](http://kalsa.io)", "http link");
  rejects("1) first step", "parenthesised ordered list");
  rejects("Title\n===", "setext heading underline");
  rejects("Title\n---", "setext heading underline");
  rejects("* item", "asterisk or plus list");
  rejects("+ item", "asterisk or plus list");
  rejects("- parent\n  - child", "nested list");
  rejects("1. parent\n   1. child", "nested list");
  rejects("<b>bold</b>", "raw HTML");
  rejects("<div>", "raw HTML");
  rejects("#### too deep", "block syntax");
  rejects("| a | b |", "block syntax");
  rejects("use \\* to show a star", "backslash escape");
  rejects("Tom &amp; Jerry", "HTML entity");
});

test("code spans are literal: their content is not checked for markdown", () => {
  assert.deepEqual(parseBlocks("`a *b* _c_ \\* &amp; ![x](y)` ok"), [
    { type: "p", text: "`a *b* _c_ \\* &amp; ![x](y)` ok" },
  ]);
  assert.equal(
    renderInline("`C:\\logs\\` and `*x*`"),
    "<code>C:\\logs\\</code> and <code>*x*</code>",
  );
});

test("the one ignored form is an HTML comment, removed before parsing", () => {
  const blocks = parseBlocks("Before <!-- PHONE-APP-LINK --> after");
  assert.deepEqual(blocks, [{ type: "p", text: "Before after" }]);
});

test("the error names the line", () => {
  assert.throws(() => parseBlocks("fine\n\n~~no~~"), /unsupported markdown at line 3: strikethrough/);
});

test("headings, paragraphs and blank lines", () => {
  assert.deepEqual(parseBlocks("# Title\n\n## 1. Section\n\na line\ncontinued"), [
    { type: "h1", text: "Title" },
    { type: "h2", text: "1. Section" },
    { type: "p", text: "a line continued" },
  ]);
  assert.deepEqual(parseBlocks("### Sub"), [{ type: "h3", text: "Sub" }]);
});

test("bulleted and numbered lists, with indented continuations", () => {
  assert.deepEqual(parseBlocks("- one\n  more\n- two"), [{ type: "ul", items: ["one more", "two"] }]);
  assert.deepEqual(parseBlocks("1. a\n2. b"), [{ type: "ol", items: ["a", "b"] }]);
  assert.deepEqual(parseBlocks("- x\n\n- y"), [
    { type: "ul", items: ["x"] },
    { type: "ul", items: ["y"] },
  ]);
});

test("blockquote lines join into one quote, a bare > line included", () => {
  assert.deepEqual(parseBlocks("> one\n> two"), [{ type: "quote", text: "one two" }]);
  assert.deepEqual(parseBlocks("> one\n>\n> two"), [{ type: "quote", text: "one two" }]);
});

test("numbers and dots that are not a list stay paragraphs", () => {
  assert.deepEqual(parseBlocks("3.5 GB free"), [{ type: "p", text: "3.5 GB free" }]);
});

test("snake_case words and a spaced asterisk are not emphasis", () => {
  assert.deepEqual(parseBlocks("snake_case_word and a * b * c"), [
    { type: "p", text: "snake_case_word and a * b * c" },
  ]);
});

test("bold, inline code and https links render", () => {
  assert.equal(renderInline("**bold** text"), "<strong>bold</strong> text");
  assert.equal(
    renderInline("see [site](https://kalsa.io/x)"),
    'see <a href="https://kalsa.io/x">site</a>',
  );
});

test("code spans are escaped and not bolded or linked", () => {
  assert.equal(renderInline("`a **b** [c](https://x)`"), "<code>a **b** [c](https://x)</code>");
  assert.equal(renderInline("`a<b`"), "<code>a&lt;b</code>");
});

test("text is HTML-escaped", () => {
  assert.equal(renderInline('5 < 6 & "q" > 4'), "5 &lt; 6 &amp; &quot;q&quot; &gt; 4");
});

test("blocks render to their elements, with an id when given", () => {
  assert.equal(renderBlock({ type: "h2", text: "2. Install" }, "mac"), '<h2 id="mac">2. Install</h2>');
  assert.equal(renderBlock({ type: "ol", items: ["a", "b"] }), "<ol><li>a</li><li>b</li></ol>");
  assert.equal(
    renderBlock({ type: "quote", text: "q" }),
    "<blockquote><p>q</p></blockquote>",
  );
});
