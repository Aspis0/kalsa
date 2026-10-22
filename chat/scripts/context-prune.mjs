// The turns the fit left behind: the number the thread says, and the rule that
// says it, against the real fit, the real store and the real turn engine.
//
// `dropped` used to count MESSAGES, and the line the person reads says
// exchanges. A turn is a user message with its answer, so the count is turns:
// the user message is the one that counts, and an answer whose user message is
// already gone counts for nothing. The line is UI only — the marker is a number
// on the answering row, and the wire never reads it — so the bench also proves
// the wire is byte-identical with the marker and without it.
//
// **Nothing here is a re-implementation.** The fit is `buildPinnedContext`, the
// store is `createStore`, the engine is `useChatTurns` mounted by the app's own
// React. Only the engine's endpoint is a stub, because there is no model here.
//
// Two negative controls compile one rule out of the app and show the bench
// notices: the old message count, and the store line that keeps the count.
//
// Run: node scripts/context-prune.mjs   (from chat/)

import { rm } from "node:fs/promises";
import { loadApp } from "./lib/app-bundle.mjs";

let failures = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

// **The app is a webview.** Conversations live in `localStorage` and the
// language is the system's; the store and the engine both read them.
const storage = new Map();
globalThis.localStorage = {
  get length() {
    return storage.size;
  },
  key: (index) => [...storage.keys()][index] ?? null,
  getItem: (key) => (storage.has(key) ? storage.get(key) : null),
  setItem: (key, value) => {
    storage.set(key, String(value));
  },
  removeItem: (key) => {
    storage.delete(key);
  },
  clear: () => {
    storage.clear();
  },
};
Object.defineProperty(globalThis, "navigator", {
  value: { languages: ["en-US"], language: "en-US" },
  configurable: true,
  writable: true,
});
globalThis.window = { setTimeout, clearTimeout, addEventListener: () => {} };

const dirs = [];
const main = await loadApp();
dirs.push(main.dir);

try {
  const { app } = main;
  const { buildPinnedContext, wireSize, ANSWER_RESERVE_TOKENS, pruneNotice, createStore, useChatTurns, LanguageProvider, renderToStaticMarkup, createElement, TABLES } = app;

  // Big enough that a window can be made to cut exactly where the case needs.
  const WORDS = "parola lunga ".repeat(300);
  const message = (id, role, label) => ({ id, role, content: `${label}: ${WORDS}`, createdAt: 0 });
  const users = (messages) => messages.filter((m) => m.role === "user").length;
  const fit = (messages, nctx, media, tools) => buildPinnedContext(messages, [], nctx, media, 0, 0, tools);

  // Two user messages in a row (u2 is asked and not answered): a turn is a
  // user message, so there are four turns and seven messages.
  const HISTORY = [
    message("u1", "user", "U1"),
    message("a1", "assistant", "A1"),
    message("u2", "user", "U2"),
    message("u3", "user", "U3"),
    message("a3", "assistant", "A3"),
    message("u4", "user", "U4"),
    message("a4", "assistant", "A4"),
  ];
  // The window that keeps exactly the last turn (u4, a4): the answer's reserve,
  // that turn's weight, and a little slack so no older turn squeezes in.
  const suffixTokens = buildPinnedContext(HISTORY.slice(5), [], null).historyTokens;
  const WINDOW_FOR_LAST_TURN = ANSWER_RESERVE_TOKENS + suffixTokens + 50;

  console.log("1. the history fits: nothing is counted");
  {
    const roomy = fit(HISTORY, 1_000_000);
    check("the fit answers ok", roomy.status === "ok");
    check("nothing dropped, so nothing counted", roomy.status === "ok" && roomy.dropped === 0, String(roomy.dropped));
  }

  console.log("\n2. the count is TURNS, not messages");
  {
    const pruned = fit(HISTORY, WINDOW_FOR_LAST_TURN);
    const kept = pruned.wire.slice(1); // the system message is not history
    const droppedTurns = users(HISTORY) - users(kept);
    const droppedMessages = HISTORY.length - kept.length;
    check("the history was cut (a prune happened)", kept.length < HISTORY.length, `${kept.length} of ${HISTORY.length} kept`);
    check("the kept history starts at a user message", kept[0]?.role === "user");
    check(
      "dropped is the turns that went (u1+a1, u2, u3+a3 = 3)",
      pruned.dropped === droppedTurns && droppedTurns === 3,
      `dropped ${pruned.dropped}, turns that went ${droppedTurns}`,
    );
    check(
      "and it is NOT the messages that went",
      pruned.dropped !== droppedMessages,
      `${droppedMessages} messages went, dropped reads ${pruned.dropped}`,
    );

    // An answer whose user message is already gone belongs to no turn.
    const ORPHAN = [message("a0", "assistant", "A0"), message("u1", "user", "U1"), message("a1", "assistant", "A1")];
    const orphanWindow = ANSWER_RESERVE_TOKENS + buildPinnedContext(ORPHAN.slice(1), [], null).historyTokens + 50;
    const orphan = fit(ORPHAN, orphanWindow);
    check(
      "an orphaned answer counts for no turn (only a0 went, dropped 0)",
      orphan.status === "ok" && orphan.wire.length - 1 === 2 && orphan.dropped === 0,
      `kept ${orphan.status === "ok" ? orphan.wire.length - 1 : "refused"}, dropped ${orphan.status === "ok" ? orphan.dropped : "-"}`,
    );
  }

  console.log("\n3. the row exists only when a turn was left behind");
  {
    const EN = TABLES.en.tools.recap;
    check("zero → no row", pruneNotice(0, EN) === null);
    check("negative → no row", pruneNotice(-1, EN) === null);
    const three = pruneNotice(3, EN);
    check("three → a row that carries the 3", typeof three === "string" && three.includes("3"), JSON.stringify(three));
  }

  console.log("\n4. the same in all five languages");
  {
    const english = pruneNotice(3, TABLES.en.tools.recap);
    for (const tag of ["en", "it", "es", "fr", "zh"]) {
      const words = TABLES[tag].tools.recap;
      const hasKey = typeof words.leftBehind === "function";
      check(`${tag}: the key exists`, hasKey);
      if (!hasKey) continue;
      check(`${tag}: zero → no row`, pruneNotice(0, words) === null);
      const row = pruneNotice(3, words);
      check(`${tag}: three → a row that carries the 3`, typeof row === "string" && row.trim() !== "" && row.includes("3"), JSON.stringify(row));
      if (tag !== "en") check(`${tag}: not the English sentence`, row !== english);
      // One exchange is its own sentence: the singular form, not the plural
      // with a 1 in it. The owner's copy has no numeral at n = 1 ("the first
      // exchange"), so the row is checked for being there and for being
      // another sentence, not for a digit.
      const single = pruneNotice(1, words);
      check(`${tag}: one → a row (the singular sentence)`, typeof single === "string" && single.trim() !== "", JSON.stringify(single));
      check(`${tag}: one and three are different sentences`, single !== row, JSON.stringify(single));
    }
  }

  console.log("\n5. ZERO tokens to the wire");
  {
    const MARKED = HISTORY.map((m) => (m.role === "assistant" ? { ...m, prunedTurns: 4242 } : m));
    const plain = fit(HISTORY, WINDOW_FOR_LAST_TURN);
    const marked = fit(MARKED, WINDOW_FOR_LAST_TURN);
    const plainWire = JSON.stringify(plain.wire);
    const markedWire = JSON.stringify(marked.wire);
    check("the wire is byte-identical with the marker and without it", plainWire === markedWire);
    check("and it weighs the same", wireSize(plain.wire) === wireSize(marked.wire), `${wireSize(plain.wire)} vs ${wireSize(marked.wire)}`);
    check("the field name is not on the wire", !markedWire.includes("prunedTurns"));
    check("the number is not on the wire", !markedWire.includes("4242"));
    check("the fit weighs the same history", plain.historyTokens === marked.historyTokens);
  }

  console.log("\n6. the count survives a reload");
  const RELOAD = "c-reload";
  {
    const a1 = HISTORY[1];
    const a4 = HISTORY[6];
    createStore().put({
      id: RELOAD,
      title: "Reload",
      createdAt: 0,
      updatedAt: 0,
      messages: [HISTORY[0], { ...a1, prunedTurns: 0 }, HISTORY[5], { ...a4, prunedTurns: 3 }],
    });
    const reread = createStore().get(RELOAD).messages;
    check("a fresh store reads the count back", reread.find((m) => m.id === "a4")?.prunedTurns === 3, String(reread.find((m) => m.id === "a4")?.prunedTurns));
    check("a zero is not kept (nothing was left behind)", reread.find((m) => m.id === "a1")?.prunedTurns === undefined);
  }
  {
    // The negative control: the store line that keeps the count, compiled out.
    const blind = await loadApp({
      compileOut: { file: "store.ts", from: "? { prunedTurns: value.prunedTurns }", to: "? {}" },
    });
    dirs.push(blind.dir);
    const lost = blind.app.createStore().get(RELOAD).messages.find((m) => m.id === "a4")?.prunedTurns;
    check("negative control: without the store line the count is lost", lost === undefined, String(lost));
  }

  console.log("\n7. the dry fit and the real fit agree on the count");
  {
    const dry = fit(HISTORY, WINDOW_FOR_LAST_TURN, { vision: false, think: false, url: () => null });
    const real = fit(HISTORY, WINDOW_FOR_LAST_TURN, { vision: false, think: false, url: () => "data:image/png;base64,AAAA" });
    check("one number, not two", dry.dropped === real.dropped && dry.dropped === 3, `dry ${dry.dropped}, real ${real.dropped}`);
  }
  {
    // The negative control for the counter: the old message count, compiled in.
    const oldCount = await loadApp({
      compileOut: { file: "lib/attachments.ts", from: 'if (shed.role === "user") dropped++;', to: "dropped++;" },
    });
    dirs.push(oldCount.dir);
    const counted = oldCount.app.buildPinnedContext(HISTORY, [], WINDOW_FOR_LAST_TURN).dropped;
    check("negative control: the old counter reads messages (5), and check 2 would fail it", counted === 5, `old counter reads ${counted}`);
  }

  console.log("\n8. the engine writes the count on the answer, and the request carries the cut");
  {
    const ENDPOINT = "http://127.0.0.1:9/v1/chat/completions";
    const requests = [];
    globalThis.fetch = async (_url, init) => {
      const body = JSON.parse(init.body);
      requests.push(body);
      const frames = [
        { prompt_progress: { total: Math.ceil(JSON.stringify(body).length / 4), cache: 0, processed: 1, time_ms: 1 } },
        { choices: [{ index: 0, delta: { content: "Fatto." } }] },
        { choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
      ];
      const text = `${frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join("")}data: [DONE]\n\n`;
      return new Response(text, { headers: { "Content-Type": "text/event-stream" } });
    };
    const engineStore = createStore();
    const CONVERSATION = "c-engine";
    const ANSWER = "a-engine";
    engineStore.put({
      id: CONVERSATION,
      title: "Engine",
      createdAt: 0,
      updatedAt: 0,
      messages: [...HISTORY, { id: ANSWER, role: "assistant", content: "", createdAt: 0 }],
    });
    // The window the engine reads, kept in a Map the test can change between
    // runs: the second run is a retry with room to spare.
    const sizes = new Map([[ENDPOINT, 8192]]);
    let engine = null;
    function Harness() {
      engine = useChatTurns({
        store: engineStore,
        announce: () => {},
        contextSizes: { current: sizes },
        saveMailDraft: () => {},
      });
      return null;
    }
    renderToStaticMarkup(createElement(LanguageProvider, { children: createElement(Harness) }));
    await engine.runAssistant(CONVERSATION, ANSWER, { endpoint: ENDPOINT, token: "", model: "test-model", webTools: false }, false, false);

    const sent = requests[0];
    const before = engineStore.get(CONVERSATION).messages.filter((m) => m.id !== ANSWER);
    const dry = fit(before, 8192, { vision: false, think: false, url: () => null }, sent?.tools ?? []);
    const row = engineStore.get(CONVERSATION).messages.find((m) => m.id === ANSWER);
    check("the turn ran out of room on its own", dry.dropped > 0, `dry dropped ${dry.dropped}`);
    check("the answer row carries the count the dry fit measured", row?.prunedTurns === dry.dropped, `row ${row?.prunedTurns}, dry ${dry.dropped}`);
    check(
      "the request sent carries the turns the row says were left behind",
      sent !== undefined && users(sent.messages) === users(HISTORY) - (row?.prunedTurns ?? 0),
      `users sent ${sent ? users(sent.messages) : "none"}`,
    );
    check("the request does not carry the marker", sent !== undefined && !JSON.stringify(sent).includes("prunedTurns"));

    // **A retry reuses this row.** With room to spare the retry prunes nothing,
    // so the count the first try left must not stay on the row.
    sizes.set(ENDPOINT, 1_000_000);
    await engine.runAssistant(CONVERSATION, ANSWER, { endpoint: ENDPOINT, token: "", model: "test-model", webTools: false }, false, false);
    const retried = engineStore.get(CONVERSATION).messages.find((m) => m.id === ANSWER);
    check("a retry that prunes nothing clears the count the first try left", retried?.prunedTurns === undefined, String(retried?.prunedTurns));
    check("and the retry's request carries every turn", users(requests[1].messages) === users(HISTORY), `users sent ${users(requests[1].messages)}`);
  }

  console.log(failures === 0 ? "\ncontext-prune: all checks passed" : `\ncontext-prune: ${failures} FAILED`);
} finally {
  for (const dir of dirs) await rm(dir, { recursive: true, force: true });
}

process.exit(failures === 0 ? 0 : 1);
