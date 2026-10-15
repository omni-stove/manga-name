# WS-14 auth

Phase 3 / 開発中の依存: `06-open-questions.md` #3 の決定 / 統合時: WS-13

## 目的
Web と Desktop の両方で同じアカウントにログインし、Workers API を叩けるようにする。WS-03 の共有アクセストークンを置き換える。

## 決定待ち
認証方式（#3）。決定後にこのブリーフを更新する。以下は方式に依存しない要件。

## 要件
- メールリンクまたは OAuth（Google, GitHub）。パスワードは持たない。
- Workers 側ミドルウェア: `Authorization: Bearer <token>` を検証し `c.set('userId', ...)`。`/v1/ai/*` も同じミドルウェアを通す。
- Web: Cookie またはメモリ保持。リフレッシュは透過的に。
- Desktop: WebView 内で同じログインフローを実行。トークンは `@tauri-apps/plugin-store` または OS keychain に保存。外部ブラウザ経由のコールバック（deep link）は不要。
- `apps/web` に `useAuth()` フック: `{ user, signIn(), signOut(), getToken() }`。
- 未ログインでもローカルストレージモードで編集、合成、書き出しが使える。ログインは生成とクラウド保存の前提にするだけ。

## 受け入れ条件
- [ ] Web でログインし、`GET /v1/projects` と `POST /v1/ai/panel-art` が 200 を返す
- [ ] トークン失効時に自動リフレッシュ、失敗時はローカルモードに降格してデータを失わない
- [ ] サインアウトでトークンが完全に消える
- [ ] 共有アクセストークンの設定項目が消えている
