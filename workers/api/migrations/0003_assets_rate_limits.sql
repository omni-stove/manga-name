-- 本体は R2 の key に置き、ここには所有の判定と GET の応答ヘッダに要る値だけを持つ。
-- 削除は deleted_at を立てるだけで行を残す。行を消すと、署名 URL の期限内に同じ id で PUT し直せてしまう
CREATE TABLE assets (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  deleted_at INTEGER
);

CREATE INDEX assets_project ON assets (project_id);

-- 1 分ごとの固定窓。要求ごとに行を足すと 60 req/min で表がすぐ膨らむので、窓ごとに数だけ持つ
CREATE TABLE rate_limits (
  user_id TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (user_id, window_start)
);

-- 共有トークンの間は X-Debug-User を送らない呼び出しもあるので NULL を許す
ALTER TABLE ai_usage ADD COLUMN user_id TEXT;

CREATE INDEX ai_usage_user_created ON ai_usage (user_id, created_at);
