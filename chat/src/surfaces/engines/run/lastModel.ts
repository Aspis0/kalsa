/** The model each engine was last started with. The backend does not report it, so the page remembers it. */

const KEY = "kalsa.engineModels.v1";

function read(): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    return parsed !== null && typeof parsed === "object" ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

export function lastModel(engineId: string): string | null {
  const value = read()[engineId];
  return typeof value === "string" ? value : null;
}

export function rememberModel(engineId: string, model: string): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...read(), [engineId]: model }));
  } catch {
    // The choice holds for this visit when storage refuses it.
  }
}
