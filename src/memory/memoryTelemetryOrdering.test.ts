/**
 * Ordering test: proves that memory telemetry counters survive a slow extract job.
 *
 * The bug: extractJob is fire-and-forget and takes tens of seconds. The turn-end
 * snapshot (getAndResetMemoryTelemetry) fires BEFORE extraction completes, so it
 * always sees zeros. The extraction results land in the accumulator AFTER the
 * snapshot, then get discarded by the next turn's reset.
 *
 * The fix: emit a second telemetry line (KALSA_MEMORY_EXTRACT) when the extract
 * job completes, using snapshotMemoryTelemetry() which doesn't reset the accumulator.
 *
 * This test simulates the slow extract scenario and verifies counters are observable.
 */

jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => undefined),
    removeItem: jest.fn(async () => undefined),
  },
}));

import {
  trackMemoryEnabled,
  trackMemoryParseOutcome,
  trackMemoryInjection,
  getAndResetMemoryTelemetry,
  snapshotMemoryTelemetry,
  applyExtractResults,
  getEpoch,
  setEnabled,
} from "./MemoryStore";

describe("memory telemetry ordering", () => {
  beforeEach(async () => {
    // Reset state before each test
    await setEnabled(false);
    getAndResetMemoryTelemetry(); // Clear accumulator
  });

  test("slow extract job: counters survive past the turn-end snapshot", async () => {
    // Simulate turn-end: enable memory and inject facts
    trackMemoryEnabled(true);
    trackMemoryInjection(5);

    // Take turn-end snapshot (this resets the accumulator)
    const turnEndSnapshot = getAndResetMemoryTelemetry();

    // Turn-end snapshot should show memory enabled and injected, but NO extraction yet
    expect(turnEndSnapshot.memoryEnabled).toBe(1);
    expect(turnEndSnapshot.factsInjected).toBe(5);
    expect(turnEndSnapshot.extractParseOutcome).toBe(0);
    expect(turnEndSnapshot.factsExtracted).toBe(0);
    expect(turnEndSnapshot.factsStored).toBe(0);

    // Simulate slow extract job (delayed promise)
    const extractJob = (async () => {
      // Simulate slow LLM call (tens of seconds)
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Extraction completed: track parse outcome
      trackMemoryParseOutcome(1); // parsed OK

      // Apply extract results (simulates applyExtractResults in real code)
      await setEnabled(true);
      await applyExtractResults(
        ["likes jazz", "lives in Milan"],
        [],
        getEpoch(),
      );
    })();

    // Wait for extract job to complete
    await extractJob;

    // Take extract-complete snapshot (doesn't reset)
    const extractCompleteSnapshot = snapshotMemoryTelemetry();

    // Extract-complete snapshot should show the extraction results
    expect(extractCompleteSnapshot.extractParseOutcome).toBe(1);
    expect(extractCompleteSnapshot.factsExtracted).toBe(2);
    expect(extractCompleteSnapshot.factsStored).toBe(2);
    expect(extractCompleteSnapshot.totalFactsInStore).toBe(2);

    // Verify that a subsequent getAndResetMemoryTelemetry would see the same data
    // (proving the snapshot didn't lose information)
    const finalSnapshot = getAndResetMemoryTelemetry();
    expect(finalSnapshot.extractParseOutcome).toBe(1);
    expect(finalSnapshot.factsExtracted).toBe(2);
    expect(finalSnapshot.factsStored).toBe(2);
  });

  test("snapshotMemoryTelemetry doesn't reset accumulator", () => {
    trackMemoryEnabled(true);
    trackMemoryParseOutcome(2);

    // Take snapshot (doesn't reset)
    const snapshot1 = snapshotMemoryTelemetry();
    expect(snapshot1.memoryEnabled).toBe(1);
    expect(snapshot1.extractParseOutcome).toBe(2);

    // Take another snapshot (should see same data)
    const snapshot2 = snapshotMemoryTelemetry();
    expect(snapshot2.memoryEnabled).toBe(1);
    expect(snapshot2.extractParseOutcome).toBe(2);

    // Now reset
    const resetSnapshot = getAndResetMemoryTelemetry();
    expect(resetSnapshot.memoryEnabled).toBe(1);
    expect(resetSnapshot.extractParseOutcome).toBe(2);

    // After reset, snapshot should be empty
    const afterReset = snapshotMemoryTelemetry();
    expect(afterReset.memoryEnabled).toBe(0);
    expect(afterReset.extractParseOutcome).toBe(0);
  });
});
