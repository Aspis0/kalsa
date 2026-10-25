// The Room's media on their way in: pictures prepared at once, a video
// compressed in the webview with its frames, each uploaded at send and
// posted by id; and the host's broom that empties the shelf. The page keeps
// the composer and the confirm; this keeps the chips, their one error line,
// and the epoch that remounts every row's media after a clear.

import { useRef, useState } from "react";
import type { English } from "../i18n/en/all";
import { isImageFile, prepareImage } from "../lib/images";
import type { PreparedImage } from "../lib/images";
import { AttachmentError } from "../lib/attachments";
import { prepareVideo, VideoCanceled } from "../lib/video";
import {
  clearRoomMedia,
  RoomMediaError,
  ROOM_IMAGE_MAX_BYTES,
  ROOM_VIDEO_MAX_BYTES,
  uploadRoomMedia,
} from "../lib/roomMedia";
import type { RoomMediaDescriptor } from "../lib/roomMedia";
import { forgetAllRoomMediaUrls } from "../lib/roomMediaCache";
import { uid } from "../lib/store";

/** One picture or video on its way into the room: prepared here (a video
    compressed, its frames pulled), uploaded at send, then posted by id.
    The object URL is this chip's own and dies when the chip does. */
interface RoomPendingMedia {
  id: string;
  kind: "image" | "video";
  state: "compressing" | "ready" | "uploading";
  progress: number;
  url: string | null;
  blob: Blob | null;
  width: number;
  height: number;
  durationMs: number | null;
  frames: PreparedImage[];
  /** The descriptor of an upload that already landed: a retried post
      reuses it instead of writing a second blob to the shelf. */
  uploaded: RoomMediaDescriptor | null;
}

/** `send` is the feed's own post: words, the call flag, the media ids. */
export function useRoomMedia(
  mediaWords: English["room"]["media"],
  send: (body: string, withCall: boolean, media: string[]) => Promise<boolean>,
) {
  // The media on their way in, and the one sentence an attach or an
  // upload refused with. Both live here, with the draft's own durability.
  const [pendingMedia, setPendingMedia] = useState<RoomPendingMedia[]>([]);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const cancelers = useRef(new Map<string, { canceled: boolean }>());
  const [mediaEpoch, setMediaEpoch] = useState(0);

  function patchMedia(id: string, patch: Partial<RoomPendingMedia>): void {
    setPendingMedia((current) =>
      current.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    );
  }

  function dropMedia(id: string): void {
    setPendingMedia((current) => {
      const chip = current.find((item) => item.id === id);
      if (chip?.url) URL.revokeObjectURL(chip.url);
      return current.filter((item) => item.id !== id);
    });
    cancelers.current.delete(id);
  }

  // Attach: pictures are prepared at once (one road as the chat's); a
  // video compresses here in the webview with its progress on the chip,
  // cancelable, and its frames pulled beside it. A file that is neither is
  // a sentence, never a silence. Eight ride one message — the shelf's own
  // post cap (§5b) — and the ninth is a sentence too.
  const MEDIA_PER_POST = 8;
  async function attachMedia(files: FileList | File[]): Promise<void> {
    setMediaError(null);
    let room = MEDIA_PER_POST - pendingMedia.length;
    for (const file of Array.from(files)) {
      if (room <= 0) {
        setMediaError(mediaWords.tooManyMedia);
        continue;
      }
      if (isImageFile(file)) {
        room -= 1;
        const id = uid();
        const gate = { canceled: false };
        cancelers.current.set(id, gate);
        setPendingMedia((current) => [
          ...current,
          {
            id,
            kind: "image",
            state: "compressing",
            progress: 0,
            url: null,
            blob: null,
            width: 0,
            height: 0,
            durationMs: null,
            frames: [],
            uploaded: null,
          },
        ]);
        try {
          const image = await prepareImage(file);
          if (gate.canceled) {
            dropMedia(id);
            continue;
          }
          patchMedia(id, {
            state: "ready",
            url: URL.createObjectURL(image.blob),
            blob: image.blob,
            width: image.width,
            height: image.height,
          });
        } catch (error) {
          if (gate.canceled) {
            dropMedia(id);
            continue;
          }
          setMediaError(
            error instanceof AttachmentError && error.failure === "too-big"
              ? mediaWords.tooLargeImage
              : mediaWords.imageUnreadable,
          );
          dropMedia(id);
        } finally {
          cancelers.current.delete(id);
        }
        continue;
      }
      if (file.type.startsWith("video/") || /\.(mp4|m4v|mov)$/i.test(file.name)) {
        room -= 1;
        const id = uid();
        const gate = { canceled: false };
        cancelers.current.set(id, gate);
        setPendingMedia((current) => [
          ...current,
          {
            id,
            kind: "video",
            state: "compressing",
            progress: 0,
            url: null,
            blob: null,
            width: 0,
            height: 0,
            durationMs: null,
            frames: [],
            uploaded: null,
          },
        ]);
        try {
          const video = await prepareVideo(
            file,
            (progress) => patchMedia(id, { progress }),
            gate,
          );
          // A cancel that landed while the last frames were drawn leaves
          // the prepared bytes unwanted: no URL for a chip already gone.
          if (gate.canceled) {
            dropMedia(id);
            continue;
          }
          patchMedia(id, {
            state: "ready",
            progress: 1,
            url: URL.createObjectURL(video.blob),
            blob: video.blob,
            width: video.width,
            height: video.height,
            durationMs: video.durationMs,
            frames: video.frames,
          });
        } catch (error) {
          dropMedia(id);
          if (error instanceof VideoCanceled || gate.canceled) continue;
          setMediaError(
            error instanceof AttachmentError && error.failure === "too-big"
              ? mediaWords.tooLargeVideo
              : mediaWords.undecodableVideo,
          );
        } finally {
          cancelers.current.delete(id);
        }
        continue;
      }
      setMediaError(mediaWords.notMedia);
    }
  }

  function cancelMedia(id: string): void {
    const gate = cancelers.current.get(id);
    if (gate) gate.canceled = true;
    dropMedia(id);
  }

  // The host's own broom. The full-shelf sentence points here because this
  // is the only thing that can make room; after it the shelf answers every
  // read with media_not_found and the rows meet that with the fallback
  // words, which is what §5b stored them for.
  async function clearRoomMediaNow(): Promise<void> {
    try {
      await clearRoomMedia();
      // No URL may outlive the blobs it names; the epoch remounts the
      // rows' media so nothing renders bytes that are no longer there.
      forgetAllRoomMediaUrls();
      setMediaEpoch((epoch) => epoch + 1);
    } catch (error) {
      setMediaError(
        error instanceof RoomMediaError ? mediaSentence(error.code) : mediaWords.clearFailed,
      );
    }
  }

  /** §5b's refusal codes, in the household's words. */
  function mediaSentence(code: string): string {
    switch (code) {
      case "too_large":
        return mediaWords.tooLargeVideo;
      case "room_media_full":
        return mediaWords.full;
      case "media_bad_sha":
      case "media_incomplete":
      case "media_bad_magic":
        return mediaWords.uploadBroken;
      default:
        return mediaWords.uploadFailed;
    }
  }

  /** The upload road for one pending item: images direct; a video's frames
      first (the shelf checks the video's ids against them), then the video
      itself. An upload that already landed rides again by its id. */
  async function uploadPending(item: RoomPendingMedia): Promise<RoomMediaDescriptor> {
    if (item.uploaded) return item.uploaded;
    if (!item.blob) throw new RoomMediaError("internal");
    const bytes = new Uint8Array(await item.blob.arrayBuffer());
    if (item.kind === "image" && bytes.byteLength > ROOM_IMAGE_MAX_BYTES) {
      throw new RoomMediaError("too_large");
    }
    if (item.kind === "video" && bytes.byteLength > ROOM_VIDEO_MAX_BYTES) {
      throw new RoomMediaError("too_large");
    }
    const frames: string[] = [];
    for (const frame of item.frames) {
      const descriptor = await uploadRoomMedia(
        {
          kind: "image",
          mime: frame.mime,
          width: frame.width,
          height: frame.height,
          durationMs: null,
          frames: [],
        },
        new Uint8Array(await frame.blob.arrayBuffer()),
        () => {},
        cancelers.current.get(item.id),
      );
      frames.push(descriptor.id);
    }
    const descriptor = await uploadRoomMedia(
      {
        kind: item.kind,
        mime: item.kind === "video" ? "video/mp4" : item.blob.type,
        width: Math.max(1, item.width),
        height: Math.max(1, item.height),
        durationMs: item.durationMs,
        frames,
      },
      bytes,
      (progress) => patchMedia(item.id, { state: "uploading", progress }),
      cancelers.current.get(item.id),
    );
    patchMedia(item.id, { uploaded: descriptor, state: "ready", progress: 1 });
    return descriptor;
  }

  async function postWithMedia(body: string, withCall: boolean): Promise<boolean> {
    setMediaError(null);
    const items = [...pendingMedia];
    // The room's order: images first, then videos — a video's frames must
    // be on the shelf before its own reserve names them.
    const order = [...items.filter((item) => item.kind === "image"), ...items.filter((item) => item.kind === "video")];
    const ids: string[] = [];
    let inFlight: string | null = null;
    try {
      for (const item of order) {
        inFlight = item.id;
        setPendingMedia((current) =>
          current.map((held) => (held.id === item.id ? { ...held, state: "uploading", progress: 0 } : held)),
        );
        const descriptor = await uploadPending(item);
        ids.push(descriptor.id);
        inFlight = null;
      }
    } catch (error) {
      if (error instanceof RoomMediaError && error.code === "canceled") {
        return false;
      }
      setMediaError(
        error instanceof RoomMediaError ? mediaSentence(error.code) : mediaWords.uploadFailed,
      );
      // The chip whose upload failed leaves; everything that already
      // landed stays for the next send, under its own id.
      if (inFlight !== null) dropMedia(inFlight);
      setPendingMedia((current) =>
        current.map((held) => (held.state === "uploading" ? { ...held, state: "ready", progress: 1 } : held)),
      );
      return false;
    }
    const sent = await send(body, withCall, ids);
    if (sent) {
      for (const item of items) dropMedia(item.id);
    }
    return sent;
  }

  return {
    pendingMedia,
    mediaError,
    mediaEpoch,
    attachMedia,
    cancelMedia,
    dropMedia,
    clearRoomMediaNow,
    postWithMedia,
  };
}
