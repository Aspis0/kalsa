/**
 * Converter for the markdown subset the tester guide uses: `##`/`###` headings,
 * paragraphs, `-` and `N.` lists with indented continuations, `>` blockquotes,
 * **bold**, `code` and https links. Constructs outside that subset throw, so
 * the guide cannot ship markup this converter would print as literal text.
 */

const UNORDERED = /^- (.*)$/;
const ORDERED = /^\d+\. (.*)$/;
const HEADING = /^(#{1,3}) (.*)$/;
const HTML_COMMENT = /[ \t]*<!--[\s\S]*?-->[ \t]*/g;

const UNSUPPORTED = [
  [/!\[/, "image"],
  [/(^|\W)_[^_\s][^_]*_(\W|$)/, "underscore emphasis"],
  [/(^|[^*])\*(?!\*)[^*\s][^*]*\*(?!\*)/, "single-asterisk emphasis"],
  [/~~/, "strikethrough"],
  [/http:\/\//, "http link"],
  [/^\d+\) /, "parenthesised ordered list"],
  [/^[=-]{2,}$/, "setext heading underline"],
  [/^[*+] /, "asterisk or plus list"],
  [/^ {2,}(?:-|\*|\+|\d+\.) /, "nested list"],
  [/<\/?[A-Za-z!][^>]*>/, "raw HTML"],
  [/\\[*_`[\]#!~|<>]/, "backslash escape"],
  [/&[#A-Za-z0-9]+;/, "HTML entity"],
];

function escapeHtml(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function renderText(part) {
  return escapeHtml(part)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\[([^\]]+)\]\((https:\/\/[^)\s]+)\)/g, (_, label, url) => `<a href="${url}">${label}</a>`);
}

/** Splits on backticks so code spans are escaped but never bolded or linked. */
export function renderInline(text) {
  return text
    .split("`")
    .map((part, i) => (i % 2 === 1 ? `<code>${escapeHtml(part)}</code>` : renderText(part)))
    .join("");
}

/** Code spans are literal in markdown, so the rules see them as a placeholder. */
function rejectUnsupported(line, lineNo) {
  const prose = line.replace(/`[^`]*`/g, "x");
  for (const [pattern, label] of UNSUPPORTED) {
    if (pattern.test(prose)) throw new Error(`unsupported markdown at line ${lineNo}: ${label}`);
  }
}

/**
 * Blocks in source order. `h1`/`h2`/`h3`, `p` and `quote` carry `text`;
 * `ul` and `ol` carry `items`.
 */
export function parseBlocks(source) {
  const lines = source.replace(HTML_COMMENT, " ").split("\n").map((line) => line.trimEnd());
  const blocks = [];
  let current = null;
  lines.forEach((line, index) => {
    if (line === "") {
      current = null;
      return;
    }
    rejectUnsupported(line, index + 1);
    const heading = HEADING.exec(line);
    if (heading) {
      current = null;
      blocks.push({ type: `h${heading[1].length}`, text: heading[2] });
      return;
    }
    const continuation = /^ {2,}\S/.test(line);
    if (continuation && (current?.type === "ul" || current?.type === "ol")) {
      current.items[current.items.length - 1] += " " + line.trim();
      return;
    }
    if (continuation && current?.type === "p") {
      current.text += " " + line.trim();
      return;
    }
    const bullet = UNORDERED.exec(line);
    if (bullet) {
      if (current?.type !== "ul") {
        current = { type: "ul", items: [] };
        blocks.push(current);
      }
      current.items.push(bullet[1]);
      return;
    }
    const numbered = ORDERED.exec(line);
    if (numbered) {
      if (current?.type !== "ol") {
        current = { type: "ol", items: [] };
        blocks.push(current);
      }
      current.items.push(numbered[1]);
      return;
    }
    if (line === ">" || line.startsWith("> ")) {
      if (current?.type !== "quote") {
        current = { type: "quote", text: "" };
        blocks.push(current);
      }
      current.text = (current.text + " " + line.slice(1).trim()).trim();
      return;
    }
    if (/^[#|<>+]|^-\S/.test(line)) {
      throw new Error(`unsupported markdown at line ${index + 1}: block syntax`);
    }
    if (current?.type !== "p") {
      current = { type: "p", text: "" };
      blocks.push(current);
    }
    current.text = (current.text + " " + line).trim();
  });
  return blocks;
}

export function renderBlock(block, id = null) {
  const attr = id === null ? "" : ` id="${id}"`;
  switch (block.type) {
    case "h2":
      return `<h2${attr}>${renderInline(block.text)}</h2>`;
    case "h3":
      return `<h3>${renderInline(block.text)}</h3>`;
    case "p":
      return `<p>${renderInline(block.text)}</p>`;
    case "quote":
      return `<blockquote><p>${renderInline(block.text)}</p></blockquote>`;
    case "ul":
    case "ol":
      return `<${block.type}>${block.items.map((item) => `<li>${renderInline(item)}</li>`).join("")}</${block.type}>`;
    default:
      throw new Error(`no renderer for block type ${block.type}`);
  }
}
