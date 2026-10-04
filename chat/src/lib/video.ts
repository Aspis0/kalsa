/**
 * A video File becomes the bytes the room's shelf carries: H.264 in an MP4,
 * long side at most 1280 (never upscaled), ~2 Mbps, AAC 128 kbps —
 * compressed HERE, in the webview, through Mediabunny over WebCodecs,
 * because the computer never transcodes (§5b). Where compression is
 * impossible — no encoder, or an input this webview cannot decode (HEVC on
 * a webview without it) — the ORIGINAL rides remuxed: its tracks copied
 * into a fresh MP4 without re-encoding, which drops the recorder's own
 * atoms (udta, the ©xyz location tag, meta) the same way the picture road
 * strips pixels. Up to four evenly spaced stills ride beside it — THE AI
 * SEES VIDEO ONLY AS THOSE FRAMES — drawn through WebCodecs where it can
 * decode and through a <video> element where it cannot; when neither can,
 * the frames are none and the AI reads the words alone.
 */

import {
  BlobSource,
  BufferTarget,
  canEncodeAudio,
  canEncodeVideo,
  Conversion,
  Input,
  Mp4InputFormat,
  QuickTimeInputFormat,
  Mp4OutputFormat,
  Output,
  VideoSampleSink,
} from "mediabunny";
import { AttachmentError } from "./attachments";
import { prepareImage } from "./images";
import type { PreparedImage } from "./images";
import { ROOM_VIDEO_MAX_BYTES } from "./roomMedia";

const VIDEO_LONG_SIDE = 1280;
const VIDEO_BITRATE = 2_000_000;
const AUDIO_BITRATE = 128_000;
/** Still frames per video, read at interior points so a black first frame
    is not what the AI is shown. */
const FRAME_COUNT = 4;

export interface PreparedVideo {
  blob: Blob;
  width: number;
  height: number;
  durationMs: number;
  /** False when the original file rides remuxed: compression was
      impossible or the input undecodable, and an MP4 within the cap was
      allowed through. */
  compressed: boolean;
  frames: PreparedImage[];
}

/** The one error a cancel is: not a refusal sentence, just a chip that
    goes away. */
export class VideoCanceled extends Error {
  constructor() {
    super("canceled");
    this.name = "VideoCanceled";
  }
}

type CancelGate = { readonly canceled: boolean };

function isMp4(file: File): boolean {
  return file.type === "video/mp4" || /\.m(4v|p4)$/i.test(file.name);
}

/** The picker's own kinds: MP4 and QuickTime are everything the compress
    road reads. */
export function isVideoFile(file: File): boolean {
  return file.type.startsWith("video/") || /\.(mp4|m4v|mov)$/i.test(file.name);
}

/** The size the encoder is expected to write, before it writes anything:
    duration times the bitrates the config asks for, plus a little for the
    container. A video that cannot fit the cap is refused HERE, before
    minutes of encoding spend the battery to discover the same answer. */
export function estimatedVideoBytes(durationSeconds: number, audio: boolean): number {
  const bitsPerSecond = VIDEO_BITRATE + (audio ? AUDIO_BITRATE : 0);
  return Math.ceil(((durationSeconds * bitsPerSecond) / 8) * 1.05);
}

/** The pixels and duration a `<video>` element reports — the fallback
    road's own dimensions, since the reserve declares the sender's real
    pixels even when nothing was re-encoded. Null when the element cannot
    read the file either, which is a video nobody here can describe. */
function probeWithVideoElement(
  source: Blob,
): Promise<{ width: number; height: number; durationMs: number } | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(source);
    const element = document.createElement("video");
    element.preload = "metadata";
    const done = (answer: { width: number; height: number; durationMs: number } | null) => {
      URL.revokeObjectURL(url);
      resolve(answer);
    };
    element.onloadedmetadata = () =>
      done({
        width: element.videoWidth,
        height: element.videoHeight,
        durationMs: Number.isFinite(element.duration) ? Math.round(element.duration * 1000) : 0,
      });
    element.onerror = () => done(null);
    element.src = url;
  });
}

/** Seek and wait for the frame to land, or give up on this one. */
function seekTo(element: HTMLVideoElement, moment: number): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), 3000);
    element.onseeked = () => {
      clearTimeout(timer);
      resolve(true);
    };
    element.currentTime = moment;
  });
}

/** Frames through the element the poster road already trusts: seek, wait,
    draw. Works where WebCodecs has no decoder (HEVC on a webview whose
    <video> still plays it) — exactly the case that needs it. */
async function elementFrames(
  source: Blob,
  durationMs: number,
  name: string,
  canceled?: CancelGate,
): Promise<PreparedImage[]> {
  const url = URL.createObjectURL(source);
  try {
    const element = document.createElement("video");
    element.preload = "auto";
    element.muted = true;
    element.src = url;
    await new Promise<void>((resolve, reject) => {
      element.onloadeddata = () => resolve();
      element.onerror = () => reject(new Error("element"));
    });
    const frames: PreparedImage[] = [];
    for (let at = 0; at < FRAME_COUNT; at += 1) {
      if (canceled?.canceled) throw new VideoCanceled();
      const moment = ((durationMs / 1000) * (at + 1)) / (FRAME_COUNT + 1);
      if (!(await seekTo(element, moment))) continue;
      const canvas = document.createElement("canvas");
      canvas.width = element.videoWidth;
      canvas.height = element.videoHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) continue;
      ctx.drawImage(element, 0, 0, canvas.width, canvas.height);
      const jpeg = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", 0.9),
      );
      if (!jpeg) continue;
      frames.push(await prepareImage(new File([jpeg], `${name}.frame.jpg`, { type: "image/jpeg" })));
    }
    return frames;
  } catch {
    // The element that probed the pixels can still refuse a seek: no
    // frames is an honest answer, not a failure.
    return [];
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function extractFrames(
  input: Input,
  durationSeconds: number,
  name: string,
  canceled?: CancelGate,
): Promise<PreparedImage[]> {
  const track = await input.getPrimaryVideoTrack();
  if (!track) return [];
  const sink = new VideoSampleSink(track);
  const frames: PreparedImage[] = [];
  for (let at = 0; at < FRAME_COUNT; at += 1) {
    if (canceled?.canceled) throw new VideoCanceled();
    const moment = (durationSeconds * (at + 1)) / (FRAME_COUNT + 1);
    let sample = null;
    try {
      sample = await sink.getSample(moment);
    } catch {
      // A frame this webview cannot produce is one frame fewer, not a
      // failure: three stills still tell the AI what the video shows.
    }
    if (!sample) continue;
    try {
      const canvas = document.createElement("canvas");
      canvas.width = sample.displayWidth;
      canvas.height = sample.displayHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) continue;
      sample.draw(ctx, 0, 0, canvas.width, canvas.height);
      const jpeg = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", 0.9),
      );
      if (!jpeg) continue;
      frames.push(await prepareImage(new File([jpeg], `${name}.frame.jpg`, { type: "image/jpeg" })));
    } finally {
      sample.close();
    }
  }
  return frames;
}

/** The original, REMUXED: Mediabunny copies the tracks into a fresh MP4
    without decoding or re-encoding, so the recorder's own atoms — udta,
    the ©xyz location tag, meta — do not survive, and the shelf receives a
    file that says nothing about where it was taken. */
export async function remuxOriginal(file: File, canceled?: CancelGate): Promise<PreparedVideo> {
  const input = new Input({
    source: new BlobSource(file),
    formats: [new Mp4InputFormat(), new QuickTimeInputFormat()],
  });
  const output = new Output({
    format: new Mp4OutputFormat(),
    target: new BufferTarget(),
  });
  // Tags do not ride: the input's own udta writing is dropped, not copied.
  const conversion = await Conversion.init({ input, output, tags: () => ({}) });
  await conversion.execute();
  const buffer = output.target.buffer;
  if (!buffer) {
    throw new AttachmentError(
      "unreadable",
      `“${file.name}” cannot be read here. Convert it to MP4 and attach that.`,
      {},
      "video_remux",
    );
  }
  const blob = new Blob([buffer], { type: "video/mp4" });
  if (blob.size > ROOM_VIDEO_MAX_BYTES) {
    throw new AttachmentError(
      "too-big",
      `“${file.name}” stays too large after preparation (${Math.round(blob.size / 1048576)} MB).`,
      {},
      "video_output",
    );
  }
  const probe = await probeWithVideoElement(blob);
  if (!probe || probe.width === 0 || probe.height === 0) {
    throw new AttachmentError(
      "unreadable",
      `“${file.name}” cannot be read here. Convert it to MP4 and attach that.`,
      {},
      "video_undecodable",
    );
  }
  let frames: PreparedImage[] = [];
  try {
    frames = await extractFrames(input, probe.durationMs / 1000, file.name, canceled);
  } catch (error) {
    if (error instanceof VideoCanceled) throw error;
    frames = [];
  }
  if (frames.length === 0) {
    frames = await elementFrames(blob, probe.durationMs, file.name, canceled);
  }
  return {
    blob,
    width: probe.width,
    height: probe.height,
    durationMs: probe.durationMs,
    compressed: false,
    frames,
  };
}

function toAttachmentError(error: unknown, name: string, reason: string): AttachmentError {
  const raw = error instanceof Error ? error.name : "";
  const detail = raw.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return new AttachmentError(
    "unreadable",
    `“${name}” could not be read as a video. A webview without this codec cannot decode it.`,
    {},
    `${reason}_${detail || "decode"}`,
  );
}

/** Even dimensions: H.264 encoders take 2-aligned sizes. Never up: the
    scale is capped at 1, so a small video keeps its own size. */
function fittedSize(width: number, height: number): { width: number; height: number } {
  const scale = Math.min(1, VIDEO_LONG_SIDE / Math.max(width, height));
  return {
    width: Math.max(2, Math.floor((width * scale) / 2) * 2),
    height: Math.max(2, Math.floor((height * scale) / 2) * 2),
  };
}

export async function prepareVideo(
  file: File,
  onProgress: (fraction: number) => void,
  canceled?: CancelGate,
): Promise<PreparedVideo> {
  if (file.size > ROOM_VIDEO_MAX_BYTES) {
    throw new AttachmentError(
      "too-big",
      `“${file.name}” is too large for the room (over ${Math.round(ROOM_VIDEO_MAX_BYTES / 1048576)} MB).`,
      {},
      "video_source",
    );
  }
  let input: Input;
  let track: Awaited<ReturnType<Input["getPrimaryVideoTrack"]>>;
  try {
    input = new Input({
      source: new BlobSource(file),
      // The picker admits MP4 and QuickTime; nothing else is ever decoded.
      formats: [new Mp4InputFormat(), new QuickTimeInputFormat()],
    });
    const found = await input.getPrimaryVideoTrack();
    if (!found) {
      throw new AttachmentError(
        "unreadable",
        `“${file.name}” holds no video track.`,
        {},
        "video_no_track",
      );
    }
    track = found;
  } catch (error) {
    if (error instanceof AttachmentError) throw error;
    // Undecodable input: the original is the honest answer when it is an
    // MP4 the shelf can hold — remuxed, so its metadata does not ride.
    if (isMp4(file)) return remuxOriginal(file, canceled);
    throw toAttachmentError(error, file.name, "video_decode");
  }
  const size = fittedSize(track.displayWidth, track.displayHeight);
  const durationSeconds = await input.computeDuration();
  // The encoder gates are the webview's own word about itself, asked before
  // any work: no H.264 encoder means no compression, whatever the input.
  // Audio that cannot become AAC is dropped rather than failing the video.
  const audio = await input.getPrimaryAudioTrack();
  let audioConfig: { codec: "aac"; bitrate: number } | { discard: true } | undefined;
  if (audio) {
    const aacPossible = await canEncodeAudio("aac", {
      numberOfChannels: Math.min(2, audio.numberOfChannels),
      sampleRate: audio.sampleRate,
      bitrate: AUDIO_BITRATE,
    }).catch(() => false);
    audioConfig = aacPossible ? { codec: "aac", bitrate: AUDIO_BITRATE } : { discard: true };
  }
  const keepsAudio = audioConfig !== undefined && "codec" in audioConfig;
  const estimate = estimatedVideoBytes(durationSeconds, keepsAudio);
  if (estimate > ROOM_VIDEO_MAX_BYTES) {
    throw new AttachmentError(
      "too-big",
      `“${file.name}” would stay too large after compression (about ${Math.round(estimate / 1048576)} MB).`,
      {},
      "video_estimate",
    );
  }
  const videoEncodable = await canEncodeVideo("avc", {
    width: size.width,
    height: size.height,
    bitrate: VIDEO_BITRATE,
  }).catch(() => false);
  if (!videoEncodable) {
    if (isMp4(file)) return remuxOriginal(file, canceled);
    throw new AttachmentError(
      "unreadable",
      `“${file.name}” cannot be prepared here. Convert it to MP4 and attach that.`,
      {},
      "video_no_encoder",
    );
  }
  const output = new Output({
    format: new Mp4OutputFormat(),
    target: new BufferTarget(),
  });
  let conversion: Conversion;
  try {
    conversion = await Conversion.init({
      input,
      output,
      video: {
        width: size.width,
        height: size.height,
        fit: "contain",
        bitrate: VIDEO_BITRATE,
        codec: "avc",
      },
      ...(audioConfig ? { audio: audioConfig } : {}),
    });
    // The flag is watched where the work reports itself: cancel() takes
    // effect within a report, not at the end of the whole encode.
    conversion.onProgress = (progress) => {
      if (canceled?.canceled) {
        void conversion.cancel();
        return;
      }
      onProgress(progress * 0.9);
    };
    await conversion.execute();
  } catch (error) {
    if (canceled?.canceled) throw new VideoCanceled();
    if (isMp4(file)) {
      // A decode failure mid-flight (HEVC the config supported on paper
      // but not in fact) lands here too: the original is the answer.
      return remuxOriginal(file, canceled);
    }
    throw toAttachmentError(error, file.name, "video_convert");
  }
  if (canceled?.canceled) throw new VideoCanceled();
  const buffer = output.target.buffer;
  if (!buffer) {
    if (isMp4(file)) return remuxOriginal(file, canceled);
    throw new AttachmentError("unreadable", `“${file.name}” could not be prepared.`, {}, "video_encode");
  }
  onProgress(0.95);
  const blob = new Blob([buffer], { type: "video/mp4" });
  // The estimate said it would fit; the encoder's own answer is the law.
  if (blob.size > ROOM_VIDEO_MAX_BYTES) {
    throw new AttachmentError(
      "too-big",
      `“${file.name}” stays too large after compression (${Math.round(blob.size / 1048576)} MB).`,
      {},
      "video_output",
    );
  }
  const frames = await extractFrames(input, durationSeconds, file.name, canceled);
  onProgress(1);
  return {
    blob,
    width: size.width,
    height: size.height,
    durationMs: Math.round(durationSeconds * 1000),
    compressed: true,
    frames,
  };
}
