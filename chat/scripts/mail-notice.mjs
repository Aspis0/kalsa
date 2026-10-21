// The mail page's notice: which of the three honest sentences it shows about
// the running AI, decided from the AI options this computer actually offers,
// and the five languages' words for them. The page that shows the notice is
// read as well, so a page that named one sentence for every case fails here.
//
// Run: node scripts/mail-notice.mjs   (from chat/)

import { mkdtemp, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "../node_modules/esbuild/lib/main.js";

const LIQUID = "Liquid LFM 2.5";
const GEMMA = "Google Gemma 4 E4B";

/** One of the options a measured capability offers. */
function option(name) {
  return {
    id: name,
    name,
    quant: "Q4_K_M",
    download_bytes: 0,
    context_tokens: 4096,
    speed_context_tokens: 4096,
    speed: { shape: "at_least", value: 5 },
    measured: null,
    reason: "",
  };
}

/** A measured capability offering these two options; either may be null. */
function measured(model, quicker) {
  return {
    kind: "measured",
    chosen: model !== null,
    chosen_model: model === null ? null : model.name,
    chosen_id: model === null ? null : model.id,
    machine: {
      ram_bytes: 0,
      budget_bytes: 0,
      gpu_accounted_for: false,
      runs_on: "this computer",
      bandwidth_bytes_per_second: 0,
      bandwidth_basis: "measured",
    },
    model,
    quicker,
    refusal: null,
  };
}

let fail = 0;
function check(label, condition, detail) {
  if (!condition) fail++;
  console.log(`${condition ? "ok  " : "FAIL"} ${label}${condition || detail === undefined ? "" : `\n     ${detail}`}`);
}

// The words a sentence that promises a change would carry, in the five
// languages: a neutral or unavailable sentence must point at nothing.
const POINTERS = ["settings", "impostazioni", "ajustes", "réglages", "设置"];

let dir = null;
try {
  dir = await mkdtemp(join(tmpdir(), "kalsa-mail-notice-"));
  const outfile = join(dir, "notice.mjs");
  await build({
    stdin: {
      contents: `
        export { mailNotice } from "../src/lib/mail/notice.ts";
        export { TABLES } from "../src/i18n/index.ts";
      `,
      resolveDir: fileURLToPath(new URL(".", import.meta.url)),
      loader: "ts",
    },
    bundle: true,
    format: "esm",
    platform: "node",
    outfile,
    logLevel: "silent",
  });
  const { mailNotice, TABLES } = await import(pathToFileURL(outfile).href);

  check(
    "a blocked AI and no mail-allowed option here is unavailable",
    mailNotice(LIQUID, measured(option(LIQUID), null)) === "mailUnavailableHere",
    String(mailNotice(LIQUID, measured(option(LIQUID), null))),
  );
  check(
    "a blocked AI and a mail-allowed option here is a switch",
    mailNotice(LIQUID, measured(option(LIQUID), option(GEMMA))) === "modelNotAllowed",
    String(mailNotice(LIQUID, measured(option(LIQUID), option(GEMMA)))),
  );
  check(
    "a mail-allowed second option alone is a switch",
    mailNotice(LIQUID, measured(null, option(GEMMA))) === "modelNotAllowed",
    String(mailNotice(LIQUID, measured(null, option(GEMMA)))),
  );
  check("no capability read yet is unknown", mailNotice(LIQUID, null) === "modelCannotRead");
  check("a migrating capability is unknown", mailNotice(LIQUID, { kind: "migrating" }) === "modelCannotRead");
  check(
    "an unmeasured capability is unknown",
    mailNotice(LIQUID, { kind: "unmeasured", chosen: false, chosen_model: null }) === "modelCannotRead",
  );
  check("a measured capability with no option is unknown", mailNotice(LIQUID, measured(null, null)) === "modelCannotRead");
  check("a mail-allowed AI running shows no notice", mailNotice(GEMMA, measured(option(GEMMA), null)) === null);
  check("a mail-allowed AI running shows no notice without a capability", mailNotice(GEMMA, null) === null);
  check("nothing running shows no notice", mailNotice("", measured(option(LIQUID), null)) === null);

  for (const lang of ["en", "it", "es", "fr", "zh"]) {
    const table = TABLES[lang].mail;
    for (const key of ["modelNotAllowed", "modelCannotRead", "mailUnavailableHere"]) {
      check(`${lang} has a ${key}`, typeof table[key] === "string" && table[key].trim() !== "", String(table[key]));
    }
    for (const key of ["modelCannotRead", "mailUnavailableHere"]) {
      const sentence = table[key].toLowerCase();
      const pointer = POINTERS.find((word) => sentence.includes(word));
      check(`${lang} ${key} points at no AI settings page`, pointer === undefined, pointer);
    }
  }

  const page = readFileSync(new URL("../src/components/mail/MailSettingsPage.tsx", import.meta.url), "utf8");
  check("the page calls the helper", page.includes("mailNotice("));
  check("the page reads the capability", page.includes("useCapability("));
  // The sentence is the helper's choice, read from the table by key: a page
  // that named one sentence for every case would be the bug this is about.
  check("the page renders the notice the helper chose", page.includes("t[notice]"));
  check(
    "the page hardcodes no one sentence for all cases",
    !page.includes("t.modelCannotRead") && !page.includes("t.mailUnavailableHere"),
  );
} finally {
  if (dir) await rm(dir, { recursive: true, force: true });
}

console.log(fail === 0 ? "\nall checks passed" : `\n${fail} check(s) failed`);
process.exit(fail === 0 ? 0 : 1);
