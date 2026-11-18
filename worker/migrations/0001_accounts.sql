-- Accounts and their sessions. A user row holds the public identity read once at
-- sign-in; provider access tokens are never written here. A session row holds the
-- SHA-256 of the cookie value, never the value itself.
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL,
  provider_user_id TEXT NOT NULL,
  username TEXT NOT NULL,
  avatar_url TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE (provider, provider_user_id)
);

CREATE TABLE sessions (
  hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users (id),
  expires_at INTEGER NOT NULL
);
