// Mail in the chat, as a person sees it: the cards, the Mail tab beside the
// thread, the draft, and the account in Settings — in both looks.
//
// There is no mailbox here and no sidecar. `lib/mail-mock.mjs` answers the
// `brain_mail_*` commands from eight Italian mails written in the shapes
// `kalsa-mail` really emits, and the completions endpoint drives the app's own
// tool loop: it asks for the list, then for the cards, then answers. Every
// picture below is the real components drawing that data.
//
// Run: node scripts/mail-shots.mjs   (from chat/). Writes to OUT.
import { createServer } from "node:http";
import { mkdirSync } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { chromium } from "@playwright/test";
import { APP_VERSION } from "./lib/brain-stub.mjs";
import { HOSTILE_SUBJECT, MAILBOX, SENTENCE, SHOW, mailFixture } from "./lib/mail-mock.mjs";

const CHAT_DIR = fileURLToPath(new URL("..", import.meta.url));
const OUT = process.env.MAIL_SHOTS_OUT ?? "/tmp/kalsa-mail-ux";
// The owner's dev server on 1420 is not ours: this run brings its own and
// stops it again.
const VITE_PORT = Number(process.env.MAIL_SHOTS_PORT ?? 14300);
const MOCK_PORT = Number(process.env.MAIL_SHOTS_MOCK_PORT ?? 18099);
const APP = `http://localhost:${VITE_PORT}`;
const ENDPOINT = `http://127.0.0.1:${MOCK_PORT}/mail`;
const WINDOW = { width: 1280, height: 1040 };

let failures = 0;
function check(label, ok, detail = "") {
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${ok || !detail ? "" : `\n     ${detail}`}`);
  if (!ok) failures += 1;
}

/* ---------------------------------------------------------------- the model */

/** The three rounds a mail turn really is: list the mailbox, draw the cards,
    then say the one sentence. A local model gets the same tool list the app
    offers, so this is the exchange, not a scripted animation. */
function chunk(delta, finish) {
  return `data: ${JSON.stringify({
    id: "chatcmpl-mail",
    object: "chat.completion.chunk",
    created: 1,
    model: "Alibaba Qwen 3.6",
    choices: [{ index: 0, delta, finish_reason: finish ?? null }],
  })}\n\n`;
}

const call = (id, name, args) => ({
  index: 0,
  id,
  type: "function",
  function: { name, arguments: JSON.stringify(args) },
});

/** The panel's "Genera bozza" turn: the model is asked for one mail's reply and
    writes it with mail_draft, exactly as a real one would after the prompt. */
function draftRounds(id, asked) {
  // The words are that mail's own reply, the way a model that read it writes:
  // one mail's words never answer for another's.
  const body = asked ?? mailFixture().drafts[id]?.for_ui.body ?? "";
  return [
    [
      chunk(
        {
          role: "assistant",
          tool_calls: [
            call(`call_d_${id}`, "mail_draft", {
              reply_to_id: id,
              body,
            }),
          ],
        },
        "tool_calls",
      ),
      "data: [DONE]\n\n",
    ],
    [chunk({ role: "assistant", content: "Ho preparato la risposta. Non è stata inviata." }, "stop"), "data: [DONE]\n\n"],
  ];
}

/**
 * A weak local model, which is what the owner saw live: it asks for the list,
 * never calls mail_show, and writes the mails out as a markdown list. The cards
 * are the app's own, so they must stand anyway.
 */
const WEAK_ROUNDS = [
  [chunk({ role: "assistant", tool_calls: [call("call_w1", "mail_list", { days: 1 })] }, "tool_calls"), "data: [DONE]\n\n"],
  [
    chunk(
      {
        role: "assistant",
        content:
          "Ecco le tue mail:\n\n1. **John Smith** — Possiamo spostare l'incontro?\n2. **Poste Italiane** — Verifica subito\n3. **Sole 24 Ore** — Le notizie",
      },
      "stop",
    ),
    "data: [DONE]\n\n",
  ],
];

/** Which model this harness plays, from what the turn asked for: a panel
    request for a reply is answered with a draft, everything else follows the
    scenario. Each kind counts its own rounds, so one page's turn never eats
    another's. */
function roundsFor(messages) {
  const last = [...messages].reverse().find((m) => m.role === "user");
  const said = typeof last?.content === "string" ? last.content : "";
  // The panel's own request names the mail; a person asking for a reply in the
  // thread is the same turn, and the model answers it the same way.
  const panel = said.match(/reply_to_id (\d+)/i);
  if (panel) {
    // The obedient model answers for the mail it was asked about; the `pin`
    // scenario plays the one that does not, which the app has to refuse.
    const other = process.argv[2] === "pin" ? (panel[1] === "412" ? "418" : "412") : panel[1];
    return { kind: `draft-${panel[1]}`, rounds: draftRounds(other) };
  }
  const inThread = said.match(/Scrivi a (\w+)/i);
  if (inThread) {
    return {
      kind: `asked-${inThread[1]}`,
      rounds: draftRounds("412", "Ciao John,\n\nlunedì alle 11 va benissimo. Ti confermo l'appuntamento.\n\nA presto,\nLuca"),
    };
  }
  if (process.argv[2] === "weak") return { kind: "weak", rounds: WEAK_ROUNDS };
  return process.argv[2] === "ids" ? { kind: "ids", rounds: STRING_ROUNDS } : { kind: "mail", rounds: ROUNDS };
}

/** The ids as a model that writes them as numbers — what Qwen does, and what
    the schema asks for. */
const asNumbers = ({ id, gist }) => ({ id: Number(id), gist });

/** And the same ids as the text another model writes them as. */
const asText = ({ id, gist }) => ({ id: String(id), gist });

/** A model that does call mail_show, with its ids written as text. */
const STRING_ROUNDS = [
  [chunk({ role: "assistant", tool_calls: [call("call_s1", "mail_list", { days: 1 })] }, "tool_calls"), "data: [DONE]\n\n"],
  [
    chunk({ role: "assistant", tool_calls: [call("call_s2", "mail_show", { items: SHOW.map(asText) })] }, "tool_calls"),
    "data: [DONE]\n\n",
  ],
  [chunk({ role: "assistant", content: SENTENCE }, "stop"), "data: [DONE]\n\n"],
];

/** What the person is read to have said, in every request this run made. */
const WIRE_USERS = [];

/** No person turn may carry a mail field: a sender's words are a stranger's
    text, and on the wire they would read as the person's own instruction,
    outside the fence. The app's own note is the one line that names an id, and
    it is left out: what is hunted is anything that is not ours. */
function checkWireCarriesNoSubject(label) {
  const said = WIRE_USERS.map((content) =>
    content
      .split("\n")
      .filter((line) => !/reply_to_id|mail_draft/.test(line))
      .join("\n"),
  ).join("\n");
  const leaked = MAILBOX.flatMap((mail) => [
    ...(said.includes(mail.subject) ? [mail.subject] : []),
    ...(mail.from.name !== "" && said.includes(mail.from.name) ? [mail.from.name] : []),
  ]);
  check(`${label}: no sender text rides as the person's words`, leaked.length === 0, leaked.join(" | "));
  check(`${label}: and the one that reads as an instruction is not there either`, !said.includes(HOSTILE_SUBJECT));
}

const ROUNDS = [
  [chunk({ role: "assistant", tool_calls: [call("call_1", "mail_list", { days: 1 })] }, "tool_calls"), "data: [DONE]\n\n"],
  [
    chunk({ role: "assistant", tool_calls: [call("call_2", "mail_show", { items: SHOW.map(asNumbers) })] }, "tool_calls"),
    "data: [DONE]\n\n",
  ],
  [chunk({ role: "assistant", content: SENTENCE }, "stop"), "data: [DONE]\n\n"],
  [
    chunk(
      {
        role: "assistant",
        tool_calls: [
          call("call_3", "mail_draft", {
            reply_to_id: "412",
            body: "Ciao John,\n\nlunedì alle 11 va benissimo. Ti confermo l'appuntamento.\n\nA presto,\nLuca",
          }),
        ],
      },
      "tool_calls",
    ),
    "data: [DONE]\n\n",
  ],
  [chunk({ role: "assistant", content: "Ecco la bozza: non è stata inviata." }, "stop"), "data: [DONE]\n\n"],
];

/**
 * The engine's own two surfaces, because the app talks to both: the door's
 * slot routes, which answer 204 the way a door with the tier does, and the
 * completions stream that drives the turn. Anything else is a gap in this
 * harness, and it says so rather than answering something else.
 */
function mockEndpoint() {
  // The page is on another port, so the browser asks first.
  const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type, authorization",
  };
  return createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      if (req.method === "OPTIONS") {
        res.writeHead(204, CORS).end();
        return;
      }
      if (req.url?.endsWith("/kalsa/chat/activate") || req.url?.endsWith("/kalsa/chat/erase")) {
        res.writeHead(204, CORS).end();
        return;
      }
      if (!req.url?.includes("/chat/completions")) {
        res.writeHead(404, { "content-type": "application/json", ...CORS });
        res.end(JSON.stringify({ error: `mail-shots: no fixture for ${req.url}` }));
        return;
      }
      // A new turn is a request with no tool result in it yet, so the rounds
      // start again: the second page of the run asks for the same mail.
      let messages = [];
      try {
        messages = JSON.parse(body).messages;
      } catch {
        messages = [];
      }
      const { kind, rounds } = roundsFor(messages);
      // Which round of the scenario this is, read off the request rather than
      // remembered: the assistant turns since the person's last message are the
      // rounds that turn has already spent. A new turn, a new page and the
      // panel's own request for a reply each start at the first one.
      // Every person turn that reaches the wire, kept so a run can prove none
      // of them carries a stranger's mail text as the person's own words.
      for (const message of messages) {
        if (message.role === "user" && typeof message.content === "string") WIRE_USERS.push(message.content);
      }
      const asked = messages.map((m) => m.role).lastIndexOf("user");
      const at = messages.slice(asked + 1).filter((m) => m.role === "assistant").length;
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", ...CORS });
      const chosen = rounds[Math.min(at, rounds.length - 1)];
      for (const piece of chosen) res.write(piece);
      res.end();
    });
  });
}

/* ------------------------------------------------------------------ the stub */

/** Serialised into the page: the Tauri door the app talks to, answering the
    brain's reads and the mailbox's commands out of the fixture. Which mail a
    read names arrives in the command's own `args`, exactly as the real one
    does. `__STUB_CALLS__` records every call so a run can check what ran. */
function installMailStub(config) {
  const mail = { ...window.__MAIL_FIXTURE__, account: config.account };
  const failed = { for_model: [], for_ui: null, is_error: true };
  const inner = args => (args && typeof args === "object" && args.args) || {};
  window.__TAURI__ = {
    core: {
      invoke: async (command, args) => {
        (window.__STUB_CALLS__ ??= []).push([command, args ?? null]);
        if (command === "brain_state") return { kind: "running", endpoint: config.endpoint, model: config.model };
        if (command === "brain_host_credential") return "t";
        if (command === "brain_app_version") return config.appVersion;
        if (command === "brain_telemetry_status") return { enabled: false, noticeSeen: true };
        if (command === "brain_capability") return { kind: "unmeasured", chosen: true, chosen_model: config.model };
        if (command === "brain_window_hidden") return false;
        if (command === "brain_mail_list") {
          // A mailbox that will not answer at all: the card the thread draws
          // is the cause, not whatever the model says about it.
          if (config.failList) throw { code: config.failList };
          return mail.list;
        }
        if (command === "brain_mail_read") return mail.reads[String(inner(args).id)] ?? failed;
        if (command === "brain_mail_draft") {
          const named = mail.drafts[String(inner(args).reply_to_id)];
          if (named === undefined) return failed;
          // The sidecar writes the reply itself; words from the caller, when it
          // has any, take its place.
          return { ...named, for_ui: { ...named.for_ui, body: String(inner(args).body ?? named.for_ui.body) } };
        }
        if (command === "brain_mail_send") {
          const answered = mail.reads[String(inner(args).replyToId)];
          if (answered === undefined) return Promise.reject({ code: "mail.send_no_recipient" });
          return { sentTo: answered.for_ui.from.address };
        }
        if (command === "brain_mail_account_test") {
          // What Rust sends when the login itself is refused: a coded failure,
          // not an exception the page has to read a message out of.
          if (config.failTest) throw { code: "mail.invalid_account", text: "the login was refused" };
          return mail.testSubjects;
        }
        if (command === "brain_mail_account_get") return mail.account;
        if (command === "brain_mail_account_save") {
          const given = inner(args).input ?? {};
          mail.account = { email: String(given.email ?? ""), host: String(given.host ?? "") };
          return mail.saved;
        }
        if (command === "brain_mail_account_delete") {
          mail.account = null;
          return null;
        }
        throw new Error(`mail-shots: no fixture declares ${command}`);
      },
    },
    event: { listen: () => Promise.resolve(() => {}) },
  };
}

/* ----------------------------------------------------------------- the page */

async function seed(page, theme, opts = {}) {
  await page.addInitScript((cfg) => {
    localStorage.clear();
    localStorage.setItem("crescent-chat.theme.v1", cfg.theme);
    localStorage.setItem("crescent-chat.language.v1", "it");
    localStorage.setItem(
      "crescent-chat.settings.v1",
      JSON.stringify({ webTools: true, model: cfg.model, thinking: false }),
    );
  }, { theme, model: "Alibaba Qwen 3.6", account: opts.account });
  await page.addInitScript((fixture) => {
    window.__MAIL_FIXTURE__ = fixture;
  }, mailFixture());
  await page.addInitScript(installMailStub, {
    endpoint: ENDPOINT,
    model: "Alibaba Qwen 3.6",
    appVersion: APP_VERSION,
    failTest: opts.failTest === true,
    failList: opts.failList ?? null,
    account:
      opts.account === null
        ? null
        : typeof opts.account === "string"
          ? { email: opts.account, host: "imap.libero.it" }
          : opts.account,
  });
}

/** One turn, from the composer to the cards. */
async function askForMail(page) {
  await page.locator('.rail-item[data-surface="chat"]').click();
  // The composer's label is translated, and this run speaks Italian.
  const box = page.locator(".composer-input");
  await box.waitFor({ timeout: 15000 });
  await box.fill("Fammi vedere le mail importanti di oggi");
  await box.press("Enter");
  const drew = await page
    .waitForFunction(() => document.querySelectorAll(".mail-card").length > 0, null, { timeout: 30000 })
    .then(() => true)
    .catch(() => false);
  if (!drew) {
    // A run that draws nothing has to say what the app did instead, or the
    // failure is a blank picture with no cause.
    const calls = await page.evaluate(() => (window.__STUB_CALLS__ ?? []).map(([command]) => command));
    const thread = await page.evaluate(() => document.querySelector(".thread")?.innerText ?? "");
    check("cards were drawn", false, `commands: ${calls.join(", ")}\nthread: ${thread.slice(0, 400)}`);
    await shot(page, "FAILED-chat-cards");
  }
}

async function shot(page, name) {
  await page.screenshot({ path: join(OUT, `${name}.png`) });
  console.log("  →", join(OUT, `${name}.png`));
}

async function mustSee(page, needle, label) {
  const seen = await page
    .waitForFunction((text) => document.body.innerText.includes(text), needle, { timeout: 15000 })
    .then(() => true)
    .catch(() => false);
  check(label, seen, `"${needle}" never appeared on screen`);
}

/* -------------------------------------------------------------------- runs */

/** The two Settings states that changed: a Gmail address with the box under
    the field, and the same page after a refused connection. */
/** The three Settings states a person meets, plus the refused connection. */
async function shootSettings(browser) {
  // The help box makes this page taller than the chat window, and a screenshot
  // shows only the window.
  const viewport = { width: WINDOW.width, height: 1720 };
  for (const theme of ["light", "dark"]) {
    const dark = theme === "dark";
    const shotOf = (name) => `${name}${dark ? "-dark" : ""}`;

    /* 17 — nobody has typed anything: what this machine has, and the help
       waiting behind one line. */
    const empty = await browser.newPage({ viewport });
    await seed(empty, theme, { account: null });
    await empty.goto(APP);
    await empty.waitForSelector(".rail", { timeout: 20000 });
    await openMailSettings(empty);
    await mustSee(empty, "Nessun account collegato", `${theme}: an empty page says so`);
    await mustSee(empty, "Per Gmail e iCloud serve una password per le app", `${theme}: the help is there before any typing`);
    check(`${theme}: the steps are folded away`, (await empty.locator(".mail-apppass").count()) === 0);
    check(`${theme}: Collega waits for the address`, await empty.getByRole("button", { name: "Collega questo account" }).isDisabled());
    check(`${theme}: nothing to remove without an account`, (await empty.getByRole("button", { name: "Elimina questo account" }).count()) === 0);
    await mustSee(empty, "Scrivi il tuo indirizzo email", `${theme}: and says what is missing`);
    await shot(empty, shotOf("17-settings-mail-empty"));
    await empty.getByRole("button", { name: "Come si ottiene" }).click();
    check(`${theme}: the disclosure opens both providers`, (await empty.locator(".mail-apppass-for").count()) === 2);
    await empty.close();

    /* 18 — a Gmail address: the steps open by themselves, with its button. */
    const gmail = await browser.newPage({ viewport });
    await seed(gmail, theme, { account: null });
    await gmail.goto(APP);
    await gmail.waitForSelector(".rail", { timeout: 20000 });
    await openMailSettings(gmail);
    await gmail.getByLabel("Indirizzo email").fill("luca@gmail.com");
    await gmail.waitForSelector(".mail-apppass", { timeout: 10000 });
    check(`${theme}: Google says 2-Step Verification is needed first`, (await gmail.locator(".mail-apppass-steps").innerText()).includes("Verifica in due passaggi"));
    check(`${theme}: the steps are numbered`, (await gmail.locator(".mail-apppass-steps li").count()) === 4);
    check(`${theme}: the box says the code is only for mail`, (await gmail.locator(".mail-apppass-note").innerText()).includes("solo per la mail"));
    check(`${theme}: one button opens the provider's page`, (await gmail.locator(".mail-apppass .tool-link").count()) === 1);
    check(`${theme}: Collega waits for the password`, await gmail.getByRole("button", { name: "Collega questo account" }).isDisabled());
    await mustSee(gmail, "Scrivi la password", `${theme}: and says which field is missing`);
    await gmail.getByLabel("Password", { exact: true }).fill("abcd efgh ijkl mnop");
    check(`${theme}: the password is hidden by default`, (await gmail.getByLabel("Password", { exact: true }).getAttribute("type")) === "password");
    await gmail.getByRole("button", { name: "Mostra la password" }).click();
    check(`${theme}: the eye shows it`, (await gmail.getByLabel("Password", { exact: true }).getAttribute("type")) === "text");
    check(`${theme}: and the eye says so in words`, (await gmail.getByRole("button", { name: "Nascondi la password" }).count()) === 1);
    await gmail.getByRole("button", { name: "Nascondi la password" }).click();
    check(`${theme}: and hides it again`, (await gmail.getByLabel("Password", { exact: true }).getAttribute("type")) === "password");
    check(`${theme}: with both fields Collega is ready`, await gmail.getByRole("button", { name: "Collega questo account" }).isEnabled());
    await shot(gmail, shotOf("18-settings-mail-gmail"));
    await gmail.close();

    /* 19 — saved: the page says which account this machine holds. */
    const saved = await browser.newPage({ viewport });
    await seed(saved, theme, { account: null });
    await saved.goto(APP);
    await saved.waitForSelector(".rail", { timeout: 20000 });
    await openMailSettings(saved);
    await saved.getByLabel("Indirizzo email").fill("luca@libero.it");
    await saved.getByLabel("Password", { exact: true }).fill("password-di-prova");
    await saved.getByRole("button", { name: "Collega questo account" }).click();
    await mustSee(saved, "Collegato: luca@libero.it", `${theme}: the page says which account is linked`);
    await mustSee(saved, "Ultime 3 mail ricevute", `${theme}: one press checks the account`);
    check(`${theme}: and it does not then ask for the password again`, (await saved.getByText("Scrivi la password").count()) === 0);
    await mustSee(saved, "Fattura n. 104", `${theme}: the three newest subjects are on the page`);
    check(`${theme}: the newest subjects are listed`, (await saved.locator(".mail-subjects li").count()) === 3);
    check(`${theme}: a linked account can be removed`, (await saved.getByRole("button", { name: "Elimina questo account" }).count()) === 1);
    await shot(saved, shotOf("19-settings-mail-saved"));
    await saved.close();

    /* 20 — a refused connection says the likeliest cause and shows the steps. */
    const failed = await browser.newPage({ viewport });
    await seed(failed, theme, { failTest: true, account: null });
    await failed.goto(APP);
    await failed.waitForSelector(".rail", { timeout: 20000 });
    await openMailSettings(failed);
    await failed.getByLabel("Indirizzo email").fill("luca@gmail.com");
    await failed.getByLabel("Password", { exact: true }).fill("abcd efgh ijkl mnop");
    await failed.getByRole("button", { name: "Collega questo account" }).click();
    await mustSee(failed, "L'indirizzo o la password non sono giusti", `${theme}: the refusal says what was refused`);
    check(`${theme}: the app password box is there for a Gmail address`, (await failed.locator(".mail-apppass").count()) === 1);
    check(`${theme}: and the refusal is shown once`, (await failed.locator(".mail-note.is-warn").count()) === 1);
    await shot(failed, shotOf("20-settings-mail-failed"));
    await failed.close();

    /* 17b — an app that restarts: the account is asked of the backend, and the
       fields stand for it instead of reading as an empty form. */
    const restarted = await browser.newPage({ viewport });
    await seed(restarted, theme, { account: "rig.launcher@gmail.com" });
    await restarted.goto(APP);
    await restarted.waitForSelector(".rail", { timeout: 20000 });
    await openMailSettings(restarted);
    await mustSee(restarted, "Collegato: rig.launcher@gmail.com", `${theme}: a restarted app says what it has`);
    await restarted.waitForFunction(
      () => (document.querySelector("input[type=email]")?.value ?? "") !== "",
      null,
      { timeout: 10000 },
    );
    check(`${theme}: and the address is in the field`, (await restarted.getByLabel("Indirizzo email", { exact: true }).inputValue()) === "rig.launcher@gmail.com");
    check(`${theme}: with the host it reads with`, (await restarted.getByLabel("Server").inputValue()) === "imap.libero.it");
    check(`${theme}: and no password to retype`, (await restarted.getByLabel("Password", { exact: true }).inputValue()) === "");
    await mustSee(restarted, "La password salvata resta su questo computer", `${theme}: which says so under the empty field`);
    await restarted.close();

    /* A host that came from the saved account is the person's own: type only
       the password and the save must carry that host, or the backend guesses a
       different one for a person who has their own server. */
    const own = await browser.newPage({ viewport });
    await seed(own, theme, { account: { email: "studio@posta.example.it", host: "mail.studio.example.it" } });
    await own.goto(APP);
    await own.waitForSelector(".rail", { timeout: 20000 });
    await openMailSettings(own);
    await own.waitForFunction(() => (document.querySelector(".mail-settings-fields input[type=text]")?.value ?? "") !== "", null, { timeout: 10000 });
    check(`${theme}: the saved host is a value, not a grey hint`, (await own.getByLabel("Server").inputValue()) === "mail.studio.example.it");
    await own.getByLabel("Password", { exact: true }).fill("password-di-prova");
    await own.getByRole("button", { name: "Collega questo account" }).click();
    await mustSee(own, "Collegato: studio@posta.example.it", `${theme}: it links with the password alone`);
    const saves = await own.evaluate(() => (window.__STUB_CALLS__ ?? []).filter(([c]) => c === "brain_mail_account_save").map(([, a]) => a));
    const input = saves.length === 1 ? saves[0].input : {};
    check(`${theme}: and the save carries that host`, input.host === "mail.studio.example.it", JSON.stringify(input));
    await own.close();

    /* The help opens while the address is being typed: the field being typed
       into must not move. */
    const steady = await browser.newPage({ viewport });
    await seed(steady, theme, { account: null });
    await steady.goto(APP);
    await steady.waitForSelector(".rail", { timeout: 20000 });
    await openMailSettings(steady);
    const before = await steady.getByLabel("Password", { exact: true }).boundingBox();
    await steady.getByLabel("Indirizzo email").fill("luca@gmail.com");
    await steady.waitForSelector(".mail-apppass", { timeout: 10000 });
    const after = await steady.getByLabel("Password", { exact: true }).boundingBox();
    check(`${theme}: the help opening does not move the field being typed`, Math.abs(after.y - before.y) < 1, `${before.y} → ${after.y}`);
    await steady.close();

    /* A deleted account leaves this machine too: the page says so, and a
       reload does not bring the address back. */
    const gone = await browser.newPage({ viewport });
    await seed(gone, theme, { account: null });
    await gone.goto(APP);
    await gone.waitForSelector(".rail", { timeout: 20000 });
    await openMailSettings(gone);
    await gone.getByLabel("Indirizzo email", { exact: true }).fill("luca@libero.it");
    await gone.getByLabel("Password", { exact: true }).fill("password-di-prova");
    await gone.getByRole("button", { name: "Collega questo account" }).click();
    await mustSee(gone, "Collegato: luca@libero.it", `${theme}: the account is linked`);
    await gone.getByRole("button", { name: "Elimina questo account" }).click();
    await mustSee(gone, "Nessun account collegato", `${theme}: deleting it says the page has none`);
    await gone.reload();
    await openMailSettings(gone);
    await mustSee(gone, "Nessun account collegato", `${theme}: and it does not come back on reload`);
    check(`${theme}: and the fields are empty again, not prefilled`, (await gone.getByLabel("Indirizzo email", { exact: true }).inputValue()) === "");
    await gone.close();
  }
}

/** Settings, then the row that opens Mail's own page. */
async function openMailSettings(page) {
  await page.locator('.rail-item[data-surface="settings"]').click();
  await page.getByRole("button", { name: "Configura la mail" }).click();
  await page.waitForSelector(".mail-field", { timeout: 15000 });
}

/** One turn from the composer, asked for mail that will not come. */
async function ask(page, theme, failList) {
  await page.locator('.rail-item[data-surface="chat"]').click();
  const box = page.locator(".composer-input");
  await box.waitFor({ timeout: 15000 });
  await box.fill("Fammi vedere le mail importanti di oggi");
  await box.press("Enter");
  await page.waitForSelector(".mail-failure", { timeout: 30000 });
  check(`${theme}: the notice names the code the command answered with`, failList !== null);
}

/** 21 — a mailbox that will not answer: the thread says the cause Kalsa
    knows, and the model is not left to invent one. Its own pass, because the
    cards and the draft run before it cannot reach that step. */
async function shootMailFailure(browser) {
  const viewport = { width: WINDOW.width, height: 1280 };
  for (const theme of ["light", "dark"]) {
    const suffix = theme === "dark" ? "-dark" : "";

    const broken = await browser.newPage({ viewport });
    await seed(broken, theme, { account: null, failList: "mail.keychain" });
    await broken.goto(APP);
    await broken.waitForSelector(".rail", { timeout: 20000 });
    await ask(broken, theme, "mail.keychain");
    await mustSee(broken, "macOS ha chiesto la password del Mac", `${theme}: the notice is the real cause`);
    await mustSee(broken, "Consenti sempre", `${theme}: and it says the one action`);
    check(`${theme}: the keychain asks for no page`, (await broken.locator(".mail-failure-go").count()) === 0);
    check(`${theme}: no card is drawn for a call that failed`, (await broken.locator(".mail-card").count()) === 0);
    check(`${theme}: the model's advice is not what the card says`, !(await broken.locator(".mail-failure").innerText()).includes("supporto"));
    await shot(broken, `21-mail-error${suffix}`);
    await broken.close();

    /* A cause whose fix is an account: the notice offers the way there, and
       it lands on the page it names. */
    const noAccount = await browser.newPage({ viewport });
    await seed(noAccount, theme, { account: null, failList: "mail.not_configured" });
    await noAccount.goto(APP);
    await noAccount.waitForSelector(".rail", { timeout: 20000 });
    await ask(noAccount, theme, "mail.not_configured");
    await mustSee(noAccount, "Nessun account di posta collegato.", `${theme}: no account says so in one line`);
    await noAccount.locator(".mail-failure-go").click();
    await noAccount.waitForSelector(".mail-field", { timeout: 15000 });
    await mustSee(noAccount, "Indirizzo email", `${theme}: its button opens the account page`);
    await noAccount.close();
  }
}

/**
 * 22 — the weak local model, which is what the owner's own test produced: the
 * list answered, no mail_show, and the mails written out as text. The cards are
 * the app's own and must be on screen, and the turn must not end as a failure.
 */
async function shootWeakModel(browser) {
  const viewport = { width: WINDOW.width, height: 1040 };
  for (const theme of ["light", "dark"]) {
    const page = await browser.newPage({ viewport });
    await seed(page, theme);
    await page.goto(APP);
    await page.waitForSelector(".rail", { timeout: 20000 });
    await askForMail(page);
    await page.locator(".mail-card").nth(8).waitFor({ timeout: 15000 });
    check(`${theme}: every listed mail is a card, with no mail_show`, (await page.locator(".mail-card").count()) === 9, `${await page.locator(".mail-card").count()} cards`);
    check(`${theme}: and they are the list's own, once`, (await page.locator(".mail-turn").count()) === 1);
    await mustSee(page, "John Smith", `${theme}: a card carries the sender the list named`);
    check(`${theme}: the model never had to write a gist`, (await page.locator(".mail-card .mail-gist").count()) === 0);
    const shown = await page.locator(".mail-card").first().innerText();
    check(`${theme}: the card shows the subject, not the model's line`, shown.includes("Possiamo spostare"), shown.slice(0, 60));
    check(`${theme}: nothing in the thread says the check failed`, (await page.getByText("Kalsa non è riuscita a finire il controllo").count()) === 0);
    check(`${theme}: no run is marked failed or refused`, (await page.locator(".tool-run-failed").count()) === 0);
    await shot(page, `22-mail-weak${theme === "dark" ? "-dark" : ""}`);
    await page.locator(".mail-card", { hasText: "Fattura n. 104" }).getByRole("button", { name: "Apri" }).click();
    await page.waitForSelector(".mail-view-subject", { timeout: 15000 });
    await mustSee(page, "Inizio della mail", `${theme}: a card from the list opens in the panel`);
    check(`${theme}: and with no model line, the box says what it really shows`, (await page.locator(".mail-gist-title", { hasText: "Sintesi AI" }).count()) === 0);
    checkWireCarriesNoSubject(theme);
    await page.close();
  }
}

/**
 * 23 — the same turn with the ids written as text, the shape a model that does
 * call mail_show may use. The cards are the same either way: one id, one form.
 */
async function shootTextIds(browser) {
  const viewport = { width: WINDOW.width, height: 1040 };
  for (const theme of ["light", "dark"]) {
    const page = await browser.newPage({ viewport });
    await seed(page, theme);
    await page.goto(APP);
    await page.waitForSelector(".rail", { timeout: 20000 });
    await askForMail(page);
    await page.locator(".mail-card").first().waitFor({ timeout: 15000 });
    await mustSee(page, "Vuole spostare l'incontro", `${theme}: ids written as text still find their cards`);
    check(`${theme}: and the model was told nothing was dropped`, !((await page.locator(".thread").innerText()).includes("not in the last list")));
    await page.close();
  }
}

/** 24 — a turn opened for one mail and a model that answers for another: the
    reply is refused here, and no draft is drawn for a mail nobody chose. */
async function shootWrongDraft(browser) {
  const viewport = { width: WINDOW.width, height: 1040 };
  for (const theme of ["light", "dark"]) {
    const page = await browser.newPage({ viewport });
    await seed(page, theme);
    await page.goto(APP);
    await page.waitForSelector(".rail", { timeout: 20000 });
    await askForMail(page);
    await page.locator(".mail-card", { hasText: "Fattura n. 104" }).getByRole("button", { name: "Apri" }).click();
    await page.waitForSelector(".mail-view-subject", { timeout: 15000 });
    await page.getByRole("button", { name: "Genera bozza" }).click();
    // The turn is over when the model stops answering; the draft never came.
    await page.waitForFunction(
      () => (window.__STUB_CALLS__ ?? []).length > 12,
      null,
      { timeout: 30000 },
    );
    await page.waitForTimeout(1500);
    check(`${theme}: a draft for another mail draws nothing`, (await page.locator(".mail-draft").count()) === 0);
    check(`${theme}: and the panel opens no reply box`, (await page.locator(".mail-reply textarea").count()) === 0);
    check(`${theme}: the chosen mail is still the one open`, (await page.locator(".mail-view-subject").innerText()).includes("Fattura n. 104"));
    checkWireCarriesNoSubject(theme);
    await shot(page, `24-mail-wrong-draft${theme === "dark" ? "-dark" : ""}`);
    await page.close();
  }
}

async function run() {
  mkdirSync(OUT, { recursive: true });
  const vite = spawn(
    process.execPath,
    [join(CHAT_DIR, "node_modules/vite/bin/vite.js"), "--port", String(VITE_PORT), "--strictPort"],
    { cwd: CHAT_DIR, stdio: ["ignore", "ignore", "inherit"] },
  );
  const mock = mockEndpoint();
  await new Promise((done) => mock.listen(MOCK_PORT, "127.0.0.1", done));
  // Vite answers before the page can be opened, or the first load races it.
  await new Promise((done, fail) => {
    const until = Date.now() + 30000;
    const poll = async () => {
      try {
        await fetch(APP);
        done();
      } catch {
        if (Date.now() > until) return fail(new Error("vite never answered"));
        setTimeout(poll, 250);
      }
    };
    poll();
  });

  const browser = await chromium.launch();
  try {
    if (process.argv[2] === "settings") {
      await shootSettings(browser);
      return;
    }
    if (process.argv[2] === "failure") {
      await shootMailFailure(browser);
      return;
    }
    if (process.argv[2] === "weak") {
      await shootWeakModel(browser);
      return;
    }
    if (process.argv[2] === "ids") {
      await shootTextIds(browser);
      return;
    }
    if (process.argv[2] === "pin") {
      await shootWrongDraft(browser);
      return;
    }
    for (const theme of ["light", "dark"]) {
      const page = await browser.newPage({ viewport: WINDOW });
      await seed(page, theme);
      await page.goto(APP);
      await page.waitForSelector(".rail", { timeout: 20000 });
      await askForMail(page);

      await mustSee(page, SENTENCE, `${theme}: the assistant's one sentence`);
      await mustSee(page, "Sospetta", `${theme}: the badge on the card that carries one`);
      await mustSee(page, "newsletter", `${theme}: the line under the cards`);
      check(`${theme}: every listed mail is a card`, (await page.locator(".mail-card").count()) === 9, `${await page.locator(".mail-card").count()} cards`);
      check(`${theme}: the list is drawn once, not beside the model's set`, (await page.locator(".mail-turn").count()) === 1);
      await mustSee(page, "Vuole spostare l'incontro", `${theme}: the model's line landed on the card it named`);
      check(
        `${theme}: every suspicious mail keeps the badge the code gave it`,
        (await page.locator(".mail-card .mail-suspect").count()) === 2,
        `${await page.locator(".mail-card .mail-suspect").count()} badges`,
      );
      // Apri the invoice: it is the one that has an attachment, so the panel
      // shows the list and the card afterwards knows to offer Scarica.
      await page.locator(".mail-card", { hasText: "Fattura n. 104" }).getByRole("button", { name: "Apri" }).click();
      await mustSee(page, "Sintesi", `${theme}: the Mail tab opened`);
      check(`${theme}: the Mail tab is the one showing`, await page.locator("#files-tab-mail[aria-selected=true]").isVisible());
      check(`${theme}: the attachment is listed, not opened`, (await page.locator(".mail-attach-list li").count()) === 1);
      const body = await page.locator(".mail-body").innerText();
      check(`${theme}: the body is the mail's own text`, body.includes("Importo: 1.240,00"), body.slice(0, 80));
      await shot(page, `${theme === "light" ? "02" : "08"}-mail-panel`);

      // Back to the thread: the card whose mail was read now offers Scarica.
      await page.locator(".panel-close").last().click();
      await page.waitForTimeout(300);
      check(`${theme}: the card offers Scarica for the attachment`, (await page.locator(".mail-card >> text=Scarica").count()) === 1);
      await shot(page, `${theme === "light" ? "01" : "07"}-chat-cards`);

      // Genera bozza: the panel's own box, which the sidecar answers with the
      // mail's recipient and the person's words to write into it. The mail is
      // opened again because the panel was closed for the card's picture.
      await page.locator(".mail-card", { hasText: "Fattura n. 104" }).getByRole("button", { name: "Apri" }).click();
      await page.getByRole("button", { name: "Genera bozza" }).click();
      // The reply is a whole model turn now, not one command.
      await page.waitForSelector(".mail-reply textarea", { timeout: 30000 });
      await mustSee(page, "Scrivi una risposta a questa mail.", `${theme}: the turn asks for a reply`);
      await mustSee(page, "Fattura n. 104", `${theme}: and says which mail, as the person sees it`);
      checkWireCarriesNoSubject(theme);
      await shot(page, `${theme === "light" ? "03" : "09"}-mail-panel-draft`);

      // The draft card, drawn by a real turn: the model calls mail_draft and
      // the app draws what came back.
      const again = page.locator(".composer-input");
      await again.click();
      // Read back up: sending must bring the thread to the answer anyway.
      await page.locator(".thread").evaluate((el) => el.scrollTo(0, 0));
      await again.fill("Scrivi a John che lunedì alle 11 va bene");
      await again.press("Enter");
      await page.waitForSelector(".mail-draft", { timeout: 30000 });
      const atEnd = await page.locator(".thread").evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight <= 2);
      check(`${theme}: sending brings the thread to the latest`, atEnd);
      await page.waitForSelector(".mail-draft", { timeout: 30000 });
      await mustSee(page, "john.smith@acme.com", `${theme}: the draft's recipient came from the mail`);
      await shot(page, `${theme === "light" ? "04" : "10"}-draft-card`);

      // The panel now shows the same reply the card holds (fix 12).
      await page.locator(".mail-card", { hasText: "Possiamo spostare" }).getByRole("button", { name: "Apri" }).click();
      await page.waitForSelector(".mail-reply textarea", { timeout: 10000 });
      const shared = await page.locator(".mail-reply textarea").inputValue();
      check(`${theme}: the panel and the card hold one reply`, shared.includes("lunedì alle 11"), shared.slice(0, 60));
      await shot(page, `${theme === "light" ? "03" : "09"}-mail-panel-draft`);

      // John's reply must not follow the person into another mailbox (P0).
      await page.locator(".mail-card", { hasText: "Fattura n. 104" }).getByRole("button", { name: "Apri" }).click();
      await page.waitForSelector(".mail-view-subject", { timeout: 10000 });
      const other = await page.locator(".mail-reply").innerText();
      check(`${theme}: another mail never shows John's words`, !other.includes("lunedì alle 11"), other.slice(0, 80));
      const ferraroBox = await page.locator(".mail-reply textarea").count();
      check(`${theme}: and it shows its own reply, not John's`, ferraroBox === 1, `${ferraroBox} boxes`);
      const ferraroWords = ferraroBox === 1 ? await page.locator(".mail-reply textarea").inputValue() : "";
      check(`${theme}: what it shows is Ferraro's own draft`, ferraroWords.includes("fattura n. 104"), ferraroWords.slice(0, 60));
      // The confirmation must offer the address the backend will use, which for
      // Ferraro is the Reply-To and not the From the card shows.
      await page.locator(".mail-reply .mail-send-go").click();
      await page.waitForSelector(".mail-send-dialog", { timeout: 10000 });
      const ferraroConfirm = await page.locator(".mail-send-exact").innerText();
      check(
        `${theme}: the confirmation offers the Reply-To, not the From`,
        ferraroConfirm.includes("contabilita@studioferraro.it") && !ferraroConfirm.includes("amministrazione@studioferraro.it"),
        ferraroConfirm.slice(0, 90),
      );
      await page.locator(".mail-send-dialog .mail-btn").click();
      await page.waitForSelector(".mail-send-dialog", { timeout: 5000, state: "detached" });
      await page.locator(".mail-card", { hasText: "Possiamo spostare" }).getByRole("button", { name: "Apri" }).click();
      await page.waitForSelector(".mail-reply textarea", { timeout: 10000 });
      const backAgain = await page.locator(".mail-reply textarea").inputValue();
      check(`${theme}: John's reply is still where it was`, backAgain.includes("lunedì alle 11"), backAgain.slice(0, 60));

      // Sending is two presses: this one shows the exact message and sends
      // nothing. The model cannot reach either button.
      await page.locator(".mail-reply .mail-send-go").click();
      await page.waitForSelector(".mail-send-dialog", { timeout: 10000 });
      const exact = await page.locator(".mail-send-exact").innerText();
      check(`${theme}: the confirmation shows the exact message`, exact.includes("john.smith@acme.com") && exact.includes("lunedì alle 11"), exact.slice(0, 90));
      await shot(page, `${theme === "light" ? "05" : "11"}-send-confirm`);

      // The second press is the one that leaves.
      const sends = await page.evaluate(() => (window.__STUB_CALLS__ ?? []).filter(([c]) => c === "brain_mail_send").length);
      check(`${theme}: nothing was sent before the second press`, sends === 0, `${sends} sends`);
      checkWireCarriesNoSubject(theme);
      await page.locator(".mail-send-dialog .mail-send-go").click();
      await page.waitForSelector(".mail-sent", { timeout: 15000 });
      await mustSee(page, "Inviata a john.smith@acme.com", `${theme}: the sent state names its recipient`);
      // The sent state sits at the foot of the panel; the shot has to show it.
      await page.locator(".mail-view").evaluate((el) => el.scrollTo(0, el.scrollHeight));
      await page.locator(".thread").evaluate((el) => el.scrollTo(0, el.scrollHeight));
      await page.waitForTimeout(250);
      const after = await page.evaluate(() => (window.__STUB_CALLS__ ?? []).filter(([c]) => c === "brain_mail_send").length);
      check(`${theme}: exactly one send reached the command`, after === 1, `${after} sends`);
      await shot(page, `${theme === "light" ? "06" : "12"}-sent`);

      if (theme === "light") {
        // Settings → Mail is a page of its own now, reached by its row.
        await page.locator('.rail-item[data-surface="settings"]').click();
        await page.getByRole("button", { name: "Configura la mail" }).click();
        await page.waitForSelector(".mail-settings-block, .mail-field", { timeout: 15000 });
        // The page opens with the saved account in the field: editing it is a
        // person clearing it and typing another, not filling an empty form.
        await page.getByLabel("Indirizzo email").fill("");
        await page.getByLabel("Indirizzo email").fill("luca@libero.it");
        const guessed = await page.getByLabel("Server").getAttribute("placeholder");
        check("light: the server guessed from the address", guessed === "imapmail.libero.it", `got "${guessed}"`);
        check("light: the guess is a hint, not a typed value", (await page.getByLabel("Server").inputValue()) === "");
        await page.getByLabel("Password", { exact: true }).fill("password-di-prova");
        await page.getByRole("button", { name: "Collega questo account" }).click();
        await mustSee(page, "Ultime 3 mail ricevute", "light: Collega checked the account");
        await mustSee(page, "Fattura n. 104", "light: the three subjects are listed");
        await shot(page, "13-settings-mail");
      }

      await page.close();
    }
  } catch (err) {
    // A shot that throws stopped the run: saying nothing about it would let a
    // half-written set of pictures pass for a whole one.
    failures += 1;
    const why = err instanceof Error ? err.message.split("\n")[0] : String(err);
    console.log(`FAIL the run stopped before the end\n     ${why}`);
  } finally {
    await browser.close();
    mock.close();
    vite.kill();
    console.log(failures === 0 ? "\nall checks passed" : `\n${failures} check(s) failed`);
    process.exit(failures === 0 ? 0 : 1);
  }
}

await run();