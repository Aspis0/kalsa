import fs from "fs";
import path from "path";

/**
 * Guards the llama.rn patch: keep recover-trim, refuse ctx_shift seq_add.
 * S23 2bbef14 T20C t4: K-shift then tokensCached=4304.
 */
const patch = fs.readFileSync(
  path.join(__dirname, "../../patches/llama.rn+0.12.8.patch"),
  "utf8",
);

describe("llama.rn K-shift refuse patch", () => {
  test("keeps skip_ckpt / recover_trim (pos_max 2360 vs 2973)", () => {
    expect(patch).toContain("KALSA_KVRESUME skip_ckpt");
    expect(patch).toContain("KALSA_KVRESUME recover_trim_failed");
    expect(patch).toContain("n_tokens=2360 pos_max=2973");
  });

  test("refuses nextToken seq_add K-shift", () => {
    expect(patch).toContain("KALSA_KVSHIFT refused embd=");
    expect(patch).toContain("KALSA_KVSHIFT refused prompt=");
    expect(patch).toMatch(/^-        llama_memory_seq_add\(kv, 0,/m);
    expect(patch).not.toMatch(/^\+        llama_memory_seq_add\(kv, 0,/m);
  });
});
