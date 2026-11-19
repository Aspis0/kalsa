-- A page its owner removed. Nothing about the person beyond the GitHub id that asked for it.
CREATE TABLE removals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  target TEXT NOT NULL,
  github_user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (kind, target)
);

-- Fixed-window abuse counts for the sign-in callback and the removal endpoint.
-- The key is a scope and an account or address; the row holds a count, never a request body.
CREATE TABLE abuse_limits (
  key TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  hits INTEGER NOT NULL
);
CREATE INDEX abuse_limits_window_start ON abuse_limits (window_start);
