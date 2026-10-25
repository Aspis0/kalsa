import { spawnSync } from "node:child_process";

// The converter is plain .mjs, which jest does not load; its node:test file runs here.
test("the markdown converter's unit tests pass", () => {
  const res = spawnSync(process.execPath, ["--test", "scripts/markdown-subset.test.mjs"], {
    cwd: __dirname,
    encoding: "utf8",
  });
  expect({ status: res.status, output: (res.stdout + res.stderr).slice(-600) }).toMatchObject({ status: 0 });
});
