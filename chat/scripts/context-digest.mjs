// The digest: the facts an earlier exchange carried out of the window, picked
// again for the turn that asks, and added at the head of that turn's own
// message. Against the real fit, the real settings loader and the real
// retriever — nothing here re-implements them.
//
// What is checked: the gate (off means no block, and nothing to pick means no
// block), the cases the plan names (a price the window cut, found by the query
// that names it; accents both ways; a typo; a short follow-up; a generic query
// that must not pull half the conversation; adjacent and repeated sentences
// said once), what is never searched (tool results, documents, and any turn
// that ran mail), the budget, the stamps, and the wire: with nothing cut the
// wire is byte-identical with the switch on and off, and when something was cut
// the two differ in the tail block alone.
//
// Run: node scripts/context-digest.mjs   (from chat/)

import { rm } from "node:fs/promises";
import { loadApp } from "./lib/app-bundle.mjs";

let failures = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

// `loadSettings` reads the webview's localStorage; the mock is put back at the end.
const realStorage = globalThis.localStorage;
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

const dirs = [];
const main = await loadApp();
dirs.push(main.dir);

try {
  const {
    digestForTurn,
    withDigest,
    DIGEST_CAP_TOKENS,
    DIGEST_HEADER,
    buildPinnedContext,
    ANSWER_RESERVE_TOKENS,
    loadSettings,
  } = main.app;

  const m = (id, role, content, extra = {}) => ({ id, role, content, createdAt: 0, ...extra });

  // Ten messages, five exchanges, in the Italian a person writes: names, euro
  // prices, accents, a typo, a short follow-up.
  const CONVERSATION = [
    m("u1", "user", "Ciao! Stavo cercando un lettore ebook. Mi dici il prezzo del Kindle Paperwhite?"),
    m("a1", "assistant", "Certo. Il Kindle Paperwhite costa 149,99 € su Amazon. Ha uno schermo da 6,8 pollici e la luce regolabile. Il prezzo è sceso a 119 euro nel weekend."),
    m("u2", "user", "E la Kobo Clara?"),
    m("a2", "assistant", "La Kobo Clara costa 129 euro. È più leggera del Kindle. Ha la retroilluminazione."),
    m("u3", "user", "Perché il caffè in Italia è così amaro?"),
    m("a3", "assistant", "Il caffè è amaro per la tostatura scura e l'estrazione. Dipende anche dalla miscela."),
    m("u4", "user", "Ok grazie. Qual è il secondo modello più economico?"),
    m("a4", "assistant", "Il secondo modello è il Kobo Libra, da 179 euro."),
    m("u5", "user", "Va bene. Ora parliamo di Milano e del meteo."),
    m("a5", "assistant", "Milano oggi è coperta. Nessuna novità sul meteo di domani."),
  ];
  // What the window cut: the first four exchanges. What it kept: the last one.
  const SHED = CONVERSATION.slice(0, 8);
  const KEPT = CONVERSATION.slice(8);
  const askWith = (text) => [...KEPT, m("uq", "user", text)];
  const blockFor = (query, cap) => digestForTurn(true, SHED, askWith(query), cap);
  const isPicked = (block, text) => block.includes(text);

  console.log("1. the gate: off means no block, nothing cut means no block");
  {
    const off = digestForTurn(false, SHED, askWith("Quanto costava il Kindle Paperwhite?"));
    check("switch off: no block, whatever the query", off === "", JSON.stringify(off));
    const none = digestForTurn(true, [], askWith("Quanto costava il Kindle Paperwhite?"));
    check("switch on, nothing left behind: no block", none === "", JSON.stringify(none));
    const silent = digestForTurn(true, SHED, askWith("Buongiorno, tutto a posto?"));
    check("switch on, nothing in the cut matches: no block", silent === "", JSON.stringify(silent));
  }

  console.log("\n2. the price the window cut comes back for the query that names it");
  {
    const block = blockFor("Quanto costava il Kindle Paperwhite su Amazon?");
    check("the block opens with the fixed header", block.startsWith(DIGEST_HEADER));
    check("the price sentence is there, verbatim", isPicked(block, "[turn 1, assistant] Il Kindle Paperwhite costa 149,99 € su Amazon."));
    const kept = blockFor("Milano e il meteo di domani?");
    check("the kept exchange is never searched: its own words find nothing in the cut", !kept.includes("Milano") && !kept.includes("[turn 5"), JSON.stringify(kept));
  }

  console.log("\n3. accents fold both ways: «caffe» finds «caffè», «caffè» finds «caffe»");
  {
    const plain = blockFor("perche il caffe e amaro?");
    check("unaccented query finds the accented sentence", isPicked(plain, "[turn 3, assistant] Il caffè è amaro per la tostatura scura e l'estrazione."), plain.slice(0, 200));
    const accented = digestForTurn(true, [m("x1", "user", "Caffe amaro, perche?"), m("x2", "assistant", "Il caffe è corretto.")], askWith("il caffè è amaro?"));
    check("accented query finds the unaccented sentence", accented.includes("[turn 1, assistant] Il caffe è corretto."), accented);
  }

  console.log("\n4. a typo still finds the word");
  {
    const block = blockFor("quanto costava il Kndle Paperwhite?");
    check("«Kndle» finds «Kindle»", isPicked(block, "[turn 1, assistant] Il Kindle Paperwhite costa 149,99 € su Amazon."), block.slice(0, 200));
  }

  console.log("\n5. a short follow-up finds the sentence it means");
  {
    const block = blockFor("e il secondo?");
    check("«il secondo» finds the second model", isPicked(block, "[turn 4, assistant] Il secondo modello è il Kobo Libra, da 179 euro."), block);
    check("and the question that asked it, stamped as the user's", isPicked(block, "[turn 4, user] Qual è il secondo modello più economico?"), block);
  }

  console.log("\n6. a generic query does not pull back half the conversation");
  {
    const block = blockFor("Ciao, va bene così, grazie!");
    const lines = block.split("\n").slice(1).filter((line) => line !== "");
    check("a thank-you finds at most the thank-you turn", lines.length <= 2, `${lines.length} lines`);
    check("and no price, no coffee, no Kobo", !block.includes("149,99") && !block.includes("caffè") && !block.includes("Kobo"), JSON.stringify(block));
  }

  console.log("\n7. sentences said twice are said once");
  {
    const SAID = [
      m("r1", "user", "Quanto costa?"),
      m("r2", "assistant", "Il Kindle costa 149,99 € su Amazon. Il Kindle costa 149,99 € su Amazon."),
      m("r3", "user", "Ancora?"),
      m("r4", "assistant", "Il Kindle costa 149,99 € su Amazon."),
    ];
    const block = digestForTurn(true, SAID, askWith("Il Kindle costa quanto su Amazon?"));
    const copies = block.split("Il Kindle costa 149,99").length - 1;
    check("the same price in adjacent and repeated sentences is carried once", copies === 1, `${copies} copies`);
  }

  console.log("\n8. the cap holds");
  {
    // Sixty sentences, each with its own made-up model name, and a question that
    // names all sixty: every sentence matches its own word and no other, so they
    // score alike and only the cap can stop them. (A word every sentence shares
    // is worth almost nothing to BM25, and the best match sets the bar.)
    const names = Array.from({ length: 60 }, (_, i) => `mod${(i * 7919 + 17).toString(36)}`);
    const bulk = names.map((name, i) => m(`b${i}`, "assistant", `Il ${name} costa ${100 + i} euro.`));
    const wide = [m("w0", "user", "Confronto?"), ...bulk];
    const question = `Quanto costano ${names.join(" ")}?`;
    const block = digestForTurn(true, wide, askWith(question), 120);
    const tokens = Math.ceil(block.length / 3.5);
    check("a 120-token cap is held (chars ÷ 3.5)", block !== "" && tokens <= 120, `${tokens} tokens, ${block.length} chars`);
    const roomy = digestForTurn(true, wide, askWith(question), DIGEST_CAP_TOKENS);
    check("the default cap is 400 tokens", DIGEST_CAP_TOKENS === 400);
    check("and the same question with the default cap carries more", roomy.length > block.length, `${roomy.length} vs ${block.length} chars`);
    check("and the default block is held to the cap too", Math.ceil(roomy.length / 3.5) <= DIGEST_CAP_TOKENS, `${Math.ceil(roomy.length / 3.5)} tokens`);
  }

  console.log("\n9. tool results, documents and mail are never searched");
  {
    // A browser turn: the page's own text is a tool result, and it stays out.
    // The model's words about the same product are the conversation's, and they ride.
    const page = "Kindle Paperwhite 16 GB: 119,99 euro, spedizione gratuita.";
    const run = { id: "t1", name: "browser_read", arguments: "{}", result: page, state: "done" };
    const browsed = [
      m("p1", "user", "Apri la pagina del Kindle."),
      m("p2", "assistant", "Il Kindle Paperwhite 16 GB è a 119,99 euro, con spedizione gratuita.", { toolRuns: [run] }),
    ];
    const fromPage = digestForTurn(true, browsed, askWith("quanto costa il Kindle Paperwhite 16 GB?"));
    check("the page's own words are not carried", !fromPage.includes(page) && !fromPage.includes("[turn 1, tool]"), fromPage);
    check("the model's words about the page are, stamped as its own", isPicked(fromPage, "[turn 1, assistant] Il Kindle Paperwhite 16 GB è a 119,99 euro, con spedizione gratuita."), fromPage);

    // A document the turn carried: its text is not in the message's words, and
    // the digest reads only the words, so the document's sentence cannot ride.
    const doc = { id: "d1", name: "offerta.txt", kind: "txt", chars: 40, tokens: 12, text: "Offerta valida fino al 30 novembre.", attachedAt: 0, active: false };
    const withDoc = [m("q1", "user", "Ecco l'offerta.", { docs: [doc.id] }), m("q2", "assistant", "Letto.")];
    const fromDoc = digestForTurn(true, withDoc, askWith("fino a quando vale l'offerta valida?"));
    check("a document's text is not carried", !fromDoc.includes("Offerta valida") && !fromDoc.includes("30 novembre"), fromDoc);

    // A mail turn: the mail read is a tool call, and the model's words about the
    // mail are the owner's too. The whole turn is skipped.
    const mailRun = { id: "t2", name: "mail_show", arguments: "{}", result: "Mario: il contratto costa 900 euro.", state: "done", mail: { kind: "cards" } };
    const mailed = [
      m("k1", "user", "Leggi la mail di Mario."),
      m("k2", "assistant", "Mario scrive che il contratto costa 900 euro.", { toolRuns: [mailRun] }),
    ];
    const fromMail = digestForTurn(true, mailed, askWith("quanto costa il contratto di Mario?"));
    check("a turn that ran mail is not searched at all", fromMail === "", fromMail);
  }

  console.log("\n10. the wire: identical with nothing cut, and different only in the tail block");
  {
    const roomy = buildPinnedContext(CONVERSATION, [], 1_000_000);
    const roomyOn = withDigest(roomy.wire, digestForTurn(true, roomy.shed, roomy.kept));
    check("nothing cut: the wire is byte-identical with the switch on", JSON.stringify(roomyOn) === JSON.stringify(roomy.wire));
    check("nothing cut: the same array comes back", roomyOn === roomy.wire);

    // A live wire: the question being sent is the last message, as in the app.
    const LIVE = [...CONVERSATION, m("uq", "user", "Quanto costava il Kindle Paperwhite su Amazon?")];
    const suffix = LIVE.slice(8);
    const suffixTokens = buildPinnedContext(suffix, [], null).historyTokens;
    // Slack well under the weight of one exchange, so the window keeps exactly
    // the last exchange and the question, and cuts the four before it.
    const WINDOW = ANSWER_RESERVE_TOKENS + suffixTokens + 5;
    const cut = buildPinnedContext(LIVE, [], WINDOW);
    check("the window cut four turns", cut.status === "ok" && cut.dropped === 4, cut.status === "ok" ? `dropped ${cut.dropped}` : cut.status);
    const block = digestForTurn(true, cut.shed, cut.kept);
    const on = withDigest(cut.wire, block);
    const off = withDigest(cut.wire, digestForTurn(false, cut.shed, cut.kept));
    check("switch off: the wire is the fit's own, byte for byte", JSON.stringify(off) === JSON.stringify(cut.wire));
    check("switch on: a block was made", block !== "");

    const last = on.length - 1;
    const lastUser = on.map((item) => item.role).lastIndexOf("user");
    check("the block rides on the last user message, not before the history", lastUser === last && on[lastUser].content.startsWith(`${block}\n\n`));
    const stripped = on.map((item, i) => (i === lastUser && typeof item.content === "string" ? { ...item, content: item.content.slice(block.length + 2) } : item));
    check("strip the block, and the wire is the flag-off wire exactly", JSON.stringify(stripped) === JSON.stringify(cut.wire));
    check("the system message is untouched", on[0] !== undefined && JSON.stringify(on[0]) === JSON.stringify(cut.wire[0]));

    const weighed = Math.ceil(block.length / 3.5);
    const historyTokens = cut.historyTokens;
    console.log(`   cost on this case: block ${block.length} chars ≈ ${weighed} tokens (chars ÷ 3.5), history fitted ${historyTokens} tokens`);
  }

  console.log("\n11. the settings: off unless explicitly on, and the old record reads off");
  {
    storage.clear();
    check("no stored record: off", loadSettings().contextDigest === false);
    storage.set("crescent-chat.settings.v1", JSON.stringify({ model: "x", webTools: true }));
    check("an old record without the key: off", loadSettings().contextDigest === false);
    storage.set("crescent-chat.settings.v1", JSON.stringify({ model: "x", webTools: true, contextDigest: true }));
    check("an explicit true: on", loadSettings().contextDigest === true);
    storage.set("crescent-chat.settings.v1", JSON.stringify({ model: "x", webTools: true, contextDigest: "yes" }));
    check("anything but true: off", loadSettings().contextDigest === false);
    storage.clear();
  }

  console.log("\n12. the retriever on a large cut: the time it takes");
  {
    const page = Array.from({ length: 400 }, (_, i) => `Riga ${i} della pagina: il prezzo del modello ${i} è ${100 + (i % 50)},99 euro, spedizione gratuita sopra i 25 euro.`).join(" ");
    const big = Array.from({ length: 20 }, (_, i) => m(`g${i}`, "assistant", page));
    const bigShed = [m("h0", "user", "Leggi le pagine."), ...big];
    const started = performance.now();
    const block = digestForTurn(true, bigShed, askWith("quanto costa il modello 42 con la spedizione?"));
    const ms = Math.round(performance.now() - started);
    const totalChars = big.reduce((sum, message) => sum + message.content.length, 0);
    const pickedLines = block === "" ? 0 : block.split("\n").length - 1;
    check("a large cut (20 pages of text) is searched in under a second", ms < 1000, `${totalChars} chars, ${ms} ms, ${pickedLines} fragments`);
  }

  console.log(failures === 0 ? "\ncontext-digest: all checks passed" : `\ncontext-digest: ${failures} FAILED`);
} finally {
  globalThis.localStorage = realStorage;
  for (const dir of dirs) await rm(dir, { recursive: true, force: true });
}

process.exit(failures === 0 ? 0 : 1);
