/**
 * Minimal Cloudflare Worker ambient types for standalone `tsc --noEmit` and
 * ts-jest. Not a runtime dependency; real deploys use wrangler's generated types.
 */

interface R2Object {
  key: string;
  size: number;
  checksums?: { sha256?: ArrayBuffer };
}

interface R2ObjectBody extends R2Object {
  body: ReadableStream;
  text(): Promise<string>;
}

interface R2Bucket {
  get(key: string): Promise<R2ObjectBody | null>;
  head(key: string): Promise<R2Object | null>;
}
