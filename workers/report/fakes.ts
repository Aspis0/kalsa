/**
 * Shared fakes and request helpers for the report Worker tests.
 */

import worker, { type Env } from "./index";

export const REPORT_URL = "https://kalsa.io/report";
export const VALID_APP = "0.9.1/macos/arm64";
export const CLIENT_IP = "203.0.113.9";
export const CAP = 4 * 1024 * 1024;

export type PutRecord = {
  key: string;
  value: Uint8Array;
  options?: {
    onlyIf?: { etagDoesNotMatch?: string };
    httpMetadata?: { contentType?: string };
    customMetadata?: Record<string, string>;
  };
};

export type FakeOpts = {
  limitSuccess?: boolean;
  rejectPuts?: number; // first N put() calls hit a key that already exists
  dailyCount?: number; // objects list() returns for the day's prefix
};

/** A null header value in overrides deletes the default (header absent). */
export type HeaderOverrides = Record<string, string | null>;

export function fakeEnv(opts: FakeOpts = {}) {
  const puts: PutRecord[] = []; // successful stores only
  const putAttempts: PutRecord[] = []; // every put() call, for onlyIf assertions
  const limitKeys: string[] = [];
  let rejected = 0;
  const env = {
    REPORTS: {
      put: async (key: string, value: Uint8Array, options?: PutRecord["options"]) => {
        putAttempts.push({ key, value, options });
        if (options?.onlyIf && rejected < (opts.rejectPuts ?? 0)) {
          rejected += 1;
          return null; // precondition failed: key exists, nothing stored
        }
        puts.push({ key, value, options });
        return { key };
      },
      list: async (options: { prefix: string; limit: number }) => ({
        objects: Array.from({ length: Math.min(opts.dailyCount ?? 0, options.limit) }, (_, i) => ({
          key: `${options.prefix}existing-${i}.log`,
        })),
      }),
    },
    REPORT_RATE_LIMITER: {
      limit: async (req: { key: string }) => {
        limitKeys.push(req.key);
        return { success: opts.limitSuccess ?? true };
      },
    },
  } as unknown as Env;
  return { env, puts, putAttempts, limitKeys };
}

export function post(
  env: Env,
  body = "line one\nline two\n",
  headers: HeaderOverrides = {},
): Promise<Response> {
  const merged: Record<string, string> = {
    "content-type": "text/plain; charset=utf-8",
    "content-length": String(Buffer.byteLength(body)),
    "x-kalsa-app": VALID_APP,
    "cf-connecting-ip": CLIENT_IP,
  };
  for (const [name, value] of Object.entries(headers)) {
    if (value === null) delete merged[name];
    else merged[name] = value;
  }
  return worker.fetch(new Request(REPORT_URL, { method: "POST", headers: merged, body }), env);
}

export async function errorBody(res: Response): Promise<{ code: string; message: string }> {
  const body = JSON.parse(await res.text());
  return body.error;
}
