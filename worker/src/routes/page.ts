import { findPage, readPages } from "../pages";
import { findRemoval } from "../removals";
import { json } from "../respond";
import { nowSeconds, readSessionUser } from "../session";

/**
 * What /remove/ reads on a fresh load. A live entry is public; a removed one is told only to the
 * account that removed it, which is what lets the owner undo after a reload without republishing
 * the entry to everyone else. Read-only and cheap: the allow-list is cached in the isolate and the
 * removal check is one indexed point read, so there is no limiter here for a third party to burn.
 */
export async function page(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const kind = url.searchParams.get("kind");
  const id = url.searchParams.get("id") ?? "";
  if (kind !== "engine" && kind !== "developer") return json({ error: "bad_request" }, 400);
  const pages = await readPages(env);
  if (!pages) return json({ error: "unavailable" }, 503);
  const target = findPage(pages, kind, id);
  if (!target) return json({ error: "unknown_page" }, 404);

  const entry = { kind: target.kind, id: target.id, name: target.name };
  const stored = await findRemoval(env.DB, target.kind, target.id);
  if (!stored) return json({ ...entry, removed: false });
  const user = await readSessionUser(env.DB, request, nowSeconds());
  if (!user || user.provider !== "github") return json({ error: "unauthorized" }, 401);
  if (user.providerUserId !== stored.githubUserId) return json({ error: "not_remover" }, 403);
  return json({ ...entry, removed: true });
}
