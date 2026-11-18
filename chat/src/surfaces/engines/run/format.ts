/** Sizes and short forms for the install pages. */

const MB = 1_000_000;
const GB = 1_000_000_000;

/** "17.3 MB" or "1.1 GB": decimal units, the way a download is reported. */
export function megabytes(bytes: number): string {
  return bytes >= GB ? `${(bytes / GB).toFixed(1)} GB` : `${(bytes / MB).toFixed(1)} MB`;
}

/** "3f9c1a2b…e038": enough to compare by eye, not the whole digest. */
export function shortSha(sha256: string): string {
  return sha256.length > 16 ? `${sha256.slice(0, 8)}…${sha256.slice(-4)}` : sha256;
}

/** The engine's own folder under Kalsa's engines root. The backend does not report it, so this is its documented place. */
export function engineFolder(id: string): string {
  return `~/Library/Application Support/Kalsa/engines/${id}/`;
}

/** "Exited with code 1" from the backend's own message, or plain "Exited". */
export function exitLabel(message: string | null): string {
  const code = message?.match(/code (-?\d+)/)?.[1];
  return code === undefined ? "Exited" : `Exited with code ${code}`;
}
