/**
 * A growable byte window for parsing one response off a tunnel: chunks
 * pushed as they arrive, consumed by parser steps. No TextDecoder here —
 * headers are ASCII by HTTP rule and bodies stay raw bytes.
 */

/** Byte pattern of "\r\n\r\n", the end of an HTTP head. */
export const HEAD_TERMINATOR = new Uint8Array([13, 10, 13, 10]);

export class ByteWindow {
  private buf = new Uint8Array(1024);
  private start = 0;
  private end = 0;

  get length(): number {
    return this.end - this.start;
  }

  push(chunk: Uint8Array): void {
    this.ensureCapacity(chunk.length);
    this.buf.set(chunk, this.end);
    this.end += chunk.length;
  }

  /** First index of `pattern` at or after `from`, or -1. */
  indexOf(pattern: Uint8Array, from = 0): number {
    const limit = this.end - pattern.length;
    outer: for (let at = this.start + from; at <= limit; at++) {
      for (let i = 0; i < pattern.length; i++) {
        if (this.buf[at + i] !== pattern[i]) continue outer;
      }
      return at - this.start;
    }
    return -1;
  }

  /** Remove and return the first `n` bytes (or all when `n` overruns). */
  take(n: number): Uint8Array {
    const count = Math.min(n, this.length);
    const out = this.buf.slice(this.start, this.start + count);
    this.start += count;
    if (this.start === this.end) {
      this.start = 0;
      this.end = 0;
    }
    return out;
  }

  /** Everything not yet consumed, without consuming it. */
  peekRest(): Uint8Array {
    return this.buf.slice(this.start, this.end);
  }

  /** Consume and return everything left. */
  takeRest(): Uint8Array {
    return this.take(this.length);
  }

  private ensureCapacity(incoming: number): void {
    if (this.end + incoming <= this.buf.length) return;
    const used = this.length;
    let size = Math.max(1024, used + incoming);
    while (size < used + incoming) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.buf.subarray(this.start, this.end), 0);
    this.buf = next;
    this.end -= this.start;
    this.start = 0;
  }
}
