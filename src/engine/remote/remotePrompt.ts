import {
  buildOperativeBlock,
  hasOperativeContext,
  type OperativeBlockContext,
} from "../../context/operativeBlock";
import { getStrings, type Locale } from "../../i18n";

type FactLike = { text: string };

/**
 * Memory facts in the system slot. Facts are untrusted data: control chars
 * stripped, whitespace collapsed, each capped, newest few kept. (Local turns
 * ride them on the last user message instead — remote has no local KV prefix
 * to protect, and the system slot keeps them stable across turns.)
 */
const MAX_PROMPT_FACTS = 10;
const MAX_PROMPT_FACT_CHARS = 120;

function memoryFactsBlock(
  locale: Locale,
  facts: readonly FactLike[],
): string {
  const cleaned = facts
    .map((fact) =>
      fact.text
        .replace(/[\u0000-\u001f\u007f]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, MAX_PROMPT_FACT_CHARS),
    )
    .filter((line) => line.length > 0)
    .slice(-MAX_PROMPT_FACTS);
  if (cleaned.length === 0) return "";
  return getStrings(locale).memory.promptSection.replace(
    "{facts}",
    cleaned.map((fact) => `- ${fact}`).join("\n"),
  );
}

export function buildRemoteSystemPrompt(opts: {
  locale: Locale;
  memoryFacts?: readonly FactLike[] | null;
  operativeContext?: OperativeBlockContext | null;
}): string {
  const facts = opts.memoryFacts ?? [];
  let prompt = getStrings(opts.locale).systemPrompt;
  const factBlock = memoryFactsBlock(opts.locale, facts);
  if (factBlock.length > 0) prompt += `\n\n${factBlock}`;
  if (hasOperativeContext(opts.operativeContext ?? null)) {
    const block = buildOperativeBlock(opts.locale, opts.operativeContext ?? null);
    if (block.trim().length > 0) prompt += `\n\n${block}`;
  }
  return prompt;
}
