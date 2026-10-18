-- email が NULL の招待は、リンクを知っている誰でも受け取れる。SQLite は列の NOT NULL を外せないので作り直す
CREATE TABLE project_invites_new (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  email TEXT,
  role TEXT NOT NULL CHECK (role IN ('editor', 'commenter', 'viewer')),
  token_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

INSERT INTO project_invites_new SELECT id, project_id, email, role, token_hash, created_at, expires_at
FROM project_invites;

DROP TABLE project_invites;

ALTER TABLE project_invites_new RENAME TO project_invites;

CREATE INDEX project_invites_project ON project_invites (project_id);
