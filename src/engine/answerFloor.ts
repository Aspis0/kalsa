/**
 * The never-empty floor: the answer a turn shows when the model would not say
 * anything in words.
 *
 * A web turn can gather everything it needs and still end silent — S23, LFM2.5
 * 2.6B: two tool rounds produced good sources, the final round and both rescue
 * attempts answered with tool-call markup, and the bubble closed on
 * "Generazione interrotta", which is a lie (nothing was interrupted) and
 * throws away the sources the turn already paid for.
 *
 * So when no attempt produced words, the turn closes on what it DID gather: a
 * short localized lead line plus the sources (title + URL). The user gets
 * something true and actionable, and the tool cards are already on screen next
 * to it. No sources means nothing was gathered, and the caller keeps the honest
 * canned message instead.
 *
 * Pure, like the modules beside it: no engine, no React Native.
 */

import { normalizeFetchUrl } from "../util/url";

/** Sources listed before the rest are dropped. A floor, not a reading list. */
const MAX_FLOOR_SOURCES = 5;
/** A title is a label here, not a document. */
const MAX_TITLE_CHARS = 100;

/**
 * Title as one line. Search titles carry newlines, tabs and doubled spaces
 * (they come out of page metadata), and a raw one would break the bubble's
 * layout — a floor must not be the thing that breaks the render.
 */
function titleOf(source: unknown): string {
  if (!source || typeof source !== "object") return "";
  const title = (source as { title?: unknown }).title;
  if (typeof title !== "string") return "";
  const oneLine = title.replace(/\s+/g, " ").trim();
  return oneLine.length > MAX_TITLE_CHARS
    ? `${oneLine.slice(0, MAX_TITLE_CHARS - 1).trimEnd()}…`
    : oneLine;
}

function urlOf(source: unknown): string {
  if (!source || typeof source !== "object") return "";
  const url = (source as { url?: unknown }).url;
  if (typeof url !== "string") return "";
  const trimmed = url.trim();
  return normalizeFetchUrl(trimmed) ?? trimmed;
}

/**
 * Identity for the floor's own de-duplication: the normalized URL when there
 * is one (the same page fetched twice, or a card and a passage of it), else
 * the title. Case-folded, because the same title in two cases is one source to
 * a reader.
 */
function sourceKeyOf(source: unknown): string {
  const url = urlOf(source);
  if (url) return `u:${url.toLowerCase()}`;
  const title = titleOf(source);
  return title ? `t:${title.toLowerCase()}` : "";
}

/**
 * One line per source: "Title — url", or whichever of the two exists. A source
 * with neither renders as nothing, so the caller does not spend a bullet on an
 * empty entry.
 */
function floorLine(source: unknown): string {
  const title = titleOf(source);
  const url = urlOf(source);
  if (title && url) return `${title} — ${url}`;
  return title || url;
}

/**
 * The lead line plus the sources, or "" when there is nothing renderable — the
 * caller then closes with its canned message, which is the honest answer for a
 * turn that gathered nothing.
 *
 * De-duplicates HERE as well as upstream: the ledger's job is citation
 * indices, and it keys on the URL alone, so it cannot collapse a repeated
 * URL-less card (two tool results carrying the same title, or the same URL in
 * two spellings that normalize apart). This is the last thing the user reads on
 * a silent turn, so it owes them a list with no repeats in it.
 */
export function buildSourcesAnswer(
  sources: readonly unknown[] | undefined,
  lead: string,
): string {
  if (!sources?.length) return "";
  const lines: string[] = [];
  const seen = new Set<string>();
  for (const source of sources) {
    if (lines.length >= MAX_FLOOR_SOURCES) break;
    const line = floorLine(source);
    if (!line) continue;
    const key = sourceKeyOf(source);
    if (key) {
      if (seen.has(key)) continue;
      seen.add(key);
    }
    lines.push(line);
  }
  if (!lines.length) return "";
  return [lead, ...lines].filter((part) => part.trim().length > 0).join("\n").trim();
}