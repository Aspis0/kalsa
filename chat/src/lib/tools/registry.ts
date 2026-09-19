import type { ToolOutcome } from "../chat";
import { available, invoke } from "../tauri";
import { TOOL_DEFINITIONS } from "./definitions";
import type { ToolDefinition } from "./definitions";

/**
 * The tools this build may offer on a request. Outside the desktop app there
 * is no command behind them — the browser harnesses and a plain `vite dev`
 * page get an empty list, so no request ever offers a tool that cannot run.
 * The owner's switch is the other half: off means no tools array is sent at
 * all, so the model is never told a tool exists.
 */
export function offeredTools(enabled: boolean): ToolDefinition[] {
  return enabled && available() ? TOOL_DEFINITIONS : [];
}

/**
 * Names for the web calls, so Stop can say which one it is stopping. The Rust
 * side keys its running calls by this number, and a counter starting at one
 * would collide across a reload and between two windows — one window's Stop
 * could then name the other window's call. A page prefix from the operating
 * system's random source, under 2^53 so it survives being a JSON number.
 */
let nextCallId = (crypto.getRandomValues(new Uint32Array(1))[0] % 0x100000) * 2 ** 32 + 1;

/**
 * Run one call the model asked for and answer with the text it will read next
 * round: the tool's own words, or the reason it did not run. A tool that fails
 * is a tool result, never a thrown error — the turn has to be able to go on and
 * say what happened.
 */
export async function executeToolCall(
  name: string,
  args: unknown,
  signal?: AbortSignal,
): Promise<ToolOutcome> {
  // The turn can be stopped while the arguments are being read; starting a
  // request nobody is waiting for would be work and traffic for nothing.
  if (signal?.aborted) return stopped();
  const record = args && typeof args === "object" ? (args as Record<string, unknown>) : {};
  try {
    if (name === "web_search") {
      const query = typeof record.query === "string" ? record.query.trim() : "";
      if (!query) return { text: "No search was made: the query was empty.", ok: false };
      return { text: await through("brain_web_search", { query }, signal), ok: true };
    }
    if (name === "web_fetch") {
      const url = typeof record.url === "string" ? record.url.trim() : "";
      if (!url) return { text: "No page was opened: the address was empty.", ok: false };
      return { text: await through("brain_web_fetch", { url }, signal), ok: true };
    }
    return { text: `There is no tool called “${name}”.`, ok: false };
  } catch (error) {
    // The Rust side answers a failure with a sentence; anything else is a
    // surprise and is passed on as it reads.
    const detail = error instanceof Error ? error.message : String(error);
    return { text: `${name} could not run: ${detail}`, ok: false };
  }
}

function stopped(): ToolOutcome {
  return { text: "Stopped before this finished.", ok: false };
}

/**
 * One call through the door, named so the page can stop it. The door is
 * untyped: a command answering with nothing would otherwise put a `null` into
 * the transcript, where it reaches the token count and takes the whole page
 * down, so whatever comes back leaves here as text.
 */
async function through(
  command: string,
  args: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<string> {
  const id = nextCallId++;
  const stop = () => {
    void invoke("brain_web_stop", { id }).catch(() => {});
  };
  signal?.addEventListener("abort", stop, { once: true });
  try {
    const answer: unknown = await invoke(command, { id, ...args });
    return typeof answer === "string" ? answer : String(answer ?? "");
  } finally {
    signal?.removeEventListener("abort", stop);
  }
}
