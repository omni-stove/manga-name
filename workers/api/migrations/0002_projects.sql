CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE,
  created_at INTEGER NOT NULL
);

-- updated_at は If-Match / ETag に使う。rev は保存ごとの乱数で、本文の版をどれにするかの判定に使う。
-- updated_at を判定に使わないのは、同じミリ秒に競合した保存が同じ値を作りうるため
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  rev TEXT NOT NULL
);

CREATE INDEX projects_owner_updated ON projects (owner_id, updated_at);

-- Project JSON は 5MB まで受けるが、D1 の 1 行は 2MB までなので分割して持つ
CREATE TABLE project_doc_chunks (
  project_id TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  rev TEXT NOT NULL,
  seq INTEGER NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY (project_id, rev, seq)
);
