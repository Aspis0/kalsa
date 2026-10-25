/**
 * Minimal Cloudflare Worker ambient types for standalone `tsc --noEmit` and
 * ts-jest (pulled in by the reference in index.ts). Not a runtime dependency;
 * real deploys use wrangler's generated types.
 */

interface R2PutOptions {
  onlyIf?: { etagDoesNotMatch?: string };
  httpMetadata?: { contentType?: string };
  customMetadata?: Record<string, string>;
}

interface R2Bucket {
  put(key: string, value: Uint8Array, options?: R2PutOptions): Promise<unknown>;
  list(options: { prefix: string; limit: number }): Promise<{ objects: unknown[] }>;
}

interface RateLimit {
  limit(request: { key: string }): Promise<{ success: boolean }>;
}
