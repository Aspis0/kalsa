// The "Browse for me" control: what a turn is offered, what the message
// carries, what the model is told, and what the prompt says.
//
// The control is the person's, not the model's: an armed turn is offered the
// browser and nothing else, an ordinary turn is offered the web and nothing
// from the browser, and the two families are never in the same list. The
// arming is spent by the send, so one message is the browser's and the next
// is an ordinary one. The flag rides the message, so the badge that says so
// survives a reload. The sentence a call to a tool the turn never offered is
// answered with is the browser's own in an armed turn, and the prompt says
// the same thing in both — byte for byte, because the engine caches it.
//
// **And an armed turn stays the browser's when the browser is gone.** The
// browser can disappear between the tap and the send; the turn is then still
// the browser's, with an empty offer — no web, no mini app, no mail — and
// never a web turn with the web's tools in its place. The prompt names the
// control in both of the names it goes by, in one fixed sentence.

//
// Pure: no server, no browser, no network.
//
// Run: node scripts/browse-mode.mjs   (from chat/)

import { rm } from "node:fs/promises";
import { loadApp } from "./lib/app-bundle.mjs";

const { dir, app } = await loadApp();
const {
  offeredTools,
  phoneTools,
  noteBrowserStatus,
  newUserTurn,
  createStore,
  buildPinnedContext,
  systemPrompt,
  runToolCall,
  TABLES,
  DISARMED,
  tap,
  spend,
  modeOf,
} = app;

let fail = 0;
function check(label, ok, detail) {
  if (!ok) fail++;
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${ok || detail === undefined ? "" : `\n     ${detail}`}`);
}
function equal(label, actual, expected) {
  check(label, JSON.stringify(actual) === JSON.stringify(expected), `got ${JSON.stringify(actual)}\n     want ${JSON.stringify(expected)}`);
}

/** The browser's five tools, in the order the offer gives them. */
const THE_BROWSER = ["browser_open", "browser_read", "browser_find", "browser_click", "browser_type"];

/** The words the model reads when the turn never offered the tool it called. */
const LIT_NOT_OFFERED = "That tool is not available now. Answer without it.";
const LIT_NOT_OFFERED_BROWSER = "The person asked you to browse for them this turn. Use the browser tools.";

class MemoryStorage {
  #map = new Map();
  get length() {
    return this.#map.size;
  }
  getItem(key) {
    return this.#map.has(key) ? this.#map.get(key) : null;
  }
  setItem(key, value) {
    this.#map.set(key, String(value));
  }
  removeItem(key) {
    this.#map.delete(key);
  }
}
globalThis.localStorage = new MemoryStorage();
globalThis.window = {
  setTimeout,
  clearTimeout,
  addEventListener: () => {},
  __TAURI__: { core: { invoke: async () => null } },
};

try {
  // --- what is offered --------------------------------------------------------
  {
    noteBrowserStatus({ supported: true, installed: true, size: 42 });
    const armed = offeredTools(true, "en", "any-model", "browser").map((tool) => tool.function.name);
    equal("an armed turn is offered the browser's five tools and nothing else", armed, THE_BROWSER);
    check("and no web tool at all", !armed.some((name) => name.startsWith("web_")), armed.join(","));
    check("and no mini app", !armed.includes("create_miniapp"), armed.join(","));

    const web = offeredTools(true, "en", "any-model", "web").map((tool) => tool.function.name);
    check("an ordinary turn is offered the web tools", web.includes("web_search") && web.includes("web_fetch"), web.join(","));
    check("and the mini app", web.includes("create_miniapp"), web.join(","));
    check("and no browser tool at all", !web.some((name) => name.startsWith("browser_")), web.join(","));

    // **The two lists share nothing.** This is the whole point of the control:
    // the model is not choosing between a search and a page, the person is.
    check("and the two lists share no tool at all", !armed.some((name) => web.includes(name)), armed.join(","));

    const phone = phoneTools(true, "en", "any-model", true, "2").map((tool) => tool.function.name);
    check("a phone turn is offered no browser tool", !phone.some((name) => name.startsWith("browser_")), phone.join(","));

    // --- the picture of the page ------------------------------------------------
    // **The sixth tool, and the one the owner switches on.** A picture is
    // offered only where three things hold: the person armed the browser for
    // this turn, the hidden setting is on, and the engine has eyes. The
    // setting is the lever: it is off unless somebody asked for it, so a build
    // nobody asked for this feature never offers a picture.
    {
      const gate = { armed: true, flag: true, vision: true };
      const names = (over) =>
        offeredTools(true, "en", "any-model", "browser", { ...gate, ...over }).map((tool) => tool.function.name);
      equal("an armed turn with the switch on and eyes is offered the picture", names({}), [
        ...THE_BROWSER,
        "browser_screenshot",
      ]);
      equal("with the switch off it is not", names({ flag: false }), THE_BROWSER);
      equal("and without eyes it is not", names({ vision: false }), THE_BROWSER);
      equal("and an unarmed turn is not", names({ armed: false }), THE_BROWSER);
      // **The control cell is the one of today**: the same call as before the
      // picture existed, with no gate at all, offers the browser's five.
      equal("the armed turn without the gate is the browser's five, as before", armed, THE_BROWSER);
      // **A phone is never offered one**, whatever else is true.
      check(
        "a phone turn is offered no picture",
        !phone.includes("browser_screenshot"),
        phone.join(","),
      );
      const webWithGate = offeredTools(true, "en", "any-model", "web", gate).map((tool) => tool.function.name);
      check("and an ordinary turn is offered no picture", !webWithGate.includes("browser_screenshot"), webWithGate.join(","));
    }

    // And with no driver there is no browser turn to arm.
    noteBrowserStatus({ supported: false, installed: false, size: 0 });
    const without = offeredTools(true, "en", "any-model", "browser").map((tool) => tool.function.name);
    equal("and with no driver an armed turn is offered nothing at all", without, []);
    noteBrowserStatus({ supported: true, installed: true, size: 42 });
  }

  // --- the arming, spent by the send ----------------------------------------
  {
    equal("the chip arms the next message", tap(DISARMED), { armed: true });
    equal("and a second tap takes it back", tap(tap(DISARMED)), { armed: false });
    const spent = spend({ armed: true });
    equal("the send spends the arming and the message is the browser's", [spent.browserMode, spent.next], [true, { armed: false }]);
    equal("and an ordinary message is ordinary", spend(DISARMED).browserMode, false);
    // The second message after an armed one is not armed: the arming was spent.
    equal("so the message after an armed one is an ordinary one", spend(spent.next).browserMode, false);
  }

  // --- an armed turn never degrades to a web turn ----------------------------
  {
    // **The whole failure in one story**: the person taps the chip, the
    // browser goes away before the message is sent, and the message is sent
    // anyway. What the turn must be is not the question — the person asked
    // for the browser. What the turn must NOT be is a web turn with the web's
    // tools quietly offered in its place: a search is not the page they
    // asked for, and nobody asked for a search.
    noteBrowserStatus({ supported: true, installed: true, size: 42 });
    const tapped = tap(DISARMED);
    equal("the chip is on", tapped, { armed: true });

    // The browser is gone between the tap and the send.
    noteBrowserStatus({ supported: false, installed: false, size: 0 });

    const spent = spend(tapped);
    equal("the send spends the arming", spent.next, { armed: false });
    equal("and the message is still the browser's", spent.browserMode, true);

    const when = new Date("2026-01-02T03:04:05Z");
    const messages = [newUserTurn("m1", "look at this", when, { browserMode: spent.browserMode })];
    equal("so the turn is the browser's turn", modeOf(messages), "browser");

    // The model that may read the mailbox, so the offer below is the one the
    // person would really have got: a web turn would carry the web's tools
    // AND the mail's.
    const MAIL_MODEL = "Gemma 4 E4B";
    const offer = offeredTools(true, "en", MAIL_MODEL, modeOf(messages)).map((tool) => tool.function.name);
    equal("and the offer is empty", offer, []);
    check("no web tool is offered", !offer.some((name) => name.startsWith("web_")), offer.join(","));
    check("no mini app is offered", !offer.includes("create_miniapp"), offer.join(","));
    check("no mail tool is offered", !offer.some((name) => name.startsWith("mail_")), offer.join(","));

    // **The negative control: the old form fails this.** Degrading to a web
    // turn when no browser is there would make the same message a web turn,
    // and the same offer the web's — not empty. So the checks above are a
    // real check and not a tautology: with the old shape they would fail.
    const OLD_SPEND = (arming, available) => ({ next: { armed: false }, browserMode: arming.armed && available });
    const oldSpent = OLD_SPEND(tapped, false);
    const oldMessages = [newUserTurn("m2", "look at this", when, { browserMode: oldSpent.browserMode })];
    equal("the old form degrades the turn to a web one", modeOf(oldMessages), "web");
    const oldOffer = offeredTools(true, "en", MAIL_MODEL, modeOf(oldMessages)).map((tool) => tool.function.name);
    check("and its offer is the web's, not empty", oldOffer.length > 0, oldOffer.join(","));
    check("with the web's tools in it", oldOffer.some((name) => name.startsWith("web_")), oldOffer.join(","));
    check("and the mail's", oldOffer.some((name) => name.startsWith("mail_")), oldOffer.join(","));
    check("so the two forms' offers are not the same one", oldOffer.length !== offer.length, `${oldOffer.join(",")} vs ${offer.join(",")}`);

    noteBrowserStatus({ supported: true, installed: true, size: 42 });
  }

  // --- the flag rides the message --------------------------------------------
  {
    const when = new Date("2026-01-02T03:04:05Z");
    const armed = newUserTurn("m1", "look at this", when, { browserMode: true });
    const plain = newUserTurn("m2", "look at this", when);
    equal("an armed message carries the flag", armed.browserMode, true);
    equal("and an ordinary one carries none", plain.browserMode, undefined);
    equal("and the armed message is the browser's turn", modeOf([armed]), "browser");
    equal("and the ordinary one is a web turn", modeOf([plain]), "web");
    // **The last message is the one that counts**: the flag belongs to the
    // message it was sent with, not to the chat.
    equal("and the last message is the one that counts", modeOf([armed, plain]), "web");
    equal("and an assistant's answer is not a turn to arm", modeOf([armed, { id: "m3", role: "assistant", content: "sure", createdAt: 1 }]), "web");
  }

  // --- and the badge survives a reload --------------------------------------
  {
    const when = new Date("2026-01-02T03:04:05Z");
    const store = createStore();
    store.put({
      id: "c1",
      title: "a chat",
      createdAt: 1,
      updatedAt: 2,
      messages: [
        newUserTurn("m1", "look at this", when, { browserMode: true }),
        newUserTurn("m2", "and this", when),
      ],
    });
    const reread = createStore().get("c1").messages;
    equal("the armed message keeps its flag on disk", reread[0].browserMode, true);
    equal("and the ordinary one has none", reread[1].browserMode, undefined);
    const disk = JSON.parse(globalThis.localStorage.getItem("crescent-chat.msgs.c1.v2"));
    equal("and the flag is in what was written", disk[0].browserMode, true);
    check("and in the words the badge is drawn from", TABLES.it.tools.browserBadge === "browser", TABLES.it.tools.browserBadge);
  }

  // --- the sentence the model reads ------------------------------------------
  {
    const say = TABLES.en.tools;
    const call = { id: "c1", name: "web_search", arguments: '{"query":"kalsa"}' };
    const context = (browse) => ({
      say,
      runTool: async () => ({ ok: true, text: "" }),
      signal: new AbortController().signal,
      url: "http://127.0.0.1:1/v1/chat/completions",
      conversation: [],
      browse,
    });
    const armed = await runToolCall(call, null, context(true));
    const web = await runToolCall(call, null, context(false));
    equal("an armed turn answers a call it never offered with the browser's sentence", armed.result, LIT_NOT_OFFERED_BROWSER);
    equal("and an ordinary turn with the ordinary one", web.result, LIT_NOT_OFFERED);
    check("and the two are different sentences", armed.result !== web.result, armed.result);
    equal("and the sentence is the same in every language", ["en", "it", "es", "fr", "zh"].map((language) => TABLES[language].tools.notOfferedBrowser), [LIT_NOT_OFFERED_BROWSER, LIT_NOT_OFFERED_BROWSER, LIT_NOT_OFFERED_BROWSER, LIT_NOT_OFFERED_BROWSER, LIT_NOT_OFFERED_BROWSER]);
  }

  // --- the prompt says the same thing in both turns -------------------------
  {
    const when = new Date("2026-01-02T03:04:05Z");
    const armed = newUserTurn("m1", "look at this", when, { browserMode: true });
    const plain = newUserTurn("m2", "look at this", when);
    const armedWire = buildPinnedContext([armed], [], null);
    const webWire = buildPinnedContext([plain], [], null);
    equal("the system message is byte for byte the same in both turns", JSON.stringify(armedWire.wire[0]), JSON.stringify(webWire.wire[0]));
    const prompt = systemPrompt(false, false);
    check("and it names the control", prompt.content.includes("Browse for me"), prompt.content.slice(0, 120));
    // **The control is named in both of the names it goes by**, so the model
    // names the chip the way the person sees it on their own screen — and
    // both are literals in one fixed sentence, so no byte of it moves.
    check("and it names it in Italian too", prompt.content.includes("Browse for me (Naviga per me)"), prompt.content.slice(0, 120));
    check("and says what an armed turn is", prompt.content.includes("browser turn"), prompt.content.slice(0, 120));
    check("and says a search is not a page", prompt.content.includes("A web search is not the same as opening the page"), prompt.content.slice(0, 120));
    // **The phone is the one surface without the control, so the sentence goes
    // with it**: a sentence about a control the phone cannot show would name a
    // thing that is not there.
    const phone = systemPrompt(false, false, true);
    check("and the phone's prompt has none of it", !phone.content.includes("Browse for me"), phone.content.slice(0, 120));
    check("and none of it in Italian either", !phone.content.includes("Naviga per me"), phone.content.slice(0, 120));
    check("and the phone's prompt is shorter for it", phone.content.length < prompt.content.length, `${phone.content.length} vs ${prompt.content.length}`);
  }

  // --- the copy is in every language -----------------------------------------
  {
    equal(
      "the chip is named in every language",
      ["en", "it", "es", "fr", "zh"].map((language) => TABLES[language].composer.browser),
      ["Browse for me", "Naviga per me", "Navega por mí", "Naviguez pour moi", "帮我浏览"],
    );
    equal(
      "and the armed state says it is the next message only",
      [TABLES.en.composer.browserOn, TABLES.it.composer.browserOn],
      ["Browse for me · next message only", "Naviga per me · solo il prossimo messaggio"],
    );
    equal(
      "and the tooltip says what it does",
      [TABLES.en.composer.browserTitle, TABLES.it.composer.browserTitle],
      ["Can open websites, click and fill in pages for you.", "Può aprire siti, cliccare e compilare pagine per te."],
    );
  }

  console.log(fail === 0 ? "browse-mode: all checks passed" : `browse-mode: ${fail} failed`);
  process.exitCode = fail === 0 ? 0 : 1;
} finally {
  await rm(dir, { recursive: true, force: true });
}
