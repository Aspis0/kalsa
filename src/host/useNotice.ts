/**
 * The notice toast's state — lifted from `AppShell.tsx:3547-3552`
 * (`showNotice`) plus the render slot's 4 s timer: one slot, last write
 * wins, never a queue (D2 row 17 — a queue here would be a behaviour
 * change, not parity).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale, type TranslationKey } from "../i18n";

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
    () => () => {
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
    },
    [],
  );

  return { notice, showNotice, showNoticeKey };
}
