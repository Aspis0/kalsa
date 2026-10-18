// The loop (one responsibility: drive one task to a verdict, inside the step
// and wall-clock caps, and write down what happened). The model is asked; the
// tools answer; every answer ends in a fresh snapshot so it can go on. The loop
// ends on finish, on a cap, or on a call it cannot make — and whatever the
// reason, the page is still read afterwards, because a model that did the work
// and then ran out of steps did do the work.
import { callsOf, replyText, usageOf } from "./engine.mjs";
import { SNAPSHOT_CHARS } from "./snapshot.mjs";
import { TOOL_NAMES } from "./tools.mjs";
import { answerSeen, verify } from "./verifiers.mjs";

export const STEP_CAP = 15;
export const WALL_CAP_MS = 180_000;
const ANSWER_CHARS = 300;
// A snapshot is already capped, and its "Part 1 of 4" footer has to survive to
// reach the model, so this sits above that cap rather than at it.
const TOOL_RESULT_CHARS = SNAPSHOT_CHARS + 1000;

// Said once, when the model answers with nothing at all — not a tool call and
// no words. A user turn is needed anyway: two assistant messages in a row is a
// malformed conversation and the server rejects it.
const NUDGE = "Use one of the browser tools, or answer with finish.";

/** One line of prose: answers, errors and details are flattened so a json line
 *  stays readable. */
const flat = (text, n) => {
  const s = String(text ?? "").replace(/\s+/g, " ").trim();
  return s.length <= n ? s : `${s.slice(0, n)}…`;
};

/** A tool result keeps its lines: a snapshot is a list, and collapsing it to
 *  one line takes away the very structure the model has to read refs in. */
const clamp = (text, n) => {
  const s = String(text ?? "");
  return s.length <= n ? s : `${s.slice(0, n)}\n… tool result cut at ${n} chars`;
};

const toolMessage = (call, content) => ({
  role: "tool",
  tool_call_id: call.id ?? `call_${call.name}`,
  content: clamp(content, TOOL_RESULT_CHARS),
});

/** True when the last `n` calls are the same call with the same arguments —
 *  a model asking the same question three times and getting nowhere. Recorded,
 *  never interfered with: a model may legitimately click twice. */
const repeated = (calls, n) => {
  const tail = calls.slice(-n);
  if (tail.length < n) return false;
  const key = (c) => `${c.name} ${JSON.stringify(c.args ?? null)}`;
  return tail.every((c) => key(c) === key(tail[0]));
};

/** One task, one run. `askOnce` is the whole seam the fake model plugs into:
 *  given the conversation so far, it returns what an engine turn looks like. */
export async function runTask({ task, browser, askOnce, model, think, step = STEP_CAP, wallMs = WALL_CAP_MS }) {
  const began = Date.now();
  // The run starts on the task's own page, already open, with that page already
  // in front of the model. Opening it is not a model step, so a model is never
  // charged for being told where it is.
  const opening = await browser.run("browser_navigate", { url: task.url });
  // Everything the browser handed over, opening page included, so a run can say
  // afterwards whether its answer was read or already known.
  const shown = [opening];
  const messages = [
    { role: "system", content: task.systemPrompt },
    { role: "user", content: `${task.prompt}\n\nYou are already on ${task.url}. This is the page:\n\n${opening}` },
  ];
  const calls = [];
  let answer = "";
  let lastSaid = "";
  let endedBy = null;
  let nudged = false;
  let looped = false;
  let failure = null;
  let tokens = { prompt: 0, completion: 0 };

  const outOfTime = () => Date.now() - began > wallMs;

  for (let n = 1; n <= step && !failure; n += 1) {
    if (outOfTime()) {
      failure = "time cap";
      break;
    }
    const turn = await askOnce({ messages, task, model, think });
    const usage = usageOf(turn);
    tokens.prompt += usage.prompt ?? 0;
    tokens.completion += usage.completion ?? 0;
    if (turn.error) {
      failure = `engine error: ${flat(turn.error, 160)}`;
      break;
    }

    const asked = callsOf(turn);
    const said = replyText(turn);
    if (said) lastSaid = said;

    // Words with no tool call is an answer, not a shrug: that is how the app
    // reads it, and the verifier still has the last word on it.
    if (asked.length === 0) {
      if (said) {
        answer = said;
        endedBy = "prose";
        break;
      }
      if (!nudged) {
        nudged = true;
        messages.push({ role: "user", content: NUDGE });
        continue;
      }
      failure = "invalid tool call: the model returned no tool call and no text, twice";
      break;
    }

    messages.push({ role: "assistant", content: said || null, tool_calls: turn.body.choices[0].message.tool_calls });
    for (const call of asked) {
      calls.push({ step: n, name: call.name, args: call.args ?? call.rawArguments });
      if (repeated(calls, 3)) looped = true;
      if (!TOOL_NAMES.includes(call.name)) {
        failure = `invalid tool call: there is no tool called ${call.name}`;
      } else if (call.name === "finish") {
        answer = String(call.args?.answer ?? "");
        endedBy = "finish";
        messages.push(toolMessage(call, "done"));
      } else {
        const result = await browser.run(call.name, call.args ?? {});
        shown.push(result);
        messages.push(toolMessage(call, result));
      }
    }
    if (answer) break;
    if (outOfTime()) failure = "time cap";
  }
  if (!failure && !answer) failure = "step cap";

  const verdict = await verify(task.id, browser, answer);
  return {
    task: task.id,
    name: task.name,
    steps: calls.length,
    seconds: Number(((Date.now() - began) / 1000).toFixed(1)),
    ok: verdict.ok,
    detail: verdict.detail,
    failure,
    endedBy,
    looped,
    answerSeen: answerSeen(answer, shown),
    answer: flat(answer, ANSWER_CHARS),
    lastSaid: flat(lastSaid, ANSWER_CHARS),
    promptTokens: tokens.prompt,
    completionTokens: tokens.completion,
    lastUrl: browser.url,
    calls,
  };
}

