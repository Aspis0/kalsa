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
  const expertCards = results.filter(
    ({ heading }) =>
      heading.includes("running, live metrics") ||
      heading === "Model — advanced settings are visible" ||
      heading === "Model — advanced settings with the internet road unavailable" ||
      heading === "Model — advanced settings with the internet road turned off",
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
    "The Status page says why",
    "It is starting now",
  ];
  for (const { heading, sentence, button, working, walk, qr } of results) {
    const endsInNothing = NOTHING.some((phrase) => sentence.includes(phrase));
    const pressable = button && !button.disabled && button.text.trim() !== "";
    const progressButton = button && button.disabled && (button.text === "Measuring…" || button.text === "Starting");
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

  const MODEL_AUTO = "A model is chosen automatically — from this computer's memory and what your phone runs — every time you turn on.";
  const MODEL_NO_PICK = "You never have to pick one.";
  const modelCards = results.filter((r) => r.heading.startsWith("Model —"));
  if (!modelCards.some((r) => r.sentence.includes(MODEL_AUTO) && r.sentence.includes(MODEL_NO_PICK))) {
    problems.push("the Model page must explain the automatic choice and that picking is never asked");
  }
  for (const { heading, buttons } of modelCards) {
    if (buttons.some((text) => text.startsWith("Measure"))) problems.push(`the Model page must not ask the user to measure: ${heading}`);
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
  for (const { heading, sentence, all, qr, fresh, buttons, deviceNames } of results) {
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
    if (deviceNames.length >= 2 && !sentence.includes("paired devices")) {
      problems.push(`a several-device house must be described as a house, not by one of its devices: ${heading}`);
    }
    if (sentence.includes("A phone is connecting right now") && !buttons.includes(CANCEL_PRIMARY)) problems.push(`a claimed square must offer cancellation: ${heading}`);
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

  const failureText = await renderer.renderStartFailureProbe({ state: { kind: "stopped" }, startFailure: "The model chosen for this computer needs more memory than the computer can give it, even to start. An app update may bring a smaller option." });
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
