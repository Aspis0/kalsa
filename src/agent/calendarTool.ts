import type { EngineTool, EngineToolResult } from "../engine/LlamaService";

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

export type CalendarAgendaEvent = {
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  location: string;
};

export function localDayRange(now: Date = new Date()): { from: Date; to: Date } {
  const from = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const to = new Date(from);
  to.setDate(to.getDate() + 1);
  return { from, to };
}

function parseIsoDate(raw: unknown): Date | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

export function resolveAgendaRange(
  args: Record<string, unknown>,
  now: Date = new Date(),
): { from: Date; to: Date } {
  const fallback = localDayRange(now);
  const from = parseIsoDate(args.fromISO) ?? fallback.from;
  const to = parseIsoDate(args.toISO) ?? fallback.to;
  if (to.getTime() <= from.getTime()) {
    const next = new Date(from);
    next.setDate(next.getDate() + 1);
    return { from, to: next };
  }
  return { from, to };
}

function asIso(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }
  if (typeof value === "string" && value) {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
    return value;
  }
  return "";
}

export function mapCalendarEvents(raw: unknown[]): CalendarAgendaEvent[] {
  const out: CalendarAgendaEvent[] = [];
  if (!Array.isArray(raw)) return out;
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    out.push({
      title: typeof rec.title === "string" ? rec.title : "",
      start: asIso(rec.startDate),
      end: asIso(rec.endDate),
      allDay: rec.allDay === true,
      location: typeof rec.location === "string" ? rec.location : "",
    });
  }
  return out;
}

export async function runCalendarAgenda(
  args: Record<string, unknown>,
  messages: { denied: string; failed: string },
): Promise<EngineToolResult> {
  let Calendar: {
    requestCalendarPermissionsAsync?: () => Promise<{ status?: string }>;
    getCalendarsAsync?: (entity?: string) => Promise<Array<{ id?: string }>>;
    getEventsAsync?: (ids: string[], from: Date, to: Date) => Promise<unknown[]>;
    EntityTypes?: { EVENT?: string };
  };
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    Calendar = require("expo-calendar");
  } catch {
    return { text: messages.failed, kind: "calendar_agenda", error: "unavailable" };
  }

  try {
    const perm = await Calendar.requestCalendarPermissionsAsync?.();
    if (!perm || perm.status !== "granted") {
      return { text: messages.denied, kind: "calendar_agenda", error: "denied" };
    }
    const entity = Calendar.EntityTypes?.EVENT;
    const calendars = entity
      ? await Calendar.getCalendarsAsync?.(entity)
      : await Calendar.getCalendarsAsync?.();
    const ids = (calendars ?? [])
      .map((cal) => (typeof cal?.id === "string" ? cal.id : ""))
      .filter(Boolean);
    if (ids.length === 0) {
      return { text: JSON.stringify({ events: [] }), kind: "calendar_agenda" };
    }
    const { from, to } = resolveAgendaRange(args);
    const events = await Calendar.getEventsAsync?.(ids, from, to);
    const mapped = mapCalendarEvents(events ?? []);
    return { text: JSON.stringify({ events: mapped }), kind: "calendar_agenda" };
  } catch {
    return { text: messages.failed, kind: "calendar_agenda", error: "failed" };
  }
}
