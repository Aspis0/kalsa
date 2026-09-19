import { readArguments } from "../lib/toolCalls";
import { publicHttpUrl } from "../lib/publicUrl";
import { available, invoke } from "../lib/tauri";
import type { ToolRun } from "../lib/types";

/**
 * What the assistant did before it answered: one quiet, collapsed line per
 * call. The page never loads anything from the network for this — no favicon,
 * no preview image — because that would be a request out of the webview, which
 * is exactly what the content security policy forbids and this design avoids.
 */
export function ToolActivity({ runs }: { runs: ToolRun[] }) {
  if (runs.length === 0) return null;
  return (
    <div className="tool-activity">
      {runs.map((run) => (
        <ToolRow key={run.id} run={run} />
      ))}
    </div>
  );
}

function ToolRow({ run }: { run: ToolRun }) {
  const args = readArguments(run.name, run.arguments).args;
  const query = typeof args.query === "string" ? args.query : "";
  const asked = typeof args.url === "string" ? args.url.trim() : "";
  // Only a public web address becomes a link. The model writes the address it
  // asked for and a page writes the addresses in its own text, so neither is
  // trusted: `javascript:`, `data:`, `file:` and this machine's own server all
  // stay text.
  const url = publicHttpUrl(asked);
  const sources = run.name === "web_fetch" ? (url ? [url] : []) : linksIn(run.result);
  const failed = run.state === "failed" || run.state === "refused";

  return (
    <details className={`tool-run${failed ? " tool-run-failed" : ""}`}>
      <summary>
        {run.state === "running" ? (
          <span className="tool-working">
            <span />
            {running(run.name)}
          </span>
        ) : (
          <span>{summaryOf(run.name, failed, query, url ?? asked)}</span>
        )}
      </summary>
      <div className="tool-detail">
        {query ? <p className="tool-query">Searched for: {query}</p> : null}
        {asked ? (
          <p className="tool-query">
            Asked for: {url ? <Openable url={url}>{hostOf(url)}</Openable> : asked}
          </p>
        ) : null}
        {failed ? <p className="tool-failure">{run.result}</p> : null}
        {!failed && sources.length > 0 ? (
          <ul className="tool-sources">
            {sources.map((source) => (
              <li key={source}>
                <Openable url={source}>{hostOf(source)}</Openable>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </details>
  );
}

/**
 * Something the reader can open in this computer's browser.
 *
 * A button, not an `href`: a Tauri webview does not reach the system browser on
 * its own, so the anchor this used to be was underlined, changed the cursor,
 * and did nothing at all when clicked. The page does not open anything itself —
 * it asks a command, which checks the address again in Rust and only then hands
 * it to the operating system. Outside the app (a plain browser) there is no
 * command, and the browser can open it itself.
 */
function Openable({ url, children }: { url: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      className="tool-link"
      onClick={() => {
        if (available()) {
          // The refusal is the command's sentence; the same gate has already
          // refused such an address before this was offered, so there is
          // nothing to show the reader here.
          void invoke("brain_open_url", { url }).catch(() => {});
          return;
        }
        window.open(url, "_blank", "noreferrer");
      }}
    >
      {children}
    </button>
  );
}

function running(name: string): string {
  if (name === "web_fetch") return "Opening the page…";
  if (name === "web_search") return "Searching the web…";
  if (!name) return "A tool call arrived unnamed…";
  return `Running ${name}…`;
}

function summaryOf(name: string, failed: boolean, query: string, url: string): string {
  if (!name) return failed ? "A tool call arrived unnamed" : "Ran an unnamed tool";
  if (name === "web_fetch") {
    return failed ? "That page could not be opened" : `Read ${url ? hostOf(url) : "a page"}`;
  }

  if (name === "web_search") {
    if (failed) return "That search did not run";
    return query ? `Searched for “${query}”` : "Searched the web";
  }
  return failed ? `${name} did not run` : `Ran ${name}`;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}

/**
 * The addresses in a search result, which the reader can open. Only public web
 * addresses, deduplicated and capped: this is a list of sources, not a second
 * search.
 */
function linksIn(text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(/https?:\/\/[^\s<>"')]+/g)) {
    const url = publicHttpUrl(match[0].replace(/[.,;:]+$/, ""));
    if (url && !found.includes(url)) found.push(url);
  }
  return found.slice(0, 5);
}
