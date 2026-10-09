const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
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

/** The local date of `at` in English words, day granularity. English whatever
    the interface speaks: the wire language is English. */
export function sentDatePhrase(at: Date): string {
  return `${DAYS[at.getDay()]}, ${at.getDate()} ${MONTHS[at.getMonth()]} ${at.getFullYear()}`;
}

/** The line a user turn carries on the wire, after its own words. */
export function sentLine(sentOn: string): string {
  return `Sent on ${sentOn}.`;
}
