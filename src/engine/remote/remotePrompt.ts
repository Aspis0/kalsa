import {
  buildOperativeBlock,
  hasOperativeContext,
  type OperativeBlockContext,
} from "../../context/operativeBlock";
import type { Locale } from "../../i18n";
import { buildSystemPrompt } from "../memoryPrompt";

type FactLike = { text: string };

export function buildRemoteSystemPrompt(opts: {
  locale: Locale;
  memoryFacts?: readonly FactLike[] | null;
  operativeContext?: OperativeBlockContext | null;
}): string {
  const facts = (opts.memoryFacts ?? []).map((fact) => fact.text);
  let prompt = buildSystemPrompt(opts.locale, false, facts);
  if (hasOperativeContext(opts.operativeContext ?? null)) {
    const block = buildOperativeBlock(opts.locale, opts.operativeContext ?? null);
    if (block.trim().length > 0) prompt += `\n\n${block}`;
  }
  return prompt;
}
