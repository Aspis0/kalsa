// The scorer (one responsibility: did the model call create_miniapp when it
// helps?). Verdicts against the item's label:
//   should_call → hit / miss (no call) / wrong_template / invalid_args
//   should_not  → correct / false_call
//   borderline  → recorded apart (called / text), never in the rates
// Beside the verdict: does the visible text leak tool/template ids
// (definitions.ts tells the model never to show them)?
import { validateMiniappCall } from "./validators.mjs";

const LEAK_TOKENS = ["create_miniapp", "compare_data", "quick_calculator", "reading_quiz", "miniapp"];
// "checklist" is a template name AND an ordinary English word for a to-do
// list, so it is recorded on its own and judged by eye in the report.
const ENGLISH_NAME_TOKENS = ["checklist", "template", "slot"];

export function leakScan(text) {
  const t = String(text ?? "");
  const hits = (tokens) => tokens.filter((w) => t.toLowerCase().includes(w));
  const leak = hits(LEAK_TOKENS);
  const nameWords = hits(ENGLISH_NAME_TOKENS);
  return { leakTokens: leak, nameTokens: nameWords, leak: leak.length > 0 };
}

export function scoreItem({ item, call, args, reply }) {
  const verdict = {
    outcome: call ? "call" : "text",
    leak: leakScan(reply),
  };
  if (item.kind === "borderline") {
    verdict.verdict = call ? "called" : "text";
    return verdict;
  }
  if (item.kind === "should_not") {
    verdict.verdict = call ? "false_call" : "correct";
    if (call) {
      const v = validateMiniappCall(call.function.name, args);
      verdict.calledTemplate = args?.template ?? null;
      verdict.argsValid = v.ok;
      if (!v.ok) verdict.refusal = v.refusal;
    }
    return verdict;
  }
  // should_call
  if (!call) {
    verdict.verdict = "miss";
    return verdict;
  }
  const template = args?.template ?? null;
  verdict.calledTemplate = template;
  if (template !== item.expected) {
    verdict.verdict = "wrong_template";
    const v = validateMiniappCall(call.function.name, args);
    verdict.argsValid = v.ok;
    if (!v.ok) verdict.refusal = v.refusal;
    return verdict;
  }
  const v = validateMiniappCall(call.function.name, args);
  verdict.argsValid = v.ok;
  if (!v.ok) {
    verdict.verdict = "invalid_args";
    verdict.refusal = v.refusal;
  } else {
    verdict.verdict = "hit";
  }
  return verdict;
}
