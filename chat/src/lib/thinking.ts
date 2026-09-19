/**
 * The thinking control, and the only levers it may expose.
 *
 * A llama.cpp server renders every request with the model's own Jinja chat
 * template, and hands that template back in `GET /props`. The template is the
 * manufacturer's voice: it says which switches exist. Two are plausible, and
 * only two:
 *
 * * `enable_thinking` — the field oMLX, MTPLX and `mlx-lm` all put inside
 *   `chat_template_kwargs`, and the one measured working against this server
 *   (815 characters of thinking became none, seed pinned). It is what this app
 *   offers, and only when the template reads it.
 * * `reasoning_effort` — a lever some templates read. No model installed here
 *   does, and the levels a template accepts are not knowable from its text
 *   (MTPLX keeps them in a codec, oMLX in a preset), so no levels are offered:
 *   a control that moves while nothing changes is worse than no control,
 *   because the reader believes it did something.
 *
 * Everything else measured on the way here was a runtime convenience or a
 * launch flag — Ollama's top-level `think`, per-request `thinking_budget` and
 * `reasoning_budget` (both silently ignored by this server), and
 * `--reasoning-budget`, which needs a server restart and has not been measured.
 */

const THINKING_KEY = "crescent-chat.thinking.v1";

/** What a model's chat template can read. */
export interface ThinkingSupport {
  /** The template reads `enable_thinking`: thinking can be turned off. */
  enableThinking: boolean;
  /** The template reads `reasoning_effort`; the levels are not knowable here. */
  reasoningEffort: boolean;
}

export function thinkingSupport(chatTemplate: string): ThinkingSupport {
  return {
    enableThinking: chatTemplate.includes("enable_thinking"),
    reasoningEffort: chatTemplate.includes("reasoning_effort"),
  };
}

function stored(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(THINKING_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    const clean: Record<string, boolean> = {};
    for (const [model, enabled] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof enabled === "boolean") clean[model] = enabled;
    }
    return clean;
  } catch {
    return {};
  }
}

/** Whether this model thinks. On unless the reader turned it off. */
export function loadThinking(model: string): boolean {
  return stored()[model] !== false;
}

/** Remember it for this model. False when storage refused. */
export function saveThinking(model: string, enabled: boolean): boolean {
  try {
    localStorage.setItem(THINKING_KEY, JSON.stringify({ ...stored(), [model]: enabled }));
    return true;
  } catch {
    return false;
  }
}
