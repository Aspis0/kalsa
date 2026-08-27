export type CalendarAgendaEvent = {
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  location: string;
};

export const AGENDA_MAX_DAYS = 14;
export const AGENDA_MAX_EVENTS = 50;
const AGENDA_MAX_MS = AGENDA_MAX_DAYS * 24 * 60 * 60 * 1000;

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
  let to = parseIsoDate(args.toISO) ?? fallback.to;
  if (to.getTime() <= from.getTime()) {
    const next = new Date(from);
    next.setDate(next.getDate() + 1);
    to = next;
  }
  if (to.getTime() - from.getTime() > AGENDA_MAX_MS) {
    to = new Date(from.getTime() + AGENDA_MAX_MS);
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
    if (out.length >= AGENDA_MAX_EVENTS) break;
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
