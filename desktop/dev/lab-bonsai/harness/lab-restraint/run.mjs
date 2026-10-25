// The driver (one responsibility: run model x item and record everything
// raw). Appends one JSONL record per item, resumable by id.
import { appendFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ask, toolCall, replyText, callArguments, fetchProps, readsEnableThinking } from "./engine.mjs";
import { ITEMS, SMOKE_IDS, itemFor } from "./items.mjs";
import { scoreItem } from "./score.mjs";

const arg = (name) => {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? null : process.argv[at + 1];
};

async function main() {
  const base = arg("base") ?? "http://127.0.0.1:8150";
  const model = arg("model");
  const tag = arg("tag");
  const outDir = arg("out") ?? "/tmp/lab-restraint";
  const smoke = process.argv.includes("--smoke");
  if (!model || !tag) throw new Error("--model and --tag are required");
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, `${tag}.jsonl`);
  const done = new Set(
    existsSync(outPath)
      ? readFileSync(outPath, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l).id)
      : [],
  );

  const props = await fetchProps(base);
  const noThink = readsEnableThinking(props.chatTemplate);
  console.log(`props: model=${props.model} nctx=${props.nctx} enable_thinking=${noThink}`);
  const items = smoke ? SMOKE_IDS.map(itemFor) : ITEMS;

  for (const item of items) {
    if (done.has(item.id)) continue;
    const result = await ask({ base, model, prompt: item.prompt, noThink });
    const call = toolCall(result);
    const args = callArguments(call);
    const reply = replyText(result);
    const verdict = scoreItem({ item, call, args, reply });
    const record = {
      tag,
      id: item.id,
      kind: item.kind,
      expected: item.expected ?? null,
      lang: item.lang,
      prompt: item.prompt,
      status: result.status,
      timedOut: result.timedOut,
      wallMs: result.wallMs,
      finishReason: result.body?.choices?.[0]?.finish_reason ?? null,
      usage: result.body?.usage ?? null,
      call: call ? { name: call.function.name, arguments: call.function.arguments } : null,
      args: args ?? call?.function?.arguments ?? null,
      argsParseFailed: call ? args === null : false,
      reply,
      verdict,
    };
    appendFileSync(outPath, JSON.stringify(record) + "\n");
    const v = record.verdict;
    console.log(
      `${tag} ${item.id} [${item.kind}] -> ${v.verdict}` +
      `${v.calledTemplate ? ` template=${v.calledTemplate}` : ""}` +
      `${v.verdict === "hit" ? "" : v.argsValid === false ? " args=INVALID" : ""}` +
      `${v.leak.leak ? " LEAK:" + v.leak.leakTokens.join("|") : ""}` +
      ` ${record.wallMs}ms`,
    );
  }
}

main();
