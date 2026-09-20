import { useEffect, useRef, useState } from "react";
import { available, listen } from "../lib/tauri";
import { filesList, filesRoots, filesSearch } from "../lib/files";
import type { DiskEntry, SearchEvent, SearchHit } from "../lib/files";
import "./FilesBrowser.css";

interface FilesBrowserProps {
  /** Read the bytes and run the same attach path the composer uses. */
  onAttach: (path: string, name: string) => void;
}

/** A folder's rows while its listing is loading, or the sentence the disk
 *  answered with when it refused. */
type Folder = DiskEntry[] | "loading" | { error: string };

/** How deep the tree may render. The cycle guard below is the correctness
 *  fix; this is its backstop — a legal tree this deep is not a tree a
 *  300-pixel panel was ever going to show usefully. */
const MAX_DEPTH = 24;

/** Bytes as a quiet label — a courtesy, not an audit. */
function sizeOf(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value >= 10 ? Math.round(value) : Math.round(value * 10) / 10} ${units[unit]}`;
}

/**
 * The computer's half of the files panel: the roots, a tree, and a search
 * that answers as it finds. Everything disk-shaped goes through the four
 * Rust commands; outside the desktop app this component says so and does
 * nothing, the same rule every surface follows.
 */
export function FilesBrowser({ onAttach }: FilesBrowserProps) {
  const [starters, setStarters] = useState<{ label: string; path: string }[]>([]);
  const [folders, setFolders] = useState<Record<string, Folder>>({});
  const [truncated, setTruncated] = useState<Record<string, boolean>>({});
  const [folderSkipped, setFolderSkipped] = useState<Record<string, number>>({});
  const [scope, setScope] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [notes, setNotes] = useState<{ skipped: number; limited: boolean; viaIndex: boolean } | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  // The generation of the search the results on screen belong to. A batch
  // whose id is not this one is a late arrival from a search the user
  // already replaced — including a replaced search with the SAME words,
  // which is why the id exists at all.
  const liveId = useRef<number | null>(null);
  const liveScope = useRef<string | null>(null);
  const byPath = useRef(new Map<string, SearchHit>());
  const nextId = useRef(1);
  const disk = available();

  // The search streams on the bus; subscribed for the component's whole
  // life and unsubscribed on unmount — a listener left behind is this
  // repo's oldest leak, and this panel must not add another. The detach is
  // resolved asynchronously, so unmounting before it settles must still
  // detach the moment it does — otherwise a second mount's subscription
  // gets deleted by the first mount's late cleanup (StrictMode exposes
  // exactly this ordering on every dev mount).
  useEffect(() => {
    if (!disk) return;
    let gone = false;
    let detach = () => {};
    void listen("brain_files_search", (payload) => {
      const event = payload as SearchEvent | null;
      if (!event || typeof event.id !== "number" || !Array.isArray(event.matches)) return;
      if (event.id !== liveId.current) return;
      for (const hit of event.matches) byPath.current.set(hit.path, hit);
      setHits([...byPath.current.values()].sort((a, b) => b.score - a.score));
      if (event.done) setNotes({ skipped: event.skipped, limited: event.limited, viaIndex: event.via_index === true });
    }).then((remove) => {
      if (gone) remove();
      else detach = remove;
    });
    return () => {
      gone = true;
      detach();
    };
  }, [disk]);

  // Unmounting stops more than the listening: a whole-disk walk or an
  // mdfind child with nobody watching it is the machine's battery spent on
  // an answer nobody will see. The empty query is the documented stop.
  useEffect(() => {
    return () => {
      if (liveId.current !== null && available()) {
        void filesSearch(liveId.current, "", liveScope.current ?? "").catch(() => {});
      }
    };
  }, []);

  useEffect(() => {
    if (!disk) return;
    void filesRoots()
      .then((found) => {
        setStarters([
          ...(found.home ? [{ label: "Home", path: found.home }] : []),
          ...found.roots.map((path) => ({ label: path, path })),
        ]);
        setScope(found.home ?? found.roots[0] ?? null);
        liveScope.current = found.home ?? found.roots[0] ?? null;
      })
      .catch(() => setStarters([]));
  }, [disk]);

  async function toggleFolder(path: string): Promise<void> {
    if (Array.isArray(folders[path])) {
      setFolders((prev) => {
        const next = { ...prev };
        delete next[path];
        return next;
      });
      return;
    }
    setFolders((prev) => ({ ...prev, [path]: "loading" }));
    try {
      const listing = await filesList(path);
      setFolders((prev) => ({ ...prev, [path]: listing.entries }));
      setTruncated((prev) => ({ ...prev, [path]: listing.truncated }));
      setFolderSkipped((prev) => ({ ...prev, [path]: listing.skipped }));
    } catch (error) {
      setFolders((prev) => ({
        ...prev,
        [path]: { error: error instanceof Error ? error.message : String(error) },
      }));
    }
  }

  /** Results belong to one scope: moving the search elsewhere clears the
   *  board, so nothing on screen can claim a scope it did not search. */
  function searchIn(path: string): void {
    setScope(path);
    liveScope.current = path;
    if (liveId.current !== null && disk) {
      void filesSearch(liveId.current, "", liveScope.current ?? "").catch(() => {});
    }
    liveId.current = null;
    byPath.current = new Map();
    setHits([]);
    setNotes(null);
    setSearchError(null);
    setSearching(false);
  }

  async function runSearch(text: string): Promise<void> {
    const words = text.trim();
    const id = nextId.current++;
    liveId.current = id;
    byPath.current = new Map();
    setHits([]);
    setNotes(null);
    setSearchError(null);
    if (!scope) return;
    setSearching(true);
    try {
      // An empty query still crosses: the Rust side reads it as "stop
      // whatever is running", which is the stop control for a search.
      const summary = await filesSearch(id, words, scope);
      // The summary is the run's last word: only it knows whether the
      // index answered, and a run whose events were all dropped (a fast
      // supersede) must not stamp its verdict on the next one's screen.
      if (liveId.current === id) {
        setNotes({ skipped: summary.skipped, limited: summary.limited, viaIndex: summary.via_index });
      }
    } catch (error) {
      if (liveId.current === id) {
        setSearchError(error instanceof Error ? error.message : String(error));
      }
    } finally {
      if (liveId.current === id) setSearching(false);
    }
  }

  function rowOf(entry: DiskEntry, depth: number, ancestors: ReadonlySet<string>) {
    const state = folders[entry.path];
    // The cycle guard. Expansion is a flat map keyed by path, so a link
    // that resolves back up the tree (`self -> .`) makes the SAME path
    // appear at every nesting level — and every copy of an expanded row
    // renders its children, forever. The ancestor chain is checked, not a
    // global visited set: canonicalisation gives each level a unique
    // path, so "have I seen this path anywhere" never fires, while "is
    // this path my own ancestor" fires exactly at the loop.
    const open = Array.isArray(state) && !ancestors.has(entry.path) && depth < MAX_DEPTH;
    const below = open ? new Set(ancestors).add(entry.path) : ancestors;
    return (
      <li key={entry.path} className="files-row">
        <div className="files-line" style={{ paddingLeft: `${Math.min(depth, 8) * 14 + 4}px` }}>
          {entry.is_dir ? (
            <>
              <button
                type="button"
                className="files-open"
                aria-expanded={open}
                onClick={() => void toggleFolder(entry.path)}
              >
                <span className="files-caret" aria-hidden="true">
                  {open ? "▾" : "▸"}
                </span>
                <span className="files-name">{entry.name}</span>
              </button>
              <button type="button" className="files-here" onClick={() => searchIn(entry.path)}>
                Search here
              </button>
            </>
          ) : (
            <>
              <span className="files-name" title={entry.path}>
                {entry.name}
              </span>
              <span className="files-size">{sizeOf(entry.bytes)}</span>
              {entry.kind !== "other" ? (
                <button
                  type="button"
                  className="files-attach"
                  onClick={() => onAttach(entry.path, entry.name)}
                >
                  Attach
                </button>
              ) : null}
            </>
          )}
        </div>
        {open ? (
          <ul className="files-children">{(state as DiskEntry[]).map((child) => rowOf(child, depth + 1, below))}</ul>
        ) : null}
        {state === "loading" ? <p className="files-note">Reading the folder…</p> : null}
        {state && typeof state === "object" && !Array.isArray(state) ? (
          <p className="files-note">{state.error}</p>
        ) : null}
        {open && truncated[entry.path] ? (
          <p className="files-note">First 500 of this folder shown, alphabetically.</p>
        ) : null}
        {open && folderSkipped[entry.path] > 0 ? (
          <p className="files-note">{folderSkipped[entry.path]} entries here could not be read.</p>
        ) : null}
      </li>
    );
  }

  if (!disk) {
    return (
      <p className="files-empty">
        This tab browses this computer’s disk, which only the desktop app can do.
      </p>
    );
  }

  return (
    <div className="files">
      <form
        className="files-search"
        onSubmit={(event) => {
          event.preventDefault();
          void runSearch(query);
        }}
      >
        <input
          className="files-input"
          type="text"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search by name or path"
          aria-label="Search by name or path"
        />
        <button type="submit" className="files-go">
          Search
        </button>
      </form>
      <p className="files-scope-line">
        {scope ? `Searching in ${scope}${searching ? " — looking…" : ""}` : "No folder to search in yet."}
        {searchError ? ` ${searchError}` : ""}
      </p>
      {notes ? (
        <p className="files-notes">
          {notes.viaIndex ? "Answered by this Mac’s fast index — files the index skips (dotfiles, some folders) are missing from these results. " : ""}
          {notes.skipped > 0 ? `Skipped ${notes.skipped} entries the system would not show. ` : ""}
          {notes.limited ? "First 500 shown — narrower words reach the rest." : ""}
        </p>
      ) : null}

      {hits.length > 0 ? (
        <ul className="files-results">
          {hits.map((hit) => (
            <li key={hit.path} className="files-line">
              <span className="files-name" title={hit.path}>
                {hit.name}
              </span>
              <span className="files-size">{hit.is_dir ? "folder" : hit.kind}</span>
              {hit.kind !== "other" ? (
                <button
                  type="button"
                  className="files-attach"
                  onClick={() => onAttach(hit.path, hit.name)}
                >
                  Attach
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {starters.length === 0 ? (
        <p className="files-note">Reading this computer’s folders…</p>
      ) : (
        <ul className="files-tree">
          {starters.map((starter) => rowOf({ ...stubEntry(starter.path), name: starter.label }, 0, new Set()))}
        </ul>
      )}
    </div>
  );
}

/** A root row reuses the folder row: it opens, and `is_dir` is all the row
 *  needs to know about it. */
function stubEntry(path: string): DiskEntry {
  return { name: path, path, is_dir: true, kind: "other", bytes: 0, modified_ms: null };
}
