import { useEffect, useRef, useState } from "react";
import { copyText } from "../lib/clipboard";
import { useLanguage } from "../i18n/useLanguage";
import { Icon } from "./Icon";
import "./MessageActions.css";

/** How long the check stays after a copy. */
const COPIED_MS = 1500;

function clockTime(when: number, tag: string): string {
  try {
    return new Intl.DateTimeFormat(tag, { hour: "numeric", minute: "2-digit" }).format(when);
  } catch {
    return "";
  }
}

/** The quiet row under a finished answer (RULES.md "Message action row"):
    copy the answer's own markdown, and the time it was asked for. A message
    stored without a time shows none rather than a made-up one. */
export function MessageActions({ text, at }: { text: string; at: number }) {
  const { table, tag } = useLanguage();
  const t = table.markdown;
  const [outcome, setOutcome] = useState<"copied" | "failed" | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      window.clearTimeout(timer.current);
    };
  }, []);

  async function copy(): Promise<void> {
    const ok = await copyText(text);
    // The row may have gone while the clipboard answered: nothing left to show.
    if (!mounted.current) return;
    setOutcome(ok ? "copied" : "failed");
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOutcome(null), COPIED_MS);
  }

  return (
    <div className="message-actions">
      <button
        type="button"
        className={`message-copy${outcome === "copied" ? " is-done" : ""}`}
        aria-label={table.thread.copyAnswer}
        title={table.thread.copyAnswer}
        onClick={() => void copy()}
      >
        <Icon name={outcome === "copied" ? "check" : "copy"} size={14} stroke={outcome === "copied" ? 2.4 : 1.8} />
      </button>
      {at > 0 ? <time dateTime={new Date(at).toISOString()}>{clockTime(at, tag)}</time> : null}
      <span className="visually-hidden" role="status">
        {outcome === "copied" ? t.copied : outcome === "failed" ? t.copyFailed : ""}
      </span>
    </div>
  );
}
