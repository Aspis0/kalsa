/**
 * The send path keeps the user's typed words — a DELIBERATE IMPROVEMENT over
 * parity, with the reason documented in `sendDraft.ts`. The rule and both
 * production clear sites are pinned against the host implementation.
 */
import { readFileSync } from "fs";
import { join } from "path";

import { sendClearsDraft } from "./sendDraft";

const SEND = readFileSync(join(__dirname, "sendHost.ts"), "utf8");
const ROOT = readFileSync(join(__dirname, "HostRoot.tsx"), "utf8");

describe("sendClearsDraft: the field loses only the words the field sent", () => {
  test("the field's own words clear the field (trimmed both ways)", () => {
    expect(sendClearsDraft("hello kalsa", "hello kalsa")).toBe(true);
    expect(sendClearsDraft(" hello kalsa ", "hello kalsa")).toBe(true);
  });

  test("a suggestion card's foreign words leave the draft standing", () => {
    expect(sendClearsDraft("hello kalsa", "Summarize this page")).toBe(false);
    expect(sendClearsDraft("hello kalsa", "")).toBe(false);
  });

  test("an empty draft is never 'sent by the field' against other text", () => {
    expect(sendClearsDraft("", "a card prompt")).toBe(false);
    // Sample for the predicate itself: equality alone must not decide it.
    expect(sendClearsDraft("draft", "draft")).toBe(true);
    expect(sendClearsDraft("draft", "other")).toBe(false);
  });
});

describe("both clear sites run behind the rule (the device-captured defect)", () => {
  const guards = SEND.split("\n").filter((line) => line.includes("params.clearDraft()"));

  test("exactly two clears exist — the content gate and the append", () => {
    expect(guards).toHaveLength(2);
  });

  test("neither clear runs unless the field itself sent the words", () => {
    for (const line of guards) {
      expect(line).toContain(
        "if (sendClearsDraft(params.draft, trimmed)) params.clearDraft();",
      );
    }
    // Sample: the assertion above fails a bare, unconditional clear.
    expect("        params.clearDraft();").not.toContain("sendClearsDraft");
  });

  test("the host hands the send the field's current text", () => {
    const block = ROOT.match(/useSendHost\(\{[\s\S]*?\n {2}\}\)/)?.[0] ?? "";
    expect(block.length).toBeGreaterThan(0);
    expect(block).toMatch(/\n    draft,\n/);
  });
});
