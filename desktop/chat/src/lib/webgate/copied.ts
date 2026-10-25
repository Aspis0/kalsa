import type { GateFinding } from "./finding";

/**
 * Half two of the detector: a run of six words in a row copied out of an
 * attached document. Six, because the owner's rule is "at least 6/7 words" —
 * anything longer contains a six-word run, so matching six subsumes seven and
 * up. Exact words only; a paraphrase gets through, which was accepted.
 */

/** The slice of an attachment the gate needs. `Attachment` already has these. */
export interface PinnedDoc {
  id: string;
  name: string;
  text: string;
}

const RUN = 6;

/**
 * Normalisation, and why: both sides are reduced to a word sequence — lower-
 * cased, every character that is not a letter or a digit becomes one space,
 * runs of space collapse. Case is folded because sentence position changes it
 * and nothing else; punctuation and line breaks are dropped because copying
 * out of a document rarely keeps them and the owner's rule counts WORDS, not
 * characters. The same reduction runs on both sides, so what matches is a
 * word-for-word match, never a paraphrase.
 *
 * Accents are folded, not composed. An accented letter has three spellings —
 * `è` as one code point, `e` with a combining grave after it, and the plain
 * `e` a keyboard without accents types — and all three must reduce to the
 * same word, so the text is decomposed (NFD) and the combining marks are
 * dropped: `perché`, its decomposed spelling, and `perche` are one word.
 * That is a deliberate over-match, and the direction is right for this
 * detector: an extra match makes the ask the owner already has to answer say
 * one more thing, while a miss lets a copied sentence leave unflagged — and
 * the miss is the failure that matters.
 */
const NON_WORD = /[^\p{L}\p{N}]+/gu;
/** The combining marks NFD leaves behind a letter, dropped after folding. */
const COMBINING_MARK = /[\u0300-\u036f]/g;

function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(COMBINING_MARK, "")
    .toLowerCase()
    .replace(NON_WORD, " ")
    .trim();
}

export function findCopied(text: string, docs: PinnedDoc[]): GateFinding[] {
  const words = normalize(text).split(" ");
  const out: GateFinding[] = [];
  const said = new Set<string>();
  for (let at = 0; at + RUN <= words.length; at += 1) {
    const run = words.slice(at, at + RUN).join(" ");
    if (said.has(run)) continue;
    for (const doc of docs) {
      if (containsWord(normalizedOf(doc), run)) {
        said.add(run);
        out.push({ kind: "copied text", matched: run, source: doc.name });
        break;
      }
    }
  }
  return out;
}

/** Word-boundary check around the substring hit: a run must land on the
    document's own word edges, not straddle two of them mid-word. */
function containsWord(normalized: string | null, run: string): boolean {
  if (normalized === null) return false;
  let at = normalized.indexOf(run);
  while (at !== -1) {
    const open = at === 0 || normalized[at - 1] === " ";
    const end = at + run.length;
    const close = end === normalized.length || normalized[end] === " ";
    if (open && close) return true;
    at = normalized.indexOf(run, at + 1);
  }
  return false;
}

/**
 * The cost, measured rather than adjectival. With a 32 MB document this scan
 * took 17 ms for a 20-word query and 468 ms for a 600-word one; at 8 MB, 4 ms
 * and 118 ms (this machine, 2026-09). The outgoing string is capped at 4,096
 * characters by `MAX_ARGUMENTS` in `lib/toolCalls.ts`, which bounds a query
 * to ~600 six-word runs — so that 468 ms is the worst case the shape allows,
 * not a sample, and it is the number that says when this stops being free.
 * A web call with a huge outgoing string on a huge attachment costs half a
 * second of main-thread time; the common call costs single-digit milliseconds.
 *
 * The obvious build — a set of the document's six-word shingles — would hold
 * ~5 million strings for the largest allowed attachment, several hundred MB,
 * so the check runs the other way instead: the document is kept as ONE
 * normalised string (one extra copy of roughly its own size, and no more)
 * and each six-word run of the outgoing text is a native substring search
 * away. The cache keeps the eight most recent documents, so a session that
 * attaches and removes many large files does not pile up copies of all of
 * them.
 */
const CACHE_LIMIT = 8;
const cache = new Map<string, { chars: number; text: string }>();

function normalizedOf(doc: PinnedDoc): string | null {
  // `chars` is a tripwire, not what the cache depends on: ids come fresh from
  // crypto.randomUUID for every attachment, so a replaced document is a new
  // id and a new entry — the length check just makes an entry whose document
  // somehow changed under the same id rebuild rather than serve stale text,
  // a case the app itself cannot produce.
  const hit = cache.get(doc.id);
  if (hit !== undefined && hit.chars === doc.text.length) {
    cache.delete(doc.id);
    cache.set(doc.id, hit);
    return hit.text;
  }
  if (doc.text.length === 0) return null;
  const text = normalize(doc.text);
  cache.set(doc.id, { chars: doc.text.length, text });
  if (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined && oldest !== doc.id) cache.delete(oldest);
  }
  return text;
}
