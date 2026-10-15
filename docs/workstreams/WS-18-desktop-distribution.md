# WS-18 desktop-distribution

Phase 4 / 開発中の依存: なし / 統合時: WS-17

## 目的
署名済み Desktop ビルドの配布と自動更新。

## スコープ
- GitHub Actions でタグ push 時に macOS（universal）と Windows をビルド。
- macOS: Developer ID 署名と notarization。Windows: コード署名（証明書は未決）。
- `@tauri-apps/plugin-updater` で更新チェック。更新マニフェストは R2 または GitHub Releases。
- バージョンは `package.json` と `tauri.conf.json` を同期（スクリプト）。
- クラッシュ時のログ出力先と取得手順。

## 受け入れ条件
- [ ] タグ push で両 OS のインストーラが Releases に上がる
- [ ] 旧バージョンから自動更新が走る
- [ ] macOS で Gatekeeper の警告が出ない
