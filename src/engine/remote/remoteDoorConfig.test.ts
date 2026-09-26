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
      node: null,
    });
    const config = await getRemoteDoorConfig();

    expect(config).toEqual({
      url: "https://paired.tailnet.ts.net:9443",
      pairedCredential: "ab".repeat(32),
      node: null,
      source: "pairing",
    });
    expect(config.url).not.toBe(getRemoteBrainUrl());
    await expect(getRemoteDoorToken(config)).resolves.toBe("ab".repeat(32));
    expect(manualTokenMock).not.toHaveBeenCalled();
  });

  test("the paired iroh node rides the config so the door road can choose it", async () => {
    const node = "cd".repeat(32);
    pairedMock.mockResolvedValue({
      doorUrl: "https://paired.tailnet.ts.net:9443",
      credential: "ab".repeat(32),
      node,
    });
    const config = await getRemoteDoorConfig();
    expect(config.node).toBe(node);
  });

  test("without a pairing the manual URL and token remain the active path", async () => {
    const config = await getRemoteDoorConfig();
    expect(config).toEqual({
      url: "https://manual.example:8000",
      pairedCredential: null,
      node: null,
      source: "manual",
    });
    await expect(getRemoteDoorToken(config)).resolves.toBe("typed-token");
    expect(manualTokenMock).toHaveBeenCalledTimes(1);
  });
});
