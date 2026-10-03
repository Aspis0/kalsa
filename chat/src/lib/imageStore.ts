/**
 * The IndexedDB home of attached image bytes. A message carries only the
 * reference (id, size, mime — `types.ts`); the pixels live here, one record
 * per image, so the conversation's localStorage never grows a base64
 * payload. Deleting a conversation takes its images with it.
 */

const DB_NAME = "kalsa-chat.images";
const DB_VERSION = 1;
const STORE = "images";
const CONV_INDEX = "by-conversation";

interface ImageRecord {
  id: string;
  convId: string;
  mime: string;
  bytes: ArrayBuffer;
}

function requestAsPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("indexeddb"));
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const open = indexedDB.open(DB_NAME, DB_VERSION);
    open.onupgradeneeded = () => {
      const store = open.result.createObjectStore(STORE, { keyPath: "id" });
      store.createIndex(CONV_INDEX, "convId", { unique: false });
    };
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error ?? new Error("indexeddb"));
  });
  try {
    const tx = db.transaction(STORE, mode);
    return await requestAsPromise(run(tx.objectStore(STORE)));
  } finally {
    db.close();
  }
}

/** The record keeps BYTES, not a Blob: WebKit refuses to put a Blob that no
    file backs ("Error preparing Blob/File data…"), and a re-encoded picture
    is exactly that. The Blob is re-wrapped on the way out. */
export async function putImage(convId: string, id: string, mime: string, blob: Blob): Promise<void> {
  const record: ImageRecord = { id, convId, mime, bytes: await blob.arrayBuffer() };
  await withStore("readwrite", (store) => store.put(record));
}

export async function getImage(id: string): Promise<Blob | null> {
  try {
    const record = await withStore<ImageRecord | undefined>("readonly", (store) =>
      store.get(id),
    );
    if (!record) return null;
    return new Blob([record.bytes], { type: record.mime });
  } catch {
    // Unreadable storage is the placeholder's case, not a crash: the caller
    // renders "unavailable" and the conversation carries on.
    return null;
  }
}

/** Best effort: a delete that fails leaves a byte no message names. */
export async function deleteImage(id: string): Promise<void> {
  try {
    await withStore("readwrite", (store) => store.delete(id));
  } catch {
    // Ignored on purpose.
  }
}

export async function deleteConversationImages(convId: string): Promise<void> {
  try {
    const keys = await withStore<IDBValidKey[]>("readonly", (store) =>
      store.index(CONV_INDEX).getAllKeys(convId),
    );
    for (const key of keys) {
      await withStore("readwrite", (store) => store.delete(key));
    }
  } catch {
    // Ignored on purpose: the conversation itself is already gone.
  }
}
