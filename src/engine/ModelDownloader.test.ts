jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => undefined),
    removeItem: jest.fn(async () => undefined),
  },
}));

jest.mock("expo-file-system/legacy", () => ({
  __esModule: true,
  documentDirectory: "file:///kalsa/",
  makeDirectoryAsync: jest.fn(async () => undefined),
  getInfoAsync: jest.fn(async () => ({ exists: false })),
  createDownloadResumable: jest.fn(),
  deleteAsync: jest.fn(async () => undefined),
}));

import * as FileSystem from "expo-file-system/legacy";

import { getStrings } from "../i18n";
import { MODEL_REGISTRY } from "./ModelRegistry";
import {
  downloadModelBundle,
  friendlyNetworkError,
  hfFileUrl,
} from "./ModelDownloader";

const model = MODEL_REGISTRY.find((entry) => entry.id === "lfm2.5-2.6b")!;
const kexp = MODEL_REGISTRY.find((entry) => entry.id === "lfm2.5-8b-a1b-kexp")!;

describe("ModelDownloader artifact hosting", () => {
  beforeEach(() => jest.clearAllMocks());

  test("builds a pinned URL through the resolver", () => {
    expect(hfFileUrl(model, model.file)).toBe(
      "https://huggingface.co/LiquidAI/LFM2.5-2.6B-GGUF/resolve/f4a289c8a200a5ca71005ba7abc2dad33058a450/LFM2.5-2.6B-QAD-Q4_0.gguf",
    );
  });

  test("refuses an unpublished artifact before creating a network task", async () => {
    await expect(downloadModelBundle(kexp, { locale: "en" })).rejects.toMatchObject({
      name: "UnpublishedArtifactError",
    });
    expect(FileSystem.createDownloadResumable).not.toHaveBeenCalled();
  });

  test("localizes an unpublished artifact without a network diagnosis", async () => {
    let failure: unknown;
    try {
      await downloadModelBundle(kexp, { locale: "en" });
    } catch (error) {
      failure = error;
    }

    const message = friendlyNetworkError(failure, "en", "download").message;
    expect(message).toContain("ours");
    expect(message).toContain("not been published yet");
    expect(message).not.toContain(getStrings("en").errors.connectionLost);
  });

  test("still classifies a real socket timeout as a network error", () => {
    expect(friendlyNetworkError(new Error("socket timeout"), "en").message).toBe(
      getStrings("en").errors.connectionLost,
    );
  });

  test("does not create a URL for an unpublished artifact", () => {
    expect(() => hfFileUrl(kexp, kexp.file)).toThrow("Kalsa artifact is unpublished");
  });
});
