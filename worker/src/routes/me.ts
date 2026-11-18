import { json } from "../respond";
import { nowSeconds, readSession } from "../session";

export async function me(request: Request, env: Env): Promise<Response> {
  const account = await readSession(env.DB, request, nowSeconds());
  if (!account) return json({ error: "unauthorized" }, 401);
  return json(account);
}
