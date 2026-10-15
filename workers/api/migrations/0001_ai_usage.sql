CREATE TABLE ai_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash TEXT NOT NULL,
  kind TEXT NOT NULL,
  cost_units INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX ai_usage_token_created ON ai_usage (token_hash, created_at);
