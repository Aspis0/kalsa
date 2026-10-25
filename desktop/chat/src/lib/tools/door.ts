import { invoke } from "../tauri";

/**
 * The door to Rust, named so the page can stop what it starts. Every web call
 * gets its own number here, and `brain_web_stop` is what a Stop — this app's or
 * a budget's — sends for it.
 */

/**
 * Names for the web calls, so Stop can say which one it is stopping. The Rust
 * side keys its running calls by this number, and a counter starting at one
 * would collide across a reload and between two windows — one window's Stop
 * could then name the other window's call. A page prefix from the operating
 * system's random source, under 2^53 so it survives being a JSON number.
 */
let nextCallId = (crypto.getRandomValues(new Uint32Array(1))[0] % 0x100000) * 2 ** 32 + 1;

/** What a call nobody has put a bound on races against, so it never ends. */
const UNBOUNDED = new Promise<never>(() => {});

/**
 * One call through the door, named so the page can stop it. The door is
 * untyped: a command answering with nothing would otherwise put a `null` into
 * the transcript, where it reaches the token count and takes the whole page
 * down, so whatever comes back leaves here as text.
 *
 * `budgetMs` is for a call the page is not waiting on the model for: past it
 * the call is stopped by the very id Stop would use, and what comes back is
 * empty. Rust would hold the request for its own thirty seconds otherwise, for
 * a result this page has already given up on.
 */
export async function through(
  command: string,
  args: Record<string, unknown>,
  signal?: AbortSignal,
  budgetMs?: number,
): Promise<string> {
  const id = nextCallId++;
  const stop = () => {
    void invoke("brain_web_stop", { id }).catch(() => {});
  };
  // A signal that is already aborted never fires its listeners again, so a
  // call started under one would run on with nobody able to name it.
  if (signal?.aborted) return "";
  let budget: Promise<null> | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  if (budgetMs !== undefined) {
    budget = new Promise<null>((resolve) => {
      timer = setTimeout(() => {
        stop();
        resolve(null);
      }, budgetMs);
    });
  }
  signal?.addEventListener("abort", stop, { once: true });
  try {
    const answer: unknown = await Promise.race([invoke(command, { id, ...args }), budget ?? UNBOUNDED]);
    return typeof answer === "string" ? answer : String(answer ?? "");
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    signal?.removeEventListener("abort", stop);
  }
}