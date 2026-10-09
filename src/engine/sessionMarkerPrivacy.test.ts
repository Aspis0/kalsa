/**
 * Source-text guards for LlamaService session wiring: the payload shape lives
 * in closures inside LlamaService.ts, a module no Jest test may import because it
 * value-imports llama.rn. Until save-wiring-coverage extracts that orchestration,
 * this is the only guard available. That behavior test replaces this guard
 * when the extraction lands; it must not be kept alongside it.
 * The narrow pair asserts the fix; the wider scan checks every template or
 * fixed-string KALSA_SESSION payload in this file.
 */

import fs from "fs";
import path from "path";

const llamaServiceSource = fs.readFileSync(
  path.resolve(__dirname, "LlamaService.ts"),
  "utf8",
);

const sessionPayloads = [
  ...llamaServiceSource.matchAll(
    /KALSA_SESSION \$\{JSON\.stringify\(\{\s*(?:op,\s*ms:|op: "load",\s*ms:)[\s\S]*?\}\)\}`/g,
  ),
].map((match) => match[0]);

const allSessionPayloads = [
  ...llamaServiceSource.matchAll(
    /KALSA_SESSION \$\{JSON\.stringify\(\{[\s\S]*?\}\)\}`/g,
  ),
  ...llamaServiceSource.matchAll(/KALSA_SESSION \{[^}\n]*\}/g),
].map((match) => match[0]);

test("save and load session payloads stay hash-only", () => {
  if (sessionPayloads.length !== 2) {
    throw new Error(
      `expected exactly two save/load KALSA_SESSION payload literals, found ${sessionPayloads.length}`,
    );
  }
  for (const payload of sessionPayloads) {
    expect(payload).not.toMatch(/\bstem\s*:/);
    expect(payload).not.toMatch(/\bhash\s*:/);
    expect(payload).toMatch(/\bstemHash\s*:/);
  }
  if (allSessionPayloads.length < 7) {
    throw new Error(
      `expected at least seven KALSA_SESSION payload literals, found ${allSessionPayloads.length}`,
    );
  }
  for (const payload of allSessionPayloads) {
    expect(payload).not.toMatch(/\bstem\s*:/);
  }
  expect(llamaServiceSource).not.toMatch(/\blogStem\b/);
  expect(llamaServiceSource.match(/logStemHash = historyHash\(/g)).toHaveLength(3);
  // The warning prints the telemetry-safe CLASS from `sessionErrorReason`,
  // never the error or the payload, and it goes through the shared
  // once-per-process warner for both session operations.
  expect(
    llamaServiceSource.match(/const reason = sessionErrorReason\(error\);/g),
  ).toHaveLength(2);
  expect(llamaServiceSource).toMatch(
    /warnUnexpectedSessionFailure\("\[saveEngineSession\]", reason\)/,
  );
  expect(llamaServiceSource).toMatch(
    /warnUnexpectedSessionFailure\("\[tryLoadEngineSession\]", reason\)/,
  );
  expect(llamaServiceSource).not.toMatch(
    /warnUnexpectedSessionFailure\([^)]*error/,
  );
});

test("restoreEngineSession reaches the native load under the governor", () => {
  // No governor early return before withLifecycleLock: the refusal must
  // travel tryLoadEngineSession's failure path, which drops the hold and
  // resets the baked tails — the chat-switch state conversation B's first
  // send depends on. An early return leaves conversation A's hold across
  // the switch and B's send then reconciles (and discards B's .kvs).
  const fnStart = llamaServiceSource.indexOf(
    "export async function restoreEngineSession",
  );
  if (fnStart < 0) throw new Error("restoreEngineSession not found");
  const lockAt = llamaServiceSource.indexOf("withLifecycleLock", fnStart);
  if (lockAt < 0) {
    throw new Error("restoreEngineSession no longer takes the lifecycle lock");
  }
  const loadAt = llamaServiceSource.indexOf("return tryLoadEngineSession", fnStart);
  if (loadAt < 0) {
    throw new Error("restoreEngineSession no longer calls tryLoadEngineSession");
  }
  const preamble = llamaServiceSource.slice(fnStart, loadAt);
  expect(preamble).not.toMatch(/activeGovernorActive/);
  expect(preamble).not.toMatch(/logGovernorSessionSkip/);
});
