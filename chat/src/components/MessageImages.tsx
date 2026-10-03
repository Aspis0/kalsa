import { useEffect, useState } from "react";
import { getImage } from "../lib/imageStore";
import type { MessageImage } from "../lib/types";
import { useLanguage } from "../i18n/useLanguage";

/**
 * The pictures a user message carries, read back from IndexedDB as object
 * URLs whose life is this component's. A blob that is gone (or a store that
 * will not open) renders the placeholder — never a broken image, never a
 * crash; the words of the message stand either way.
 */
export function MessageImages({ images }: { images?: MessageImage[] }) {
  const { table } = useLanguage();
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [settled, setSettled] = useState(false);
  // The ids, joined: the load re-runs when the set changes, not on every
  // parent render.
  const idKey = (images ?? []).map((image) => image.id).join(",");

  useEffect(() => {
    const wanted = idKey ? idKey.split(",") : [];
    if (wanted.length === 0) {
      setUrls({});
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
  return (
    <div className="user-images">
      {images.map((image) =>
        urls[image.id] ? (
          <img key={image.id} className="user-image" src={urls[image.id]} alt="" />
        ) : (
          <span key={image.id} className="user-image user-image-missing">
            {table.thread.imageMissing}
          </span>
        ),
      )}
    </div>
  );
}
