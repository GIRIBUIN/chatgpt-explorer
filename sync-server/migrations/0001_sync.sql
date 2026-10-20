CREATE TABLE sync_workspaces (
  sync_id TEXT PRIMARY KEY NOT NULL,
  auth_hash TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  encrypted_blob TEXT NOT NULL CHECK (length(encrypted_blob) <= 1000000),
  updated_at INTEGER NOT NULL
);
