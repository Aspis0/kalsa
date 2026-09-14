// Headless check for the states page: no browser, no DOM library — a tiny
// shim just big enough to run dev/states.js against the real page modules.
// It exists to (1) prove every state renders, (2) print every sentence in one
// list so the copy can be read together, and (3) enforce the copy rules:
// no jargon, no exclamation marks, and every state ends in something the
// user can press or an explicit "nothing to do".
//
//   node dev/smoke.mjs; echo $?

// ---- the shim ----

class FakeEl {
  constructor(tag) {
    this.tag = tag;
    this.children = [];
    this.attrs = {};
    this._text = null;
    this.handlers = {};
  }

  set innerHTML(html) {
    this.children = [];
    // The skeletons are flat matched tags; a line-by-line parse is enough.
    const pattern = /<(\w+)\s+([^>]*)>([^<]*)<\/\1>/g;
    for (const match of html.matchAll(pattern)) {
      const [, tag, attrText, text] = match;
      const child = new FakeEl(tag);
      for (const attr of attrText.matchAll(/([\w-]+)(?:="([^"]*)")?/g)) {
        child.attrs[attr[1]] = attr[2] ?? true;
      }
      if (text) child._text = text;
      this.children.push(child);
    }
  }

  get textContent() {
    if (this._text !== null) return this._text;
    return this.children.map((child) => child.textContent).join("");
  }

  set textContent(value) {
    this.children = [];
    this._text = value;
  }

  querySelector(selector) {
    const name = selector.match(/data-el="([^"]+)"/)?.[1];
    if (name) {
      return this.children.find((child) => child.attrs["data-el"] === name) ?? null;
    }
    return this.children.find((child) => child.tag === selector) ?? null;
  }

  append(...nodes) {
    for (const node of nodes) {
      if (typeof node === "string") {
        const text = new FakeEl("#text");
        text._text = node;
        this.children.push(text);
      } else {
        this.children.push(node);
      }
    }
  }

  addEventListener(type, handler) {
    (this.handlers[type] ??= []).push(handler);
  }

  click() {
    for (const handler of this.handlers.click ?? []) handler({});
  }

  get hidden() {
    return this.attrs.hidden === true || this._hidden === true;
  }

  set hidden(value) {
    this._hidden = value;
  }

  get disabled() {
    return this._disabled === true || this.attrs.disabled === true;
  }

  set disabled(value) {
    this._disabled = value;
  }
}

const root = new FakeEl("main");
const byId = {};
globalThis.document = {
  getElementById: (id) => (id === "cards" ? root : (byId[id] ??= new FakeEl("div"))),
  createElement: (tag) => new FakeEl(tag),
  body: Object.assign(new FakeEl("body"), {
    classList: {
      toggle() {},
    },
  }),
};
globalThis.window = {};

// ---- run the real states page ----

await import("./states.js");
// Click-driven cards settle on timers, which run after the import's
// microtasks; give them a tick before reading anything.
await new Promise((resolve) => setTimeout(resolve, 20));

// ---- collect the copy ----

const results = [];
for (const card of root.children) {
  const heading = card.children[0].textContent;
  const panel = card.children[1];
  const button = panel.querySelector("button");
  const sentence = panel.textContent;
  results.push({
    heading,
    sentence,
    button: button ? { text: button.textContent, disabled: button.disabled } : null,
  });
}

for (const { heading, sentence, button } of results) {
  console.log(`## ${heading}`);
  console.log(`   ${sentence}`);
  if (button) {
    console.log(`   [${button.disabled ? "disabled" : "button"}] ${button.text}`);
  }
  console.log();
}

// ---- lint ----

const problems = [];
const ALL_TEXT = results.map((r) => `${r.sentence} ${r.button?.text ?? ""}`).join("\n");

for (const word of ["port", "token", "url", "file", "error", "state", "gguf", "quant"]) {
  const re = new RegExp(`\\b${word}\\w*`, "i");
  const hit = ALL_TEXT.match(re);
  if (hit) problems.push(`jargon: "${hit[0]}"`);
}

if (/!/.test(ALL_TEXT)) problems.push("exclamation mark");

// Every state must end in a pressable button, a disabled in-progress button,
// or an explicit nothing-to-do / instruction. The phrases are the app's
// deliberate terminal exits; a new terminal state should extend this list on
// purpose, not silence the check by accident.
const NOTHING = [
  "nothing for you to do here",
  "There is nothing to choose",
  "Open the app on this computer",
  "not worth it",
  "Pair the phone first",
  "Nothing on this page is a guess",
  "too slow to use",
  "This page will say which model",
  "To pair your phone with this computer",
];
for (const { heading, sentence, button } of results) {
  const endsInNothing = NOTHING.some((phrase) => sentence.includes(phrase));
  const pressable = button && !button.disabled && !button.hidden;
  const progress =
    button && button.disabled && (button.text === "Measuring…" || button.text === "Starting");
  if (!pressable && !progress && !endsInNothing) {
    problems.push(`dead end: ${heading}`);
  }
}

if (problems.length > 0) {
  console.log("COPY PROBLEMS:");
  for (const problem of problems) console.log(`  - ${problem}`);
  process.exit(1);
}
console.log(`ok: ${results.length} states rendered, copy rules hold`);
