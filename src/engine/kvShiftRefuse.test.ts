import fs from "fs";
import path from "path";

/**
 * Guards the K-shift policy in the engine we ship: keep recover-trim, refuse
 * ctx_shift seq_add. S23 2bbef14 T20C t4: K-shift then tokensCached=4304.
 *
 * The behaviour used to be asserted on patches/llama.rn+0.12.8.patch. Since the
 * engine is a git dependency on Aspis0/llama.rn there is no patch to read: the
 * subject is the installed source itself, which is a stronger check — a patch
 * can be correct and never applied.
 */
const source = fs.readFileSync(
  path.join(__dirname, "../../node_modules/llama.rn/cpp/rn-completion.cpp"),
  "utf8",
);

describe("K-shift refuse, in the shipped engine", () => {
  test("keeps skip_ckpt / recover_trim (pos_max 2360 vs 2973)", () => {
    expect(source).toContain("KALSA_KVRESUME skip_ckpt");
    expect(source).toContain("KALSA_KVRESUME recover_trim_failed");
    expect(source).toContain("n_tokens=2360 pos_max=2973");
  });

  test("refuses nextToken seq_add K-shift", () => {
    expect(source).toContain("KALSA_KVSHIFT refused embd=");
    expect(source).toContain("KALSA_KVSHIFT refused prompt=");
    // Anchored like the assertion it replaces (`-        llama_memory_seq_add(kv, 0,`):
    // an unanchored match would fail on any future legitimate use in this file.
    expect(source).not.toMatch(/llama_memory_seq_add\s*\(\s*kv\s*,/);
  });
});
