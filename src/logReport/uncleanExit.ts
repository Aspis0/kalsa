/**
 * The one-shot unclean-exit ask for the launch after the previous process
 * died badly. The record comes from the Android OS; iOS and other platforms
 * ship no such native function (no iOS ship target yet), so this never asks
 * there.
 *
 * The rule: ask exactly when the newest record is unclean AND its timestamp
 * is newer than the stored one (nothing stored reads as 0). The record's
 * timestamp is stored as consumed whether or not it asks, so the same exit is
 * not asked about twice. A fresh install has no record and asks nothing; an
 * upgrade from a build without this key can ask once about the last real
 * crash. A failed store can only make a later launch ask again — sending
 * always needs the user's press.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  lastExitInfo,
  type ExitInfo,
  type ExitReason,
} from "../../modules/kalsa-lifecycle/src";

export const CONSUMED_EXIT_AT_KEY = "kalsa.logReport.consumedExitAt.v1";

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

/**
 * Decide and consume in one step: true shows the prompt. The record's
 * timestamp is stored whether or not it asks. A missing record or a failed
 * native call consumes nothing and asks nothing.
 */
export async function consumeUncleanExitAsk(): Promise<boolean> {
  const record = lastExitInfo();
  if (record === null) return false;
  const consumedAt = await readConsumedAt();
  const ask = isUncleanExit(record) && record.timestampMs > consumedAt;
  await AsyncStorage.setItem(CONSUMED_EXIT_AT_KEY, String(record.timestampMs)).catch(
    () => undefined,
  );
  return ask;
}

/** The stored consumed timestamp; absent or unreadable reads as 0. */
async function readConsumedAt(): Promise<number> {
  try {
    const raw = await AsyncStorage.getItem(CONSUMED_EXIT_AT_KEY);
    const value = raw === null ? 0 : Number(raw);
    return Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
}
