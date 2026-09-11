/**
 * Load-time hash is computeSessionPromptEnvHash (the AppShell import),
 * not a restated promptEnvToolHashFields copy.
 */

jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => undefined),
    removeItem: jest.fn(async () => undefined),
  },
}));

jest.mock("expo-file-system/legacy", () => ({
  documentDirectory: "/tmp/",
  cacheDirectory: "/tmp/",
}));

import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  BENCH_TOOLCHOICE_KEY,
  getToolChoiceMode,
  shouldUseToolCalling,
} from "../bench/benchConfig";
import { computePromptEnvHash } from "./sessionPersistence";
import { promptEnvToolHashFields } from "./sessionKey";
import { computeSessionPromptEnvHash } from "./sessionPromptEnv";

const tools = [
  { function: { name: "web_search" } },
  { function: { name: "document_chat" } },
];
const names = tools.map((tool) => tool.function.name);
const executeTool = () => undefined;

function mockToolChoice(mode: string | null): void {
  (AsyncStorage.getItem as jest.Mock).mockImplementation(async (key: string) =>
    key === BENCH_TOOLCHOICE_KEY ? mode : null,
  );
}

describe("computeSessionPromptEnvHash", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  test("tools on (auto) matches promptEnvToolHashFields hash", async () => {
    mockToolChoice("auto");
    const hash = await computeSessionPromptEnvHash({
      locale: "it",
      tools,
      executeTool,
      blockFormat: "none",
    });
    const mode = await getToolChoiceMode();
    const fields = promptEnvToolHashFields({
      toolsWired: Boolean(names.length && executeTool),
      toolCallingEnabled: shouldUseToolCalling(mode),
      toolNames: names,
    });
    expect(mode).toBe("auto");
    expect(fields.hasTools).toBe(true);
    expect(hash).toBe(
      computePromptEnvHash("it", [], fields.hasTools, fields.toolNames, "none"),
    );
  });

  test("toolChoiceMode none matches empty-tools hash", async () => {
    mockToolChoice("none");
    const hash = await computeSessionPromptEnvHash({
      locale: "it",
      tools,
      executeTool,
      blockFormat: "none",
    });
    const mode = await getToolChoiceMode();
    const fields = promptEnvToolHashFields({
      toolsWired: Boolean(names.length && executeTool),
      toolCallingEnabled: shouldUseToolCalling(mode),
      toolNames: names,
    });
    expect(mode).toBe("none");
    expect(fields.hasTools).toBe(false);
    expect(fields.toolNames).toEqual([]);
    expect(hash).toBe(
      computePromptEnvHash("it", [], fields.hasTools, fields.toolNames, "none"),
    );
    expect(hash).toBe(computePromptEnvHash("it", [], false, [], "none"));
  });
});
