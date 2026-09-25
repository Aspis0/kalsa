import "./EmptyState.css";

interface EmptyStateProps {
  /** What is missing, named by the page that fixes it: the machine is off
      (`"server"`), or a running machine has no model name (`"settings"`).
      Null: nothing is missing. */
  setup: "server" | "settings" | null;
  onOpenSettings: () => void;
  onOpenServer: () => void;
}

/** First-run screen. One sentence, no jargon. */
export function EmptyState({ setup, onOpenSettings, onOpenServer }: EmptyStateProps) {
  return (
    <div className="empty">
      <div className="empty-mark" aria-hidden="true">
        <span />
      </div>
      <h2 className="empty-title">Talk to your model.</h2>
      {setup === "server" ? (
        <>
          <p className="empty-copy">This computer is not running anything right now.</p>
          <button type="button" className="btn-primary btn-large" onClick={onOpenServer}>
            Go to Server
          </button>
        </>
      ) : setup === "settings" ? (
        <>
          <p className="empty-copy">This computer has no model name yet.</p>
          <button type="button" className="btn-primary btn-large" onClick={onOpenSettings}>
            Open settings
          </button>
        </>
      ) : (
        <p className="empty-copy">Write your first message below to begin.</p>
      )}
    </div>
  );
}
