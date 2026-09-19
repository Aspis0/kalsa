/**
 * Source-text guard for session marker privacy: the payload shape lives in
 * closures inside LlamaService.ts, a module no Jest test may import because it
 * value-imports llama.rn. Until save-wiring-coverage extracts that orchestration,
 * this is the only guard available. That behavior test replaces this guard
 * when the extraction lands; it must not be kept alongside it.
 * The narrow pair asserts the fix; the wider scan asserts the rule for every
 * session marker.
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
  if (allSessionPayloads.length < 5) {
    throw new Error(
      `expected at least five KALSA_SESSION payload literals, found ${allSessionPayloads.length}`,
    );
  }
  for (const payload of allSessionPayloads) {
    expect(payload).not.toMatch(/\bstem\s*:/);
  }
  expect(llamaServiceSource).not.toMatch(/\blogStem\b/);
});
