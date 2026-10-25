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

import { computePromptEnvHash } from "./sessionPersistence";
import { MEMORY_FACTS_ON_USER_TAIL } from "./ttftFlags";

test("pins memory facts to the user tail and excludes them from the env hash", () => {
  expect(MEMORY_FACTS_ON_USER_TAIL).toBe(true);
  expect(computePromptEnvHash("en", ["likes tea"], true)).toBe(
    computePromptEnvHash("en", ["likes coffee"], true),
  );
});
