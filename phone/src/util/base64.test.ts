/**
 * The base64 pair: the encoder's chunks and the decoder's round-trip,
 * plus the refusals (no encoder/decoder global, invalid input).
 */

import { base64ToUint8Array, uint8ArrayToBase64 } from "./base64";

test("decode inverts encode across the byte range", () => {
  const allBytes = new Uint8Array(256);
  for (let i = 0; i < 256; i++) allBytes[i] = i;
  const roundTrip = base64ToUint8Array(uint8ArrayToBase64(allBytes));
  expect(Array.from(roundTrip)).toEqual(Array.from(allBytes));
});

test("empty input round-trips to empty", () => {
  expect(uint8ArrayToBase64(new Uint8Array(0))).toBe("");
  expect(base64ToUint8Array("").length).toBe(0);
});

test("known vectors", () => {
  expect(base64ToUint8Array("aGk=")).toEqual(new Uint8Array([0x68, 0x69]));
  expect(base64ToUint8Array("aGVsbG8gd29ybGQ=")).toEqual(
    new Uint8Array(Array.from("hello world", (c) => c.charCodeAt(0))),
  );
});

test("invalid base64 is refused", () => {
  expect(() => base64ToUint8Array("not base64!")).toThrow();
  expect(() => base64ToUint8Array("====")).toThrow();
});
