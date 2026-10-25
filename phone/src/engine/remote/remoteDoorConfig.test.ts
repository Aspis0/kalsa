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
      localId: "p-lid-a",
      doorUrl: "https://paired.tailnet.ts.net:9443",
      credential: "ab".repeat(32),
      node: null,
      pairedVia: null,
      roomId: null,
    });
    const config = await getRemoteDoorConfig();

    expect(config).toEqual({
      url: "https://paired.tailnet.ts.net:9443",
      pairedCredential: "ab".repeat(32),
      node: null,
      pairedVia: null,
      source: "pairing",
      pairing: { localId: "p-lid-a", removed: false },
    });
    expect(config.url).not.toBe(getRemoteBrainUrl());
    await expect(getRemoteDoorToken(config)).resolves.toBe("ab".repeat(32));
    expect(manualTokenMock).not.toHaveBeenCalled();
  });

  test("the paired iroh node and pairing road ride the config so the door road can choose", async () => {
    const node = "cd".repeat(32);
    pairedMock.mockResolvedValue({
      localId: "p-lid-b",
      doorUrl: "https://paired.tailnet.ts.net:9443",
      credential: "ab".repeat(32),
      node,
      pairedVia: "iroh",
      roomId: null,
    });
    const config = await getRemoteDoorConfig();
    expect(config.node).toBe(node);
    expect(config.pairedVia).toBe("iroh");
  });

  test("a record the room already refused rides the door as removed", async () => {
    pairedMock.mockResolvedValue({
      localId: "p-lid-c",
      doorUrl: "https://paired.tailnet.ts.net:9443",
      credential: "ab".repeat(32),
      node: null,
      pairedVia: null,
      roomId: "1f0a3b9c2d4e5f60718293a4b5c6d7e8",
      removed: true,
    });
    const config = await getRemoteDoorConfig();
    expect(config.pairing).toEqual({ localId: "p-lid-c", removed: true });
  });

  test("without a pairing the manual URL and token remain the active path", async () => {
    const config = await getRemoteDoorConfig();
    expect(config).toEqual({
      url: "https://manual.example:8000",
      pairedCredential: null,
      node: null,
      pairedVia: null,
      source: "manual",
      pairing: null,
    });
    await expect(getRemoteDoorToken(config)).resolves.toBe("typed-token");
    expect(manualTokenMock).toHaveBeenCalledTimes(1);
  });
});
