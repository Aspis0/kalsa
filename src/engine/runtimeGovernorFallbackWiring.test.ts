/**
 * Source-text guard for the runtime governor fallback wiring (A1): the catch
 * in streamAssistantTurn must defer to the pure decision, and the reload it
 * triggers must re-enter initEngine through the CPU-only cpuParams path.
 * LlamaService.ts value-imports llama.rn, so no Jest test can import it —
 * source text is the only reach available (style: kvShiftRefuse.test.ts).
 */
import fs from "fs";
import path from "path";

const source = fs.readFileSync(
  path.resolve(__dirname, "LlamaService.ts"),
  "utf8",
);

describe("runtime governor fallback wiring in LlamaService", () => {
  test("the turn catch defers to the decision and hands back the reason", () => {
    expect(source).toContain("shouldRuntimeGovernorFallback({");
    expect(source).toContain("return governorRuntimeFallbackReason(error);");
  });

  test("the reload runs through initEngine's CPU-only cpuParams path", () => {
    expect(source).toContain("await reloadGovernorRuntimeFallback(");
    expect(source).toContain("enabled: !governorRuntimeOff");
    expect(source).toContain("governorUsed = !governorRuntimeOff && !result.retried");
    expect(source).toContain("cpuParams.n_gpu_layers = 0;");
    expect(source).toContain("KALSA_GOVERNOR_RUNTIME_FALLBACK");
  });
});
