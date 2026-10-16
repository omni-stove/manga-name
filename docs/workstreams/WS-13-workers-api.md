# WS-13 workers-api

Phase 3 / 開発中の依存: DOC のみ / 統合時: WS-03, WS-14 / パッケージ: `workers/api`

## 目的
WS-03 の AI プロキシに、プロジェクトの永続化とアセットを足す。クラウド保存の土台。

## 構成
- Hono + `@hono/zod-validator`。スキーマは `@manga/schema` から import。
- D1: `projects(id, owner_id, title, updated_at, doc JSON)`, `assets(id, project_id, key, mime, size, created_at)`, `users(id, email, created_at)`, `ai_usage(user_id, kind, cost_units, created_at)`。
- R2: アセット本体。キーは `<project_id>/<asset_id>`。
- 認証ミドルウェアは WS-14 が差し込む。ここでは `c.get('userId')` を前提にし、開発時は `X-Debug-User` ヘッダで代替する。WS-03 の共有トークンは WS-14 統合時に廃止する。

## エンドポイント
```
GET    /v1/projects                         一覧（owner と参加者。自分の role 付き）
POST   /v1/projects                         作成 { title }
GET    /v1/projects/:id                     Project JSON
PUT    /v1/projects/:id                     Project JSON 全体を保存。If-Match で updated_at 楽観ロック。viewer は 403、commenter は scribbles 以外の変更が 403
DELETE /v1/projects/:id                     owner は削除、参加者は自分の参加を外す
GET    /v1/projects/:id/sync                WebSocket（WS-19）
GET    /v1/projects/:id/members             { role, members, invites（owner のみ） }
POST   /v1/projects/:id/invites             { email, role } -> { id, email, role, expiresAt, token }（owner のみ）
DELETE /v1/projects/:id/invites/:inviteId   （owner のみ）
PUT    /v1/projects/:id/members/:userId     { role }（owner のみ）
DELETE /v1/projects/:id/members/:userId     owner、または自分
GET    /v1/invites/:token                   招待の中身
POST   /v1/invites/:token/accept            ログイン中のメールアドレスが招待先と同じなら参加
POST   /v1/projects/:id/assets/upload-url   { mime, size } -> { assetId, url }  R2 署名付き PUT URL
GET    /v1/projects/:id/assets/:assetId     R2 からストリーム（または署名付き GET URL にリダイレクト）
DELETE /v1/projects/:id/assets/:assetId   upload-url とともに owner と editor のみ
GET    /v1/usage                            当月の生成回数と上限
```

## 制約
- `PUT` は `parseProject` を通らない JSON を 400 で拒否。
- 1 Project JSON 上限 5MB、1 アセット 20MB、1 ユーザーのアセット合計 5GB（`06-open-questions.md` #10）。`upload-url` で `assets.size` の合計に申告サイズを足して超えるなら 413。
- レート制限: ユーザーあたり 60 req/min。生成は別枠で月間上限（#9 で決める）。
- CORS: `apps/web` のオリジンと `tauri://localhost`。

## モック
- `wrangler dev` + ローカル D1 / R2。`X-Debug-User` で認証を迂回。
- `fixtures/sample-page-01.json` を PUT / GET するスモークテスト。

## 受け入れ条件
- [ ] 全エンドポイントの統合テスト（`vitest` + `@cloudflare/vitest-plugin`）
- [ ] 楽観ロック競合で 409
- [ ] 署名 URL で 10MB の PNG をアップロードして GET できる
- [ ] 月間上限に達した生成が 402 で止まる
- [ ] `wrangler deploy` が staging 環境に通る
