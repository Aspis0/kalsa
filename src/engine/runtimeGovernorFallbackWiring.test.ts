/**
 * Source-text guard for the runtime governor fallback wiring (A1): the catch
 * in streamAssistantTurn must defer to the pure decision, the tool-exhausted
 * catch must hand governor rejections to the same decision, and the reload
 * must re-enter initEngine through the CPU-only cpuParams path whatever
 * governorLoad says. LlamaService.ts value-imports llama.rn, so no Jest test
 * can import it — source text is the only reach available (style:
 * kvShiftRefuse.test.ts).
 */
import fs from "fs";
import path from "path";

const source = fs.readFileSync(
  path.resolve(__dirname, "LlamaService.ts"),
  "utf8",
);

describe("runtime governor fallback wiring in LlamaService", () => {
  test("the turn catch defers to the decision and hands the attempt over", () => {
    expect(source).toContain("shouldRuntimeGovernorFallback({");
    expect(source).toContain("reason: runtimeFallbackReason,");
    expect(source).toContain("turnToken: turnTokenSeq,");
  });

  test("the tool-exhausted catch hands governor rejections to the decision", () => {
    expect(
      source.match(/shouldRuntimeGovernorFallback\(\{/g) ?? [],
    ).toHaveLength(2);
    expect(source).toContain("throw fallbackError;");
  });

  test("the continuation gates the retry and clears the failed partial", () => {
    expect(source).toContain("mayRetryRuntimeGovernorFallback({");
    expect(source).toContain('callbacks.onDelta("", "");');
  });

  test("the reload re-enters initEngine's CPU-only cpuParams path", () => {
    expect(source).toContain("await reloadGovernorRuntimeFallback(");
    expect(source).toContain("enabled: !governorRuntimeOff");
    expect(source).toContain("governorUsed = !governorRuntimeOff && !result.retried");
    expect(source).toContain("cpuParams.n_gpu_layers = 0;");
    expect(source).toContain("KALSA_GOVERNOR_RUNTIME_FALLBACK");
  });

  test("the CPU-only choice does not depend on governorLoad", () => {
    expect(
      source.match(/if \(governorLoad \|\| governorRuntimeOff\) \{/g) ?? [],
    ).toHaveLength(2);
  });

  // Shape only: this pins ORDER of substrings, not that the increment really
  // runs before any context/null check — no Jest test can execute it.
  test("the turn token advances at send entry, before the engine job", () => {
    const entry = source.indexOf("export async function streamAssistantTurn(");
    const bump = source.indexOf("turnTokenSeq += 1;", entry);
    const job = source.indexOf("withEngineJob(", entry);
    expect(entry).toBeGreaterThan(-1);
    expect(bump).toBeGreaterThan(entry);
    expect(bump).toBeLessThan(job);
    expect((source.match(/turnTokenSeq \+= 1;/g) ?? [])).toHaveLength(1);
  });
});
