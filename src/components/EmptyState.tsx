import "./EmptyState.css";

interface EmptyStateProps {
  needsSetup: boolean;
  onOpenSettings: () => void;
}

/** First-run screen. One sentence, no jargon. */
export function EmptyState({ needsSetup, onOpenSettings }: EmptyStateProps) {
  return (
    <div className="empty">
      <div className="empty-mark" aria-hidden="true">
        <span />
      </div>
      <h2 className="empty-title">Talk to your model.</h2>
      {needsSetup ? (
        <>
          <p className="empty-copy">
            Tell the app where your chat server lives, then say hello.
          </p>
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
