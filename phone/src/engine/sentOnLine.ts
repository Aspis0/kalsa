/**
 * The send-date line: stamped once at send time, stored with the turn, and
 * replayed byte-identical on every later request, local and remote brain.
 * "Sent on", never "Today is": a turn stored last week must stay true when
 * it is replayed. English weekday and month on purpose — this is model-
 * facing text, not UI copy. Day granularity; time of day is a tool's job.
 */

const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** "Sent on Thursday, 8 October 2026." from the device's LOCAL date. */
export function formatSentOnLine(date: Date): string {
  return `Sent on ${WEEKDAYS[date.getDay()]}, ${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}.`;
}

/** Append a stored stamp after the turn's words; absent stamp → unchanged. */
export function appendSentOnLine(
  text: string,
  sentOn: string | null | undefined,
): string {
  return sentOn ? `${text}\n\n${sentOn}` : text;
}
