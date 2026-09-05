// toolGateRegistry derives from toolRegistry, whose web definition reaches
// secretStore transitively; keep this pure gate test Node-safe.
jest.mock("expo-secure-store", () => ({
  deleteItemAsync: jest.fn(),
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
}));

import { CALENDAR_GATE_TABLE } from "./calendarGate";
import { TOOL_GATE_TABLE } from "./toolGate";
import { WEB_FETCH_GATE_TABLE } from "./webFetchGate";
import {
  resolveToolGateTable,
  TOOL_GATE_REGISTRY,
} from "./toolGateRegistry";

describe("resolveToolGateTable", () => {
  test("web_search is registered and resolves with expand off", () => {
    expect(TOOL_GATE_REGISTRY.web_search).toBe(TOOL_GATE_TABLE);
    expect(resolveToolGateTable("web_search", false)).toBe(TOOL_GATE_TABLE);
    expect(resolveToolGateTable("web_search", true)).toBe(TOOL_GATE_TABLE);
  });

  test("calendar_agenda is registered but hidden until expand", () => {
    expect(TOOL_GATE_REGISTRY.calendar_agenda).toBe(CALENDAR_GATE_TABLE);
    expect(resolveToolGateTable("calendar_agenda", false)).toBeUndefined();
    expect(resolveToolGateTable("calendar_agenda", true)).toBe(CALENDAR_GATE_TABLE);
  });

  test("web_fetch is registered and resolves with expand on or off", () => {
    expect(TOOL_GATE_REGISTRY.web_fetch).toBe(WEB_FETCH_GATE_TABLE);
    expect(resolveToolGateTable("web_fetch", false)).toBe(WEB_FETCH_GATE_TABLE);
    expect(resolveToolGateTable("web_fetch", true)).toBe(WEB_FETCH_GATE_TABLE);
    expect(WEB_FETCH_GATE_TABLE.rules.map(({ id, priority }) => ({ id, priority }))).toEqual([
      { id: "sensitive-pattern-in-url", priority: 26 },
      { id: "sensitive-pattern-in-query", priority: 25 },
    ]);
  });

  test("unregistered and miniapp tools are exempt even when expand is on", () => {
    expect(resolveToolGateTable("document_chat", true)).toBeUndefined();
    expect(resolveToolGateTable("miniapp_quiz", true)).toBeUndefined();
    expect(resolveToolGateTable("miniapp_quiz", false)).toBeUndefined();
  });
});
