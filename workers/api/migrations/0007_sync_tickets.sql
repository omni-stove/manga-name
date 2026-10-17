-- ブラウザの WebSocket は要求ヘッダを付けられないので、同期の接続は URL に載せたこのチケットで認証する。
-- 1 回使うと消し、トークンは SHA-256 だけを持つ
CREATE TABLE sync_tickets (
  token_hash TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX sync_tickets_expires ON sync_tickets (expires_at);
