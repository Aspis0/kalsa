import { scoreUnits } from "./bm25";
import { foldWords, grams } from "./grams";
import { sentencesOf } from "./sentences";

/** Where a piece of text came from: the turn it belonged to and what kind of
    text it was. A document is named as one, not as the person's words. */
export type Role = "user" | "assistant" | "tool" | "document";

/** One message's text, as the turn it belonged to said it. */
export interface Source {
  turn: number;
  role: Role;
  text: string;
}

/** A sentence the digest carries, verbatim, with its turn and role. */
export type Fragment = Source;

/** A sentence and the sentences either side of it in the same source. The
    neighbours are searched with it, so a short follow-up («e il secondo?»)
    finds the sentence it refers to; only the sentence itself is ever carried. */
interface Unit extends Fragment {
  order: number;
  around: string;
}

/** The shortest word that can make a sentence a match: shorter ones («ci», «il»)
    are in every sentence of an Italian conversation. */
const WORD_MIN = 3;

/** How alike two words must be to count as the same word, as the share of
    their character grams. Half catches a typo; a different word falls well under. */
const WORD_SIMILAR = 0.5;

/** A match scores at least this share of the best match in what was left
    behind. The tail of weak matches is not carried. */
const RELATIVE = 0.3;

/** Two sentences this alike say the same thing: the second is not carried. */
const SIMILAR = 0.6;

/** Words that every conversation carries, and the filler of a thank-you or a
    greeting. A query made of them alone matches nothing, and a sentence is not
    a match for them: «così» in one question is not a fact about the price. */
const STOP = new Set([
  "che", "per", "con", "non", "una", "uno", "del", "della", "dei", "delle", "dello",
  "sono", "anche", "come", "cosa", "questo", "questa", "quello", "quella", "sul",
  "sulla", "nel", "nella", "dal", "dalla", "alla", "allo", "gli", "mio", "mia",
  "tuo", "tua", "suo", "sua", "the", "and", "for", "you", "your", "what", "how",
  "that", "this", "with", "are", "was", "can",
  "ciao", "salve", "buongiorno", "buonasera", "grazie", "prego", "bene", "cosi",
  "allora", "dai", "certo", "perfetto", "vai", "tutto", "tutti", "ancora",
  "adesso", "sempre", "molto", "poco", "bello", "bella", "scusa", "scusi",
  "magari", "davvero", "proprio", "ecco",
]);

/** The line one fragment takes in the block. */
export function fragmentLine(fragment: Fragment): string {
  return `[turn ${fragment.turn}, ${fragment.role}] ${fragment.text}`;
}

/**
 * The sentences that best match the query, within a budget of characters for
 * the lines. A sentence is a candidate when one of its own words is a word of
 * the query. The candidates are ranked by BM25 over character grams, with
 * their neighbours beside them, kept when they score near the best, and
 * skipped when they say what one already picked says or do not fit the room
 * left. The picks come back in the order the conversation said them.
 */
export function pickFragments(sources: Source[], query: string, budgetChars: number): Fragment[] {
  const units = unitsOf(sources);
  if (units.length === 0) return [];
  const words = keyWords(query);
  if (words.length === 0) return [];
  const matches = wordMatcher(words);
  const scores = scoreUnits(units.map((unit) => unit.around), query);
  const candidates = units
    .map((_, i) => i)
    .filter((i) => (scores[i] ?? 0) > 0 && foldWords(units[i]?.text ?? "").some(matches));
  const best = candidates.reduce((top, i) => Math.max(top, scores[i] ?? 0), 0);
  const ranked = candidates
    .filter((i) => (scores[i] ?? 0) >= best * RELATIVE)
    .sort((a, b) => (scores[b] ?? 0) - (scores[a] ?? 0) || a - b);
  const picked: Unit[] = [];
  const shapes: Set<string>[] = [];
  let used = 0;
  for (const i of ranked) {
    const unit = units[i];
    if (unit === undefined) continue;
    const cost = fragmentLine(unit).length + 1;
    if (used + cost > budgetChars) continue;
    const shape = new Set(grams(unit.text));
    if (shapes.some((other) => overlap(other, shape) >= SIMILAR)) continue;
    picked.push(unit);
    shapes.push(shape);
    used += cost;
  }
  return picked
    .sort((a, b) => a.order - b.order)
    .map(({ turn, role, text }) => ({ turn, role, text }));
}

function keyWords(query: string): string[] {
  return [...new Set(foldWords(query))].filter((word) => word.length >= WORD_MIN && !STOP.has(word));
}

/**
 * Whether a word is one of the query's words: the same word, or one whose
 * character grams are alike enough to be its typo. Each distinct word is
 * judged once, so a long source costs one comparison per word it uses.
 */
function wordMatcher(queryWords: string[]): (word: string) => boolean {
  const queryGrams = queryWords.map((word) => new Set(grams(word)));
  const memo = new Map<string, boolean>();
  return (word) => {
    const known = memo.get(word);
    if (known !== undefined) return known;
    const own = new Set(grams(word));
    const hit = queryWords.some((query, i) => query === word || dice(queryGrams[i] ?? new Set(), own) >= WORD_SIMILAR);
    memo.set(word, hit);
    return hit;
  };
}

function unitsOf(sources: Source[]): Unit[] {
  const units: Unit[] = [];
  for (const source of sources) {
    const sentences = sentencesOf(source.text);
    sentences.forEach((text, i) => {
      const before = i > 0 ? sentences[i - 1] : undefined;
      const after = sentences[i + 1];
      const around = [before, text, after].filter((part) => part !== undefined).join(" ");
      units.push({ turn: source.turn, role: source.role, text, order: units.length, around });
    });
  }
  return units;
}

/** Dice similarity of two gram sets: twice the shared over the sum of both sizes. */
function dice(a: Set<string>, b: Set<string>): number {
  const total = a.size + b.size;
  if (total === 0) return 0;
  return (2 * shared(a, b)) / total;
}

/** Jaccard similarity of two gram sets: shared over everything either has. */
function overlap(a: Set<string>, b: Set<string>): number {
  const common = shared(a, b);
  const union = a.size + b.size - common;
  return union === 0 ? 1 : common / union;
}

function shared(a: Set<string>, b: Set<string>): number {
  let count = 0;
  for (const term of a) if (b.has(term)) count++;
  return count;
}
