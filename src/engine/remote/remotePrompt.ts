import {
  buildOperativeBlock,
  hasOperativeContext,
  type OperativeBlockContext,
} from "../../context/operativeBlock";
import { getStrings, type Locale } from "../../i18n";

export function buildRemoteSystemPrompt(opts: {
  locale: Locale;
  operativeContext?: OperativeBlockContext | null;
}): string {
  // Memory facts are NOT part of the system slot: remote turns put them on
  // the last user message (format B), like local turns — see
  // streamRemoteAssistantTurn; ttftFlags.ts:26 gives main's reason.
  let prompt = getStrings(opts.locale).systemPrompt;
  if (hasOperativeContext(opts.operativeContext ?? null)) {
    const block = buildOperativeBlock(opts.locale, opts.operativeContext ?? null);
    if (block.trim().length > 0) prompt += `\n\n${block}`;
  }
  return prompt;
}
