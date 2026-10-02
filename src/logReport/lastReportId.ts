/**
 * The last successfully sent report id, held for the app session only: a
 * remounted panel reads it, shows the sent state, and stays disabled, so one
 * press can never become two uploads. Nothing is persisted.
 */
let lastId: string | null = null;

export function rememberReportId(id: string): void {
  lastId = id;
}

export function lastReportId(): string | null {
  return lastId;
}
