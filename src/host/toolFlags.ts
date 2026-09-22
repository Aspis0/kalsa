/**
 * The three tool flags as state + ref mirrors (D2 row 14: the engine reads
 * the refs mid-run). Lifted from `AppShell.tsx:861-916`.
 *
 * `toggleWebTools` is NOT lifted: the Web switch existed only on the old
 * chat top bar (AppShell:6926-6959), which the new strip replaces — the
 * flag still LOADS (default ON) and still reaches `assembleTools` and the
 * static-prefix notifier, and Settings owns device/calendar as before.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  CALENDAR_TOOLS_KEY,
  DEVICE_TOOLS_KEY,
  WEB_TOOLS_ENABLED_KEY,
  parseToolToggle,
} from "../agent/toolToggles";

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

  return {
    webToolsEnabled,
    deviceToolsEnabled,
    calendarToolsEnabled,
    flagRefs: { webToolsEnabledRef, deviceToolsEnabledRef, calendarToolsEnabledRef },
    refreshToolFlags,
  };
}
