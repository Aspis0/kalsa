/**
 * The Kotlin bridge cannot run under jest, so its privacy surface is guarded
 * at the source level: the exit record leaves Android as the mapped reason,
 * the importance and the timestamp only. The crash description, the trace
 * stream, the process name and the process identifier never leave the OS
 * record — the description can carry the user's text.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SOURCE = join(
  __dirname,
  "../../../modules/kalsa-lifecycle/android/src/main/java/expo/modules/kalsalifecycle/KalsaLifecycleModule.kt",
);

describe("the Android exit-info bridge", () => {
  const source = readFileSync(SOURCE, "utf8");

  it("reads the newest exit record for this package", () => {
    expect(source).toContain("getHistoricalProcessExitReasons(context.packageName, 0, 1)");
  });

  it("hands JS the mapped reason, the importance and the timestamp", () => {
    expect(source).toContain('"reason" to exitReasonName(record.reason)');
    expect(source).toContain('"importance" to record.importance');
    expect(source).toContain('"timestampMs" to record.timestamp');
  });

  it.each(["description", "trace", "processName", "pid"])(
    "never mentions %s",
    (forbidden) => {
      expect(source).not.toContain(forbidden);
    },
  );
});
