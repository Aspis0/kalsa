import { getPairingCredential } from "../../pairing/pairingCredentialStore";
import { getRemoteBrainToken } from "./remoteSecret";
import { getRemoteBrainUrl, setRemoteBrainUrl } from "./remoteSettings";
import { getRemoteDoorConfig, getRemoteDoorToken } from "./remoteDoorConfig";

jest.mock("@react-native-async-storage/async-storage", () => ({
  getItem: async () => null,
  setItem: async () => undefined,
}));
jest.mock("../../pairing/pairingCredentialStore", () => ({
  getPairingCredential: jest.fn(),
}));
jest.mock("./remoteSecret", () => ({
  getRemoteBrainToken: jest.fn(),
}));

const pairedMock = getPairingCredential as jest.MockedFunction<typeof getPairingCredential>;
const manualTokenMock = getRemoteBrainToken as jest.MockedFunction<typeof getRemoteBrainToken>;

describe("remote door configuration precedence", () => {
  beforeEach(async () => {
    pairedMock.mockReset().mockResolvedValue(null);
    manualTokenMock.mockReset().mockResolvedValue("typed-token");
    await setRemoteBrainUrl("https://manual.example:8000");
  });

  test("paired door and credential win together over typed values", async () => {
    pairedMock.mockResolvedValue({
      doorUrl: "https://paired.tailnet.ts.net:9443",
      credential: "ab".repeat(32),
    });
    const config = await getRemoteDoorConfig();

    expect(config).toEqual({
      url: "https://paired.tailnet.ts.net:9443",
      pairedCredential: "ab".repeat(32),
      source: "pairing",
    });
    expect(config.url).not.toBe(getRemoteBrainUrl());
    await expect(getRemoteDoorToken(config)).resolves.toBe("ab".repeat(32));
    expect(manualTokenMock).not.toHaveBeenCalled();
  });

  test("without a pairing the manual URL and token remain the active path", async () => {
    const config = await getRemoteDoorConfig();
    expect(config).toEqual({
      url: "https://manual.example:8000",
      pairedCredential: null,
      source: "manual",
    });
    await expect(getRemoteDoorToken(config)).resolves.toBe("typed-token");
    expect(manualTokenMock).toHaveBeenCalledTimes(1);
  });
});
