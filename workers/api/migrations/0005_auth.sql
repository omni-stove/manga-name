-- Better Auth の表。列名を Better Auth の既定（camelCase）のままにしているのは、全列を fields で写し替えずに済ませるため。
-- 表名に auth_ を付けるのは、プロジェクトの持ち主を表す users と分けるため。users の行は保存時に Better Auth のユーザー id で作られる
CREATE TABLE auth_users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  emailVerified INTEGER NOT NULL,
  image TEXT,
  createdAt DATE NOT NULL,
  updatedAt DATE NOT NULL
);

CREATE TABLE auth_sessions (
  id TEXT PRIMARY KEY,
  expiresAt DATE NOT NULL,
  token TEXT NOT NULL UNIQUE,
  createdAt DATE NOT NULL,
  updatedAt DATE NOT NULL,
  ipAddress TEXT,
  userAgent TEXT,
  userId TEXT NOT NULL REFERENCES auth_users (id) ON DELETE CASCADE
);

CREATE INDEX auth_sessions_user ON auth_sessions (userId);

CREATE TABLE auth_accounts (
  id TEXT PRIMARY KEY,
  accountId TEXT NOT NULL,
  providerId TEXT NOT NULL,
  userId TEXT NOT NULL REFERENCES auth_users (id) ON DELETE CASCADE,
  accessToken TEXT,
  refreshToken TEXT,
  idToken TEXT,
  accessTokenExpiresAt DATE,
  refreshTokenExpiresAt DATE,
  scope TEXT,
  password TEXT,
  createdAt DATE NOT NULL,
  updatedAt DATE NOT NULL
);

CREATE INDEX auth_accounts_user ON auth_accounts (userId);

CREATE TABLE auth_verifications (
  id TEXT PRIMARY KEY,
  identifier TEXT NOT NULL,
  value TEXT NOT NULL,
  expiresAt DATE NOT NULL,
  createdAt DATE NOT NULL,
  updatedAt DATE NOT NULL
);

CREATE INDEX auth_verifications_identifier ON auth_verifications (identifier);

-- 共有トークンを廃止し、生成の回数はユーザーだけで数える。SQLite で user_id に NOT NULL を付けるには
-- 表を作り直すしかない。user_id の無い行は共有トークンの分で、数える相手がもう居ないので移さない
CREATE TABLE ai_usage_next (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  cost_units INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

INSERT INTO ai_usage_next (id, user_id, kind, cost_units, created_at)
SELECT id, user_id, kind, cost_units, created_at FROM ai_usage WHERE user_id IS NOT NULL;

DROP TABLE ai_usage;

ALTER TABLE ai_usage_next RENAME TO ai_usage;

CREATE INDEX ai_usage_user_created ON ai_usage (user_id, created_at);
