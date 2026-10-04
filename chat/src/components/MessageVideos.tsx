import { useEffect, useState } from "react";
import { getImage } from "../lib/imageStore";
import type { MessageVideo } from "../lib/types";
import { useLanguage } from "../i18n/useLanguage";
import { MediaViewer } from "./MediaViewer";
import type { ViewerItem } from "./MediaViewer";
import "./Thread.css";

/**
 * The videos a user message carries, replayable in place: the compressed
 * MP4 read back from IndexedDB as an object URL whose life is this
 * component's, behind a poster of the first frame the AI saw; the tile
 * opens the one viewer, where the video plays with its controls. A video
 * whose bytes were not kept (a full shelf keeps the frames and says so)
 * renders its note; one whose bytes are gone renders the missing words —
 * never a crash, never a broken player.
 */
export function MessageVideos({ videos }: { videos?: MessageVideo[] }) {
  const { table } = useLanguage();
  const words = table.thread;
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [posters, setPosters] = useState<Record<string, string>>({});
  const [settled, setSettled] = useState(false);
  const [viewingId, setViewingId] = useState<string | null>(null);
  // The ids, joined: the load re-runs when the set changes, not on every
  // parent render.
  const idKey = (videos ?? []).map((video) => video.id).join(",");

  useEffect(() => {
    const wanted = idKey ? idKey.split(",") : [];
    if (wanted.length === 0) {
      setUrls({});
      setPosters({});
      setSettled(true);
      return undefined;
    }
    let alive = true;
    const created: string[] = [];
    void (async () => {
      const nextUrls: Record<string, string> = {};
      const nextPosters: Record<string, string> = {};
      const byId = new Map((videos ?? []).map((video) => [video.id, video]));
      for (const id of wanted) {
        const video = byId.get(id);
        if (!video?.notKept) {
          const blob = await getImage(id);
          if (blob) {
            nextUrls[id] = URL.createObjectURL(blob);
            created.push(nextUrls[id]);
          }
        }
        const posterId = video?.frames[0]?.id;
        if (posterId) {
          const poster = await getImage(posterId);
          if (poster) {
            nextPosters[id] = URL.createObjectURL(poster);
            created.push(nextPosters[id]);
          }
        }
      }
      if (alive) {
        setUrls(nextUrls);
        setPosters(nextPosters);
        setSettled(true);
      } else {
        for (const url of created) URL.revokeObjectURL(url);
      }
    })();
    return () => {
      alive = false;
      for (const url of created) URL.revokeObjectURL(url);
    };
    // The videos array is read through the joined key: one identity per set.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idKey]);

  if (!videos || videos.length === 0 || !settled) return null;
  const items: ViewerItem[] = videos
    .filter((video) => urls[video.id])
    .map((video) => ({ id: video.id, kind: "video" }));
  const index = items.findIndex((item) => item.id === viewingId);
  return (
    <div className="user-videos">
      {videos.map((video) => {
        const url = urls[video.id];
        if (video.notKept) {
          return (
            <span key={video.id} className="user-video-note">
              {words.videoNotKept}
            </span>
          );
        }
        if (!url) {
          return (
            <span key={video.id} className="user-video-note">
              {words.videoMissing}
            </span>
          );
        }
        return (
          <button
            key={video.id}
            type="button"
            className="user-video-tile"
            onClick={() => setViewingId(video.id)}
            aria-label={words.videoPlay}
          >
            {posters[video.id] ? <img src={posters[video.id]} alt="" /> : null}
            <span className="user-video-play" aria-hidden="true">
              ▶
            </span>
          </button>
        );
      })}
      {viewingId !== null && index >= 0 ? (
        <MediaViewer
          items={items}
          index={index}
          load={(item) => Promise.resolve(urls[item.id] ?? null)}
          onNavigate={(next) => setViewingId(items[next]?.id ?? null)}
          onClose={() => setViewingId(null)}
        />
      ) : null}
    </div>
  );
}
