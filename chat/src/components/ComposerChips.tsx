import { useLanguage } from "../i18n/useLanguage";
import type { Attachment } from "../lib/attachments";
import type { ComposerImage } from "./Composer";
import { Icon } from "./Icon";

/** What rides with the next message, inside the composer box (mockup
    11-chat-states-attachments): documents with Keep, then pictures. */
export function ComposerChips({
  docs,
  onRemoveDoc,
  onPinDoc,
  images,
  onRemoveImage,
}: {
  docs: Attachment[];
  onRemoveDoc?: (id: string) => void;
  onPinDoc?: (id: string, pinned: boolean) => void;
  images: ComposerImage[];
  onRemoveImage?: (id: string) => void;
}) {
  const { table } = useLanguage();
  const composer = table.composer;
  const fileWords = table.files;
  const showDocs = docs.length > 0 && onRemoveDoc;
  const showImages = images.length > 0 && onRemoveImage;
  if (!showDocs && !showImages) return null;

  // The same "pdf · 1 page" the files panel shows, so one attachment reads the same in both places.
  const docMeta = (a: Attachment): string => {
    const parts: string[] = [a.kind];
    if (a.pages !== undefined) parts.push(a.pages === 1 ? fileWords.onePage : fileWords.pages(a.pages));
    return parts.join(" · ");
  };

  return (
    <div className="composer-chips">
      {showDocs
        ? docs.map((doc) => {
            const kept = doc.pinned ?? true;
            return (
              <div key={doc.id} className="composer-doc">
                <span className="composer-doc-icon" aria-hidden="true">
                  <Icon name="file" size={18} />
                </span>
                <span className="composer-doc-text">
                  <b title={doc.name}>{doc.name}</b>
                  <small>{docMeta(doc)}</small>
                </span>
                {onPinDoc ? (
                  <button
                    type="button"
                    className={`composer-doc-keep${kept ? " is-on" : ""}`}
                    aria-pressed={kept}
                    title={fileWords.pinDoc}
                    onClick={() => onPinDoc(doc.id, !kept)}
                  >
                    <Icon name="pin" size={13} />
                    {fileWords.pinName}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="composer-chip-remove"
                  aria-label={composer.removeDoc}
                  onClick={() => onRemoveDoc?.(doc.id)}
                >
                  <Icon name="x" size={16} />
                </button>
              </div>
            );
          })
        : null}
      {showImages
        ? images.map((image) => (
            <figure key={image.id} className="composer-image">
              {image.label !== undefined ? <figcaption className="composer-image-label">{image.label}</figcaption> : null}
              {image.url && image.kind !== "video" ? (
                <img
                  src={image.url}
                  alt=""
                  onError={(event) => {
                    event.currentTarget.style.display = "none";
                  }}
                />
              ) : (
                <span className="composer-image-glyph" aria-hidden="true">
                  ▶
                </span>
              )}
              <button
                type="button"
                className="composer-image-remove"
                aria-label={composer.removeImage}
                onClick={() => onRemoveImage?.(image.id)}
              >
                <Icon name="x" size={12} stroke={2.4} />
              </button>
            </figure>
          ))
        : null}
    </div>
  );
}
