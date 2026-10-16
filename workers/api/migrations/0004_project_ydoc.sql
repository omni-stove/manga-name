-- 同期サーバ（ProjectRoom Durable Object）が定期的に書く Yjs の状態。DO storage を失ったときの復元元。
-- D1 の 1 行は 2MB までなので分割して持つ
CREATE TABLE project_ydoc_chunks (
  project_id TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  data BLOB NOT NULL,
  PRIMARY KEY (project_id, seq)
);
