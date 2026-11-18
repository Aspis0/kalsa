const MAX_LINES = 200;

/** The engine's last log lines. They are text, never markup: the engine's output is not trusted. */
export function LogTail({ lines, open }: { lines: string[]; open?: boolean }) {
  const shown = lines.slice(-MAX_LINES);
  return (
    <details className="run-log" open={open}>
      <summary>Log, last {MAX_LINES} lines</summary>
      <pre className="run-logbox" role="log" tabIndex={0}>
        {shown.length ? shown.join("\n") : "Nothing has been logged yet."}
      </pre>
    </details>
  );
}
