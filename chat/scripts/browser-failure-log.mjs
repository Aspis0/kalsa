// A failed browser call writes one fixed code to the `ui:` line, and the log
// promises that nothing the call said ever reaches it: both are checked here.
//
// Run: node scripts/browser-failure-log.mjs   (from chat/)

import { rm } from "node:fs/promises";
import { loadApp } from "./lib/app-bundle.mjs";

const { dir, app } = await loadApp();
const {
  runToolCall,
  executeToolCall,
  accumulate,
  repairToolCall,
  guideCut,
  guideNotValidJson,
  guideProblem,
  logProvenanceFailure,
  newLedger,
  filed,
  decide,
  BROWSER_TOOLS,
  TOOL_DEFINITIONS,
} = app;

let fail = 0;
function check(label, ok, detail) {
  if (!ok) fail++;
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${ok || detail === undefined ? "" : `\n     ${detail}`}`);
}
function equal(label, actual, expected) {
  check(
    label,
    JSON.stringify(actual) === JSON.stringify(expected),
    `got ${JSON.stringify(actual)}\n     want ${JSON.stringify(expected)}`,
  );
}

const OPEN = BROWSER_TOOLS.find((tool) => tool.function.name === "browser_open");
const SEARCH = TOOL_DEFINITIONS.find((tool) => tool.function.name === "web_search");

const PHRASES = {
  noRoundLeft: "Kalsa couldn't finish checking. Ask again.",
  turnEnded: "Kalsa couldn't finish checking. Ask again.",
  nameNeverArrived: "Kalsa couldn't finish checking. Ask again.",
  stopped: "You stopped this before Kalsa finished.",
  argumentsTooLong: "That was too long for Kalsa to check. Try a shorter search or address.",
  argumentsNotValid: "Kalsa couldn't finish checking. Ask again.",
  notOffered: "That tool is not available now. Answer without it.",
};

/** Every code the page handed to the log, in the order it handed them over. */
const LOGGED = [];
/** What the sidecar answers a browser_open with; an error is thrown instead. */
let openError = null;

globalThis.window = {
  setTimeout,
  clearTimeout,
  __TAURI__: {
    core: {
      invoke: async (command, args) => {
        if (command === "brain_log_event") {
          LOGGED.push(args.code);
          return null;
        }
        if (command === "brain_browser_open") {
          if (openError !== null) throw openError;
          return "PAGE TEXT";
        }
        return null;
      },
    },
  },
};

/** The codes written since the last mark, so each case is judged on its own. */
function mark() {
  return LOGGED.length;
}
function since(at) {
  return LOGGED.slice(at);
}

/** One call through the real `runToolCall`, and what it left behind. */
async function throughRunToolCall(definition, delta) {
  const at = mark();
  const ran = [];
  const runs = [];
  const [call] = accumulate([], [delta]);
  const answer = await runToolCall(
    call,
    definition,
    {
      say: PHRASES,
      runTool: async (name) => {
        ran.push(name);
        return { text: "RAN", ok: true };
      },
      onToolRun: (run) => runs.push(run),
      signal: new AbortController().signal,
      url: "http://127.0.0.1:1/v1/chat/completions",
      conversation: [],
    },
  );
  return { call, answer, ran, runs, codes: since(at) };
}

/** One call through the real registry, and what it left behind. */
async function throughRegistry(args, gate, conversation, signal) {
  const at = mark();
  const outcome = await executeToolCall(
    "browser_open",
    args,
    signal,
    gate,
    conversation,
    "any-model",
    undefined,
    undefined,
    true,
  );
  return { outcome, codes: since(at) };
}

const USER = [{ role: "user", content: "Read https://news.example/story" }];
const LIT_BROWSER_UNSEEN =
  "Not run: this address has not appeared in the conversation, so it did not open the way you asked. Do not open it again, and do not try another form of it: the same address will not open the second time either. If the page in front of you carries the link, use browser_read or browser_find to find it and click its ref. Otherwise ask the person for the exact address, written out whole, and open that — or open another address they gave you. A shorter form opens only when it is the same http or https address, spelled the same way, with no query of its own, and with the last piece of its path already printed in a link you have read: the product's own address, for example https://shop.example/dp/B012345678.";

/** A gate that asks the owner and says no. */
const refusingGate = {
  documents: () => [{ id: "doc-1", name: "the lease" }],
  confirm: async () => false,
  firstSearch: async () => true,
};

try {
  // --- the guides: a call that never ran -------------------------------------
  {
    const long = JSON.stringify({ url: `https://example.com/${"x".repeat(app.MAX_ARGUMENTS)}` });
    const cut = await throughRunToolCall(OPEN, {
      index: 0,
      id: "cut-1",
      function: { name: "browser_open", arguments: long },
    });
    check("a call longer than the cap is cut", cut.call.cut === true);
    equal("a cut call writes the cut code", cut.codes, ["chat.browser_failure.arguments_cut"]);
    equal("a cut call never ran", cut.ran, []);
    equal("a cut call answers with the cut guide", cut.answer.result, guideCut(OPEN));
    equal("a cut call's wire is empty", cut.answer.wire, "{}");
    equal("a cut call is recorded as failed", cut.runs.at(-1)?.state, "failed");
  }

  {
    const broken = await throughRunToolCall(OPEN, {
      index: 0,
      id: "json-1",
      function: { name: "browser_open", arguments: '{"url":' },
    });
    equal("broken JSON writes the json code", broken.codes, ["chat.browser_failure.arguments_json"]);
    equal("a broken call never ran", broken.ran, []);
    equal("a broken call answers with the json guide", broken.answer.result, guideNotValidJson(OPEN));
    equal("a broken call's wire is empty", broken.answer.wire, "{}");
  }

  {
    const text = '{"url":{"deep":"object"}}';
    const schema = await throughRunToolCall(OPEN, {
      index: 0,
      id: "schema-1",
      function: { name: "browser_open", arguments: text },
    });
    const problems = repairToolCall(JSON.parse(text), OPEN.function.parameters).problems;
    equal("a bad field writes the schema code", schema.codes, ["chat.browser_failure.arguments_schema"]);
    equal("a bad field never ran", schema.ran, []);
    equal("a bad field answers with the schema guide", schema.answer.result, guideProblem(OPEN, problems));
    equal("a bad field's wire is the model's own text", schema.answer.wire, text);
  }

  {
    const other = await throughRunToolCall(SEARCH, {
      index: 0,
      id: "json-2",
      function: { name: "web_search", arguments: '{"query":' },
    });
    equal("another tool's broken arguments write no browser code", other.codes, []);
  }

  // --- the registry: a call that reached the browser --------------------------
  {
    const empty = await throughRegistry({ url: "   " }, null, USER);
    equal("an empty address writes the empty code", empty.codes, ["chat.browser_failure.open_empty"]);
    equal("and the refusal is unchanged", empty.outcome.text, "No page was opened: the address was empty.");
    equal("and it carries no result code", empty.outcome.resultCode, undefined);
  }

  {
    const unseen = await throughRegistry({ url: "https://model.example/invented" }, null, USER);
    equal("an unseen address writes the unseen code", unseen.codes, ["chat.browser_failure.open_unseen"]);
    equal("and the browser recovery sentence is carried", unseen.outcome.text, LIT_BROWSER_UNSEEN);
    equal("and it keeps the refusal's own code", unseen.outcome.resultCode, "web.link_unseen");
  }

  {
    const userinfo = await throughRegistry({ url: "https://name:word@news.example/story" }, null, USER);
    equal("an address with a userinfo writes the userinfo code", userinfo.codes, [
      "chat.browser_failure.open_userinfo",
    ]);
    equal("and it keeps the refusal's own code", userinfo.outcome.resultCode, "web.link_userinfo");
  }

  {
    const credential = await throughRegistry({ url: "https://news.example/story?token=sekret-value-123" }, null, USER);
    equal("an address with a credential writes the credential code", credential.codes, [
      "chat.browser_failure.open_credential",
    ]);
    equal("and it keeps the refusal's own code", credential.outcome.resultCode, "web.link_credential");
  }

  {
    const held = await throughRegistry({ url: "https://news.example/story" }, refusingGate, USER);
    equal("a denied ask writes the gate code", held.codes, ["chat.browser_failure.open_gate"]);
    check("and the refusal is unchanged", held.outcome.ok === false && /did not allow/i.test(held.outcome.text), held.outcome.text);
    check("the refusal carries the address", held.outcome.text.includes("https://news.example/story"), held.outcome.text);
  }

  {
    openError = { code: "browser.no_page", text: "There is no page there to read." };
    const coded = await throughRegistry({ url: "https://news.example/story" }, null, USER);
    openError = null;
    equal("a coded browser failure writes no diagnostic", coded.codes, []);
    equal("and it keeps the browser's own code", coded.outcome.resultCode, "browser.no_page");
    check("and the refusal is still fenced", coded.outcome.text.includes("There is no page there to read."), coded.outcome.text);
  }

  {
    openError = new Error("token-abc123 exploded");
    const broke = await throughRegistry({ url: "https://news.example/story" }, null, USER);
    openError = null;
    equal("a failure with no code writes the uncoded code", broke.codes, ["chat.browser_failure.open_uncoded"]);
    check("and the refusal still carries the reason", broke.outcome.ok === false && broke.outcome.text.includes("token-abc123 exploded"), broke.outcome.text);
    equal("and it carries no result code", broke.outcome.resultCode, undefined);
  }

  {
    const controller = new AbortController();
    const stopping = {
      documents: () => [{ id: "doc-1", name: "the lease" }],
      confirm: async () => {
        controller.abort();
        return true;
      },
      firstSearch: async () => true,
    };
    const stopped = await throughRegistry({ url: "https://news.example/story" }, stopping, USER, controller.signal);
    equal("a Stop during the ask writes no gate code", stopped.codes, []);
    equal("and the call is the stopped one", stopped.outcome.text, "Stopped before this finished.");
  }

  {
    const ok = await throughRegistry({ url: "https://news.example/story" }, null, USER);
    check("a call that worked runs", ok.outcome.ok === true, ok.outcome.text);
    equal("and writes no diagnostic at all", ok.codes, []);
  }

  // --- what the log may carry -------------------------------------------------
  {
    const EXPECTED = [
      "chat.browser_failure.arguments_cut",
      "chat.browser_failure.arguments_json",
      "chat.browser_failure.arguments_schema",
      "chat.browser_failure.open_empty",
      "chat.browser_failure.open_unseen",
      "chat.browser_failure.open_userinfo",
      "chat.browser_failure.open_credential",
      "chat.browser_failure.open_gate",
      "chat.browser_failure.open_uncoded",
    ];
    equal("the codes written are the closed set", [...new Set(LOGGED)].sort(), [...EXPECTED].sort());
    equal("one code per failed call, and none for the calls that worked", LOGGED.length, 9);

    const FORBIDDEN = [
      "news.example",
      "model.example",
      "example.com",
      "token-abc123",
      "sekret-value-123",
      "exploded",
      "browser_open",
      "web.link_unseen",
      "web.link_userinfo",
      "web.link_credential",
      "url",
      "deep",
      "object",
    ];
    for (const code of LOGGED) {
      check(`the code "${code}" is shaped like a code`, /^[a-z0-9_.]{1,64}$/.test(code), code);
      for (const word of FORBIDDEN) {
        check(`the code "${code}" carries no "${word}"`, !code.includes(word), code);
      }
    }
  }

  {
    const at = mark();
    logProvenanceFailure("web.link_something_new");
    const codes = since(at);
    equal("a refusal the rule does not name falls back to one fixed category", codes, [
      "chat.browser_failure.open_provenance",
    ]);
    check("and the rule's own code never reaches the log", !codes.some((code) => code.includes("something_new")), JSON.stringify(codes));
  }

  // --- the refusal sends the model somewhere else -----------------------------
  //
  // The owner's test of 21 October: a turn that named a service instead of an
  // address was refused here nine times in a minute, each time with a
  // different address the model had made up, and the person saw nothing but
  // "Kalsa could not do it. Try again." **The refusal is where the model is
  // redirected**, so it has to say three things: the address did not open as
  // asked, the same address will not open the second time either, and the way
  // through is the person's own address.
  {
    const text = LIT_BROWSER_UNSEEN;
    check("the refusal says the address did not open as asked", text.includes("did not open the way you asked"), text);
    check("and says not to open it again", text.includes("Do not open it again"), text);
    check("and says not to make up another form of it", text.includes("do not try another form of it"), text);
    check("and names the person's own address as the way through", text.includes("ask the person for the exact address"), text);
    check("and leaves the other address they gave open", text.includes("or open another address they gave you"), text);
  }

  // **The offer says how to build an address**, so the model does not have to
  // guess one: a whole URL, with the spaces written as %20, and the name of a
  // place is not an address.
  {
    const description = OPEN.function.description;
    check("the open's own description says to build a whole address", description.includes("whole URL"), description);
    check("and says how the spaces are written", description.includes("%20"), description);
    check("and says to ask the person when only a name is known", description.includes("ask the person for the exact address"), description);
    check("and says a made-up address will not open", description.includes("will not open"), description);
  }

  // **The ledger keeps the refusal dead.** The same address a second time is
  // refused with the reason it failed the first time — and nothing else in the
  // turn's budget is spent on it. The unseen address is not the one call worth
  // another try: that one is the open whose read the driver did not answer.
  {
    const ledger = newLedger();
    filed(
      ledger,
      "browser_open",
      { url: "https://model.example/invented" },
      { text: LIT_BROWSER_UNSEEN, ok: false, resultCode: "web.link_unseen" },
    );
    const said = decide(ledger, "browser_open", { url: "https://model.example/invented" });
    check("an unseen address is not asked a second time", said.run === false, JSON.stringify(said));
    equal("and the refusal keeps its own reason", said.said, "web.link_unseen");
    equal("and the refusal cost the turn one step", ledger.spent, 1);
  }
} finally {
  await rm(dir, { recursive: true, force: true });
}

console.log(fail ? `\n${fail} failed` : "\nall browser failure diagnostics passed");
process.exit(fail ? 1 : 0);
