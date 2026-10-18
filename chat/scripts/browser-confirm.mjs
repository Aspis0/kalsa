// The step-4 confirms, end to end against the registry and the store the app
// uses: what is offered, what a write does while nobody has answered it, what a
// card shows, and what the model is told.
//
// The proofs are the plan's step-4 list. The two writing tools are offered on a
// desktop and on no phone, and a paused browser acts no further. A click that
// sends something comes back as `awaiting confirm <id>` — an answer, not a wait,
// because a person is slower than any tool deadline. What the window draws is the
// sidecar's own card, with a secret already masked, and it carries nothing else.
// The model is told an outcome on the next thing the person says, and never by a
// turn that waits for a button.
//
// **An outcome is a code and a host, and the words about it are written here.**
// The sidecar's own sentence used to be carried through verbatim, and that is how
// a stranger's path — and whatever their site wrote in the query — got onto a
// disk. Every check below about what the model is told is a check that no address
// survives, and the store is asked to drop a note that carries one.
//
// Pure: no server, no browser, no network.
//
// Run: node scripts/browser-confirm.mjs   (from chat/)

import { rm } from "node:fs/promises";
import { loadApp } from "./lib/app-bundle.mjs";

const { dir, app } = await loadApp();
const {
  createStore,
  executeToolCall,
  offeredTools,
  phoneTools,
  noteBrowserStatus,
  browserAnswerNow,
  browserPressPause,
  browserDots,
  currentBrowserCards,
  browserDestinationLabel,
  settledBrowserCards,
  isBrowserPaused,
  isBrowserWindowOpen,
  noteBrowserCards,
  noteBrowserAnswered,
  startBrowserWindowBus,
  takeBrowserOutcomes,
  takeNote,
  fences,
} = app;

/** The words the recap is drawn in, as the window draws it. */
const RECAP_WORDS = app.TABLES.en.tools.recap;

let fail = 0;
function check(label, ok, detail) {
  if (!ok) fail++;
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${ok || detail === undefined ? "" : `\n     ${detail}`}`);
}
function equal(label, actual, expected) {
  check(label, JSON.stringify(actual) === JSON.stringify(expected), `got ${JSON.stringify(actual)}\n     want ${JSON.stringify(expected)}`);
}

const OFFERED = ["browser_open", "browser_read", "browser_find", "browser_click", "browser_type"];

/** The chat the browser is driving, and another one it is not. */
const CHAT = "chat-a";
const OTHER = "chat-b";

/** What each command was asked for, so a proof can say nothing left. */
const CLICKS = [];
const TYPES = [];
const ANSWERS = [];

/** What the sidecar said a click sent, so the card the window draws is its own. */
let awaiting = "awaiting confirm c1";
/** The pause and resume calls the window's control makes. */
const PAUSES = [];
/** Every browser command that actually reached the app, in order, so a proof
 * can say what did not leave this file while Pausa was on. */
const REACHED = [];
/** What the sidecar says when an id is answered: a code and a host. */
let outcome = JSON.stringify({ code: "sent", host: "shop.example" });
/** A press that never reaches Rust: the card is spent and nothing came back. */
let answeringFails = false;
/** The window the backend is holding open, and whether it is paused. This is
    **the backend's answer to its own question**: a page that mounts asks for it,
    and the page never works it out for itself. */
let backendWindow = { open: false, paused: false };
/** What the app said on its events, so a proof can hand the page one. */
const EVENTS = new Map();

const CARD = {
  id: "c1",
  method: "POST",
  url: "https://shop.example/order",
  conversation: CHAT,
  // **The destination the sidecar's parser gave it.** The window never works
  // this out from `url` — that is the whole of this object.
  destination: { host: "shop.example", port: null, secure: true },
  fields: [
    { name: "city", value: "Bologna", secret: false, label: "La città" },
    { name: "passphrase_2", value: "the-real-password", secret: true },
  ],
};

// **A card the sidecar could not name a host for.** It travels without a
// destination and is drawn with no way to send it: there is nothing for a person
// to be agreeing to.
const NOWHERE_CARD = {
  id: "c0",
  method: "POST",
  url: "not-an-address",
  conversation: CHAT,
  destination: null,
  fields: [],
};

// **A write whose address carries the data.** The card shows the host and not
// the path, which is the owner's decision; but a value in the query is data —
// it leaves with the request — so it comes as a field of its own, after the
// fields the page wrote. This is the shape the crate hands over.
const QUERY_CARD = {
  id: "q1",
  method: "POST",
  url: "https://shop.example/api",
  conversation: CHAT,
  fields: [
    { name: "colour", value: "blue", secret: false, label: "Il colore" },
    { name: "msg", value: "Ciao Giulia", secret: false },
    { name: "token", value: "the-real-password", secret: true },
    { name: "flag", value: "", secret: false },
  ],
};

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
  __TAURI__: {
    core: {
      invoke: async (command, args) => {
        if (command.startsWith("brain_browser_")) {
          if (!command.endsWith("_pause") && !command.endsWith("_resume")) REACHED.push(command);
        }
        if (command === "brain_browser_click") {
          CLICKS.push([args.ref, args.conversation]);
          return awaiting;
        }
        if (command === "brain_browser_type") {
          TYPES.push([args.ref, args.text, args.conversation]);
          return awaiting;
        }
        if (command === "brain_browser_pause" || command === "brain_browser_resume") {
          PAUSES.push(command.endsWith("pause") ? "pause" : "resume");
          return null;
        }
        if (command === "brain_browser_state") return { ...backendWindow, seq: backendSeq };
        if (command === "brain_browser_confirm" || command === "brain_browser_decline") {
          ANSWERS.push([command.endsWith("confirm") ? "allow" : "decline", args.id, args.conversation]);
          if (answeringFails) throw new Error("the sidecar went away");
          return outcome;
        }
        return null;
      },
    },
    event: {
      listen: async (event, handler) => {
        EVENTS.set(event, handler);
        return () => EVENTS.delete(event);
      },
    },
  },
};

/** One call through the real registry, with the owner's web switch on: these
 * proofs are about what a write does, and the switch off is proved in
 * browser-tools.mjs. */
async function attempt(name, args, conversation = CHAT) {
  return executeToolCall(name, args, undefined, null, [], "any-model", undefined, undefined, true, conversation);
}

/** How many times the app has moved its view of the window. It travels with
    every snapshot, exactly as it does in the app, so a proof that hands the page
    an older one afterwards is handing it what a delayed read really is. */
let backendSeq = 0;

/** One snapshot, as the app's event carries it. */
function deliver(seq, window) {
  const said = EVENTS.get("brain_browser_state");
  if (!said) throw new Error("the page is not listening for the window");
  said({ ...window, seq });
}

/** What the app said on `brain_browser_state` — the way the page hears it, and
    the only way these proofs move the window: the page has no setter of its own,
    which is the whole of the change. */
function backendSays(window) {
  backendSeq += 1;
  deliver(backendSeq, window);
}

try {
  // **The app starts the window's own subscription on its mount**, and every
  // proof below moves the window the way the app hears it, so the page has to be
  // listening first — which is also what makes the reload proof at the end real:
  // that one starts a second bus over the same store, as a reloaded page does.
  await startBrowserWindowBus();
  // **And a page that has just mounted draws no window.** It has heard no event
  // and the app has answered its one read with no window, which is the honest
  // answer for a browser that was never opened — and the whole of what the
  // Pausa control is drawn from.
  check("a fresh page that has just mounted draws no window", isBrowserWindowOpen() === false, "the app says there is none");

  // --- what is offered --------------------------------------------------------
  {
    noteBrowserStatus({ supported: true, installed: true, size: 42 });
    const names = offeredTools(true, "en", "any-model").map((tool) => tool.function.name);
    equal("a driver offers the three reads and the two writes", names.filter((name) => OFFERED.includes(name)), OFFERED);

    // **A phone turn drives the same browser**, under the same offer: it is a
    // paired phone and it is the person. What it must not be is a phone that
    // cannot be told which phone it is — a write behind an unidentified turn is a
    // card with nobody to show it, so it is not offered.
    const named = phoneTools(true, "en", "any-model", true, "2").map((tool) => tool.function.name);
    equal("a phone turn that names its phone is offered the whole browser", named.filter((name) => OFFERED.includes(name)), OFFERED);
    const anonymous = phoneTools(true, "en", "any-model", true, null).map((tool) => tool.function.name);
    check(
      "and a turn that names no phone is offered the reads and neither write",
      anonymous.includes("browser_open") && !anonymous.includes("browser_click") && !anonymous.includes("browser_type"),
      anonymous.join(","),
    );
  }

  // --- a write is an answer, not a wait --------------------------------------
  {
    const began = Date.now();
    const clicked = await attempt("browser_click", { ref: "e5" });
    check("a click that sends something answers with the id and not the page", clicked.ok === true && clicked.text.includes("c1"), clicked.text);
    check("and it answers at once rather than waiting for the person", Date.now() - began < 2000, `${Date.now() - began}ms`);
    equal("the click went through with the ref it was given, and the chat driving it", CLICKS[0], ["e5", CHAT]);

    // A space is something a person typed, and a form that submits on a space is
    // a real thing: the text is not trimmed on the way out.
    await attempt("browser_type", { ref: "e4", text: "  Bologna " });
    equal("a typed space is not a typed space", TYPES[0], ["e4", "  Bologna ", CHAT]);
  }

  // --- and a missing argument is a sentence, not a broken call ---------------
  {
    const noRef = await attempt("browser_click", {});
    check("a click with no element says so", noRef.ok === false && /no element/i.test(noRef.text), noRef.text);
    const noText = await attempt("browser_type", { ref: "e4" });
    check("a type with no words says so", noText.ok === false && /no words/i.test(noText.text), noText.text);
  }

  // --- Pausa stops the next action, and only the next ------------------------
  {
    const before = CLICKS.length;
    backendSays({ open: true, paused: false });
    equal("the browser is running to begin with", isBrowserPaused(), false);

    backendSays({ open: true, paused: true });
    const stopped = await attempt("browser_click", { ref: "e5" });
    check(
      "a paused browser acts no further, and says what it did not do",
      stopped.ok === false && /paused/i.test(stopped.text) && /nothing was sent/i.test(stopped.text),
      stopped.text,
    );
    equal("and nothing was sent", CLICKS.length, before);

    // A card is still answerable while paused: pausing is not declining.
    check("a card stays on the window while paused", currentBrowserCards().length === 0, "nothing has been held here");
    backendSays({ open: true, paused: false });
    const again = await attempt("browser_click", { ref: "e5" });
    check("and a resumed browser acts again", again.ok === true, again.text);
  }

  // --- the card, and the answer ------------------------------------------------
  {
    noteBrowserCards([CARD]);
    const cards = currentBrowserCards();
    equal("the card the window draws is the sidecar's", [cards.length, cards[0].id, cards[0].method, cards[0].url], [1, "c1", "POST", "https://shop.example/order"]);
    equal("and it says which chat it belongs to", cards[0].conversation, CHAT);
    check("and what it would send is drawn field by field, as sent", cards[0].fields.length === 2 && cards[0].fields[0].name === "city", JSON.stringify(cards[0].fields));
    check("a page cannot hide anything by naming a field password",
      cards[0].fields.some((f) => f.name === "password_x") === false, "the fixture carries none");
    check(
      "a password-class field crosses with its value, because that is what the card is for",
      cards[0].fields[1].secret === true && cards[0].fields[1].value === "the-real-password",
      JSON.stringify(cards[0].fields[1]),
    );
    check(
      "and it is the flag, not the text, that makes the window draw it as dots",
      browserDots.length > 0 && cards[0].fields[1].value !== browserDots,
      `dots are ${browserDots.length} marks, and the value is the person's own`,
    );
    check(
      "a field the model typed is shown in full, whatever it is called",
      cards[0].fields[0].secret === false && cards[0].fields[0].value === "Bologna",
      JSON.stringify(cards[0].fields[0]),
    );

    const said = await browserAnswerNow(true, "c1", CHAT);
    equal("the person's yes is one id, one command and the chat that raised it", ANSWERS[ANSWERS.length - 1], ["allow", "c1", CHAT]);
    equal("and the card is off the window at once, so a second press finds nothing", currentBrowserCards().length, 0);
    equal("the page's own words for a field reach the card, and a field with none has none", [cards[0].fields[0].label, cards[0].fields[1].label], ["La città", null]);
    equal("an answered card is one line, and its fields leave the window with it", settledBrowserCards(CHAT).map((one) => one.id), ["c1"]);
    // **The host is what the sidecar said, and what it said is shown as it is.**
    // There is no URL parser left in this window: a second parser is a second
    // answer, and these are the answers the browser's own gave.
    equal(
      "the card names the host the sidecar parsed, with the port it named",
      [
        browserDestinationLabel({ host: "shop.example", port: null, secure: true }),
        browserDestinationLabel({ host: "shop.example", port: 8080, secure: false }),
      ],
      ["shop.example", "shop.example:8080"],
    );
    equal("and a card with no destination has no host to name", browserDestinationLabel(null), "");
    check("and what comes back is a code and a host, not a sentence", said === outcome, said);

    // **A card with no destination has no Send, and says so in one line.** The
    // sidecar refuses the press as well — the button is gone so the decision is
    // never offered, not so a refusal can catch it later.
    noteBrowserCards([NOWHERE_CARD]);
    const nowhere = currentBrowserCards().find((one) => one.id === "c0");
    check("a card with no destination arrives with none", nowhere.destination === null, JSON.stringify(nowhere.destination));
    equal("and the window draws no host for it, having none to draw", browserDestinationLabel(nowhere.destination), "");
    equal(
      "a card with no destination has no destination the sidecar did not send",
      nowhere.destination !== null ? "shown" : "none",
      "none",
    );
    // **A destination that is not one is no destination.** The window draws no
    // host it did not receive whole, whatever the frame carried.
    for (const [why, bad] of [
      ["an empty host", { host: "", port: null, secure: true }],
      ["a port no network has", { host: "shop.example", port: 70000, secure: true }],
      ["a port that is not a number", { host: "shop.example", port: "8080", secure: true }],
      ["a host that is not a string", { host: 42, port: null, secure: true }],
    ]) {
      noteBrowserCards([{ ...NOWHERE_CARD, id: "bad", destination: bad }]);
      const read = currentBrowserCards().find((one) => one.id === "bad");
      check(`and ${why} is not a destination`, read.destination === null, JSON.stringify(read.destination));
    }
    noteBrowserCards([]);

    // A second press of the same button — the card came off on the first, so
    // there is nothing to press about and nothing is sent.
    const again = await browserAnswerNow(true, "c1", CHAT);
    equal("a second press sends nothing more: one answer, one request", ANSWERS.length, 1);
    check("and the window says nothing rather than sending", again === null, String(again));

    // The line says what became of the card once the sidecar has said, and it goes
    // with the outcome, when the model has been told.
    equal("until the sidecar speaks, the line has no outcome yet", settledBrowserCards(CHAT)[0].outcome, null);
    noteBrowserAnswered({ id: "c1", conversation: CHAT, code: "sent", host: "shop.example" });
    equal("then the line says what it was, as a code and a host", settledBrowserCards(CHAT)[0].outcome, { code: "sent", host: "shop.example" });
    takeBrowserOutcomes(CHAT);
    equal("and the line goes once the model has been told", settledBrowserCards(CHAT).length, 0);
  }

  // --- what the model is told: the same line the person read -------------------
  {
    noteBrowserAnswered({ id: "c1", conversation: CHAT, code: "sent", host: "shop.example" });
    noteBrowserAnswered({ id: "c2", conversation: CHAT, code: "declined", host: "shop.example" });
    const note = takeNote(CHAT, RECAP_WORDS);
    check(
      "the outcome rides the next thing the person says, in the line the window drew",
      note.includes("1 sent to shop.example") && note.includes("1 not sent"),
      note,
    );
    check("and it repeats no field of the request", !/Bologna|password/.test(note), note);
    check(
      "and it is fenced, like any page text the model reads",
      fences(note).length === 1,
      note,
    );
    check("drained once, so it is not told again on a later turn", !takeNote(CHAT, RECAP_WORDS).includes("sent to"), takeNote(CHAT, RECAP_WORDS));
    check("with nothing said, there is nothing carried", takeNote("chat-that-did-nothing", RECAP_WORDS) === "");
  }

  // --- nothing of an address survives into the note or onto the disk ----------
  {
    // The payload a sidecar would send if the host were handed over whole: a
    // session token in the query is exactly what must not follow a request.
    noteBrowserAnswered({
      id: "c9",
      conversation: CHAT,
      code: "sent",
      host: "shop.example/checkout?token=sk-live-SECRET&next=//evil.example",
    });
    noteBrowserAnswered({ id: "c8", conversation: CHAT, code: "sent", host: "https://shop.example/order?q=1" });
    const note = takeNote(CHAT, RECAP_WORDS);
    check("a host that is really an address is not read as a host", !/shop\.example\/checkout/.test(note), note);
    check("and no query, no token and no stranger's next hop is in the note", !/SECRET|evil\.example|\?/.test(note), note);
    check(
      "and what is left is the bare host name, or nothing rather than half an address",
      note.includes("2 sent to a site") && !note.includes("shop.example"),
      note,
    );

    // A host that is one does come through, in full and alone.
    noteBrowserAnswered({ id: "c7", conversation: CHAT, code: "sent", host: "shop.example" });
    const bare = takeNote(CHAT, RECAP_WORDS);
    check("a real host is named", bare.includes("1 sent to shop.example"), bare);

    // And nothing carrying one is kept, whatever wrote it and whenever.
    // The note the app writes itself, through the same road the model reads.
    noteBrowserAnswered({ id: "c-z", conversation: "chat-note-disk", code: "sent", host: "shop.example" });
    const ourNote = takeNote("chat-note-disk", RECAP_WORDS);
    const store = createStore();
    store.put({
      id: "c1",
      title: "T",
      createdAt: 1,
      updatedAt: 1,
      messages: [
        { id: "m1", role: "user", content: "what happened?", createdAt: 1 },
        {
          id: "m2",
          role: "assistant",
          content: "",
          createdAt: 2,
          browserNote: ourNote,
        },
        {
          id: "m3",
          role: "assistant",
          content: "",
          createdAt: 3,
          browserNote: "Sent to https://shop.example/order?token=sk-live-SECRET",
        },
      ],
    });
    const disk = globalThis.localStorage.getItem("crescent-chat.msgs.c1.v2");
    check("our own note does reach the disk, so the model can still be told", disk.includes("shop.example"), disk?.slice(0, 200));
    check("a note carrying a path or a query does not", !disk.includes("SECRET"), disk?.slice(0, 300));
    const reread = createStore().get("c1").messages;
    check("and it is not there after a reload either", reread[1].browserNote !== undefined && reread[2].browserNote === undefined, JSON.stringify(reread.map((m) => m.browserNote)));
  }

  // --- a press whose answer never came back is said, not swallowed -----------
  {
    noteBrowserCards([CARD]);
    answeringFails = true;
    const said = await browserAnswerNow(true, "c1", CHAT);
    answeringFails = false;
    check("a press that could not be delivered returns nothing", said === null, String(said));
    equal("and the card is off the window anyway: there is no button that does nothing", currentBrowserCards().length, 0);
    const note = takeNote(CHAT, RECAP_WORDS);
    check(
      "but it is never swallowed: the next thing said carries that it could not be established",
      note.includes("1 cannot be accounted for"),
      note,
    );
    check("and nothing of the request is in it", !/Bologna|shop\.example/.test(note), note);
  }

  // --- a card belongs to one chat ---------------------------------------------
  {
    noteBrowserCards([CARD, { ...CARD, id: "c2", conversation: OTHER }]);
    equal("both chats' cards are held in the one window", currentBrowserCards().length, 2);

    // The press carries the chat with it, so the app refuses one that does not
    // match rather than spending an id that is not its own.
    await browserAnswerNow(true, "c1", OTHER);
    equal("and the id goes back with the chat that pressed it", ANSWERS[ANSWERS.length - 1], ["allow", "c1", OTHER]);

    noteBrowserAnswered({ id: "c1", conversation: CHAT, code: "declined", host: "" });
    check("another chat's turn is told nothing of it", !takeNote(OTHER, RECAP_WORDS).includes("not sent"), takeNote(OTHER, RECAP_WORDS));
    check(
      "and its own chat is told exactly once",
      takeNote(CHAT, RECAP_WORDS).includes("1 not sent"),
      "the note for chat A",
    );
    noteBrowserCards([]);
  }

  // --- Pausa is a control over the sidecar, not over a flag in this file ------
  {
    backendSays({ open: true, paused: false });
    PAUSES.length = 0;
    check("the browser is running to begin with", isBrowserPaused() === false, "it is");

    await browserPressPause(true);
    check("pressing Pausa tells the sidecar", PAUSES[PAUSES.length - 1] === "pause", JSON.stringify(PAUSES));
    // **And the page does not call itself paused.** It is told, by the app, once
    // the app knows what the sidecar said: a button that moved on its own press
    // is a button that can read "paused" over a browser still being driven.
    check("but the page has not moved its own flag: only the app can say it is paused", isBrowserPaused() === false);
    backendSays({ open: true, paused: true });
    check("and it is paused once the app has said so", isBrowserPaused() === true);

    // A paused browser acts no further: this is the registry's own refusal, and
    // the sidecar has the same rule behind it. **All five, the three reads as
    // well as the two writes** — a browser that still opens a page and reads
    // around inside it is a browser Kalsa is driving, and the person pressed a
    // button that says it is not. Each call is proved by the app never hearing
    // it, which is a fact and not an assumption about the sentence.
    const reached = REACHED.length;
    const every = [
      ["browser_open", { url: "https://shop.example/order" }],
      ["browser_read", {}],
      ["browser_find", { text: "order" }],
      ["browser_click", { ref: "e5" }],
      ["browser_type", { ref: "e4", text: "Bologna" }],
    ];
    for (const [name, args] of every) {
      const stopped = await attempt(name, args);
      check(`so ${name} is refused`, stopped.ok === false && /paused/i.test(stopped.text), stopped.text);
    }
    equal("and no browser call reached the app at all", REACHED.length, reached);

    await browserPressPause(false);
    check(
      "Riprendi tells the sidecar too, and reads the page as it is now",
      PAUSES[PAUSES.length - 1] === "resume",
      JSON.stringify(PAUSES),
    );
    backendSays({ open: true, paused: false });
    // Each of the five is offered again once the browser is running. The reads
    // and the writes act; **the open answers with its own refusal** — that
    // address has never appeared in a conversation, which is a different rule
    // with a different sentence — so the pause sentence above was the pause's
    // own and not this argument being refused by something else.
    const reopened = await attempt("browser_open", { url: "https://shop.example/order" });
    check(
      "and an unpaused open is refused for its own reason, not Pausa's",
      reopened.ok === false && !/paused/i.test(reopened.text) && /has not appeared/i.test(reopened.text),
      reopened.text,
    );
    const rest = every.slice(1);
    for (const [name, args] of rest) {
      const again = await attempt(name, args);
      check(`and a resumed browser acts again for ${name}`, again.ok === true, again.text);
    }
    equal(
      "and the four that can go really did reach the app this time",
      REACHED.slice(reached),
      rest.map(([name]) => `brain_browser_${name.slice("browser_".length)}`),
    );
  }

  // --- the page mirrors the app, and a session takes its pause with it -------
  {
    // **The page infers nothing.** What it draws is what the app said, so every
    // proof below moves the window the way the app says it and not by pressing
    // anything in this file.
    // What the app says after a call, for a window that is there.
    backendSays({ open: true, paused: false });
    check("a window the app opened is a window", isBrowserWindowOpen() === true);

    backendSays({ open: true, paused: true });
    check("and a pause the app took is a pause", isBrowserPaused() === true);

    // What it says when the session ends — by Stop, by the window closing, or by
    // the person quitting: no window, and the pause gone with it, because the
    // sidecar holding it died with the browser.
    backendSays({ open: false, paused: false });
    check("a session that ended is no window", isBrowserWindowOpen() === false);
    check("and its pause went with it", isBrowserPaused() === false);

    const after = await attempt("browser_read", {});
    check(
      "so the next call runs, and is not refused by a pause that is not there",
      after.ok === true && !/paused/i.test(after.text),
      after.text,
    );

    // **The read on a page's mount and the events it listens to can cross.** The
    // read leaves the app at one moment and lands at another, and a browser
    // opened or closed in between makes the older snapshot a lie in both
    // directions: applied, it hides a window that is there, or puts back one that
    // is gone. The number is what says which is later.
    backendSays({ open: true, paused: false });
    const beforeTheOpen = backendSeq - 1;
    deliver(beforeTheOpen, { open: false, paused: false });
    check(
      "a mount read from before a window opened does not hide the window",
      isBrowserWindowOpen() === true,
      `seq ${beforeTheOpen} landed after seq ${backendSeq}`,
    );

    const theOpen = backendSeq;
    backendSays({ open: false, paused: false });
    deliver(theOpen, { open: true, paused: false });
    check(
      "and a mount read from before a window closed does not put it back",
      isBrowserWindowOpen() === false,
      `seq ${theOpen} landed after seq ${backendSeq}`,
    );

    // The same for two events out of order, which is what a slow delivery looks
    // like from here.
    const later = backendSeq + 1;
    deliver(later, { open: true, paused: true });
    deliver(later - 1, { open: false, paused: false });
    check(
      "an event arriving after a later one is dropped as well",
      isBrowserWindowOpen() === true && isBrowserPaused() === true,
      `seq ${later - 1} landed after seq ${later}`,
    );
    backendSeq = later;
    backendSays({ open: false, paused: false });

    // **A webview that reloaded has heard nothing at all, and the window it was
    // driving is still there.** The one read on the mount is what puts it back —
    // which is why the app owns this rather than the page counting its own calls.
    backendWindow = { open: true, paused: true };
    await startBrowserWindowBus();
    check(
      "a page that reloaded asks the app, and finds the window that is really there",
      isBrowserWindowOpen() === true && isBrowserPaused() === true,
      JSON.stringify(backendWindow),
    );
    backendWindow = { open: false, paused: false };
    await startBrowserWindowBus();
    check("and the reload after it finds a window that is gone", isBrowserWindowOpen() === false && isBrowserPaused() === false);
    backendWindow = { open: false, paused: false };
  }

  // --- the card never hides anything, whatever the page claims ---------------
  {
    // **The page registers its exfiltrated value as "typed by the person in a
    // password field"**, which is what the value-dropping rule used to believe.
    noteBrowserCards([{
      id: "e1",
      method: "POST",
      url: "https://evil.example/collect",
      conversation: CHAT,
      fields: [
        { name: "harmless", value: "a-normal-field", secret: false },
        { name: "note", value: "the-exfiltrated-secret", secret: true },
      ],
    }]);
    const [card] = currentBrowserCards();
    const exfiltrated = card.fields.find((f) => f.name === "note");
    check(
      "a page cannot get a value off the card by calling it something",
      exfiltrated.value === "the-exfiltrated-secret",
      JSON.stringify(exfiltrated),
    );
    check("and it is only drawn as dots, with the value behind the toggle", exfiltrated.secret === true, JSON.stringify(exfiltrated));

    // **What the window draws, for a query that carries the request's data.** The
    // crate has already decided the pairs and the marks; this is that the desktop
    // reads them the way the phone does, with no step of its own between.
    noteBrowserCards([QUERY_CARD]);
    const drawn = currentBrowserCards().find((one) => one.id === "q1");
    equal(
      "the query comes as fields, after the ones the page wrote, in the order they were sent",
      drawn.fields.map((one) => one.name),
      ["colour", "msg", "token", "flag"],
    );
    check("and the value is on the card in full", drawn.fields[1].value === "Ciao Giulia", JSON.stringify(drawn.fields[1]));
    check(
      "a secret in the query is marked, as one in the body is",
      drawn.fields[2].secret === true,
      JSON.stringify(drawn.fields[2]),
    );
    check(
      "and the person can still read it, because that is what goes",
      drawn.fields[2].value === "the-real-password",
      JSON.stringify(drawn.fields[2]),
    );
    check(
      "a query pair has no words beside it, because there is no element to read them from",
      drawn.fields[1].label === null,
      JSON.stringify(drawn.fields[1]),
    );
    equal(
      "an empty value is a field the window does not draw, in the body or in the query",
      drawn.fields.filter((one) => one.value !== "").map((one) => one.name),
      ["colour", "msg", "token"],
    );
    noteBrowserCards([]);

    check(
      "what is not a secret is untouched by any of this",
      card.fields.find((f) => f.name === "harmless").value === "a-normal-field",
      JSON.stringify(card.fields),
    );
    noteBrowserCards([]);
  }

  // --- and a secret never leaves the card -------------------------------------
  {
    // The value exists in exactly one place — the card the person is reading —
    // and the round trip that follows it does not carry it anywhere: not into
    // what the model is told, and not into what the store keeps.
    noteBrowserCards([CARD]);
    await browserAnswerNow(true, "c1", CHAT);
    noteBrowserAnswered({ id: "c1", conversation: CHAT, code: "sent", host: "shop.example" });
    const note = takeNote(CHAT, RECAP_WORDS);
    check("what the model is told carries no field of the request at all", !/the-real-password|Bologna/.test(note), note);

    const store = createStore();
    store.put({
      id: "c1",
      title: "T",
      createdAt: 1,
      updatedAt: 1,
      messages: [{ id: "m1", role: "user", content: "log in", createdAt: 1, browserNote: note }],
    });
    const disk = globalThis.localStorage.getItem("crescent-chat.msgs.c1.v2") ?? "";
    check("nor does the stored history", !disk.includes("the-real-password"), disk.slice(0, 240));
    check("and a reload brings none of it back", !JSON.stringify(createStore().get("c1")).includes("the-real-password"));
  }

  console.log(fail === 0 ? "browser-confirm: all checks passed" : `browser-confirm: ${fail} failed`);
  process.exitCode = fail === 0 ? 0 : 1;
} finally {
  await rm(dir, { recursive: true, force: true });
}