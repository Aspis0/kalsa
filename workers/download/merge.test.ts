import { spawnSync } from "node:child_process";

// The merge rule is plain .mjs, which jest does not load; its node:test file runs here.
test("the release manifest merge rule passes its unit tests", () => {
  const res = spawnSync(process.execPath, ["--test", "scripts/merge-manifest.test.mjs"], {
    cwd: __dirname,
    encoding: "utf8",
  });
  expect({ status: res.status, output: (res.stdout + res.stderr).slice(-600) }).toMatchObject({ status: 0 });
});
