import { fence } from "../pageFence";
import { scoreUnits } from "./bm25";
import { foldWords, gramsOf } from "./grams";
import { sentencesOf } from "./sentences";

/** Whose words a piece of text is: the person's, the model's, a page the
    browser read, or a document the person attached. The stamp says which, so
    the model reads a stranger's words as a stranger's. */
export type Role = "user" | "assistant" | "tool" | "document";

/** One text of a turn, as that turn carried it. */
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
  /** The sentence's own words, folded once. */
  words: string[];
  /** The words of the sentence and of its neighbours, which are searched with it. */
  around: string[];
}

/** A fragment the digest carries, with the text and the line it takes. */
interface Carried {
  unit: Unit;
  /** The text it carries: the sentence, or the sentence fenced. */
  text: string;
  /** The line it takes in the block. */
  line: string;
  /** Its shape, for the twin test. */
  shape: Set<string>;
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
 * left. Two sentences that say the same thing are carried once, and the
 * **newer** of the two is the one that is carried: an update supersedes what
 * it restates. The picks come back in the order the conversation said them.
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
    .filter((i) => (scores[i] ?? 0) > 0 && (units[i]?.words ?? []).some(matches));
  const best = candidates.reduce((top, i) => Math.max(top, scores[i] ?? 0), 0);
  const ranked = candidates
    .filter((i) => (scores[i] ?? 0) >= best * RELATIVE)
    .sort((a, b) => (scores[b] ?? 0) - (scores[a] ?? 0) || a - b);
  const picked: Carried[] = [];
  let used = 0;
  for (const i of ranked) {
    const unit = units[i];
    if (unit === undefined) continue;
    const shape = new Set(gramsOf(unit.words));
    const twins = picked.flatMap((other, at) => (overlap(other.shape, shape) >= SIMILAR ? [at] : []));
    const said = twins.map((at) => picked[at]?.unit).filter((one): one is Unit => one !== undefined);
    // **The newer twin wins.** A sentence said again later is the one that is
    // true now, and the older one gives its room back: a price updated from 99
    // to 149 must not be carried as the 99.
    if (said.some((other) => newerThan(other, unit))) continue;
    const freed = twins.reduce((sum, at) => sum + (picked[at]?.line.length ?? 0) + 1, 0);
    const text = carriedText(unit);
    const line = fragmentLine({ turn: unit.turn, role: unit.role, text });
    const cost = line.length + 1;
    // **The budget is read after the room the old twin gives back.** An update
    // that only fits once the sentence it replaces is gone is still the
    // sentence that is true now, and a cap read before the eviction would keep
    // the obsolete one.
    if (used - freed + cost > budgetChars) continue;
    for (const at of [...twins].sort((a, b) => b - a)) picked.splice(at, 1);
    used -= freed;
    picked.push({ unit, text, line, shape });
    used += cost;
  }
  return picked
    .sort((a, b) => a.unit.order - b.unit.order)
    .map(({ unit, text }) => ({ turn: unit.turn, role: unit.role, text }));
}

/**
 * The text a fragment carries: its sentence, or **the same sentence fenced**
 * when it came from a page.
 *
 * **A page's words stay data.** The digest hands them to the model inside the
 * fence the wire uses, with a marker drawn now: the page cannot know it, and
 * a page that guesses it has only ended its own fence. A sentence the model
 * wrote, and a document the person attached, are the conversation's own words
 * and ride as they are.
 */
function carriedText(unit: Unit): string {
  return unit.role === "tool" ? fence(unit.text) : unit.text;
}

/**
 * Which of two sentences is the newer: the later turn wins, and inside one
 * turn the later sentence does. An update is said after what it updates.
 */
function newerThan(candidate: Unit, older: Unit): boolean {
  if (candidate.turn !== older.turn) return candidate.turn > older.turn;
  return candidate.order > older.order;
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
  const queryGrams = queryWords.map((word) => new Set(gramsOf([word])));
  const memo = new Map<string, boolean>();
  return (word) => {
    const known = memo.get(word);
    if (known !== undefined) return known;
    const own = new Set(gramsOf([word]));
    const hit = queryWords.some((query, i) => query === word || dice(queryGrams[i] ?? new Set(), own) >= WORD_SIMILAR);
    memo.set(word, hit);
    return hit;
  };
}

function unitsOf(sources: Source[]): Unit[] {
  const units: Unit[] = [];
  for (const source of sources) {
    const sentences = sentencesOf(source.text);
    // **The words of every sentence, folded once.** A unit is searched with
    // its own and with its neighbours', and a fold per reading is a fold per
    // unit of a cut that can hold thousands of them.
    const folded = sentences.map((sentence) => foldWords(sentence));
    folded.forEach((words, i) => {
      const before = i > 0 ? folded[i - 1] ?? [] : [];
      const after = i + 1 < folded.length ? folded[i + 1] ?? [] : [];
      units.push({
        turn: source.turn,
        role: source.role,
        text: sentences[i] ?? "",
        order: units.length,
        words,
        around: [...before, ...words, ...after],
      });
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
