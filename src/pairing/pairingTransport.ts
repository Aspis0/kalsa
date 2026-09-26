import { bytesToHex, hexToBytes, sha256, utf8Bytes } from "./sha256";
import {
  canonicalPhoneJson,
  openCredentialSeal,
  phoneMacPayload,
  phoneMacHex,
  type PairingPhoneDeclaration,
} from "./pairingWire";
import { logPairingFail } from "./pairingFailLog";

const MAX_BODY_BYTES = 8 * 1024;
const MAX_HEAD_BYTES = 8 * 1024;
const DELIVERY_TOKEN_BYTES = 16;

export type PairingResponse = {
  status: number;
  json: () => Promise<unknown>;
};

export type PairingRequestInit = {
  method: "POST";
  headers: Record<string, string>;
  body: string;
};

export type PairingFetch = (url: string, init: PairingRequestInit) => Promise<PairingResponse>;
export type RandomBytes = (length: number) => Uint8Array;

export type PairingDiagnostic =
  | {
      event: "pairing.signed_request";
      payload_hex: string;
      mac_hex: string;
      delivery_token_hex: string;
    }
  | {
      event: "pairing.sealed_response";
      ciphertext_hex: string;
      credential_sha256_hex: string;
    }
  | {
      event: "pairing.retry_refused_after_timeout";
      diagnosis: "desk_may_have_spent_delivery_after_lost_response";
      recovery: "request_fresh_square";
    };

export type PairingSquare = {
  reachable: string;
  code: string;
  nonce: string;
  node: string;
};

export type PairingSessionOptions = {
  deskUrl: string;
  square: PairingSquare;
  phone: PairingPhoneDeclaration;
  fetcher?: PairingFetch;
  randomBytes?: RandomBytes;
  onDiagnostic?: (record: PairingDiagnostic) => void;
};

function secureRandomBytes(length: number): Uint8Array {
  // Hermes has no Web Crypto global, and expo's winter runtime installs URL,
  // fetch and the text codecs but never crypto, so the release runtime reach-
  // es this function with no globalThis.crypto. expo-crypto's getRandomBytes
  // is the platform CSPRNG. The require is lazy: expo-crypto's JS needs
  // native modules the Node test environment lacks, and tests inject
  // randomBytes instead.
  const { getRandomBytes } = require("expo-crypto") as typeof import("expo-crypto");
  return getRandomBytes(length);
}

function pairUrl(deskUrl: string, route: "claim" | "complete"): string {
  const base = new URL(deskUrl);
  if (base.protocol !== "http:" && base.protocol !== "https:") throw new Error("invalid URL");
  if (base.username || base.password) throw new Error("invalid URL");
  base.pathname = `/pair/${route}`;
  base.search = "";
  base.hash = "";
  return base.toString();
}

/** Shared request boundary: byte-count and body cap are checked before fetch. */
export async function postPairingJson(
  url: string,
  body: string,
  fetcher: PairingFetch = globalThis.fetch as PairingFetch,
): Promise<
  | { ok: true; response: PairingResponse }
  | { ok: false; reason: "request_too_large" | "network" }
> {
  try {
    const contentLength = utf8Bytes(body).byteLength;
    // The caller must distinguish a refusal before any network call from a
    // lost one, so each null path names its reason.
    if (contentLength > MAX_BODY_BYTES) return { ok: false, reason: "request_too_large" };
    const parsed = new URL(url);
    const head = `POST ${parsed.pathname}${parsed.search} HTTP/1.1\r\nHost: ${parsed.host}\r\nContent-Type: application/json\r\nConnection: close\r\nContent-Length: ${contentLength}\r\n\r\n`;
    if (utf8Bytes(head).byteLength > MAX_HEAD_BYTES) return { ok: false, reason: "request_too_large" };
    const response = await fetcher(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Connection: "close",
        "Content-Length": String(contentLength),
      },
      body,
    });
    return { ok: true, response };
  } catch {
    // The wire provides no useful failure class. The caller sees one refusal.
    return { ok: false, reason: "network" };
  }
}

function isSeal(value: unknown): value is { credential_ciphertext: string; mac: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const body = value as Record<string, unknown>;
  return typeof body.credential_ciphertext === "string" && typeof body.mac === "string";
}

/** One pairing ceremony. A no-response completion can be retried on this object. */
export class PairingSession {
  private readonly deliveryToken: string;
  private readonly fetcher: PairingFetch;
  private completeRetryPending = false;
  private finished = false;
  // Built alongside the claim URL in begin(); complete() replays it so a
  // desk URL problem always surfaces as claim_url, never mid-completion.
  private completeUrl = "";

  constructor(private readonly options: PairingSessionOptions) {
    const random = options.randomBytes ?? secureRandomBytes;
    let bytes: Uint8Array;
    try {
      bytes = random(DELIVERY_TOKEN_BYTES);
    } catch {
      logPairingFail("random", null);
      throw new Error("secure random source unavailable");
    }
    if (bytes.length !== DELIVERY_TOKEN_BYTES) {
      logPairingFail("random", null);
      throw new Error("invalid random source");
    }
    this.deliveryToken = bytesToHex(bytes);
    this.fetcher = options.fetcher ?? (globalThis.fetch as PairingFetch);
  }

  private logDiagnostic(record: PairingDiagnostic): void {
    try {
      this.options.onDiagnostic?.(record);
    } catch {
      // Diagnostics must never change the pairing outcome.
    }
  }

  needsCompletionRetry(): boolean {
    return this.completeRetryPending && !this.finished;
  }

  async begin(): Promise<Uint8Array | null> {
    if (this.finished || this.completeRetryPending) return null;
    try {
      if (!/^[0-9a-f]{32}$/.test(this.options.square.code)) throw new Error("invalid code");
      const code = hexToBytes(this.options.square.code);
      const nonce = hexToBytes(this.options.square.nonce);
      if (code.length !== 16 || nonce.length !== 32) throw new Error("invalid square");
      // Validate the signed fields and canonical declaration before claiming
      // the one-shot code at the desk.
      phoneMacHex(this.options.square.code, this.options.square.nonce, {
        reachable: this.options.square.reachable,
        node: this.options.square.node,
        deliveryToken: this.deliveryToken,
        phone: this.options.phone,
      });
    } catch {
      logPairingFail("validate", null);
      this.finished = true;
      return null;
    }
    let claimUrl: string;
    try {
      this.completeUrl = pairUrl(this.options.deskUrl, "complete");
      claimUrl = pairUrl(this.options.deskUrl, "claim");
    } catch {
      logPairingFail("claim_url", null);
      this.finished = true;
      return null;
    }
    const claim = await postPairingJson(claimUrl, `{"code":"${this.options.square.code}"}`, this.fetcher);
    if (!claim.ok) {
      logPairingFail(claim.reason === "request_too_large" ? "request_too_large" : "claim_network", null);
      this.finished = true;
      return null;
    }
    if (claim.response.status !== 200) {
      logPairingFail("claim_status", claim.response.status);
      this.finished = true;
      return null;
    }
    return this.complete();
  }

  async retryComplete(): Promise<Uint8Array | null> {
    if (!this.needsCompletionRetry()) return null;
    return this.complete();
  }

  private async complete(): Promise<Uint8Array | null> {
    const retryingAfterTimeout = this.completeRetryPending;
    try {
      const { square, phone } = this.options;
      const nonce = hexToBytes(square.nonce);
      const key = hexToBytes(square.code);
      const mac = phoneMacHex(square.code, square.nonce, {
        reachable: square.reachable,
        node: square.node,
        deliveryToken: this.deliveryToken,
        phone,
      });
      this.logDiagnostic({
        event: "pairing.signed_request",
        payload_hex: bytesToHex(phoneMacPayload({
          reachable: square.reachable,
          node: square.node,
          deliveryToken: this.deliveryToken,
          phone,
        })),
        mac_hex: mac,
        delivery_token_hex: this.deliveryToken,
      });
      const body = `{"phone":${canonicalPhoneJson(phone)},"mac":"${mac}","delivery_token":"${this.deliveryToken}"}`;
      const result = await postPairingJson(this.completeUrl, body, this.fetcher);
      if (!result.ok) {
        logPairingFail(result.reason === "request_too_large" ? "request_too_large" : "complete_network", null);
        this.completeRetryPending = true;
        return null;
      }
      const response = result.response;
      // Any response ends this ceremony. A received 200 must never be replayed.
      this.finished = true;
      this.completeRetryPending = false;
      if (response.status !== 200) {
        logPairingFail("complete_status", response.status);
        if (retryingAfterTimeout && response.status === 403) {
          this.logDiagnostic({
            event: "pairing.retry_refused_after_timeout",
            diagnosis: "desk_may_have_spent_delivery_after_lost_response",
            recovery: "request_fresh_square",
          });
        }
        return null;
      }
      let seal: unknown;
      try {
        seal = await response.json();
      } catch {
        logPairingFail("seal", response.status);
        return null;
      }
      if (!isSeal(seal)) {
        logPairingFail("seal", response.status);
        return null;
      }
      let credential: Uint8Array;
      try {
        credential = openCredentialSeal(key, nonce, seal.credential_ciphertext, seal.mac);
      } catch {
        logPairingFail("seal", response.status);
        return null;
      }
      this.logDiagnostic({
        event: "pairing.sealed_response",
        ciphertext_hex: seal.credential_ciphertext,
        credential_sha256_hex: bytesToHex(sha256(credential)),
      });
      return credential;
    } catch {
      // postPairingJson never throws, so only request construction lands here
      // — the same input problem begin() validated — and the attempt still
      // owes its one stage line. The ambiguous lost-response outcome is the
      // complete_network branch above, not this catch.
      logPairingFail("validate", null);
      if (!this.finished) this.completeRetryPending = true;
      return null;
    }
  }
}
