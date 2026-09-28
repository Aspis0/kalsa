const mockGetItemAsync = jest.fn();
const mockSetItemAsync = jest.fn();
const mockGetRandomBytes = jest.fn();

jest.mock("expo-secure-store", () => ({
  getItemAsync: mockGetItemAsync,
  setItemAsync: mockSetItemAsync,
}));
jest.mock("expo-crypto", () => ({
  getRandomBytes: (length: number) => mockGetRandomBytes(length),
}));

const INSTALL_KEY = "kalsa.pairing.install_id.v1";
const loadPairingInstallId = () => {
  let module!: typeof import("./pairingInstallId");
  jest.isolateModules(() => {
    module = require("./pairingInstallId") as typeof import("./pairingInstallId");
  });
  return module;
};

describe("pairing install id", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetItemAsync.mockResolvedValue(null);
    mockSetItemAsync.mockResolvedValue(undefined);
    mockGetRandomBytes.mockImplementation((length: number) => new Uint8Array(length).fill(0x11));
  });

  test("vector F derives the first 16 HMAC bytes from the node's ASCII hex", () => {
    const { derivePairingInstallId } = loadPairingInstallId();
    expect(derivePairingInstallId(new Uint8Array(16).fill(0x11), "22".repeat(32)))
      .toBe("14fa2e35fc2d329875fe3d73b6f101dd");
  });

  test("mints once, persists in SecureStore, and reuses the secret for each node", async () => {
    const { getPairingInstallId } = loadPairingInstallId();
    const secretHex = "11".repeat(16);
    const firstNode = "22".repeat(32);
    const secondNode = "33".repeat(32);
    const methods: Array<"log" | "info" | "warn" | "error" | "debug"> = [
      "log", "info", "warn", "error", "debug",
    ];
    const logSpies = methods.map((method) =>
      jest.spyOn(console, method).mockImplementation(() => undefined),
    );
    const firstId = await getPairingInstallId(firstNode);
    const repeatedId = await getPairingInstallId(firstNode);
    const secondId = await getPairingInstallId(secondNode);

    expect(firstId).toBe("14fa2e35fc2d329875fe3d73b6f101dd");
    expect(repeatedId).toBe(firstId);
    expect(secondId).not.toBe(firstId);
    expect(mockGetItemAsync).toHaveBeenCalledTimes(1);
    expect(mockGetItemAsync).toHaveBeenCalledWith(INSTALL_KEY);
    expect(mockGetRandomBytes).toHaveBeenCalledTimes(1);
    expect(mockGetRandomBytes).toHaveBeenCalledWith(16);
    expect(mockSetItemAsync).toHaveBeenCalledTimes(1);
    expect(mockSetItemAsync).toHaveBeenCalledWith(INSTALL_KEY, secretHex);

    const logged = JSON.stringify(logSpies.flatMap((spy) => spy.mock.calls));
    expect(logged).not.toContain(secretHex);
    expect(logged).not.toContain(firstId);
    for (const spy of logSpies) spy.mockRestore();
  });

  test("loads a saved install secret without minting or replacing it", async () => {
    const { derivePairingInstallId, getPairingInstallId } = loadPairingInstallId();
    mockGetItemAsync.mockResolvedValue("44".repeat(16));
    const expected = derivePairingInstallId(new Uint8Array(16).fill(0x44), "22".repeat(32));

    await expect(getPairingInstallId("22".repeat(32))).resolves.toBe(expected);
    expect(mockGetRandomBytes).not.toHaveBeenCalled();
    expect(mockSetItemAsync).not.toHaveBeenCalled();
  });
});
