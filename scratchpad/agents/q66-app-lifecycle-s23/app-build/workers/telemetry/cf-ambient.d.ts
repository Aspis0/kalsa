/**
 * Minimal Cloudflare Worker ambient types for standalone `tsc --noEmit`.
 * Not a runtime dependency. Real deploys use wrangler's generated types.
 */

interface KVNamespace {
  get(key: string): Promise<string | null>;
  put(
    key: string,
    value: string,
    options?: { expirationTtl?: number },
  ): Promise<void>;
}

interface DurableObjectId {
  toString(): string;
}

interface DurableObjectStub {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

interface DurableObjectNamespace {
  idFromName(name: string): DurableObjectId;
  get(id: DurableObjectId): DurableObjectStub;
}

interface DurableObjectTransaction {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
}

interface DurableObjectStorage {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
  transaction<T>(
    closure: (txn: DurableObjectTransaction) => Promise<T>,
  ): Promise<T>;
}

interface DurableObjectState {
  storage: DurableObjectStorage;
}

interface DurableObject {
  fetch(request: Request): Promise<Response>;
}

declare const DurableObject: {
  prototype: DurableObject;
  new (state: DurableObjectState, env?: unknown): DurableObject;
};

interface Crypto {
  randomUUID(): string;
  subtle: SubtleCrypto;
}
