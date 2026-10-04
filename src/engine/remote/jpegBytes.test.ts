import { jpegSize, sanitizeJpegBytes } from "./jpegBytes";

/** A JPEG segment: marker, big-endian length (payload + the two length bytes),
    then the payload. */
function segment(marker: number, payload: number[]): number[] {
  const length = payload.length + 2;
  return [0xff, marker, (length >> 8) & 0xff, length & 0xff, ...payload];
}

/** The EXIF segment a phone's camera writes — location and all. Its payload
    starts with "Exif\0\0", as a decoder expects. */
const EXIF_PAYLOAD = [
  0x45, 0x78, 0x69, 0x66, 0x00, 0x00, // "Exif\0\0"
  0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00, // one IFD entry
];

const DQT_PAYLOAD = new Array<number>(65).fill(0x10);
/** Precision 8, height 2, width 3, three components. */
const SOF0_PAYLOAD = [0x08, 0x00, 0x02, 0x00, 0x03, 0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01];
const SOS_PAYLOAD = [0x01, 0x01, 0x00, 0x00, 0x3f, 0x00];
const ENTROPY = [0x00, 0x11, 0x22, 0x33, 0x5a, 0xff, 0x00, 0x7f];

const SOI = [0xff, 0xd8];
const EOI = [0xff, 0xd9];

function jpegWithExif(): Uint8Array {
  return new Uint8Array([
    ...SOI,
    ...segment(0xe1, EXIF_PAYLOAD),
    ...segment(0xfe, [0x6d, 0x61, 0x64, 0x65]), // COM
    ...segment(0xdb, DQT_PAYLOAD),
    ...segment(0xc0, SOF0_PAYLOAD),
    ...segment(0xda, SOS_PAYLOAD),
    ...ENTROPY,
    ...EOI,
  ]);
}

/** The same frame with neither metadata segment: SOI, DQT, SOF0, SOS→EOI. */
function jpegWithoutMetadata(): Uint8Array {
  return new Uint8Array([
    ...SOI,
    ...segment(0xdb, DQT_PAYLOAD),
    ...segment(0xc0, SOF0_PAYLOAD),
    ...segment(0xda, SOS_PAYLOAD),
    ...ENTROPY,
    ...EOI,
  ]);
}

describe("sanitizeJpegBytes", () => {
  test("drops APP1 (Exif) and COM while the frame and its data survive", () => {
    const clean = sanitizeJpegBytes(jpegWithExif());
    expect(Array.from(clean)).toEqual(Array.from(jpegWithoutMetadata()));
    // Nothing an allow-list did not keep: no 0xff 0xe1 and no 0xff 0xfe.
    for (let at = 0; at + 1 < clean.length; at += 1) {
      if (clean[at] !== 0xff) continue;
      expect([0xe1, 0xfe]).not.toContain(clean[at + 1]);
    }
  });

  test("reads the frame's own size, long side included", () => {
    expect(jpegSize(jpegWithExif())).toEqual({ width: 3, height: 2 });
    expect(jpegSize(sanitizeJpegBytes(jpegWithExif()))).toEqual({ width: 3, height: 2 });
    expect(jpegSize(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]))).toBeNull();
    expect(jpegSize(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
  });

  test("bytes that are not a readable JPEG come back untouched", () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
    expect(sanitizeJpegBytes(png)).toBe(png);
    expect(jpegSize(png)).toBeNull();
    const truncated = new Uint8Array([0xff, 0xd8, 0xff]);
    expect(Array.from(sanitizeJpegBytes(truncated))).toEqual(SOI);
    // A JPEG whose walk breaks keeps nothing past the break: a metadata
    // segment is dropped rather than ridden out on a corrupt file.
    const badLength = new Uint8Array([...SOI, 0xff, 0xe1, 0x7f, 0xff, 0x00]);
    expect(Array.from(sanitizeJpegBytes(badLength))).toEqual(SOI);
  });
});
