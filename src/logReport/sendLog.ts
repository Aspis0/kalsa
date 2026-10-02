/**
 * The one-shot log sender: reads the safe report text and POSTs it once to
 * kalsa.io/report. Call it ONLY from a user press — there is no queue, no
 * retry, no background send, and nothing runs at import time. The server-side
 * contract (status codes, header grammar, id alphabet) is workers/report.
 */
import { Platform } from "react-native";

import { readLogReportText } from "./collector";

const REPORT_URL = "https://kalsa.io/report";
const SEND_TIMEOUT_MS = 30_000;
// arm64 is the only shipped ABI (arm64-v8a on Android, arm64 on iOS), so the
// arch component is a constant, not a device probe.
const REPORT_ARCH = "arm64";
// Same grammar the Worker enforces (workers/report/index.ts APP_HEADER_PATTERN);
// validating locally keeps a malformed header a local error, not a 400 round-trip.
const APP_HEADER_PATTERN = /^[0-9A-Za-z._-]{1,32}\/[a-z0-9_]{1,16}\/[a-z0-9_]{1,16}$/;
// Phone-readable ids: capitals without I/L/O and digits without 0/1.
const REPORT_ID_PATTERN = /^[A-Z2-9]{8}$/;

export type SendLogFailure = {
  reason: "empty" | "rate_limited" | "daily_limit" | "failed";
};
export type SendLogResult = { ok: true; id: string } | ({ ok: false } & SendLogFailure);

/** The app version from the same source telemetry sends. */
function appVersion(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Constants = require("expo-constants").default as {
      expoConfig?: { version?: string };
      nativeAppVersion?: string;
    };
    return Constants.expoConfig?.version ?? Constants.nativeAppVersion ?? "0.1.0";
  } catch {
    return "0.1.0";
  }
}

/** The response carries only status and JSON; the server body text is never surfaced. */
async function mapResponse(res: { status: number; json(): Promise<unknown> }): Promise<SendLogResult> {
  if (res.status === 429) return { ok: false, reason: "rate_limited" };
  if (res.status === 503) {
    try {
      const parsed = (await res.json()) as { error?: { code?: unknown } };
      if (parsed?.error?.code === "daily_limit") {
        return { ok: false, reason: "daily_limit" };
      }
    } catch {
      // a 503 without JSON is an ordinary failure
    }
    return { ok: false, reason: "failed" };
  }
  if (res.status === 201) {
    try {
      const parsed = (await res.json()) as { id?: unknown };
      if (typeof parsed?.id === "string" && REPORT_ID_PATTERN.test(parsed.id)) {
        return { ok: true, id: parsed.id };
      }
    } catch {
      // a 201 without a well-formed id must not become a fake success
    }
  }
  return { ok: false, reason: "failed" };
}

/**
 * Send the collected log once. Every failure mode — local or network — resolves
 * with a stable reason for the UI copy; it never throws and never returns the
 * server's response text.
 */
export async function sendLog(): Promise<SendLogResult> {
  const body = readLogReportText();
  if (body.length === 0) return { ok: false, reason: "empty" };

  const app = `${appVersion()}/${Platform.OS}/${REPORT_ARCH}`;
  if (!APP_HEADER_PATTERN.test(app)) return { ok: false, reason: "failed" };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
  try {
    const res = await fetch(REPORT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "X-Kalsa-App": app,
      },
      body,
      signal: controller.signal,
    });
    return await mapResponse(res);
  } catch {
    // network error, timeout abort, or fetch rejection are all one outcome
    return { ok: false, reason: "failed" };
  } finally {
    clearTimeout(timer);
  }
}
