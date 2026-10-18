// The phone chat's mail read and its runner, driven through the real modules:
// a read's answer, the request and stop listeners, and their removal.
// The turn and the wire are in phone-chat-turn.mjs.
//
// Run: node scripts/phone-chat-runner.mjs   (from chat/)

import {
  USER,
  bridge,
  check,
  emit,
  equal,
  phoneEvents,
  recorder,
  summary,
  tick,
  withPhone,
} from "./lib/phone-harness.mjs";

const RECORD = {
  id: "105",
  from: { name: "Ann", address: "ann@example.com" },
  subject: "Hi",
  date: null,
  snippet: "",
  thread_ids: [],
  attachments: [],
  labels: { label: "normal", reasons: [] },
};

async function reads(app) {
  console.log("\n# the mail read");
  // A read names no phone: it is the mailbox, not the model, and a card cannot
  // be raised by one. The envelope says so rather than leaving it out.
  equal("a read parses", app.readPhoneRequest({ request: "r3", kind: "read", mail: true, read: { id: "105" } }), {
    request: "r3",
    mail: true,
    device: null,
    body: { kind: "read", id: "105" },
  });
  check("a read id that is not digits is answered, not parsed", app.readPhoneRequest({ request: "r4", kind: "read", read: { id: "1x" } }).body === null);
  {
    bridge.answer = async (command) => (command === "brain_mail_read" ? { for_model: [], for_ui: RECORD, is_error: false } : undefined);
    const { log, sink } = recorder(app);
    await app.runPhoneRead("105", sink, new AbortController().signal);
    equal("a read sends the record as the Mail tab has it, then done", log, [
      [
        "read",
        {
          record: { id: "105", from: { name: "Ann", address: "ann@example.com" }, subject: "Hi", date: null, snippet: "", thread_ids: [], attachments: [], labels: { label: "normal", reasons: [] } },
          body: "",
        },
      ],
      ["done", {}],
    ]);
    // The protocol's wire is snake_case (§1) and the phone's reader reads id,
    // from.name, from.address, subject, gist, date, labels.label and
    // labels.reasons — every one of those is one word and keeps its name here.
    const sent = log[0][1].record;
    check("no field of the record is left in the app's camelCase", !("threadIds" in sent), JSON.stringify(Object.keys(sent)));
    for (const field of ["id", "from", "subject", "date", "labels"]) {
      check(`the phone still reads ${field}`, field in sent, JSON.stringify(Object.keys(sent)));
    }
    check("the phone still reads from.name and from.address", "name" in sent.from && "address" in sent.from, JSON.stringify(sent.from));
    check("the phone still reads labels.label and labels.reasons", "label" in sent.labels && "reasons" in sent.labels, JSON.stringify(sent.labels));
  }
  {
    bridge.answer = async () => {
      throw { code: "mail.keychain" };
    };
    const { log, sink } = recorder(app);
    await app.runPhoneRead("105", sink, new AbortController().signal);
    equal("a failed read is its own code, once", log, [["error", { code: "mail.keychain" }]]);
  }
}

async function stoppedReads(app) {
  console.log("\n# a stopped read");
  bridge.calls.length = 0;
  {
    const controller = new AbortController();
    controller.abort();
    const { log, sink } = recorder(app);
    await app.runPhoneRead("105", sink, controller.signal);
    equal("a read stopped before it starts is cancelled and never sent", [log, bridge.calls.length], [[["error", { code: "cancelled" }]], 0]);
  }
  {
    let release;
    bridge.answer = (command) => (command === "brain_mail_read" ? new Promise((resolve) => (release = resolve)) : undefined);
    const controller = new AbortController();
    const { log, sink } = recorder(app);
    const running = app.runPhoneRead("105", sink, controller.signal);
    await tick();
    controller.abort();
    release({ for_model: [], for_ui: RECORD, is_error: false });
    await running;
    await tick();
    equal("a stop during the read ends it as cancelled, and the late answer is dropped", log, [["error", { code: "cancelled" }]]);
  }
  bridge.answer = async () => undefined;
}

async function runner(app) {
  console.log("\n# the runner");
  bridge.calls.length = 0;
  bridge.answer = async () => undefined;
  const stop = app.startPhoneChatRunner();
  check("both listeners are registered", bridge.handlers.has("phone-chat-request") && bridge.handlers.has("phone-chat-stop"));
  // **One path to the phone, and it is not this one.** A card and an outcome are
  // written straight onto the phone's own stream by the door. This used to listen
  // for a second copy of each and forward it onto that same stream, which sent
  // every phone every card twice.
  check(
    "no second road for a card or an outcome",
    !bridge.handlers.has("browser_phone_cards") && !bridge.handlers.has("browser_phone_outcome"),
    [...bridge.handlers.keys()].join(","),
  );
  emit("phone-chat-request", { request: "e1", kind: "turn", turn: { messages: [] } });
  equal("a request with a bad body is answered bad_request, not accepted", phoneEvents(), [["error", { code: "bad_request" }]]);
  bridge.calls.length = 0;
  emit("phone-chat-request", { request: "e2", kind: "turn", mail: true, turn: { messages: [USER("ciao")] } });
  await tick();
  equal("a turn is accepted, then fails at once with no door", phoneEvents(), [
    ["accepted", {}],
    ["error", { code: "engine" }],
  ]);
  bridge.calls.length = 0;
  emit("phone-chat-request", { request: "e5", kind: "read", read: { id: "105" } });
  await tick();
  equal("a read for a phone switched off the mailbox is refused, not read", phoneEvents(), [
    ["error", { code: "phone_mail_off" }],
  ]);
  check(
    "and no mail was read for it",
    bridge.calls.every((call) => call.command !== "brain_mail_read"),
    JSON.stringify(bridge.calls),
  );
  emit("phone-chat-request", { request: "e6", kind: "turn", turn: { messages: [USER("ciao")] } });
  await tick();
  check(
    "a turn from that phone is still answered: no mail is not no talk",
    phoneEvents().slice(-2)[0][0] === "accepted",
    JSON.stringify(phoneEvents()),
  );
  bridge.calls.length = 0;
  emit("phone-chat-stop", { request: "nobody" });
  emit("phone-chat-request", { kind: "turn" });
  check("a stop for an unknown request and a request with no id do nothing", bridge.calls.length === 0);
  bridge.answer = async () => {
    throw { code: "mail.keychain" };
  };
  emit("phone-chat-request", { request: "e3", kind: "read", mail: true, read: { id: "105" } });
  await tick();
  equal("a read is accepted, then answered with its code", phoneEvents().slice(-2), [
    ["accepted", {}],
    ["error", { code: "mail.keychain" }],
  ]);
  let release;
  bridge.answer = (command) => (command === "brain_mail_read" ? new Promise((resolve) => (release = resolve)) : undefined);
  bridge.calls.length = 0;
  emit("phone-chat-request", { request: "e4", kind: "read", mail: true, read: { id: "105" } });
  await tick();
  emit("phone-chat-stop", { request: "e4" });
  await tick();
  release({ for_model: [], for_ui: RECORD, is_error: false });
  await tick();
  equal("a phone's stop ends its read: accepted, cancelled once, no read sent", phoneEvents(), [
    ["accepted", {}],
    ["error", { code: "cancelled" }],
  ]);

  // **The turn runs as the phone that authenticated, whatever the body claimed.**
  // The envelope's device is what the app resolved the credential to and it is
  // what a card of this turn is stamped with; the body carries no device to
  // compete with, and one that put a number there would be parsed to null
  // before this ever runs. So a phone cannot talk itself into another phone's
  // conversation, and cannot be left out of its own.
  const turn = app.readPhoneRequest({
    request: "e8",
    device: "2",
    mail: true,
    kind: "turn",
    turn: { messages: [USER("apri il browser")], device: "7" },
  }).body;
  equal("the app's own number is the turn's", app.turnFor(turn, "2").device, "2");
  equal(
    "and the browser writes of that turn are stamped with its conversation",
    app.phoneConversation(app.turnFor(turn, "2").device),
    "phone:2",
  );
  // Belt and braces, stated as such: parsing already drops a body's device, so
  // this shape cannot reach the runner from a payload. If one ever did, the
  // app's number still overwrites it — the conversation a card is stamped with
  // is the credential's either way.
  equal(
    "a turn that somehow carried a device still runs as the phone that authenticated",
    app.turnFor({ kind: "turn", turn: { messages: [USER("hi")], replyFor: null, language: "en", device: "7" } }, "2").device,
    "2",
  );
  equal("a turn from a payload with no device is run with none", app.turnFor(app.readPhoneRequest({ request: "e9", mail: true, kind: "turn", turn: { messages: [USER("hi")] } }).body, null).device, null);

  bridge.answer = async () => undefined;
  await stop();
  // Both listeners and no more: a card and an outcome are the phone's own
  // stream's business, and a listener left behind would keep answering a window
  // nobody is running.
  check(
    "stopping removes every listener",
    bridge.unlistened === 2 && bridge.handlers.size === 0,
    `unlistened=${bridge.unlistened} handlers=${bridge.handlers.size}`,
  );
}

await withPhone(async (app) => {
  await reads(app);
  await stoppedReads(app);
  await runner(app);
});
summary();
