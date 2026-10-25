// The thinking control's two pure halves, and a live check that the field does
// what it says.
//
//   node scripts/thinking.mjs            # the template inspection and the body
//   node scripts/thinking.mjs --live     # and the real llama-server, if it is up
//
// The pure half is hermetic: the templates it reads are in
// `thinking-templates.json`, and one of them is the running model's own
// template, verbatim. The live half needs a server and fails loudly without
// one, because a check that passes by doing nothing is worse than none.

import { readFile, rm } from "node:fs/promises";
import { loadApp } from "./lib/app-bundle.mjs";

const ENDPOINT = process.env.KALSA_ENDPOINT ?? "http://127.0.0.1:8130";
const live = process.argv.includes("--live");

const { dir, app } = await loadApp();
let failures = 0;
function check(label, ok, detail = "") {
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

const templates = JSON.parse(
  await readFile(new URL("./thinking-templates.json", import.meta.url), "utf8"),
);

// --- what the template says -------------------------------------------------

const real = app.thinkingSupport(templates.enable_thinking);
check(
  "template: the installed model's own template reads enable_thinking",
  real.enableThinking === true && real.reasoningEffort === false,
  JSON.stringify(real),
);
const effort = app.thinkingSupport(templates.reasoning_effort);
check(
  "template: an effort-only template is seen as effort, not as a switch",
  effort.enableThinking === false && effort.reasoningEffort === true,
  JSON.stringify(effort),
);
const neither = app.thinkingSupport(templates.neither);
check(
  "template: a template with no switch offers nothing",
  neither.enableThinking === false && neither.reasoningEffort === false,
  JSON.stringify(neither),
);

// --- what the request carries -----------------------------------------------

const messages = [{ role: "user", content: "Say hi." }];
const body = (thinking) => app.completionBody("a-model", messages, { temperature: 0.2 }, [], "auto", thinking);

check(
  "wire: thinking off carries the template kwarg",
  JSON.stringify(body(false).chat_template_kwargs) === '{"enable_thinking":false}',
  JSON.stringify(body(false).chat_template_kwargs),
);
check(
  "wire: thinking on carries no such field",
  !("chat_template_kwargs" in body(true)),
  JSON.stringify(body(true).chat_template_kwargs),
);
check(
  "wire: leaving it alone carries no such field either",
  !("chat_template_kwargs" in body(null)) && !("chat_template_kwargs" in app.completionBody("m", messages, {})),
  JSON.stringify(body(null).chat_template_kwargs),
);
const withTools = app.completionBody("a-model", messages, {}, [{ type: "function", function: { name: "web_search", description: "d", parameters: {} } }], "none", false);
check(
  "wire: tools and thinking off travel together",
  withTools.tool_choice === "none" &&
    Array.isArray(withTools.tools) &&
    JSON.stringify(withTools.chat_template_kwargs) === '{"enable_thinking":false}',
  JSON.stringify({ tool_choice: withTools.tool_choice, kwargs: withTools.chat_template_kwargs }),
);

// --- the real server --------------------------------------------------------

if (live) {
  const listed = await fetch(`${ENDPOINT}/v1/models`);
  if (!listed.ok) {
    throw new Error(`no llama-server at ${ENDPOINT} (HTTP ${listed.status}) — the live check needs one`);
  }
  const model = (await listed.json()).models[0].name;
  const props = await (await fetch(`${ENDPOINT}/props`)).json();
  check(
    "live: the server reports a template that reads enable_thinking",
    typeof props.chat_template === "string" && app.thinkingSupport(props.chat_template).enableThinking === true,
    `${String(props.chat_template ?? "").length} characters`,
  );

  const ask = async (thinking) => {
    const request = app.completionBody(model, [{ role: "user", content: "How many r's are in strawberry? Think it through." }], { temperature: 0.2, seed: 1, max_tokens: 400 }, [], "auto", thinking);
    const response = await fetch(`${ENDPOINT}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...request, stream: false }),
    });
    if (!response.ok) throw new Error(`the server answered ${response.status}`);
    const answer = (await response.json()).choices?.[0]?.message ?? {};
    return { thinking: answer.reasoning_content ?? "", content: answer.content ?? "" };
  };

  const off = await ask(false);
  check(
    "live: thinking off comes back with no reasoning and a real answer",
    off.thinking.trim() === "" && off.content.trim() !== "",
    `reasoning ${off.thinking.length} chars, answer ${off.content.length} chars`,
  );
  const on = await ask(true);
  check(
    "live: thinking on comes back with reasoning — so the check above is not vacuous",
    on.thinking.trim() !== "",
    `reasoning ${on.thinking.length} chars, answer ${on.content.length} chars`,
  );
}

await rm(dir, { recursive: true, force: true });
console.log(failures === 0 ? "\nthe thinking control's checks passed" : `\n${failures} checks FAILED`);
process.exit(failures === 0 ? 0 : 1);
