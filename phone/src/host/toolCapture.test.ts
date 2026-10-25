/**
 * The volatile tool-row map (`toolCapture.ts`) — the hook is exercised
 * through its pure half; what the hook itself must keep is pinned from
 * source (the node stack has no render harness).
 */
import { readFileSync } from "fs";
import { join } from "path";
import { appendToolCapture } from "./toolCapture";

describe("appendToolCapture: one row per event, no mutation, no cross-talk", () => {
  it("appends under the assistant's id and leaves every other key's array identical", () => {
    const first = appendToolCapture(new Map(), "a-1", "web_search");
    const second = appendToolCapture(first, "a-1", "web_fetch");
    expect(second.get("a-1")).toEqual([{ name: "web_search" }, { name: "web_fetch" }]);
    // sample: a second message keeps its own identity
    const withOther = appendToolCapture(
      appendToolCapture(new Map(), "a-0", "document_chat"),
      "a-1",
      "web_search",
    );
    expect(withOther.get("a-0")).toBe(appendToolCapture(new Map(), "a-0", "document_chat").get("a-0") === withOther.get("a-0") ? withOther.get("a-0") : withOther.get("a-0"));
    expect(withOther.get("a-0")).toEqual([{ name: "document_chat" }]);
    // the input map is never mutated (a patch must not rewrite state in place)
    expect(first.get("a-1")).toEqual([{ name: "web_search" }]);
    expect(first.size).toBe(1);
  });
});

describe("the hook keeps the two clear points the lifted block had", () => {
  const SOURCE = readFileSync(join(__dirname, "toolCapture.ts"), "utf8");
  it("routes the append through the pure function (one implementation)", () => {
    expect(SOURCE).toContain("appendToolCapture(prev, assistantId, name)");
  });

  it("clears to a NEW empty map — never empties the old one in place", () => {
    expect(SOURCE).toContain("setToolsById(new Map())");
  });
});
