import { useEffect, useState } from "react";
import { getImage } from "../lib/imageStore";
import type { MessageImage } from "../lib/types";
import { useLanguage } from "../i18n/useLanguage";
import { MediaViewer } from "./MediaViewer";
import type { ViewerItem } from "./MediaViewer";

/**
 * The pictures a user message carries, read back from IndexedDB as object
 * URLs whose life is this component's. A blob that is gone (or a store that
 * will not open) renders the placeholder — never a broken image, never a
 * crash; the words of the message stand either way. A click opens the one
 * full-view viewer over the message's pictures.
 */
export function MessageImages({ images }: { images?: MessageImage[] }) {
  const { table } = useLanguage();
  const [urls, setUrls] = useState<Record<string, string>>({});
  // The element's own failure — a URL the policy refuses or one that died
  // between the read and the pixel — is the placeholder's case too.
  const [broken, setBroken] = useState<Record<string, boolean>>({});
  const [settled, setSettled] = useState(false);
  const [viewing, setViewing] = useState<number | null>(null);
  // The ids, joined: the load re-runs when the set changes, not on every
  // parent render.
  const idKey = (images ?? []).map((image) => image.id).join(",");

  useEffect(() => {
    const wanted = idKey ? idKey.split(",") : [];
    if (wanted.length === 0) {
      setUrls({});
      setBroken({});
      setSettled(true);
      return undefined;
    }
    let alive = true;
    const created: string[] = [];
    void (async () => {
      const next: Record<string, string> = {};
      for (const id of wanted) {
        const blob = await getImage(id);
        if (blob) {
          next[id] = URL.createObjectURL(blob);
          created.push(next[id]);
        }
      }
      if (alive) {
        setUrls(next);
        setSettled(true);
      } else {
        for (const url of created) URL.revokeObjectURL(url);
      }
    })();
    return () => {
      alive = false;
      for (const url of created) URL.revokeObjectURL(url);
    };
  }, [idKey]);

  if (!images || images.length === 0 || !settled) return null;
  const items: ViewerItem[] = images
    .filter((image) => urls[image.id] && !broken[image.id])
    .map((image) => ({ id: image.id, kind: "image" }));
  return (
    <div className="user-images">
      {images.map((image) =>
        urls[image.id] && !broken[image.id] ? (
          <button
            key={image.id}
            type="button"
            className="user-image-thumb"
            onClick={() => setViewing(items.findIndex((item) => item.id === image.id))}
            aria-label={table.viewer.enlarge}
          >
            <img
              className="user-image"
              src={urls[image.id]}
              alt=""
              onError={() => setBroken((current) => ({ ...current, [image.id]: true }))}
            />
          </button>
        ) : (
          <span key={image.id} className="user-image user-image-missing">
            {table.thread.imageMissing}
          </span>
        ),
      )}
      {viewing !== null && items.length > 0 ? (
        <MediaViewer
          items={items}
          index={Math.min(viewing, items.length - 1)}
          load={(item) => Promise.resolve(urls[item.id] ?? null)}
          onNavigate={setViewing}
          onClose={() => setViewing(null)}
        />
      ) : null}
    </div>
  );
}
