import { useLanguage } from "../i18n/useLanguage";
import type { English } from "../i18n/en/all";
import { readArguments } from "../lib/toolCalls";
import { publicHttpUrl } from "../lib/publicUrl";
import { URL_LINE, providerText } from "../lib/tools/resultFormat";
import { Openable } from "./Openable";
import { Icon } from "./Icon";
import { MiniappView } from "./miniapp/MiniappView";
import { isMailRun } from "../lib/mail/runs";
import { isBrowserRun } from "../lib/browser/runs";
import { recapLine } from "../lib/browser/recap";
import type { Recap } from "../lib/browser/recap";
import { rustSentence } from "../lib/rustText";
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
    "web.query_link_unseen": t.searchLinkNotInChat,
  };
  return table[code] ?? code;
}

const MINIAPP = "create_miniapp";

/** What a running mail call says it is doing. A real IMAP read is silent for
    seconds, and a row is the only sign the turn is still working. `mail_show`
    picks no cards — the cards are already drawn — it writes the model's one line
    under each of them, so that is what its row says. */
function mailLine(t: English["tools"], name: string): string {
  if (name === "mail_draft") return t.writingDraft;
  if (name === "mail_show") return t.writingCardLines;
  return t.readingMail;
}

/**
 * What Kalsa did on the web before it answered: one quiet line per check inside
 * the answer, opening to what was asked and the sources. The page never loads
 * anything from the network for this — no favicon, no preview image — because
 * that would be a request out of the webview, which the content security
 * policy forbids.
 */
export function ToolActivity({ runs, awaitingOk, mailPending = false }: { runs: ToolRun[]; awaitingOk: boolean; mailPending?: boolean }) {
  // A mail card is the tool's whole visible output, so the quiet web row would
  // say twice what the card already says. While it runs there is no card yet,
  // and the cards wait for the answer's first word — so a mail run keeps a row
  // of its own across both, and the same spinner with no chevron: nothing
  // opens, the cards take this row's place.
  const rows = runs.filter((run) =>
    run.name === MINIAPP ? false : isMailRun(run.name) ? run.state === "running" || (mailPending && run.state === "ok") : true,
  );
  // **The turn's own line, after its work.** It is what Kalsa did rather than
  // what each call was, so it goes last and outside the rows: a browser turn
  // that filled three fields and never clicked says so here, which is the fact
  // no row on its own can tell. The record is counts, and the words are built
  // here — in the language being read now, not the one it was written in.
  const said = [...rows].reverse().find((run) => run.recap !== undefined)?.recap;
  if (rows.length === 0) return said === undefined ? null : <RecapLine recap={said} />;
  return (
    <>
      <div className="tool-activity">
        {rows.map((run) => (
          <ToolRow key={run.id} run={run} awaitingOk={awaitingOk} />
        ))}
      </div>
      {said === undefined ? null : <RecapLine recap={said} />}
    </>
  );
}

/** What Kalsa did in the turn, said in the language of the window it is drawn
    in. Fixed copy, so it is drawn as text and nothing else: no address, no
    label, nothing a page or a model chose — except the host an open asked for,
    which is this app's own parse of its own argument. */
function RecapLine({ recap }: { recap: Recap }) {
  const { table } = useLanguage();
  return <p className="tool-recap">{recapLine(recap, table.tools.recap)}</p>;
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
  const { table, tag } = useLanguage();
  const t = table.tools;
  // A mail run has one row while the turn is still working on its answer: the
  // answer's first word, or the end of the turn, is what puts the cards there
  // and takes the row away. A refused call says itself on its own notice.
  if (isMailRun(run.name)) {
    return (
      <p className="tool-run mail-run">
        <span className="tool-spin" aria-hidden="true" />
        <span>{run.state === "running" ? mailLine(t, run.name) : t.mailReady}</span>
      </p>
    );
  }
  const args = readArguments(run.name, run.arguments).args;
  const query = typeof args.query === "string" ? args.query : "";
  // A browser run says what it did in the browser, in the app's own words, and
  // never shows an address: the model wrote it and a page wrote the addresses
  // on it, so neither is text a row can put on the screen.
  if (isBrowserRun(run.name)) {
    const browserFailed = run.state === "failed" || run.state === "refused";
    return (
      <p className={`tool-run${browserFailed ? " tool-run-failed" : ""}`}>
        {run.state === "running" ? <span className="tool-spin" aria-hidden="true" /> : null}
        <span>
          {browserFailed
            ? // A code carries the reason — "Kalsa is already using the
              // browser" is a different thing to read from "the driver is
              // damaged" — so it is asked for by code and falls back to the
              // app's own one-line failure, never to the model's words.
              run.resultCode === undefined
              ? t.browserDidNotRun
              : rustSentence(table.rust, { code: run.resultCode }, tag)
            : run.name === "browser_open"
              ? t.browserOpened
              : run.name === "browser_find"
                ? t.browserFound
                // What Kalsa did, in the past tense, and never what it was for:
                // a click that sent something is drawn here while a person is
                // being asked about it on the card above, and the two together
                // must not read as if the request had already gone.
                : run.name === "browser_click"
                  ? t.browserClicking
                  : run.name === "browser_type"
                    ? t.browserTyped
                    : run.name === "browser_screenshot"
                      // **A picture is a line and nothing more.** The bytes are
                      // the model's and the record's placeholder is a sentence;
                      // no row on this screen ever shows an image.
                      ? t.browserShot
                      : t.browserRead}
        </span>
      </p>
    );
  }
  // The fragment is dropped at the door and never offered back on the card:
  // the model may have coined it after an address the conversation had seen.
  const asked = typeof args.url === "string" ? args.url.trim().split("#")[0] : "";
  // Only a public web address becomes a link. The model writes the address it
  // asked for and a page writes the addresses in its own text, so neither is
  // trusted: `javascript:`, `data:`, `file:` and this machine's own server all
  // stay text.
  const url = publicHttpUrl(asked);
  const sources = run.name === "web_fetch" ? (url ? [url] : []) : sourcesIn(run.result);
  const failed = run.state === "failed" || run.state === "refused";
  // A search that ran and was stopped while its pages were being read is a
  // stopped turn, not a search that did not run: the results it found are on
  // the card, and the reader is the one who stopped it. The code is the fact;
  // the sentence is the fallback for a run stored before it was one, which is
  // the only way to recognise it now.
  const stopped = failed && (run.result === TOOL_STOPPED || run.result === t.stopped);
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
            ? stopped
              ? t.stopped
              : t.searchDidNotRun
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
        {run.pagesRead ? <p className="tool-query">{t.pagesReadLabel} {run.pagesRead}</p> : null}
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
 * The addresses the provider itself listed under a search, which the reader
 * can open: its own `URL:` lines only, deduplicated and capped. The pages the
 * app read underneath the search are in the same text, and their links are a
 * stranger's own — a source list is what the engine returned, not what a page
 * the engine returned happened to mention.
 */
function sourcesIn(result: string): string[] {
  const found: string[] = [];
  for (const line of providerText(result).split("\n")) {
    if (!line.startsWith(URL_LINE)) continue;
    const url = publicHttpUrl(line.slice(URL_LINE.length).split("#")[0]);
    if (url && !found.includes(url)) found.push(url);
  }
  return found.slice(0, 5);
}
