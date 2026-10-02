/**
 * The js_error record for an unhandled JS exception: the error's `name` when
 * it is a plain word, and the FIRST stack frame reduced to
 * `basename:line:column`. NEVER reads or serializes `error.message` — the
 * message is where user text, URLs and paths live.
 */

const SAFE_NAME = /^[A-Za-z]{1,40}$/;

function errorName(error: unknown): string {
  try {
    const name = (error as { name?: unknown } | null)?.name;
    if (typeof name === "string" && SAFE_NAME.test(name)) return name;
  } catch {
    // a throwing name getter is still just "Error"
  }
  return "Error";
}

/** First `at ...` frame of the stack, reduced to basename:line:col. */
function firstFrame(error: unknown): string {
  let stack: unknown;
  try {
    stack = (error as { stack?: unknown } | null)?.stack;
  } catch {
    stack = undefined;
  }
  if (typeof stack !== "string") return "unknown";
  for (const line of stack.split("\n")) {
    const match = line.match(/\bat\s+(?:.*?\s\()?([^()\s]+?):(\d+):(\d+)\)?\s*$/);
    if (!match) continue;
    const base = match[1]
      .replace(/^file:\/\//, "")
      .split(/[?#]/)[0]
      .split("/")
      .pop();
    if (base) return `${base}:${match[2]}:${match[3]}`;
  }
  return "unknown";
}

/** `js_error name=<name> frame=<basename:line:col>` — nothing else. */
export function formatJsErrorLine(error: unknown): string {
  return `js_error name=${errorName(error)} frame=${firstFrame(error)}`;
}
