-- Single-use sign-in state: a signed cookie alone is not enough, the row must still be there.
CREATE TABLE signin_states (
  hash TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX signin_states_expires_at ON signin_states (expires_at);

-- SQLite cannot add ON DELETE CASCADE to an existing column, so sessions is rebuilt with it.
CREATE TABLE sessions_with_cascade (
  hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
INSERT INTO sessions_with_cascade (hash, user_id, expires_at) SELECT hash, user_id, expires_at FROM sessions;
DROP TABLE sessions;
ALTER TABLE sessions_with_cascade RENAME TO sessions;
CREATE INDEX sessions_user_id ON sessions (user_id);
CREATE INDEX sessions_expires_at ON sessions (expires_at);
