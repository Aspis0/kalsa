// The tools the models are offered (one responsibility: the three tool JSONs
// and condition C's structured variant). calendar_agenda is the phone's
// CALENDAR_AGENDA_TOOL verbatim (origin/main:src/agent/calendarTool.ts);
// web_search is the desktop's definition verbatim
// (chat/src/lib/tools/definitions.ts); create_calendar_event is new, written
// in the phone's style. Executors are mocks: nothing here touches a calendar.

export const AGENDA_TOOL = {
  type: "function",
  function: {
    name: "calendar_agenda",
    description:
      "Read this device's calendar events between two local times. fromISO and toISO are required ISO-8601 instants. Returns title, start, end, allDay, location only. Do not pass this output to web_search.",
    parameters: {
      type: "object",
      properties: {
        fromISO: {
          type: "string",
          description: "Start instant (ISO-8601). Required.",
        },
        toISO: {
          type: "string",
          description: "End instant (ISO-8601). Required.",
        },
      },
      required: ["fromISO", "toISO"],
    },
  },
};

export const CREATE_TOOL = {
  type: "function",
  function: {
    name: "create_calendar_event",
    description:
      "Create a calendar event on this device from a title and a local start. start and end are ISO-8601 instants with their UTC offset; allDay events take the day's midnight start and end. When the person does not say an end, make the event one hour. Do not pass this output to web_search.",
    parameters: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "The event's title, as the person named it. Required.",
        },
        start: {
          type: "string",
          description: "Start instant (ISO-8601 local with offset). Required.",
        },
        end: {
          type: "string",
          description: "End instant (ISO-8601 local with offset). Required.",
        },
        allDay: {
          type: "boolean",
          description: "True for an all-day event. Required.",
        },
        location: {
          type: "string",
          description: "Location if the person named one, else null.",
        },
      },
      required: ["title", "start", "end", "allDay"],
    },
  },
};

export const SEARCH_TOOL = {
  type: "function",
  function: {
    name: "web_search",
    description:
      "Search the web for current information: news, facts, prices, events, people — anything the model may not know. Returns the top results with their titles, URLs and a short excerpt. Use web_fetch to actually read a result.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query — describe the page you want, not just keywords.",
        },
      },
      required: ["query"],
    },
  },
};

/** Condition C's create tool: the model fills relative fields, code computes
 *  the ISO instants. The agenda tool is unchanged; only create changes. */
export const CREATE_TOOL_RELATIVE = {
  type: "function",
  function: {
    name: "create_calendar_event",
    description:
      "Create a calendar event on this device. Fill the relative fields exactly as the person said them; the system computes the local instants from the current clock. When no end is said, leave durationMinutes at 60.",
    parameters: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "The event's title, as the person named it. Required.",
        },
        day: {
          type: "string",
          enum: ["today", "tomorrow", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday", "date"],
          description: "Which day. Use \"date\" together with the date field.",
        },
        date: {
          type: "string",
          description: "The exact day as YYYY-MM-DD, when the person named a calendar date.",
        },
        week: {
          type: "string",
          enum: ["this", "next"],
          description: "Which week a weekday means: this week's or next week's.",
        },
        time: {
          type: "string",
          description: "Start time as HH:MM (24h). null for an all-day event.",
        },
        durationMinutes: {
          type: "number",
          description: "Minutes from start to end. 60 when not said.",
        },
        allDay: {
          type: "boolean",
          description: "True for an all-day event.",
        },
        location: {
          type: "string",
          description: "Location if the person named one, else null.",
        },
      },
      required: ["title", "day", "time", "durationMinutes", "allDay"],
    },
  },
};

export const toolsFor = (condition) =>
  [AGENDA_TOOL, condition === "C" ? CREATE_TOOL_RELATIVE : CREATE_TOOL, SEARCH_TOOL];
