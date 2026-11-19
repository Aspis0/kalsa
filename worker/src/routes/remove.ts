import { rejectPost } from "../guard";
import { addressKey, withinLimit } from "../limits";
import { accountOwnership, repoOwnership } from "../ownership";
import { findPage, readPages, type Target } from "../pages";
import { addRemoval, deleteRemoval, findRemoval } from "../removals";
import { json } from "../respond";
import { nowSeconds, readSessionUser, type SessionUser } from "../session";

const PER_ACCOUNT = 30;
const PER_ADDRESS = 60;

export async function remove(request: Request, env: Env): Promise<Response> {
  const admitted = await admit(request, env);
  if ("refused" in admitted) return admitted.refused;
  const { user, target } = admitted;
  const ownership =
    target.kind === "engine" ? await repoOwnership(target.repo, user.providerUserId) : await accountOwnership(target.id, user.providerUserId);
  if (ownership === "organisation") return json({ error: "organisation" }, 403);
  if (ownership === "missing") return json({ error: "github_missing" }, 403);
  if (ownership === "not_owner") return json({ error: "not_owner" }, 403);
  if (ownership !== "owner") return json({ error: "github_unavailable" }, 502);
  await addRemoval(env.DB, target.kind, target.id, user.providerUserId, nowSeconds());
  return json({ ok: true });
}

/** Undo needs no GitHub call: the account that removed the page is recorded, and only it may put the page back. */
export async function undo(request: Request, env: Env): Promise<Response> {
  const admitted = await admit(request, env);
  if ("refused" in admitted) return admitted.refused;
  const { user, target } = admitted;
  const stored = await findRemoval(env.DB, target.kind, target.id);
  if (!stored) return json({ error: "not_removed" }, 404);
  if (stored.githubUserId !== user.providerUserId) return json({ error: "not_remover" }, 403);
  await deleteRemoval(env.DB, target.kind, target.id);
  return json({ ok: true });
}

type Admitted = { user: SessionUser; target: Target } | { refused: Response };

/** The same guard, limits, session and allow-list for both decisions. */
async function admit(request: Request, env: Env): Promise<Admitted> {
  const rejected = rejectPost(request, env.SITE_ORIGIN);
  if (rejected) return { refused: rejected };
  const now = nowSeconds();
  const address = await addressKey(request, env.SESSION_HMAC_KEY);
  if (!(await withinLimit(env.DB, `remove:ip:${address}`, PER_ADDRESS, now))) return { refused: json({ error: "rate_limited" }, 429) };
  const user = await readSessionUser(env.DB, request, now);
  if (!user) return { refused: json({ error: "unauthorized" }, 401) };
  if (user.provider !== "github") return { refused: json({ error: "github_required" }, 401) };
  if (!(await withinLimit(env.DB, `remove:user:${user.providerUserId}`, PER_ACCOUNT, now))) return { refused: json({ error: "rate_limited" }, 429) };

  const asked = await readBody(request);
  if (!asked) return { refused: json({ error: "bad_request" }, 400) };
  const pages = await readPages(env);
  if (!pages) return { refused: json({ error: "unavailable" }, 503) };
  const target = findPage(pages, asked.kind, asked.id);
  return target ? { user, target } : { refused: json({ error: "unknown_page" }, 404) };
}

async function readBody(request: Request): Promise<{ kind: "engine" | "developer"; id: string } | null> {
  const payload: unknown = await request.json().catch(() => null);
  if (typeof payload !== "object" || payload === null) return null;
  const { kind, id } = payload as Record<string, unknown>;
  if ((kind !== "engine" && kind !== "developer") || typeof id !== "string" || id.length < 1 || id.length > 200) return null;
  return { kind, id };
}
