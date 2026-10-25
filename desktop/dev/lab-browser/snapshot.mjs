// The snapshot the model sees (one responsibility: turn Playwright's AI aria
// tree into a short ref-addressable text, and say plainly when it is cut).
// Playwright 1.63 gives us `ariaSnapshot({ mode: "ai" })`, whose `[ref=e12]`
// tokens `page.locator("aria-ref=e12")` resolves back to the live element.
//
// Two things make the text short enough to be worth a small model's context:
// `[ref=e12]` is rewritten to a leading `[e12]`, and containers that carry no
// meaning of their own (generic / list / listitem with only wrappers inside)
// are dropped along with the `/url:` property lines, because the snapshot
// header already carries the page url.
export const SNAPSHOT_CHARS = 6000;
const MAX_DEPTH = 8;

// Roles a model can act on, or read a name from. Everything else is a box.
const MEANINGFUL = new Set([
  "alert", "button", "checkbox", "cell", "combobox", "columnheader", "definition",
  "dialog", "gridcell", "heading", "img", "link", "listbox", "menuitem", "option",
  "paragraph", "radio", "row", "searchbox", "slider", "status", "strong", "tab",
  "term", "textbox", "textarea",
]);

/** One `- role "name" [ref=e3]` line into ref, role, name and leftover props.
 *  The raw tree spells a name three ways and mixes in bracketed props, so all
 *  three are peeled apart rather than pattern-matched one at a time. */
const parseNode = (line) => {
  const at = line.match(/^(\s*)- (.*)$/);
  if (!at) return null;
  const depth = Math.floor(at[1].length / 2);
  const body = at[2].replace(/ \[cursor=pointer\]/g, "").replace(/ \[active\]/g, "");
  const ref = body.match(/\[ref=([a-z0-9]+)\]/);
  // Property groups are peeled off before the name is read, or they get
  // mistaken for the name itself. Both spellings count: `[level=1]` carries a
  // value, `[expanded]` and `[selected]` do not, and Playwright 1.64 started
  // emitting the bare ones — a parser that only understood `key=value` turned
  // every such element into one long piece of text.
  const props = [];
  let rest = (ref ? body.replace(ref[0], " ") : body)
    .replace(/\s*\[([a-z]+(?:=[^\]]*)?)\]/g, (_, prop) => (props.push(`[${prop}]`), ""))
    .trim();
  // Playwright wraps a node in single quotes when its text carries double
  // quotes, as a book title with a colon does.
  rest = rest.replace(/^'([\s\S]*)'$/, "$1").trim();
  // A role alone, a role with a quoted name, or a role followed by inline text.
  const shape = rest.match(/^([a-z]+)(?:\s+"([\s\S]*)")?(?:\s*:\s*([\s\S]*?))?\s*$/);
  const role = shape ? shape[1] : "text";
  const name = (shape ? (shape[2] ?? shape[3] ?? "") : rest.replace(/^text:\s*/, "")).trim();
  return { depth, ref: ref ? ref[1] : null, role, name, props: props.join(" ") };
};

/** The aria tree as nodes with children, so a wrapper can be judged by what it
 *  contains rather than by how it is spelled. */
const treeOf = (raw) => {
  const roots = [];
  const stack = [];
  for (const line of raw.split("\n")) {
    // `/url:` property lines repeat the header the snapshot already carries.
    if (/^\s*-\s+\/url:/.test(line)) continue;
    const node = parseNode(line);
    if (!node || node.role === "none") continue;
    node.children = [];
    while (stack.length && stack[stack.length - 1].depth >= node.depth) stack.pop();
    if (stack.length) stack[stack.length - 1].children.push(node);
    else roots.push(node);
    stack.push(node);
  }
  return roots;
};

/** A node says something when it is an element the model can act on, or when it
 *  carries readable content. Content matters as much as controls: a checkbox
 *  with no name is only knowable from the text sitting beside it, so dropping
 *  the wrapper must not drop the label with it. Glyphs like × and / are noise
 *  and are dropped. A heading with no text of its own says nothing either — the
 *  link it wraps already carries the name. */
const says = (node) => node.name.replace(/[^\p{L}\p{N}]/gu, "").length >= 2;
const NAMELESS = new Set(["paragraph", "heading"]);
const carries = (node) =>
  (MEANINGFUL.has(node.role) && !NAMELESS.has(node.role || Boolean(node.name))) || says(node);

/** A node earns a line when it says something itself, or when something below
 *  it does; a pure box earns nothing. */
const render = (nodes, depth = 0, out = []) => {
  for (const node of nodes) {
    const body = carries(node);
    if (body) {
      const pad = "  ".repeat(Math.min(depth, MAX_DEPTH));
      // A control is named by its role; a plain box is named only by its text.
      const control = MEANINGFUL.has(node.role) && !NAMELESS.has(node.role) ? node.role : "text";
      const label = `${control}${control === node.role && node.props ? ` ${node.props}` : ""}`;
      // A node with no ref cannot be acted on, so it is not given a fake one.
      const tag = node.ref ? `[${node.ref}] ` : "";
      // A name already arriving quoted is not quoted twice.
      const text = !node.name ? "" : /^".*"$/.test(node.name) ? node.name : `"${node.name}"`;
      out.push(`${pad}- ${tag}${label}${text ? ` ${text}` : ""}`);
    }
    render(node.children, body ? depth + 1 : depth, out);
  }
  return out;
};

/** The page as one string: where we are, then one line per element. Both
 *  readings below start here, so a snapshot and a find always agree. */
const pageText = async (page) => {
  const [raw, title, url] = await Promise.all([
    page.ariaSnapshot({ mode: "ai" }),
    page.title().catch(() => ""),
    page.url(),
  ]);
  return { head: `url: ${url}\ntitle: ${title}\n\n`, body: render(treeOf(raw)).join("\n") };
};

/** Chunks of whole lines. Splitting mid-line would leave a ref half-printed,
 *  which is a ref the model cannot act on. */
const parts = (body, chars) => {
  const out = [];
  let rest = body;
  while (rest.length > chars) {
    const at = rest.lastIndexOf("\n", chars);
    if (at <= 0) out.push(rest.slice(0, chars));
    else out.push(rest.slice(0, at));
    rest = rest.slice(at <= 0 ? chars : at + 1);
  }
  out.push(rest);
  return out;
};

/** The page as short text. A long page comes in parts rather than being cut:
 *  the model asks for page 2 and nothing on the page is lost. Each part ends
 *  by naming the next one, so the model is never left guessing that more
 *  exists or that it has seen it all. */
export async function snapshot(page, { chars = SNAPSHOT_CHARS, part = 1 } = {}) {
  const { head, body } = await pageText(page);
  const chunks = parts(body, Math.max(200, chars - head.length));
  const at = Math.min(Math.max(1, Number(part) || 1), chunks.length);
  if (chunks.length === 1) return head + chunks[0];
  const next = at < chunks.length ? at + 1 : null;
  const footer = next
    ? `Part ${at} of ${chunks.length} — call browser_snapshot with page ${next} for more.`
    : `Part ${at} of ${chunks.length} — this is the last part.`;
  return `${head}${chunks[at - 1]}\n\n${footer}`;
}

/** The lines that mention some text, with a little around them and their refs
 *  intact — the find-in-page a model reaches for when a page is too long to
 *  read in one snapshot. */
export async function find(page, text, { chars = SNAPSHOT_CHARS, around = 1, limit = 40 } = {}) {
  const { head, body } = await pageText(page);
  const needle = String(text ?? "").trim().toLowerCase();
  const all = body.split("\n");
  if (!needle) return head + "nothing to look for — pass some text";
  const out = [];
  for (let i = 0; i < all.length && out.length < limit; i += 1) {
    if (!all[i].toLowerCase().includes(needle)) continue;
    for (let j = Math.max(0, i - around); j <= Math.min(all.length - 1, i + around); j += 1) {
      out.push(`${String(j + 1).padStart(4)} ${all[j]}`);
    }
    out.push("");
  }
  if (out.length === 0) return head + `nothing on this page matches "${needle}"`;
  const kept = out.slice(0, limit).join("\n").trimEnd();
  const more = out.length > limit ? `\n… more matches not shown (${chars} char cap)` : "";
  return `${head}${kept}${more}`;
}