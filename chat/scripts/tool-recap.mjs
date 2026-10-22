// The harness notices when the model does not act: what Kalsa did, said once at
// the end of a turn, and the ledger that stops it doing the same failing thing
// twice.
//
// Everything here goes through the app's own seams — `noteCards` and
// `noteAnswered` for what the person saw, `closeRecap`/`takeNote` for what is
// said to each of them, `filed`/`decide` for what the loop may ask again — so a
// change that would break the real turn breaks this.
//
// Run: node scripts/tool-recap.mjs   (from chat/)

import { loadApp } from "./lib/app-bundle.mjs";

let fail = 0;
function check(label, condition, detail) {
  if (!condition) fail++;
  console.log(`${condition ? "ok  " : "FAIL"} ${label}${condition || detail === undefined ? "" : `\n     ${detail}`}`);
}

// **The door the window answers a card through.** A press has to reach the
// backend for the card to come off the window, and a card that has come off is
// the only thing that stops the line saying it is still waiting.
//
// **A refusal the sidecar raised, with the stage that says where it stopped.**
// The ledger's rule is about the stage, so a refusal that carries one has to
// reach the app the way a real one does.
let refusal = null;
globalThis.window = {
  addEventListener: () => {},
  __TAURI__: {
    core: {
      invoke: async (command) => {
        if (command === "brain_browser_confirm" || command === "brain_browser_decline") return "the sidecar answered";
        if (refusal !== null && command.startsWith("brain_browser_")) throw refusal;
        throw new Error(`${command} is not on this road`);
      },
    },
  },
};

const { app } = await loadApp();
{
  const { TABLES } = app;
  const words = TABLES.en.tools.recap;
  const italian = TABLES.it.tools.recap;
  const run = (name, args, over = {}) => ({
    id: `c-${name}-${JSON.stringify(args)}`,
    name,
    arguments: JSON.stringify(args),
    result: "",
    state: "ok",
    ...over,
  });
  const runs = (...many) => many.flat();
  /** The line a person would read for these runs, in the given language. */
  const line = (list, outcomes = [], waiting = 0, t = words) => {
    const said = app.recapOf(list, outcomes, waiting);
    return said === null ? "" : app.recapLine(said, t);
  };

  // --- what Kalsa did, from its own runs ------------------------------------

  const filled = line(
    runs(
      run("browser_open", { url: "https://httpbin.org/forms/post" }),
      run("browser_type", { ref: "e1", text: "a" }),
      run("browser_type", { ref: "e2", text: "b" }),
      run("browser_type", { ref: "e3", text: "c" }),
    ),
  );
  check(
    "a form filled and left alone says what it did and that nothing was sent",
    filled.includes("written into 3 fields") && !filled.includes("sent to"),
    filled,
  );

  // **Distinct fields, not calls.** A model that types a name, looks again and
  // types it again has been into one field, and "3 fields" over a form with two
  // boxes on it is the number that makes the owner distrust the rest.
  const corrected = line(
    runs(
      run("browser_type", { ref: "e1", text: "marco" }),
      run("browser_type", { ref: "e1", text: "Marco" }),
      run("browser_type", { ref: "e2", text: "a@b.co" }),
    ),
  );
  check(
    "the same field typed twice is one field, and a failed type is none",
    corrected.includes("written into 2 fields"),
    corrected,
  );

  check(
    "a turn that promised a click and did not make one says so",
    line(runs(run("browser_open", { url: "https://httpbin.org/" }))).includes("no click"),
    line(runs(run("browser_open", { url: "https://httpbin.org/" }))),
  );

  // **A Stop in the middle of a click is not "no click".** The sidecar may
  // have pressed the button before the session was ended, so the line says the
  // one thing it can stand behind.
  const stoppedClick = line(runs(run("browser_click", { ref: "e9" }, { result: "run-stopped", state: "failed" })));
  check(
    "a click that was interrupted is said as interrupted, never as no click",
    stoppedClick.includes("click interrupted") && !stoppedClick.includes("no click"),
    stoppedClick,
  );

  const clicked = line(
    runs(
      run("browser_click", { ref: "e9" }),
      run("browser_type", { ref: "e1", text: "x" }),
      run("browser_type", { ref: "e2", text: "y" }),
      run("browser_type", { ref: "e3", text: "z" }),
      run("browser_type", { ref: "e4", text: "w" }),
    ),
  );
  check("a click and four fields are both counted", clicked.includes("clicked 1 time") && clicked.includes("written into 4 fields"), clicked);

  check(
    "a click that failed is not counted as a click",
    line(runs(run("browser_click", { ref: "e9" }, { state: "failed" }))).includes("no click"),
    line(runs(run("browser_click", { ref: "e9" }, { state: "failed" }))),
  );

  // **Where an open landed is not known from the address that was asked for.**
  // After a cross-host redirect "opened httpbin.org" would be a claim about a
  // page nobody here saw, so the line says what was asked for instead.
  const redirected = line(runs(run("browser_open", { url: "http://short.example/abcd" })));
  check(
    "an open says the host it asked for, because that is the only one it knows",
    redirected.includes("asked for short.example") && !redirected.includes("opened"),
    redirected,
  );
  check(
    "and with no address at all it says a page, inventing nothing",
    line(runs(run("browser_open", {}, { arguments: "{}" }))).includes("opened a page"),
    line(runs(run("browser_open", {}, { arguments: "{}" }))),
  );

  const stopped = line(runs(run("browser_open", { url: "https://httpbin.org/" }, { result: "run-stopped", state: "failed" })));
  check("a stopped turn says it was interrupted", stopped.includes("interrupted"), stopped);

  // **A picture is a read of the page, and the line says the page was read.**
  // The open brought the page with it and the model read the page afterwards:
  // two reads of one page, and the line says two — in the words the owner
  // reads and in the words the model reads.
  const readTwice = runs(
    run("browser_open", { url: "https://shop.example/dp/1" }, { picture: true }),
    run("browser_read", { page: 1 }),
  );
  check(
    "the line says the page was read, and how many times",
    line(readTwice).includes("read the page 2 times"),
    line(readTwice),
  );
  check(
    "and the model's record says the same number",
    app.turnRecord(readTwice).includes("read 2 times"),
    app.turnRecord(readTwice),
  );
  check(
    "and the line says it in Italian too",
    line(readTwice, [], 0, italian).includes("letto la pagina 2 volte"),
    line(readTwice, [], 0, italian),
  );
  check(
    "a turn that only read the page still says something",
    line(runs(run("browser_read", { page: 1 }))).includes("read the page 1 time"),
    line(runs(run("browser_read", { page: 1 }))),
  );

  check("a turn that used no browser tool says nothing", line([]) === "");

  // --- what became of the requests ------------------------------------------

  const held = line(runs(run("browser_click", { ref: "e9" })), [], 1);
  check(
    "a request held for the person is said as waiting, not as sent",
    held.includes("1 waiting for your answer") && !/sent to/.test(held),
    held,
  );

  const sent = line(runs(run("browser_click", { ref: "e9" })), [{ code: "sent", host: "httpbin.org" }]);
  check("and a request that went says where it went", sent.includes("1 sent to httpbin.org"), sent);

  // **Every code has its own words, and a mixed answer shows all of them.** One
  // send over a card that was refused is two facts, and "sent" alone would be a
  // lie about the other half.
  const mixed = line(runs(run("browser_click", { ref: "e9" })), [
    { code: "sent", host: "httpbin.org" },
    { code: "declined", host: "" },
  ]);
  check(
    "a mixed answer shows both halves",
    mixed.includes("1 sent to httpbin.org") && mixed.includes("1 not sent"),
    mixed,
  );

  const everyCode = app.BROWSER_CODES;
  const outcomeCopy = (code) => {
    const said = line(runs(run("browser_click", { ref: "e9" })), [{ code, host: "" }], 0);
    return said.replace("Kalsa did: ", "");
  };
  check(
    "each outcome code says something of its own",
    ["sent", "declined", "expired", "gone", "unsendable", "unclear"].every(
      (code) => new Set(["sent", "declined", "expired", "gone", "unsendable", "unclear"].map(outcomeCopy)).size === 6,
    ),
    ["sent", "declined", "expired", "gone", "unsendable", "unclear"].map((code) => `${code}: ${outcomeCopy(code)}`).join("\n     "),
  );

  const many = line(
    runs(run("browser_click", { ref: "e9" })),
    [{ code: "sent", host: "a.example" }, { code: "sent", host: "b.example" }, { code: "sent", host: "c.example" }],
  );
  check("three sends to three sites name two and count the rest", many.includes("3 sent to a.example, b.example +1"), many);
  check("and every code has words, not a fallback", everyCode.length > 0);

  // --- five tables, one set of facts ----------------------------------------

  const inItalian = line(
    runs(run("browser_open", { url: "https://httpbin.org/forms/post" }), run("browser_type", { ref: "e1", text: "a" })),
    [{ code: "sent", host: "httpbin.org" }],
    1,
    italian,
  );
  check(
    "the line is said in Italian too, and Kalsa is the one who did it",
    inItalian.startsWith("Kalsa ha:") &&
      inItalian.includes("richiesto httpbin.org") &&
      inItalian.includes("scritto in 1 campo") &&
      inItalian.includes("1 invio in attesa della tua risposta") &&
      inItalian.includes("1 inviato a httpbin.org"),
    inItalian,
  );

  // --- the line the window draws, and the note the model reads ---------------

  const CHAT = "chat-recap";
  app.noteBrowserCards([
    { id: "card-1", method: "POST", url: "https://httpbin.org/post", conversation: CHAT, fields: [] },
    { id: "card-2", method: "POST", url: "https://other.example/x", conversation: CHAT, fields: [] },
    { id: "card-3", method: "POST", url: "https://elsewhere.example/y", conversation: "another-chat", fields: [] },
  ]);
  check(
    "a request held for this chat is counted as waiting, and another's is not",
    line([], [], app.currentBrowserCards().filter((c) => c.conversation === CHAT).length).includes("2 waiting for your answer"),
    app.currentBrowserCards().map((c) => c.conversation).join(","),
  );

  const filledRuns = runs(
    run("browser_open", { url: "https://httpbin.org/forms/post" }),
    run("browser_type", { ref: "e1", text: "a" }),
  );
  app.sayRuns(CHAT, filledRuns);
  const drawn = app.closeRecap(CHAT, filledRuns);
  check(
    "the turn's line counts the card the person has not answered yet",
    drawn !== null && drawn.waiting === 2,
    JSON.stringify(drawn),
  );

  // The person answers while nobody is asking anything: a press, then the word
  // the sidecar sends back about it.
  await app.browserAnswerNow(true, "card-1", CHAT);
  app.noteBrowserAnswered({ id: "card-1", conversation: CHAT, code: "sent", host: "httpbin.org" });
  await app.browserAnswerNow(false, "card-2", CHAT);
  app.noteBrowserAnswered({ id: "card-2", conversation: CHAT, code: "declined", host: "" });

  const note = app.takeNote(CHAT, words);
  check(
    "the note is built when the next turn starts, and says what is true then",
    note.includes("1 sent to httpbin.org") && note.includes("1 not sent") && !note.includes("waiting for your answer"),
    note,
  );
  check(
    "and it is fenced, because it names a host",
    app.fences(note).length === 1 && note.includes("httpbin.org"),
    note,
  );
  // **The answers are reported as waiting, not as still waiting.** Rust answers
  // an answered card off the window on its next card list, and this is that list.
  app.noteBrowserCards([{ id: "card-3", method: "POST", url: "https://elsewhere.example/y", conversation: "another-chat", fields: [] }]);
  check("an outcome is told to the model once, and once only", app.takeNote(CHAT, words) === "");

  // **The person still has to be told.** The drain above belongs to the model,
  // and the next line the window draws carries the same answers.
  const nextTurn = runs(run("browser_open", { url: "https://httpbin.org/next" }));
  app.sayRuns(CHAT, nextTurn);
  const drawnNext = app.closeRecap(CHAT, nextTurn);
  check(
    "a send the model was told about is still drawn for the person",
    drawnNext !== null && drawnNext.sent === 1 && drawnNext.declined === 1,
    JSON.stringify(drawnNext),
  );
  check("and the answers are not drawn a second time", app.closeRecap(CHAT, []) === null, JSON.stringify(app.closeRecap(CHAT, [])));

  // **The window's own line never counts a card as waiting that was answered
  // before it was drawn.**
  const answeredFirst = "chat-answered";
  app.noteBrowserCards([{ id: "card-a", method: "POST", url: "https://x.example/1", conversation: answeredFirst, fields: [] }]);
  await app.browserAnswerNow(true, "card-a", answeredFirst);
  app.noteBrowserAnswered({ id: "card-a", conversation: answeredFirst, code: "sent", host: "x.example" });
  const afterAnswer = app.closeRecap(answeredFirst, runs(run("browser_open", { url: "https://x.example/" })));
  check(
    "a request answered before the turn ended is a send, not something still waiting",
    afterAnswer !== null && afterAnswer.waiting === 0 && afterAnswer.sent === 1,
    JSON.stringify(afterAnswer),
  );

  // **A chat that ran no browser call still has its answers delivered** — the
  // note is not behind the browser runs.
  const quiet = "chat-quiet";
  app.noteBrowserAnswered({ id: "card-9", conversation: quiet, code: "expired", host: "" });
  const quietNote = app.takeNote(quiet, words);
  check("a turn with no browser run still tells the model what became of a request", quietNote.includes("1 expired without an answer"), quietNote);

  app.noteBrowserCards([]);
  app.noteBrowserAnswered({ id: "card-3", conversation: "another-chat", code: "sent", host: "elsewhere.example" });
  check("another chat's answers are its own", app.takeNote("another-chat", words).includes("1 sent to elsewhere.example"));
  check("and never leak into a chat that caused nothing", app.takeNote("chat-nothing", words) === "");

  // --- the ledger: what the turn already knows ------------------------------

  const { newLedger, decide, filed, actionKey } = app;
  const led = newLedger();

  check("a call that has never run is run", decide(led, "browser_open", { url: "https://httpbin.org/" }).run === true);

  filed(led, "browser_open", { url: "https://httpbin.org/" }, { text: "the page", ok: true });
  const sameRound = decide(led, "browser_open", { url: "https://httpbin.org/" });
  check(
    "the same call twice in a round reuses the answer it already has",
    sameRound.run === false && sameRound.code === "browser.already_run" && sameRound.answer === "the page",
    JSON.stringify(sameRound),
  );

  // **A read is a question about the page as it is now.** The page changes on
  // its own — a banner arrives, a page refreshes itself — so a read is asked
  // again, and each one spends a step of the turn's budget.
  filed(led, "browser_read", { page: 1 }, { text: "the form", ok: true });
  check("a read is asked again rather than reused", decide(led, "browser_read", { page: 1 }).run === true);
  check("and it spent a step of the budget", led.spent === 2, String(led.spent));
  filed(led, "browser_type", { ref: "e1", text: "a" }, { text: "typed", ok: true });
  check(
    "and is asked again once anything has moved the page",
    decide(led, "browser_read", { page: 1 }).run === true,
  );
  filed(led, "browser_read", { page: 1 }, { text: "the same form", ok: true });
  check("and asked again in the round after that", decide(led, "browser_read", { page: 1 }).run === true);
  filed(led, "browser_click", { ref: "e9" }, { text: "clicked", ok: true });
  check("a click opens the next round too", decide(led, "browser_read", { page: 1 }).run === true);

  // **A read that failed may be asked again.** The failure was about the page as
  // it was, and a read of the page as it is now may well answer.
  const failedRead = newLedger();
  filed(failedRead, "browser_read", { page: 1 }, { text: "no", ok: false, resultCode: "browser.element_gone" });
  check("a read that failed is asked again", decide(failedRead, "browser_read", { page: 1 }).run === true);
  check("it did spend its step, so the bound still bites", failedRead.spent === 1, String(failedRead.spent));

  // **A duplicate within the round it happened in is still a duplicate.**
  const dup = newLedger();
  filed(dup, "browser_click", { ref: "e9" }, { text: "clicked", ok: true });
  check(
    "the same click asked twice in one round reuses its answer",
    decide(dup, "browser_click", { ref: "e9" }).run === false,
  );

  // **The fragment is part of the address.** Two anchors on one page are two
  // places, and calling them the same action would leave the model at the first.
  check(
    "an address's fragment is part of the call, not dropped from it",
    actionKey("browser_open", { url: "https://httpbin.org/#form" }) !== actionKey("browser_open", { url: "https://httpbin.org/" }),
  );
  check(
    "and the order the model wrote the properties in is not part of it",
    actionKey("browser_type", { text: "a b", ref: "e1" }) === actionKey("browser_type", { ref: "e1", text: "a b" }),
  );
  check(
    "a space is a keystroke, so the text is not trimmed",
    actionKey("browser_type", { ref: "e1", text: " a" }) !== actionKey("browser_type", { ref: "e1", text: "a" }),
  );

  // **No automatic retry of a failure that will happen the same way.**
  const dead = newLedger();
  filed(dead, "browser_click", { ref: "e9" }, { text: "no such element", ok: false, resultCode: "browser.element_gone" });
  const again = decide(dead, "browser_click", { ref: "e9" });
  check(
    "an action that failed is not run again in the same turn",
    again.run === false && again.code === "browser.deterministic",
    JSON.stringify(again),
  );
  check("another element on the same page is still allowed", decide(dead, "browser_click", { ref: "e10" }).run === true);

  // **A busy browser is not a dead one.** The next call is very likely to work,
  // and a refusal that outlived the reason is a refusal with no cause on screen.
  const busy = newLedger();
  filed(busy, "browser_read", { page: 1 }, { text: "busy", ok: false, resultCode: "browser.busy" });
  const afterBusy = decide(busy, "browser_read", { page: 1 });
  check("a busy browser is not remembered as dead", afterBusy.run === true, JSON.stringify(afterBusy));
  check("it did spend its step, so the bound still bites", busy.spent === 1, String(busy.spent));
  for (const code of ["browser.paused", "browser.stopped"]) {
    const one = newLedger();
    filed(one, "browser_click", { ref: "e9" }, { text: "no", ok: false, resultCode: code });
    check(`${code} is not remembered either`, decide(one, "browser_click", { ref: "e9" }).run === true);
  }

  // **A read the driver did not answer, after an open, is asked again.** The
  // open reached the page and the read is what failed: the same open a moment
  // later can answer, and nothing happened on the page that a retry would
  // repeat. The stage is what says so — the sidecar raises its refusals with
  // no code of their own, so the code alone cannot.
  const driver = newLedger();
  filed(driver, "browser_open", { url: "https://shop.example/" }, { text: "the page did not answer that call; try again", ok: false, resultCode: "browser.refused", stage: "read_driver" });
  const afterDriver = decide(driver, "browser_open", { url: "https://shop.example/" });
  check("a read the driver did not answer is asked again", afterDriver.run === true, JSON.stringify(afterDriver));
  check("and it spent its step, so the bound still bites", driver.spent === 1, String(driver.spent));

  // **The page the open reached is a new page.** The failed open is not
  // remembered — the retry must not find an "already run" from the page before
  // it — and what the last round read no longer says anything about the page
  // the window is on now.
  const moved = newLedger();
  filed(moved, "browser_click", { ref: "e9" }, { text: "clicked", ok: true });
  filed(moved, "browser_open", { url: "https://shop.example/" }, { text: "the page did not answer that call; try again", ok: false, resultCode: "browser.refused", stage: "read_driver" });
  check("the click of the page before is not answered from that page", decide(moved, "browser_click", { ref: "e9" }).run === true);
  check("and the open that failed is not remembered as run", decide(moved, "browser_open", { url: "https://shop.example/" }).run === true);

  // **An element the page never printed is dead.** It fails the same way the
  // second time, and the ledger says so.
  const unprinted = newLedger();
  filed(unprinted, "browser_click", { ref: "e9" }, { text: "that element is not one this page printed", ok: false, resultCode: "browser.refused", stage: "ref_unprinted" });
  const afterUnprinted = decide(unprinted, "browser_click", { ref: "e9" });
  check("an element the page never printed is not asked again", afterUnprinted.run === false && afterUnprinted.code === "browser.deterministic", JSON.stringify(afterUnprinted));

  // **An address the conversation never saw is dead too.** It is not the read
  // the driver did not answer, so the open that named it is not asked again.
  const unseen = newLedger();
  filed(unseen, "browser_open", { url: "https://unseen.example/" }, { text: "that address has not appeared in the conversation", ok: false, resultCode: "browser.refused", stage: "read_unseen" });
  const afterUnseen = decide(unseen, "browser_open", { url: "https://unseen.example/" });
  check("an address the conversation never saw is not asked again", afterUnseen.run === false && afterUnseen.code === "browser.deterministic", JSON.stringify(afterUnseen));

  // **An action the driver did not answer is not asked again.** The click may
  // already have happened, and a second click is a second action and not a
  // retry: the refusal says so, and tells the model to read the page instead.
  const acted = newLedger();
  filed(acted, "browser_click", { ref: "e9" }, { text: "the page did not answer that call; try again", ok: false, resultCode: "browser.refused", stage: "read_driver" });
  const afterAction = decide(acted, "browser_click", { ref: "e9" });
  check("an action the driver did not answer is not asked again", afterAction.run === false && afterAction.code === "browser.deterministic", JSON.stringify(afterAction));
  check("and the refusal it gets carries the stage", afterAction.stage === "read_driver", JSON.stringify(afterAction));

  // **And the sentence the model reads says to read the page.** The click may
  // have happened and the model does not know what it did, so the sentence
  // tells it to look, and not to do the thing a second time.
  {
    refusal = { code: "browser.refused", text: "the page did not answer that call; try again", stage: "read_driver" };
    const calls = newLedger();
    const ask = async () =>
      app.executeToolCall(
        "browser_click",
        { ref: "e9" },
        undefined,
        null,
        [{ role: "user", content: "click the first thing" }],
        "any-model",
        undefined,
        undefined,
        true,
        "stage-aware",
        calls,
      );
    const first = await ask();
    filed(calls, "browser_click", { ref: "e9" }, { text: first.text, ok: first.ok, resultCode: first.resultCode, stage: first.stage });
    const second = await ask();
    check("the second click is refused", second.ok === false, second.text);
    check("and it says to read the page, not to click again", second.text.includes("browser_read") && second.text.includes("do not do it again"), second.text);
    refusal = null;
  }

  // **A refusal that never reached the browser spends nothing.** The switch is
  // off, the person paused, the turn is out of budget: none of those is a step
  // towards a page, and none of them should stand in the way of the attempt.
  const local = newLedger();
  filed(local, "browser_click", { ref: "e9" }, { text: "web off", ok: false, resultCode: "web.switch_off" });
  check("a refusal raised before the browser spends nothing", local.spent === 0, String(local.spent));
  check("and does not lock the call out", decide(local, "browser_click", { ref: "e9" }).run === true);

  // **An ordinary form is six calls, not five.** A bound that refuses it is a
  // bound wearing a plan's clothes.
  const budget = newLedger();
  for (let at = 0; at < app.BROWSER_CALLS_PER_TURN; at += 1) {
    filed(budget, "browser_click", { ref: `e${at}` }, { text: "ok", ok: true });
  }
  const overBudget = decide(budget, "browser_click", { ref: "e99" });
  check("the call after the bound is refused", overBudget.run === false && overBudget.code === "browser.too_many_steps", JSON.stringify(overBudget));
  check("and the bound is an ordinary form's worth of calls", app.BROWSER_CALLS_PER_TURN >= 8, String(app.BROWSER_CALLS_PER_TURN));

  // --- the codes are a closed set, and copy is looked up by them -------------

  check("a code from the wire is one of ours", app.browserCode("browser.element_gone") === "browser.element_gone");
  check(
    "and a word nobody here knows is a refusal, not a stranger's name on the window",
    app.browserCode("page.weird_internal_thing") === "browser.refused",
    app.browserCode("page.weird_internal_thing"),
  );
  check(
    "every code has words in every table",
    app.BROWSER_CODES.every((code) => app.browserCodeWords(code, words) !== "" && app.browserCodeWords(code, italian) !== ""),
  );
  check(
    "and the person's words are never the sentence the tool carried",
    app.browserCodeWords("browser.invalid", words) !== "The form would not let it go. nothing was sent",
  );
  check("a refusal by the browser is deterministic", app.isDeterministic("browser.refused"));
  check("but being busy is not", !app.isDeterministic("browser.busy"));

  // --- the phone's turn: the line goes out, and the model reads it -----------

  const PHONE = app.phoneConversation("dev-1");
  app.sayRuns(PHONE, runs(run("browser_open", { url: "https://shop.example/" })));
  app.noteBrowserCards([{ id: "card-p", method: "POST", url: "https://shop.example/cart", conversation: PHONE, fields: [] }]);
  const out = [];
  let seen = null;
  await app.runPhoneTurn(
    { messages: [{ role: "user", content: "compila il modulo" }], replyFor: null, language: "it", device: "dev-1" },
    { endpoint: "http://127.0.0.1:1", token: "", model: "gemma-4-E4B-it", webTools: false },
    {
      reasoning: () => {},
      delta: () => {},
      toolRun: () => {},
      read: () => {},
      recap: (line) => out.push(line),
      done: () => {},
      fail: (code) => out.push(`FAILED ${code}`),
    },
    new AbortController().signal,
    false,
    {
      loop: async (options) => {
        seen = options.messages;
        options.onToolRun({ id: "p1", name: "browser_click", arguments: '{"ref":"e9"}', result: "", state: "ok" });
      },
      facts: async () => ({ nctx: 4096, modalities: { vision: false, audio: false }, chatTemplate: "" }),
    },
  );
  check("the phone is told what Kalsa did, on every ending", out.length === 1 && out[0].startsWith("Kalsa ha:"), out.join("\n"));
  check(
    "and the same line reaches the model as a message it reads, not a rider",
    Array.isArray(seen) && seen.at(-1).role === "user" && seen.at(-1).content.includes("Kalsa ha:"),
    JSON.stringify(seen?.at(-1)),
  );
  check("fenced there too, because it names a site", app.fences(String(seen?.at(-1)?.content ?? "")).length === 1, String(seen?.at(-1)?.content));
  app.noteBrowserCards([]);

  // --- the record on disk ---------------------------------------------------

  const stored = app.createStore();
  const chatId = "chat-disk";
  const recap = {
    opened: 1,
    asked: "httpbin.org",
    typed: 2,
    clicked: 1,
    tried: true,
    clickInterrupted: false,
    waiting: 0,
    sent: 1,
    declined: 0,
    expired: 0,
    gone: 0,
    unsendable: 0,
    unclear: 0,
    sentTo: ["httpbin.org"],
    stopped: false,
  };
  stored.put({
    id: chatId,
    title: "t",
    createdAt: 0,
    updatedAt: 0,
    messages: [
      {
        id: "m1",
        role: "assistant",
        content: "",
        createdAt: 0,
        toolRuns: [{ id: "r1", name: "browser_click", arguments: '{"ref":"e9"}', result: "the page", state: "ok", recap }],
      },
    ],
  });
  const onDisk = app.forDisk(stored.get(chatId).messages);
  const kept = onDisk[0].toolRuns[0];
  check("the host is not on the disk, like the arguments are not", kept.arguments === "" && kept.recap.asked === "" && kept.recap.sentTo.length === 0, JSON.stringify(kept.recap));
  check("but the counts are, so a reloaded chat still says what it did", kept.recap.opened === 1 && kept.recap.sent === 1 && kept.recap.typed === 2);
  check(
    "and it words itself for the site it was never told",
    app.recapLine(kept.recap, words).includes("1 sent to a site"),
    app.recapLine(kept.recap, words),
  );

  // **The disk is data, not a record.** A code nothing here wrote must not come
  // back off it and be looked up on the window.
  stored.put({
    id: chatId,
    title: "t",
    createdAt: 0,
    updatedAt: 0,
    messages: [
      {
        id: "m1",
        role: "assistant",
        content: "",
        createdAt: 0,
        toolRuns: [
          { id: "r1", name: "browser_click", arguments: "{}", result: "", state: "failed", resultCode: "browser.who_knows" },
          { id: "r2", name: "browser_click", arguments: "{}", result: "", state: "failed", resultCode: "browser.element_gone" },
        ],
      },
    ],
  });
  const readBack = stored.get(chatId).messages[0].toolRuns;
  check("a code nobody here wrote does not survive the disk", readBack[0].resultCode === undefined, JSON.stringify(readBack[0]));
  check("and one of ours does", readBack[1].resultCode === "browser.element_gone");
}

console.log(fail === 0 ? "\nOK — the harness notices" : `\n${fail} FAILURES`);
process.exit(fail === 0 ? 0 : 1);