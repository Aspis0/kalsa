/**
 * Which Android process exits count as unclean. Pure on purpose: the load
 * death marker reads the same predicate, and it must not pull in AsyncStorage
 * or the native lifecycle module.
 */
import type { ExitInfo, ExitReason } from "../../modules/kalsa-lifecycle/src";

// The OS importance of a process that was foreground (100), a foreground
// service (125) or visible (200) when it died.
const VISIBLE_IMPORTANCE_MAX = 200;

const CRASH_REASONS: readonly ExitReason[] = ["crash", "crash_native", "anr"];
const FOREGROUND_KILL_REASONS: readonly ExitReason[] = [
  "low_memory",
  "signaled",
  "excessive_resource_usage",
];

/**
 * A crash always is unclean; a memory or signal kill of a process that was at
 * least visible is unclean too — the OS reaping a background process is
 * normal Android behaviour and must not nag. user_requested/user_stopped
 * (force-stop, swipe in settings), exit_self and every other reason are clean.
 */
export function isUncleanExit(record: ExitInfo): boolean {
  if (CRASH_REASONS.includes(record.reason)) return true;
  return (
    FOREGROUND_KILL_REASONS.includes(record.reason) &&
    record.importance <= VISIBLE_IMPORTANCE_MAX
  );
}
