import { MIN_KEY_LENGTH } from "./keys";
import { artifactUrl, installerPath, linkBase, parseRoute } from "./routes";

const KEY = "a".repeat(MIN_KEY_LENGTH);
const UKEY = "u".repeat(MIN_KEY_LENGTH);

describe("tester link paths", () => {
  test("a keyed page path, with or without its trailing slash", () => {
    expect(parseRoute(`/download/${KEY}`)).toEqual({ route: { kind: "page" }, scope: "link", candidate: KEY });
    expect(parseRoute(`/download/${KEY}/`)).toEqual({ route: { kind: "page" }, scope: "link", candidate: KEY });
  });

  test("the two keyed installer paths", () => {
    expect(parseRoute(`/download/${KEY}/windows`)).toEqual({
      route: { kind: "installer", platform: "windows" },
      scope: "link",
      candidate: KEY,
    });
    expect(parseRoute(`/download/${KEY}/mac`)).toEqual({
      route: { kind: "installer", platform: "mac" },
      scope: "link",
      candidate: KEY,
    });
  });

  test("an unkeyed installer path parses as a page under the key 'windows', which admission rejects", () => {
    expect(parseRoute("/download/windows")).toEqual({ route: { kind: "page" }, scope: "link", candidate: "windows" });
  });

  test.each([
    ["the unkeyed page", "/download"],
    ["the unkeyed page with a slash", "/download/"],
    ["an installer with a trailing slash", `/download/${KEY}/windows/`],
    ["an unknown platform", `/download/${KEY}/linux`],
    ["extra segments", `/download/${KEY}/windows/extra`],
    ["an empty key", "/download//windows"],
    ["another prefix", `/downloads/${KEY}`],
    ["no download segment", `/${KEY}`],
    ["the root", "/"],
  ])("%s is not a link path", (_label, pathname) => {
    expect(parseRoute(pathname)).toBeNull();
  });

  test("links are built from the key alone", () => {
    expect(linkBase(KEY)).toBe(`/download/${KEY}`);
    expect(installerPath(KEY, "mac")).toBe(`/download/${KEY}/mac`);
  });
});

describe("updater paths", () => {
  test("the update check: target, arch and current version, under the update scope", () => {
    expect(parseRoute(`/download/update/${UKEY}/darwin/aarch64/0.0.0`)).toEqual({
      route: { kind: "update-check", target: "darwin", arch: "aarch64", current: "0.0.0" },
      scope: "update",
      candidate: UKEY,
    });
  });

  test("the artifact, for each platform", () => {
    expect(parseRoute(`/download/update/${UKEY}/artifact/mac`)).toEqual({
      route: { kind: "artifact", platform: "mac" },
      scope: "update",
      candidate: UKEY,
    });
    expect(parseRoute(`/download/update/${UKEY}/artifact/windows`)?.route).toEqual({
      kind: "artifact",
      platform: "windows",
    });
  });

  test("the update word is never read as a link key", () => {
    expect(parseRoute(`/download/update/${KEY}/windows`)).toBeNull();
    expect(parseRoute(`/download/update/${UKEY}/windows`)).toBeNull();
    expect(parseRoute(`/download/update/${UKEY}/darwin/aarch64/0.0.0`)?.scope).toBe("update");
  });

  test.each([
    ["the update root", "/download/update"],
    ["the update root with a slash", "/download/update/"],
    ["an empty update key", "/download/update//darwin/aarch64/0.0.0"],
    ["a check with a trailing slash", `/download/update/${UKEY}/darwin/aarch64/0.0.0/`],
    ["a check with an empty version", `/download/update/${UKEY}/darwin/aarch64/`],
    ["a check with extra segments", `/download/update/${UKEY}/darwin/aarch64/0.0.0/x`],
    ["an artifact for an unknown platform", `/download/update/${UKEY}/artifact/linux`],
    ["an artifact without a platform", `/download/update/${UKEY}/artifact`],
    ["an artifact with a trailing slash", `/download/update/${UKEY}/artifact/mac/`],
    ["an artifact with extra segments", `/download/update/${UKEY}/artifact/mac/x`],
  ])("%s is not an updater path", (_label, pathname) => {
    expect(parseRoute(pathname)).toBeNull();
  });

  test("the artifact URL the updater is given is absolute and keyed", () => {
    expect(artifactUrl(UKEY, "mac")).toBe(`https://kalsa.io/download/update/${UKEY}/artifact/mac`);
  });
});
