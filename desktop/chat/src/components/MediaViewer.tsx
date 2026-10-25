/**
 * A React port of llama.cpp's attachment preview: the full-view lightbox
 * with wrap-around previous/next and the video item.
 *
 * Ported from `tools/ui/src/lib/components/app/chat/ChatAttachments/`:
 *   - ChatAttachmentsPreview/ChatAttachmentsPreview.svelte
 *   - ChatAttachmentsPreview/ChatAttachmentsPreviewCurrentItem/ChatAttachmentsPreviewCurrentItemVideo.svelte
 * at llama.cpp commit b23efaa2ef147f547ee75cbf0c621d61904de80e.
 *
 * The navigation model (index that wraps at both ends), the centered
 * current item and the video item with its controls are the upstream
 * component's; the Svelte-to-React translation, the keyboard and focus
 * handling, the close affordance, the position line and this app's data
 * shape are new (upstream's thumbnail strip is not drawn). Upstream is MIT:
 *
 *   MIT License — copyright (c) the llama.cpp authors (Georgi Gerganov and
 *   the ggml contributors), per the licence at
 *   https://github.com/ggml-org/llama.cpp/blob/master/LICENSE
 */

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLanguage } from "../i18n/useLanguage";
import { Icon } from "./Icon";
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

/** The full-screen preview: one item at a time over a dark field, its
    position below, wrap-around at both ends. A modal: focus moves in, stays
    in, and goes back to the thumbnail that opened it. */
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

  const root = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  // In on open, back to the opener on close (when it is still on the page).
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    return () => {
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  useEffect(() => {
    // Capture phase, before the shell's own Escape (which leaves the page):
    // Escape here closes the viewer and nothing else.
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      } else if (event.key === "ArrowLeft") prev();
      else if (event.key === "ArrowRight") next();
      else if (event.key === "Tab") keepFocusInside(event);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
    // The handlers read this render's index: re-armed on every change.
  });

  function keepFocusInside(event: KeyboardEvent): void {
    const stops = [...(root.current?.querySelectorAll<HTMLElement>("button, video[controls]") ?? [])];
    if (stops.length === 0) return;
    const at = stops.indexOf(document.activeElement as HTMLElement);
    const to = event.shiftKey ? (at <= 0 ? stops.length - 1 : at - 1) : at === stops.length - 1 || at < 0 ? 0 : at + 1;
    event.preventDefault();
    stops[to].focus();
  }

  // On the body, not where the thumbnail sits: a thread row is
  // `content-visibility: auto`, which contains fixed descendants to the row.
  return createPortal(
      <div
        className="media-viewer"
        role="dialog"
        aria-modal="true"
        aria-label={words.viewerAria}
        ref={root}
        tabIndex={-1}
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
                <Icon name="left" size={26} />
              </button>
              <button type="button" className="media-viewer-nav media-viewer-next" aria-label={words.next} onClick={(event) => { event.stopPropagation(); next(); }}>
                <Icon name="right" size={26} />
              </button>
            </>
          ) : null}
          <button ref={closeRef} type="button" className="media-viewer-close" aria-label={words.close} onClick={(event) => { event.stopPropagation(); onClose(); }}>
            <Icon name="x" size={24} />
          </button>
          {items.length > 1 ? <p className="media-viewer-count">{words.position(index + 1, items.length)}</p> : null}
        </div>
      </div>,
    document.body,
  );
}
