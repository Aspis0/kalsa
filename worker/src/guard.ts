import { json } from "./respond";

/** State-changing routes are POST, JSON only, and must come from the configured site origin. */
export function rejectPost(request: Request, siteOrigin: string): Response | null {
  if (request.headers.get("Origin") !== siteOrigin) return json({ error: "forbidden" }, 403);
  const contentType = request.headers.get("Content-Type") ?? "";
  if (contentType.split(";")[0]?.trim().toLowerCase() !== "application/json") {
    return json({ error: "unsupported_media_type" }, 415);
  }
  return null;
}
