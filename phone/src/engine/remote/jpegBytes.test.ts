import { jpegSize, sanitizeJpegBytes } from "./jpegBytes";

/** A JPEG segment: marker, big-endian length (payload + the two length
    bytes), then the payload. */
function segment(marker: number, payload: number[]): number[] {
  const length = payload.length + 2;
  return [0xff, marker, (length >> 8) & 0xff, length & 0xff, ...payload];
}

/** The EXIF segment a phone's camera writes — location and all. */
const EXIF_PAYLOAD = [
  0x45, 0x78, 0x69, 0x66, 0x00, 0x00, // "Exif\0\0"
  0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00, // one IFD entry
];

const DQT_PAYLOAD = new Array<number>(65).fill(0x10);
/** Precision 8, height 2, width 3, three components — a progressive frame. */
const SOF2_PAYLOAD = [0x08, 0x00, 0x02, 0x00, 0x03, 0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01];
const SOS_PAYLOAD = [0x01, 0x01, 0x00, 0x00, 0x3f, 0x00];
const SOS2_PAYLOAD = [0x02, 0x01, 0x00, 0x00, 0x3f, 0x00];
const DHT_PAYLOAD = [0x00];

const SOI = [0xff, 0xd8];
const EOI = [0xff, 0xd9];
/** The first scan: ordinary bytes, a stuffed 0xFF 0x00, a restart marker. */
const SCAN_ONE = [0x12, 0x34, 0xff, 0x00, 0x5a, 0xff, 0xd0, 0x7f, 0x22];
/** The last scan ends with fill bytes before EOI, as encoders pad it. */
const SCAN_TWO = [0x54, 0x31, 0xff, 0x00, 0x00, 0x33, 0xff, 0xd7, 0x21, 0xff, 0xff];

/** SOI, both scans, EOI — and nothing anyone wrote about the picture. */
function cleanProgressive(): Uint8Array {
  return new Uint8Array([
    ...SOI,
    ...segment(0xdb, DQT_PAYLOAD),
    ...segment(0xc2, SOF2_PAYLOAD),
    ...segment(0xda, SOS_PAYLOAD),
    ...SCAN_ONE,
    ...segment(0xc4, DHT_PAYLOAD),
    ...segment(0xda, SOS2_PAYLOAD),
    ...SCAN_TWO,
    ...EOI,
  ]);
}

/** The same picture as a camera hands it over: APP1 before the frame, COM
    after it, a second APP1 BETWEEN the two scans, and fill bytes. */
function progressiveWithMetadata(): Uint8Array {
  return new Uint8Array([
    ...SOI,
    0xff, // a fill byte before the first segment
    ...segment(0xe1, EXIF_PAYLOAD),
    ...segment(0xdb, DQT_PAYLOAD),
    ...segment(0xc2, SOF2_PAYLOAD),
    ...segment(0xfe, [0x6d, 0x61, 0x64, 0x65]), // COM
    ...segment(0xda, SOS_PAYLOAD),
    ...SCAN_ONE,
    ...segment(0xe1, EXIF_PAYLOAD), // metadata between the scans
    ...segment(0xc4, DHT_PAYLOAD),
    ...segment(0xda, SOS2_PAYLOAD),
    ...SCAN_TWO,
    ...EOI,
  ]);
}

function markers(bytes: Uint8Array, marker: number): number {
  let found = 0;
  for (let at = 0; at + 1 < bytes.length; at += 1) {
    if (bytes[at] === 0xff && bytes[at + 1] === marker) found += 1;
  }
  return found;
}

describe("sanitizeJpegBytes", () => {
  test("drops metadata anywhere in the stream, both scans surviving intact", () => {
    const clean = sanitizeJpegBytes(progressiveWithMetadata());
    expect(clean).not.toBeNull();
    expect(Array.from(clean as Uint8Array)).toEqual(Array.from(cleanProgressive()));
    // The progressive picture keeps BOTH scans — the one after the strip.
    expect(markers(clean as Uint8Array, 0xda)).toBe(2);
    expect(markers(clean as Uint8Array, 0xe1)).toBe(0);
    expect(markers(clean as Uint8Array, 0xfe)).toBe(0);
  });

  test("reads the frame's own size, long side included", () => {
    expect(jpegSize(progressiveWithMetadata())).toEqual({ width: 3, height: 2 });
    expect(jpegSize(cleanProgressive())).toEqual({ width: 3, height: 2 });
    expect(jpegSize(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]))).toBeNull();
    expect(jpegSize(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
  });

  test("refuses to guess: every walk that cannot reach EOI answers null", () => {
    // Not a JPEG, or too short to hold one.
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
    expect(sanitizeJpegBytes(png)).toBeNull();
    expect(sanitizeJpegBytes(new Uint8Array([0xff, 0xd8, 0xff]))).toBeNull();
    expect(sanitizeJpegBytes(new Uint8Array([0xff, 0xd8, 0x00, 0x01, 0x02, 0x03]))).toBeNull();
    // Truncated mid-scan: the entropy data has no end of image.
    const full = progressiveWithMetadata();
    expect(sanitizeJpegBytes(full.subarray(0, full.length - 4))).toBeNull();
    // A segment length running past the bytes.
    expect(sanitizeJpegBytes(new Uint8Array([...SOI, 0xff, 0xe1, 0x7f, 0xff, 0x00]))).toBeNull();
    // A restart marker where a segment must be.
    expect(sanitizeJpegBytes(new Uint8Array([...SOI, 0xff, 0xd0, ...EOI]))).toBeNull();
  });
});
