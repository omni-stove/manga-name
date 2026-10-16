-- owner は projects.owner_id が持つので、ここには owner 以外の参加者だけを置く
CREATE TABLE project_members (
  project_id TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('editor', 'commenter', 'viewer')),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (project_id, user_id)
);

CREATE INDEX project_members_user ON project_members (user_id);

-- トークンは SHA-256 だけを持つ。D1 が読まれてもリンクを組み立て直せないようにするため
CREATE TABLE project_invites (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('editor', 'commenter', 'viewer')),
  token_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX project_invites_project ON project_invites (project_id);
