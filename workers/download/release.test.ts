import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const HERE = __dirname;
const RELEASE = path.join(HERE, "scripts", "release.mjs");
const DEFAULT_MARKDOWN = path.resolve(HERE, "../../../kalsa-brain/docs/ALPHA-TESTERS.md");
const work = mkdtempSync(path.join(tmpdir(), "kalsa-release-test-"));
const installer = path.join(work, "Kalsa-alpha-0.0.1-windows.exe");
const installerBytes = "windows installer bytes\n";
writeFileSync(installer, installerBytes);

function release(args: string[], env: Record<string, string> = {}) {
  const res = spawnSync(process.execPath, [RELEASE, ...args], {
    encoding: "utf8",
    // An empty PATH makes any real `npx` call fail, so a dry run that reaches wrangler is caught.
    env: { PATH: "/nonexistent", ALPHA_TESTERS_MD: DEFAULT_MARKDOWN, ...env },
  });
  return { status: res.status, out: res.stdout + res.stderr };
}

afterAll(() => rmSync(work, { recursive: true, force: true }));

describe("release --dry-run", () => {
  test("prints the publish, read-back, manifest read and manifest write, and runs none of them", () => {
    const res = release(["windows", installer, "0.0.1", "--dry-run"]);
    expect(res.out).toContain(`npx wrangler r2 object put kalsa-downloads/releases/0.0.1/Kalsa-alpha-0.0.1-windows.exe --file ${installer} --remote`);
    expect(res.out).toContain("npx wrangler r2 object get kalsa-downloads/releases/0.0.1/Kalsa-alpha-0.0.1-windows.exe --remote --file");
    expect(res.out).toContain("npx wrangler r2 object get kalsa-downloads/current.json --remote --file");
    expect(res.out).toContain("npx wrangler r2 object put kalsa-downloads/current.json --file");
    expect(res.out).toContain("--content-type application/json");
    expect(res.out).toContain("dry run: nothing was run");
    expect({ status: res.status }).toEqual({ status: 0 });
  });

  test("the printed manifest entry carries the local size and sha256", () => {
    const res = release(["windows", installer, "0.0.1", "--dry-run"]);
    const sha = createHash("sha256").update(readFileSync(installer)).digest("hex");
    const size = Buffer.byteLength(installerBytes);
    expect(res.out).toContain(
      `windows = {"key":"releases/0.0.1/Kalsa-alpha-0.0.1-windows.exe","name":"Kalsa-alpha-0.0.1-windows.exe","size":${size},"sha256":"${sha}"}`,
    );
  });
});

describe("release rejects bad input before anything runs", () => {
  test("an unknown platform is a usage error", () => {
    expect(release(["linux", installer, "0.0.1", "--dry-run"]).status).toBe(2);
  });

  test.each(["0.0.1/../x", "v0.0.1", "0.0", "1.0.0-beta"])("version %s is refused", (version) => {
    const res = release(["windows", installer, version, "--dry-run"]);
    expect(res.status).toBe(1);
    expect(res.out).toContain("version must be X.Y.Z");
  });

  test("a file name with a space is refused", () => {
    const spaced = path.join(work, "Kalsa alpha.exe");
    writeFileSync(spaced, "x");
    const res = release(["windows", spaced, "0.0.1", "--dry-run"]);
    expect(res.status).toBe(1);
    expect(res.out).toContain("file name must be");
  });

  test("a missing file is refused", () => {
    expect(release(["windows", path.join(work, "absent.exe"), "0.0.1", "--dry-run"]).status).toBe(1);
  });
});

describe("the guide gate", () => {
  test("a markdown that does not match guide.ts stops the release", () => {
    const stale = path.join(work, "stale.md");
    writeFileSync(stale, "## 1. A different guide\n\nNot the committed one.\n");
    const res = release(["windows", installer, "0.0.1", "--dry-run"], { ALPHA_TESTERS_MD: stale });
    expect(res.status).toBe(1);
    expect(res.out).toContain("guide.ts is stale");
  });

  test("a missing markdown stops the release with a message naming the variable", () => {
    const res = release(["windows", installer, "0.0.1", "--dry-run"], {
      ALPHA_TESTERS_MD: path.join(work, "no-such-guide.md"),
    });
    expect(res.status).toBe(1);
    expect(res.out).toContain("set ALPHA_TESTERS_MD");
  });
});

describe("the key rule", () => {
  test("release.mjs and manifest.ts carry the same KEY pattern", () => {
    const pattern = (file: string) => {
      const match = /const KEY = (\/.*\/);/.exec(readFileSync(file, "utf8"));
      if (match === null) throw new Error(`no KEY pattern in ${file}`);
      return match[1];
    };
    expect(pattern(path.join(HERE, "scripts", "release.mjs"))).toBe(pattern(path.join(HERE, "manifest.ts")));
  });
});
