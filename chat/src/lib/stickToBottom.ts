/**
 * Stick to the bottom of a scrolling message list.
 *
 * Lifted from assistant-ui (MIT), at commit
 * 16ef5b3e1f982a392c00a9a90b291c02e6c6fc5c (2026-09-22):
 *   packages/react/src/primitives/thread/useThreadViewportAutoScroll.ts
 *   packages/store/src/utils/viewport-scroll.ts
 * https://github.com/assistant-ui/assistant-ui
 * Copyright (c) 2025 AgentbaseAI Inc. See THIRD-PARTY-NOTICES.md.
 *
 * Kept: the list follows new content while the reader sits at the bottom; the
 * moment they scroll up it stops moving under them; scrolling back to the
 * bottom resumes following; content growing above the fold is never mistaken
 * for a scroll-up (upstream's `isUserScrollUp` compares scrollHeight too), so a
 * picture that finishes loading does not detach a reader who is scrolled up.
 *
 * Dropped, because this app has none of them: run-start and thread-switch
 * triggers, smooth-scroll scheduling, the top-anchor reserve, and upstream's
 * viewport stores — the reader's position is this hook's own state.
 */
import { useCallback, useRef, useState } from "react";

/** A fractional scrollHeight (device pixel ratios) sits a hair above the exact
    bottom; within this many pixels the reader still counts as at the bottom. */
const AT_BOTTOM_PX = 2;

interface ScrollPosition {
  scrollTop: number;
  scrollHeight: number;
}

function isAtBottom(el: HTMLDivElement): boolean {
  return (
    el.scrollHeight <= el.clientHeight ||
    el.scrollHeight - el.scrollTop - el.clientHeight <= AT_BOTTOM_PX
  );
}

function isUserScrollUp(before: ScrollPosition, el: HTMLDivElement): boolean {
  return before.scrollTop > el.scrollTop && before.scrollHeight === el.scrollHeight;
}

export function useStickToBottom(): {
  /** The scrolling element: attach to the div that holds the list. */
  ref: (el: HTMLDivElement | null) => void;
  /** Whether new content is followed (false while the reader is above the end). */
  following: boolean;
  /** Return to the end of the list and follow again. */
  toBottom: () => void;
} {
  const [following, setFollowing] = useState(true);
  const follow = useRef(true);
  const node = useRef<HTMLDivElement | null>(null);
  const before = useRef<ScrollPosition>({ scrollTop: 0, scrollHeight: 0 });
  const seen = useRef({ scrollHeight: 0, clientHeight: 0 });
  const detach = useRef<(() => void) | null>(null);

  const settle = useCallback((next: boolean) => {
    if (follow.current === next) return;
    follow.current = next;
    setFollowing(next);
  }, []);

  const toBottom = useCallback(() => {
    const el = node.current;
    if (!el) return;
    settle(true);
    el.scrollTop = el.scrollHeight;
  }, [settle]);

  const handleScroll = useCallback(() => {
    const el = node.current;
    if (!el) return;
    if (isAtBottom(el)) settle(true);
    else if (isUserScrollUp(before.current, el)) settle(false);
    before.current.scrollTop = el.scrollTop;
    before.current.scrollHeight = el.scrollHeight;
  }, [settle]);

  /** Words arrived or a box changed size: keep the end under a reader who is
      following it, and leave a reader who is not exactly where they are. */
  const handleContentChange = useCallback(() => {
    const el = node.current;
    if (!el) return;
    const { scrollHeight, clientHeight } = el;
    // A re-render or an attribute can move nothing; the sizes decide.
    if (scrollHeight === seen.current.scrollHeight && clientHeight === seen.current.clientHeight) return;
    seen.current.scrollHeight = scrollHeight;
    seen.current.clientHeight = clientHeight;
    if (follow.current) el.scrollTop = el.scrollHeight;
    handleScroll();
  }, [handleScroll]);

  const ref = useCallback(
    (el: HTMLDivElement | null) => {
      detach.current?.();
      detach.current = null;
      node.current = el;
      if (!el) return;

      // The container's own box covers a resized window, its content child
      // every growth of the page's text — a message arriving, a picture
      // finishing its load, a tool row opening.
      const resize = new ResizeObserver(handleContentChange);
      resize.observe(el);
      const content = el.firstElementChild;
      if (content) resize.observe(content);

      // A box observer waits for a paint before it says anything, and words
      // arriving have to move the view as they arrive. A mutation needs no
      // paint. Style-only attribute writes are the scroll's own feedback and
      // are ignored, as upstream ignores them.
      const mutations = new MutationObserver((records) => {
        const relevant = records.some(
          (record) => record.type !== "attributes" || record.attributeName !== "style",
        );
        if (relevant) handleContentChange();
      });
      mutations.observe(el, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
      });

      el.addEventListener("scroll", handleScroll, { passive: true });
      if (follow.current) el.scrollTop = el.scrollHeight;
      detach.current = () => {
        el.removeEventListener("scroll", handleScroll);
        resize.disconnect();
        mutations.disconnect();
      };
    },
    [handleContentChange, handleScroll],
  );

  return { ref, following, toBottom };
}
