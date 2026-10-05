// The driver (one responsibility: run model x condition x item and record
// everything raw). Conditions: A plain; B validators with one named re-ask;
// C the relative-date create schema with code-computed instants (validators
// on the computed proposal, same re-ask).
import { appendFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ask, toolCall, replyText, callArguments } from "./engine.mjs";
import { toolsFor } from "./tools.mjs";
import { ITEMS, SMOKE_IDS, itemFor, promptFor, langFor } from "./items.mjs";
import { validateCreate, validateAgenda, reaskPrompt } from "./validators.mjs";
import { instantsFrom } from "./relative.mjs";
import { scoreItem } from "./score.mjs";

const arg = (name) => {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? null : process.argv[at + 1];
};

const toProposal = (condition, call) => {
  const args = callArguments(call);
  if (!args) return { args: null, computed: null };
  if (condition !== "C" || call?.function?.name !== "create_calendar_event") return { args, computed: null };
  const instants = instantsFrom(args);
  if (instants.error) return { args, computed: null, error: instants.error };
  const proposal = {
    title: args.title,
    start: instants.start,
    end: instants.end,
    allDay: instants.allDay,
    location: args.location ?? null,
  };
  return { args, computed: proposal };
};

async function main() {
  const base = arg("base") ?? "http://127.0.0.1:18150";
  const model = arg("model");
  const tag = arg("tag");
  const outDir = arg("out") ?? "/tmp/lab-calendar";
  const smoke = process.argv.includes("--smoke");
  const noThink = process.argv.includes("--no-think");
  const onlyConditions = arg("conditions")?.split(",") ?? ["A", "B", "C"];
  if (!model || !tag) throw new Error("--model and --tag are required");
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, `${tag}.jsonl`);
  const done = new Set(
    existsSync(outPath)
      ? readFileSync(outPath, "utf8").trim().split("\n").filter(Boolean).map((l) => {
          const r = JSON.parse(l);
          return `${r.id}/${r.condition}`;
        })
      : [],
  );
  const items = smoke ? SMOKE_IDS.map(itemFor) : ITEMS;

  for (const item of items) {
    const prompt = promptFor(item);
    for (const condition of onlyConditions) {
      if (done.has(`${item.id}/${condition}`)) continue;
      const tools = toolsFor(condition);
      const first = await ask({ base, model, prompt, tools, noThink });
      const call1 = toolCall(first);
      const record = {
        tag, condition, id: item.id, kind: item.kind, prompt, lang: langFor(item),
        calls: [{ name: call1?.function?.name ?? null, args: callArguments(call1), status: first.status, wallMs: first.wallMs, usage: first.body?.usage ?? null }],
        reply: replyText(first),
      };
      let proposal = toProposal(condition, call1);
      let outcome = call1 ? "call" : "text";
      if (call1 && condition !== "A" && (call1.function.name === "create_calendar_event" || call1.function.name === "calendar_agenda")) {
        // Only calendar calls are validated; the distractor is a tool-CHOICE
        // error, which no argument check can repair.
        const validator = call1.function.name === "create_calendar_event" ? validateCreate : validateAgenda;
        const proposalArgs = proposal.computed ?? proposal.args;
        const meta = { weekdayNamed: item.weekdayNamed };
        const failures = proposal.error ? [proposal.error] : validator(proposalArgs, meta);
        if (failures.length > 0) {
          const reask = await ask({ base, model, prompt: reaskPrompt(failures), tools, noThink });
          const call2 = toolCall(reask);
          record.calls.push({ name: call2?.function?.name ?? null, args: callArguments(call2), status: reask.status, wallMs: reask.wallMs, usage: reask.body?.usage ?? null, afterFailures: failures });
          const second = toProposal(condition, call2);
          const secondFailures = second.error ? [second.error] : validator(second.computed ?? second.args, meta);
          if (secondFailures.length > 0) {
            proposal = second;
            outcome = "unsure";
            record.unsureReason = secondFailures.join("; ");
          } else {
            proposal = second;
            outcome = "call-after-reask";
            record.reaskFixed = true;
          }
        }
      }
      const finalArgs = proposal.computed ?? proposal.args;
      record.finalArgs = finalArgs;
      record.outcome = outcome;
      record.verdict = scoreItem({ item, calls: record.calls, reply: record.reply, finalArgs, outcome, lang: record.lang });
      appendFileSync(outPath, JSON.stringify(record) + "\n");
      const v = record.verdict;
      console.log(
        `${tag} ${condition} ${item.id} ${record.calls.map((c) => c.name ?? "none").join("->")} ${outcome} ` +
        `tool=${v.toolChoice} window=${v.window ?? "-"} silent=${v.silent}${v.fields ? " fields=" + Object.entries(v.fields).map(([k, x]) => k + ":" + x).join(",") : ""}`,
      );
    }
  }
}

main();
