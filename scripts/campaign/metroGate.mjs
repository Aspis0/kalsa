/**
 * Content gate for the Android debug bundle used by the T20C campaign.
 * Metro liveness, git state, APK identity, and source timestamps are not
 * evidence of the bytes served to the device; this gate reads those bytes.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import http from "node:http";
import https from "node:https";
import {
  ANDROID_DEBUG_BUNDLE_OPTIONS,
  ANDROID_DEBUG_BUNDLE_ENTRY,
  EXPO_REWRITE_BUNDLE_OPTIONS,
  FUSEBOX_BUNDLE_OPTIONS,
  buildAndroidDebugBundlePath,
  fuseboxEnabledFromEnv,
} from "./metroBundleConfig.mjs";

export const ANDROID_DEBUG_BUNDLE_PATH = buildAndroidDebugBundlePath();
export const FOREGROUND_IDLE_PROTOCOL_MARKER =
  "KALSA_FOREGROUND_IDLE_PROTOCOL revision=c37b419";
export const POST_FIX_IN_FLIGHT_NEEDLE = "if (args.inFlight) return false;";
export const FORBIDDEN_STALE_SYMBOLS = [
  "FOREGROUND_STUCK_INFLIGHT_MS",
  "stuckExpired",
];
const MAX_MATCH_EXCERPT_CHARS = 160;
const MAX_ERROR_CHARS = 512;

function bounded(value, max = MAX_ERROR_CHARS) {
  return String(value || "").slice(0, max);
}

function matchEvidence(text, needle) {
  const offset = text.indexOf(needle);
  if (offset < 0) {
    return { needle, present: false, textOffset: null, excerpt: null };
  }
  const start = Math.max(0, offset - 40);
  const end = Math.min(text.length, start + MAX_MATCH_EXCERPT_CHARS);
  return {
    needle,
    present: true,
    textOffset: offset,
    excerpt: text.slice(start, end),
  };
}

export function verifyBundleText(bundleText) {
  const text = Buffer.isBuffer(bundleText)
    ? bundleText.toString("utf8")
    : String(bundleText);
  const marker = matchEvidence(text, FOREGROUND_IDLE_PROTOCOL_MARKER);
  const inFlightSemantics = matchEvidence(text, POST_FIX_IN_FLIGHT_NEEDLE);
  const forbidden = FORBIDDEN_STALE_SYMBOLS.map((symbol) =>
    matchEvidence(text, symbol),
  );
  return {
    ok:
      marker.present &&
      inFlightSemantics.present &&
      forbidden.every((item) => !item.present),
    marker,
    inFlightSemantics,
    forbidden,
  };
}

class BundleRequestError extends Error {
  constructor(message, { statusCode = 0, chunks = [], responseMetadata = null } = {}) {
    super(message);
    this.name = "BundleRequestError";
    this.statusCode = statusCode;
    this.chunks = chunks;
    this.responseMetadata = responseMetadata;
  }
}

function chunksToBuffer(chunks) {
  return Buffer.concat(
    chunks.map((chunk) => (Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))),
  );
}

/** Fetch raw wire bytes with one total deadline and a single-settlement guard. */
export function requestBundle(url, timeoutMs, requesterOverride) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch (error) {
      reject(new Error(`invalid bundle URL: ${error.message}`));
      return;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      reject(new Error(`unsupported bundle URL protocol: ${parsed.protocol}`));
      return;
    }
    if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
      reject(new Error(`invalid bundle request deadline: ${timeoutMs}`));
      return;
    }

    const requester =
      requesterOverride || (parsed.protocol === "https:" ? https.request : http.request);
    const chunks = [];
    let request;
    let responseStatus = 0;
    let responseHeaders = null;
    let responseFinalUrl = null;
    let responseRewrittenUrl = null;
    let settled = false;
    let responseEnded = false;
    let deadline;

    const finish = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      callback();
    };
    const fail = (error, statusCode = responseStatus) => {
      finish(() =>
        reject(
          new BundleRequestError(bounded(error?.message || error), {
            statusCode,
            chunks,
            responseMetadata: {
              statusCode,
              headers: responseHeaders,
              finalUrl: responseFinalUrl,
              rewrittenUrl: responseRewrittenUrl,
            },
          }),
        ),
      );
    };

    deadline = setTimeout(() => {
      const error = new Error(`bundle request exceeded total deadline of ${timeoutMs} ms`);
      fail(error);
      if (request && typeof request.destroy === "function") request.destroy(error);
    }, timeoutMs);

    try {
      request = requester(parsed, (response) => {
        responseStatus = response.statusCode || 0;
        responseHeaders = response.headers || null;
        responseFinalUrl = response.finalUrl || response.url || null;
        responseRewrittenUrl = response.rewrittenUrl || null;
        response.on("data", (chunk) => {
          chunks.push(Buffer.isBuffer(chunk) ? Buffer.from(chunk) : Buffer.from(chunk));
        });
        response.on("error", (error) => fail(error));
        response.on("aborted", () =>
          fail(new Error("bundle response aborted before end")),
        );
        response.on("close", () => {
          if (!responseEnded) fail(new Error("bundle response closed before end"));
        });
        response.on("end", () => {
          responseEnded = true;
          finish(() =>
            resolve({
              statusCode: responseStatus,
              headers: response.headers,
              responseMetadata: {
                statusCode: responseStatus,
                headers: response.headers || null,
                finalUrl: responseFinalUrl,
                rewrittenUrl: responseRewrittenUrl,
              },
              chunks,
              bodyBuffer: chunksToBuffer(chunks),
            }),
          );
        });
      });
      request.on("error", (error) => fail(error));
      request.end();
    } catch (error) {
      fail(error);
    }
  });
}

function hasFuseboxOptions(parsed) {
  return (
    parsed.searchParams.get("excludeSource") === FUSEBOX_BUNDLE_OPTIONS.excludeSource &&
    parsed.searchParams.get("sourcePaths") === FUSEBOX_BUNDLE_OPTIONS.sourcePaths
  );
}

export function assertExactBundleUrl(url, { fuseboxEnabled } = {}) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch (error) {
    throw new Error(`invalid bundle URL: ${error.message}`);
  }
  if (parsed.pathname !== ANDROID_DEBUG_BUNDLE_ENTRY) {
    throw new Error(
      `bundle URL must use the exact Expo virtual entry path: ${ANDROID_DEBUG_BUNDLE_ENTRY}`,
    );
  }
  const allowedOptions = new Set([
    ...Object.keys(ANDROID_DEBUG_BUNDLE_OPTIONS),
    ...Object.keys(FUSEBOX_BUNDLE_OPTIONS),
    ...Object.keys(EXPO_REWRITE_BUNDLE_OPTIONS),
  ]);
  for (const key of parsed.searchParams.keys()) {
    if (!allowedOptions.has(key)) {
      throw new Error(`bundle URL has unexpected query option: ${key}`);
    }
  }
  for (const [key, expected] of Object.entries(ANDROID_DEBUG_BUNDLE_OPTIONS)) {
    const values = parsed.searchParams.getAll(key);
    if (values.length !== 1 || values[0] !== expected) {
      throw new Error(`bundle URL has incorrect Android debug option: ${key}=${expected}`);
    }
  }
  const hasAnyFuseboxOption =
    parsed.searchParams.has("excludeSource") || parsed.searchParams.has("sourcePaths");
  const actualFusebox = hasFuseboxOptions(parsed);
  if (hasAnyFuseboxOption && !actualFusebox) {
    throw new Error("bundle URL has incomplete Fusebox query parameters");
  }
  const expectedFusebox = fuseboxEnabled === undefined ? actualFusebox : fuseboxEnabled;
  if (expectedFusebox !== actualFusebox) {
    throw new Error(
      `bundle URL Fusebox options do not match the configured device variant (enabled=${expectedFusebox})`,
    );
  }
  if (actualFusebox) {
    for (const [key, expected] of Object.entries(FUSEBOX_BUNDLE_OPTIONS)) {
      const values = parsed.searchParams.getAll(key);
      if (values.length !== 1 || values[0] !== expected) {
        throw new Error(`bundle URL has incorrect Fusebox option: ${key}=${expected}`);
      }
    }
  }
  const rewriteKeys = Object.keys(EXPO_REWRITE_BUNDLE_OPTIONS);
  const hasAnyRewriteOption = rewriteKeys.some((key) => parsed.searchParams.has(key));
  const hasAllRewriteOptions = rewriteKeys.every((key) => parsed.searchParams.has(key));
  if (hasAnyRewriteOption && !hasAllRewriteOptions) {
    throw new Error("bundle URL has incomplete Expo rewrite query parameters");
  }
  const rewriteOptions = {};
  for (const [key, expected] of Object.entries(EXPO_REWRITE_BUNDLE_OPTIONS)) {
    if (!hasAllRewriteOptions) continue;
    const values = parsed.searchParams.getAll(key);
    if (values.length !== 1 || values[0] !== expected) {
      throw new Error(`bundle URL has incorrect Expo rewrite option: ${key}=${expected}`);
    }
    rewriteOptions[key] = expected;
  }
  const pathAndQuery = `${parsed.pathname}${parsed.search}`;
  return {
    path: pathAndQuery,
    basePath: buildAndroidDebugBundlePath({ fusebox: expectedFusebox }),
    fuseboxEnabled: expectedFusebox,
    query: Object.fromEntries(parsed.searchParams.entries()),
    rewriteOptions,
  };
}

function prepareEvidenceDir(evidenceDir) {
  mkdirSync(evidenceDir, { recursive: true });
  for (const name of ["bundle.sha256", "result.json"]) {
    if (existsSync(path.join(evidenceDir, name))) {
      const error = new Error(
        `refusing to overwrite existing evidence: ${path.join(evidenceDir, name)}`,
      );
      error.code = "EVIDENCE_EXISTS";
      throw error;
    }
  }
}

function uniqueFailureEvidenceDir(requestedEvidenceDir) {
  const parent = path.dirname(requestedEvidenceDir);
  mkdirSync(parent, { recursive: true });
  const base = path.basename(requestedEvidenceDir);
  for (let i = 0; i < 1000; i += 1) {
    const candidate = path.join(
      parent,
      `${base}.failure-${Date.now()}-${process.pid}-${i}`,
    );
    try {
      mkdirSync(candidate);
      return candidate;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
  }
  throw new Error(`could not allocate failure evidence directory beside ${requestedEvidenceDir}`);
}

function writeResult(evidenceDir, result) {
  writeFileSync(
    path.join(evidenceDir, "result.json"),
    `${JSON.stringify(result, null, 2)}\n`,
    "utf8",
  );
}

function responseBuffer(response) {
  if (Buffer.isBuffer(response?.bodyBuffer)) return response.bodyBuffer;
  if (Array.isArray(response?.chunks)) return chunksToBuffer(response.chunks);
  if (Buffer.isBuffer(response?.body)) return response.body;
  if (typeof response?.body === "string") return Buffer.from(response.body, "utf8");
  return Buffer.alloc(0);
}

function resultForEvidence(evidenceDir, url) {
  return {
    schema: "kalsa.metro-content-gate.v2",
    ok: false,
    evidenceDir,
    requestedEvidenceDir: evidenceDir,
    requestedUrl: url || null,
    expectedBundlePath: null,
    fuseboxEnabled: null,
    fetchedAt: new Date().toISOString(),
    partialBody: false,
    bundleBytes: null,
    sha256: null,
    httpStatus: null,
    responseMetadata: null,
    checks: null,
    error: null,
  };
}

export async function runMetroGate({
  url,
  evidenceDir,
  timeoutMs = 120_000,
  requestFn = requestBundle,
  fuseboxEnabled,
} = {}) {
  if (!evidenceDir) throw new Error("metro gate requires --evidence-dir");
  const requestedEvidenceDir = evidenceDir;
  const bundleUrl = url || process.env.CAMPAIGN_METRO_BUNDLE_URL || "";
  const result = resultForEvidence(requestedEvidenceDir, bundleUrl);
  let actualEvidenceDir = requestedEvidenceDir;
  try {
    prepareEvidenceDir(requestedEvidenceDir);
  } catch (error) {
    actualEvidenceDir = uniqueFailureEvidenceDir(requestedEvidenceDir);
    result.evidenceDir = actualEvidenceDir;
    result.error = bounded(error.message || error);
    result.failureEvidenceDir = actualEvidenceDir;
    writeResult(actualEvidenceDir, result);
    console.log(`metro gate evidence=${actualEvidenceDir}`);
    console.log("metro gate result=FAIL");
    console.error(`metro gate error=${result.error}`);
    return result;
  }

  result.evidenceDir = actualEvidenceDir;
  try {
    if (!bundleUrl) {
      throw new Error(
        "CAMPAIGN_METRO_BUNDLE_URL is required: no Metro host is configured in the repository or environment",
      );
    }
    const urlInfo = assertExactBundleUrl(bundleUrl, {
      fuseboxEnabled:
        fuseboxEnabled === undefined
          ? process.env.CAMPAIGN_METRO_FUSEBOX === undefined
            ? undefined
            : fuseboxEnabledFromEnv()
          : fuseboxEnabled,
    });
    result.expectedBundlePath = urlInfo.path;
    result.fuseboxEnabled = urlInfo.fuseboxEnabled;
    const response = await requestFn(bundleUrl, timeoutMs);
    result.httpStatus = response.statusCode || 0;
    result.responseMetadata = response.responseMetadata || {
      statusCode: result.httpStatus,
      headers: response.headers || null,
      finalUrl: response.finalUrl || response.url || null,
      rewrittenUrl: response.rewrittenUrl || null,
    };
    const bodyBuffer = responseBuffer(response);
    result.partialBody = Boolean(response.partialBody);
    result.bundleBytes = bodyBuffer.length;
    result.sha256 = createHash("sha256").update(bodyBuffer).digest("hex");
    writeFileSync(
      path.join(actualEvidenceDir, "bundle.sha256"),
      `sha256=${result.sha256}\nbytes=${result.bundleBytes}\n`,
      "utf8",
    );
    // Decode only for bounded content matching; the persisted digest is over raw wire bytes.
    result.checks = verifyBundleText(bodyBuffer);
    if (result.httpStatus !== 200) {
      throw new Error(`bundle request returned HTTP ${result.httpStatus}`);
    }
    if (result.partialBody) {
      throw new Error("bundle response ended with a partial body");
    }
    result.ok = result.checks.ok;
    if (!result.ok) throw new Error("served bundle failed the content checks");
  } catch (error) {
    const bodyBuffer =
      Array.isArray(error?.chunks) && error.chunks.length > 0
        ? chunksToBuffer(error.chunks)
        : null;
    if (error?.statusCode) result.httpStatus = error.statusCode;
    if (error?.responseMetadata) result.responseMetadata = error.responseMetadata;
    if (bodyBuffer) {
      result.partialBody = true;
      result.bundleBytes = bodyBuffer.length;
      result.sha256 = createHash("sha256").update(bodyBuffer).digest("hex");
      writeFileSync(
        path.join(actualEvidenceDir, "bundle.sha256"),
        `sha256=${result.sha256}\nbytes=${result.bundleBytes}\n`,
        "utf8",
      );
      result.checks = verifyBundleText(bodyBuffer);
    }
    result.error = bounded(error.message || error);
  }
  writeResult(actualEvidenceDir, result);
  console.log(`metro gate evidence=${actualEvidenceDir}`);
  console.log(`metro gate requested-url=${bundleUrl || "none"}`);
  console.log(
    `metro gate HTTP=${result.httpStatus ?? "none"} bytes=${result.bundleBytes ?? "none"} sha256=${result.sha256 ?? "none"}`,
  );
  if (result.checks) {
    console.log(`metro gate marker=${result.checks.marker.present ? "present" : "missing"}`);
    console.log(
      `metro gate in-flight-semantics=${result.checks.inFlightSemantics.present ? "present" : "missing"}`,
    );
    console.log(
      `metro gate forbidden-stale-symbols=${result.checks.forbidden.every((item) => !item.present) ? "absent" : "present"}`,
    );
  }
  console.log(`metro gate result=${result.ok ? "PASS" : "FAIL"}`);
  if (result.error) console.error(`metro gate error=${result.error}`);
  return result;
}

function arg(flag) {
  const index = process.argv.indexOf(flag);
  const value = index >= 0 ? process.argv[index + 1] : "";
  if (index < 0 || !value || value.startsWith("-")) {
    throw new Error(`usage: metroGate.mjs --evidence-dir DIR [--url URL] [--timeout-ms N] (missing ${flag})`);
  }
  return value;
}

if (process.argv[1] && process.argv[1].endsWith("metroGate.mjs")) {
  try {
    const evidenceDir = arg("--evidence-dir");
    const urlIndex = process.argv.indexOf("--url");
    const timeoutIndex = process.argv.indexOf("--timeout-ms");
    const url = urlIndex >= 0 ? arg("--url") : undefined;
    const timeoutMs = timeoutIndex >= 0 ? Number(arg("--timeout-ms")) : undefined;
    if (timeoutMs !== undefined && (!Number.isInteger(timeoutMs) || timeoutMs <= 0)) {
      throw new Error(`invalid --timeout-ms: ${timeoutMs}`);
    }
    const result = await runMetroGate({ evidenceDir, url, timeoutMs });
    process.exitCode = result.ok ? 0 : 1;
  } catch (error) {
    console.error(error.message || String(error));
    process.exitCode = 2;
  }
}
