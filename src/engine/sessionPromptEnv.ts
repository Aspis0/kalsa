/**
 * Load-time prompt-env hash. Must match streamAssistantTurn's save hash (F6).
 */

import { getToolChoiceMode, shouldUseToolCalling } from "../bench/benchConfig";
import * as MemoryStore from "../memory/MemoryStore";
import { promptEnvToolHashFields } from "./sessionKey";
import {
  computePromptEnvHash,
  memoryFactTextsForEnvHash,
} from "./sessionPersistence";
import { MEMORY_FACTS_ON_USER_TAIL } from "./ttftFlags";

export async function computeSessionPromptEnvHash(args: {
  locale: string;
  tools?: { function: { name: string } }[] | null;
  executeTool?: unknown;
  blockFormat?: string | null;
}): Promise<string> {
  const toolNames = (args.tools ?? []).map((tool) => tool.function.name);
  const hashed = promptEnvToolHashFields({
    toolsWired: Boolean(toolNames.length && args.executeTool),
    toolCallingEnabled: shouldUseToolCalling(await getToolChoiceMode()),
    toolNames,
  });
  let facts: readonly string[] = [];
  if (!MEMORY_FACTS_ON_USER_TAIL) {
    try {
      const enabled = await MemoryStore.getEnabled();
      if (enabled) {
        facts = memoryFactTextsForEnvHash(await MemoryStore.listFacts());
      }
    } catch {
      // empty facts → match disabled / cold
    }
  }
  return computePromptEnvHash(
    args.locale,
    facts,
    hashed.hasTools,
    hashed.toolNames,
    args.blockFormat,
  );
}
