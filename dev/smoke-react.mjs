// Headless check for the React surfaces. esbuild compiles the real TSX once,
// this small DOM lets React mount it, and the checks read rendered copy.
// Nothing is served, and every mounted root is unmounted by states-react.mjs.

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "../chat/node_modules/esbuild/lib/main.js";
import { checkSurfacesCss } from "./check-motion-css.mjs";

class FakeNode {
  constructor(tagName, ownerDocument, nodeType = 1, data = "") {
    this.tagName = tagName?.toUpperCase() ?? "";
    this.nodeName = this.tagName;
    this.ownerDocument = ownerDocument;
    this.nodeType = nodeType;
    this.data = data;
    this.childNodes = [];
    this.parentNode = null;
    this.attributes = {};
    this.listeners = {};
    this._text = nodeType === 3 ? data : null;
    this._innerHTML = "";
    this.style = {
      setProperty: (name, value) => {
        this.style[name] = String(value);
      },
      removeProperty: (name) => delete this.style[name],
    };
  }

  appendChild(node) {
    if (node.parentNode) node.parentNode.removeChild(node);
    node.parentNode = this;
    this.childNodes.push(node);
    return node;
  }

  insertBefore(node, before) {
    if (!before) return this.appendChild(node);
    if (node.parentNode) node.parentNode.removeChild(node);
    const index = this.childNodes.indexOf(before);
    node.parentNode = this;
    this.childNodes.splice(index < 0 ? this.childNodes.length : index, 0, node);
    return node;
  }

  removeChild(node) {
    const index = this.childNodes.indexOf(node);
    if (index >= 0) this.childNodes.splice(index, 1);
    node.parentNode = null;
    return node;
  }

  replaceChild(next, previous) {
    const index = this.childNodes.indexOf(previous);
    if (index >= 0) {
      if (next.parentNode) next.parentNode.removeChild(next);
      next.parentNode = this;
      previous.parentNode = null;
      this.childNodes[index] = next;
    }
    return previous;
  }

  get firstChild() {
    return this.childNodes[0] ?? null;
  }

  get nextSibling() {
    if (!this.parentNode) return null;
    const index = this.parentNode.childNodes.indexOf(this);
    return this.parentNode.childNodes[index + 1] ?? null;
  }

  get children() {
    return this.childNodes.filter((child) => child.nodeType === 1);
  }

  get options() {
    return this.childNodes.filter((child) => child.nodeType === 1 && child.tagName === "OPTION");
  }

  get textContent() {
    if (this.nodeType === 3) return this.data;
    if (this.nodeType === 8) return "";
    return this.childNodes.map((child) => child.textContent).join("");
  }

  set textContent(value) {
    this.childNodes = [];
    if (value !== "") this.appendChild(this.ownerDocument.createTextNode(String(value)));
  }

  set innerHTML(value) {
    this._innerHTML = String(value);
    this.textContent = this._innerHTML.replace(/<[^>]*>/g, "");
  }

  get innerHTML() {
    return this._innerHTML || this.textContent;
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
    if (name === "class") this.className = String(value);
    if (name === "value") this.value = String(value);
    if (name === "checked") this.checked = true;
    if (name === "disabled") this.disabled = true;
  }

  getAttribute(name) {
    return this.attributes[name] ?? null;
  }

  removeAttribute(name) {
    delete this.attributes[name];
    if (name === "disabled") this.disabled = false;
    if (name === "checked") this.checked = false;
  }

  addEventListener(type, handler) {
    (this.listeners[type] ??= new Set()).add(handler);
  }

  removeEventListener(type, handler) {
    this.listeners[type]?.delete(handler);
  }

  dispatchEvent(event) {
    if (!event.target) event.target = this;
    event.currentTarget = this;
    for (const handler of this.listeners[event.type] ?? []) handler.call(this, event);
    if (event.bubbles !== false && !event.cancelBubble && this.parentNode) {
      this.parentNode.dispatchEvent(event);
    }
    return !event.defaultPrevented;
  }

  click() {
    // A disabled button does not click, the way a real one does not: the
    // invariant lives in the DOM, not in every caller's filter.
    if (this.disabled) return;
    this.dispatchEvent({
      type: "click",
      target: this,
      bubbles: true,
      cancelBubble: false,
      defaultPrevented: false,
      preventDefault() {
        this.defaultPrevented = true;
      },
      stopPropagation() {
        this.cancelBubble = true;
      },
    });
  }

  focus() {
    this.ownerDocument.activeElement = this;
    this.dispatchEvent({ type: "focus", target: this, bubbles: false });
  }

  select() {
    // The textarea fallback selects its own text. The call has to exist so
    // the throw lands where a real webview's would.
  }

  remove() {
    if (this.parentNode) this.parentNode.removeChild(this);
  }

  blur() {
    if (this.ownerDocument.activeElement === this) this.ownerDocument.activeElement = this.ownerDocument.body;
    this.dispatchEvent({ type: "blur", target: this, bubbles: false });
  }

  get classList() {
    return {
      add: (...names) => {
        this.className = `${this.className} ${names.join(" ")}`.trim();
      },
      remove: (...names) => {
        this.className = this.className
          .split(/\s+/)
          .filter((name) => name && !names.includes(name))
          .join(" ");
      },
      toggle: (name, force) => {
        const has = this.className.split(/\s+/).includes(name);
        const next = force ?? !has;
        if (next && !has) this.classList.add(name);
        if (!next && has) this.classList.remove(name);
        return next;
      },
    };
  }
}

class FakeDocument extends FakeNode {
  constructor() {
    super("#document", null, 9);
    this.ownerDocument = this;
    this.documentElement = new FakeNode("html", this);
    this.body = new FakeNode("body", this);
    this.documentElement.appendChild(this.body);
    this.appendChild(this.documentElement);
    this.activeElement = this.body;
  }

  createElement(tagName) {
    return new FakeNode(tagName, this);
  }

  createElementNS(_namespace, tagName) {
    return new FakeNode(tagName, this);
  }

  createTextNode(text) {
    return new FakeNode("#text", this, 3, String(text));
  }

  createComment(text) {
    return new FakeNode("#comment", this, 8, String(text));
  }

  getElementById(id) {
    return findNode(this, (node) => node.getAttribute?.("id") === id);
  }
}

function findNode(node, predicate) {
  for (const child of node.childNodes ?? []) {
    if (child.nodeType === 1 && predicate(child)) return child;
    const nested = findNode(child, predicate);
    if (nested) return nested;
  }
  return null;
}

function installDom() {
  const document = new FakeDocument();
  const window = {
    document,
    navigator: { userAgent: "kalsa-react-smoke" },
    location: { protocol: "http:" },
    HTMLIFrameElement: FakeNode,
    HTMLElement: FakeNode,
    SVGElement: FakeNode,
    addEventListener() {},
    removeEventListener() {},
  };
  document.defaultView = window;
  globalThis.document = document;
  globalThis.window = window;
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: window.navigator });
  globalThis.HTMLElement = FakeNode;
  globalThis.SVGElement = FakeNode;
  globalThis.HTMLIFrameElement = FakeNode;
  const cards = document.createElement("main");
  cards.setAttribute("id", "cards");
  document.body.appendChild(cards);
  // The language provider's real persistence path: a working store so the
  // bench can seed an override the way the Settings row does.
  const store = new Map();
  window.localStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
  };
  // Bare `localStorage` in the bundled app resolves through globalThis:
  // point it at the shim, or node's own unavailable store swallows the
  // language override.
  globalThis.localStorage = window.localStorage;
  return cards;
}

async function loadRenderer() {
  const dir = await mkdtemp(join(tmpdir(), "kalsa-react-smoke-"));
  const outfile = join(dir, "states-react.mjs");
  await build({
    entryPoints: [join(process.cwd(), "dev/states-react.mjs")],
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node20",
    outfile,
    nodePaths: [join(process.cwd(), "chat/node_modules")],
    loader: { ".css": "empty" },
    logLevel: "silent",
  });
  const renderer = await import(`${pathToFileURL(outfile).href}?cache=${Date.now()}`);
  return { dir, renderer };
}

let timeout = null;

try {
  installDom();
  const { dir, renderer } = await loadRenderer();
  // The runaway guard, derived from what the cards declare they will
  // wait: the sum of every card's wait plus room for the renders and
  // settles between them. Not a target — a guard.
  timeout = setTimeout(() => {
    console.error("React smoke timed out");
    process.exit(2);
  }, renderer.benchTimeoutMs());
  const results = await renderer.renderStates();
  const problems = [];
  // The reduced-motion gate is a fact about the stylesheet, not the DOM:
  // the fake DOM cannot render it, so the bench reads the CSS itself.
  problems.push(...checkSurfacesCss());

  // The key parity check: every language carries every English key, no
  // empties, no extras.
  for (const problem of renderer.checkKeyParity()) {
    problems.push(`i18n parity: ${problem}`);
  }
  // The waiting line, whole-message per language: Italian and Chinese both
  // prove a table actually drives rendering, not just type-checks.
  const italian = renderer.queueLineIn("it");
  if (italian !== "Kalsa risponderà prima a Marco, poi a Luca e Sofia.") {
    problems.push(`i18n it: the waiting line must be whole-message Italian: "${italian}"`);
  }
  const chinese = renderer.queueLineIn("zh");
  if (chinese !== "Kalsa 将先回答Marco，然后回答Luca和Sofia。") {
    problems.push(`i18n zh: the waiting line must be whole-message Chinese: "${chinese}"`);
  }
  const EXPECTED_SAMPLING_WIRES = [
    "adaptive_decay",
    "adaptive_target",
    "dry_allowed_length",
    "dry_base",
    "dry_multiplier",
    "dry_penalty_last_n",
    "dynatemp_exponent",
    "dynatemp_range",
    "frequency_penalty",
    "max_tokens",
    "min_keep",
    "min_p",
    "mirostat",
    "mirostat_eta",
    "mirostat_tau",
    "presence_penalty",
    "repeat_last_n",
    "repeat_penalty",
    "seed",
    "temperature",
    "top_k",
    "top_n_sigma",
    "top_p",
    "typical_p",
    "xtc_probability",
    "xtc_threshold",
  ].sort();
  const chosenSampling = Object.fromEntries(
    renderer.SAMPLING_KNOBS.map((knob) => [
      knob.wire,
      knob.kind === "integer"
        ? Math.min(knob.max, Math.max(knob.min, 1))
        : Math.max(knob.min, 0.25),
    ]),
  );
  const chosenWire = renderer.samplingWire(chosenSampling);
  const chosenBody = renderer.completionBody("m", [], chosenWire);
  for (const wire of EXPECTED_SAMPLING_WIRES) {
    if (chosenBody[wire] !== chosenSampling[wire]) problems.push(`sampling body lost chosen value: ${wire}`);
  }
  if (chosenBody.model !== "m" || chosenBody.messages?.length !== 0 || chosenBody.stream !== true) {
    problems.push("sampling body lost model, messages, or stream");
  }
  const nullSampling = Object.fromEntries(EXPECTED_SAMPLING_WIRES.map((wire) => [wire, null]));
  const nullBody = renderer.completionBody("m", [], renderer.samplingWire(nullSampling));
  if (EXPECTED_SAMPLING_WIRES.some((wire) => Object.hasOwn(nullBody, wire))) {
    problems.push("sampling body sent an unset value");
  }
  const actualSamplingWires = renderer.SAMPLING_KNOBS.map(({ wire }) => wire).sort();
  if (JSON.stringify(actualSamplingWires) !== JSON.stringify(EXPECTED_SAMPLING_WIRES)) {
    problems.push("sampling table wire names do not match the server schema list");
  }
  const pollutedWire = renderer.samplingWire({ ...chosenSampling, verbose: 1, other_junk: 2 });
  const pollutedBody = renderer.completionBody("m", [], pollutedWire);
  for (const key of ["verbose", "other_junk"]) {
    if (Object.hasOwn(pollutedWire, key) || Object.hasOwn(pollutedBody, key)) {
      problems.push(`sampling allowlist forwarded polluted key: ${key}`);
    }
  }
  const overriddenBody = renderer.completionBody("m", [], { model: "wrong", messages: [], stream: false });
  if (overriddenBody.model !== "m" || overriddenBody.messages?.length !== 0 || overriddenBody.stream !== true) {
    problems.push("sampling completion body let sampling override its core fields");
  }
  if (renderer.samplingProblem({ top_k: 7.5 }) === null) problems.push("fractional integer sampling value was accepted");
  if (renderer.samplingProblem({ top_p: 5 }) === null) problems.push("out-of-range sampling value was accepted");
  const invalidWire = renderer.samplingWire({ ...chosenSampling, top_k: 7.5, top_p: 5 });
  if (Object.hasOwn(invalidWire, "top_k") || Object.hasOwn(invalidWire, "top_p")) {
    problems.push("invalid sampling value reached the request");
  }
  // Delegates to the installDom store: the language provider reads the
  // same storage the sampling round trip pollutes.
  const previousStorage = globalThis.localStorage;
  const storage = new Map();
  globalThis.localStorage = {
    getItem: (key) => storage.get(key) ?? previousStorage?.getItem?.(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value)),
  };
  try {
    const roundTrip = { temperature: 0.73, top_k: 40 };
    if (!renderer.saveSampling(roundTrip)) problems.push("sampling round trip could not save");
    const loaded = renderer.loadSampling();
    if (loaded.temperature !== 0.73 || loaded.top_k !== 40) problems.push("sampling round trip changed saved values");
    storage.set("crescent-chat.sampling.v1", JSON.stringify({ ...roundTrip, top_k: 7.5, top_p: 5, verbose: 1 }));
    const pollutedLoaded = renderer.loadSampling();
    const sanitized = renderer.samplingWire(pollutedLoaded);
    if (Object.hasOwn(sanitized, "top_k") || Object.hasOwn(sanitized, "top_p") || Object.hasOwn(sanitized, "verbose")) {
      problems.push("polluted stored sampling reached the request");
    }
    globalThis.localStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error("storage unavailable");
      },
    };
    if (renderer.saveSampling(roundTrip)) problems.push("sampling save reported success when storage rejected it");
  } finally {
    globalThis.localStorage = previousStorage;
  }
  const expertCards = results.filter(
    ({ heading }) =>
      heading.includes("running, live metrics") ||
      heading.startsWith("Model — advanced settings") ||
      heading.startsWith("Advanced —"),
  );
  const expertText = expertCards.flatMap((r) => r.lines).join("\n");
  const normalText = results.filter((r) => !expertCards.includes(r)).flatMap((r) => r.lines).join("\n");
  const allText = results.flatMap((r) => r.lines).join("\n");

  const normalBanned = ["port", "url", "file", "error", "state", "gguf", "quant", "credential", "handshake", "secret", "token"];
  for (const word of normalBanned) {
    const hit = normalText.match(new RegExp(`\\b${word}\\w*`, "i"));
    if (hit) problems.push(`jargon: "${hit[0]}"`);
  }
  if (!/tokens\/s/.test(expertText)) problems.push("the expert Status counter must identify tokens per second");
  if (!/KV q8_0/.test(expertText)) problems.push("the expert Advanced panel must show the cache format");
  if (allText.includes("Memory use") || allText.includes("Loaded model")) {
    problems.push("Status must not promise a memory measurement the app does not have");
  }
  if (/!/.test(allText)) problems.push("exclamation mark");

  // The two sentences a Devices card may stand on with no button to press:
  // the first pairing read is still in flight — nothing to retry, no failure
  // to report yet — and the check that cannot run at all, where offering
  // "Try again" would be a button with nothing behind it.
  const CHECKING = "Checking for your phone…";
  const COULD_NOT_CHECK = "This page could not check whether a phone is connected.";

  const NOTHING = [
    "nothing for you to do here",
    "Open the app on this computer",
    "To pair your phone with this computer",
    "A phone is connecting right now",
    "This computer now works with",
    "will appear here in a moment",
    CHECKING,
    COULD_NOT_CHECK,
    "Looking at what this computer",
    "Finding the version of the engine",
    "can take a minute",
    "You never have to pick one",
    "You never have to pick anything",
    "The Server page says why",
    "It is starting now",
    // The first page, ready: no action offered HERE — the composer beside
    // it is where the message goes (an EmptyState arm, added with the
    // remote-server removal).
    "Write your first message below to begin.",
  ];
  for (const { heading, sentence, button, working, walk, qr } of results) {
    // The matcher's probe renders lists, not actions: a card that exists
    // to be read back is not a dead end.
    if (
      heading.startsWith("Room — the @Kalsa rule") ||
      heading.startsWith("Room — the feed reducer") ||
      heading.startsWith("Room — the queue line") ||
      heading.startsWith("Room — the copy table")
    ) {
      continue;
    }
    const endsInNothing = NOTHING.some((phrase) => sentence.includes(phrase));
    const pressable = button && !button.disabled && button.text.trim() !== "";
    const progressButton = button && button.disabled && (button.text === "Measuring…" || button.text === "Starting" || button.text === "Stopping");
    if (!pressable && !progressButton && !endsInNothing && !working && !walk && !qr) {
      problems.push(`dead end: ${heading}`);
    }
  }
  for (const { heading, button } of results) {
    if (button && button.text.trim() === "") problems.push(`labelless button: ${heading}`);
  }

  const ONCE_PHRASES = ["This happens once.", "happens only once."];
  for (const { heading, sentence, progress, working } of results) {
    if (!working) continue;
    if (!ONCE_PHRASES.some((phrase) => sentence.includes(phrase))) {
      problems.push(`a download must make the once-only promise in an approved phrasing: ${heading}`);
    }
    const full = progress?.match(/(\d+(?:\.\d+)?) of (\d+(?:\.\d+)?) (MB|GB) · (\d+)%$/);
    const noTotal = /^(Picking up where it stopped — )?(Receiving — the size was not announced\.|(\d+(?:\.\d+)?) (MB|GB) received so far\.)$/;
    if (full) {
      if (Math.floor((parseFloat(full[1]) / parseFloat(full[2])) * 100) !== Number(full[4])) {
        problems.push(`the percentage must be the bytes' percentage: ${heading}`);
      }
      if (Number(full[4]) > 100) problems.push(`a percentage above 100 is not a percentage: ${heading}`);
    } else if (!progress || !noTotal.test(progress)) {
      problems.push(`a download line must be a real percentage or an honest "no size": ${heading}`);
    }
  }

  const RESUME_SENTENCE = "The connection dropped partway through. Trying again keeps what was already downloaded.";
  if (!results.some((r) => r.sentence === RESUME_SENTENCE)) {
    problems.push("the connection-lost failure must keep the resume promise in its own words");
  }

  // A release is the one case where "On" alone would be a lie: the server is up
  // and the model is not in memory. The page must say both — and must not say
  // either when the app cannot know, which is a server it adopted on startup
  // and holds no stderr pipe to. The released case must also give way to a
  // phone that is working right now: a served connection is the opposite of
  // idle, so that is the fresher fact.
  const ASLEEP_VERDICT = "On, asleep";
  const ASLEEP_SENTENCE =
    "The model is not in memory right now. Your next message brings it back, which takes a few seconds.";
  const asleepCard = results.find((r) => r.heading === "Status — running, asleep");
  const busyAsleepCard = results.find((r) => r.heading === "Status — running, asleep while a phone works");
  if (!asleepCard || !busyAsleepCard) {
    problems.push("the harness is missing a released-model state the page must speak about");
  } else {
    if (!asleepCard.all.includes(ASLEEP_VERDICT)) {
      problems.push("a released model must be said in the verdict, not only in the sentence");
    }
    if (!asleepCard.all.includes(ASLEEP_SENTENCE)) {
      problems.push("a released model must say that the next message brings it back");
    }
    if (!busyAsleepCard.all.includes("Your phone is using this computer right now.")) {
      problems.push("a phone working right now must keep its own sentence even after a release was announced");
    }
    if (busyAsleepCard.all.includes(ASLEEP_VERDICT)) {
      problems.push("a phone working right now must not be told the model is asleep, which that work contradicts");
    }
  }
  // Both shapes of "not known": the field absent, and the field null. Neither
  // may be spoken as a fact, and neither may change the words that were there
  // before the app could tell.
  for (const note of ["running, phone unknown", "running, residency unknown (stub)"]) {
    const card = results.find((r) => r.heading === `Status — ${note}`);
    if (!card) {
      problems.push(`the harness is missing the "${note}" card`);
      continue;
    }
    if (card.all.includes("asleep")) {
      problems.push(`an unknown model residency must not be spoken as a fact: ${note}`);
    }
    if (!card.all.includes("This computer is ready for you.")) {
      problems.push(`an unknown model residency must keep the running words: ${note}`);
    }
  }

  // A stop in flight is its own state, and the page says so: headline and
  // button "Stopping", the sentence the words chose, and a button that is
  // disabled rather than pressable. Then the state on its own, with the walk
  // flag DOWN and UP: `busy && !running` is true for `stopping`, so the order
  // of the branches — the true state read BEFORE the heuristic — is what
  // keeps "Starting" out of an owner's mouth who just asked for quiet.
  const STOPPING_CARD = results.find((r) => r.heading === "Status — stopping");
  if (!STOPPING_CARD) {
    problems.push("the harness is missing the draining state the page must speak about");
  } else {
    if (!STOPPING_CARD.all.includes("Putting the assistant away.")) {
      problems.push("a drain must say it is putting the assistant away");
    }
    if (STOPPING_CARD.all.includes("Starting")) {
      problems.push("a drain was told as a start");
    }
    if (!STOPPING_CARD.button || STOPPING_CARD.button.text !== "Stopping" || !STOPPING_CARD.button.disabled) {
      problems.push("a drain must offer a disabled Stopping button");
    }
  }
  for (const drainingBusy of [false, true]) {
    const drainingWords = renderer.brainWords({ kind: "stopping" }, null, drainingBusy);
    if (drainingWords.headline !== "Stopping" || drainingWords.button !== "Stopping" || drainingWords.enabled) {
      problems.push(
        `brainWords(kind "stopping", busy ${drainingBusy}) answered ${JSON.stringify(drainingWords)} — the true state must win over the heuristic`,
      );
    }
  }

  // The Models page across the same drain: it says the model is being put
  // away, and NEVER the "could not tell" sentence — that would be a false
  // admission of not-knowing about the one thing this poll just reported,
  // standing on screen for the whole teardown.
  const MODEL_DRAIN_CARD = results.find(
    (r) => r.heading === "Model — draining: the model is being put away",
  );
  if (!MODEL_DRAIN_CARD) {
    problems.push("the harness is missing the Models page's draining state");
  } else {
    if (/could not (tell|check)/.test(MODEL_DRAIN_CARD.sentence)) {
      problems.push("the Models page claimed not to know while the state said stopping");
    }
    if (!MODEL_DRAIN_CARD.sentence.includes("putting the model away")) {
      problems.push("the Models page must say the model is being put away during a drain");
    }
    if (MODEL_DRAIN_CARD.all.includes("could not")) {
      problems.push("the Models page rendered a not-knowing sentence over a draining state");
    }
  }

  // A running Model card must show what actually happened on this start: the
  // name the shell chose, the reason the shell gave for THIS start, and the
  // promise that picking is never asked. Two of these are the real cases — a
  // paired phone (a comparison was made) and no phone (none was) — and the
  // third is the same card shape with the dev path's absent reason.
  const MODEL_NO_PICK = "You never have to pick one.";
  const RUNNING_CARDS = [
    ["running: the choice is automatic", renderer.AUTO_REASON],
    ["running: a phone was paired and compared", renderer.PHONE_REASON],
    ["running: no phone was paired", renderer.PHONE_FREE_REASON],
  ];
  const modelCards = results.filter((r) => r.heading.startsWith("Model —"));
  for (const [note, reason] of RUNNING_CARDS) {
    const card = modelCards.find((r) => r.heading === `Model — ${note}`);
    if (!card) {
      problems.push(`the Model page is missing the "${note}" card`);
      continue;
    }
    if (!card.all.includes(renderer.RUNNING_MODEL)) {
      problems.push(`a running Model card must name the model it is running: ${note}`);
    }
    if (!card.sentence.includes(reason)) {
      problems.push(`a running Model card must carry the shell's reason for this start, not a general rule: ${note}`);
    }
    if (!card.sentence.includes(MODEL_NO_PICK)) {
      problems.push(`a running Model card must still promise that picking is never asked: ${note}`);
    }
    // Exact equality, not a search for forbidden words: the sentence is the
    // shell's reason and then the promise, and nothing else may ride along.
    if (card.sentence !== `${reason} ${MODEL_NO_PICK}`) {
      problems.push(
        `a running Model card's sentence must be exactly the reason followed by the promise: ${note}`,
      );
    }
  }
  for (const { heading, buttons } of modelCards) {
    if (buttons.some((text) => text.startsWith("Measure"))) problems.push(`the Model page must not ask the user to measure: ${heading}`);
  }

  // The sampling panel must show the automatic value of the server that is
  // actually running. The "after a server is configured" sentence is only for a
  // machine that has none — no running brain and nothing typed in Settings — so
  // both directions are asserted and neither can be satisfied by deleting it.
  const NOT_CONFIGURED = "Automatic will appear after a server is configured.";
  const runningSampling = results.find((r) => r.heading === "Advanced — sampling values come from the running server");
  const stoppedSampling = results.find((r) => r.heading === "Advanced — sampling with no server and nothing typed in Settings");
  if (!runningSampling) {
    problems.push("the harness is missing the running-server sampling state");
  } else {
    if (runningSampling.automatic.length === 0) problems.push("the sampling panel rendered no automatic lines");
    if (runningSampling.automatic.includes(NOT_CONFIGURED)) {
      problems.push("a running server must show its automatic values, not \"after a server is configured\"");
    }
    if (!runningSampling.automatic.some((line) => line.includes("Automatic is 1 — the server's own value."))) {
      problems.push("the running server's own temperature must be shown as the automatic value");
    }
  }
  if (!stoppedSampling) {
    problems.push("the harness is missing the no-server sampling state");
  } else if (!stoppedSampling.automatic.includes(NOT_CONFIGURED)) {
    problems.push("with no server and nothing typed the sampling panel must say a server is not configured");
  }
  // A server that is up but still loading answers nothing at first. The panel
  // must keep asking: the values still have to appear, and the silence must not
  // have been reported as a failure along the way.
  const retriedSampling = results.find((r) => r.heading === "Advanced — sampling after the server was still loading");
  if (!retriedSampling) {
    problems.push("the harness is missing the still-loading sampling state");
  } else {
    if (!retriedSampling.automatic.some((line) => line.includes("Automatic is 1 — the server's own value."))) {
      problems.push("a server that answers on a later read must still fill the automatic values in");
    }
    if (retriedSampling.automatic.some((line) => line.includes("did not answer"))) {
      problems.push("silence must not be reported as a failure while the panel is still asking");
    }
  }
  if (!results.some((r) => r.heading.includes("a progress event arrives") && r.working)) {
    problems.push("the progress event must reach the screen");
  }
  // The road's permission, said where the switch that opens the road is:
  // the owner's own sentence, on a card that carries the road.
  if (!results.some((card) => card.all.includes(
    "Kalsa will ask to find devices on your local network, so your phone can reach this computer at home.",
  ))) {
    problems.push("the local-network permission is explained where the road is switched on");
  }
  if (results.some((card) => card.heading.includes("the internet road is off")
    && card.all.includes("Kalsa will ask to find devices"))) {
    problems.push("the permission is not explained where the road is off");
  }

  const CAMERA_INSTRUCTION = "Point your phone's camera at the square.";
  const AWARENESS = "Anyone who can see this square can connect a phone — show it only to yours.";
  const REPAIR_PRIMARY = "Pair another phone";
  const CANCEL_PRIMARY = "Cancel";
  const FRESH_PHRASINGS = [
    "The previous square expired — this one is fresh.",
    "A square that did not match was replaced — this one is fresh.",
  ];
  for (const { heading, headline, sentence, all, qr, fresh, buttons, deviceNames, foldingRows, deviceClasses, deviceDetails, allowIds, inviteNames, fallbackLinks, disabledButtons, forgetIds, documentText, documentFields, doorPort, deskPort, deskPreferred, pairingState, hasAdvanced, liveDots, connectingDots } of results) {
    if (qr) {
      if (sentence.trim() !== CAMERA_INSTRUCTION) problems.push(`a waiting square must give the camera instruction in the approved phrasing: ${heading}`);
      if (!all.includes(AWARENESS)) problems.push(`a waiting square must say who can see it: ${heading}`);
    }
    if (fresh !== null && !FRESH_PHRASINGS.includes(fresh)) problems.push(`a fresh-square note must be an approved phrasing: ${heading}`);
    if (sentence.includes("now works with") && !buttons.includes(REPAIR_PRIMARY)) problems.push(`a paired phone must offer a deliberate way to pair another: ${heading}`);
    if (sentence.includes("saved the connection") && !buttons.includes(REPAIR_PRIMARY)) problems.push(`a pending delivery must still offer another pairing: ${heading}`);
    if (heading.includes("saved here; the phone still needs the response") && !sentence.includes("a phone is still waiting to receive its connection")) {
      problems.push(`a pending delivery must say that a phone is still owed its response: ${heading}`);
    }
    // The host row is one of the stored devices now, and it is not a phone:
    // the house sentence counts phones, so the check must count them too.
    const phoneNames = deviceNames.filter((name) => name !== "This computer");
    if (phoneNames.length >= 2 && !sentence.includes("paired phones")) {
      problems.push(`a several-phone house must be described as a house, not by one of its phones: ${heading}`);
    }
    if (sentence.includes("A phone is connecting right now") && !buttons.includes(CANCEL_PRIMARY)) problems.push(`a claimed square must offer cancellation: ${heading}`);
    // "No answer yet" is not "the check failed": the first read can take
    // seconds, so while it has not settled the page says it is checking and
    // offers nothing to retry, and a read that rejects AFTER an answer leaves
    // that answer on screen instead of replacing it with the failure.
    if (heading.includes("the first read has not answered yet")) {
      if (sentence.trim() !== CHECKING) problems.push(`the page waiting on its first read must say it is checking: ${heading}`);
      if (buttons.length > 0) problems.push(`the page waiting on its first read must offer nothing to retry: ${heading}`);
      if (all.includes("could not check")) problems.push(`an unanswered first read must not read as a failed check: ${heading}`);
    }
    if (heading.includes("a later pairing read fails")) {
      if (!sentence.includes("now works with")) problems.push(`a read that rejects must keep the answer already on screen: ${heading}`);
      if (all.includes("could not check")) problems.push(`a rejecting read must not draw the failure sentence over an answer: ${heading}`);
    }
    if (heading.includes("a later pairing read answers nothing")) {
      if (!sentence.includes("now works with")) problems.push(`a read that answers nothing must keep the answer already on screen: ${heading}`);
      if (all.includes("could not check")) problems.push(`a null answer must not be read as a failed check: ${heading}`);
    }
    // Past the bound, silence is no longer "still checking": the page falls
    // to the failure with a retry that can run. And where there is no app to
    // ask at all, that same failure stands with no retry, because nothing
    // could answer it.
    if (heading.includes("the first read hangs past the bound")) {
      if (!all.includes(COULD_NOT_CHECK)) problems.push(`a first read past its bound must fall to the failure sentence: ${heading}`);
      if (!buttons.includes("Try again")) problems.push(`a first read past its bound must offer Try again: ${heading}`);
      if (all.includes(CHECKING)) problems.push(`a first read past its bound must stop saying it is checking: ${heading}`);
    }
    if (heading.includes("there is no app behind the page")) {
      if (!all.includes(COULD_NOT_CHECK)) problems.push(`a page with no app to ask must say the check could not run: ${heading}`);
      if (buttons.length > 0) problems.push(`a page with no app to ask must offer no retry: ${heading}`);
    }
    // A link is this page's secret and it may live in exactly one place on
    // screen: the card's own fallback field, when the clipboard refused it.
    // The WHOLE document is inspected, not just this card — a textarea the
    // copy path left in the body, or text that rendered the link, counts —
    // and every field holding a link must belong to this card.
    const linkedFields = (values) =>
      values.filter((value) => value.includes("kalsa.io")).length;
    if (documentText.includes("kalsa.io")) {
      problems.push(`a link is never rendered as text: ${heading}`);
    }
    if (linkedFields(documentFields) !== linkedFields(fallbackLinks)) {
      problems.push(`a field outside the card holds a link: ${heading}`);
    }
    // The invitation half of this page: the button the page can pair with,
    // the rows it draws, and the sentences this feature owns. Each rule is
    // tied to its own card, so a state cannot satisfy another state's check.
    if (heading.includes("no invitations are out")) {
      if (!buttons.includes("Invite by link")) problems.push(`a page that can pair must offer an invitation: ${heading}`);
      if (inviteNames.length !== 0) problems.push(`an empty house lists nothing: ${heading}`);
    }
    if (heading.includes("two invitations are out")) {
      if (inviteNames.length !== 2) problems.push(`two invitations draw two rows: ${heading}`);
      if (!inviteNames.every((name) => name.startsWith("Expires "))) problems.push(`each row says when it dies: ${heading}`);
      if (buttons.filter((text) => text === "Copy link").length !== 2) problems.push(`each row offers its link again: ${heading}`);
      if (buttons.filter((text) => text === "Cancel invite").length !== 2) problems.push(`each row can be taken back: ${heading}`);
    }
    if (heading.includes("an invitation link is copied")) {
      if (!/Link copied\. It works once, until .+\. Send it only to the person you want to add\./.test(all)) {
        problems.push(`the copied sentence is the owner's own, in full: ${heading}`);
      }
      if (fallbackLinks.length > 0) problems.push(`a copy that worked shows no field: ${heading}`);
    }
    if (heading.includes("an invitation cannot be made without the road")) {
      if (!all.includes("which is not open.")) problems.push(`the command's own words reach the page: ${heading}`);
      if (all.includes("Link copied.")) problems.push(`nothing was copied: ${heading}`);
    }
    if (heading.includes("the list goes quiet after the copy")) {
      if (!all.includes("Link copied. It works once, for one day. Send it only to the person you want to add.")) {
        problems.push(`a copy with no moment to name says the day: ${heading}`);
      }
      if (fallbackLinks.length > 0) {
        problems.push(`a copy that worked never shows the link: ${heading}`);
      }
    }
    if (heading.includes("a forgotten phone folds first")) {
      if (!deviceNames.includes("Paired phone")) {
        problems.push(`a forgotten row is given its beat before it leaves: ${heading}`);
      }
      if (foldingRows < 1) {
        problems.push(`the row's box gives way under its own transition: ${heading}`);
      }
    }
    if (heading.includes("a forgotten phone is gone after the fold")) {
      if (deviceNames.includes("Paired phone")) {
        problems.push(`after the beat the row has left the list: ${heading}`);
      }
    }
    if (heading.includes("a forget that fails keeps its row")) {
      // Present and unfolded is also what a missing Forget button leaves, and
      // the driver no longer dies on one: the stub must have been asked first.
      if (!forgetIds.includes(1)) {
        problems.push(`the row's own forget was asked for: ${heading}`);
      }
      if (!deviceNames.includes("Paired phone")) {
        problems.push(`a forget that failed leaves the row where it was: ${heading}`);
      }
      if (foldingRows > 0) {
        problems.push(`nothing folds when nothing was forgotten: ${heading}`);
      }
    }
    if (heading.includes("two requests on one seat")) {
      if (deviceNames.includes("Paired phone 5") || deviceNames.includes("Paired phone 6")) {
        problems.push(`a stale request never draws a row of its own: ${heading}`);
      }
      if (deviceNames.filter((name) => name === "Paired phone 4").length !== 1) {
        problems.push(`the seat is drawn exactly once: ${heading}`);
      }
      if (!all.includes("Paired phone 4 is pairing again.")) {
        problems.push(`the seat's row says the request: ${heading}`);
      }
      if (!forgetIds.includes(6) || forgetIds.includes(4)) {
        problems.push(`the buttons answer for the newest ceremony, never the seat: ${heading}`);
      }
    }
    if (heading.includes("a forget under reduced motion")) {
      if (deviceNames.includes("Paired phone")) {
        problems.push(`reduced motion forgets in one step: ${heading}`);
      }
      if (foldingRows > 0) {
        problems.push(`reduced motion folds nothing: ${heading}`);
      }
    }
    if (heading.includes("an allowed pairing-again asks for the waiting id")) {
      if (!allowIds.includes(5) || allowIds.includes(4)) {
        problems.push(`Allow asks for the waiting record, never the seat: ${heading}`);
      }
    }
    // The beat after Allow: only a transition this page watched — a waiting
    // row it drew, an Allow it pressed, and the poll that answered — says
    // "is connected.", and it says it on the row the owner saw. The beat
    // lives in a row's detail slot, so the page's own "could not check
    // whether a phone is connected." is not it.
    const connectedDetails = deviceDetails.filter((detail) => detail.endsWith(" is connected."));
    const beatCard =
      heading.includes("says connected for a beat") ||
      heading.includes("lands its beat on the seat") ||
      heading.includes("a connected beat under reduced motion") ||
      heading.includes("two allows in one poll");
    if (heading.startsWith("Pairing") && connectedDetails.length > 0 && !beatCard) {
      problems.push(`only the beat after an Allow this page watched may say "is connected.": ${heading}`);
    }
    if (heading.includes("an allowed phone says connected for a beat")) {
      if (!deviceDetails.includes("Paired phone is connected.")) {
        problems.push(`the beat after Allow must say the phone is connected: ${heading}`);
      }
    }
    if (heading.includes("the connected beat settles into the row")) {
      if (connectedDetails.length > 0) {
        problems.push(`the beat must settle back into the ordinary row: ${heading}`);
      }
      if (!deviceDetails.includes("phone with 2 GB of model weights")) {
        problems.push(`after the beat the row shows its ordinary detail again: ${heading}`);
      }
    }
    if (heading.includes("an allowed pairing-again lands its beat on the seat")) {
      if (!deviceDetails.includes("Paired phone 4 is connected.")) {
        problems.push(`the beat lands on the seat the owner sees: ${heading}`);
      }
      if (deviceDetails.includes("Paired phone 5 is connected.")) {
        problems.push(`the beat must never name the request's own record: ${heading}`);
      }
    }
    if (heading.includes("an already-allowed phone says nothing")) {
      if (connectedDetails.length > 0) {
        problems.push(`a phone allowed before this page looked says nothing: ${heading}`);
      }
    }
    if (heading.includes("an allow the store answers with the record gone")) {
      if (connectedDetails.length > 0) {
        problems.push(`a record the answer took away is not a connected phone: ${heading}`);
      }
      if (deviceNames.includes("Paired phone")) {
        problems.push(`the answer the store gave leaves no row behind: ${heading}`);
      }
    }
    if (heading.includes("two allows in one poll")) {
      if (connectedDetails.length !== 2) {
        problems.push(`each allowed row holds its own beat, neither dropped: ${heading} (${connectedDetails.length} of 2)`);
      }
      if (!deviceDetails.includes("Paired phone is connected.") || !deviceDetails.includes("Paired phone 2 is connected.")) {
        problems.push(`both beats are said, each on its own row: ${heading}`);
      }
    }
    if (heading.includes("a row holds its decision until the store answers")) {
      if (!disabledButtons.includes("Allow") || !disabledButtons.includes("Refuse")) {
        problems.push(`one press holds both buttons until the store answers: ${heading}`);
      }
      if (connectedDetails.length > 0) {
        problems.push(`a decision the store has not answered lands nothing: ${heading}`);
      }
      if (allowIds.filter((id) => id === 1).length !== 1) {
        problems.push(`a press on the held button must not ask again: ${heading}`);
      }
    }
    if (heading.includes("a replaced request arms nothing")) {
      if (connectedDetails.length > 0) {
        problems.push(`a replacement is not an Allow's outcome, and no beat lands: ${heading}`);
      }
      if (!deviceDetails.includes("Paired phone 4 is pairing again.")) {
        problems.push(`the seat says the new ask: ${heading}`);
      }
      if (disabledButtons.includes("Allow") || disabledButtons.includes("Refuse")) {
        problems.push(`the replacement's buttons are free, not held by the old press: ${heading}`);
      }
    }
    if (heading.includes("the store rejects gives the buttons back")) {
      if (disabledButtons.includes("Allow") || disabledButtons.includes("Refuse")) {
        problems.push(`a decision the store did not take leaves the buttons free: ${heading}`);
      }
      if (!deviceDetails.includes("Paired phone 4 is pairing again.")) {
        problems.push(`the request stands until the store takes it: ${heading}`);
      }
      if (connectedDetails.length > 0) {
        problems.push(`nothing was decided, so nothing lands: ${heading}`);
      }
    }
    if (heading.includes("a connected beat under reduced motion")) {
      if (!deviceDetails.includes("Paired phone is connected.")) {
        problems.push(`under reduced motion the beat is still said, statically: ${heading}`);
      }
    }
    if (heading.includes("a seat forgotten while its request waits")) {
      if (!deviceNames.includes("Paired phone 5")) {
        problems.push(`a request whose seat left draws its own row: ${heading}`);
      }
      if (!deviceDetails.includes("Waiting for your OK.")) {
        problems.push(`such a request is a waiting record like any other: ${heading}`);
      }
      if (!allowIds.includes(5) || allowIds.includes(4)) {
        problems.push(`its buttons carry its own id: ${heading}`);
      }
    }
    if (heading.includes("a phone is pairing again")) {
      if (deviceNames.includes("Paired phone 5")) {
        problems.push(`a pairing-again request gets no row of its own: ${heading}`);
      }
      if (!all.includes("Paired phone 4 is pairing again.")) {
        problems.push(`the seat's row says the request in the owner's own words: ${heading}`);
      }
      if (forgetIds.includes(4)) {
        problems.push(`Deny must not touch the seat: ${heading}`);
      }
      if (!forgetIds.includes(5)) {
        problems.push(`Deny must act on the waiting record: ${heading}`);
      }
      if (!deviceClasses.some((name) => name.includes("is-waiting"))) {
        problems.push(`the seat carrying a pairing-again request breathes with its row: ${heading}`);
      }
    }
    // A row that waits for the owner breathes, and an entrance is a beat
    // that ends: wherever the card reads from, no is-entering survives.
    // The wash itself is information and survives reduced motion; the one
    // card that reads inside an entrance's own beat is the exception.
    if (
      deviceDetails.some((detail) => detail === "Waiting for your OK.") &&
      !heading.includes("arrive together")
    ) {
      const waitingRows = deviceDetails.filter((detail) => detail === "Waiting for your OK.").length;
      const breathing = deviceClasses.filter((name) => name.includes("is-waiting")).length;
      if (breathing !== waitingRows) {
        problems.push(`every row waiting for the OK wears the wash, and nothing else does: ${heading} (${breathing} of ${waitingRows})`);
      }
      if (deviceClasses.some((name) => name.includes("is-entering"))) {
        problems.push(`the entrance is a beat that ends, and the row it brought breathes on its own: ${heading}`);
      }
    }
    if (heading.includes("two waiting rows arrive together")) {
      const entering = deviceClasses.filter((name) => name.includes("is-entering")).length;
      if (entering !== 2) {
        problems.push(`each arriving row takes its own entrance: ${heading} (${entering} of 2)`);
      }
      if (!deviceDetails.includes("Waiting for your OK.")) {
        problems.push(`both arrivals are waiting rows: ${heading}`);
      }
    }
    if (heading.includes("the buttons come back once the store has answered")) {
      if (disabledButtons.includes("Allow") || disabledButtons.includes("Refuse")) {
        problems.push(`a decision the store answered does not hold the next ask's buttons: ${heading}`);
      }
      if (!deviceDetails.includes("Waiting for your OK.")) {
        problems.push(`the phone asking again is a waiting row like any other: ${heading}`);
      }
    }
    if (heading.includes("a waiting row under reduced motion")) {
      if (!deviceClasses.some((name) => name.includes("is-waiting"))) {
        problems.push(`under reduced motion the wash stands, still: ${heading}`);
      }
      if (deviceClasses.some((name) => name.includes("is-entering"))) {
        problems.push(`under reduced motion there is no entrance: ${heading}`);
      }
      if (!deviceDetails.includes("Waiting for your OK.")) {
        problems.push(`under reduced motion the waiting row still says the wait: ${heading}`);
      }
    }
    // The claiming sentence carries its wordless indicator; under reduced
    // motion the page draws none, and the sentence stands alone.
    if (heading.includes("a phone is connecting")) {
      if (connectingDots !== 1) {
        problems.push(`the claiming sentence carries its animated indicator: ${heading}`);
      }
    }
    if (heading.includes("a claiming phone under reduced motion")) {
      if (connectingDots !== 0) {
        problems.push(`under reduced motion the claiming sentence stands alone: ${heading}`);
      }
      if (!sentence.includes("A phone is connecting right now.")) {
        problems.push(`the sentence itself stays: ${heading}`);
      }
    }
    // The live dot: only a row the door itself names, and never a word —
    // the dot is the whole statement.
    if (heading.includes("a phone being served right now")) {
      if (liveDots !== 1) {
        problems.push(`the row of a phone the door is serving carries the live dot: ${heading}`);
      }
    }
    if (heading.includes("the computer itself being served")) {
      if (liveDots !== 0) {
        problems.push(`this computer's own chat must not light a phone's dot: ${heading}`);
      }
    }
    if (heading.startsWith("Pairing") && !heading.includes("being served") && liveDots !== 0) {
      problems.push(`only a row the door names may carry the live dot: ${heading}`);
    }
    if (heading.includes("an invitation is taking longer than usual")) {
      if (!all.includes("This is taking longer than usual. If the invitation appears below, copy its link from there.")) {
        problems.push(`a slow create says so: ${heading}`);
      }
      if (all.includes("This invitation could not be made")) {
        problems.push(`a slow create is not a failed one: ${heading}`);
      }
      if (!disabledButtons.includes("Invite by link")) {
        problems.push(`a create still in flight keeps the button down: ${heading}`);
      }
    }
    if (heading.includes("an invitation that answers late")) {
      if (disabledButtons.includes("Invite by link")) {
        problems.push(`a settled create puts the button back: ${heading}`);
      }
      if (all.includes("Link copied.")) {
        problems.push(`a stale gesture is not a copy: ${heading}`);
      }
      if (fallbackLinks.length > 0) {
        problems.push(`a stale gesture shows no field: ${heading}`);
      }
      if (inviteNames.length !== 1) {
        problems.push(`the list is read from the source: ${heading}`);
      }
    }
    if (heading.includes("an invitation is being made")) {
      if (!disabledButtons.includes("Invite by link")) {
        problems.push(`the button is held down while a link is being made: ${heading}`);
      }
    }
    if (heading.includes("the clipboard refuses the link")) {
      if (all.includes("Link copied.")) problems.push(`a refused copy is not a copied link: ${heading}`);
      if (fallbackLinks.length !== 1 || !fallbackLinks[0].startsWith("https://kalsa.io/pair#")) {
        problems.push(`the refused link is shown to select by hand: ${heading}`);
      }
    }
    if (heading.includes("the connection could not be saved")) {
      // True for both roads: a square can be drawn again, an invitation can
      // be sent again — neither promises the last attempt comes back.
      if (!all.includes("This computer could not save the new phone. Start the pairing again, or send a new invite.")) {
        problems.push(`the save failure is worded for both roads: ${heading}`);
      }
      if (all.includes("Trying again usually works")) {
        problems.push(`no promise a spent invitation cannot keep: ${heading}`);
      }
    }
    if (heading.includes("earlier invitations could not be read")) {
      if (!all.includes("Earlier invitations could not be read, so they were cancelled for safety.")) {
        problems.push(`a discarded file is said once, plainly: ${heading}`);
      }
    }
    // The approval gate: a waiting phone's row says so and offers the two
    // owner decisions.
    if (heading.includes("waits for the owner's OK")) {
      if (!all.includes("Waiting for your OK.")) problems.push(`a waiting phone's row must say it is waiting: ${heading}`);
      if (!buttons.includes("Allow") || !buttons.includes("Refuse")) problems.push(`a waiting phone must offer Allow and Refuse: ${heading}`);
    }
    // No success sentence covers a waiting phone, in any mix of approved
    // and waiting; the several-phone rule above keeps waiting phones
    // counted, not named.
    if (deviceDetails.includes("Waiting for your OK.") && sentence.includes("now works with")) {
      problems.push(`the success sentence must not cover a waiting phone: ${heading}`);
    }
    // The headline is an approval claim, and the rows are its evidence: a
    // house whose every phone still waits for the owner's OK must not be
    // headlined "Paired", while a mixed house keeps "Paired" for its
    // approved phones and its waiting row says the rest.
    const phones = deviceNames.filter((name) => name !== "This computer").length;
    const waitingRows = deviceDetails.filter((detail) => detail === "Waiting for your OK.").length;
    // The owner's capacity line rides with the house it describes: any phone
    // this computer already works with, and never for a house where every
    // phone is still waiting for Allow.
    const canAsk =
      phoneNames.length - deviceDetails.filter((detail) => detail === "Waiting for your OK.").length;
    if (canAsk > 0) {
      if (!all.includes("Up to four phones can get answers at the same time. If more ask at once, the others wait a few seconds for their turn.")) {
        problems.push(`a house with a paired phone says its capacity: ${heading}`);
      }
    } else if (all.includes("Up to four phones can get answers at the same time.")) {
      problems.push(`no paired phone, no capacity line: ${heading}`);
    }

    // The host row has no Forget: every Forget button on the page belongs
    // to an approved PHONE row, and "This computer" contributes none —
    // the rendering half of a promise the Rust side keeps too (the
    // command asks is_host, and Desk::forget_device refuses the id).
    if (deviceNames.includes("This computer")) {
      const forgets = buttons.filter((text) => text === "Forget").length;
      // A seat that is pairing again carries Allow/Deny for the request
      // instead of Forget: one phone, one row, and no Forget while the
      // request stands.
      const pairingAgain = deviceDetails.filter((detail) => detail.endsWith("is pairing again.")).length;
      const approvedPhones = phones - waitingRows - pairingAgain;
      if (forgets !== approvedPhones) {
        problems.push(`every Forget must belong to an approved phone and none to This computer: ${heading} (${forgets} Forget for ${approvedPhones} approved phones)`);
      }
    }
    if (phones > 0) {
      const expected = waitingRows === phones ? "Waiting for your OK" : "Paired";
      if (headline !== expected) {
        problems.push(`a house with ${waitingRows} of ${phones} phones waiting must be headlined "${expected}", not "${headline}": ${heading}`);
      }
    }
    // The sentence's counts must be the card's own rows: the page holds the
    // devices it just drew, so a number that disagrees with them is a lie
    // whichever direction it misses.
    const pairedCount = sentence.match(/(\d+) paired phones/);
    if (pairedCount && Number(pairedCount[1]) !== phones) {
      problems.push(`the sentence counts ${pairedCount[1]} paired phones but the card draws ${phones}: ${heading}`);
    }
    const waitingCount = sentence.match(/(\d+) (?:is|are) waiting/);
    if (waitingCount && Number(waitingCount[1]) !== waitingRows) {
      problems.push(`the sentence counts ${waitingCount[1]} waiting but the card draws ${waitingRows} waiting rows: ${heading}`);
    }

    // The first page's arms: the sentence and the button must be the words
    // of the page that fixes THAT arm (states-react titles carry the arm,
    // and its scenarios build the arm through setupArm — the mapping App
    // runs, so a broken mapping reddens its own arm's check here).
    // The room's cards: what the host's view must always say and never
    // say, read off the same rendered copy every other card is read with.
    if (heading.startsWith("Room — ")) {
      // A language card asserts its own sentences below; the English ones
      // do not apply to a page rendered in another language.
      if (heading.startsWith("Room — in ")) {
        const want = heading.includes("Chinese")
          ? ["停止", "Kalsa 正在回答Marco。"]
          : ["Kalsa risponderà prima a Marco, poi a Luca.", "Chiedi a Kalsa"];
        const missing = want.filter((wanted) => !all.includes(wanted));
        if (missing.length > 0) {
          problems.push(`Room — ${heading}: missing ${JSON.stringify(missing)}`);
        }
        continue;
      }
      if (heading.includes("empty room")) {
        if (!all.includes("No messages yet. Say something, or ask Kalsa.")) {
          problems.push(`Room — empty room must say so: ${heading}`);
        }
        if (buttons.includes("Stop")) {
          problems.push(`Room — empty room must not offer Stop: ${heading}`);
        }
        if (!buttons.includes("Ask Kalsa")) {
          problems.push(`Room — empty room must still offer Ask Kalsa: ${heading}`);
        }
      }
      if (heading.includes("messages from several members")) {
        for (const wanted of ["dinner at eight?", "saving me a seat", "It is 17:00."]) {
          if (!all.includes(wanted)) problems.push(`Room — the transcript must carry "${wanted}": ${heading}`);
        }
        if (!all.includes("· left")) {
          problems.push(`Room — a former member must be marked: ${heading}`);
        }
        if (!all.includes("read the last 2")) {
          problems.push(`Room — Kalsa's answer must say what it read: ${heading}`);
        }
      }
      if (heading.includes("Kalsa answering")) {
        if (!buttons.includes("Stop")) {
          problems.push(`Room — an answering turn must offer Stop: ${heading}`);
        }
        if (!all.includes("Kalsa is answering Marco.")) {
          problems.push(`Room — the turn must name who it answers: ${heading}`);
        }
        if (!all.includes("It is 17:00, and the")) {
          problems.push(`Room — the live answer must stream into the page: ${heading}`);
        }
      }
      if (heading.includes("waiting with the busy note")) {
        if (!all.includes("Kalsa is busy with another conversation. You keep your turn.")) {
          problems.push(`Room — the busy note must be shown by its code: ${heading}`);
        }
        // The turn still runs while it waits (the stop can act on it), so
        // Stop stays: the rule is "shows exactly when it can act".
        if (!buttons.includes("Stop")) {
          problems.push(`Room — a waiting turn can still be stopped: ${heading}`);
        }
      }
      if (heading.includes("idle: no Stop") && buttons.includes("Stop")) {
        problems.push(`Room — idle must not offer Stop: ${heading}`);
      }
      if (heading.includes("thinking")) {
        // A turn runs while Kalsa thinks: the stop can act, so it shows.
        if (!buttons.includes("Stop")) {
          problems.push(`Room — a thinking turn must offer Stop: ${heading}`);
        }
        if (!all.includes("Kalsa is answering Marco.")) {
          problems.push(`Room — a thinking turn names who it is for: ${heading}`);
        }
      }
      if (heading.includes("closed room")) {
        if (!all.includes("Turn on Kalsa to use the room.")) {
          problems.push(`Room — a closed room must point at the switch: ${heading}`);
        }
        if (buttons.length > 0) {
          problems.push(`Room — a closed room offers nothing to press: ${heading}`);
        }
      }
      if (heading.includes("refusal: already pending")) {
        if (!all.includes("You already have a question waiting for Kalsa.")) {
          problems.push(`Room — the pending refusal must be said: ${heading}`);
        }
      }
      const NAME_SENTENCES = [
        ["name: taken", "Someone in this room already uses that name. Pick another."],
        ["name: reserved", "Kalsa is the assistant's name. Pick another."],
        ["name: framing", "Names can't use [ or ]."],
        ["name: mixed scripts", "Use letters from one alphabet in your name."],
        ["name: too long", "That name is too long. Try a shorter one."],
      ];
      for (const [needle, wanted] of NAME_SENTENCES) {
        if (heading.includes(needle) && !all.includes(wanted)) {
          problems.push(`Room — ${needle} must say "${wanted}": ${heading}`);
        }
      }
      if (heading.includes("in Italian")) {
        if (!all.includes("Kalsa risponderà prima a Marco, poi a Luca.")) {
          problems.push(`Room — the Italian line must be whole-message: ${heading}`);
        }
        if (!all.includes("Stanza") && !all.includes("Studio")) {
          problems.push(`Room — the Italian card renders: ${heading}`);
        }
      }
      if (heading.includes("in Chinese")) {
        if (!all.includes("Kalsa 正在回答Marco。")) {
          problems.push(`Room — the Chinese answering line must be whole-message: ${heading}`);
        }
        if (!all.includes("工作室")) {
          problems.push(`Room — the Chinese card renders the room name: ${heading}`);
        }
      }
      if (heading.includes("the copy table")) {
        for (const code of [
          "already_pending",
          "name_taken",
          "name_reserved",
          "name_framing",
          "name_mixed_scripts",
          "name_too_long",
        ]) {
          if (!all.includes(`GOOD: ${code}`)) {
            problems.push(`Room — copy table must render the sentence for "${code}": ${heading}`);
          }
        }
        if (all.includes("WRONGLY")) {
          problems.push(`Room — copy table rendered a wrong sentence`);
        }
      }
      if (heading.includes("the queue line")) {
        // The owner's three forms, exactly: one name alone, two with
        // "then", three with the list and "and" before the last.
        const forms = [
          "Kalsa will answer Marco next.",
          "Kalsa will answer Marco next, then Luca.",
          "Kalsa will answer Marco next, then Luca and Sofia.",
        ];
        for (const wanted of forms) {
          if (!all.includes(wanted)) {
            problems.push(`Room — queue line must say "${wanted}": ${heading}`);
          }
        }
      }
      if (heading.includes("queue: three waiting")) {
        if (!all.includes("Kalsa will answer Marco next, then Luca and Sofia.")) {
          problems.push(`Room — the card's queue line must be the three-name form: ${heading}`);
        }
      }
      if (heading.includes("the feed reducer")) {
        for (const verdict of ["LIVE-KEPT: yes", "MERGED: LAND1+LAND2", "EPOCH-REPLACED: yes", "NO-DUPLICATE: yes"]) {
          if (!all.includes(verdict)) {
            problems.push(`Room — feed reducer must hold "${verdict}": ${heading}`);
          }
        }
      }
      if (heading.includes("the @Kalsa rule")) {
        // Each probe line is prefixed by its verdict, so one text stream
        // answers both directions without a second read.
        for (const wanted of ["请问@Kalsa", "@Kalsa你好", "你好，@Kalsa", "hey @Kalsa, ciao", "(@Kalsa)", "@Kalsa's"]) {
          if (!all.includes(`CALL: ${wanted}`)) problems.push(`Room — @Kalsa rule: "${wanted}" must call`);
        }
        for (const wanted of ["josé@Kalsa", "café@Kalsa", "@Kalsabot", "@Kalsa\u0301"]) {
          if (!all.includes(`SILENT: ${wanted}`)) problems.push(`Room — @Kalsa rule: "${wanted}" must not call`);
        }
        if (!all.includes("SILENT: marco [at] kalsa [dot] io")) {
          problems.push(`Room — @Kalsa rule: "marco@kalsa.io" must not call`);
        }
        if (all.includes("WRONGLY CALLS")) {
          problems.push(`Room — @Kalsa rule: the mirror calls something it must not`);
        }
      }
    }
    const FIRST_PAGE = {
      off: ["This computer is not running anything right now.", "Go to Server"],
      service: ["This computer's chat connection is not working right now.", "Go to Devices"],
      starting: ["Getting ready. On an older computer this can take a minute.", "Go to Server"],
      key: ["This computer has not made its own connection key yet.", "Devices"],
      "key-read": ["This computer could not read its own connection key.", "Devices"],
      "key-junk": ["This computer has not made its own connection key yet.", "Devices"],
      settings: ["This computer has no model name yet.", "Open Advanced"],
      ready: ["Write your first message below to begin.", null],
    };
    const armName = Object.keys(FIRST_PAGE).find((arm) =>
      heading.startsWith(`firstpage/${arm} `),
    );
    if (heading.startsWith("firstpage/") && !armName) {
      problems.push(`unknown first-page arm: ${heading}`);
    }
    if (armName) {
      const [wanted, button] = FIRST_PAGE[armName];
      if (!all.includes(wanted)) {
        problems.push(`firstpage/${armName}: the arm must say "${wanted}": ${heading}`);
      }
      if (button === null) {
        const offered = ["Go to Server", "Open settings", "Devices"].filter((b) => buttons.includes(b));
        if (offered.length > 0) {
          problems.push(`firstpage/${armName}: the ready page offers nothing to fix: ${JSON.stringify(offered)}`);
        }
      } else if (!buttons.includes(button)) {
        problems.push(`firstpage/${armName}: the arm must offer "${button}": ${heading} (buttons: ${JSON.stringify(buttons)})`);
      }
    }
    // The note is demanded exactly where the components render it. Only the
    // desk port is on every pairing read; the door's is there only while
    // the door is up (a stopped brain stands the door down), so the cards
    // below carry both ports because their brains are running. DevicesSurface
    // draws the note in paired and beside a square - never in idle,
    // claiming or failed - and AdvancedPanel draws its line whenever its
    // dto has either port. A vanished note where one belongs is a phone
    // with no road; a demanded note where the page draws none is a rule
    // fighting the page.
    const devicesNoteExpected =
      (doorPort !== null || deskPort !== null) &&
      (pairingState === "paired" || (pairingState === "waiting" && qr));
    const noteExpected = hasAdvanced
      ? doorPort !== null || deskPort !== null
      : devicesNoteExpected;
    if (noteExpected && !all.includes("Run for Tailscale")) {
      problems.push(`a card that must carry the Tailscale note does not: ${heading}`);
    }
    if (all.includes("Run for Tailscale")) {
      const doorCommand = all.match(/tailscale serve --bg (\d+)/);
      const deskCommand = all.match(/tailscale serve --bg --https=8443 (\d+)/);
      if (doorPort !== null && Number(doorCommand?.[1]) !== doorPort) {
        problems.push(`the note's door command must name the card's own door number ${doorPort}: ${heading}`);
      }
      if (deskPort !== null && Number(deskCommand?.[1]) !== deskPort) {
        problems.push(`the note's desk command must name the card's own desk number ${deskPort}: ${heading}`);
      }
    }
    // The moved sentence lives inside the note, so it is demanded only
    // where the note is: an idle, claiming or failed card whose desk fell
    // back draws no note at all, and must not be asked for a sentence the
    // page never renders.
    const movedExpected = noteExpected && deskPort !== null && !deskPreferred;
    const movedLine = all.match(/on (\d+) this time — point the desk command at this number/);
    if (movedExpected && Number(movedLine?.[1]) !== deskPort) {
      problems.push(`a desk on a fallback number must say it is on the card's own desk number ${deskPort}: ${heading}`);
    }
    if (!movedExpected && movedLine) {
      problems.push(`a desk on its preferred number must not claim a move: ${heading}`);
    }
  }

  const hostile = [
    ["NaN total", { state: { kind: "stopped" }, step: { kind: "model_bytes", done: 320e6, total: NaN } }],
    ["zero total", { state: { kind: "stopped" }, step: { kind: "model_bytes", done: 320e6, total: 0 } }],
    ["negative done, missing what", { state: { kind: "stopped" }, step: { done: -5 } }],
    ["missing bytes", { state: { kind: "stopped" }, step: { kind: "model_bytes" } }],
    ["fetching is a string", { state: { kind: "stopped" }, step: "garbage" }],
    ["fetching is null", { state: { kind: "stopped" }, step: null }],
    ["unknown phase", { state: { kind: "stopped" }, step: { kind: "does-not-exist" } }],
    ["unknown failure", { state: { kind: "failed", reason: "weird" } }],
  ];
  for (const [name, data] of hostile) {
    try {
      const { result } = await renderer.renderServerProbe(data, data.step);
      for (const word of ["NaN", "Infinity", "undefined", "null"]) {
        if (new RegExp(`\\b${word}\\b`).test(result.all)) problems.push(`hostile DTO "${name}" rendered the leak "${word}"`);
      }
      if (!result.sentence.trim()) problems.push(`hostile DTO "${name}" rendered no sentence`);
    } catch (error) {
      problems.push(`hostile DTO "${name}" made the page throw: ${error.message}`);
    }
  }

  const advancedProbeDto = renderer.advancedDto({ threads_batch: undefined });
  try {
    if (!(await renderer.renderAdvancedFieldProbe(advancedProbeDto))) problems.push("an open Advanced field was overwritten by polling");
  } catch (error) {
    problems.push(`the Advanced polling probe could not run: ${error.message}`);
  }

  try {
    const cacheProbe = await renderer.renderAdvancedCacheProbe({ advanced: renderer.advancedDto() });
    // `help` is the list of `.advanced-help` paragraphs, so these are whole
    // lines: the f16 line must be the one shown, cost included, and the q8_0
    // line must appear nowhere.
    const f16Help =
      "Automatic is 4k (4096 tokens). Up to 4k on this computer. The KV cache for 4k tokens uses 1 GiB.";
    const q8Help =
      "Automatic is 8k (8192 tokens). Up to 8k on this computer. The KV cache for 8k tokens uses 1 GiB.";
    if (!cacheProbe.help.includes(f16Help) || cacheProbe.help.includes(q8Help)) {
      problems.push("f16 cache context help must use context_max_f16 and stop showing context_max");
    }
  } catch (error) {
    problems.push(`the Advanced cache context probe could not run: ${error.message}`);
  }

  const failureText = await renderer.renderStartFailureProbe({ state: { kind: "stopped" }, startFailure: "The model chosen for this computer needs more memory than the computer can give it, even to start. An app update may bring a smaller option." });
  if (!failureText.includes("Did not start")) {
    problems.push("a held start failure must not be titled as if something had been running");
  }
  if (!failureText.includes("The model chosen for this computer needs more memory than the computer can give it, even to start. An app update may bring a smaller option.")) {
    problems.push("a walk failure must be spoken in its own words, not the generic ones");
  }

  const hostileSteps = [
    ["negative done", { kind: "model_bytes", done: -5, total: 100 }],
    ["non-numeric bytes", { kind: "runtime_bytes", done: "many", total: "lots" }],
    ["unknown kind", { kind: "warp_drive" }],
    ["null step", null],
  ];
  for (const [name, step] of hostileSteps) {
    try {
      const { result } = await renderer.renderServerProbe({ state: { kind: "stopped" } }, step);
      for (const word of ["NaN", "Infinity", "undefined", "null"]) {
        if (new RegExp(`\\b${word}\\b`).test(result.all)) problems.push(`hostile progress "${name}" rendered the leak "${word}"`);
      }
      if (!result.sentence.trim()) problems.push(`hostile progress "${name}" rendered no sentence`);
    } catch (error) {
      problems.push(`hostile progress "${name}" made the page throw: ${error.message}`);
    }
  }

  await rm(dir, { recursive: true, force: true });
  if (problems.length > 0) {
    console.log("COPY PROBLEMS:");
    for (const problem of problems) console.log(`  - ${problem}`);
    process.exitCode = 1;
  } else {
    console.log(`ok: ${results.length} states rendered, copy rules hold`);
  }
} catch (error) {
  console.error(error.stack ?? error);
  process.exitCode = 1;
} finally {
  if (timeout !== null) clearTimeout(timeout);
}
