// Headless check for the states page: no browser, no DOM library — a tiny
// shim just big enough to run dev/states.js against the real page modules.
// It exists to (1) prove every state renders, (2) print every sentence in one
// list so the copy can be read together, and (3) enforce the copy rules:
// no jargon in ordinary copy, no exclamation marks, and every state ends in
// something the user can press or an explicit "nothing to do". The live
// counter and Advanced card are explicit expert surfaces with a small allowlist.
//
//   node dev/smoke.mjs; echo $?

// The status page is mounted directly for the hostile-input checks below;
// states.js brings its own copies through the same module paths.
import { mountStatus } from "../src/pages/status.js";
import { mountAdvanced } from "../src/pages/advanced.js";

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
    this._text = null;
    // The real pages have small nested structures and void controls. A
    // stack keeps the bench honest when a new panel adds hierarchy.
    const stack = [this];
    const voidTags = new Set(["input", "br", "hr", "img", "meta", "link", "path", "rect"]);
    const pattern = /<\/?([\w-]+)([^>]*)>|([^<]+)/g;
    for (const match of html.matchAll(pattern)) {
      const [, tag, attrText, text] = match;
      if (text !== undefined) {
        const node = new FakeEl("#text");
        node._text = text;
        stack[stack.length - 1].children.push(node);
        continue;
      }
      if (match[0].startsWith("</")) {
        if (stack.length > 1) stack.pop();
        continue;
      }
      const child = new FakeEl(tag);
      for (const attr of attrText.matchAll(/([\w-]+)(?:="([^"]*)")?/g)) {
        child.attrs[attr[1]] = attr[2] ?? true;
      }
      stack[stack.length - 1].children.push(child);
      if (!voidTags.has(tag) && !attrText.trimEnd().endsWith("/")) stack.push(child);
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
      return this.find((child) => child.attrs["data-el"] === name);
    }
    return this.find((child) => child.tag === selector);
  }

  find(predicate) {
    for (const child of this.children) {
      if (predicate(child)) return child;
      const nested = child.find?.(predicate);
      if (nested) return nested;
    }
    return null;
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

  setAttribute(name, value) {
    this.attrs[name] = String(value);
  }

  get classList() {
    return {
      add: () => {},
      remove: () => {},
      toggle: () => {},
    };
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
// A standing fake bus: the pages subscribe to `brain_progress` through it,
// so the checks can prove the subscription by name and replay events down
// the same path the app uses.
const eventBus = { handlers: {} };
globalThis.document = {
  getElementById: (id) => (id === "cards" ? root : (byId[id] ??= new FakeEl("div"))),
  createElement: (tag) => new FakeEl(tag),
};
globalThis.window = {
  __TAURI__: {
    event: {
      listen(name, handler) {
        (eventBus.handlers[name] ??= []).push(handler);
        return Promise.resolve(() => {});
      },
    },
    core: {
      invoke() {
        return Promise.reject(new Error("no backend"));
      },
    },
  },
};

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

function collectVisible(el, match, out = []) {
  if (el.hidden) return out;
  if (match(el)) out.push(el);
  for (const child of el.children) collectVisible(child, match, out);
  return out;
}

// Every readable line on the visible subtree, in the order the user reads
// it — headlines, sentences, notes, progress, control labels. If it is on
// screen it is in here; nothing the user can read goes unreviewed.
function visibleLines(el, out = []) {
  if (el.hidden) return out;
  if (el._text !== null) {
    if (el._text.trim() !== "") out.push({ tag: el.tag, text: el._text.trim() });
    return out;
  }
  for (const child of el.children) visibleLines(child, out);
  return out;
}

const results = [];
for (const card of root.children) {
  const heading = card.children[0].textContent;
  const panel = card.children[1];
  const button = findVisible(panel, (el) => el.tag === "button");
  const progressEl = findVisible(panel, (el) => el.attrs["data-el"] === "progress");
  const sentenceEl = findVisible(panel, (el) => el.attrs["data-el"] === "sentence");
  const qrEl = findVisible(panel, (el) => el.attrs["data-el"] === "qr");
  const freshEl = findVisible(panel, (el) => el.attrs["data-el"] === "fresh");
  const lines = visibleLines(panel);
  results.push({
    heading,
    lines,
    sentence: sentenceEl ? sentenceEl.textContent : visibleText(panel),
    all: visibleText(panel),
    button: button ? { text: button.textContent, disabled: button.disabled } : null,
    buttons: collectVisible(panel, (el) => el.tag === "button").map((b) => b.textContent),
    progress: progressEl ? progressEl.textContent : null,
    // Working means a visible progress line: the bar is hidden when no total
    // was announced, and that state is still working.
    working: progressEl !== null,
    qr: qrEl !== null,
    fresh: freshEl ? freshEl.textContent : null,
  });
}

// The dump shows every visible line, in reading order — a sentence the dump
// omits is a sentence nobody reviews.
for (const { heading, lines, button, progress, working } of results) {
  console.log(`## ${heading}`);
  for (const line of lines) {
    if (line.tag !== "button") console.log(`   · ${line.text}`);
  }
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
// Ordinary Status and Pairing copy stays plain. The live decode figure and
// the Advanced panel are the deliberate expert surface: `tokens/s` and the
// engine's exact cache spelling are allowed there, but not in normal prose.
const expertCards = results.filter(
  ({ heading }) =>
    heading.includes("running, live metrics") ||
    heading === "Model — advanced settings are visible",
);
const expertText = expertCards
  .flatMap((r) => r.lines.map((line) => line.text))
  .join("\n");
const normalText = results
  .filter((r) => !expertCards.includes(r))
  .flatMap((r) => r.lines.map((line) => line.text))
  .join("\n");
const ALL_TEXT = results
  .flatMap((r) => r.lines.map((line) => line.text))
  .join("\n");

const NORMAL_BANNED = ["port", "url", "file", "error", "state", "gguf", "quant", "credential", "handshake", "secret", "token"];
for (const word of NORMAL_BANNED) {
  const re = new RegExp(`\\b${word}\\w*`, "i");
  const hit = normalText.match(re);
  if (hit) problems.push(`jargon: "${hit[0]}"`);
}
if (!NORMAL_BANNED.includes("token")) {
  problems.push("normal copy must continue to reject token jargon");
}

if (!/tokens\/s/.test(expertText)) {
  problems.push("the expert Status counter must identify tokens per second");
}
if (!/KV q8_0/.test(expertText)) {
  problems.push("the expert Advanced panel must show the cache format");
}
if (ALL_TEXT.includes("Memory use") || ALL_TEXT.includes("Loaded model")) {
  problems.push("Status must not promise a memory measurement the app does not have");
}

// A poll while Advanced is open updates read-only copy, never the input the
// owner is editing. This is the same refresh path Model uses every two
// seconds, with a real field value and a real input event.
const advancedProbe = new FakeEl("div");
const advancedProbeDto = {
  context_tokens: 4096,
  context_max: 8192,
  context_override: null,
  idle_unload_seconds: 300,
  idle_override: null,
  batch_size: 512,
  ubatch_size: 128,
  kv_cache_type: "q8_0",
  flash_attention: "on",
  gpu_layers: "all",
  threads: 8,
  door_port: 8131,
  running: true,
};
const advancedProbeView = mountAdvanced(advancedProbe, {
  backend: { read: async () => advancedProbeDto, save: async () => advancedProbeDto },
});
await advancedProbeView.refresh();
advancedProbeView.open();
const advancedInput = advancedProbe.querySelector('[data-el="context"]');
advancedInput.value = "8192";
for (const handler of advancedInput.handlers.input ?? []) handler({});
await advancedProbeView.refresh();
const currentAdvancedInput = advancedProbe.querySelector('[data-el="context"]');
if (currentAdvancedInput !== advancedInput || currentAdvancedInput.value !== "8192") {
  problems.push("an open Advanced field was overwritten by polling");
}

if (/!/.test(ALL_TEXT)) problems.push("exclamation mark");

// Every state must end in a pressable button, a disabled in-progress button,
// a visible download bar, or an explicit nothing-to-do / instruction. The
// phrases are the app's deliberate terminal or in-progress sentences; a new
// one extends this list on purpose, not to silence the check by accident.
const NOTHING = [
  "nothing for you to do here",
  "Open the app on this computer",
  "To pair your phone with this computer",
  // Pairing's in-progress and goal states: the square, the connection, and
  // the done state are their own exits.
  "A phone is connecting right now",
  "This computer now works with",
  "will appear here in a moment",
  // Setup steps with no bytes to show yet: the sentence is the progress.
  "Looking at what this computer",
  "Finding the version of the engine",
  "can take a minute",
  // The Model page's goal states: the walk chose, nothing is the user's job.
  "You never have to pick one",
  "You never have to pick anything",
  "The Status page says why",
  "It is starting now",
];
for (const { heading, sentence, button, working, qr } of results) {
  const endsInNothing = NOTHING.some((phrase) => sentence.includes(phrase));
  // A control with no name is not a way out; it is a dead end with a
  // rectangle on it.
  const pressable = button && !button.disabled && button.text.trim() !== "";
  const progressButton =
    button && button.disabled && (button.text === "Measuring…" || button.text === "Starting");
  // A download in motion or a visible square is the exit: the next action
  // happens on this screen or on the phone, but it exists.
  if (!pressable && !progressButton && !endsInNothing && !working && !qr) {
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

// The exact phrasings the product may use for its download promises. A rule
// that matches a substring is a rule about spelling, not about truth —
// "happens once in a while" contains "once" and means the opposite — so
// these are registries, not patterns. Adding a phrasing is a deliberate act;
// rewriting the copy without updating the registry makes the rule go quiet,
// which is the known cost of checking words at all.
// Known boundary: the registries check that an approved promise is present.
// They cannot stop a sentence that makes the promise and takes it back in
// the next breath ("This happens once. Well, usually."). That hole has been
// moved from spelling to deliberate sabotage, and it is left open on
// purpose — a check that closed it would have to understand the sentence.
const ONCE_PHRASES = ["This happens once.", "happens only once."];

// A download that cannot say why it happens and that it happens once is a
// broken app: four silent minutes is how trust in it dies.
for (const { heading, sentence, progress, working } of results) {
  if (!working) continue;
  if (!ONCE_PHRASES.some((phrase) => sentence.includes(phrase))) {
    problems.push(`a download must make the once-only promise in an approved phrasing: ${heading}`);
  }
  // A download line must be one of two honest shapes: a real percentage over
  // both byte counts, or — when no size was announced — how much has
  // arrived and nothing pretending to be a share of it. Infinity and NaN are
  // what arithmetic on a size nobody announced produces; neither is a
  // percentage, and neither is honest.
  const full = progress?.match(/(\d+(?:\.\d+)?) of (\d+(?:\.\d+)?) (MB|GB) · (\d+)%$/);
  const noTotal =
    /^(Picking up where it stopped — )?(Receiving — the size was not announced\.|(\d+(?:\.\d+)?) (MB|GB) received so far\.)$/;
  if (full) {
    if (Math.floor((parseFloat(full[1]) / parseFloat(full[2])) * 100) !== Number(full[4])) {
      problems.push(`the percentage must be the bytes' percentage: ${heading}`);
    }
    if (Number(full[4]) > 100) {
      problems.push(`a percentage above 100 is not a percentage: ${heading}`);
    }
  } else if (!progress || !noTotal.test(progress)) {
    problems.push(`a download line must be a real percentage or an honest "no size": ${heading}`);
  }
}

// A failure partway through must keep the resume promise: what arrived
// stays. The sentence is failure.rs's ConnectionLost words, owned here on
// the review side — the page (and now the bench card) must speak it as
// written, or the promise has been rewritten.
const RESUME_SENTENCE =
  "The connection dropped partway through. Trying again keeps what was already downloaded.";
if (!results.some((r) => r.sentence === RESUME_SENTENCE)) {
  problems.push("the connection-lost failure must keep the resume promise in its own words");
}

// ---- Model rules: the walk chooses; the page explains, never asks ----
// "Measure this computer" handed the walk's own step back to the user, and
// the page kept a story (measure, then pair, then choose) the walk no longer
// follows. These rules hold the page to what is true now.
const MODEL_AUTO =
  "A model is chosen automatically — from this computer's memory and what your phone runs — every time you turn on.";
const MODEL_NO_PICK = "You never have to pick one.";

const modelCards = results.filter((r) => r.heading.startsWith("Model —"));
if (!modelCards.some((r) => r.sentence.includes(MODEL_AUTO) && r.sentence.includes(MODEL_NO_PICK))) {
  problems.push("the Model page must explain the automatic choice and that picking is never asked");
}
for (const { heading, buttons } of modelCards) {
  if (buttons.some((text) => text.startsWith("Measure"))) {
    problems.push(`the Model page must not ask the user to measure: ${heading}`);
  }
}

// ---- the progress event must reach the screen ----
// main.rs emits `brain_progress` (startup.rs Progress); the Status page
// subscribes by name and shows the walk instead of "Off". A card that
// replays the event through a bus and still shows "Off" means the
// subscription is broken — wrong name, missing listener, silent handler.
if (!results.some((r) => r.heading.includes("a progress event arrives") && r.working)) {
  problems.push("the progress event must reach the screen");
}

// ---- pairing rules: the square is a credential on screen ----
// The approved phrasings are owned HERE, on the review side — not imported
// from the page, or the check and the page would share one source and
// equality would hold by construction. The page renders its own copies;
// changing those words means changing this list on purpose, or failing.
const CAMERA_INSTRUCTION = "Point your phone's camera at the square.";
const AWARENESS =
  "Anyone who can see this square can connect a phone — show it only to yours.";
const REPLACE_PRIMARY = "Use the new phone";
const REPAIR_PRIMARY = "Pair another phone";
const CANCEL_PRIMARY = "Cancel";
const FRESH_PHRASINGS = [
  "The previous square expired — this one is fresh.",
  "A square that did not match was replaced — this one is fresh.",
];

for (const { heading, sentence, all, qr, fresh, buttons } of results) {
  if (qr) {
    if (sentence.trim() !== CAMERA_INSTRUCTION) {
      problems.push(`a waiting square must give the camera instruction in the approved phrasing: ${heading}`);
    }
    if (!all.includes(AWARENESS)) {
      problems.push(`a waiting square must say who can see it: ${heading}`);
    }
  }
  if (fresh !== null && !FRESH_PHRASINGS.includes(fresh)) {
    problems.push(`a fresh-square note must be an approved phrasing: ${heading}`);
  }
  if (sentence.includes("already works with")) {
    const named = buttons.filter((text) => text.trim() !== "");
    if (named.length < 2 || !named.includes(REPLACE_PRIMARY)) {
      problems.push(`a replace must offer both choices: ${heading}`);
    }
  }
  if (sentence.includes("now works with") && !buttons.includes(REPAIR_PRIMARY)) {
    problems.push(`a paired phone must offer a deliberate way to pair another: ${heading}`);
  }
  if (sentence.includes("saved the connection") && !buttons.includes(REPAIR_PRIMARY)) {
    problems.push(`a pending delivery must still offer another pairing: ${heading}`);
  }
  if (heading.includes("saved here; the phone still needs the response") &&
      !sentence.includes("the phone still needs to receive it")) {
    problems.push(`a pending delivery must say that the phone still needs the response: ${heading}`);
  }
  if (sentence.includes("A phone is connecting right now") && !buttons.includes(CANCEL_PRIMARY)) {
    problems.push(`a claimed square must offer cancellation: ${heading}`);
  }
}

// ---- hostile inputs: the wire contract is input, not a promise ----
// Each of these must render something honest — a sentence, no leaked
// internals, and where numbers appear, only the approved shapes — and must
// never throw. A render that throws is a window that silently stops
// updating in the middle of a download.
const HOSTILE = [
  { name: "NaN total", dto: { kind: "setup", phase: "fetching", fetching: { what: "engine", done_bytes: 320e6, total_bytes: NaN, resumed: false }, failure: null } },
  { name: "zero total", dto: { kind: "setup", phase: "fetching", fetching: { what: "engine", done_bytes: 320e6, total_bytes: 0, resumed: false }, failure: null } },
  { name: "negative done, missing what", dto: { kind: "setup", phase: "fetching", fetching: { done_bytes: -5 }, failure: null } },
  { name: "missing bytes", dto: { kind: "setup", phase: "fetching", fetching: { what: "model" }, failure: null } },
  { name: "fetching is a string", dto: { kind: "setup", phase: "fetching", fetching: "garbage", failure: null } },
  { name: "fetching is null", dto: { kind: "setup", phase: "fetching", fetching: null, failure: null } },
  { name: "unknown phase", dto: { kind: "setup", phase: "does-not-exist", fetching: null, failure: null } },
  { name: "unknown failure", dto: { kind: "setup", phase: "failed", failure: "weird", fetching: null } },
];

for (const { name, dto } of HOSTILE) {
  try {
    const panel = document.createElement("div");
    const view = mountStatus(panel, {
      backend: { async read() { return dto; } },
    });
    await view.refresh();
    const text = visibleText(panel);
    for (const word of ["NaN", "Infinity", "undefined", "null"]) {
      if (new RegExp(`\\b${word}\\b`).test(text)) {
        problems.push(`hostile DTO "${name}" rendered the leak "${word}"`);
      }
    }
    const sentenceEl = findVisible(panel, (el) => el.attrs["data-el"] === "sentence");
    if (!sentenceEl || sentenceEl.textContent.trim() === "") {
      problems.push(`hostile DTO "${name}" rendered no sentence`);
    }
  } catch (error) {
    problems.push(`hostile DTO "${name}" made the page throw: ${error.message}`);
  }
}

// ---- the walk's own words must survive the press ----
// brain_start rejects with failure::words' sentences for the whole first
// walk (the unfundable model among them). The page must speak THAT sentence
// — a restart does not fix an unfundable model — and hold it against the
// next poll, which re-renders the card while nothing is running.
const UNFUNDABLE_SENTENCE =
  "The model chosen for this computer needs more memory than the computer can give it, even to start. An app update may bring a smaller option.";

if (!results.some((r) => r.sentence === UNFUNDABLE_SENTENCE)) {
  problems.push("the unfundable-model failure must be on the bench in its own words");
}

try {
  const panel = document.createElement("div");
  const view = mountStatus(panel, {
    backend: {
      async read() {
        return { kind: "stopped" };
      },
      async start() {
        throw new Error(UNFUNDABLE_SENTENCE);
      },
      async stop() {},
    },
  });
  await view.refresh();
  findVisible(panel, (el) => el.tag === "button").click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  if (!visibleText(panel).includes(UNFUNDABLE_SENTENCE)) {
    problems.push("a walk failure must be spoken in its own words, not the generic ones");
  }
} catch (error) {
  problems.push(`the walk-failure pin could not run: ${error.message}`);
}

// Hostile progress steps: the event payload is wire input too, and the view
// must degrade through the same honest shapes.
const HOSTILE_STEPS = [
  { name: "negative done", step: { kind: "model_bytes", done: -5, total: 100 } },
  { name: "non-numeric bytes", step: { kind: "runtime_bytes", done: "many", total: "lots" } },
  { name: "unknown kind", step: { kind: "warp_drive" } },
  { name: "null step", step: null },
];

for (const { name, step } of HOSTILE_STEPS) {
  try {
    const panel = document.createElement("div");
    const handlers = [];
    const bus = {
      listen(name, handler) {
        handlers.push(handler);
        return Promise.resolve(() => {});
      },
    };
    const view = mountStatus(panel, {
      backend: {
        async read() {
          return { kind: "stopped" };
        },
      },
      events: bus,
    });
    await view.refresh();
    for (const handler of handlers) handler(step);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const text = visibleText(panel);
    for (const word of ["NaN", "Infinity", "undefined", "null"]) {
      if (new RegExp(`\\b${word}\\b`).test(text)) {
        problems.push(`hostile progress "${name}" rendered the leak "${word}"`);
      }
    }
    const sentenceEl = findVisible(panel, (el) => el.attrs["data-el"] === "sentence");
    if (!sentenceEl || sentenceEl.textContent.trim() === "") {
      problems.push(`hostile progress "${name}" rendered no sentence`);
    }
    view.dispose();
  } catch (error) {
    problems.push(`hostile progress "${name}" made the page throw: ${error.message}`);
  }
}

if (problems.length > 0) {
  console.log("COPY PROBLEMS:");
  for (const problem of problems) console.log(`  - ${problem}`);
  process.exit(1);
}
console.log(`ok: ${results.length} states rendered, copy rules hold`);
