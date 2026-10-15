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

import { lastExitInfo } from "../../modules/kalsa-lifecycle/src";
import { isUncleanExit } from "./exitReasons";

export const CONSUMED_EXIT_AT_KEY = "kalsa.logReport.consumedExitAt.v1";

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
