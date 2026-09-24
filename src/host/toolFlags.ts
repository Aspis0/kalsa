/**
 * The three tool flags as state + ref mirrors (D2 row 14: the engine reads
 * the refs mid-run).
 *
 * `toggleWebTools` is lifted WITH the control it belongs to (D1 row 5): the
 * controller kept the Web toggle on the chat top bar and the new strip carries
 * it as `shell.strip.web`. The persisted key is the controller's own
 * `WEB_TOOLS_ENABLED_KEY`, written as `"1"`/`"0"` exactly as before. The
 * notify-on-change-but-not-on-mount rule rides the existing wiring —
 * `useHostEffects` → `staticPrefixNotify.ts` (skip once at mount), tested in
 * `staticPrefixNotify.test.ts` — so a toggle fires the notice and mount never
 * does. Device and calendar stay inside Settings, untouched.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  CALENDAR_TOOLS_KEY,
  DEVICE_TOOLS_KEY,
  WEB_TOOLS_ENABLED_KEY,
  parseToolToggle,
} from "../agent/toolToggles";
import { persistWebToolsEnabled } from "./toolTogglePersistence";

export interface ToolFlagRefs {
  webToolsEnabledRef: { current: boolean };
  deviceToolsEnabledRef: { current: boolean };
  calendarToolsEnabledRef: { current: boolean };
}

export function useToolFlags(): {
  webToolsEnabled: boolean;
  deviceToolsEnabled: boolean;
  calendarToolsEnabled: boolean;
  flagRefs: ToolFlagRefs;
  refreshToolFlags: () => Promise<void>;
  /** The strip's Web switch: flip state + ref, then persist under the
   *  controller's key. */
  toggleWebTools: () => void;
} {
  const [webToolsEnabled, setWebToolsEnabled] = useState(true);
  const webToolsEnabledRef = useRef(true);
  webToolsEnabledRef.current = webToolsEnabled;
  useEffect(() => {
    let cancelled = false;
    void AsyncStorage.getItem(WEB_TOOLS_ENABLED_KEY)
      .then((raw) => {
        if (cancelled) return;
        const webOn = parseToolToggle(raw, true);
        setWebToolsEnabled(webOn);
        webToolsEnabledRef.current = webOn;
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const [deviceToolsEnabled, setDeviceToolsEnabled] = useState(true);
  const deviceToolsEnabledRef = useRef(true);
  deviceToolsEnabledRef.current = deviceToolsEnabled;
  const [calendarToolsEnabled, setCalendarToolsEnabled] = useState(false);
  const calendarToolsEnabledRef = useRef(false);
  calendarToolsEnabledRef.current = calendarToolsEnabled;

  const refreshToolFlags = useCallback(async () => {
    try {
      const [deviceRaw, calendarRaw] = await Promise.all([
        AsyncStorage.getItem(DEVICE_TOOLS_KEY),
        AsyncStorage.getItem(CALENDAR_TOOLS_KEY),
      ]);
      const deviceOn = parseToolToggle(deviceRaw, true);
      setDeviceToolsEnabled(deviceOn);
      deviceToolsEnabledRef.current = deviceOn;
      const calendarOn = parseToolToggle(calendarRaw, false);
      setCalendarToolsEnabled(calendarOn);
      calendarToolsEnabledRef.current = calendarOn;
    } catch {
      // keep defaults
    }
  }, []);

  useEffect(() => {
    void refreshToolFlags();
  }, [refreshToolFlags]);

  // Flip state AND ref first (the engine reads the ref mid-run), persist
  // under the controller's key, swallow a storage failure — the toggle stays
  // true for the session either way.
  const toggleWebTools = useCallback(() => {
    setWebToolsEnabled((prev) => {
      const next = !prev;
      webToolsEnabledRef.current = next;
      void persistWebToolsEnabled(next, (key, value) => AsyncStorage.setItem(key, value));
      return next;
    });
  }, []);

  return {
    webToolsEnabled,
    deviceToolsEnabled,
    calendarToolsEnabled,
    flagRefs: { webToolsEnabledRef, deviceToolsEnabledRef, calendarToolsEnabledRef },
    refreshToolFlags,
    toggleWebTools,
  };
}
