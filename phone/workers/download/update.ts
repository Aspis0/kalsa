/**
 * The desktop updater's dynamic check (Tauri v2) and the artifact it downloads.
 * The check answers 204 when there is nothing newer, and 200 with the release
 * version, the artifact URL, its signature and the notes when there are any.
 */
import { notFound } from "./http";
import { serveFile } from "./file";
import type { Manifest, Platform, Update } from "./manifest";
import { artifactUrl } from "./routes";
import { isNewer } from "./semver";

const TARGETS: Record<string, Platform> = { "darwin/aarch64": "mac", "windows/x86_64": "windows" };

export type UpdateCheck = { target: string; arch: string; current: string };

const NO_UPDATE_HEADERS = { "cache-control": "no-store", "x-content-type-options": "nosniff" };
const noUpdate = () => new Response(null, { status: 204, headers: NO_UPDATE_HEADERS });

export function updateCheck(manifest: Manifest, key: string, check: UpdateCheck, method: "GET" | "HEAD"): Response {
  const platform = TARGETS[`${check.target}/${check.arch}`];
  // A current version that is not semver gets the same 204 as an up-to-date app.
  if (platform === undefined || manifest.version === null || !isNewer(manifest.version, check.current)) {
    return noUpdate();
  }
  const update = manifest.updates[platform];
  if (update === null) return noUpdate();
  const body = JSON.stringify({
    version: manifest.version,
    url: artifactUrl(key, platform),
    signature: update.signature,
    ...(manifest.notes === null ? {} : { notes: manifest.notes }),
  });
  return new Response(method === "HEAD" ? null : body, {
    status: 200,
    headers: { "content-type": "application/json", ...NO_UPDATE_HEADERS },
  });
}

export async function artifactResponse(
  bucket: R2Bucket,
  update: Update | null,
  req: { method: "GET" | "HEAD"; ifNoneMatch: string | null },
): Promise<Response> {
  if (update === null) return notFound();
  return serveFile(bucket, update, {
    method: req.method,
    ifNoneMatch: req.ifNoneMatch,
    cacheControl: "private, no-store",
  });
}
