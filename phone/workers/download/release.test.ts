import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const HERE = __dirname;
const RELEASE = path.join(HERE, "scripts", "release.mjs");
const BUILD_GUIDE = path.join(HERE, "scripts", "build-guide.mjs");
const work = mkdtempSync(path.join(tmpdir(), "kalsa-release-test-"));
// A synthetic tester guide, EN and IT with the same section shape: CI checks out
// this repo alone, so the real guide in kalsa-brain is not there to read.
const DEFAULT_MARKDOWN = path.join(work, "ALPHA-TESTERS.md");
const SECTION_TITLES = ["Requirements", "Mac", "Windows", "First start", "Phone", "Problems", "Download", "Uninstall"];
writeFileSync(
  DEFAULT_MARKDOWN,
  `# Tester guide\n\n${SECTION_TITLES.map((title, i) => `## ${i + 1}. ${title}\n\nPlaceholder ${i + 1}.\n`).join("\n")}`,
);
writeFileSync(
  path.join(work, "ALPHA-TESTERS.it.md"),
  `# Guida\n\n${SECTION_TITLES.map((title, i) => `## ${i + 1}. ${title}\n\nSegnaposto ${i + 1}.\n`).join("\n")}`,
);
// The gate compares the markdown with a guide module, so the module is built from the same pair.
const GUIDE_MODULE = path.join(work, "guide.ts");
spawnSync(process.execPath, [BUILD_GUIDE, DEFAULT_MARKDOWN, "--out", GUIDE_MODULE]);
const installer = path.join(work, "Kalsa-alpha-0.0.1-mac.dmg");
const installerBytes = "mac installer bytes\n";
writeFileSync(installer, installerBytes);
const artifact = path.join(work, "Kalsa-alpha-0.0.1-mac.app.tar.gz");
writeFileSync(artifact, "mac updater archive\n");
/** A signature file as the Tauri CLI writes it: base64 of a minisign file whose trusted comment names the version. */
function signatureFile(version: string): string {
  const minisign = [
    "untrusted comment: signature from tauri secret key",
    "RUQAAAAfake",
    `trusted comment: timestamp:1700000000\tfile:Kalsa-alpha-0.0.1-mac.app.tar.gz\tversion:${version}`,
    "ZmFrZQ==",
    "",
  ].join("\n");
  return Buffer.from(minisign).toString("base64");
}
const sig = path.join(work, "Kalsa-alpha-0.0.1-mac.app.tar.gz.sig");
writeFileSync(sig, `${signatureFile("0.0.1")}\n`);

// Stands in for `npx`: logs every call; answers the current.json read from FAKE_MANIFEST.
const fakeBin = path.join(work, "bin");
mkdirSync(fakeBin);
const fakeNpx = path.join(fakeBin, "npx");
writeFileSync(
  fakeNpx,
  `#!${process.execPath}
const { appendFileSync, writeFileSync } = require("node:fs");
const args = process.argv.slice(2);
appendFileSync(process.env.FAKE_LOG, args.join(" ") + "\\n");
const isManifestRead = args.includes("get") && args.some((arg) => arg.endsWith("/current.json"));
if (!isManifestRead) process.exit(0);
if (process.env.FAKE_MANIFEST_MISSING) {
  console.error("object not found");
  process.exit(1);
}
writeFileSync(args[args.indexOf("--file") + 1], process.env.FAKE_MANIFEST);
`,
);
chmodSync(fakeNpx, 0o755);

let calls = 0;
function release(args: string[], env: Record<string, string> = {}) {
  const log = path.join(work, `calls-${calls++}.log`);
  const res = spawnSync(process.execPath, [RELEASE, ...args], {
    encoding: "utf8",
    env: { PATH: fakeBin, ALPHA_TESTERS_MD: DEFAULT_MARKDOWN, GUIDE_TS: GUIDE_MODULE, FAKE_LOG: log, FAKE_MANIFEST: "{}", ...env },
  });
  return { status: res.status, out: res.stdout + res.stderr, log: existsSync(log) ? readFileSync(log, "utf8") : "" };
}

/** A complete mac release command; `overrides` swaps single arguments. */
function mac(overrides: { installer?: string; version?: string; update?: string; sig?: string; extra?: string[] } = {}) {
  return [
    "mac",
    overrides.installer ?? installer,
    overrides.version ?? "0.0.1",
    "--update",
    overrides.update ?? artifact,
    "--sig",
    overrides.sig ?? sig,
    "--dry-run",
    ...(overrides.extra ?? []),
  ];
}

afterAll(() => rmSync(work, { recursive: true, force: true }));

describe("release --dry-run", () => {
  test("prints both publishes, both read-backs and the manifest write, uploads nothing, and reads current.json", () => {
    const res = release(mac());
    expect(res.out).toContain(`npx wrangler r2 object put kalsa-installers/releases/0.0.1/Kalsa-alpha-0.0.1-mac.dmg --file ${installer} --remote`);
    expect(res.out).toContain(`npx wrangler r2 object put kalsa-installers/releases/0.0.1/Kalsa-alpha-0.0.1-mac.app.tar.gz --file ${artifact} --remote`);
    expect(res.out).toContain("npx wrangler r2 object get kalsa-installers/releases/0.0.1/Kalsa-alpha-0.0.1-mac.app.tar.gz --remote --file");
    expect(res.out).toContain("npx wrangler r2 object put kalsa-installers/current.json --file");
    expect(res.out).toContain("dry run: no upload was made");
    expect(res.status).toBe(0);
    expect(res.log).toContain("object get kalsa-installers/current.json --remote --file");
    expect(res.log).not.toMatch(/object put/);
    expect(res.log).not.toMatch(/releases\/0\.0\.1\/Kalsa-alpha-0\.0\.1-mac/);
  });

  test("the would-write manifest carries the installer, the update and its signature", () => {
    const res = release(mac());
    const sha = createHash("sha256").update(readFileSync(installer)).digest("hex");
    const size = Buffer.byteLength(installerBytes);
    const artifactSha = createHash("sha256").update(readFileSync(artifact)).digest("hex");
    const artifactSize = Buffer.byteLength("mac updater archive\n");
    expect(res.out).toContain(
      `"mac":{"key":"releases/0.0.1/Kalsa-alpha-0.0.1-mac.dmg","name":"Kalsa-alpha-0.0.1-mac.dmg","size":${size},"sha256":"${sha}","update":{"key":"releases/0.0.1/Kalsa-alpha-0.0.1-mac.app.tar.gz","name":"Kalsa-alpha-0.0.1-mac.app.tar.gz","size":${artifactSize},"sha256":"${artifactSha}","signature":"${signatureFile("0.0.1")}"}}`,
    );
  });

  test("a Windows update with the installer's own name is published once", () => {
    const exe = path.join(work, "Kalsa-alpha-0.0.1-windows.exe");
    writeFileSync(exe, "windows bytes");
    const res = release(["windows", exe, "0.0.1", "--update", exe, "--sig", sig, "--dry-run"]);
    expect(res.status).toBe(0);
    expect(res.out.match(/object put kalsa-installers\/releases\/0.0.1\/Kalsa-alpha-0.0.1-windows.exe/g)).toHaveLength(1);
  });

  test("a Windows update with the installer's name but other bytes is refused", () => {
    const exe = path.join(work, "Kalsa-alpha-0.0.1-windows.exe");
    writeFileSync(exe, "windows bytes");
    const other = path.join(work, "other", "Kalsa-alpha-0.0.1-windows.exe");
    mkdirSync(path.dirname(other), { recursive: true });
    writeFileSync(other, "different bytes");
    const res = release(["windows", exe, "0.0.1", "--update", other, "--sig", sig, "--dry-run"]);
    expect(res.status).toBe(1);
    expect(res.out).toContain("different bytes");
  });
});

describe("release --dry-run runs the version check on the current manifest", () => {
  test("another platform on a different version is refused, as in a live run", () => {
    const current = JSON.stringify({ windows: { key: "releases/0.0.0/Kalsa-alpha-0.0.0-windows.exe", name: "Kalsa-alpha-0.0.0-windows.exe", size: 5, sha256: "a".repeat(64) } });
    const res = release(mac(), { FAKE_MANIFEST: current });
    expect(res.status).toBe(1);
    expect(res.out).toContain("--allow-mixed");
    expect(res.log).not.toMatch(/object put/);
  });

  test("with --allow-mixed the other platform keeps its installer, loses its update, and the write is printed", () => {
    const current = JSON.stringify({
      windows: { key: "releases/0.0.0/Kalsa-alpha-0.0.0-windows.exe", name: "Kalsa-alpha-0.0.0-windows.exe", size: 5, sha256: "a".repeat(64) },
    });
    const res = release(mac({ extra: ["--allow-mixed"] }), { FAKE_MANIFEST: current });
    expect(res.status).toBe(0);
    expect(res.out).toContain('"windows":{"key":"releases/0.0.0/Kalsa-alpha-0.0.0-windows.exe"');
    expect(res.out).not.toMatch(/"windows":\{[^}]*"update"/);
  });

  test("an unreadable current.json stops the dry run unless --new-manifest is given", () => {
    const res = release(mac(), { FAKE_MANIFEST_MISSING: "1" });
    expect(res.status).toBe(1);
    expect(res.out).toContain("--new-manifest");
  });

  test("an unreadable current.json with --new-manifest exits 0 and says the version check did not run", () => {
    const res = release(mac({ extra: ["--new-manifest"] }), { FAKE_MANIFEST_MISSING: "1" });
    expect(res.status).toBe(0);
    expect(res.out).toContain("could not be read here, so the version check did not run");
  });
});

describe("release rejects bad input before anything runs", () => {
  test("an unknown platform is a usage error", () => {
    expect(release(["linux", installer, "0.0.1", "--update", artifact, "--sig", sig, "--dry-run"]).status).toBe(2);
  });

  test("a missing --update or --sig is a usage error", () => {
    expect(release(["mac", installer, "0.0.1", "--sig", sig, "--dry-run"]).status).toBe(2);
    expect(release(["mac", installer, "0.0.1", "--update", artifact, "--dry-run"]).status).toBe(2);
  });

  test("an unknown flag is a usage error", () => {
    expect(release(mac({ extra: ["--bogus"] })).status).toBe(2);
  });

  test.each(["0.0.1/../x", "v0.0.1", "0.0", "01.2.3", "1.02.3"])("version %s is refused", (version) => {
    const res = release(mac({ version }));
    expect(res.status).toBe(1);
    expect(res.out).toContain("version must be");
  });

  test("build metadata passes the SemVer rule but cannot be part of a release key", () => {
    const res = release(mac({ version: "1.0.0+build" }));
    expect(res.status).toBe(1);
    expect(res.out).toContain("not allowed in a key");
  });

  test("a prerelease version is accepted, as the Worker accepts it", () => {
    const rc = path.join(work, "rc.sig");
    writeFileSync(rc, `${signatureFile("0.0.1-rc.1")}\n`);
    expect(release(mac({ version: "0.0.1-rc.1", sig: rc })).status).toBe(0);
  });

  test("a file name with a space is refused", () => {
    const spaced = path.join(work, "Kalsa alpha.dmg");
    writeFileSync(spaced, "x");
    const res = release(mac({ installer: spaced }));
    expect(res.status).toBe(1);
    expect(res.out).toContain("not allowed in a key");
  });

  test("a missing installer, artifact or signature file is refused", () => {
    expect(release(mac({ installer: path.join(work, "absent.dmg") })).status).toBe(1);
    expect(release(mac({ update: path.join(work, "absent.tar.gz") })).status).toBe(1);
    expect(release(mac({ sig: path.join(work, "absent.sig") })).status).toBe(1);
  });

  test.each([
    ["two lines", "dGVz\ndA=="],
    ["a space", "dGVz dA=="],
    ["a character outside base64", "dGVz!dA=="],
  ])("a signature with %s is refused", (_label, content) => {
    const bad = path.join(work, `bad-${content.length}.sig`);
    writeFileSync(bad, content);
    const res = release(mac({ sig: bad }));
    expect(res.status).toBe(1);
    expect(res.out).toContain("one base64 line");
  });
});

describe("the signature must name the release's version", () => {
  const signedFor = (version: string) => {
    const file = path.join(work, `signed-${version}.sig`);
    writeFileSync(file, `${signatureFile(version)}\n`);
    return file;
  };

  test("a signature for another version is refused before anything is uploaded, dry run or not", () => {
    const wrong = signedFor("0.0.0");
    const dry = release(mac({ sig: wrong }));
    expect(dry.status).toBe(1);
    expect(dry.out).toContain("is signed for version 0.0.0, but this release is 0.0.1");
    expect(dry.log).toBe("");
    const live = release(["mac", installer, "0.0.1", "--update", artifact, "--sig", wrong]);
    expect(live.status).toBe(1);
    expect(live.out).toContain("is signed for version 0.0.0");
    expect(live.log).toBe("");
  });

  test("a signature with no version in its trusted comment is refused", () => {
    const bare = path.join(work, "bare.sig");
    writeFileSync(bare, "dGVzdC1zaWduYXR1cmU=\n");
    const res = release(mac({ sig: bare }));
    expect(res.status).toBe(1);
    expect(res.out).toContain("has no version in its trusted comment");
    expect(res.log).toBe("");
  });
});

describe("release --notes", () => {
  const notesFile = (name: string, text: string) => {
    const file = path.join(work, name);
    writeFileSync(file, text);
    return file;
  };

  test("the notes are trimmed, CRLF becomes LF, and they are written with the release", () => {
    const file = notesFile("notes-crlf.txt", "  Fixed the calculator.\r\nFaster start.\r\n");
    const res = release(mac({ extra: ["--notes", file] }));
    expect(res.status).toBe(0);
    expect(res.out).toContain('"notes":"Fixed the calculator.\\nFaster start."');
  });

  test("600 characters are accepted, counted by code point", () => {
    expect(release(mac({ extra: ["--notes", notesFile("notes-600.txt", "🙂".repeat(600))] })).status).toBe(0);
  });

  test.each([
    ["an empty file", "  \n", "is empty"],
    ["a control character", "bad\u0007text", "line-separator character"],
    ["a tab", "a\tb", "line-separator character"],
    ["a right-to-left override", "fixed\u202Egnirts", "line-separator character"],
    ["a zero-width space", "a\u200Bb", "line-separator character"],
    ["a byte order mark inside the text", "a\uFEFFb", "line-separator character"],
    ["a line separator", "a\u2028b", "line-separator character"],
    ["601 characters", "x".repeat(601), "the limit is 600"],
  ])("%s is refused before anything is uploaded, dry run or not", (label, text, message) => {
    const file = notesFile(`notes-${label.replace(/ /g, "-")}.txt`, text);
    const dry = release(mac({ extra: ["--notes", file] }));
    expect(dry.status).toBe(1);
    expect(dry.out).toContain(message);
    expect(dry.log).toBe("");
    const live = release(["mac", installer, "0.0.1", "--update", artifact, "--sig", sig, "--notes", file]);
    expect(live.status).toBe(1);
    expect(live.out).toContain(message);
    expect(live.log).toBe("");
  });

  test("a notes file that does not exist is refused", () => {
    const res = release(mac({ extra: ["--notes", path.join(work, "absent-notes.txt")] }));
    expect(res.status).toBe(1);
    expect(res.out).toContain("not a file");
  });
});

describe("the guide gate", () => {
  test("a markdown that does not match guide.ts stops the release", () => {
    const stale = path.join(work, "stale.md");
    writeFileSync(stale, "## 1. A different guide\n\nNot the committed one.\n");
    const res = release(mac(), { ALPHA_TESTERS_MD: stale });
    expect(res.status).toBe(1);
    expect(res.out).toContain("guide.ts is stale");
  });

  test("a guide module that does not match the markdown stops the release", () => {
    const stale = path.join(work, "stale-guide.ts");
    writeFileSync(stale, "export const GUIDE_HTML = [];\n");
    const res = release(mac(), { GUIDE_TS: stale });
    expect(res.status).toBe(1);
    expect(res.out).toContain("guide.ts is stale");
  });

  test("a missing markdown stops the release with a message naming the variable", () => {
    const res = release(mac(), { ALPHA_TESTERS_MD: path.join(work, "no-such-guide.md") });
    expect(res.status).toBe(1);
    expect(res.out).toContain("set ALPHA_TESTERS_MD");
  });
});

describe("the shared rules", () => {
  const literal = (file: string, pattern: RegExp) => {
    const match = pattern.exec(readFileSync(file, "utf8"));
    if (match === null) throw new Error(`no pattern in ${file}`);
    return match[1];
  };

  test("release.mjs and manifest.ts carry the same KEY pattern", () => {
    expect(literal(path.join(HERE, "scripts", "release.mjs"), /const KEY = (\/.*\/);/)).toBe(
      literal(path.join(HERE, "manifest.ts"), /const KEY = (\/.*\/);/),
    );
  });

  test("release.mjs and manifest.ts carry the same NAME pattern", () => {
    expect(literal(path.join(HERE, "scripts", "release.mjs"), /const NAME = (\/.*\/);/)).toBe(
      literal(path.join(HERE, "manifest.ts"), /const NAME = (\/.*\/);/),
    );
  });

  test("release.mjs and semver.ts carry the same SemVer pattern", () => {
    expect(literal(path.join(HERE, "scripts", "release.mjs"), /const VERSION = (\/.*\/);/)).toBe(
      literal(path.join(HERE, "semver.ts"), /const SEMVER =\s*(\/.*\/);/),
    );
  });

  test("release.mjs and manifest.ts carry the same forbidden-character pattern", () => {
    expect(literal(path.join(HERE, "scripts", "release.mjs"), /const NOTES_FORBIDDEN = (\/.*\/);/)).toBe(
      literal(path.join(HERE, "manifest.ts"), /const NOTES_FORBIDDEN = (\/.*\/);/),
    );
  });

  test("release.mjs and manifest.ts carry the same notes limit", () => {
    expect(literal(path.join(HERE, "scripts", "release.mjs"), /const NOTES_MAX = (\d+);/)).toBe(
      literal(path.join(HERE, "manifest.ts"), /const NOTES_MAX = (\d+);/),
    );
  });
});
