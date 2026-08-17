/**
 * getFormattedChat pair, dummy eot capture, and jinja extras.
 * No module-level T — that lives in kvTranscript.ts.
 */

export const EOT_MARKER = "\u0007KALSATX\u0007";

export type FormattedChatLike = {
  type: string;
  prompt: string;
  has_media?: boolean;
  media_paths?: string[];
  generation_prompt?: string;
  chat_parser?: string;
  grammar?: string;
  grammar_lazy?: boolean;
  grammar_triggers?: Array<{ type: number; value: string; token: number }>;
  preserved_tokens?: string[];
  additional_stops?: string[];
  chat_format?: number;
  thinking_forced_open?: boolean;
  thinking_start_tag?: string;
  thinking_end_tag?: string;
};

export type FormatChatParams = {
  jinja?: boolean;
  tools?: object;
  tool_choice?: string;
  enable_thinking?: boolean;
  reasoning_format?: "none" | "auto" | "deepseek";
  add_generation_prompt?: boolean;
  chat_template_kwargs?: Record<string, string | number | boolean>;
};

export type FormatEngine = {
  getFormattedChat: (
    messages: object[],
    template?: string | null,
    params?: FormatChatParams,
  ) => Promise<FormattedChatLike>;
};

export type FormatKwargs = {
  tools?: object;
  tool_choice?: string;
  enable_thinking?: boolean;
  reasoning_format?: "none" | "auto" | "deepseek";
  chat_template_kwargs?: Record<string, string | number | boolean>;
};

export type JinjaCompletionExtras = {
  generation_prompt?: string;
  chat_parser?: string;
  grammar?: string;
  grammar_lazy?: boolean;
  grammar_triggers?: Array<{ type: number; value: string; token: number }>;
  preserved_tokens?: string[];
  stop: string[];
  media_paths?: string[];
  chat_format?: number;
  thinking_forced_open?: boolean;
  thinking_start_tag?: string;
  thinking_end_tag?: string;
};

export async function formatTranscriptPair(
  engine: FormatEngine,
  pPrevMsgs: object[],
  pNewMsgs: object[],
  kwargs: FormatKwargs,
): Promise<{ pPrev: FormattedChatLike; pNew: FormattedChatLike }> {
  const pPrev = await engine.getFormattedChat(pPrevMsgs, null, {
    jinja: true,
    add_generation_prompt: false,
    ...kwargs,
  });
  const pNew = await engine.getFormattedChat(pNewMsgs, null, {
    jinja: true,
    add_generation_prompt: true,
    ...kwargs,
  });
  return { pPrev, pNew };
}

export async function captureEotSuffix(
  engine: FormatEngine,
  pNewMsgs: object[],
  kwargs: FormatKwargs,
): Promise<string> {
  const pNogen = await engine.getFormattedChat(pNewMsgs, null, {
    jinja: true,
    add_generation_prompt: false,
    ...kwargs,
  });
  const dummyMsgs = [...pNewMsgs, { role: "assistant", content: EOT_MARKER }];
  const pDummy = await engine.getFormattedChat(dummyMsgs, null, {
    jinja: true,
    add_generation_prompt: false,
    ...kwargs,
  });
  const nogenPrompt = pNogen.prompt ?? "";
  const dummyPrompt = pDummy.prompt ?? "";
  if (!dummyPrompt.startsWith(nogenPrompt)) return "";
  const after = dummyPrompt.slice(nogenPrompt.length);
  const idx = after.indexOf(EOT_MARKER);
  if (idx < 0) return "";
  return after.slice(idx + EOT_MARKER.length);
}

export function extrasFromJinja(
  result: FormattedChatLike,
  stopWords: string[],
): JinjaCompletionExtras {
  const extras: JinjaCompletionExtras = {
    stop: result.additional_stops
      ? [...stopWords, ...result.additional_stops]
      : [...stopWords],
  };
  if (typeof result.generation_prompt === "string") {
    extras.generation_prompt = result.generation_prompt;
  }
  if (result.chat_parser) extras.chat_parser = result.chat_parser;
  if (result.grammar) extras.grammar = result.grammar;
  if (typeof result.grammar_lazy === "boolean") {
    extras.grammar_lazy = result.grammar_lazy;
  }
  if (result.grammar_triggers) extras.grammar_triggers = result.grammar_triggers;
  if (result.preserved_tokens) extras.preserved_tokens = result.preserved_tokens;
  if (result.media_paths) extras.media_paths = result.media_paths;
  if (typeof result.chat_format === "number") extras.chat_format = result.chat_format;
  if (typeof result.thinking_forced_open === "boolean") {
    extras.thinking_forced_open = result.thinking_forced_open;
  }
  if (typeof result.thinking_start_tag === "string") {
    extras.thinking_start_tag = result.thinking_start_tag;
  }
  if (typeof result.thinking_end_tag === "string") {
    extras.thinking_end_tag = result.thinking_end_tag;
  }
  return extras;
}

export function shouldHaltFormatted(args: {
  hasTools: boolean;
  formatted: FormattedChatLike;
}): { halt: true; reason: string } | { halt: false } {
  if (args.hasTools && args.formatted.type !== "jinja") {
    return { halt: true, reason: "tools_not_jinja" };
  }
  if (args.formatted.has_media && !args.formatted.media_paths) {
    return { halt: true, reason: "media_without_paths" };
  }
  return { halt: false };
}
