import type { EngineTool, EngineToolResult } from "../engine/LlamaService";
import {
  mapCalendarEvents,
  resolveAgendaRange,
} from "./calendarAgenda";

export {
  AGENDA_MAX_DAYS,
  AGENDA_MAX_EVENTS,
  localDayRange,
  mapCalendarEvents,
  resolveAgendaRange,
  type CalendarAgendaEvent,
} from "./calendarAgenda";

export const CALENDAR_AGENDA_TOOL: EngineTool = {
  type: "function",
  function: {
    name: "calendar_agenda",
    description:
      "Read this device's calendar events between two local times (default: today). Returns title, start, end, allDay, location only. Do not pass this output to web_search.",
    parameters: {
      type: "object",
      properties: {
        fromISO: {
          type: "string",
          description: "Start instant (ISO-8601). Default: today 00:00 local.",
        },
        toISO: {
          type: "string",
          description: "End instant (ISO-8601). Default: tomorrow 00:00 local.",
        },
      },
    },
  },
};

type CalendarMessages = { denied: string; failed: string; unavailable: string };

type ExpoCalendarMod = {
  requestCalendarPermissions?: () => Promise<{ status?: string; granted?: boolean }>;
  getCalendars?: (entity?: string) => Promise<Array<{ id?: string }>>;
  listEvents?: (ids: string[], from: Date, to: Date) => Promise<unknown[]>;
  getCalendarsAsync?: (entity?: string) => Promise<Array<{ id?: string }>>;
  getEventsAsync?: (ids: string[], from: Date, to: Date) => Promise<unknown[]>;
  EntityTypes?: { EVENT?: string };
};

function loadExpoCalendar(): ExpoCalendarMod | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("expo-calendar") as ExpoCalendarMod;
  } catch {
    return null;
  }
}

function loadRnPlatform(): { OS?: string } | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const rn = require("react-native") as { Platform?: { OS?: string } };
    return rn.Platform ?? null;
  } catch {
    return null;
  }
}

/**
 * READ_CALENDAR only. Never call expo-calendar's request*Permissions —
 * those ask WRITE_CALENDAR on Android, which this build strips.
 */
async function ensureCalendarReadGranted(): Promise<
  "granted" | "denied" | "unavailable"
> {
  const platform = loadRnPlatform();
  const os = platform?.OS;

  if (os === "android") {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { PermissionsAndroid } = require("react-native") as {
        PermissionsAndroid?: {
          PERMISSIONS?: { READ_CALENDAR?: string };
          RESULTS?: { GRANTED?: string };
          check?: (perm: string) => Promise<boolean>;
          request?: (perm: string) => Promise<string>;
        };
      };
      const perm = PermissionsAndroid?.PERMISSIONS?.READ_CALENDAR;
      if (!perm || !PermissionsAndroid.check || !PermissionsAndroid.request) {
        return "unavailable";
      }
      if (await PermissionsAndroid.check(perm)) return "granted";
      const result = await PermissionsAndroid.request(perm);
      return result === PermissionsAndroid.RESULTS?.GRANTED ? "granted" : "denied";
    } catch {
      return "unavailable";
    }
  }

  // iOS: EventKit read / full-access usage string. Not Android WRITE.
  const Calendar = loadExpoCalendar();
  if (typeof Calendar?.requestCalendarPermissions === "function") {
    try {
      const perm = await Calendar.requestCalendarPermissions();
      if (perm?.status === "granted" || perm?.granted === true) return "granted";
      return "denied";
    } catch {
      return "denied";
    }
  }

  return "unavailable";
}

export async function runCalendarAgenda(
  args: Record<string, unknown>,
  messages: CalendarMessages,
): Promise<EngineToolResult> {
  const access = await ensureCalendarReadGranted();
  if (access === "unavailable") {
    return { text: messages.unavailable, kind: "calendar_agenda", error: "unavailable" };
  }
  if (access !== "granted") {
    return { text: messages.denied, kind: "calendar_agenda", error: "denied" };
  }

  const Calendar = loadExpoCalendar();
  if (!Calendar) {
    return { text: messages.unavailable, kind: "calendar_agenda", error: "unavailable" };
  }

  const os = loadRnPlatform()?.OS;
  const { from, to } = resolveAgendaRange(args);

  try {
    // Next API: listEvents / getCalendars do not require WRITE on Android.
    if (typeof Calendar.getCalendars === "function" && typeof Calendar.listEvents === "function") {
      const entity = Calendar.EntityTypes?.EVENT;
      const calendars = entity
        ? await Calendar.getCalendars(entity)
        : await Calendar.getCalendars();
      const ids = (calendars ?? [])
        .map((cal) => (typeof cal?.id === "string" ? cal.id : ""))
        .filter(Boolean);
      if (ids.length === 0) {
        return { text: JSON.stringify({ events: [] }), kind: "calendar_agenda" };
      }
      const events = await Calendar.listEvents(ids, from, to);
      const mapped = mapCalendarEvents(events ?? []);
      return { text: JSON.stringify({ events: mapped }), kind: "calendar_agenda" };
    }

    // Legacy getEventsAsync checks WRITE on Android — refuse rather than lie.
    if (os === "android") {
      return { text: messages.unavailable, kind: "calendar_agenda", error: "unavailable" };
    }

    if (typeof Calendar.getCalendarsAsync === "function" && typeof Calendar.getEventsAsync === "function") {
      const entity = Calendar.EntityTypes?.EVENT;
      const calendars = entity
        ? await Calendar.getCalendarsAsync(entity)
        : await Calendar.getCalendarsAsync();
      const ids = (calendars ?? [])
        .map((cal) => (typeof cal?.id === "string" ? cal.id : ""))
        .filter(Boolean);
      if (ids.length === 0) {
        return { text: JSON.stringify({ events: [] }), kind: "calendar_agenda" };
      }
      const events = await Calendar.getEventsAsync(ids, from, to);
      const mapped = mapCalendarEvents(events ?? []);
      return { text: JSON.stringify({ events: mapped }), kind: "calendar_agenda" };
    }

    return { text: messages.unavailable, kind: "calendar_agenda", error: "unavailable" };
  } catch {
    return { text: messages.failed, kind: "calendar_agenda", error: "failed" };
  }
}
