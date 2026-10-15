# WS-17 desktop-shell

Phase 4 / 開発中の依存: DOC のみ / 統合時: WS-06 / パッケージ: `apps/desktop`, `packages/storage`

## 目的
Tauri 2 で `apps/web` をラップし、ローカルファイル保存を提供する。

## スコープ
- Tauri 2 プロジェクト。`apps/web` の Vite ビルドを `frontendDist` に指定。開発時は `devUrl` で Vite に接続。
- `createFileStorage`: プロジェクトを `<name>.manga.json`、アセットを同名ディレクトリ `<name>.manga.assets/` に保存。`ref` は `file:<relative path>`。
- ネイティブダイアログ（開く、保存、名前を付けて保存、書き出し先）。
- 最近開いたファイル一覧。
- メニュー: ファイル、編集（Undo / Redo をアプリにディスパッチ）、表示。
- ウィンドウ状態の復元。

## 実装メモ
- ファイルアクセスは `@tauri-apps/plugin-fs` と `plugin-dialog`。Rust 側に独自コマンドはなるべく書かない。
- `apps/web` 側に platform 判定を入れ、`createStorage('file')` を選ぶ。判定ロジックは `packages/storage` に置く。
- 認証トークン保存は WS-14 の Desktop 分をここで実装する。

## 受け入れ条件
- [ ] macOS でビルドして起動し、フィクスチャを開いて生成して保存して再度開ける
- [ ] Windows でも同じ（CI でビルドだけでも可）
- [ ] 保存ファイルが `parseProject` を通る
- [ ] アセットの put / resolve / load がファイルシステムで動く
