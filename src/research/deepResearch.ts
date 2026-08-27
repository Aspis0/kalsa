/**
 * Host-owned deep research over the local library.
 * Plan (one completion) → retrieve per subquery → write (one completion) →
 * rewrite [[n]] citations. The 4B never owns the loop.
 */

import type { RetrievedPassage } from "../context/retrievalLoop";
import {
  packPassagesToBudget,
  retrieveLibraryPassages,
  type DocumentChatExecute,
} from "../documents/documentChatTool";
import {
  formatPassageCitation,
  type LibraryDoc,
} from "../documents/DocumentLibrary";
import type { Locale } from "../i18n/types";
import { getStrings } from "../i18n";
import {
  PLANNER_JSON_SCHEMA,
  fallbackSubqueries,
  parsePlannerOutput,
} from "./plan";

export const DEEP_RESEARCH_PASSAGE_BUDGET_CHARS = 6000;
const COVERAGE_MIN_PASSAGES = 3;
const COVERAGE_MIN_CHARS = 400;
const WRITER_N_PREDICT = 1000;
const PLANNER_N_PREDICT = 256;
/** ~4 chars/token; leave headroom for system + question + plan. */
const PASSAGE_TOKEN_RESERVE = 1800;
/** Wall-clock cap for sequential per-doc retrieval + write (7 min). */
const DEEP_RESEARCH_DEADLINE_MS = 420_000;
const WRITER_PROMPT_RESERVE = 1200;
const WRITER_MIN_PREDICT = 256;

export type DeepResearchAborted = { kind: "aborted" };

export type DeepResearchOutcome =
  | DeepResearchAborted
  | { kind: "empty_library"; text: string }
  | { kind: "no_results"; text: string }
  | { kind: "interrupted"; text: string }
  | { kind: "report"; text: string; partial: boolean };

export type DeepResearchCallbacks = {
  onStatus?: (status: { label: string }) => void;
  onDelta?: (delta: string, full: string) => void;
};

export type DeepResearchCompleteOnce = (opts: {
  system: string;
  user: string;
  temperature: number;
  nPredict: number;
  jsonSchema?: object;
  signal?: AbortSignal;
  timeoutMs?: number;
}) => Promise<{ text: string; aborted: boolean; engineSwapped?: boolean }>;

/** Max question length sent to the planner/writer (chars). */
const QUESTION_MAX_CHARS = 500;

export type RunDeepResearchOpts = {
  question: string;
  locale: Locale;
  docs: LibraryDoc[];
  execute: DocumentChatExecute;
  completeOnce: DeepResearchCompleteOnce;
  nCtx: number;
  signal?: AbortSignal;
  callbacks?: DeepResearchCallbacks;
};

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    const err = new Error("aborted");
    err.name = "AbortError";
    throw err;
  }
}

function passageKey(p: RetrievedPassage): string {
  return `${p.docId}\0${p.chunkId}`;
}

function mergeUnique(
  acc: RetrievedPassage[],
  extra: RetrievedPassage[],
): RetrievedPassage[] {
  const seen = new Set(acc.map(passageKey));
  const out = acc.slice();
  for (const p of extra) {
    const k = passageKey(p);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(p);
  }
  return out;
}

function coverageOk(passages: RetrievedPassage[]): boolean {
  if (passages.length >= COVERAGE_MIN_PASSAGES) return true;
  let chars = 0;
  for (const p of passages) chars += typeof p.text === "string" ? p.text.length : 0;
  return chars >= COVERAGE_MIN_CHARS;
}

function residualQuery(question: string, passages: RetrievedPassage[]): string {
  const qWords = question
    .toLowerCase()
    .replace(/[^a-z0-9àèéìòùäöüß]+/gi, " ")
    .trim()
    .split(/\s+/)
    .filter((w) => w.length >= 3);
  if (qWords.length === 0) return question;
  const covered = new Set<string>();
  for (const p of passages) {
    const words = (p.text ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9àèéìòùäöüß]+/gi, " ")
      .split(/\s+/);
    for (const w of words) if (w) covered.add(w);
  }
  const leftover = qWords.filter((w) => !covered.has(w));
  return leftover.length > 0 ? leftover.join(" ") : question;
}

function sourceIdFromPassageDocId(docId: string): string {
  if (typeof docId !== "string") return "";
  const m = /#p\d+$/.exec(docId);
  return m ? docId.slice(0, m.index) : docId;
}

function titleForPassage(p: RetrievedPassage, docs: LibraryDoc[]): string {
  const sourceId = sourceIdFromPassageDocId(p.docId);
  const bySource = docs.find((d) => d.sourceId === sourceId);
  if (bySource?.name) return bySource.name;
  const byId = docs.find((d) => d.id === sourceId || p.docId.startsWith(d.sourceId));
  return byId?.name || sourceId || p.docId;
}

export type CitationEntry = { n: number; title: string; page: string };

export function buildCitationMap(
  passages: RetrievedPassage[],
  docs: LibraryDoc[],
): Map<number, CitationEntry> {
  const map = new Map<number, CitationEntry>();
  passages.forEach((p, i) => {
    const n = i + 1;
    map.set(n, {
      n,
      title: titleForPassage(p, docs),
      page: formatPassageCitation(p.docId),
    });
  });
  return map;
}

export function rewriteCitations(
  markdown: string,
  map: Map<number, CitationEntry>,
): { text: string; cited: number[] } {
  const cited = new Set<number>();
  const rewritten = markdown.replace(/\[\[(\d+)\]\]/g, (_m, raw: string) => {
    const n = Number(raw);
    const entry = map.get(n);
    if (!entry) {
      // Keep an honest marker instead of dropping the token and leaving
      // dangling prose for an invented number.
      return "[?]";
    }
    cited.add(n);
    return entry.page ? `[${entry.title}, ${entry.page}]` : `[${entry.title}]`;
  });
  return { text: rewritten, cited: [...cited].sort((a, b) => a - b) };
}

export function appendSources(
  body: string,
  map: Map<number, CitationEntry>,
  cited: number[],
): string {
  if (cited.length === 0) return body.trimEnd();
  const lines = cited.map((n) => {
    const e = map.get(n);
    if (!e) return "";
    return e.page ? `[${n}] ${e.title} — ${e.page}` : `[${n}] ${e.title}`;
  }).filter(Boolean);
  return `${body.trimEnd()}\n\n## Sources\n${lines.join("\n")}\n`;
}

function passageBudgetForCtx(nCtx: number): number {
  if (typeof nCtx !== "number" || !Number.isFinite(nCtx) || nCtx <= 0) {
    // No converged context: be conservative, not maximal.
    return 2400;
  }
  const fromCtx = Math.max(1200, (nCtx - PASSAGE_TOKEN_RESERVE) * 4);
  return Math.min(DEEP_RESEARCH_PASSAGE_BUDGET_CHARS, fromCtx);
}

function prioritizeByScore(passages: RetrievedPassage[]): RetrievedPassage[] {
  return passages.slice().sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
}

function formatPassagesForWriter(
  passages: RetrievedPassage[],
): string {
  return passages
    .map((p, i) => `[[${i + 1}]] ${p.text ?? ""}`.trim())
    .join("\n\n");
}

export async function runDeepResearch(
  opts: RunDeepResearchOpts,
): Promise<DeepResearchOutcome> {
  const strings = getStrings(opts.locale);
  const chat = strings.chat as Record<string, string>;
  const errors = strings.errors as Record<string, string>;
  const status = (label: string) => opts.callbacks?.onStatus?.({ label });

  try {
    throwIfAborted(opts.signal);
    // Library empty → honest message before any model call.
    const docs = Array.isArray(opts.docs) ? opts.docs : [];
    if (docs.length === 0) {
      const text =
        errors.deepResearchEmptyLibrary ??
        "No documents in the library to research. Add documents first.";
      opts.callbacks?.onDelta?.(text, text);
      return { kind: "empty_library", text };
    }

    // Guard degenerate questions and bound prompt size (4B context is small).
    const question = opts.question.replace(/\s+/g, " ").trim().slice(0, QUESTION_MAX_CHARS);
    if (!question) {
      const text =
        chat.deepResearchNeedsQuestion ??
        "Ask a question to research your library.";
      opts.callbacks?.onDelta?.(text, text);
      return { kind: "no_results", text };
    }
    const deadlineAt = Date.now() + DEEP_RESEARCH_DEADLINE_MS;
    const pastDeadline = () => Date.now() >= deadlineAt;
    status(chat.deepResearchPlanning ?? "Planning research…");

    let subqueries = fallbackSubqueries(question);
    const planResult = await opts.completeOnce({
      system:
        "You plan library searches. Reply with JSON only: " +
        '{ "subqueries": ["short keyword phrase", ...] }. ' +
        "Return 3 to 5 phrases, each at most 12 words. No prose.",
      user: question,
      temperature: 0.3,
      nPredict: PLANNER_N_PREDICT,
      jsonSchema: PLANNER_JSON_SCHEMA,
      signal: opts.signal,
    });
    throwIfAborted(opts.signal);
    // Planner non-signal abort (timeout / engine noise): treat as a failed
    // parse and fall back to mechanical subqueries — never a hard stop.
    if (planResult.aborted && opts.signal?.aborted) return { kind: "aborted" };
    const parsed = parsePlannerOutput(planResult.text, question);
    if (parsed) subqueries = parsed;

    const accumulated: RetrievedPassage[] = [];
    let failed = 0;
    const total = subqueries.length;

    let retrievalPartial = false;
    for (let i = 0; i < subqueries.length; i += 1) {
      throwIfAborted(opts.signal);
      if (pastDeadline()) {
        retrievalPartial = true;
        break;
      }
      const label = (chat.deepResearchQuery ?? "Query {n}/{total}…")
        .replace("{n}", String(i + 1))
        .replace("{total}", String(total));
      status(label);

      const hop1 = await retrieveLibraryPassages(
        opts.execute,
        subqueries[i] ?? question,
        docs,
        opts.signal,
        deadlineAt,
      );
      if (hop1.aborted) return { kind: "aborted" };
      failed += hop1.failed;
      if (hop1.deadlineHit) {
        retrievalPartial = true;
        break;
      }
      let hopPassages = hop1.passages;

      if (!coverageOk(hopPassages) && !pastDeadline()) {
        const residual = residualQuery(subqueries[i] ?? question, hopPassages);
        if (residual && residual !== (subqueries[i] ?? "")) {
          const hop2 = await retrieveLibraryPassages(
            opts.execute,
            residual,
            docs,
            opts.signal,
            deadlineAt,
          );
          if (hop2.aborted) return { kind: "aborted" };
          if (hop2.deadlineHit) {
            retrievalPartial = true;
            break;
          }
          failed += hop2.failed;
          hopPassages = mergeUnique(hopPassages, hop2.passages);
        }
      }

      accumulated.push(...hopPassages);
    }

    const unique = mergeUnique([], accumulated);
    const budget = passageBudgetForCtx(opts.nCtx);
    const packed = packPassagesToBudget(prioritizeByScore(unique), budget);

    if (packed.length === 0) {
      const text =
        chat.deepResearchNoResults ??
        "The library returned no relevant passages for this question.";
      opts.callbacks?.onDelta?.(text, text);
      return { kind: "no_results", text };
    }

    throwIfAborted(opts.signal);
    if (pastDeadline()) retrievalPartial = true;
    status(chat.deepResearchWriting ?? "Writing report…");

    const map = buildCitationMap(packed, docs);
    const writerUser =
      `Question:\n${question}\n\n` +
      `Search plan:\n${subqueries.map((q, i) => `${i + 1}. ${q}`).join("\n")}\n\n` +
      `Cited passages (cite ONLY with [[n]] matching these numbers):\n\n` +
      formatPassagesForWriter(packed);

    const writerPredict = Math.min(
      WRITER_N_PREDICT,
      Math.max(WRITER_MIN_PREDICT, (opts.nCtx || 4096) - WRITER_PROMPT_RESERVE),
    );
    const writeResult = await opts.completeOnce({
      system:
        "Write a structured Markdown report (## headings, short paragraphs) " +
        "of 400–600 words answering the question. Use ONLY the provided " +
        "cited passages. Cite with [[n]] exactly as numbered. " +
        "Do not invent numbers, page numbers, titles, or facts not in the passages.",
      user: writerUser,
      temperature: 0.5,
      nPredict: writerPredict,
      signal: opts.signal,
      timeoutMs: 240_000,
    });
    throwIfAborted(opts.signal);
    if (writeResult.aborted && opts.signal?.aborted) return { kind: "aborted" };
    const draft = (writeResult.text ?? "").trim();
    // Non-signal completion failure: engine swapped mid-write, or the writer
    // produced nothing (timeout with no tokens / engine error). Never leave
    // the user with a silent empty bubble or a raw unlabelled passage dump.
    if (!draft) {
      if (writeResult.engineSwapped) {
        const text =
          chat.deepResearchInterrupted ??
          "Research was interrupted because the model engine changed. Send again to retry.";
        opts.callbacks?.onDelta?.(text, text);
        return { kind: "interrupted", text };
      }
      // Timeout with zero generated tokens, or engine error: give the
      // passages with an explanation.
      const failLead =
        chat.deepResearchWriterFailed ??
        "The report could not be finished on this device — retrieved passages below.";
      const blob = packed
        .map((p, i) => `[[${i + 1}]] ${p.text ?? ""}`.trim())
        .join("\n\n");
      const text = `${failLead}\n\n${blob}`;
      opts.callbacks?.onDelta?.(text, text);
      return { kind: "report", text, partial: true };
    }

    const rewrittenDraft = rewriteCitations(draft, map);
    const rewritten = rewrittenDraft.text;
    const cited = rewrittenDraft.cited;
    const partial = failed > 0 || retrievalPartial || Boolean(writeResult.aborted);
    let report = rewritten;
    if (partial) {
      report += chat.deepResearchPartial ?? " (partial — some sources were unavailable)";
    }
    report = appendSources(report, map, cited);
    opts.callbacks?.onDelta?.(report, report);
    return { kind: "report", text: report, partial: Boolean(partial) };
  } catch (err) {
    if (opts.signal?.aborted || (err instanceof Error && err.name === "AbortError")) {
      return { kind: "aborted" };
    }
    throw err;
  }
}
