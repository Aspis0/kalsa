/**
 * The turn must never end empty, and must never lie about why.
 *
 * Two bugs, one device log (iPhone, web question, LFM2.5 2.6B):
 *  - round 2 is the final round (tool_choice "none") but still carried the 7
 *    tool definitions and the with-tools system prompt that orders a search on
 *    "eventi" questions. The model answered with tool-call markup. The one-shot
 *    fallback ran without tools and answered with think + markup again. Then
 *    visibleTurnText returned the interrupted marker, which counted as a
 *    successful fallback and suppressed the honest canned message: the user saw
 *    "Generazione interrotta." for a turn nothing interrupted, and the sources
 *    it had already paid for were thrown away.
 *
 * So: markup is not an answer and not an interruption. The rescue spends up to
 * MAX_TEXT_ONLY_ATTEMPTS getting words, and if it cannot, the never-empty floor
 * closes the turn from the sources the turn gathered — the canned message only
 * when nothing was gathered. The interrupted marker stays where it was true: a
 * turn that really was cut off mid-answer.
 *
 * Three things the rescue must get right, all of them once-wrong:
 *  - each attempt OWNS its visible text (held, released only by the winner), so
 *    a failed attempt leaves no residue in the bubble or in history;
 *  - the reason the turn ended up here belongs to the user, so every attempt's
 *    reasoning accumulates into the span that persists;
 *  - the telemetry line reports the floor that actually closed the turn.
 *
 * LlamaService.ts value-imports llama.rn, so no Jest test can import it: the
 * wiring is asserted as source text, and the DECISION is exercised through the
 * real modules the path composes (thinkStream's cleaner + toolCallParser's
 * final strip + answerFloor's floor + the real telemetry formatter +
 * visibleTurnText for the abort case).
 */

import fs from "fs";
import path from "path";

import { hasToolCallMarkup, stripToolCallTagsFinal } from "./toolCallParser";
import { createThinkStreamCleaner, sawThinkTags } from "./thinkStream";
import { visibleTurnText } from "./truncatedTurnText";
import { buildSourcesAnswer } from "./answerFloor";
import {
  formatToolRoundExhaustedLine,
  type ToolRoundExhaustedTelemetry,
} from "./toolCallTelemetry";
import { MAX_TEXT_ONLY_ATTEMPTS } from "./textOnlySampling";

const MARKER = "Generation was interrupted.";
const LEAD = "Here's what I found:";
const CANNED = "I couldn't complete the search. Please try again or rephrase your question.";

/** What a real turn gathered: a round-0 web_search card and a round-1 fetch. */
const SOURCES = [
  { title: "Capital of Madagascar", url: "https://example.org/antananarivo" },
  { title: "Antananarivo", url: "https://example.org/wiki/antananarivo" },
];

const serviceSource = fs.readFileSync(
  path.resolve(__dirname, "LlamaService.ts"),
  "utf8",
);

/** The source between two stable anchors, so a moved anchor fails loudly. */
function spanBetween(from: string, to: string): string {
  const start = serviceSource.indexOf(from);
  const end = serviceSource.indexOf(to, start);
  if (start < 0 || end < 0) throw new Error(`missing span anchors: ${from} … ${to}`);
  return serviceSource.slice(start, end);
}

/** LlamaService's own join rule, restated so the accumulation is exercised. */
function joinThinking(acc: string, next: string): string {
  if (next.trim().length === 0) return acc;
  return acc.length > 0 ? `${acc}\n\n${next}` : next;
}

/** One text-only attempt, as the service composes it: think arbitration, then
 *  the tool-markup strip. `streamed` is what its token callback held live. */
function attemptClose(attempt: {
  emitted: string;
  streamed?: string;
  templateOpensThink?: boolean;
}): { words: string; held: string; thinking: string } {
  const cleaner = createThinkStreamCleaner({
    templateOpensThink: attempt.templateOpensThink ?? true,
  });
  return {
    words: stripToolCallTagsFinal(cleaner.finalize(attempt.emitted)).trim(),
    held: attempt.streamed ?? "",
    thinking: cleaner.thinkingText(),
  };
}

type RescueOutcome = {
  outcome: "words" | "floor" | "canned" | "aborted";
  /** The `full` argument of the last onDelta — what the bubble shows and
   *  history persists. */
  full: string;
  attemptsUsed: number;
  /** The authoritative {final:true} thinking span the turn persists. */
  thinking: string;
};

/**
 * The rescue path, composed the way LlamaService composes it: spend the
 * attempts (each one's words held until it wins), accumulate their reasoning,
 * then the floor, then the canned message. Deliberately mirrors the shipped
 * control flow (the wiring describe below pins that it does).
 */
function runRescue(args: {
  attempts: { emitted: string; streamed?: string; templateOpensThink?: boolean }[];
  sources?: unknown[];
  /** Visible text already on screen when the rescue starts (normally ""). */
  visibleAtStart?: string;
  /** Thinking the turn had before the rescue started. */
  thinkingAtStart?: string;
  /**
   * Stop the turn inside THIS attempt (1-based), the way the stop button does:
   * nothing was released and no floor was built, because the release only
   * happens after an attempt's result is arbitrated.
   */
  abortedDuring?: number;
}): RescueOutcome {
  const visibleAtStart = args.visibleAtStart ?? "";
  let thinking = args.thinkingAtStart ?? "";
  for (const [index, attempt] of args.attempts.entries()) {
    const close = attemptClose(attempt);
    thinking = joinThinking(thinking, close.thinking);
    if (args.abortedDuring === index + 1) {
      return { outcome: "aborted", full: visibleAtStart, attemptsUsed: index + 1, thinking };
    }
    if (!close.words) continue; // held text dropped; its reasoning stayed
    return {
      outcome: "words",
      full: visibleAtStart + close.words,
      attemptsUsed: index + 1,
      thinking,
    };
  }
  const floor = buildSourcesAnswer(args.sources, LEAD);
  return {
    outcome: floor ? "floor" : "canned",
    full: visibleAtStart + (floor || CANNED),
    attemptsUsed: args.attempts.length,
    thinking,
  };
}

/** The round that produced nothing visible: markup, or markup after reasoning. */
const MARKUP = '<|tool_call_start|>[web_search(query="eventi Roma")]';
const MARKUP_AFTER_THINK = `<think>I should search again.${MARKUP}`;

describe("a rescue attempt that gets words ends the turn there", () => {
  test("markup in the final round is not an answer: the next attempt's words are", () => {
    const out = runRescue({
      attempts: [{ emitted: MARKUP }, { emitted: "<think>reasoning</think>Roma, dalla ricerca." }],
      sources: SOURCES,
    });
    expect(out.outcome).toBe("words");
    expect(out.full).toBe("Roma, dalla ricerca.");
    expect(out.attemptsUsed).toBe(2);
    // The floor never runs on this path, so the sources are not listed too.
    expect(out.full).not.toContain(LEAD);
  });

  test("a round that answers first time costs one attempt and no floor", () => {
    const out = runRescue({
      attempts: [{ emitted: "<think>t</think>La capitale è Antananarivo." }],
      sources: SOURCES,
    });
    expect(out).toMatchObject({
      outcome: "words",
      full: "La capitale è Antananarivo.",
      attemptsUsed: 1,
    });
  });

  test("prose written BEFORE the markup is the answer the stop token preserves", () => {
    // The whole point of stopping at the tool-call token: with it, the model
    // gets these words out and the markup never starts. Without it, this exact
    // text strips to nothing and the turn falls to the floor.
    expect(attemptClose({ emitted: `Antananarivo.${MARKUP}`, templateOpensThink: false }).words)
      .toBe("Antananarivo.");
    expect(stripToolCallTagsFinal(MARKUP).trim()).toBe("");
  });
});

describe("each attempt owns its visible text", () => {
  // The residue bug: streamedText is turn-level and never rewinds, so an
  // attempt that streamed prose and then had it stripped used to leave that
  // prose glued in front of the next attempt's answer — in the bubble AND in
  // persisted history, which is built from these exact calls.
  test("a failed attempt's streamed prose is gone, not glued to the winner", () => {
    const out = runRescue({
      attempts: [
        // Streamed "Antananarivo is the capital." live… then the round closed
        // on markup, so the strip left nothing.
        { emitted: `Antananarivo is the capital.${MARKUP}`, streamed: "Antananarivo is the capital." },
        { emitted: "<think>t</think>Ecco cosa ho trovato: Antananarivo.", streamed: "Ecco cosa ho trovato: Antananarivo." },
      ],
      sources: SOURCES,
    });
    expect(out.outcome).toBe("words");
    expect(out.full).toBe("Ecco cosa ho trovato: Antananarivo.");
    // Not one character of the failed attempt survives in front of it.
    expect(out.full).not.toContain("Antananarivo is the capital");
    expect(out.full.split("Antananarivo").length - 1).toBe(1);
  });

  test("the floor does not resurrect it either", () => {
    const out = runRescue({
      attempts: [
        { emitted: `Residue.${MARKUP}`, streamed: "Residue." },
        { emitted: MARKUP },
      ],
      sources: SOURCES,
    });
    expect(out.outcome).toBe("floor");
    expect(out.full.startsWith(LEAD)).toBe(true);
    expect(out.full).not.toContain("Residue");
  });

  test("text already on screen before the rescue is kept, exactly once", () => {
    const out = runRescue({
      attempts: [{ emitted: "<think>t</think>La risposta." }],
      visibleAtStart: "Risposta precedente.",
      sources: SOURCES,
    });
    expect(out.full).toBe("Risposta precedente.La risposta.");
  });

  test("a cooling retry of one attempt cannot stack its text on the held text", () => {
    // Same attempt, run twice after a thermal pause: the hold resets with the
    // attempt, so the release is the retry's answer, not both.
    const attempt = { emitted: "<think>t</think>Risposta.", streamed: "Risposta." };
    const first = runRescue({ attempts: [attempt, attempt] });
    expect(first.full).toBe("Risposta.");
  });
});

describe("the never-empty floor", () => {
  test("markup twice in a row: the sources the turn gathered close it", () => {
    const out = runRescue({
      attempts: [{ emitted: MARKUP }, { emitted: MARKUP }],
      sources: SOURCES,
    });
    expect(out.outcome).toBe("floor");
    expect(out.full).toBe(
      `${LEAD}\nCapital of Madagascar — https://example.org/antananarivo\nAntananarivo — https://example.org/wiki/antananarivo`,
    );
  });

  test("reasoning with no words is the floor too, never the marker", () => {
    // The exact case that used to print "Generation was interrupted." for a
    // turn nothing interrupted: the template opened the think block, the model
    // reasoned and emitted markup, and the strip left nothing.
    const out = runRescue({
      attempts: [
        { emitted: MARKUP_AFTER_THINK, templateOpensThink: true },
        { emitted: MARKUP_AFTER_THINK, templateOpensThink: true },
      ],
      sources: SOURCES,
    });
    expect(out.outcome).toBe("floor");
    expect(out.full).not.toBe(MARKER);
    expect(out.full.startsWith(LEAD)).toBe(true);
  });

  test("nothing gathered: the honest canned message is the only true thing left", () => {
    const out = runRescue({
      attempts: [{ emitted: MARKUP }, { emitted: MARKUP }],
      sources: [],
    });
    expect(out.outcome).toBe("canned");
    expect(out.full).toBe(CANNED);
    expect(out.full).not.toContain(LEAD);
  });
});

describe("a turn that really was cut off still says so", () => {
  test("an abort mid-reasoning closes with the interrupted marker", () => {
    // Unchanged and deliberately so: the marker belongs to truncation, which is
    // what this path is. It is not a rescue tier.
    expect(
      visibleTurnText({
        finalText: "",
        streamedVisibleLength: 0,
        thinking: "reasoning cut off by the stop button",
        interruptedMarker: MARKER,
      }),
    ).toBe(MARKER);
  });

  test("an abort DURING a rescue attempt still shows the marker, with no residue", () => {
    // The held text means streamedVisibleLength is still the pre-rescue length
    // when the user hits stop mid-attempt — so the abort path reads a true
    // buffer and speaks. Without the hold, attempt 1's stripped prose would be
    // in that buffer and the turn would close on a half-answer instead.
    const stoppedMidRescue = runRescue({
      attempts: [
        { emitted: `<think>Residue.${MARKUP}`, streamed: "Residue.", templateOpensThink: true },
        { emitted: "<think>still going", templateOpensThink: true },
      ],
      // The user hits stop during the second attempt.
      abortedDuring: 2,
    });
    const whatTheAbortPathSees = visibleTurnText({
      finalText: "",
      streamedVisibleLength: stoppedMidRescue.full.length,
      thinking: stoppedMidRescue.thinking,
      interruptedMarker: MARKER,
    });
    expect(whatTheAbortPathSees).toBe(MARKER);
    // Nothing of the failed attempt reached the bubble: it was held.
    expect(stoppedMidRescue.full).toBe("");
    expect(stoppedMidRescue.thinking).toContain("Residue.");
  });

  test("text already streamed wins over the marker, and a silent abort stays empty", () => {
    expect(
      visibleTurnText({
        finalText: "",
        streamedVisibleLength: 120,
        thinking: "reasoning",
        interruptedMarker: MARKER,
      }),
    ).toBe("");
    expect(
      visibleTurnText({
        finalText: "",
        streamedVisibleLength: 0,
        thinking: "   ",
        interruptedMarker: MARKER,
      }),
    ).toBe("");
  });

  test("the rescue path cannot reach this function any more", () => {
    const rescueSpan = spanBetween(
      "for (\n            let attempt = 1;",
      "callbacks.onDelta(floorText, streamedText);",
    );
    expect(rescueSpan).not.toContain("visibleTurnText");
    expect(rescueSpan).not.toContain("strings.chat.interrupted");
    // The normal round and the abort path keep it.
    expect(spanBetween("const emitFinalText =", "if (finalText) callbacks.onDelta(")).toContain(
      "interruptedMarker: strings.chat.interrupted",
    );
    expect(spanBetween("const abortMarker = visibleTurnText({", "if (abortMarker)")).toContain(
      "interruptedMarker: strings.chat.interrupted",
    );
  });
});

describe("every attempt's reasoning belongs to the user", () => {
  test("the winning span carries the failed attempts' reasoning too", () => {
    const out = runRescue({
      attempts: [
        { emitted: MARKUP_AFTER_THINK, templateOpensThink: true },
        { emitted: "<think>weighing the sources</think>Antananarivo.", templateOpensThink: true },
      ],
      thinkingAtStart: "Earlier rounds reasoned about the question.",
    });
    expect(out.thinking).toContain("Earlier rounds reasoned about the question.");
    expect(out.thinking).toContain("I should search again.");
    expect(out.thinking).toContain("weighing the sources");
  });
});

describe("the telemetry line reports what closed the turn", () => {
  const base: ToolRoundExhaustedTelemetry = {
    roundsUsed: 3,
    streamedLen: 0,
    fallbackFired: true,
    fallbackAnswered: false,
    fallbackAttempts: 2,
    floor: "none",
    rawLen: 64,
    sawThink: true,
    sawToolMarkup: true,
  };

  /** The emitted line → the parsed payload, the way a log reader reads it. */
  function logged(tel: ToolRoundExhaustedTelemetry): Record<string, unknown> {
    const line = formatToolRoundExhaustedLine("42", tel);
    return JSON.parse(line.slice(line.indexOf("{")));
  }

  test("the floor value is set BEFORE the line is serialized", () => {
    // The ordering bug: the line used to be emitted with floor still "none",
    // because the assignment sat below the log call. Position, not a substring
    // count — the assertion fails the moment the two swap places again.
    const assign = serviceSource.indexOf(
      "exhaustedTel.floor = sourcesAnswer ? \"sources\" : \"canned\";",
    );
    const emit = serviceSource.indexOf("console.log(formatToolRoundExhaustedLine(turnId, exhaustedTel));");
    expect(assign).toBeGreaterThan(-1);
    expect(emit).toBeGreaterThan(-1);
    expect(assign).toBeLessThan(emit);
  });

  test("a sources floor reaches the log as \"sources\"", () => {
    const sourcesAnswer = buildSourcesAnswer(SOURCES, LEAD);
    const tel: ToolRoundExhaustedTelemetry = {
      ...base,
      floor: sourcesAnswer ? "sources" : "canned",
    };
    expect(logged(tel)).toMatchObject({ floor: "sources", fallbackAnswered: false });
  });

  test("nothing gathered reaches the log as \"canned\"", () => {
    const sourcesAnswer = buildSourcesAnswer([], LEAD);
    const tel: ToolRoundExhaustedTelemetry = {
      ...base,
      floor: sourcesAnswer ? "sources" : "canned",
    };
    expect(logged(tel)).toMatchObject({ floor: "canned" });
  });

  test("a rescue that answered reports no floor at all", () => {
    expect(
      logged({ ...base, fallbackAnswered: true, fallbackAttempts: 1, floor: "none" }),
    ).toMatchObject({ fallbackAnswered: true, fallbackAttempts: 1, floor: "none" });
  });
});

describe("the wiring in LlamaService", () => {
  const rescueSpan = spanBetween(
    "for (\n            let attempt = 1;",
    "callbacks.onDelta(floorText, streamedText);",
  );
  const attemptSpan = spanBetween(
    "const fallbackEmitted = extractRawResultText(fallbackResult);",
    'console.warn("[toolRoundsExhausted] rescue attempt failed"',
  );
  const tokenSpan = spanBetween(
    "const runFallbackRound = () => {",
    "const fallbackResult = await",
  );

  test("the rescue is bounded, and one attempt answering stops the loop", () => {
    expect(rescueSpan).toContain("attempt <= MAX_TEXT_ONLY_ATTEMPTS && !toolFallbackOk");
    expect(rescueSpan).not.toContain("attempt <= 2");
    expect(attemptSpan).toContain("exhaustedTel.fallbackAnswered = true;");
    expect(attemptSpan).toContain("toolFallbackOk = true;");
  });

  test("an attempt's words are held, not streamed, and released only by the winner", () => {
    // The token callback may not write into the turn buffer or emit.
    expect(tokenSpan).toContain("attemptStreamed += delta;");
    expect(tokenSpan).not.toContain("streamedText += delta");
    expect(tokenSpan).not.toContain("callbacks.onDelta(delta");
    // The release is anchored at the pre-rescue text, not at the attempt's own.
    expect(attemptSpan).toContain("streamedText = visibleTextAtRescueStart + fallbackText;");
    expect(attemptSpan).toContain("callbacks.onDelta(fallbackText, streamedText);");
    // …and the floor uses the same anchor, so neither can drop earlier text.
    expect(rescueSpan).toContain("streamedText = visibleTextAtRescueStart + floorText;");
    // Captured ONCE, before the loop, or the second attempt would anchor on the
    // first one's leftovers.
    expect(
      serviceSource.indexOf("const visibleTextAtRescueStart = streamedText;"),
    ).toBeLessThan(serviceSource.indexOf("for (\n            let attempt = 1;"));
  });

  test("a cooling retry resets the hold with the attempt", () => {
    expect(rescueSpan).toMatch(/const runFallbackRound = \(\) => \{\s*attemptStreamed = "";/);
  });

  test("every attempt runs text-only: no tools, low temperature, stop at the call", () => {
    expect(rescueSpan).toMatch(/stop: withToolCallStop\(STOP_WORDS\)/);
    expect(rescueSpan).toMatch(/temperature: TEXT_ONLY_TEMPERATURE/);
    // No tools on these rounds at all — the whole point of the rescue.
    expect(spanBetween("const runFallbackRound =", "const fallbackResult = await")).not.toContain(
      "tools:",
    );
  });

  test("the last attempt carries the user-side note; the first does not", () => {
    expect(rescueSpan).toMatch(
      /if \(attempt === MAX_TEXT_ONLY_ATTEMPTS\) \{\s*fallbackMessages\.push\(\{/,
    );
    expect(rescueSpan).toContain("content: strings.toolResultsAnswerNowNote,");
    expect(rescueSpan).toContain(
      "const fallbackMessages = buildFallbackMessages(currentMessages, {",
    );
  });

  test("reasoning accumulates across attempts, and the persisted span is that one", () => {
    expect(attemptSpan).toContain("thinkingAccum = fallbackThinking;");
    expect(attemptSpan).toContain(
      "callbacks.onThinkingText?.(fallbackThinking, { final: true });",
    );
    expect(attemptSpan).toContain("const fallbackThinking = joinThinking(");
    // The rounds that came BEFORE the rescue flush once, before the loop; the
    // attempts flush themselves inside it (the assignment above).
    expect(
      serviceSource.indexOf(
        "thinkingAccum = joinThinking(thinkingAccum, thinkCleaner.thinkingText());",
      ),
    ).toBeLessThan(serviceSource.indexOf("for (\n            let attempt = 1;"));
  });

  test("the floor reads the turn's accumulated sources, and the canned message is the last resort", () => {
    expect(rescueSpan).toContain("buildSourcesAnswer(");
    expect(rescueSpan).toContain("accumulatedSources,");
    expect(rescueSpan).toContain("strings.chat.answerSourcesLead,");
    expect(rescueSpan).toMatch(/floorText = sourcesAnswer \|\| strings\.errors\.toolRoundsExhausted;/);
  });

  test("the final tool round keeps its prompt: sampling changes, the prefix does not", () => {
    // The KV cache decision. Round 2 still sends the tools and tool_choice it
    // has always sent, so the prefix the round before it built is still valid;
    // only the stop list and the temperature move.
    const roundSpan = spanBetween(
      "const isFinalToolRound = round === MAX_TOOL_ROUNDS - 1;",
      "const toolChoice = resolveCompletionToolChoice({",
    );
    expect(roundSpan).toContain("const textOnlyRound = isFinalToolRound || forceTextOnly;");
    // The temperature is scoped to the dialect that failed; the stop word is not,
    // because a stop string a model never emits costs nothing.
    expect(roundSpan).toContain("const lfmToolDialect = usesLfmToolDialect(activeModelId);");
    const completionSpan = spanBetween("const runCompletionRound =", "(data: TokenData) => {");
    expect(completionSpan).toMatch(
      /stop: textOnlyRound \? withToolCallStop\(STOP_WORDS\) : STOP_WORDS,/,
    );
    expect(completionSpan).toMatch(
      /temperature:\s*textOnlyRound && lfmToolDialect \? TEXT_ONLY_TEMPERATURE : 0\.7,/,
    );
    expect(completionSpan).toContain("tools: options!.tools as EngineTool[],");
    expect(completionSpan).toContain("tool_choice: toolChoice,");
  });

  test("the two attempts share one cleaner lifecycle per attempt", () => {
    expect(rescueSpan).toMatch(
      /thinkCleaner = createThinkStreamCleaner\(\{\s*templateOpensThink: fallbackOpensThink,/,
    );
    expect(rescueSpan).toContain("toolCallStrip = createToolCallDeltaStripper();");
    expect(rescueSpan).toContain("if (bailIfStopped()) return;");
  });
});

describe("the bound and the dialect", () => {
  test("two attempts, stated once", () => {
    expect(MAX_TEXT_ONLY_ATTEMPTS).toBe(2);
  });

  test("the telemetry facts distinguish the ways a rescue stays silent", () => {
    expect(sawThinkTags("<think>reasoning", { templateOpensThink: true })).toBe(true);
    expect(hasToolCallMarkup("<think>reasoning")).toBe(false);
    expect(sawThinkTags(MARKUP, { templateOpensThink: false })).toBe(false);
    expect(hasToolCallMarkup(MARKUP)).toBe(true);
  });
});