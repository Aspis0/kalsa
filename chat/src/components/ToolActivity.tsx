import type { English } from "../i18n/en/all";
import { useLanguage } from "../i18n/useLanguage";
import { readArguments } from "../lib/toolCalls";
import { publicHttpUrl } from "../lib/publicUrl";
import { Openable } from "./Openable";
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

  return (
    <details className={`tool-run${failed ? " tool-run-failed" : ""}`}>
      <summary>
        {run.state === "running" ? (
          <span className="tool-working">
            <span />
            {running(t, run.name)}
          </span>
        ) : (
          <span>{summaryOf(t, run.name, failed, query, url ?? asked)}</span>
        )}
      </summary>
      <div className="tool-detail">
        {query ? <p className="tool-query">{t.searchedForLabel} {query}</p> : null}
        {asked ? (
          <p className="tool-query">
            {t.askedForLabel} {url ? <Openable url={url}>{hostOf(url)}</Openable> : asked}
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

function running(t: English["tools"], name: string): string {
  if (name === "web_fetch") return t.openingPage;
  if (name === "web_search") return t.searchingWeb;
  if (!name) return t.unnamedRunning;
  return t.running(name);
}

function summaryOf(t: English["tools"], name: string, failed: boolean, query: string, url: string): string {
  if (!name) return failed ? t.unnamedFailed : t.ranUnnamed;
  if (name === "web_fetch") {
    return failed ? t.pageNotOpened : t.read(url ? hostOf(url) : t.aPage);
  }

  if (name === "web_search") {
    if (failed) return t.searchDidNotRun;
    return query ? t.searchedFor(query) : t.searchedWeb;
  }
  return failed ? t.didNotRun(name) : t.ran(name);
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
