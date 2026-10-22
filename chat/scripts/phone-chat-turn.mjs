// The phone chat's turn, driven through the real modules: request parsing, the
// wire a phone turn sends, and the events one turn makes from a fake loop.
// The mail read and the runner are in phone-chat-runner.mjs.
//
// Run: node scripts/phone-chat-turn.mjs   (from chat/)

import { createServer } from "node:http";
import {
  BROWSER_CARD,
  BROWSER_OUTCOME,
  CARDS,
  DRAFT,
  MAIL_OFF,
  MAIL_ON,
  bridge,
  NOW,
  PHONE,
  SETTINGS,
  USER,
  check,
  equal,
  facts,
  fakeLoop,
  recorder,
  summary,
  terminals,
  turnOf,
  withPhone,
} from "./lib/phone-harness.mjs";

function requests(app) {
  console.log("\n# request parsing");
  const { readPhoneRequest, requestIdOf } = app;
  equal(
    "a turn parses with its reply and language",
    readPhoneRequest({ request: "r1", kind: "turn", mail: true, turn: { messages: [USER("hi")], reply_for: "105", language: "it" } }),
    { request: "r1", mail: true, device: null, body: { kind: "turn", turn: { messages: [USER("hi")], replyFor: "105", language: "it", device: null } } },
  );
  equal(
    "a payload that says nothing about the mailbox reads as closed",
    readPhoneRequest({ request: "r3", kind: "turn", turn: { messages: [USER("hi")] } }),
    { request: "r3", mail: false, device: null, body: { kind: "turn", turn: { messages: [USER("hi")], replyFor: null, language: "en", device: null } } },
  );
  equal(
    "the device comes from beside the turn, which the app put there from the credential",
    readPhoneRequest({ request: "r4", device: "2", kind: "turn", turn: { messages: [USER("hi")], language: "en" } }),
    { request: "r4", mail: false, device: "2", body: { kind: "turn", turn: { messages: [USER("hi")], replyFor: null, language: "en", device: null } } },
  );
  equal(
    "and a turn that names another phone in its body cannot move it",
    readPhoneRequest({ request: "r6", device: "2", mail: true, kind: "turn", turn: { messages: [USER("hi")], language: "en", device: "7" } }),
    { request: "r6", mail: true, device: "2", body: { kind: "turn", turn: { messages: [USER("hi")], replyFor: null, language: "en", device: null } } },
    "the body's number is read by nobody: the app's own is the only one that reaches the turn",
  );
  equal(
    "a device that is not a number is no device at all",
    readPhoneRequest({ request: "r5", kind: "turn", turn: { messages: [USER("hi")] }, device: "phone:2" }).device,
    null,
  );
  equal(
    "a turn without reply or language defaults to no mail and English",
    readPhoneRequest({ request: "r2", kind: "turn", turn: { messages: [USER("hi")] } }).body.turn,
    { messages: [USER("hi")], replyFor: null, language: "en", device: null },
  );
  const bad = [
    ["no kind", { request: "b1", turn: { messages: [USER("x")] } }],
    ["unknown role", { request: "b2", kind: "turn", turn: { messages: [{ role: "system", content: "x" }] } }],
    ["content is not text", { request: "b3", kind: "turn", turn: { messages: [{ role: "user", content: [{ type: "text", text: "x" }] }] } }],
    ["ends on the model's words", { request: "b4", kind: "turn", turn: { messages: [USER("x"), { role: "assistant", content: "y" }] } }],
    ["reply_for not digits", { request: "b5", kind: "turn", turn: { messages: [USER("x")], reply_for: "10a" } }],
    ["reply_for a number", { request: "b6", kind: "turn", turn: { messages: [USER("x")], reply_for: 105 } }],
    ["language fr", { request: "b7", kind: "turn", turn: { messages: [USER("x")], language: "fr" } }],
    ["201 messages", { request: "b8", kind: "turn", turn: { messages: Array.from({ length: 201 }, () => USER("x")) } }],
    ["no messages", { request: "b9", kind: "turn", turn: { messages: [] } }],
  ];
  for (const [label, payload] of bad) {
    const envelope = readPhoneRequest(payload);
    check(`bad payload is answered, not parsed: ${label}`, envelope !== null && envelope.body === null, JSON.stringify(envelope));
  }
  check("a payload with no id is dropped", readPhoneRequest({ kind: "turn" }) === null && readPhoneRequest(null) === null);
  check("an empty id is dropped", readPhoneRequest({ request: "", kind: "read", read: { id: "1" } }) === null);
  check("the stop's id is read", requestIdOf({ request: "s1" }) === "s1" && requestIdOf({}) === null);
}

function wire(app) {
  console.log("\n# the wire");
  const convo = [USER("che mail ho?"), { role: "assistant", content: "Due." }, USER("rispondi al primo")];
  const plain = app.phoneWire(turnOf(convo), { vision: false, think: false, nctx: 8192 }, NOW);
  // The phone is offered no mini app and draws none, so its prompt is the
  // desktop's own minus the two sentences about building one — every other byte
  // is the desktop's, or the engine's cache would prefill two prompts.
  //
  // **And the browse sentence goes too**: the phone has no control to arm the
  // browser with, so a sentence about a control it cannot show would name a
  // thing that is not there. It is the same rule as the mini app's, and it
  // costs the prompt the same bytes.
  const desktop = app.systemPrompt(false, false).content;
  const withoutMiniapp = desktop.replace(
    /Use create_miniapp[^.]*\. |Miniapps \(a table, calculator, quiz or checklist\) open inline in the chat\. /g,
    "",
  );
  const withoutBrowse = withoutMiniapp.replace(/A Browse for me \(Naviga per me\) control sits in the message box:.*?asked for\. /s, "");
  equal("the system message is the desktop's own prompt, without the mini app and browse sentences", plain.wire[0], {
    role: "system",
    content: withoutBrowse,
  });
  check(
    "the phone's prompt names no mini app",
    !plain.wire[0].content.includes("create_miniapp") && !plain.wire[0].content.includes("Miniapps ("),
    JSON.stringify(plain.wire[0].content.slice(0, 200)),
  );
  equal("only the last words carry the send date", plain.wire.slice(1).map((m) => m.content), [
    "che mail ho?",
    "Due.",
    `rispondi al primo\n\nSent on ${app.sentDatePhrase(NOW)}.`,
  ]);
  const reply = app.phoneWire(turnOf(convo, { replyFor: "105", language: "it" }), { vision: false, think: false, nctx: 8192 }, NOW);
  equal("a reply pins the last words to its mail, in the phone's language", reply.wire.at(-1).content, [
    app.TABLES.it.mail.askDraftNote("105"),
    `rispondi al primo\n\nSent on ${app.sentDatePhrase(NOW)}.`,
  ].join("\n\n"));
  check(
    "vision follows the engine's answer",
    app.phoneWire(turnOf(convo), { vision: true, think: false, nctx: null }, NOW).wire[0].content.includes(
      "Images the user attaches reach you as images",
    ),
  );
  equal("an unknown window leaves the wire unpruned", app.phoneWire(turnOf(convo), { vision: false, think: false, nctx: null }, NOW).status, "ok");
}

async function turns(app) {
  console.log("\n# the turn and its events");
  const abortable = () => new AbortController().signal;
  {
    const { loop, seen } = fakeLoop(async (o) => {
      o.outcome = await o.runTool("mail_draft", { reply_to_id: "999", body: "x" }, o.signal, o.messages);
    });
    const { log, sink } = recorder(app);
    await app.runPhoneTurn(turnOf([USER("rispondi")], { replyFor: "105" }), SETTINGS, sink, abortable(), MAIL_ON, { loop, facts: facts() });
    check("a reply turn passes its mail to the loop's draft check", seen.options.messages.at(-1).content.startsWith(app.TABLES.en.mail.askDraftNote("105")));
    check(
      "a draft for another mail is refused by the turn's pin",
      seen.options.outcome?.ok === false && seen.options.outcome.text.includes("this turn is for the mail with id 105"),
      JSON.stringify(seen.options.outcome),
    );
    equal("a finished turn ends with one done", log.at(-1), ["done", {}]);
  }
  {
    // **The phone never takes a picture.** The phone's turn carries no gate, so
    // a picture asked for by hand is refused at the call, and the open that
    // would bring one brings none: the browser is never asked for a picture on
    // a phone, by either road.
    const { loop, seen } = fakeLoop(async (o) => {
      o.shot = await o.runTool("browser_screenshot", {}, o.signal, o.messages);
      o.opened = await o.runTool("browser_open", { url: "https://shop.example/dp/1" }, o.signal, o.messages);
    });
    const { sink } = recorder(app);
    await app.runPhoneTurn(
      turnOf([USER("apri https://shop.example/dp/1 e fai una foto")]),
      SETTINGS,
      sink,
      abortable(),
      MAIL_ON,
      { loop, facts: facts() },
    );
    check(
      "a picture asked for by hand is refused on a phone",
      seen.options.shot?.ok === false,
      JSON.stringify(seen.options.shot),
    );
    check(
      "and the open brings no picture",
      seen.options.opened?.image === undefined,
      JSON.stringify(seen.options.opened),
    );
    check(
      "and the browser was never asked for one",
      !bridge.calls.some((call) => call.command === "brain_browser_screenshot"),
      bridge.calls.map((call) => call.command).join(", "),
    );
  }
  {
    const { loop, seen } = fakeLoop(async () => {});
    const { sink } = recorder(app);
    await app.runPhoneTurn(turnOf([USER("x")]), SETTINGS, sink, abortable(), MAIL_ON, { loop, facts: facts() });
    const names = seen.options.tools.map((t) => t.function.name);
    check(
      "the tools are the desktop's, without create_miniapp",
      !names.includes("create_miniapp") && names.includes("web_search") && names.includes("mail_list"),
      JSON.stringify(names),
    );
  }
  {
    // The switch is off for this phone: the whole mailbox goes, `mail_show`
    // with it, because that one draws the cards on this computer. What the
    // phone can still do stays — refusing mail is not refusing the turn.
    const { loop, seen } = fakeLoop(async () => {});
    const { log, sink } = recorder(app);
    await app.runPhoneTurn(turnOf([USER("fammi vedere le mail")]), SETTINGS, sink, abortable(), MAIL_OFF, {
      loop,
      facts: facts(),
    });
    const names = seen.options.tools.map((t) => t.function.name);
    check(
      "a phone switched off the mailbox is offered none of it",
      ["mail_list", "mail_read", "mail_draft", "mail_show"].every((name) => !names.includes(name)),
      JSON.stringify(names),
    );
    check(
      "and keeps the tools it was always offered",
      names.includes("web_search") && !names.includes("create_miniapp"),
      JSON.stringify(names),
    );
    equal("the turn itself still answers", log.at(-1), ["done", {}]);
  }
  {
    const { loop } = fakeLoop(async (o) => {
      o.onToolRun({ id: "0-c1", name: "mail_list", arguments: "{}", result: "", state: "running" });
      o.onToolRun({ id: "0-c1", name: "mail_list", arguments: "{}", result: "1 mail", state: "ok", mail: CARDS });
      o.onToolRun({ id: "0-c1", name: "mail_list", arguments: "{}", result: "1 mail", state: "ok", mail: CARDS });
      o.onToken("Ecco.");
    });
    const { log, sink } = recorder(app);
    await app.runPhoneTurn(turnOf([USER("mail")]), SETTINGS, sink, abortable(), MAIL_ON, { loop, facts: facts() });
    // A repeated report re-sends its row (the state is the same), never a second card set.
    // The cards follow the answer that introduces them, as on the desktop: the
    // phone draws them under the first word, and a turn with no word at all
    // still sends them before its terminal frame.
    equal("a tool run with cards is a tool_run, then the cards once the answer starts", log, [
      ["tool_run", { id: "0-c1", name: "mail_list", state: "running" }],
      ["tool_run", { id: "0-c1", name: "mail_list", state: "ok" }],
      ["tool_run", { id: "0-c1", name: "mail_list", state: "ok" }],
      ["delta", { text: "Ecco." }],
      ["cards", CARDS],
      ["done", {}],
    ]);
    // Every field of a card and of its labels is one word, so the cards frame
    // has no camelCase to fix — the read frame's `threadIds` was the only one.
    const keys = Object.keys(CARDS).concat(Object.keys(CARDS.items[0]), Object.keys(CARDS.items[0].labels));
    check("the cards frame is snake_case already", !keys.some((key) => /[A-Z]/.test(key)), keys.join(", "));
  }
  {
    const { loop } = fakeLoop(async (o) => {
      o.onToolRun({ id: "0-d1", name: "mail_draft", arguments: "{}", result: "Draft written.", state: "ok", mail: DRAFT });
    });
    const { log, sink } = recorder(app);
    await app.runPhoneTurn(turnOf([USER("rispondi")], { replyFor: "105" }), SETTINGS, sink, abortable(), MAIL_ON, { loop, facts: facts() });
    equal("a draft is sent in the protocol's snake_case, with no send", log[1], [
      "draft",
      { reply_to_id: "105", to: "ann@example.com", to_name: "", subject: "Re: Hi", body: "Ciao" },
    ]);
  }
  {
    const { loop } = fakeLoop(async () => {});
    const { log, sink } = recorder(app);
    await app.runPhoneTurn(turnOf([USER("x")]), SETTINGS, sink, abortable(), MAIL_ON, { loop, facts: facts() });
    sink.fail("engine");
    sink.delta("late");
    check("exactly one terminal event, and nothing after it", terminals(log) === 1 && log.length === 1, JSON.stringify(log));
  }
  {
    // A turn whose answer never arrives must still deliver the cards: the
    // phone's frames are one way, so a held card is only ever held until the
    // turn's terminal frame, never dropped.
    const { loop } = fakeLoop(async (o) => {
      o.onToolRun({ id: "0-c1", name: "mail_list", arguments: "{}", result: "1 mail", state: "ok", mail: CARDS });
      throw new app.ChatRequestError("http", "HTTP 500");
    });
    const { log, sink } = recorder(app);
    await app.runPhoneTurn(turnOf([USER("fammi vedere le mail")]), SETTINGS, sink, abortable(), MAIL_ON, { loop, facts: facts() });
    equal("a turn with no answer still sends its cards before it ends", log.at(-2)[0], "cards");
    equal("and then the turn's own code", log.at(-1), ["error", { code: "engine" }]);
  }
  {
    const { loop } = fakeLoop(async (o) => {
      o.onToolRun({ id: "0-c1", name: "mail_list", arguments: "{}", result: "1 mail", state: "ok", mail: CARDS });
    });
    const { log, sink } = recorder(app);
    await app.runPhoneTurn(turnOf([USER("fammi vedere le mail")]), SETTINGS, sink, abortable(), MAIL_ON, { loop, facts: facts() });
    equal("a turn that says nothing sends its cards before done", log.at(-2)[0], "cards");
    equal("and then done", log.at(-1), ["done", {}]);
  }
  {
    const { loop } = fakeLoop(async () => {
      throw new app.ChatRequestError("http", "HTTP 500");
    });
    const { log, sink } = recorder(app);
    await app.runPhoneTurn(turnOf([USER("x")]), SETTINGS, sink, abortable(), MAIL_ON, { loop, facts: facts() });
    equal("an engine failure is the engine's code", log, [["error", { code: "engine" }]]);
  }
  {
    const { loop } = fakeLoop(async () => {
      throw new app.ChatRequestError("oversize", "Context exceeded");
    });
    const { log, sink } = recorder(app);
    await app.runPhoneTurn(turnOf([USER("x")]), SETTINGS, sink, abortable(), MAIL_ON, { loop, facts: facts() });
    equal("a window too small for the turn is bad_request", log, [["error", { code: "bad_request" }]]);
  }
  {
    const controller = new AbortController();
    const { loop } = fakeLoop(
      (o) =>
        new Promise((_, reject) =>
          o.signal.addEventListener("abort", () => reject(new app.ChatRequestError("aborted", "Stopped"))),
        ),
    );
    const { log, sink } = recorder(app);
    const running = app.runPhoneTurn(turnOf([USER("x")]), SETTINGS, sink, controller.signal, MAIL_ON, { loop, facts: facts() });
    setTimeout(() => controller.abort(), 5);
    await running;
    equal("a stop ends the turn as cancelled, once", log, [["error", { code: "cancelled" }]]);
  }
  {
    const { loop, seen } = fakeLoop(async () => {});
    const { log, sink } = recorder(app);
    await app.runPhoneTurn(turnOf([USER("x")]), { ...SETTINGS, endpoint: "" }, sink, abortable(), MAIL_ON, { loop, facts: facts() });
    equal("no door means an engine error and no call", [seen.options, log], [null, [["error", { code: "engine" }]]]);
  }
  {
    const { loop, seen } = fakeLoop(async () => {});
    const { log, sink } = recorder(app);
    await app.runPhoneTurn(turnOf([USER("x".repeat(4000))]), SETTINGS, sink, abortable(), MAIL_ON, { loop, facts: facts({ nctx: 100 }) });
    equal("a turn the window cannot hold is refused before the call", [seen.options, log], [null, [["error", { code: "bad_request" }]]]);
  }
}

/** The phone's reasoning of a refused round, through the REAL loop: a server
    that answers with the rounds it is given, one per request. The phone's
    frames are one way, so round one's reasoning can only be sent if round one
    stands. */
function scriptedBrain(rounds) {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type, authorization, x-kalsa-request",
  };
  let round = 0;
  const open = [];
  const server = createServer((req, res) => {
    if (req.method === "OPTIONS") return void res.writeHead(204, cors).end();
    req.resume();
    res.writeHead(200, { "content-type": "text/event-stream", ...cors });
    open.push(res);
    const script = rounds[Math.min(round, rounds.length - 1)];
    round += 1;
    const chunks = Array.isArray(script) ? script : script.chunks;
    for (const delta of chunks) res.write(`data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`);
    // A round the test holds open: the stream stays open until the turn stops.
    if (!Array.isArray(script)) return;
    res.write("data: [DONE]\n\n");
    res.end();
  });
  return {
    async listen() {
      await new Promise((ready) => server.listen(0, "127.0.0.1", ready));
      return `http://127.0.0.1:${server.address().port}`;
    },
    rounds: () => round,
    close: () => {
      for (const res of open) res.end();
      server.close();
    },
  };
}

const think = (text) => ({ reasoning_content: text });
const say = (text, finish = "stop") => ({ content: text, finish_reason: finish });
const call = (name, args) => ({
  tool_calls: [{ index: 0, id: "c1", type: "function", function: { name, arguments: JSON.stringify(args) } }],
});

async function refusedReasoning(app) {
  console.log("\n# the reasoning of a refused round");
  const abortable = () => new AbortController().signal;
  // Round one refuses, so the loop asks again without tools: the reasoning of
  // round one is never sent, and the retry's is.
  {
    const brain = scriptedBrain([
      [think("Cerco gli strumenti."), say("Non posso aiutarti con questa richiesta.")],
      [think("Provo senza strumenti."), say("Ecco cosa posso fare.")],
    ]);
    const settings = { ...SETTINGS, endpoint: await brain.listen() };
    const { log, sink } = recorder(app);
    await app.runPhoneTurn(turnOf([USER("fammi vedere le mail")]), settings, sink, abortable(), MAIL_ON, { loop: app.streamChatCompletion, facts: facts() });
    equal("the refused round's reasoning never reaches the phone", log.filter(([event]) => event === "reasoning"), [
      ["reasoning", { text: "Provo senza strumenti." }],
    ]);
    equal("and the retry's answer follows it", log.at(-2), ["delta", { text: "Ecco cosa posso fare." }]);
    equal("the turn still ends once", log.at(-1), ["done", {}]);
    brain.close();
  }
  // A round that stands sends its reasoning, in order, before its answer.
  {
    const brain = scriptedBrain([[think("Guardo le mail."), say("Due mail sono arrivate.")]]);
    const settings = { ...SETTINGS, endpoint: await brain.listen() };
    const { log, sink } = recorder(app);
    await app.runPhoneTurn(turnOf([USER("fammi vedere le mail")]), settings, sink, abortable(), MAIL_ON, { loop: app.streamChatCompletion, facts: facts() });
    equal("a round that stands sends its reasoning before its answer", log, [
      ["reasoning", { text: "Guardo le mail." }],
      ["delta", { text: "Due mail sono arrivate." }],
      ["done", {}],
    ]);
    brain.close();
  }
  // The last round of a turn — asked for in words, after tools are spent — is
  // not a round that can be refused, so nothing is held and both streams live.
  {
    const brain = scriptedBrain([[say("")], [think("Scrivo senza strumenti."), say("Ecco cosa posso fare.")]]);
    const settings = { ...SETTINGS, endpoint: await brain.listen() };
    const { log, sink } = recorder(app);
    await app.runPhoneTurn(turnOf([USER("fammi vedere le mail")]), settings, sink, abortable(), MAIL_ON, { loop: app.streamChatCompletion, facts: facts() });
    // The empty round settles as an empty frame, which shows nothing; it is
    // left out so this reads about the last round's own two frames.
    const said = log.filter(([event, data]) => !(event === "delta" && data.text === ""));
    equal("the last round's reasoning is not held back", said, [
      ["reasoning", { text: "Scrivo senza strumenti." }],
      ["delta", { text: "Ecco cosa posso fare." }],
      ["done", {}],
    ]);
    brain.close();
  }
  // Stopped mid-hold: the round never stands, so nothing it held is sent.
  {
    const brain = scriptedBrain([{ chunks: [think("Guardo le mail."), say("Due mail sono arrivate")] }]);
    const settings = { ...SETTINGS, endpoint: await brain.listen() };
    const { log, sink } = recorder(app);
    const controller = new AbortController();
    const running = app.runPhoneTurn(turnOf([USER("fammi vedere le mail")]), settings, sink, controller.signal, MAIL_ON, { loop: app.streamChatCompletion, facts: facts() });
    await new Promise((r) => setTimeout(r, 300));
    controller.abort();
    await running;
    equal("a round stopped mid-hold sends no reasoning at all", log.filter(([event]) => event === "reasoning"), []);
    equal("and the turn ends as cancelled", log.at(-1), ["error", { code: "cancelled" }]);
    brain.close();
  }
  // The chat can take a frame back, so it keeps streaming: the hold is the
  // phone's, not the loop's.
  {
    const brain = scriptedBrain([[think("Cerco gli strumenti."), say("Non posso aiutarti con questa richiesta.")]]);
    const settings = { ...SETTINGS, endpoint: await brain.listen() };
    const seen = [];
    await app.streamChatCompletion({
      endpoint: settings.endpoint,
      token: settings.token,
      model: settings.model,
      messages: [{ role: "user", content: "fammi vedere le mail" }],
      sampling: {},
      signal: abortable(),
      tools: app.offeredTools(true, "en", settings.model, "web"),
      runTool: async () => ({ ok: true, text: "" }),
      onToken: (text) => seen.push(text),
      onReasoning: (text) => seen.push(`[${text}]`),
    });
    check("a chat turn still streams the reasoning of a round it can withdraw", seen.includes("[Cerco gli strumenti.]"), JSON.stringify(seen));
    brain.close();
  }
}

/** The phone cannot ask, so its web calls never wait on the gate. In a
    conversation holding mail they still pass the query checks: a search that
    carries an address the conversation never showed is refused. */
async function phoneMailWeb(app) {
  console.log("\n# phone web calls in a conversation with mail");
  const NONCE = "kalsa-mail-0123456789abcdef";
  const conversation = [
    USER("fammi vedere le mail"),
    { role: "assistant", content: "", tool_calls: [{ id: "c1", type: "function", function: { name: "mail_list", arguments: "{}" } }] },
    {
      role: "tool",
      tool_call_id: "c1",
      content: [`<<<email-text ${NONCE}>>>`, "from:", `${NONCE} Acme <billing@acme.example>`, `<<<end-email-text ${NONCE}>>>`].join("\n"),
    },
  ];
  const outcome = {};
  const { loop } = fakeLoop(async (o) => {
    const signal = new AbortController().signal;
    outcome.search = await o.runTool("web_search", { query: "Acme invoice 40 EUR" }, signal, conversation);
    outcome.attack = await o.runTool("web_search", { query: "https://attacker.example/collect?d=SECRET" }, signal, conversation);
  });
  const { sink } = recorder(app);
  await app.runPhoneTurn(turnOf([USER("x")]), SETTINGS, sink, new AbortController().signal, MAIL_ON, { loop, facts: facts() });
  const searched = bridge.calls.filter((c) => c.command === "brain_web_search").map((c) => c.args.query);
  check("phone with mail: the search ran without any ask", outcome.search.ok === true && searched.includes("Acme invoice 40 EUR"), outcome.search.text);
  check("phone with mail: an unseen address in a query is still refused", outcome.attack.ok === false && outcome.attack.resultCode === "web.query_link_unseen", outcome.attack.text);
  check("phone with mail: the refused query never reached the engine", !searched.some((q) => q.includes("attacker.example")), JSON.stringify(searched));
}

/** A phone turn's browser. The card goes to that phone and to no desktop; the
    write is still offered the same rules; and the outcome comes back to the same
    phone's next turn, the way the desktop's own note does. */
async function phoneBrowser(app) {
  console.log("\n# a phone turn's browser");
  // The browser is offered only where a driver is installed, exactly as on the
  // desktop: this is a phone driving the same computer's browser, not a browser
  // of its own.
  app.noteBrowserStatus({ supported: true, installed: true, kind: "chrome" });
  const browser = (name) => name.startsWith("browser_");
  const tools = (device) =>
    app
      .phoneTools(SETTINGS.webTools, "en", SETTINGS.model, MAIL_ON, device)
      .map((tool) => tool.function.name);

  // **A phone is offered the browser's reads and writes, and never the picture.**
  // The phone drives the same computer's browser on the desktop's terms. A write
  // leaves only under a card, and the card goes to this phone. The phone has no
  // control to arm a browser turn with, and it does not need one: its turn is
  // the browser's tools, and nothing more.
  const READS = ["browser_open", "browser_read", "browser_find"];
  const WRITES = ["browser_click", "browser_type"];
  const named = tools(PHONE);
  check("a phone turn is offered the browser's reads", READS.every((name) => named.includes(name)), JSON.stringify(named));
  check("and its writes, answered on the phone", WRITES.every((name) => named.includes(name)), JSON.stringify(named));
  check("and never the picture of the page", !named.includes("browser_screenshot"), JSON.stringify(named));
  // **A turn that names no phone is offered no browser at all**: it has no conversation of
  // its own, so the page it would read is the desktop's, and the computer keeps no page for it.
  const anonymous = tools(null);
  check(
    "a turn that names no phone is offered no browser tool",
    anonymous.filter(browser).length === 0,
    JSON.stringify(anonymous),
  );
  check("and no picture either", !anonymous.includes("browser_screenshot"), JSON.stringify(anonymous));
  check("and it keeps no mini app either", !anonymous.includes("create_miniapp"), JSON.stringify(anonymous));

  // The conversation is the phone's, one per device, and never a desktop's: a
  // desktop conversation is a UUID, so the two can never be the same string.
  const conversation = app.phoneConversation(PHONE);
  check("the conversation is this phone's own", conversation === `phone:${PHONE}`, conversation);
  check("and a different phone is a different conversation", app.phoneConversation("3") !== conversation);

  // The browser call this turn makes is stamped with that conversation, so the
  // card it raises comes back to this phone and not to a chat.
  const { loop } = fakeLoop(async (o) => {
    const signal = new AbortController().signal;
    await o.runTool("browser_click", { ref: "e4" }, signal, undefined);
  });
  const { sink } = recorder(app);
  await app.runPhoneTurn(turnOf([USER("buy it")], { device: PHONE }), SETTINGS, sink, new AbortController().signal, MAIL_ON, {
    loop,
    facts: facts(),
  });
  const clicked = bridge.calls.filter((c) => c.command === "brain_browser_click");
  check(
    "so the click carries this phone's conversation",
    clicked.length === 1 && clicked[0].args.conversation === conversation,
    JSON.stringify(clicked.map((c) => c.args.conversation)),
  );

  // **The turn that drove the browser lets the page go at its end.** One page is
  // driven by one turn: while this turn ran, a second driver was refused as
  // busy, so the page's claim must not outlive the turn — on any ending.
  const released = bridge.calls.filter((c) => c.command === "brain_browser_release");
  check(
    "the turn's end lets the page go, in this phone's name",
    released.length === 1 && released[0].args.conversation === conversation,
    JSON.stringify(released.map((c) => c.args)),
  );

  // **The outcome reaches the model in this phone's next turn.** It is queued
  // under the phone's conversation and drained into the browser note, and the
  // note rides the last user message like the desktop's own.
  app.noteAnswered({ id: BROWSER_CARD.card_id, conversation, code: "sent", host: "shop.example" });
  let wire2 = null;
  const second = fakeLoop(async (o) => {
    wire2 = o.messages;
  });
  await app.runPhoneTurn(turnOf([USER("did it go?")], { device: PHONE }), SETTINGS, recorder(app).sink, new AbortController().signal, MAIL_ON, {
    loop: second.loop,
    facts: facts(),
  });
  const last = wire2[wire2.length - 1];
  // **A word in the request, not a property beside it.** The phone builds its own
  // wire, and the note is the last thing in it: what the model reads is a message.
  check(
    "the phone's next turn is told what became of it",
    last.role === "user" && last.content.includes("1 sent to shop.example"),
    JSON.stringify(last.content),
  );
  // And the note is the app's own account: it says where the request went and
  // nothing of what it held, so a phone's next turn cannot carry a form's fields.
  check(
    "without repeating the card, or any field of it",
    !last.content.includes(BROWSER_CARD.card_id) && !last.content.includes("hunter2"),
    JSON.stringify(last.content),
  );
  // **A turn that never touched the browser has nothing to let go**, and no
  // sidecar is asked for nothing: that note turn released nothing more.
  const releases = bridge.calls.filter((c) => c.command === "brain_browser_release").length;
  equal("a turn that ran no browser tool asks for no release", releases, 1);
  // **And the release is on the way out of a turn that failed too.** A turn the
  // engine cut short is still the turn that was driving the page.
  await app.runPhoneTurn(turnOf([USER("read it anyway")], { device: PHONE }), SETTINGS, recorder(app).sink, new AbortController().signal, MAIL_ON, {
    loop: fakeLoop(async (o) => {
      await o.runTool("browser_find", { text: "price" }, new AbortController().signal, undefined);
      throw new Error("the engine went down mid-turn");
    }).loop,
    facts: facts(),
  });
  const afterFailure = bridge.calls.filter((c) => c.command === "brain_browser_release");
  equal(
    "a failed turn still lets the page go",
    [afterFailure.length, afterFailure[afterFailure.length - 1].args.conversation],
    [2, conversation],
  );
  // And it is told once: drained, not repeated on every turn afterwards.
  let wire3 = null;
  await app.runPhoneTurn(turnOf([USER("and now?")], { device: PHONE }), SETTINGS, recorder(app).sink, new AbortController().signal, MAIL_ON, {
    loop: fakeLoop(async (o) => {
      wire3 = o.messages;
    }).loop,
    facts: facts(),
  });
  const last3 = wire3[wire3.length - 1];
  // Drained, not repeated: what is left is the person's own words and no fence.
  check("and only once", last3.content.startsWith("and now?") && !last3.content.includes("kalsa-page-"), JSON.stringify(last3.content));

  // **A phone holding its owner's mail does not type into a website.** Not the
  // card — a card is a request the person is asked about, and a page navigation
  // needs none: a click that goes somewhere, or a search box the model fills and
  // presses Enter on, leaves the computer with nothing on a screen for the owner
  // to say yes to. On the desktop the answer is a gate and an ask; a phone has
  // nobody to ask, so the answer is one plain line.
  // A conversation that has read mail, in the shape the loop's own answers have:
  // a mail tool's answer, and a tool answer carrying the sidecar's fence — which
  // is what the rule reads, on the desktop as much as here.
  const NONCE = "0123456789abcdef";
  const MAIL_TURN = [
    { role: "assistant", content: "", tool_calls: [{ id: "m1", type: "function", function: { name: "mail_list", arguments: "{}" } }] },
    {
      role: "tool",
      tool_call_id: "m1",
      content: `<<<mail\nsubject:\nkalsa-mail-${NONCE} Your statement\n<<<`,
    },
  ];
  check("a turn whose conversation holds mail is armed", app.phoneArmed(MAIL_TURN) === true);
  check(
    "and a turn that reads no mail is not",
    app.phoneArmed([{ role: "user", content: "buy it" }]) === false,
    "the same conversation with no mail in it",
  );

  const armedTools = app
    .phoneTools(SETTINGS.webTools, "en", SETTINGS.model, MAIL_ON, PHONE, true)
    .map((tool) => tool.function.name);
  // An armed chat holds the owner's mail: nothing leaves for a website, so it is offered
  // the reads that send nothing (read and find), and not the open, the click or the type.
  const ARMED_READS = ["browser_read", "browser_find"];
  check(
    "an armed phone is still offered the page reads",
    ARMED_READS.every((name) => armedTools.includes(name)),
    JSON.stringify(armedTools.filter(browser)),
  );
  check(
    "and none of the sends: no open, no click, no type",
    ["browser_open", ...WRITES].every((name) => !armedTools.includes(name)),
    JSON.stringify(armedTools.filter(browser)),
  );

  // **And refused when it calls one anyway.** An offer is something the model can
  // write past: the tool list is chosen before the first mail arrives, and a turn
  // can name a tool it was never offered.
  let refused = null;
  const { loop: refusingLoop } = fakeLoop(async (o) => {
    const signal = new AbortController().signal;
    refused = await o.runTool("browser_type", { ref: "e4", text: "482913" }, signal, MAIL_TURN);
  });
  const { sink: armedSink } = recorder(app);
  await app.runPhoneTurn(
    turnOf([USER("search for 482913")], { device: PHONE }),
    SETTINGS,
    armedSink,
    new AbortController().signal,
    MAIL_ON,
    { loop: refusingLoop, facts: facts() },
  );
  check(
    "a write in an armed chat is refused in one plain line, and nothing was sent",
    refused !== null &&
      refused.ok === false &&
      refused.text.includes("won't type into a website") &&
      refused.text.includes("mail or documents"),
    JSON.stringify(refused),
  );
  check(
    "and the sidecar was never asked",
    !bridge.calls.some((c) => c.command === "brain_browser_type"),
    JSON.stringify(bridge.calls.map((c) => c.command)),
  );

  // **An open is refused in the same chat.** Opening a website sends its address out, and an
  // armed chat has nothing that may leave for one.
  {
    let opened = null;
    const from = bridge.calls.length;
    const { loop: openingLoop } = fakeLoop(async (o) => {
      opened = await o.runTool("browser_open", { url: "https://shop.example/dp/1" }, new AbortController().signal, MAIL_TURN);
    });
    await app.runPhoneTurn(turnOf([USER("open the shop")], { device: PHONE }), SETTINGS, recorder(app).sink, new AbortController().signal, MAIL_ON, {
      loop: openingLoop,
      facts: facts(),
    });
    check(
      "an open in an armed chat is refused in one plain line",
      opened !== null && opened.ok === false && opened.text.includes("won't open a website"),
      JSON.stringify(opened),
    );
    check(
      "and the sidecar was never asked to open",
      !bridge.calls.slice(from).some((c) => c.command === "brain_browser_open"),
      JSON.stringify(bridge.calls.slice(from).map((c) => c.command)),
    );
  }

  // **A browser call on a turn that names no phone is refused, and the sidecar is not asked.**
  // The model can name a tool it was never offered: the page it would reach is the desktop's.
  {
    let read = null;
    const from = bridge.calls.length;
    const { loop: anonymousLoop } = fakeLoop(async (o) => {
      read = await o.runTool("browser_read", {}, new AbortController().signal, undefined);
    });
    await app.runPhoneTurn(turnOf([USER("read the page")]), SETTINGS, recorder(app).sink, new AbortController().signal, MAIL_ON, {
      loop: anonymousLoop,
      facts: facts(),
    });
    check(
      "a read on a turn that names no phone is refused in one plain line",
      read !== null && read.ok === false && read.text.includes("no browser for this turn"),
      JSON.stringify(read),
    );
    check(
      "and the sidecar was not asked",
      !bridge.calls.slice(from).some((c) => c.command.startsWith("brain_browser_")),
      JSON.stringify(bridge.calls.slice(from).map((c) => c.command)),
    );
  }

  // **And the latch: once a mail tool has run in a turn, the turn stays armed.**
  // The conversation predicate reads the wire the loop is given, and a wire can
  // stop saying so — trimmed to fit, a mail result cut by the context budget, an
  // answer that came back as an error rather than fenced mail. None of those
  // un-reads the mail: the model has it, and may have it in the very round it is
  // answering from. So the mail tool is run first and the write is refused
  // anyway, on a conversation that shows nothing.
  const trimmed = [{ role: "user", content: "find it" }];
  let after_mail = null;
  const { loop: latchingLoop } = fakeLoop(async (o) => {
    const signal = new AbortController().signal;
    await o.runTool("mail_read", { id: "105" }, signal, trimmed);
    after_mail = await o.runTool("browser_type", { ref: "e4", text: "482913" }, signal, trimmed);
  });
  const sent_before = bridge.calls.filter((c) => c.command === "brain_browser_type").length;
  await app.runPhoneTurn(turnOf([USER("read it, then search")], { device: PHONE }), SETTINGS, recorder(app).sink, new AbortController().signal, MAIL_ON, {
    loop: latchingLoop,
    facts: facts(),
  });
  check(
    "a write after a mail tool in the same turn is refused, on a wire that shows no mail",
    after_mail !== null && after_mail.ok === false && after_mail.text.includes("won't type into a website"),
    JSON.stringify(after_mail),
  );
  check(
    "and the sidecar is still never asked",
    bridge.calls.filter((c) => c.command === "brain_browser_type").length === sent_before,
    "the type that went out before the latch test is all of them",
  );

  // **And it is remembered for the chat, not only for the turn.** The phone
  // rebuilds the wire it sends, and it strips mail from its history — so a turn
  // that arrives with nothing in it is a normal turn, not a chat that has never
  // seen mail. Asking the wire would un-read the mail and offer the writes back.
  const chat = app.phoneConversation(PHONE);
  app.forgetArmedChat(chat);
  check("a chat that has read no mail is unarmed", app.phoneChatArmedHere(chat) === false);
  const read_mail = turnOf([USER("read it")], { device: PHONE });
  await app.runPhoneTurn(read_mail, SETTINGS, recorder(app).sink, new AbortController().signal, MAIL_ON, {
    loop: fakeLoop(async (o) => {
      await o.runTool("mail_read", { id: "105" }, new AbortController().signal, trimmed);
    }).loop,
    facts: facts(),
  });
  check("and it is armed afterwards", app.phoneChatArmedHere(chat) === true, "the computer remembers it, not the phone's wire");
  let on_the_next_turn = null;
  // **A turn that continues the chat**, so it carries an assistant turn behind it
  // — which is what a phone sends when the person is still in the same chat, and
  // the only thing that tells a new chat from an old one.
  const continuing = turnOf([USER("and now?"), { role: "assistant", content: "here it is" }], { device: PHONE });
  await app.runPhoneTurn(continuing, SETTINGS, recorder(app).sink, new AbortController().signal, MAIL_ON, {
    loop: fakeLoop(async (o) => {
      on_the_next_turn = await o.runTool(
        "browser_type",
        { ref: "e4", text: "482913" },
        new AbortController().signal,
        // **The wire the phone actually sends this time: no mail in it at all.**
        [{ role: "user", content: "and now?" }],
      );
    }).loop,
    facts: facts(),
  });
  check(
    "a chat that read mail is still armed on the next turn, with nothing in the wire saying so",
    on_the_next_turn !== null && on_the_next_turn.ok === false && on_the_next_turn.text.includes("won't type into a website"),
    JSON.stringify(on_the_next_turn),
  );

  // **A reply to a mail is armed from its first word**: the person pressed "draft
  // a reply", so the mail is in the turn whatever the phone's wire says.
  app.forgetArmedChat(chat);
  check(
    "a turn replying to a mail is armed before it reads anything",
    app.phoneChatArmed(chat, turnOf([USER("reply to that")], { device: PHONE, replyFor: "105" })) === true,
  );

  // **A new chat starts unarmed** — the only thing a person does from a phone to
  // put the old one behind them.
  app.forgetArmedChat(chat);
  check("cleared, a chat that has read no mail is unarmed again", app.phoneChatArmed(chat, turnOf([USER("fresh")], { device: PHONE })) === false);
  await app.runPhoneTurn(turnOf([USER("read it")], { device: PHONE }), SETTINGS, recorder(app).sink, new AbortController().signal, MAIL_ON, {
    loop: fakeLoop(async (o) => {
      await o.runTool("mail_read", { id: "105" }, new AbortController().signal, trimmed);
    }).loop,
    facts: facts(),
  });
  check(
    "and a chat that reads mail in it is armed again",
    app.phoneChatArmed(chat, turnOf([USER("hi"), { role: "assistant", content: "yes" }], { device: PHONE })) === true,
    "an earlier assistant turn is what makes it the same chat",
  );
  check(
    "while a turn with no assistant turn behind it starts a new chat, and is unarmed",
    app.phoneChatArmed(chat, turnOf([USER("something else entirely")], { device: PHONE })) === false,
  );

  // **A phone that is unpaired takes the memory with it** — the computer's half,
  // which is what the unpair event clears.
  await app.runPhoneTurn(turnOf([USER("read it")], { device: PHONE }), SETTINGS, recorder(app).sink, new AbortController().signal, MAIL_ON, {
    loop: fakeLoop(async (o) => {
      await o.runTool("mail_read", { id: "105" }, new AbortController().signal, trimmed);
    }).loop,
    facts: facts(),
  });
  check("armed once more", app.phoneChatArmedHere(chat) === true);
  app.forgetArmedChat(chat);
  check(
    "and an unpair leaves nothing behind for a phone that is paired again later",
    app.phoneChatArmedHere(chat) === false,
  );

  // The same call in a chat holding no mail still goes through: the rule is about
  // what the conversation holds, not about phones.
  const { loop: freeLoop } = fakeLoop(async (o) => {
    await o.runTool("browser_type", { ref: "e4", text: "482913" }, new AbortController().signal, [{ role: "user", content: "hi" }]);
  });
  await app.runPhoneTurn(turnOf([USER("search for 482913")], { device: PHONE }), SETTINGS, recorder(app).sink, new AbortController().signal, MAIL_ON, {
    loop: freeLoop,
    facts: facts(),
  });
  check(
    "while an unarmed one is not, because a browser is a place things go out to",
    bridge.calls.some((c) => c.command === "brain_browser_type"),
    JSON.stringify(bridge.calls.map((c) => c.command)),
  );
}

/** A contact form must finish within one turn without changing the search cap. */
async function roundCap(app) {
  console.log("\n# the rounds a turn's own tools may spend");
  {
    // No driver installed, so this turn is offered no browser at all.
    app.noteBrowserStatus({ supported: false, installed: false });
    const from = bridge.calls.length;
    const brain = scriptedBrain([
      ...Array.from({ length: 5 }, () => [call("web_search", { query: "kalsa" })]),
      [say("Ecco cosa ho trovato.")],
    ]);
    const { sink } = recorder(app);
    await app.runPhoneTurn(turnOf([USER("look online")]), { ...SETTINGS, endpoint: await brain.listen() }, sink, new AbortController().signal, MAIL_ON, { loop: app.streamChatCompletion, facts: facts() });
    const searched = bridge.calls.slice(from).filter((c) => c.command === "brain_web_search");
    equal("a turn with no browser spends four rounds and is asked for words in the fifth", [searched.length, brain.rounds()], [4, 5]);
    brain.close();
  }
  {
    app.noteBrowserStatus({ supported: true, installed: true, kind: "chrome" });
    // The chat this phone drives was left armed by the test above, and an armed
    // chat refuses every write before the loop is even asked.
    app.forgetArmedChat(app.phoneConversation(PHONE));
    const from = bridge.calls.length;
    const PAGE = "https://shop.example/order";
    const FIELDS = ["e1", "e2", "e3", "e4"];
    const brain = scriptedBrain([
      [call("browser_open", { url: PAGE })],
      [call("browser_read", {})],
      ...FIELDS.map((ref, at) => [call("browser_type", { ref, text: `field ${at + 1}` })]),
      [call("browser_click", { ref: "e5" })],
      [say("Modulo compilato.")],
    ]);
    const { log, sink } = recorder(app);
    await app.runPhoneTurn(turnOf([USER(`buy this: ${PAGE}`)], { device: PHONE }), { ...SETTINGS, endpoint: await brain.listen() }, sink, new AbortController().signal, MAIL_ON, { loop: app.streamChatCompletion, facts: facts() });
    const ran = (command) => bridge.calls.slice(from).filter((c) => c.command === command);
    // **The phone's own turn drives the page**: each field is typed and the form is
    // clicked, one call each, and every one reaches the browser under this phone's
    // conversation. The write that would send the form is held by the computer, not
    // by this proof: the sidecar's own proofs cover that.
    equal("each field is typed and the form is clicked, once each", [ran("brain_browser_type").length, ran("brain_browser_click").length], [4, 1]);
    check(
      "under this phone's own conversation",
      [...ran("brain_browser_type"), ...ran("brain_browser_click")].every((c) => c.args.conversation === app.phoneConversation(PHONE)),
      JSON.stringify(ran("brain_browser_click").map((c) => c.args.conversation)),
    );
    check("and the engine was asked eight times: each scripted step, then the answer", brain.rounds() === 8, String(brain.rounds()));
    equal("the turn's own line goes out once, before the frame that ends it", [log.filter(([event]) => event === "recap").length, log.slice(-2).map(([event]) => event)], [1, ["recap", "done"]]);
    brain.close();
  }
}

await withPhone(async (app) => {
  requests(app);
  wire(app);
  await turns(app);
  await refusedReasoning(app);
  await phoneMailWeb(app);
  await phoneBrowser(app);
  await roundCap(app);
});
summary();
