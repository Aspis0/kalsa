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
  /** Absolute epoch ms; a time in the past fires the alarm as soon as it can. */
  setAlarm(scheduledTime: number): Promise<void>;
  getAlarm(): Promise<number | null>;
  deleteAlarm(): Promise<void>;
}

interface DurableObjectState {
  storage: DurableObjectStorage;
  /** Runs `callback` before the object serves anything, holding it locked
   *  until the promise resolves. */
  blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T>;
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
