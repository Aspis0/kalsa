import { rejectPost } from "../guard";
import { json } from "../respond";
import { closeSession } from "../session";

export async function signout(request: Request, env: Env): Promise<Response> {
  const rejected = rejectPost(request, env.SITE_ORIGIN);
  if (rejected) return rejected;
  return json({ ok: true }, 200, [await closeSession(env.DB, request)]);
}
