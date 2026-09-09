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
  readAsStringAsync: jest.fn(async () => ""),
  writeAsStringAsync: jest.fn(async () => undefined),
  createDownloadResumable: jest.fn(),
  deleteAsync: jest.fn(async () => undefined),
}));

jest.mock("react-native-fs", () => ({
  __esModule: true,
  hash: jest.fn(),
}));

import * as FileSystem from "expo-file-system/legacy";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { hash as hashFile } from "react-native-fs";

import { getStrings } from "../i18n";
import { MODEL_REGISTRY } from "./ModelRegistry";
import { DEV_MODEL_REGISTRY } from "./devModelCatalog";
import {
  downloadModelBundle,
  fileSpecFor,
  finalizeDownloadedFile,
  friendlyNetworkError,
  hasValidSha256Marker,
  hfFileUrl,
  InvalidSha256DigestError,
  isModelBundleDownloaded,
  isVerifiedFile,
  modelLocalPath,
  Sha256VerificationUnavailableError,
  sha256MarkerPath,
} from "./ModelDownloader";

const model = MODEL_REGISTRY.find((entry) => entry.id === "lfm2.5-2.6b")!;
// Fixture, not a catalogue entry. These tests are about the unpublished-artifact
// path, and binding them to whichever model carried hfArtifactRepo broke all
// four the day the KEXP was dropped (2026-08-23). No shipped model is our own
// artifact today, so the rule needs a subject that does not depend on that.
const owned = {
  ...model,
  hfArtifactRepo: "SOME-OWN-REQUANT-GGUF",
  file: "SOME-OWN-REQUANT.gguf",
};

describe("ModelDownloader artifact hosting", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (hashFile as jest.Mock).mockReset();
  });

  test("builds a pinned URL through the resolver", () => {
    expect(hfFileUrl(model, model.file)).toBe(
      "https://huggingface.co/LiquidAI/LFM2.5-2.6B-GGUF/resolve/f4a289c8a200a5ca71005ba7abc2dad33058a450/LFM2.5-2.6B-QAD-Q4_0.gguf",
    );
  });

  test("constructs a pinned MiniCPM5 URL from its upstream repository", () => {
    const minicpm = DEV_MODEL_REGISTRY.find((entry) => entry.id === "dev-minicpm5-2b")!;
    expect(hfFileUrl(minicpm, minicpm.file)).toBe(
      "https://huggingface.co/openbmb/MiniCPM5-2B-GGUF/resolve/d00c954e5f9a0f2605468f24703ffa7e5cb0c492/MiniCPM5-2B-Q4_K_M.gguf",
    );
  });

  test("refuses an unpublished artifact before creating a network task", async () => {
    await expect(downloadModelBundle(owned, { locale: "en" })).rejects.toMatchObject({
      name: "UnpublishedArtifactError",
    });
    expect(FileSystem.createDownloadResumable).not.toHaveBeenCalled();
  });

  test("localizes an unpublished artifact without a network diagnosis", async () => {
    let failure: unknown;
    try {
      await downloadModelBundle(owned, { locale: "en" });
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
    expect(() => hfFileUrl(owned, owned.file)).toThrow("Kalsa artifact is unpublished");
  });
});

describe("ModelDownloader SHA-256 verification", () => {
  const target = "file:///kalsa/models/dev-minicpm5-2b/MiniCPM5-2B-Q4_K_M.gguf";
  const resumeKey = "kalsa.download.resume.dev-minicpm5-2b.revision.file";
  const digest = "a".repeat(64);
  const spec = { file: "MiniCPM5-2B-Q4_K_M.gguf", sizeBytes: 10, sha256: digest };

  beforeEach(() => {
    jest.clearAllMocks();
    (hashFile as jest.Mock).mockReset();
    (FileSystem.getInfoAsync as jest.Mock).mockReset().mockResolvedValue({ exists: false });
    (FileSystem.readAsStringAsync as jest.Mock).mockReset().mockResolvedValue("");
    (FileSystem.writeAsStringAsync as jest.Mock).mockReset().mockResolvedValue(undefined);
  });

  test("deletes the file and resume data only on a confirmed digest mismatch", async () => {
    (hashFile as jest.Mock).mockResolvedValue("b".repeat(64));

    await expect(
      finalizeDownloadedFile(target, spec, resumeKey, { locale: "en" }),
    ).rejects.toThrow(getStrings("en").download.integrityMismatch);
    expect(FileSystem.deleteAsync).toHaveBeenCalledWith(target, { idempotent: true });
    expect(FileSystem.deleteAsync).toHaveBeenCalledWith(sha256MarkerPath(target), { idempotent: true });
    expect(AsyncStorage.removeItem).toHaveBeenCalledWith(resumeKey);
  });

  test("writes a marker and reuses it without hashing on the next presence check", async () => {
    let marker: string | undefined;
    (hashFile as jest.Mock).mockResolvedValue(digest);
    (FileSystem.getInfoAsync as jest.Mock).mockImplementation(async (uri: string) => {
      if (uri === target) return { exists: true, size: spec.sizeBytes };
      return uri === sha256MarkerPath(target)
        ? { exists: marker !== undefined, size: marker?.length }
        : { exists: false };
    });
    (FileSystem.readAsStringAsync as jest.Mock).mockImplementation(async () => marker ?? "");
    (FileSystem.writeAsStringAsync as jest.Mock).mockImplementation(async (_uri: string, contents: string) => {
      marker = contents;
    });

    await expect(
      finalizeDownloadedFile(target, spec, resumeKey, { locale: "en" }),
    ).resolves.toEqual({ status: "done", uri: target });
    expect(FileSystem.writeAsStringAsync).toHaveBeenCalledWith(sha256MarkerPath(target), digest);
    expect(hashFile).toHaveBeenCalledTimes(1);
    await expect(isVerifiedFile(target, spec)).resolves.toBe(true);
    expect(await hasValidSha256Marker(target, digest)).toBe(true);
    expect(hashFile).toHaveBeenCalledTimes(1);
  });

  test("lazily verifies a complete sideload and persists its marker", async () => {
    const minicpm = DEV_MODEL_REGISTRY.find((entry) => entry.id === "dev-minicpm5-2b")!;
    const sideloadedTarget = modelLocalPath(minicpm, minicpm.file);
    let marker: string | undefined;
    (hashFile as jest.Mock).mockResolvedValue(minicpm.sha256);
    (FileSystem.getInfoAsync as jest.Mock).mockImplementation(async (uri: string) => {
      if (uri === sideloadedTarget) return { exists: true, size: minicpm.sizeBytes };
      return uri === sha256MarkerPath(sideloadedTarget)
        ? { exists: marker !== undefined, size: marker?.length }
        : { exists: false };
    });
    (FileSystem.readAsStringAsync as jest.Mock).mockImplementation(async () => marker ?? "");
    (FileSystem.writeAsStringAsync as jest.Mock).mockImplementation(async (_uri: string, contents: string) => {
      marker = contents;
    });

    await expect(isModelBundleDownloaded(minicpm)).resolves.toBe(true);
    await expect(isModelBundleDownloaded(minicpm)).resolves.toBe(true);
    expect(hashFile).toHaveBeenCalledTimes(1);
    expect(FileSystem.writeAsStringAsync).toHaveBeenCalledTimes(1);
  });

  test("keeps a complete sideload when the hasher is unavailable", async () => {
    const minicpm = DEV_MODEL_REGISTRY.find((entry) => entry.id === "dev-minicpm5-2b")!;
    const sideloadedTarget = modelLocalPath(minicpm, minicpm.file);
    (FileSystem.getInfoAsync as jest.Mock).mockImplementation(async (uri: string) =>
      uri === sideloadedTarget ? { exists: true, size: minicpm.sizeBytes } : { exists: false },
    );
    (hashFile as jest.Mock).mockRejectedValue(new Error("RNFS unavailable"));

    await expect(downloadModelBundle(minicpm, { locale: "en" })).rejects.toBeInstanceOf(
      Sha256VerificationUnavailableError,
    );
    expect(FileSystem.deleteAsync).not.toHaveBeenCalled();
    expect(FileSystem.createDownloadResumable).not.toHaveBeenCalled();
  });

  test("keeps the file when the hasher returns a malformed digest", async () => {
    (hashFile as jest.Mock).mockResolvedValue("not-a-digest");

    await expect(
      finalizeDownloadedFile(target, spec, resumeKey, { locale: "en" }),
    ).rejects.toBeInstanceOf(InvalidSha256DigestError);
    expect(FileSystem.deleteAsync).not.toHaveBeenCalled();
    expect(AsyncStorage.removeItem).not.toHaveBeenCalled();
  });

  test("does not hash legacy entries without sha256", async () => {
    const legacySpec = fileSpecFor(model);

    await expect(
      finalizeDownloadedFile(target, legacySpec, resumeKey, { locale: "en" }),
    ).resolves.toEqual({ status: "done", uri: target });
    expect(hashFile).not.toHaveBeenCalled();
    expect(FileSystem.writeAsStringAsync).not.toHaveBeenCalled();
  });

  test("returns aborted when cancellation lands during hashing", async () => {
    const controller = new AbortController();
    (hashFile as jest.Mock).mockImplementation(async () => {
      controller.abort();
      return digest;
    });

    await expect(
      finalizeDownloadedFile(target, spec, resumeKey, { locale: "en", signal: controller.signal }),
    ).resolves.toEqual({ status: "aborted" });
    expect(FileSystem.deleteAsync).not.toHaveBeenCalled();
    expect(FileSystem.writeAsStringAsync).not.toHaveBeenCalled();
  });
});
