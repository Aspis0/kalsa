/**
 * The notice toast's state — lifted from `AppShell.tsx:3547-3552`
 * (`showNotice`) plus the render slot's 4 s timer: one slot, last write
 * wins, never a queue (D2 row 17 — a queue here would be a behaviour
 * change, not parity).
 *
 * `noticePort` is the slot's out-of-tree writer, same module-ref idiom as
 * `bumpForegroundIdleRef`: hooks the root composes BELOW its own `useNotice()`
 * call (the download's ready notice) cannot receive `showNotice` without a
 * line the root's ratchet (`fileSize.test.ts` ROOT_FILE_LIMIT) forbids, and
 * they must not open a second slot. The port points at THIS hook's
 * `showNotice` — one slot, one timer, whoever writes.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale, type TranslationKey } from "../i18n";

/** Non-null only while a `useNotice()` instance is mounted. */
export const noticePort: { current: ((value: string) => void) | null } = {
  current: null,
};

export function useNotice(): {
  notice: string | null;
  showNotice: (value: string) => void;
  showNoticeKey: (key: TranslationKey) => void;
} {
  const { t } = useLocale();
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showNotice = useCallback((value: string) => {
    setNotice(value);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), 4000);
  }, []);

  const showNoticeKey = useCallback(
    (key: TranslationKey) => showNotice(t(key)),
    [showNotice, t],
  );

  useEffect(
    () => {
      noticePort.current = showNotice;
      return () => {
        noticePort.current = null;
        if (noticeTimer.current) clearTimeout(noticeTimer.current);
      };
    },
    [showNotice],
  );

  return { notice, showNotice, showNoticeKey };
}
