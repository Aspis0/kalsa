// Explicit observations must refresh the page without weakening action dedup.
// Run: node scripts/browser-fresh-read.mjs

import { rm } from "node:fs/promises";
import { loadApp } from "./lib/app-bundle.mjs";

let fail = 0;
function check(label, ok, detail) {
  if (!ok) fail++;
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${ok || detail === undefined ? "" : `\n     ${detail}`}`);
}

let body = "the first state of the page";
const READS = [];
const FINDS = [];
const CLICKS = [];
let failing = null;

globalThis.window = {
  setTimeout,
  clearTimeout,
  __TAURI__: {
    core: {
      invoke: async (command, args) => {
        if (command === "brain_browser_read") {
          READS.push(args.page ?? 1);
          if (failing !== null) throw failing;
          return body;
        }
        if (command === "brain_browser_find") {
          FINDS.push(args.text);
          if (failing !== null) throw failing;
          return body;
        }
        if (command === "brain_browser_click") {
          CLICKS.push(args.ref);
          return "OK";
        }
        return null;
      },
    },
  },
};

const { app, dir } = await loadApp();
const { executeToolCall, newLedger, filed, decide } = app;

async function attempt(name, args, ledger) {
  return executeToolCall(
    name,
    args,
    undefined,
    null,
    [{ role: "user", content: "Read the current page" }],
    "any-model",
    undefined,
    undefined,
    true,
    "fresh-read",
    ledger,
  );
}

function outcomeOf(result) {
  return { text: result.text, ok: result.ok, resultCode: result.resultCode };
}

try {
  // --- a read asked twice reaches the page twice ------------------------------
  {
    const ledger = newLedger();
    const first = await attempt("browser_read", { page: 1 }, ledger);
    filed(ledger, "browser_read", { page: 1 }, outcomeOf(first));
    body = "the page moved on without the model doing anything";
    const second = await attempt("browser_read", { page: 1 }, ledger);
    filed(ledger, "browser_read", { page: 1 }, outcomeOf(second));

    check("the second read reached the page", READS.length === 2, `reads ${READS.length}`);
    check("the second read was not refused", second.ok === true, second.text);
    check(
      "and it carries the page as it is now",
      second.text.includes(body),
      `${second.text}\n     want ${body}`,
    );
  }

  // --- a find asked twice reaches the page twice ------------------------------
  {
    const ledger = newLedger();
    const first = await attempt("browser_find", { text: "16GB" }, ledger);
    filed(ledger, "browser_find", { text: "16GB" }, outcomeOf(first));
    body = "the page moved on: a 16GB notebook is now the one in the basket";
    const second = await attempt("browser_find", { text: "16GB" }, ledger);
    filed(ledger, "browser_find", { text: "16GB" }, outcomeOf(second));

    check("the second find reached the page", FINDS.length === 2, `finds ${FINDS.length}`);
    check("the second find was not refused", second.ok === true, second.text);
    check(
      "and it carries the page as it is now",
      second.text.includes(body),
      `${second.text}\n     want ${body}`,
    );
  }

  // --- a read that failed may be asked again ----------------------------------
  {
    const ledger = newLedger();
    const before = READS.length;
    failing = { code: "browser.refused", text: "the page would not answer" };
    const first = await attempt("browser_read", { page: 1 }, ledger);
    check("the first read actually failed", first.ok === false && first.resultCode === "browser.refused", first.text);
    filed(ledger, "browser_read", { page: 1 }, outcomeOf(first));
    failing = null;
    body = "the page answers now";
    const second = await attempt("browser_read", { page: 1 }, ledger);
    filed(ledger, "browser_read", { page: 1 }, outcomeOf(second));

    check("the second read reached the page", READS.length - before === 2, `reads ${READS.length - before}`);
    check("the second read was not refused", second.ok === true, second.text);
    check(
      "and it carries the page as it is now",
      second.text.includes(body),
      `${second.text}\n     want ${body}`,
    );
  }

  // --- the bound still bites ---------------------------------------------------
  {
    const ledger = newLedger();
    const before = READS.length;
    for (let at = 0; at < app.BROWSER_CALLS_PER_TURN; at += 1) {
      const result = await attempt("browser_read", { page: 1 }, ledger);
      filed(ledger, "browser_read", { page: 1 }, outcomeOf(result));
    }
    const over = await attempt("browser_read", { page: 1 }, ledger);
    check(
      "the call after the bound is refused",
      over.ok === false && over.resultCode === "browser.too_many_steps",
      `${over.resultCode}\n     ${over.text}`,
    );
    check(
      "and it did not reach the page",
      READS.length - before === app.BROWSER_CALLS_PER_TURN,
      `reads ${READS.length - before}`,
    );
  }

  // --- a click is still a click -----------------------------------------------
  {
    const ledger = newLedger();
    const first = await attempt("browser_click", { ref: "e9" }, ledger);
    filed(ledger, "browser_click", { ref: "e9" }, outcomeOf(first));
    const second = await attempt("browser_click", { ref: "e9" }, ledger);
    filed(ledger, "browser_click", { ref: "e9" }, outcomeOf(second));

    check("the click reached the page once", CLICKS.length === 1, `clicks ${CLICKS.length}`);
    check("the second click was refused", second.ok === false, second.text);
    check(
      "and it was refused as the one already run",
      second.resultCode === "browser.already_run",
      `${second.resultCode}\n     ${second.text}`,
    );
    check(
      "and the ledger still refuses it on its own",
      decide(ledger, "browser_click", { ref: "e9" }).run === false,
      JSON.stringify(decide(ledger, "browser_click", { ref: "e9" })),
    );
  }
} finally {
  await rm(dir, { recursive: true, force: true });
}

console.log(fail === 0 ? "\nall checks passed" : `\n${fail} check(s) failed`);
process.exit(fail === 0 ? 0 : 1);
