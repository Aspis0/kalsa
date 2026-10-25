/**
 * Streams one file from the bucket, and only when its bytes match the manifest:
 * the same size and, if R2 carries one, the same sha256. Installers and updater
 * artifacts both go through here; they differ only in cache policy.
 */
import { hexOf } from "./hash";
import { notFound, notModified, serviceUnavailable } from "./http";
import type { Artifact } from "./manifest";

export type FileRequest = { method: "GET" | "HEAD"; ifNoneMatch: string | null; cacheControl: string };

export async function serveFile(bucket: R2Bucket, file: Artifact, req: FileRequest): Promise<Response> {
  const etag = `"${file.sha256}"`;
  if (req.ifNoneMatch === etag) return notModified(etag, req.cacheControl);
  if (req.method === "HEAD") {
    const object = await bucket.head(file.key);
    if (object === null) return notFound();
    if (!matchesManifest(object, file)) return serviceUnavailable();
    return new Response(null, { status: 200, headers: fileHeaders(file, req.cacheControl) });
  }
  const object = await bucket.get(file.key);
  if (object === null) return notFound();
  if (!matchesManifest(object, file)) return serviceUnavailable();
  return new Response(object.body, { status: 200, headers: fileHeaders(file, req.cacheControl) });
}

function matchesManifest(object: R2Object, file: Artifact): boolean {
  if (object.size !== file.size) return false;
  const stored = object.checksums?.sha256;
  return stored === undefined || hexOf(stored) === file.sha256;
}

function fileHeaders(file: Artifact, cacheControl: string): Record<string, string> {
  return {
    "content-type": "application/octet-stream",
    "content-length": String(file.size),
    "content-disposition": `attachment; filename="${file.name}"`,
    etag: `"${file.sha256}"`,
    "cache-control": cacheControl,
    "x-content-type-options": "nosniff",
  };
}
