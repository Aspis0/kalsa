// The typed door to the four disk commands (src-tauri/src/files.rs). The
// shapes here are the Rust DTOs as serde sends them; nothing invents a
// field the other side does not write.

import { invoke } from "./tauri";

/** One row of a folder listing, as `kalsa_files::Entry` crosses the wire. */
export interface DiskEntry {
  name: string;
  path: string;
  is_dir: boolean;
  kind: "text" | "pdf" | "docx" | "pptx" | "other";
  bytes: number;
  modified_ms: number | null;
}

export interface DiskListing {
  path: string;
  entries: DiskEntry[];
  truncated: boolean;
  /** Children the OS would not let Rust read. Zero means the folder's
   *  answer is complete; anything else belongs on screen. */
  skipped: number;
}

export interface DiskRoots {
  roots: string[];
  home: string | null;
}

export interface SearchHit {
  name: string;
  path: string;
  is_dir: boolean;
  kind: DiskEntry["kind"];
  score: number;
}

/** One batch on the `brain_files_search` event. `id` is the page-chosen
 *  generation of the search — the same words submitted twice are two
 *  searches, and a late batch from the replaced one must be dropped even
 *  though its `query` spells the same. */
export interface SearchEvent {
  id: number;
  query: string;
  matches: SearchHit[];
  skipped: number;
  limited: boolean;
  done: boolean;
  /** The done event only: the index answered. */
  via_index?: boolean;
}

export interface SearchSummary {
  id: number;
  hits: number;
  skipped: number;
  limited: boolean;
  cancelled: boolean;
  /** The Spotlight index answered. It is fast and blind at once, so the
   *  page owes the owner that fewer results means less was searched. */
  via_index: boolean;
}

export function filesRoots(): Promise<DiskRoots> {
  return invoke("brain_files_roots") as Promise<DiskRoots>;
}

export function filesList(path: string): Promise<DiskListing> {
  return invoke("brain_files_list", { path }) as Promise<DiskListing>;
}

// Raw bytes, not text: the page wraps them in a File and runs the extractor
// it already has, so one parser per format stays the rule.
export async function filesRead(path: string): Promise<Uint8Array> {
  const raw = await invoke("brain_files_read", { path });
  if (raw instanceof ArrayBuffer) return new Uint8Array(raw);
  if (Array.isArray(raw)) return Uint8Array.from(raw as number[]);
  throw new Error("the bytes came back in a shape the page cannot read");
}

export function filesSearch(id: number, query: string, scope: string): Promise<SearchSummary> {
  return invoke("brain_files_search", { id, query, scope }) as Promise<SearchSummary>;
}
