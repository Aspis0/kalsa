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
import { SENTENCE, SHOW, mailFixture } from "./lib/mail-mock.mjs";

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

const ROUNDS = [
  [chunk({ role: "assistant", tool_calls: [call("call_1", "mail_list", { days: 1 })] }, "tool_calls"), "data: [DONE]\n\n"],
  [
    chunk({ role: "assistant", tool_calls: [call("call_2", "mail_show", { items: SHOW })] }, "tool_calls"),
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
  let round = 0;
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
      let fresh = false;
      try {
        fresh = !JSON.parse(body).messages.some((m) => m.role === "tool");
      } catch {
        fresh = true;
      }
      if (fresh) round = 0;
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", ...CORS });
      const chosen = ROUNDS[Math.min(round, ROUNDS.length - 1)];
      round += 1;
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
  const mail = window.__MAIL_FIXTURE__;
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
        if (command === "brain_mail_list") return mail.list;
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
        if (command === "brain_mail_account_test") return mail.testSubjects;
        if (command === "brain_mail_account_save") return mail.saved;
        if (command === "brain_mail_account_delete") return null;
        throw new Error(`mail-shots: no fixture declares ${command}`);
      },
    },
    event: { listen: () => Promise.resolve(() => {}) },
  };
}

/* ----------------------------------------------------------------- the page */

async function seed(page, theme) {
  await page.addInitScript((cfg) => {
    localStorage.clear();
    localStorage.setItem("crescent-chat.theme.v1", cfg.theme);
    localStorage.setItem("crescent-chat.language.v1", "it");
    // The account the person reads with: what the card's "A:" says.
    localStorage.setItem("crescent-chat.mail-account.v1", JSON.stringify({ email: "luca@libero.it" }));
    localStorage.setItem(
      "crescent-chat.settings.v1",
      JSON.stringify({ webTools: true, model: cfg.model, thinking: false }),
    );
  }, { theme, model: "Alibaba Qwen 3.6" });
  await page.addInitScript((fixture) => {
    window.__MAIL_FIXTURE__ = fixture;
  }, mailFixture());
  await page.addInitScript(installMailStub, {
    endpoint: ENDPOINT,
    model: "Alibaba Qwen 3.6",
    appVersion: APP_VERSION,
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
    for (const theme of ["light", "dark"]) {
      const page = await browser.newPage({ viewport: WINDOW });
      await seed(page, theme);
      await page.goto(APP);
      await page.waitForSelector(".rail", { timeout: 20000 });
      await askForMail(page);

      await mustSee(page, SENTENCE, `${theme}: the assistant's one sentence`);
      await mustSee(page, "Sospetta", `${theme}: the badge on the card that carries one`);
      await mustSee(page, "newsletter", `${theme}: the line under the cards`);
      check(`${theme}: three cards`, (await page.locator(".mail-card").count()) === 3);
      check(
        `${theme}: one badge only`,
        (await page.locator(".mail-card .mail-suspect").count()) === 1,
        `${await page.locator(".mail-card .mail-suspect").count()} badges`,
      );
      // Apri the invoice: it is the one that has an attachment, so the panel
      // shows the list and the card afterwards knows to offer Scarica.
      await page.locator(".mail-card").nth(1).getByRole("button", { name: "Apri" }).click();
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
      await page.locator(".mail-card").nth(1).getByRole("button", { name: "Apri" }).click();
      await page.getByRole("button", { name: "Genera bozza" }).click();
      await page.waitForSelector(".mail-reply textarea", { timeout: 15000 });
      await shot(page, `${theme === "light" ? "03" : "09"}-mail-panel-draft`);

      // The draft card, drawn by a real turn: the model calls mail_draft and
      // the app draws what came back.
      const again = page.locator(".composer-input");
      await again.click();
      await again.fill("Scrivi a John che lunedì alle 11 va bene");
      await again.press("Enter");
      await page.waitForSelector(".mail-draft", { timeout: 30000 });
      await mustSee(page, "john.smith@acme.com", `${theme}: the draft's recipient came from the mail`);
      await shot(page, `${theme === "light" ? "04" : "10"}-draft-card`);

      // The panel now shows the same reply the card holds (fix 12).
      await page.locator(".mail-card").first().getByRole("button", { name: "Apri" }).click();
      await page.waitForSelector(".mail-reply textarea", { timeout: 10000 });
      const shared = await page.locator(".mail-reply textarea").inputValue();
      check(`${theme}: the panel and the card hold one reply`, shared.includes("lunedì alle 11"), shared.slice(0, 60));
      await shot(page, `${theme === "light" ? "03" : "09"}-mail-panel-draft`);

      // John's reply must not follow the person into another mailbox (P0).
      await page.locator(".mail-card").nth(1).getByRole("button", { name: "Apri" }).click();
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
      await page.locator(".mail-card").first().getByRole("button", { name: "Apri" }).click();
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
        await page.getByLabel("Indirizzo email").fill("luca@libero.it");
        const guessed = await page.getByLabel("Server").inputValue();
        check("light: the server guessed from the address", guessed === "imapmail.libero.it", `got "${guessed}"`);
        await page.getByLabel("Password").fill("password-di-prova");
        await page.getByRole("button", { name: "Prova" }).click();
        await mustSee(page, "Ultime 3 mail ricevute", "light: Prova listed the latest mail");
        await mustSee(page, "Fattura n. 104", "light: the three subjects are listed");
        await shot(page, "13-settings-mail");
      }
      await page.close();
    }
  } finally {
    await browser.close();
    mock.close();
    vite.kill();
  }
  console.log(failures === 0 ? "\nall checks passed" : `\n${failures} check(s) failed`);
  process.exit(failures === 0 ? 0 : 1);
}

await run();