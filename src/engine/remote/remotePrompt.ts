import {
  buildOperativeBlock,
  hasOperativeContext,
  type OperativeBlockContext,
} from "../../context/operativeBlock";
import { getStrings, type Locale } from "../../i18n";
import type { MemoryFact } from "../../memory/MemoryStore";
import { buildMemoryFactsBlock } from "../memoryFactsTail";

export function buildRemoteSystemPrompt(opts: {
  locale: Locale;
  memoryFacts?: readonly MemoryFact[] | null;
  operativeContext?: OperativeBlockContext | null;
}): string {
  // buildSystemPrompt would drop the facts here (MEMORY_FACTS_ON_USER_TAIL is true, ttftFlags.ts:26), so append main's fact block directly.
  let prompt = getStrings(opts.locale).systemPrompt;
  const factBlock = buildMemoryFactsBlock(opts.locale, opts.memoryFacts);
  if (factBlock.length > 0) prompt += `\n\n${factBlock}`;
  if (hasOperativeContext(opts.operativeContext ?? null)) {
    const block = buildOperativeBlock(opts.locale, opts.operativeContext ?? null);
    if (block.trim().length > 0) prompt += `\n\n${block}`;
  }
  return prompt;
}
