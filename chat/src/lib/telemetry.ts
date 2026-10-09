import { available, invoke } from "./tauri";

export interface TelemetryStatus {
  enabled: boolean;
  noticeSeen: boolean;
}

export function telemetryStatus(): Promise<TelemetryStatus> {
  if (typeof window === "undefined" || !available()) return Promise.reject(new Error("telemetry unavailable"));
  return invoke<TelemetryStatus>("brain_telemetry_status");
}

export function setTelemetry(enabled: boolean): Promise<void> {
  if (typeof window === "undefined" || !available()) return Promise.reject(new Error("telemetry unavailable"));
  return invoke<void>("brain_telemetry_set", { enabled });
}

export function dismissTelemetryNotice(): Promise<void> {
  if (typeof window === "undefined" || !available()) return Promise.reject(new Error("telemetry unavailable"));
  return invoke<void>("brain_telemetry_notice_seen");
}

export function telemetryPrefill(progress: unknown): void {
  if (typeof window === "undefined" || !available() || !progress || typeof progress !== "object") return;
  const { total, processed, time_ms: milliseconds } = progress as Record<string, unknown>;
  if (typeof total !== "number" || !Number.isInteger(total) || total < 0 || total > 0xffffffff) return;
  const rate = typeof processed === "number" && Number.isFinite(processed) && processed >= 0 &&
    typeof milliseconds === "number" && Number.isFinite(milliseconds) && milliseconds > 0 ? processed * 1000 / milliseconds : null;
  void invoke("brain_telemetry_progress", { promptTokens: total, tokensPerSecond: rate !== null && Number.isFinite(rate) ? rate : null }).catch(() => {});
}
