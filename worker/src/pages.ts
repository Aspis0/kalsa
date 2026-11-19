export interface EnginePage {
  id: string;
  name: string;
  repo: string;
  hardware: string[];
}

export interface DeveloperPage {
  login: string;
  name: string;
}

export interface Pages {
  engines: EnginePage[];
  developers: DeveloperPage[];
}

/** A page the allow-list names, in the catalog's own spelling. */
export type Target =
  | { kind: "engine"; id: string; name: string; repo: string }
  | { kind: "developer"; id: string; name: string };

const PAGES_TTL_SECONDS = 60;
let cached: { at: number; pages: Pages } | null = null;

/**
 * The allow-list the generator writes beside the pages. It changes only on a deploy, so a short
 * in-isolate cache is enough and bounds the window where a warm isolate still holds the old list.
 * An unreadable list is not cached: the next request tries again, and removals fail closed.
 */
export async function readPages(env: Env): Promise<Pages | null> {
  const now = Math.floor(Date.now() / 1000);
  if (cached && now - cached.at < PAGES_TTL_SECONDS) return cached.pages;
  let response: Response;
  try {
    response = await env.ASSETS.fetch(new Request(`${env.SITE_ORIGIN}/pages.json`));
  } catch {
    // An assets failure is not a reason to 5xx a page: the caller strips what it knows from D1.
    return null;
  }
  if (!response.ok) return null;
  const parsed = parse(await response.json().catch(() => null));
  if (parsed) cached = { at: now, pages: parsed };
  return parsed;
}

/** Only an id the generated site lists is accepted, and the canonical spelling is the one used. */
export function findPage(pages: Pages, kind: "engine" | "developer", id: string): Target | null {
  if (kind === "engine") {
    const engine = pages.engines.find((row) => row.id.toLowerCase() === id.toLowerCase());
    return engine ? { kind, id: engine.id, name: engine.name, repo: engine.repo } : null;
  }
  const developer = pages.developers.find((row) => row.login.toLowerCase() === id.toLowerCase());
  return developer ? { kind, id: developer.login, name: developer.name } : null;
}

function parse(payload: unknown): Pages | null {
  if (typeof payload !== "object" || payload === null) return null;
  const { engines, developers } = payload as Record<string, unknown>;
  if (!Array.isArray(engines) || !Array.isArray(developers)) return null;
  const rows = engines.filter((row): row is EnginePage => {
    const engine = row as Partial<EnginePage>;
    return typeof engine?.id === "string" && typeof engine.name === "string" && typeof engine.repo === "string" && Array.isArray(engine.hardware);
  });
  const devs = developers.filter((row): row is DeveloperPage => {
    const developer = row as Partial<DeveloperPage>;
    return typeof developer?.login === "string" && typeof developer.name === "string";
  });
  return rows.length === engines.length && devs.length === developers.length ? { engines: rows, developers: devs } : null;
}

/** The GitHub login that owns a repository, as the catalog spells it. */
export function ownerLogin(repo: string): string {
  return (repo.split("/")[0] ?? "").toLowerCase();
}
