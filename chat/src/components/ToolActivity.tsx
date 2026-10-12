import { useLanguage } from "../i18n/useLanguage";
import type { English } from "../i18n/en/all";
import { readArguments } from "../lib/toolCalls";
import { publicHttpUrl } from "../lib/publicUrl";
import { Openable } from "./Openable";
import { Icon } from "./Icon";
import { MiniappView } from "./miniapp/MiniappView";
import "./ToolActivity.css";
import { TOOL_STOPPED } from "../lib/types";
import type { ToolRun } from "../lib/types";

/** The web refusals' sentences, by the code Rust put on them — plus the two
    the page's own provenance rule puts on a web_fetch (fetchProvenance.ts). */
function webWords(t: English["tools"], code: string): string {
  const table: Record<string, string> = {
    "web.search_failed": t.webSearchFailed,
    "web.page_too_long": t.webPageTooLong,
    "web.page_failed": t.pageNotOpened,
    "web.open_failed": t.pageNotOpened,
    "web.link_unseen": t.linkNotInChat,
    "web.link_credential": t.linkHasCredential,
  };
  return table[code] ?? code;
}

const MINIAPP = "create_miniapp";

/**
 * What Kalsa did on the web before it answered: one quiet line per check inside
 * the answer, opening to what was asked and the sources. The page never loads
 * anything from the network for this — no favicon, no preview image — because
 * that would be a request out of the webview, which the content security
 * policy forbids.
 */
export function ToolActivity({ runs, awaitingOk }: { runs: ToolRun[]; awaitingOk: boolean }) {
  const web = runs.filter((run) => run.name !== MINIAPP);
  if (web.length === 0) return null;
  return (
    <div className="tool-activity">
      {web.map((run) => (
        <ToolRow key={run.id} run={run} awaitingOk={awaitingOk} />
      ))}
    </div>
  );
}

/** The mini apps a turn built: the build's own line, then the view it drew. */
export function MiniappRows({
  runs,
  onState,
}: {
  runs: ToolRun[];
  onState: (runId: string, state: Record<string, unknown>) => void;
}) {
  return (
    <>
      {runs
        .filter((run) => run.name === MINIAPP)
        .map((run) => (
          <div key={run.id} className="miniapp-turn">
            <MiniappRow run={run} />
            {run.miniapp ? <MiniappView miniapp={run.miniapp} onState={(state) => onState(run.id, state)} /> : null}
          </div>
        ))}
    </>
  );
}

function ToolRow({ run, awaitingOk }: { run: ToolRun; awaitingOk: boolean }) {
  const { table } = useLanguage();
  const t = table.tools;
  const args = readArguments(run.name, run.arguments).args;
  const query = typeof args.query === "string" ? args.query : "";
  // The fragment is dropped at the door and never offered back on the card:
  // the model may have coined it after an address the conversation had seen.
  const asked = typeof args.url === "string" ? args.url.trim().split("#")[0] : "";
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
  const running =
    awaitingOk ? t.waitingForOk : run.name === "web_search" ? t.searching : run.name === "web_fetch" ? t.openingPage : t.checking;
  const summary =
    run.state === "running"
      ? running
      : failed
        ? run.name === "web_fetch"
          ? t.pageNotOpened
          : run.name === "web_search"
            ? t.searchDidNotRun
            : t.couldNotFinish
        : run.name === "web_fetch"
          ? t.read(url ? hostOf(url) : t.aPage)
          : run.name === "web_search"
            ? t.searchedWeb
            : null;
  if (summary === null) return null;

  return (
    <details className={`tool-run${failed ? " tool-run-failed" : ""}`}>
      <summary>
        {run.state === "running" ? (
          <span className="tool-spin" aria-hidden="true" />
        ) : (
          <Icon name={failed ? "alert" : "globe"} size={16} />
        )}
        <span>{summary}</span>
        <span className="tool-chevron" aria-hidden="true">
          <Icon name="right" size={15} />
        </span>
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
                <Openable url={source}>
                  <Icon name="link" size={14} />
                  {hostOf(source)}
                </Openable>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </details>
  );
}

/**
 * The row for a local miniapp build. The words are the interface's; the view
 * it built is rendered right below. A failure keeps its precise text for the
 * MODEL (the stored result is what the wire replays); the person reads one
 * localized line, never template ids.
 */
function MiniappRow({ run }: { run: ToolRun }) {
  const { table } = useLanguage();
  const failed = run.state === "failed" || run.state === "refused";
  const failure = run.result === TOOL_STOPPED ? table.tools.stopped : table.miniapp.buildFailed;
  const summary =
    run.state === "running" ? table.miniapp.building : failed ? failure : table.miniapp.built;

  return (
    <details className={`tool-run miniapp-run${failed ? " tool-run-failed" : ""}`}>
      <summary>
        {run.state === "running" ? (
          <span className="tool-spin" aria-hidden="true" />
        ) : (
          <Icon name={failed ? "alert" : "layoutGrid"} size={18} />
        )}
        <span>{summary}</span>
        <span className="tool-chevron" aria-hidden="true">
          <Icon name="right" size={15} />
        </span>
      </summary>
      {failed ? (
        <div className="tool-detail">
          <p className="tool-failure">{failure}</p>
        </div>
      ) : null}
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
