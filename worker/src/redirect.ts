/** Sections a signed-in visitor may be sent back to. Anything else falls back to the home page. */
const SECTIONS = [
  "/signin/",
  "/submit/",
  "/engines/",
  "/hardware/",
  "/listed-and-community/",
  "/app/",
  "/dev/",
  "/remove/",
];

/**
 * Only a same-origin relative path survives. "//host" and "/\host" are protocol-relative to a
 * browser, a scheme or an authority is not a path at all, and ".." could climb out of a section.
 */
export function safeNext(raw: string | null): string {
  if (!raw) return "/";
  if (!raw.startsWith("/") || raw.startsWith("//")) return "/";
  if (raw.includes("\\") || raw.includes("..") || raw.includes("#")) return "/";
  if (/[\u0000-\u0020\u007f]/.test(raw)) return "/";
  const path = raw.split("?")[0] ?? "";
  if (path === "/") return raw;
  const allowed = SECTIONS.some((section) => path === section.slice(0, -1) || path.startsWith(section));
  return allowed ? raw : "/";
}
