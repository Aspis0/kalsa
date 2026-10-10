/**
 * The paths this Worker answers, in two scopes: the tester link
 * (`/download/<LINK_KEY>/…`) and the desktop updater (`/download/update/<UPDATE_KEY>/…`).
 * A path that matches neither parses to null. The key is only the first
 * segment; it is checked by admission.ts.
 */
import type { Platform } from "./manifest";

export const ZONE_HOST = "kalsa.io";

export type Route =
  | { kind: "page" }
  | { kind: "installer"; platform: Platform }
  | { kind: "update-check"; target: string; arch: string; current: string }
  | { kind: "artifact"; platform: Platform };
export type Scope = "link" | "update";
export type Parsed = { route: Route; scope: Scope; candidate: string };

const isPlatform = (value: string | undefined): value is Platform => value === "windows" || value === "mac";

export function parseRoute(pathname: string): Parsed | null {
  const [, root, first, ...rest] = pathname.split("/");
  if (root !== "download" || !first) return null;
  return first === "update" ? parseUpdate(rest) : parseLink(first, rest);
}

function parseLink(key: string, rest: string[]): Parsed | null {
  const [only] = rest;
  if (rest.length === 0 || (rest.length === 1 && only === "")) {
    return { route: { kind: "page" }, scope: "link", candidate: key };
  }
  if (rest.length === 1 && isPlatform(only)) {
    return { route: { kind: "installer", platform: only }, scope: "link", candidate: key };
  }
  return null;
}

function parseUpdate(rest: string[]): Parsed | null {
  const [key, ...tail] = rest;
  if (!key) return null;
  const [first, second] = tail;
  if (first === "artifact") {
    return tail.length === 2 && isPlatform(second)
      ? { route: { kind: "artifact", platform: second }, scope: "update", candidate: key }
      : null;
  }
  if (tail.length === 3 && tail.every((part) => part !== "")) {
    const [target, arch, current] = tail;
    return { route: { kind: "update-check", target, arch, current }, scope: "update", candidate: key };
  }
  return null;
}

export function linkBase(key: string): string {
  return `/download/${key}`;
}

export function installerPath(key: string, platform: Platform): string {
  return `${linkBase(key)}/${platform}`;
}

/** Absolute, because the updater downloads it from whatever host it was given. */
export function artifactUrl(updateKey: string, platform: Platform): string {
  return `https://${ZONE_HOST}/download/update/${updateKey}/artifact/${platform}`;
}
