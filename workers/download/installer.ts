/**
 * The installer routes behind the secret link. A URL names the installer's
 * sha256 as `?v=`; any other URL redirects to the current one. Bytes are served
 * only when they match the manifest's size and, if R2 carries one, its sha256.
 */
import { hexOf } from "./hash";
import { notFound, notModified, redirect, serviceUnavailable } from "./http";
import type { Installer } from "./manifest";

export type InstallerRequest = {
  method: "GET" | "HEAD";
  /** The keyed path of this installer, without the query. */
  path: string;
  requestedSha: string | null;
  ifNoneMatch: string | null;
};

export async function installerResponse(
  bucket: R2Bucket,
  installer: Installer | null,
  req: InstallerRequest,
): Promise<Response> {
  if (installer === null) return notFound();
  if (req.requestedSha !== installer.sha256) return redirect(`${req.path}?v=${installer.sha256}`);
  const etag = `"${installer.sha256}"`;
  if (req.ifNoneMatch === etag) return notModified(etag);
  if (req.method === "HEAD") {
    const object = await bucket.head(installer.key);
    if (object === null) return notFound();
    if (!matchesManifest(object, installer)) return serviceUnavailable();
    return new Response(null, { status: 200, headers: fileHeaders(installer) });
  }
  const object = await bucket.get(installer.key);
  if (object === null) return notFound();
  if (!matchesManifest(object, installer)) return serviceUnavailable();
  return new Response(object.body, { status: 200, headers: fileHeaders(installer) });
}

function matchesManifest(object: R2Object, installer: Installer): boolean {
  if (object.size !== installer.size) return false;
  const stored = object.checksums?.sha256;
  return stored === undefined || hexOf(stored) === installer.sha256;
}

function fileHeaders(installer: Installer): Record<string, string> {
  return {
    "content-type": "application/octet-stream",
    "content-length": String(installer.size),
    "content-disposition": `attachment; filename="${installer.name}"`,
    etag: `"${installer.sha256}"`,
    "cache-control": "private, no-cache",
    "x-content-type-options": "nosniff",
  };
}
