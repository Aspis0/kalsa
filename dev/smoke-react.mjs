// Headless check for the React surfaces. esbuild compiles the real TSX once,
// this small DOM lets React mount it, and the checks read rendered copy.
// Nothing is served, and every mounted root is unmounted by states-react.mjs.

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "../chat/node_modules/esbuild/lib/main.js";

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

const timeout = setTimeout(() => {
  console.error("React smoke timed out");
  process.exit(2);
}, 30000);

try {
  installDom();
  const { dir, renderer } = await loadRenderer();
  const results = await renderer.renderStates();
  const problems = [];
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
  const previousStorage = globalThis.localStorage;
  const storage = new Map();
  globalThis.localStorage = {
    getItem: (key) => storage.get(key) ?? null,
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

  const NOTHING = [
    "nothing for you to do here",
    "Open the app on this computer",
    "To pair your phone with this computer",
    "A phone is connecting right now",
    "This computer now works with",
    "will appear here in a moment",
    "Looking at what this computer",
    "Finding the version of the engine",
    "can take a minute",
    "You never have to pick one",
    "You never have to pick anything",
    "The Server page says why",
    "It is starting now",
  ];
  for (const { heading, sentence, button, working, walk, qr } of results) {
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

  const CAMERA_INSTRUCTION = "Point your phone's camera at the square.";
  const AWARENESS = "Anyone who can see this square can connect a phone — show it only to yours.";
  const REPAIR_PRIMARY = "Pair another phone";
  const CANCEL_PRIMARY = "Cancel";
  const FRESH_PHRASINGS = [
    "The previous square expired — this one is fresh.",
    "A square that did not match was replaced — this one is fresh.",
  ];
  for (const { heading, headline, sentence, all, qr, fresh, buttons, deviceNames, deviceDetails } of results) {
    if (qr) {
      if (sentence.trim() !== CAMERA_INSTRUCTION) problems.push(`a waiting square must give the camera instruction in the approved phrasing: ${heading}`);
      if (!all.includes(AWARENESS)) problems.push(`a waiting square must say who can see it: ${heading}`);
    }
    if (fresh !== null && !FRESH_PHRASINGS.includes(fresh)) problems.push(`a fresh-square note must be an approved phrasing: ${heading}`);
    if (sentence.includes("now works with") && !buttons.includes(REPAIR_PRIMARY)) problems.push(`a paired phone must offer a deliberate way to pair another: ${heading}`);
    if (sentence.includes("saved the connection") && !buttons.includes(REPAIR_PRIMARY)) problems.push(`a pending delivery must still offer another pairing: ${heading}`);
    if (heading.includes("saved here; the phone still needs the response") && !sentence.includes("the phone still needs to receive it")) {
      problems.push(`a pending delivery must say that the phone still needs the response: ${heading}`);
    }
    // The host row is one of the stored devices now, and it is not a phone:
    // the house sentence counts phones, so the check must count them too.
    const phoneNames = deviceNames.filter((name) => name !== "This computer");
    if (phoneNames.length >= 2 && !sentence.includes("paired phones")) {
      problems.push(`a several-phone house must be described as a house, not by one of its phones: ${heading}`);
    }
    if (sentence.includes("A phone is connecting right now") && !buttons.includes(CANCEL_PRIMARY)) problems.push(`a claimed square must offer cancellation: ${heading}`);
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
    // The Tailscale note names BOTH roads, because a phone reaches the door
    // and the desk through serve rules that must run side by side — which
    // is why each command carries --bg.
    if (all.includes("Run for Tailscale")) {
      if (!/tailscale serve --bg \d+/.test(all) || !/tailscale serve --bg --https=8443 \d+/.test(all)) {
        problems.push(`the Tailscale note must give both serve commands, each with --bg: ${heading}`);
      }
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
  clearTimeout(timeout);
}
