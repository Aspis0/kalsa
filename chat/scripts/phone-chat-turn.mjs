// The phone chat's turn, driven through the real modules: request parsing, the
// wire a phone turn sends, and the events one turn makes from a fake loop.
// The mail read and the runner are in phone-chat-runner.mjs.
//
// Run: node scripts/phone-chat-turn.mjs   (from chat/)

import { createServer } from "node:http";
import {
  CARDS,
  DRAFT,
  NOW,
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
    readPhoneRequest({ request: "r1", kind: "turn", turn: { messages: [USER("hi")], reply_for: "105", language: "it" } }),
    { request: "r1", body: { kind: "turn", turn: { messages: [USER("hi")], replyFor: "105", language: "it" } } },
  );
  equal(
    "a turn without reply or language defaults to no mail and English",
    readPhoneRequest({ request: "r2", kind: "turn", turn: { messages: [USER("hi")] } }).body.turn,
    { messages: [USER("hi")], replyFor: null, language: "en" },
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
    await app.runPhoneTurn(turnOf([USER("rispondi")], { replyFor: "105" }), SETTINGS, sink, abortable(), { loop, facts: facts() });
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
    await app.runPhoneTurn(turnOf([USER("x")]), SETTINGS, sink, abortable(), { loop, facts: facts() });
    const names = seen.options.tools.map((t) => t.function.name);
    check(
      "the tools are the desktop's, without create_miniapp",
      !names.includes("create_miniapp") && names.includes("web_search") && names.includes("mail_list"),
      JSON.stringify(names),
    );
  }
  {
    const { loop } = fakeLoop(async (o) => {
      o.onToolRun({ id: "0-c1", name: "mail_list", arguments: "{}", result: "", state: "running" });
      o.onToolRun({ id: "0-c1", name: "mail_list", arguments: "{}", result: "1 mail", state: "ok", mail: CARDS });
      o.onToolRun({ id: "0-c1", name: "mail_list", arguments: "{}", result: "1 mail", state: "ok", mail: CARDS });
      o.onToken("Ecco.");
    });
    const { log, sink } = recorder(app);
    await app.runPhoneTurn(turnOf([USER("mail")]), SETTINGS, sink, abortable(), { loop, facts: facts() });
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
    await app.runPhoneTurn(turnOf([USER("rispondi")], { replyFor: "105" }), SETTINGS, sink, abortable(), { loop, facts: facts() });
    equal("a draft is sent in the protocol's snake_case, with no send", log[1], [
      "draft",
      { reply_to_id: "105", to: "ann@example.com", to_name: "", subject: "Re: Hi", body: "Ciao" },
    ]);
  }
  {
    const { loop } = fakeLoop(async () => {});
    const { log, sink } = recorder(app);
    await app.runPhoneTurn(turnOf([USER("x")]), SETTINGS, sink, abortable(), { loop, facts: facts() });
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
    await app.runPhoneTurn(turnOf([USER("fammi vedere le mail")]), SETTINGS, sink, abortable(), { loop, facts: facts() });
    equal("a turn with no answer still sends its cards before it ends", log.at(-2)[0], "cards");
    equal("and then the turn's own code", log.at(-1), ["error", { code: "engine" }]);
  }
  {
    const { loop } = fakeLoop(async (o) => {
      o.onToolRun({ id: "0-c1", name: "mail_list", arguments: "{}", result: "1 mail", state: "ok", mail: CARDS });
    });
    const { log, sink } = recorder(app);
    await app.runPhoneTurn(turnOf([USER("fammi vedere le mail")]), SETTINGS, sink, abortable(), { loop, facts: facts() });
    equal("a turn that says nothing sends its cards before done", log.at(-2)[0], "cards");
    equal("and then done", log.at(-1), ["done", {}]);
  }
  {
    const { loop } = fakeLoop(async () => {
      throw new app.ChatRequestError("http", "HTTP 500");
    });
    const { log, sink } = recorder(app);
    await app.runPhoneTurn(turnOf([USER("x")]), SETTINGS, sink, abortable(), { loop, facts: facts() });
    equal("an engine failure is the engine's code", log, [["error", { code: "engine" }]]);
  }
  {
    const { loop } = fakeLoop(async () => {
      throw new app.ChatRequestError("oversize", "Context exceeded");
    });
    const { log, sink } = recorder(app);
    await app.runPhoneTurn(turnOf([USER("x")]), SETTINGS, sink, abortable(), { loop, facts: facts() });
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
    const running = app.runPhoneTurn(turnOf([USER("x")]), SETTINGS, sink, controller.signal, { loop, facts: facts() });
    setTimeout(() => controller.abort(), 5);
    await running;
    equal("a stop ends the turn as cancelled, once", log, [["error", { code: "cancelled" }]]);
  }
  {
    const { loop, seen } = fakeLoop(async () => {});
    const { log, sink } = recorder(app);
    await app.runPhoneTurn(turnOf([USER("x")]), { ...SETTINGS, endpoint: "" }, sink, abortable(), { loop, facts: facts() });
    equal("no door means an engine error and no call", [seen.options, log], [null, [["error", { code: "engine" }]]]);
  }
  {
    const { loop, seen } = fakeLoop(async () => {});
    const { log, sink } = recorder(app);
    await app.runPhoneTurn(turnOf([USER("x".repeat(4000))]), SETTINGS, sink, abortable(), { loop, facts: facts({ nctx: 100 }) });
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
    "Access-Control-Allow-Headers": "content-type, authorization",
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
    await app.runPhoneTurn(turnOf([USER("fammi vedere le mail")]), settings, sink, abortable(), { loop: app.streamChatCompletion, facts: facts() });
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
    await app.runPhoneTurn(turnOf([USER("fammi vedere le mail")]), settings, sink, abortable(), { loop: app.streamChatCompletion, facts: facts() });
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
    await app.runPhoneTurn(turnOf([USER("fammi vedere le mail")]), settings, sink, abortable(), { loop: app.streamChatCompletion, facts: facts() });
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
    const running = app.runPhoneTurn(turnOf([USER("fammi vedere le mail")]), settings, sink, controller.signal, { loop: app.streamChatCompletion, facts: facts() });
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

await withPhone(async (app) => {
  requests(app);
  wire(app);
  await turns(app);
  await refusedReasoning(app);
});
summary();
