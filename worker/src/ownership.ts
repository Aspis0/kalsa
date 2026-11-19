const API = "https://api.github.com";
const HEADERS = { Accept: "application/vnd.github+json", "User-Agent": "kalsa-site" };
const REDIRECTS = new Set([301, 302, 307, 308]);

/**
 * Who may remove a page. Only a personal GitHub account whose numeric id matches; an organisation's
 * pages go to the mailbox instead. "missing" is a 404 — the repo or account is not on GitHub — and is
 * kept apart from "unreachable", a refusal or outage, so neither is reported as the other.
 */
export type Ownership = "owner" | "organisation" | "not_owner" | "missing" | "unreachable";

interface Account {
  id: string;
  login: string;
  type: string;
}

type Lookup = { kind: "ok"; payload: Record<string, unknown> } | { kind: "missing" } | { kind: "unreachable" };

export async function repoOwnership(repo: string, githubUserId: string): Promise<Ownership> {
  const found = await lookup(`${API}/repos/${repo}`);
  if (found.kind !== "ok") return found.kind;
  const owner = account(found.payload.owner);
  return owner ? classify(owner, githubUserId) : "unreachable";
}

export async function accountOwnership(login: string, githubUserId: string): Promise<Ownership> {
  const found = await lookup(`${API}/users/${login}`);
  if (found.kind !== "ok") return found.kind;
  const owner = account(found.payload);
  return owner ? classify(owner, githubUserId) : "unreachable";
}

function classify(found: Account, githubUserId: string): Ownership {
  if (found.type === "Organization") return "organisation";
  return found.id === githubUserId ? "owner" : "not_owner";
}

async function lookup(url: string): Promise<Lookup> {
  let response: Response;
  try {
    response = await followOnce(await fetch(url, { headers: HEADERS, redirect: "manual" }), url);
  } catch {
    return { kind: "unreachable" };
  }
  if (response.status === 404) return { kind: "missing" };
  if (!response.ok) return { kind: "unreachable" };
  const payload: unknown = await response.json().catch(() => null);
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return { kind: "unreachable" };
  return { kind: "ok", payload: payload as Record<string, unknown> };
}

/** A renamed repo answers 301 to its numeric id. One hop, and never off api.github.com. */
async function followOnce(response: Response, from: string): Promise<Response> {
  const location = response.headers.get("Location");
  if (!REDIRECTS.has(response.status) || !location) return response;
  let next: URL;
  try {
    next = new URL(location, from);
  } catch {
    return response;
  }
  if (next.origin !== API) return response;
  return fetch(next.toString(), { headers: HEADERS, redirect: "manual" });
}

function account(value: unknown): Account | null {
  if (typeof value !== "object" || value === null) return null;
  const { id, login, type } = value as Record<string, unknown>;
  if (typeof id !== "number" || !Number.isFinite(id) || typeof login !== "string" || typeof type !== "string") return null;
  return { id: String(id), login, type };
}
