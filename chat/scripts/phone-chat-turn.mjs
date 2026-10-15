// The phone chat's turn, driven through the real modules: request parsing, the
// wire a phone turn sends, and the events one turn makes from a fake loop.
// The mail read and the runner are in phone-chat-runner.mjs.
//
// Run: node scripts/phone-chat-turn.mjs   (from chat/)

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
  equal("the system message is the desktop's own prompt", plain.wire[0], {
    role: "system",
    content: app.systemPrompt(false, false).content,
  });
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
    equal("a tool run with cards is a tool_run, then the cards once", log, [
      ["tool_run", { id: "0-c1", name: "mail_list", state: "running" }],
      ["tool_run", { id: "0-c1", name: "mail_list", state: "ok" }],
      ["cards", CARDS],
      ["tool_run", { id: "0-c1", name: "mail_list", state: "ok" }],
      ["delta", { text: "Ecco." }],
      ["done", {}],
    ]);
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

await withPhone(async (app) => {
  requests(app);
  wire(app);
  await turns(app);
});
summary();
