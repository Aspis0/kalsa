/**
 * A video File becomes the bytes the room's shelf carries: H.264 in an MP4,
 * long side at most 1280 (never upscaled), ~2 Mbps, AAC 128 kbps —
 * compressed HERE, in the webview, through Mediabunny over WebCodecs,
 * because the computer never transcodes (§5b). Where compression is
 * impossible — no encoder, or an input this webview cannot decode (HEVC on
 * a webview without it) — the ORIGINAL rides when it is an MP4 within the
 * cap, and anything else is refused in plain words. Up to four evenly
 * spaced stills ride beside it: THE AI SEES VIDEO ONLY AS THOSE FRAMES,
 * so they go through the same picture road (prepareImage) everything else
 * does.
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
  /** False when the original file rides: compression was impossible or the
      input undecodable, and an MP4 within the cap was allowed through. */
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

function isMp4(file: File): boolean {
  return file.type === "video/mp4" || /\.m(4v|p4)$/i.test(file.name);
}

/** The pixels and duration a `<video>` element reports — the fallback
    road's own dimensions, since the reserve declares the sender's real
    pixels even when nothing was re-encoded. Null when the element cannot
    read the file either, which is a video nobody here can describe. */
function probeWithVideoElement(
  file: File,
): Promise<{ width: number; height: number; durationMs: number } | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
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

/** The original-rides answer, described as well as this webview can: an
    MP4 within the cap goes through with its own pixels, or the send is
    refused when even the element cannot name them. */
async function originalVideo(
  file: File,
): Promise<PreparedVideo> {
  const probe = await probeWithVideoElement(file);
  if (!probe || probe.width === 0 || probe.height === 0) {
    throw new AttachmentError(
      "unreadable",
      `“${file.name}” cannot be read here. Convert it to MP4 and attach that.`,
      {},
      "video_undecodable",
    );
  }
  return {
    blob: file,
    width: probe.width,
    height: probe.height,
    durationMs: probe.durationMs,
    compressed: false,
    frames: [],
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

async function extractFrames(
  input: Input,
  durationSeconds: number,
  name: string,
): Promise<PreparedImage[]> {
  const track = await input.getPrimaryVideoTrack();
  if (!track) return [];
  const sink = new VideoSampleSink(track);
  const frames: PreparedImage[] = [];
  for (let at = 0; at < FRAME_COUNT; at += 1) {
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

export async function prepareVideo(
  file: File,
  onProgress: (fraction: number) => void,
  canceled?: { readonly canceled: boolean },
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
    // MP4 the shelf can hold.
    if (isMp4(file)) return originalVideo(file);
    throw toAttachmentError(error, file.name, "video_decode");
  }
  const size = fittedSize(track.displayWidth, track.displayHeight);
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
  const videoEncodable = await canEncodeVideo("avc", {
    width: size.width,
    height: size.height,
    bitrate: VIDEO_BITRATE,
  }).catch(() => false);
  if (!videoEncodable) {
    if (isMp4(file)) return originalVideo(file);
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
    conversion.onProgress = (progress) => onProgress(progress * 0.9);
    await conversion.execute();
  } catch (error) {
    if (canceled?.canceled) throw new VideoCanceled();
    if (isMp4(file)) {
      // A decode failure mid-flight (HEVC the config supported on paper
      // but not in fact) lands here too: the original is the answer.
      return originalVideo(file);
    }
    throw toAttachmentError(error, file.name, "video_convert");
  }
  if (canceled?.canceled) throw new VideoCanceled();
  const buffer = output.target.buffer;
  if (!buffer) {
    if (isMp4(file)) return originalVideo(file);
    throw new AttachmentError("unreadable", `“${file.name}” could not be prepared.`, {}, "video_encode");
  }
  onProgress(0.95);
  const blob = new Blob([buffer], { type: "video/mp4" });
  if (blob.size > ROOM_VIDEO_MAX_BYTES) {
    throw new AttachmentError(
      "too-big",
      `“${file.name}” stays too large after compression (${Math.round(blob.size / 1048576)} MB).`,
      {},
      "video_output",
    );
  }
  const durationMs = Math.round((await input.computeDuration()) * 1000);
  const frames = await extractFrames(input, await input.computeDuration(), file.name);
  onProgress(1);
  return { blob, width: size.width, height: size.height, durationMs, compressed: true, frames };
}
