import { useLanguage } from "../i18n/useLanguage";
import type { English } from "../i18n/en/all";
import { readArguments } from "../lib/toolCalls";
import { publicHttpUrl } from "../lib/publicUrl";
import { Openable } from "./Openable";
import { TOOL_STOPPED } from "../lib/types";
import type { ToolRun } from "../lib/types";

/** The web refusals' sentences, by the code Rust put on them. */
function webWords(t: English["tools"], code: string): string {
  const table: Record<string, string> = {
    "web.search_failed": t.webSearchFailed,
    "web.page_too_long": t.webPageTooLong,
    "web.page_failed": t.pageNotOpened,
    "web.open_failed": t.pageNotOpened,
  };
  return table[code] ?? code;
}

/**
 * What Kalsa did before she answered: one quiet, collapsed line per check. The page never loads anything from the network for this — no favicon,
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
  const { table } = useLanguage();
  const t = table.tools;
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
  // The one line the row says: the two plain web outcomes, the failure
  // sentences, and nothing for a finished check that needs no words — an
  // internal name is never shown.
  const summary =
    run.state === "running"
      ? t.checking
      : failed
        ? run.name === "web_fetch"
          ? t.pageNotOpened
          : run.name === "web_search"
            ? t.searchDidNotRun
            : t.couldNotFinish
        : run.name === "web_fetch"
          ? t.read(url ? hostOf(url) : t.aPage)
          : run.name === "web_search"
            ? query
              ? t.searchedFor(query)
              : t.searchedWeb
            : null;
  if (summary === null) return null;

  return (
    <details className={`tool-run${failed ? " tool-run-failed" : ""}`}>
      <summary>
        {run.state === "running" ? (
          <span className="tool-working">
            <span />
            {t.checking}
          </span>
        ) : (
          <span>{summary}</span>
        )}
      </summary>
      <div className="tool-detail">
        {query ? <p className="tool-query">{t.searchedForLabel} {query}</p> : null}
        {asked ? (
          <p className="tool-query">
            {t.askedForLabel} {url ? <Openable url={url}>{hostOf(url)}</Openable> : asked}
          </p>
        ) : null}
        {failed ? (
          <p className="tool-failure">
            {run.result === TOOL_STOPPED
              ? t.stopped
              : run.resultCode?.startsWith("web.")
                ? webWords(t, run.resultCode)
                : run.result}
          </p>
        ) : null}
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
