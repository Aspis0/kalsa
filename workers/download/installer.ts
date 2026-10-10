/**
 * The installer routes behind the tester link. A URL names the installer's sha256
 * as `?v=`; any other URL redirects to the current one. The bytes come from file.ts.
 */
import { notFound, redirect } from "./http";
import type { Installer } from "./manifest";
import { serveFile } from "./file";

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
  return serveFile(bucket, installer, {
    method: req.method,
    ifNoneMatch: req.ifNoneMatch,
    cacheControl: "private, no-cache",
  });
}
