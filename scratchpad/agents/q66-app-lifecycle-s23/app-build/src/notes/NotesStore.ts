/**
 * Local markdown notes — not Memory facts.
 *
 * Files: documentDirectory/kalsa-notes/<id>.md
 * Index: documentDirectory/kalsa-notes/kalsa.notes.index.json
 *        { id, title, updatedAt }[]
 *
 * No SQLite. No embeddings. Keyword filter shares filterByTokens.
 */

import { filterByTokens } from "../util/filterByTokens";

export const NOTES_DIR_NAME = "kalsa-notes";
export const NOTES_INDEX_FILENAME = "kalsa.notes.index.json";
export const NOTE_TITLE_MAX = 48;
export const NOTE_BODY_CAP = 100_000;

export const NOTE_SEARCH_BLOB_CAP = 4_000;

export type NoteMeta = {
  id: string;
  title: string;
  updatedAt: number;
  searchBlob?: string;
};

export type Note = NoteMeta & { body: string };

export function notesDir(documentDirectory: string): string {
  const base = typeof documentDirectory === "string" ? documentDirectory : "";
  if (!base) throw new Error("NO_DOCUMENT_DIRECTORY");
  const prefix = base.endsWith("/") ? base : `${base}/`;
  return `${prefix}${NOTES_DIR_NAME}/`;
}

export function notesIndexPath(documentDirectory: string): string {
  return `${notesDir(documentDirectory)}${NOTES_INDEX_FILENAME}`;
}

export function sanitizeNoteId(id: string): string {
  if (typeof id !== "string") {
    throw new Error("note id required");
  }
  const safe = id.replace(/[^A-Za-z0-9._-]/g, "_");
  if (!safe) {
    throw new Error("empty note id");
  }
  return safe;
}

export function notePath(documentDirectory: string, id: string): string {
  return `${notesDir(documentDirectory)}${sanitizeNoteId(id)}.md`;
}

export function nextNoteId(): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `note-${Date.now()}-${rand}`;
}

function clipChars(text: string, max: number): string {
  const chars = Array.from(text);
  if (chars.length <= max) return chars.join("");
  return chars.slice(0, max).join("");
}

/** First line, trim, max ~48 chars. Empty → "". */
export function titleFromNoteBody(text: string): string {
  if (typeof text !== "string") return "";
  const firstLine = text.replace(/\r\n/g, "\n").split("\n")[0] ?? "";
  const trimmed = firstLine.trim();
  if (!trimmed) return "";
  return clipChars(trimmed, NOTE_TITLE_MAX);
}

export function sanitizeNoteBody(raw: string | null | undefined): string {
  if (typeof raw !== "string") return "";
  return raw.replace(/\u0000/g, "").slice(0, NOTE_BODY_CAP);
}

export function searchBlobFromNoteBody(text: string): string {
  if (typeof text !== "string") return "";
  const cleaned = text.replace(/\s+/g, " ").trim().toLowerCase();
  if (!cleaned) return "";
  return clipChars(cleaned, NOTE_SEARCH_BLOB_CAP);
}

export function parseNotesIndex(raw: string | null | undefined): NoteMeta[] {
  if (!raw || typeof raw !== "string") return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    const list = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === "object" && Array.isArray((parsed as { items?: unknown }).items)
        ? (parsed as { items: unknown[] }).items
        : null;
    if (!list) return [];
    const items: NoteMeta[] = [];
    const seen = new Set<string>();
    for (const item of list) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const o = item as Record<string, unknown>;
      if (typeof o.id !== "string" || o.id.length === 0) continue;
      let id: string;
      try {
        id = sanitizeNoteId(o.id);
      } catch {
        continue;
      }
      if (id !== o.id || seen.has(id)) continue;
      seen.add(id);
      items.push({
        id,
        title: typeof o.title === "string" ? o.title : "",
        updatedAt:
          typeof o.updatedAt === "number" && Number.isFinite(o.updatedAt)
            ? Math.floor(o.updatedAt)
            : 0,
        searchBlob: typeof o.searchBlob === "string" ? o.searchBlob : "",
      });
    }
    return items.sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

export function serializeNotesIndex(items: NoteMeta[]): string {
  const list = Array.isArray(items) ? items : [];
  return JSON.stringify(
    list.map((item) => ({
      id: item.id,
      title: typeof item.title === "string" ? item.title : "",
      updatedAt:
        typeof item.updatedAt === "number" && Number.isFinite(item.updatedAt)
          ? Math.floor(item.updatedAt)
          : 0,
      searchBlob: typeof item.searchBlob === "string" ? item.searchBlob : "",
    })),
  );
}

export function filterNotes(items: NoteMeta[], query: string): NoteMeta[] {
  const list = Array.isArray(items)
    ? items.slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    : [];
  return filterByTokens(list, query, (item) => [item.title, item.searchBlob]);
}

type NotesFs = {
  documentDirectory: string | null;
  makeDirectoryAsync(dir: string, opts: { intermediates: boolean }): Promise<void>;
  readAsStringAsync(uri: string): Promise<string>;
  writeAsStringAsync(uri: string, contents: string): Promise<void>;
  deleteAsync(uri: string, opts: { idempotent: boolean }): Promise<void>;
};

function getFs(): NotesFs {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const FileSystem = require("expo-file-system/legacy") as NotesFs;
  return FileSystem;
}

async function ensureNotesDir(fs: NotesFs): Promise<string> {
  const base = fs.documentDirectory;
  if (!base) throw new Error("NO_DOCUMENT_DIRECTORY");
  const dir = notesDir(base);
  try {
    await fs.makeDirectoryAsync(dir, { intermediates: true });
  } catch {
    /* exists */
  }
  return dir;
}

export async function loadNotesIndex(): Promise<NoteMeta[]> {
  const fs = getFs();
  try {
    await ensureNotesDir(fs);
    const raw = await fs.readAsStringAsync(notesIndexPath(fs.documentDirectory as string));
    return parseNotesIndex(raw);
  } catch {
    return [];
  }
}

async function writeIndex(fs: NotesFs, items: NoteMeta[]): Promise<void> {
  await fs.writeAsStringAsync(notesIndexPath(fs.documentDirectory as string), serializeNotesIndex(items));
}

/** Serialize index RMW so concurrent saveNote/deleteNote cannot clobber. */
let notesWriteChain: Promise<void> = Promise.resolve();

function enqueueNotesWrite<T>(run: () => Promise<T>): Promise<T> {
  const next = notesWriteChain.then(run, run);
  notesWriteChain = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

export async function readNote(id: string): Promise<Note | null> {
  const fs = getFs();
  let safe: string;
  try {
    safe = sanitizeNoteId(id);
  } catch {
    return null;
  }
  if (safe !== id) return null;
  try {
    await ensureNotesDir(fs);
    const body = sanitizeNoteBody(
      await fs.readAsStringAsync(notePath(fs.documentDirectory as string, safe)),
    );
    const index = await loadNotesIndex();
    const meta = index.find((item) => item.id === safe);
    return {
      id: safe,
      title: meta?.title || titleFromNoteBody(body),
      updatedAt: meta?.updatedAt ?? Date.now(),
      body,
    };
  } catch {
    return null;
  }
}

export async function saveNote(body: string, id?: string, nowMs: number = Date.now()): Promise<Note> {
  return enqueueNotesWrite(async () => {
    const fs = getFs();
    await ensureNotesDir(fs);
    const safe = id ? sanitizeNoteId(id) : nextNoteId();
    const cleaned = sanitizeNoteBody(body);
    const title = titleFromNoteBody(cleaned);
    const searchBlob = searchBlobFromNoteBody(cleaned);
    const updatedAt =
      typeof nowMs === "number" && Number.isFinite(nowMs) ? Math.floor(nowMs) : Date.now();
    await fs.writeAsStringAsync(notePath(fs.documentDirectory as string, safe), cleaned);
    const index = (await loadNotesIndex()).filter((item) => item.id !== safe);
    index.push({ id: safe, title, updatedAt, searchBlob });
    await writeIndex(fs, index);
    return { id: safe, title, updatedAt, body: cleaned };
  });
}

export async function deleteNote(id: string): Promise<void> {
  return enqueueNotesWrite(async () => {
    const fs = getFs();
    const safe = sanitizeNoteId(id);
    await ensureNotesDir(fs);
    try {
      await fs.deleteAsync(notePath(fs.documentDirectory as string, safe), { idempotent: true });
    } catch {
      /* missing file */
    }
    const index = (await loadNotesIndex()).filter((item) => item.id !== safe);
    await writeIndex(fs, index);
  });
}
