/**
 * getFormattedChat pair, dummy eot capture, and jinja extras.
 * No module-level T — that lives in kvTranscript.ts.
 */

export const EOT_MARKER = "\u0007KALSATX\u0007";
/** Dummy content for the role-pair pPrev cut. Must not appear in a template. */
export const PREV_SENTINEL = "\u0007KALSAPREV\u0007";

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

export function longestCommonPrefix(a: string, b: string): string {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a.charCodeAt(i) === b.charCodeAt(i)) i += 1;
  return a.slice(0, i);
}

/**
 * pPrev = LCP(R_user, R_asst) so assistant N is historical on both sides
 * and the cut is the first byte of the *role* header of the dummy message.
 *
 * ChatML user/assistant headers share `<|im_start|>`. Walking the LCP back
 * to the nearest newline from the diverge point drops that shared suffix
 * so pPrev ends at assistant N's eot, not mid-header. No template tokens.
 *
 * Null: missing sentinel, empty LCP, or a side whose suffix is the sentinel
 * (consecutive-assistant merge — no role header).
 */
export function cutPPrevFromRolePair(
  rUser: string,
  rAsst: string,
  sentinel: string,
): string | null {
  if (rUser.indexOf(sentinel) < 0 || rAsst.indexOf(sentinel) < 0) return null;
  let lcp = longestCommonPrefix(rUser, rAsst);
  if (lcp.length === 0) return null;
  if (rUser.startsWith(sentinel, lcp.length) || rAsst.startsWith(sentinel, lcp.length)) {
    return null;
  }
  let i = lcp.length - 1;
  while (i >= 0 && lcp[i] !== "\n") i -= 1;
  if (i >= 0) lcp = lcp.slice(0, i + 1);
  return lcp.length > 0 ? lcp : null;
}

export async function formatTranscriptPair(
  engine: FormatEngine,
  pPrevMsgs: object[],
  pNewMsgs: object[],
  kwargs: FormatKwargs,
): Promise<{
  pPrev: FormattedChatLike;
  pNew: FormattedChatLike;
  pPrevSentinelFound: boolean;
}> {
  const noGen = { jinja: true as const, add_generation_prompt: false, ...kwargs };
  const rUser = await engine.getFormattedChat(
    [...pPrevMsgs, { role: "user", content: PREV_SENTINEL }],
    null,
    noGen,
  );
  const rAsst = await engine.getFormattedChat(
    [...pPrevMsgs, { role: "assistant", content: PREV_SENTINEL }],
    null,
    noGen,
  );
  const pNew = await engine.getFormattedChat(pNewMsgs, null, {
    jinja: true,
    add_generation_prompt: true,
    ...kwargs,
  });
  const cut = cutPPrevFromRolePair(
    rUser.prompt ?? "",
    rAsst.prompt ?? "",
    PREV_SENTINEL,
  );
  const cutLen = cut?.length ?? 0;
  const u = rUser.prompt ?? "";
  const a = rAsst.prompt ?? "";
  console.log(
    "KALSA_KVTRANSCRIPT " +
      JSON.stringify({
        op: "cut",
        cutLen,
        uWin: u.slice(cutLen, cutLen + 48),
        aWin: a.slice(cutLen, cutLen + 48),
      }),
  );
  return {
    pPrev: { ...rUser, prompt: cut ?? (pNew.prompt ?? "") },
    pNew,
    pPrevSentinelFound: cut !== null,
  };
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
