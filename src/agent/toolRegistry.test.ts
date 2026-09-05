// webSearchTool loads secretStore transitively; keep this registry test Node-safe.
jest.mock("expo-secure-store", () => ({
  deleteItemAsync: jest.fn(),
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
}));

import {
  assembleTools,
  assertRegistryInvariants,
  ALL_TOOL_NAMES,
  TOOL_ENTRIES,
} from "./toolRegistry";

function fixture(name: string, defName = name) {
  return {
    name,
    def: {
      type: "function" as const,
      function: { name: defName, description: "", parameters: {} },
    },
  };
}

function names(flags: { web: boolean; device: boolean; calendar: boolean }): string[] {
  return assembleTools(flags).map((tool) => tool.function.name);
}

describe("tool registry", () => {
  test("lists all seven live tool names", () => {
    expect(ALL_TOOL_NAMES).toEqual([
      "web_search",
      "web_fetch",
      "document_chat",
      "write_note",
      "device_info",
      "device_calc",
      "calendar_agenda",
    ]);
    expect(TOOL_ENTRIES.map((entry) => entry.name)).toEqual(ALL_TOOL_NAMES);
  });

  test("rejects registry length, order, definition, and duplicate errors", () => {
    expect(() => assertRegistryInvariants([fixture("a")], [])).toThrow(/length/);
    expect(() => assertRegistryInvariants([fixture("a")], ["b"])).toThrow(
      /name mismatch at index 0/,
    );
    expect(() => assertRegistryInvariants([fixture("a", "b")], ["a"])).toThrow(
      /definition mismatch at index 0/,
    );
    expect(
      () => assertRegistryInvariants([fixture("a"), fixture("a")], ["a", "a"]),
    ).toThrow(/duplicate entry name/);
  });

  test("assembles the default set in AppShell order", () => {
    expect(names({ web: true, device: true, calendar: false })).toEqual([
      "web_search",
      "web_fetch",
      "document_chat",
      "write_note",
      "device_info",
      "device_calc",
    ]);
  });

  test("omits web tools while retaining independent local tools", () => {
    expect(names({ web: false, device: true, calendar: false })).toEqual([
      "document_chat",
      "write_note",
      "device_info",
      "device_calc",
    ]);
  });

  test("assembles every optional group when enabled", () => {
    expect(names({ web: true, device: false, calendar: true })).toEqual([
      "web_search",
      "web_fetch",
      "document_chat",
      "write_note",
      "calendar_agenda",
    ]);
    expect(names({ web: false, device: false, calendar: true })).toEqual([
      "document_chat",
      "write_note",
      "calendar_agenda",
    ]);
    expect(names({ web: true, device: true, calendar: true })).toEqual([
      "web_search",
      "web_fetch",
      "document_chat",
      "write_note",
      "device_info",
      "device_calc",
      "calendar_agenda",
    ]);
    expect(names({ web: false, device: false, calendar: false })).toEqual([
      "document_chat",
      "write_note",
    ]);
    expect(names({ web: true, device: false, calendar: false })).toEqual([
      "web_search",
      "web_fetch",
      "document_chat",
      "write_note",
    ]);
    expect(names({ web: false, device: true, calendar: true })).toEqual([
      "document_chat",
      "write_note",
      "device_info",
      "device_calc",
      "calendar_agenda",
    ]);
  });
});
