import { MANIFEST_KEY, parseManifest, readManifest } from "./manifest";
import { MAC, WIN, entryFor, fakeBucket, manifestJson, sha256Hex } from "./fakes";

describe("manifest parsing", () => {
  test("accepts both installers as written", () => {
    const m = parseManifest(manifestJson());
    expect(m.windows).toEqual(entryFor(WIN));
    expect(m.mac).toEqual(entryFor(MAC));
  });

  test("a missing or non-JSON manifest yields no installers", () => {
    expect(parseManifest(null)).toEqual({ windows: null, mac: null });
    expect(parseManifest("{not json")).toEqual({ windows: null, mac: null });
    expect(parseManifest("[]")).toEqual({ windows: null, mac: null });
  });

  test("each platform is validated on its own", () => {
    const good = entryFor(WIN);
    const bad = { ...good, sha256: "A".repeat(64) };
    const m = parseManifest(manifestJson({ windows: bad, mac: good }));
    expect(m.windows).toBeNull();
    expect(m.mac).toEqual(good);
  });

  test.each([
    ["a plain key outside releases", { key: "secret" }],
    ["a key under another prefix", { key: "internal/config.json" }],
    ["releases without a version", { key: "releases/x" }],
    ["a dot-dot version segment", { key: "releases/../x/Kalsa.exe" }],
    ["a dot-dot name segment", { key: "releases/1.0.0/..exe" }],
    ["a traversal-looking key", { key: "releases/../secret" }],
    ["a key with a space", { key: "releases/1.0.0/a b.exe" }],
    ["a key with a leading slash", { key: "/releases/1.0.0/a.exe" }],
    ["a name starting with a dot", { name: ".hidden.exe" }],
    ["name with a quote", { name: 'x"; evil' }],
    ["name with a newline", { name: "x\ny.exe" }],
    ["zero size", { size: 0 }],
    ["fractional size", { size: 1.5 }],
    ["size as a string", { size: "100" }],
    ["short sha256", { sha256: "a".repeat(63) }],
    ["uppercase sha256", { sha256: "A".repeat(64) }],
    ["non-hex sha256", { sha256: "g".repeat(64) }],
  ])("rejects %s", (_label, override) => {
    const m = parseManifest(manifestJson({ windows: { ...entryFor(WIN), ...override } }));
    expect(m.windows).toBeNull();
  });

  test("a non-object platform entry yields no installer", () => {
    expect(parseManifest(manifestJson({ windows: "windows.exe" })).windows).toBeNull();
    expect(parseManifest(manifestJson({ windows: null })).windows).toBeNull();
  });
});

describe("manifest read", () => {
  test("readManifest reads current.json from the bucket", async () => {
    const m = await readManifest(fakeBucket({ [MANIFEST_KEY]: manifestJson() }));
    expect(m.windows?.sha256).toBe(sha256Hex(WIN.bytes));
  });

  test("an absent manifest object yields no installers", async () => {
    expect(await readManifest(fakeBucket({}))).toEqual({ windows: null, mac: null });
  });
});
