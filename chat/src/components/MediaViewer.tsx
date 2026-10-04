/**
 * A React port of llama.cpp's attachment preview: the full-view lightbox
 * with wrap-around previous/next, the thumbnail strip, and the video item.
 *
 * Ported from `tools/ui/src/lib/components/app/chat/ChatAttachments/`:
 *   - ChatAttachmentsPreview/ChatAttachmentsPreview.svelte
 *   - ChatAttachmentsPreview/ChatAttachmentsPreviewCurrentItem/ChatAttachmentsPreviewCurrentItemVideo.svelte
 * at llama.cpp commit b23efaa2ef147f547ee75cbf0c621d61904de80e.
 *
 * The navigation model (index that wraps at both ends), the centered
 * current item, the thumbnail strip the click follows, and the video item
 * with its controls are the upstream component's; the Svelte-to-React
 * translation, the keyboard handling, the close affordance and this app's
 * data shape are new. Upstream is MIT:
 *
 *   MIT License — copyright (c) the llama.cpp authors (Georgi Gerganov and
 *   the ggml contributors), per the licence at
 *   https://github.com/ggml-org/llama.cpp/blob/master/LICENSE
 */

import { useEffect, useState } from "react";
import type { KeyboardEvent } from "react";
import { useLanguage } from "../i18n/useLanguage";
import "./MediaViewer.css";

/** One thing the viewer shows: identified by id, its bytes fetched through
    the caller's own `load` — the viewer never holds a URL the caller does
    not own. */
export interface ViewerItem {
  id: string;
  kind: "image" | "video";
}

interface MediaViewerProps {
  items: ViewerItem[];
  index: number;
  /** The current item's URL, fetched on entry and navigation; null means
      the bytes did not come. */
  load: (item: ViewerItem) => Promise<string | null>;
  onNavigate: (index: number) => void;
  onClose: () => void;
}

/** The full-screen preview: one item at a time over a dark field, the
    strip of everything in the message below, wrap-around at both ends —
    the shape ChatAttachmentsPreview.svelte lays out in Tailwind. */
export function MediaViewer({ items, index, load, onNavigate, onClose }: MediaViewerProps) {
  const { table } = useLanguage();
  const words = table.viewer;
  const current = items[index] ?? null;
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    setUrl(null);
    setFailed(false);
    if (current !== null) {
      void load(current).then((answer) => {
        if (!alive) return;
        if (answer === null) setFailed(true);
        else setUrl(answer);
      });
    }
    return () => {
      alive = false;
    };
  }, [current?.id, load]);

  const prev = (): void => {
    if (items.length === 0) return;
    onNavigate(index > 0 ? index - 1 : items.length - 1);
  };
  const next = (): void => {
    if (items.length === 0) return;
    onNavigate(index < items.length - 1 ? index + 1 : 0);
  };

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowLeft") prev();
      if (event.key === "ArrowRight") next();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // The handlers read this render's index: re-armed on every change.
  });

  function onBoxKey(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key === "Escape") onClose();
  }

  return (
    <div
      className="media-viewer"
      role="dialog"
      aria-modal="true"
      aria-label={words.viewerAria}
      tabIndex={-1}
      onKeyDown={onBoxKey}
      onClick={onClose}
    >
      <div className="media-viewer-stage" onClick={(event) => event.stopPropagation()}>
        <div className="media-viewer-body">
          {current?.kind === "video" ? (
            // ChatAttachmentsPreviewCurrentItemVideo: the controls, the
            // caption — a video plays right here, nothing else opens.
            url ? (
              <video className="media-viewer-video" controls src={url}>
                <track kind="captions" />
                {words.videoUnsupported}
              </video>
            ) : (
              <p className="media-viewer-missing">
                {failed ? words.videoUnsupported : words.loading}
              </p>
            )
          ) : current ? (
            url ? (
              <img
                className="media-viewer-image"
                src={url}
                alt=""
                onError={() => setFailed(true)}
              />
            ) : (
              <p className="media-viewer-missing">{failed ? words.imageUnavailable : words.loading}</p>
            )
          ) : null}
        </div>
        {items.length > 1 ? (
          <>
            <button type="button" className="media-viewer-nav media-viewer-prev" aria-label={words.previous} onClick={(event) => { event.stopPropagation(); prev(); }}>
              ‹
            </button>
            <button type="button" className="media-viewer-nav media-viewer-next" aria-label={words.next} onClick={(event) => { event.stopPropagation(); next(); }}>
              ›
            </button>
          </>
        ) : null}
        <button type="button" className="media-viewer-close" aria-label={words.close} onClick={(event) => { event.stopPropagation(); onClose(); }}>
          ×
        </button>
        {items.length > 1 ? (
          <div className="media-viewer-strip" onClick={(event) => event.stopPropagation()}>
            {items.map((item, at) => (
              <button
                type="button"
                key={item.id}
                className={`media-viewer-thumb${at === index ? " is-current" : ""}`}
                aria-label={words.goTo(at + 1)}
                aria-current={at === index}
                onClick={() => onNavigate(at)}
              >
                {item.kind === "video" ? (
                  <span className="media-viewer-thumb-glyph">▶</span>
                ) : (
                  <span className="media-viewer-thumb-glyph" aria-hidden="true">
                    ▣
                  </span>
                )}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
