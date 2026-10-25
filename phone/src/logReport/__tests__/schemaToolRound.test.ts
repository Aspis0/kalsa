/**
 * Round-trip for the three tool tags the report did not collect at all:
 * KALSA_TOOLCALL, KALSA_TOOLROUND_EXHAUSTED and KALSA_TOOL_CEILING were emitted
 * per round but absent from tagSchemas.ts, so formatRecord failed them closed
 * and no uploaded log ever showed them. Registered now, counters / booleans /
 * closed enums only.
 *
 * These tests run the REAL emitters (toolCallTelemetry.ts) through the REAL
 * pipeline — formatRecord → finalizeRecord — so a field added to a payload
 * without a schema rule shows up here as a silently dropped field, and a
 * payload that outgrows normalize.ts's 1024-char record cap shows up as a
 * dropped LINE rather than a truncated JSON record.
 */

import {
  clampToolNames,
  formatToolCallLine,
  formatToolRoundExhaustedLine,
  type ToolRoundTelemetry,
} from "../../engine/toolCallTelemetry";
import { finalizeRecord } from "../normalize";
import { formatRecord } from "../schema";

/** The cap normalize.ts drops a projected record over (MAX_RECORD_CHARS). */
const RECORD_CAP = 1024;

/** Emitted line → schema projection → finalize → parsed record, or a throw. */
function roundTrip(line: string): Record<string, unknown> {
  const cut = line.indexOf(" ");
  const tag = line.slice(0, cut);
  const projected = formatRecord(tag, JSON.parse(line.slice(cut + 1)));
  if (projected === null) throw new Error(`schema rejected ${tag}`);
  // finalizeRecord stamps `<iso> <TAG> {json}`; read the JSON tail after the
  // tag this line was emitted under.
  const finalized = finalizeRecord(projected);
  if (finalized === null) {
    throw new Error(`finalizeRecord dropped ${tag} (${projected.length} chars)`);
  }
  const at = finalized.indexOf(`${tag} {`);
  return JSON.parse(finalized.slice(at + tag.length + 1));
}

const EXHAUSTED = {
  roundsUsed: 3,
  streamedLen: 0,
  fallbackFired: true,
  fallbackAnswered: false,
  fallbackAttempts: 2,
  floor: "sources",
  rawLen: 812,
  sawThink: true,
  sawToolMarkup: false,
} as const;

const TOOLCALL: ToolRoundTelemetry = {
  round: 2,
  toolChoice: "auto",
  structuredCalls: 1,
  fallbackCalls: 0,
  fallbackDialect: "none",
  executed: 1,
  skippedCap: 0,
  skippedDup: 0,
  skippedFailedRepeat: 0,
  failed: 0,
  blockedPrivacy: 0,
  namesValid: true,
  argsParsed: true,
  toolNames: ["web_search", "web_fetch"],
};

describe("KALSA_TOOLROUND_EXHAUSTED", () => {
  it("round-trips every field the emitter writes", () => {
    expect(roundTrip(formatToolRoundExhaustedLine("42", EXHAUSTED))).toEqual({
      turnId: "42",
      ...EXHAUSTED,
    });
  });

  it("keeps the facts that tell the three empty-turn outcomes apart", () => {
    const rescued = roundTrip(formatToolRoundExhaustedLine("7", EXHAUSTED));
    expect(rescued.fallbackAnswered).toBe(false);
    // Both attempts spent, no words, so the floor spoke from the sources. The
    // last attempt's raw facts say WHY it stayed silent: a non-zero rawLen with
    // sawThink and no markup is the round that reasoned and got cut.
    expect(rescued.fallbackAttempts).toBe(2);
    expect(rescued.floor).toBe("sources");
    expect(rescued.rawLen).toBe(812);
    expect(rescued.sawThink).toBe(true);
    expect(rescued.sawToolMarkup).toBe(false);

    const markupOnly = roundTrip(
      formatToolRoundExhaustedLine("7", { ...EXHAUSTED, rawLen: 64, sawThink: false, sawToolMarkup: true }),
    );
    expect(markupOnly.sawThink).toBe(false);
    expect(markupOnly.sawToolMarkup).toBe(true);

    // Answered and silent-nothing-gathered are the other two floors, and the
    // line must not flatten them into one "ok".
    expect(
      roundTrip(formatToolRoundExhaustedLine("7", { ...EXHAUSTED, fallbackAnswered: true, fallbackAttempts: 1, floor: "none" })),
    ).toMatchObject({ fallbackAnswered: true, floor: "none" });
    expect(
      roundTrip(formatToolRoundExhaustedLine("7", { ...EXHAUSTED, fallbackAttempts: 1, floor: "canned" })),
    ).toMatchObject({ fallbackAttempts: 1, floor: "canned" });
  });

  it("drops a floor the app never emits, keeping the rest of the line", () => {
    const out = roundTrip(
      formatToolRoundExhaustedLine("7", { ...EXHAUSTED, floor: "hallucinated" as never }),
    );
    expect(out.floor).toBeUndefined();
    expect(out.fallbackAttempts).toBe(2);
  });

  it("drops a wrong-kind field instead of the line", () => {
    const out = roundTrip(
      formatToolRoundExhaustedLine("conv-a1b2", { ...EXHAUSTED, rawLen: "812" as unknown as number }),
    );
    expect(out.turnId).toBeUndefined(); // not a counter literal
    expect(out.rawLen).toBeUndefined(); // string where a number is allowed
    expect(out.fallbackAnswered).toBe(false); // the rest still counts the event
  });
});

describe("KALSA_TOOLCALL", () => {
  it("round-trips every field the emitter writes", () => {
    expect(roundTrip(formatToolCallLine("9", TOOLCALL))).toEqual({
      turnId: "9",
      round: 2,
      toolChoice: "auto",
      structuredCalls: 1,
      fallbackCalls: 0,
      fallbackDialect: "none",
      executed: 1,
      skippedCap: 0,
      skippedDup: 0,
      skippedFailedRepeat: 0,
      failed: 0,
      blockedPrivacy: 0,
      namesValid: true,
      argsParsed: true,
      toolNames: ["web_search", "web_fetch"],
    });
  });

  it("carries only clamped tool names, never a model's own string", () => {
    const clamped = clampToolNames(["web_search", "exfiltrate_everything"]);
    expect(clamped).toEqual(["web_search", "other"]);
    const out = roundTrip(formatToolCallLine("9", { ...TOOLCALL, toolNames: clamped }));
    expect(out.toolNames).toEqual(["web_search", "other"]);
  });

  it("the schema's closed set is the second line of defence, after the clamp", () => {
    // Fed straight at the schema — as any other emitter could — a name the app
    // does not own drops the whole field, not the one cell.
    expect(
      formatRecord("KALSA_TOOLCALL", {
        turnId: "9",
        round: 2,
        toolNames: ["web_search", "exfiltrate"],
      }),
    ).toBe(`KALSA_TOOLCALL ${JSON.stringify({ turnId: "9", round: 2 })}`);
    // Over the item ceiling the field drops too, rather than growing the line.
    expect(
      formatRecord("KALSA_TOOLCALL", {
        toolNames: ["web_search", "web_fetch", "document_chat", "write_note", "device_info"],
      }),
    ).toBe("KALSA_TOOLCALL {}");
  });

  it("drops a toolChoice the app never passes to the engine", () => {
    const out = roundTrip(formatToolCallLine("9", { ...TOOLCALL, toolChoice: "maybe" }));
    expect(out.toolChoice).toBeUndefined();
    expect(out.round).toBe(2);
  });
});

describe("KALSA_TOOL_CEILING", () => {
  it("round-trips the six projected numbers", () => {
    const line = `KALSA_TOOL_CEILING ${JSON.stringify({
      turnId: "3",
      round: 2,
      promptChars: 41234,
      toolsChars: 3180,
      promptTokens: 11842,
      ceiling: 12000,
    })}`;
    expect(roundTrip(line)).toEqual({
      turnId: "3",
      round: 2,
      promptChars: 41234,
      toolsChars: 3180,
      promptTokens: 11842,
      ceiling: 12000,
    });
  });
});

describe("the record cap", () => {
  it("the widest possible tool-call record still fits 1024 chars", () => {
    // Worst case the emitters can produce: a 12-digit turn counter, the
    // longest enum values, 12-digit counters and the longest clamped names.
    const widest = formatToolCallLine("999999999999", {
      round: 999999999,
      toolChoice: "required",
      structuredCalls: 999999999,
      fallbackCalls: 999999999,
      fallbackDialect: "openai",
      executed: 999999999,
      skippedCap: 999999999,
      skippedDup: 999999999,
      skippedFailedRepeat: 999999999,
      failed: 999999999,
      blockedPrivacy: 999999999,
      namesValid: false,
      argsParsed: false,
      toolNames: clampToolNames([
        "create_miniapp",
        "calendar_agenda",
        "document_chat",
        "web_search",
      ]),
    });
    const projected = formatRecord("KALSA_TOOLCALL", JSON.parse(widest!.slice(widest!.indexOf(" ") + 1)));
    expect(projected).not.toBeNull();
    expect(projected!.length).toBeLessThan(RECORD_CAP);
    // And it survives the cap in practice, not just by arithmetic.
    expect(roundTrip(widest!)).toMatchObject({ toolChoice: "required" });
  });
});