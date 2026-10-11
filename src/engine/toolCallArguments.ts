/**
 * Tool-call arguments as the model emitted them: whether they parse as a JSON
 * object, and the form they take when echoed back into the transcript.
 */

/**
 * Model-directed tool-role content for a call whose arguments did not parse
 * (English, not i18n, same convention as the other tool-loop messages). The
 * raw model text is deliberately not echoed back.
 */
export const TOOL_ARGS_RETRY_MESSAGE =
  "error: the arguments of this tool call were not valid JSON; call the tool again with arguments as a JSON object";

export function parseToolArguments(raw: string | undefined): {
  args: Record<string, unknown>;
  parseFailed: boolean;
  raw: string;
} {
  if (!raw) return { args: {}, parseFailed: false, raw: "" };
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return { args: parsed as Record<string, unknown>, parseFailed: false, raw };
    }
    return { args: {}, parseFailed: true, raw };
  } catch {
    return { args: {}, parseFailed: true, raw };
  }
}

/**
 * The arguments string echoed into the next round. The engine re-parses echoed
 * arguments while formatting the prompt, and a parse error there fails the whole
 * turn, so anything that is not a JSON object text (empty included) becomes "{}".
 */
export function echoedToolArguments(raw: string | undefined): string {
  return raw && !parseToolArguments(raw).parseFailed ? raw : "{}";
}
