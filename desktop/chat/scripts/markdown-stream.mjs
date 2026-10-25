// The assistant's answer as it arrives, and what an answer may never do.
//
// Streamdown (Apache-2.0, `src/components/Markdown.tsx`) renders the message
// block by block while tokens land. Three of its promises are pinned here,
// each of them mid-stream rather than after: an unterminated code fence is
// already a code block, a table still being typed is already a table, and an
// open `**bold` is already bold. The security shape is pinned the same way: a
// `<script>` or an `<img src=x onerror=…>` written in the answer is shown as
// the characters it is — no element, no handler — a markdown image with a
// remote address mints no element and no request (the blocked-image sentence
// stands where it always did, with the address only offered to the Rust gate),
// and a link is still the `.tool-link` button rather than an `href`. Nothing
// outside this computer's two endpoints is ever fetched, so no CDN can be
// hiding in the renderer. The build itself is checked for Tailwind and for
// Streamdown's own stylesheet: neither is here, and the answer's colors follow
// the app's own variables in both themes.
//
// Run: node scripts/markdown-stream.mjs [chromium|webkit ...]   (from chat/)

import { readFileSync, readdirSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  appCsp,
  buildApp,
  check,
  failedChecks,
  launchChat,
  probe,
  scriptedEndpoint,
  serveDist,
  startBrain,
  ENGINES,
} from "./lib/stream-app.mjs";

const CHAT_DIR = fileURLToPath(new URL("..", import.meta.url));

/** The last assistant answer and what it rendered, as the DOM holds it. */
const SNAPSHOT = () => {
  const all = [...document.querySelectorAll(".row-assistant .markdown")];
  const last = all.at(-1) ?? null;
  const text = (el) => (el ? (el.textContent ?? "").replace(/\s+/g, " ").trim() : "");
  return {
    answers: all.length,
    text: text(last),
    code: last
      ? [...last.querySelectorAll(".codeblock")].map((block) => ({
          language: text(block.querySelector(".codeblock-lang")),
          body: block.querySelector(".codeblock-pre code")?.textContent ?? null,
          copy: block.querySelector(".codeblock-copy") !== null,
        }))
      : [],
    inline: last ? [...last.querySelectorAll("code.inline-code")].map((code) => text(code)) : [],
    headerCells: last ? [...last.querySelectorAll("thead th")].map((cell) => text(cell)) : [],
    rows: last ? last.querySelectorAll("tbody tr").length : 0,
    strong: last
      ? [...last.querySelectorAll("strong")].map((el) => ({
          text: text(el),
          weight: getComputedStyle(el).fontWeight,
        }))
      : [],
    images: last ? last.querySelectorAll("img").length : 0,
    scripts: last ? last.querySelectorAll("script").length : 0,
    anchors: last ? last.querySelectorAll("a[href]").length : 0,
    buttons: last ? [...last.querySelectorAll("button")].map((button) => text(button)) : [],
    blocked: last ? [...last.querySelectorAll(".blocked-image")].map((span) => text(span)) : [],
    wrapper: last ? last.querySelectorAll('[data-streamdown="table-wrapper"]').length : 0,
    injected: window.__injected ?? null,
  };
};

/** The last answer's text holds this. */
function says(page, needle) {
  return probe(
    page,
    (wanted) => {
      const all = [...document.querySelectorAll(".row-assistant .markdown")];
      return (all.at(-1)?.textContent ?? "").includes(wanted);
    },
    needle,
  );
}

/** The last answer holds at least `count` of `selector`. */
function holds(page, selector, count) {
  return probe(
    page,
    (spec) => {
      const all = [...document.querySelectorAll(".row-assistant .markdown")];
      return (all.at(-1)?.querySelectorAll(spec.selector).length ?? 0) >= spec.count;
    },
    { selector, count },
  );
}

async function runEngine(engineName, origin, brain, brainServer) {
  console.log(`\n--- ${engineName} ---`);
  const chat = await launchChat(engineName, { origin, endpoint: brainServer.endpoint });
  const page = chat.page;
  const snapshot = () => page.evaluate(SNAPSHOT);

  try {
    // 1. A fence that has not closed yet is already a code block.
    brain.plan([
      "Here is the retry helper:\n\n```js\n",
      "const wait = 200;\n",
      "const twice = (n) => n * 2;\n```\n\nThat is the whole helper, with `twice` inline.",
    ]);
    await chat.send("write me a helper");
    await brain.until(1);
    const opening = await holds(page, ".codeblock", 1);
    const opened = await snapshot();
    check(
      "an unterminated fence is already a code block",
      opening && opened.code.length === 1 && opened.code[0].language === "js",
      JSON.stringify(opened.code),
    );
    check("the empty block still carries its copy header", opened.code[0]?.copy === true, JSON.stringify(opened.code));
    check("the fence characters are never shown as text", !opened.text.includes("```"), opened.text.slice(0, 90));

    brain.release();
    await brain.until(2);
    const landed = await says(page, "const wait = 200;");
    const growing = await snapshot();
    check(
      "code written inside the open fence lands in the block",
      landed && growing.code[0]?.body === "const wait = 200;",
      JSON.stringify(growing.code),
    );

    brain.release();
    await brain.until(3);
    const closed = await chat.settled();
    const done = await snapshot();
    check(
      "the closed fence keeps both lines and the language",
      closed && done.code.length === 1 && done.code[0].body === "const wait = 200;\nconst twice = (n) => n * 2;" && done.code[0].language === "js",
      JSON.stringify({ closed, code: done.code }),
    );
    check(
      "inline code beside it stays inline",
      done.inline.includes("twice"),
      JSON.stringify({ inline: done.inline, code: done.code.length }),
    );

    // 2. A table that is still being written is already a table, and a bold
    //    run that is still open is already bold.
    brain.plan([
      "Progress so far:\n\n| Step | State |\n| --- | --- |\n",
      "| parse | done |\n",
      "| render | **under way** |\n",
      "\nThat is all of it.",
    ]);
    await chat.send("show me progress");
    await brain.until(1);
    const tableShown = await holds(page, "table", 1);
    const head = await snapshot();
    check(
      "a half-written table is already a table with its header",
      tableShown && head.headerCells.join("|") === "Step|State",
      JSON.stringify({ tableShown, headerCells: head.headerCells }),
    );
    check("its half-written rows are not shown as text", !head.text.includes("| --- |"), head.text.slice(0, 90));

    brain.release();
    await brain.until(2);
    const rowShown = await holds(page, "tbody tr", 1);
    const oneRow = await snapshot();
    check("a row that has arrived is a row", rowShown && oneRow.rows === 1, JSON.stringify({ rowShown, rows: oneRow.rows }));

    brain.release();
    await brain.until(3);
    const bold = await holds(page, "strong", 1);
    const bolded = await snapshot();
    check(
      "a bold run that has closed inside a cell is a real bold element",
      bold && bolded.strong.some((run) => run.text === "under way" && Number(run.weight) >= 600),
      JSON.stringify({ bold, strong: bolded.strong }),
    );
    check("no asterisks are shown", !bolded.text.includes("**"), bolded.text.slice(0, 120));

    brain.release();
    await brain.until(4);
    await chat.settled();
    const settledTable = await snapshot();
    check(
      "the settled table keeps its two rows",
      settledTable.rows === 2 && settledTable.strong.some((run) => run.text === "under way"),
      JSON.stringify({ rows: settledTable.rows, strong: settledTable.strong }),
    );

    // 3. Raw HTML is characters, never DOM.
    brain.plan([
      'Raw HTML arrives with this answer.\n\n<img src=x onerror="window.__injected = \'image\'">\n\n' +
        "<script>window.__injected = 'script'</script>\n\n",
      "![a remote picture](https://img.example.invalid/track.png?secret=1)\n\n" +
        "A [link to somewhere](https://example.invalid/page) and a [refused link](javascript:window.__injected = 'refused').",
    ]);
    await chat.send("render this");
    await brain.until(1);
    const tagShown = await says(page, "<img src=x onerror=");
    const injected = await snapshot();
    check(
      "a tag written in the answer is shown as its characters",
      tagShown && injected.text.includes("<script>window.__injected = 'script'</script>"),
      JSON.stringify(injected.text.slice(0, 140)),
    );
    check(
      "no element is built for it and no handler runs",
      injected.images === 0 && injected.scripts === 0 && injected.injected === null,
      JSON.stringify({ images: injected.images, scripts: injected.scripts, injected: injected.injected }),
    );

    brain.release();
    await brain.until(2);
    await chat.settled();
    const payload = await snapshot();
    check(
      "a markdown image from the network builds no element",
      payload.blocked.length === 1 && payload.images === 0,
      JSON.stringify({ blocked: payload.blocked, images: payload.images }),
    );
    const blockedWords = payload.blocked[0] ?? "";
    check(
      "and its address stays the blocked-image sentence, host and all",
      blockedWords.startsWith("Image blocked: a remote picture (img.example.invalid).") &&
        blockedWords.includes("Open address"),
      JSON.stringify(blockedWords),
    );
    check(
      "no image address is ever fetched",
      !chat.requests.some((url) => url.includes("img.example.invalid")),
      JSON.stringify(chat.requests.filter((url) => url.includes("example.invalid"))),
    );
    check(
      "an allowed link is the button the Rust gate checks, not an anchor",
      payload.anchors === 0 && payload.buttons.includes("link to somewhere"),
      JSON.stringify({ anchors: payload.anchors, buttons: payload.buttons }),
    );
    check(
      "a refused address stays text",
      payload.buttons.includes("refused link") === false && payload.text.includes("refused link"),
      JSON.stringify(payload.buttons),
    );
    check(
      "nothing at all executed by the end of the turn",
      payload.injected === null,
      JSON.stringify(payload.injected),
    );

    // 4. The answer's colors are this app's own variables, in both themes.
    const themed = (theme) =>
      page.evaluate((next) => {
        document.documentElement.dataset.theme = next;
        const markdown = document.querySelector(".row-assistant .markdown");
        const code = document.querySelector(".row-assistant .codeblock");
        return {
          ink: getComputedStyle(markdown).color,
          code: getComputedStyle(code).backgroundColor,
        };
      }, theme);
    const light = await themed("light");
    const dark = await themed("dark");
    await themed("light");
    check(
      "the answer wears the app's ink token in the light theme",
      light.ink === "rgb(23, 32, 28)" && light.code === "rgb(255, 255, 255)",
      JSON.stringify(light),
    );
    check(
      "and the dark theme's own tokens when it turns",
      dark.ink === "rgb(233, 240, 234)" && dark.code === "rgb(26, 33, 28)",
      JSON.stringify(dark),
    );

    const foreign = chat.requests.filter(
      (url) =>
        !url.startsWith(origin) &&
        !url.startsWith(brainServer.origin) &&
        !url.startsWith("data:") &&
        !url.startsWith("blob:"),
    );
    check(
      "nothing outside this computer's two endpoints was fetched",
      foreign.length === 0,
      JSON.stringify(foreign),
    );
    check(
      "no CDN is reached for shiki, mermaid or katex",
      !chat.requests.some((url) => /unpkg|jsdelivr|esm\.sh|cdn|katex|mermaid|shiki/i.test(url)),
      JSON.stringify(chat.requests),
    );
    check(
      "and Streamdown's lazy chunk for a highlighter never loads at all",
      !chat.requests.some((url) => /highlighted-body|mermaid|katex|shiki/i.test(url)),
      JSON.stringify(chat.requests),
    );
    check("the page logged no error while the answers streamed", chat.errors.length === 0, JSON.stringify(chat.errors));
  } finally {
    await chat.close();
  }
}

// --- the build itself -------------------------------------------------------

const packageJson = JSON.parse(readFileSync(join(CHAT_DIR, "package.json"), "utf8"));
const dependencies = Object.keys({ ...packageJson.dependencies, ...packageJson.devDependencies });
check(
  "no Tailwind anywhere in the app",
  !dependencies.some((name) => name.includes("tailwind")),
  JSON.stringify(dependencies.filter((name) => name.includes("tailwind"))),
);
const markdownSource = readFileSync(join(CHAT_DIR, "src", "components", "Markdown.tsx"), "utf8");
check(
  "Streamdown's own stylesheet is not imported",
  !markdownSource.includes("streamdown/styles.css"),
  markdownSource.split("\n").filter((line) => line.includes("streamdown")).join(" | "),
);

let server = null;
let brainServer = null;
try {
  const outDir = await buildApp();
  const cssFile = readdirSync(join(outDir, "assets")).find((name) => name.endsWith(".css"));
  const css = readFileSync(join(outDir, "assets", cssFile), "utf8");
  check(
    "the shipped stylesheet carries no Tailwind directive or Streamdown animation",
    !css.includes("@tailwind") && !css.includes("@source") && !css.includes("sd-fadeIn"),
    JSON.stringify({ tailwind: css.includes("@tailwind"), source: css.includes("@source"), animation: css.includes("sd-fadeIn") }),
  );

  const brain = scriptedEndpoint();
  const served = await serveDist(outDir, appCsp());
  server = served;
  const brainServed = await startBrain(brain);
  brainServer = brainServed;
  const engines = process.argv.slice(2).length > 0 ? process.argv.slice(2) : Object.keys(ENGINES);
  for (const engineName of engines) await runEngine(engineName, served.origin, brain, brainServed);
} finally {
  if (brainServer) brainServer.close();
  if (server) server.close();
  await rm(join(CHAT_DIR, ".stream-app-dist"), { recursive: true, force: true });
}

if (failedChecks() > 0) {
  console.log(`\n${failedChecks()} check(s) failed`);
  process.exit(1);
}
console.log("\nall checks passed");
