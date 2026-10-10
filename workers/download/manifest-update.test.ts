import { MAC, MAC_UPDATE, VERSION, WIN, entryFor, manifestJson, manifestWithUpdates, updateEntry } from "./fakes";
import { parseManifest, versionOfKey } from "./manifest";

describe("manifests without version or update still parse", () => {
  test("an old manifest keeps its installers and has no version or updates", () => {
    const m = parseManifest(manifestJson());
    expect(m.windows).toEqual(entryFor(WIN));
    expect(m.mac).toEqual(entryFor(MAC));
    expect(m.version).toBeNull();
    expect(m.updates).toEqual({ windows: null, mac: null });
  });

  test("an update without a version is not offered", () => {
    const m = parseManifest(manifestWithUpdates({ version: undefined }));
    expect(m.updates).toEqual({ windows: null, mac: null });
    expect(m.windows).toEqual(entryFor(WIN));
  });
});

describe("version", () => {
  test("a semver version is kept", () => {
    expect(parseManifest(manifestWithUpdates()).version).toBe(VERSION);
  });

  test("an invalid version is dropped and the installers still parse", () => {
    const m = parseManifest(manifestWithUpdates({ version: "v0.0.1" }));
    expect(m.version).toBeNull();
    expect(m.windows).toEqual(entryFor(WIN));
    expect(m.updates).toEqual({ windows: null, mac: null });
  });
});

describe("updates", () => {
  test("each platform's update is parsed with its signature", () => {
    const m = parseManifest(manifestWithUpdates());
    expect(m.updates.windows).toEqual(updateEntry(WIN));
    expect(m.updates.mac).toEqual(updateEntry(MAC_UPDATE));
  });

  test("the Windows update may be the installer itself", () => {
    const m = parseManifest(manifestWithUpdates());
    expect(m.updates.windows?.key).toBe(m.windows?.key);
  });

  test.each([
    ["an empty signature", ""],
    ["a signature with a space", "dGVz dA=="],
    ["a signature with a newline", "dGVz\ndA=="],
    ["a signature with a non-base64 character", "dGVz!dA=="],
    ["a signature over 4096 characters", "A".repeat(4097)],
    ["a missing signature", undefined],
  ])("%s drops the update and keeps the installer", (_label, signature) => {
    const update = { ...updateEntry(MAC_UPDATE), signature };
    const m = parseManifest(manifestWithUpdates({ macUpdate: update }));
    expect(m.updates.mac).toBeNull();
    expect(m.mac).toEqual(entryFor(MAC));
  });

  test("a signature of exactly 4096 characters is accepted", () => {
    const update = { ...updateEntry(MAC_UPDATE), signature: "A".repeat(4096) };
    expect(parseManifest(manifestWithUpdates({ macUpdate: update })).updates.mac?.signature).toHaveLength(4096);
  });

  test("an update whose key belongs to another version is not offered", () => {
    const other = { ...updateEntry(MAC_UPDATE), key: "releases/0.0.2/Kalsa-alpha-0.0.2-mac.app.tar.gz" };
    expect(parseManifest(manifestWithUpdates({ macUpdate: other })).updates.mac).toBeNull();
  });

  test("an update whose key is outside releases is not offered", () => {
    const outside = { ...updateEntry(MAC_UPDATE), key: "secret/x.tar.gz" };
    expect(parseManifest(manifestWithUpdates({ macUpdate: outside })).updates.mac).toBeNull();
  });

  test("the installer validation is unchanged by the update fields", () => {
    const badInstaller = { ...entryFor(MAC), sha256: "not-a-hash", update: updateEntry(MAC_UPDATE) };
    const m = parseManifest(JSON.stringify({ version: VERSION, windows: entryFor(WIN), mac: badInstaller }));
    expect(m.mac).toBeNull();
    expect(m.updates.mac).toEqual(updateEntry(MAC_UPDATE));
  });
});

describe("versionOfKey", () => {
  test("reads the version segment of a release key", () => {
    expect(versionOfKey("releases/0.0.1/Kalsa.exe")).toBe("0.0.1");
    expect(versionOfKey("secret")).toBeNull();
  });
});
