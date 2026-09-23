import * as SecureStore from "expo-secure-store";
import { getRemoteBrainToken, setRemoteBrainToken } from "./remoteSecret";

jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

const mocked = SecureStore as jest.Mocked<typeof SecureStore>;

describe("remoteSecret", () => {
  beforeEach(() => {
    mocked.getItemAsync.mockReset();
    mocked.setItemAsync.mockReset();
    mocked.deleteItemAsync.mockReset();
  });

  test("missing key is null", async () => {
    mocked.getItemAsync.mockResolvedValue(null);
    await expect(getRemoteBrainToken()).resolves.toBeNull();
  });

  test("not-found errors are null", async () => {
    mocked.getItemAsync.mockRejectedValue(new Error("Item could not be found"));
    await expect(getRemoteBrainToken()).resolves.toBeNull();
  });

  test("other SecureStore failures throw", async () => {
    mocked.getItemAsync.mockRejectedValue(new Error("disk full"));
    await expect(getRemoteBrainToken()).rejects.toThrow("disk full");
  });

  test("empty token deletes", async () => {
    mocked.deleteItemAsync.mockResolvedValue();
    await setRemoteBrainToken("  ");
    expect(mocked.deleteItemAsync).toHaveBeenCalled();
    expect(mocked.setItemAsync).not.toHaveBeenCalled();
  });
});
