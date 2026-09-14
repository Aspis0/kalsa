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
    // Enough style for the pages: setProperty is how setup.js drives the bar.
    this.style = {
      setProperty: (name, value) => {
        this[name] = value;
      },
    };
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
    // Mirror the DOM: assigning false clears the attribute, it does not hide
    // a parsed `hidden` under a runtime false.
    this._hidden = value;
    if (value) this.attrs.hidden = true;
    else delete this.attrs.hidden;
  }

  get disabled() {
    return this.attrs.disabled === true || this._disabled === true;
  }

  set disabled(value) {
    this._disabled = value;
    if (value) this.attrs.disabled = true;
    else delete this.attrs.disabled;
  }
}

const root = new FakeEl("main");
const byId = {};
globalThis.document = {
  getElementById: (id) => (id === "cards" ? root : (byId[id] ??= new FakeEl("div"))),
  createElement: (tag) => new FakeEl(tag),
};
globalThis.window = {};

// ---- run the real states page ----

await import("./states.js");
// Click-driven cards settle on timers, which run after the import's
// microtasks; give them a tick before reading anything.
await new Promise((resolve) => setTimeout(resolve, 20));

// ---- collect the copy ----

// The checker reads what is on screen: a hidden subtree is not on screen, so
// the walk skips it. That is also how duplicate data-el names resolve — the
// setup view's sentence is found because the status view's is hidden.
function visibleText(el) {
  if (el.hidden) return "";
  if (el._text !== null) return el._text;
  return el.children.map(visibleText).join("");
}

function findVisible(el, match) {
  if (el.hidden) return null;
  for (const child of el.children) {
    if (child.hidden) continue;
    if (match(child)) return child;
    const deep = findVisible(child, match);
    if (deep) return deep;
  }
  return null;
}

const results = [];
for (const card of root.children) {
  const heading = card.children[0].textContent;
  const panel = card.children[1];
  const button = findVisible(panel, (el) => el.tag === "button");
  const bar = findVisible(panel, (el) => el.attrs["data-el"] === "bar");
  const progressEl = findVisible(panel, (el) => el.attrs["data-el"] === "progress");
  const sentenceEl = findVisible(panel, (el) => el.attrs["data-el"] === "sentence");
  results.push({
    heading,
    sentence: sentenceEl ? sentenceEl.textContent : visibleText(panel),
    button: button ? { text: button.textContent, disabled: button.disabled } : null,
    progress: progressEl ? progressEl.textContent : null,
    working: bar !== null,
  });
}

for (const { heading, sentence, button, progress, working } of results) {
  console.log(`## ${heading}`);
  console.log(`   ${sentence}`);
  if (working) {
    console.log(`   [working] ${progress}`);
  } else if (button) {
    console.log(`   [${button.disabled ? "disabled" : "button"}] ${button.text}`);
  } else {
    console.log("   [no action]");
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
// a visible download bar, or an explicit nothing-to-do / instruction. The
// phrases are the app's deliberate terminal or in-progress sentences; a new
// one extends this list on purpose, not to silence the check by accident.
const NOTHING = [
  "nothing for you to do here",
  "There is nothing to choose",
  "Open the app on this computer",
  "not worth it",
  "not worth using",
  "Pair the phone first",
  "Nothing on this page is a guess",
  "too slow to use",
  "This page will say which model",
  "To pair your phone with this computer",
  // A chosen model is the goal state: nothing is needed. The three phrases
  // are the justification sentences in pages/model.js.
  "That is why it runs here",
  "battery lasts longer",
  "We have not tested it on this computer yet",
  // Setup steps with no bytes to show yet: the sentence is the progress.
  "Looking at what this computer",
  "Deciding which model",
  "can take a minute",
];
for (const { heading, sentence, button, progress, working } of results) {
  const endsInNothing = NOTHING.some((phrase) => sentence.includes(phrase));
  // A control with no name is not a way out; it is a dead end with a
  // rectangle on it.
  const pressable = button && !button.disabled && button.text.trim() !== "";
  const progressButton =
    button && button.disabled && (button.text === "Measuring…" || button.text === "Starting");
  if (!pressable && !progressButton && !endsInNothing && !working) {
    problems.push(`dead end: ${heading}`);
  }
}

// A visible button with no label is a problem in itself, whatever else the
// state offers.
for (const { heading, button } of results) {
  if (button && button.text.trim() === "") {
    problems.push(`labelless button: ${heading}`);
  }
}

// A download that cannot say why it happens and that it happens once is a
// broken app: four silent minutes is how trust in it dies.
for (const { heading, sentence, progress, working } of results) {
  if (!working) continue;
  if (!/once/.test(sentence)) {
    problems.push(`a download must say it happens once: ${heading}`);
  }
  if (!/\d+(\.\d+)? of \d+(\.\d+)? (MB|GB)/.test(progress ?? "")) {
    problems.push(`a download must show both byte counts: ${heading}`);
  }
  if (!/\d+%/.test(progress ?? "")) {
    problems.push(`a download must show a percentage: ${heading}`);
  }
}

// A failure partway through is a different sentence from a failure at the
// start: kalsa-download resumes, and the copy has to keep that promise.
for (const { heading, sentence } of results) {
  if (/connection dropped/.test(sentence) && !/picks up where it stopped/.test(sentence)) {
    problems.push(`a mid-download failure must promise resume: ${heading}`);
  }
}

if (problems.length > 0) {
  console.log("COPY PROBLEMS:");
  for (const problem of problems) console.log(`  - ${problem}`);
  process.exit(1);
}
console.log(`ok: ${results.length} states rendered, copy rules hold`);
