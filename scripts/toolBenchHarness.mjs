#!/usr/bin/env node
/**
 * Harness for tool-use benchmark graders.
 * Tests tool_required, tool_forbidden, and tool_selection graders with
 * synthetic turn fixtures.
 */
import {
  gradeToolRequired,
  gradeToolForbidden,
  gradeToolSelection,
} from "./benchGraders.mjs";

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`✗ ${name}`);
    console.error(`  ${err.message}`);
    failed++;
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message || "Assertion failed");
  }
}

function assertEquals(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(
      message || `Expected ${expected}, got ${actual}`,
    );
  }
}

// ── tool_required tests ─────────────────────────────────────────────────────

test("tool_required: pass when tool call emitted", () => {
  const turn = {
    index: 0,
    id: "tool_required_test",
    toolRounds: [
      {
        structuredCalls: 1,
        fallbackCalls: 0,
        toolNames: ["web_search"],
      },
    ],
  };
  const result = gradeToolRequired(turn);
  assertEquals(result.family, "tool_required");
  assertEquals(result.found, true, "Should pass when tool call emitted");
});

test("tool_required: fail when no tool call emitted", () => {
  const turn = {
    index: 0,
    id: "tool_required_test",
    toolRounds: [
      {
        structuredCalls: 0,
        fallbackCalls: 0,
        toolNames: [],
      },
    ],
  };
  const result = gradeToolRequired(turn);
  assertEquals(result.family, "tool_required");
  assertEquals(result.found, false, "Should fail when no tool call emitted");
});

test("tool_required: pass with fallback call", () => {
  const turn = {
    index: 0,
    id: "tool_required_test",
    toolRounds: [
      {
        structuredCalls: 0,
        fallbackCalls: 1,
        toolNames: ["web_search"],
      },
    ],
  };
  const result = gradeToolRequired(turn);
  assertEquals(result.family, "tool_required");
  assertEquals(result.found, true, "Should pass with fallback call");
});

// ── tool_forbidden tests ────────────────────────────────────────────────────

test("tool_forbidden: pass when no tool call emitted", () => {
  const turn = {
    index: 0,
    id: "tool_forbidden_test",
    toolRounds: [
      {
        structuredCalls: 0,
        fallbackCalls: 0,
        toolNames: [],
      },
    ],
  };
  const result = gradeToolForbidden(turn);
  assertEquals(result.family, "tool_forbidden");
  assertEquals(result.found, true, "Should pass when no tool call emitted");
});

test("tool_forbidden: fail when tool call emitted", () => {
  const turn = {
    index: 0,
    id: "tool_forbidden_test",
    toolRounds: [
      {
        structuredCalls: 1,
        fallbackCalls: 0,
        toolNames: ["web_search"],
      },
    ],
  };
  const result = gradeToolForbidden(turn);
  assertEquals(result.family, "tool_forbidden");
  assertEquals(result.found, false, "Should fail when tool call emitted");
});

test("tool_forbidden: fail with fallback call", () => {
  const turn = {
    index: 0,
    id: "tool_forbidden_test",
    toolRounds: [
      {
        structuredCalls: 0,
        fallbackCalls: 1,
        toolNames: ["web_search"],
      },
    ],
  };
  const result = gradeToolForbidden(turn);
  assertEquals(result.family, "tool_forbidden");
  assertEquals(result.found, false, "Should fail with fallback call");
});

// ── tool_selection tests ────────────────────────────────────────────────────

test("tool_selection: pass when correct tool called", () => {
  const turn = {
    index: 0,
    id: "tool_sel_web_search",
    toolRounds: [
      {
        structuredCalls: 1,
        fallbackCalls: 0,
        toolNames: ["web_search"],
      },
    ],
  };
  const result = gradeToolSelection(turn);
  assertEquals(result.family, "tool_selection");
  assertEquals(result.expectedTool, "web_search");
  assertEquals(result.found, true, "Should pass when correct tool called");
});

test("tool_selection: fail when wrong tool called", () => {
  const turn = {
    index: 0,
    id: "tool_sel_web_fetch",
    toolRounds: [
      {
        structuredCalls: 1,
        fallbackCalls: 0,
        toolNames: ["web_search"], // Expected web_fetch but called web_search
      },
    ],
  };
  const result = gradeToolSelection(turn);
  assertEquals(result.family, "tool_selection");
  assertEquals(result.expectedTool, "web_fetch");
  assertEquals(result.found, false, "Should fail when wrong tool called");
});

test("tool_selection: fail when no tool called", () => {
  const turn = {
    index: 0,
    id: "tool_sel_document_chat",
    toolRounds: [
      {
        structuredCalls: 0,
        fallbackCalls: 0,
        toolNames: [],
      },
    ],
  };
  const result = gradeToolSelection(turn);
  assertEquals(result.family, "tool_selection");
  assertEquals(result.expectedTool, "document_chat");
  assertEquals(result.found, false, "Should fail when no tool called");
});

test("tool_selection: pass with fallback call of correct tool", () => {
  const turn = {
    index: 0,
    id: "tool_sel_web_search",
    toolRounds: [
      {
        structuredCalls: 0,
        fallbackCalls: 1,
        toolNames: ["web_search"],
      },
    ],
  };
  const result = gradeToolSelection(turn);
  assertEquals(result.family, "tool_selection");
  assertEquals(result.expectedTool, "web_search");
  assertEquals(result.found, true, "Should pass with fallback call of correct tool");
});

test("tool_selection: fail when multiple tools called including wrong one", () => {
  const turn = {
    index: 0,
    id: "tool_sel_web_search",
    toolRounds: [
      {
        structuredCalls: 2,
        fallbackCalls: 0,
        toolNames: ["web_search", "web_fetch"], // Expected only web_search
      },
    ],
  };
  const result = gradeToolSelection(turn);
  assertEquals(result.family, "tool_selection");
  assertEquals(result.expectedTool, "web_search");
  // This is a tricky case - the expected tool was called, but also a wrong one.
  // The current implementation fails if unexpected tools are called.
  assertEquals(result.found, false, "Should fail when wrong tool also called");
});

// ── Summary ─────────────────────────────────────────────────────────────────

console.log("");
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);

if (failed > 0) {
  process.exit(1);
}
