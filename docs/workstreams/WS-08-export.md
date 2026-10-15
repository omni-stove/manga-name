# WS-08 export

Phase 2 / 開発中の依存: DOC のみ / 統合時: WS-02, WS-06 / パッケージ: `packages/render`, `apps/web`

## 目的
漫画家と編集者に渡す PDF をクライアント側で生成する。

## 公開 API
`03-data-model.md` の `exportPdf` の通り。`packages/render` に置く。

## 内容
- `pdf-lib` を使う。各ページは `renderPage` の PNG を 1 枚埋め込む。ベクタ化はしない。
- `spread: true` なら見開きで 1 枚にまとめる。右綴じは奇数ページが左。
- `notes: 'sheet'` なら各ページの後ろに指示メモの一覧ページを足す。コマ番号、camera、note、セリフの一覧を横書きで。フォントは Noto Sans JP を埋め込む。
- `pages` で範囲指定。
- Web Worker で実行し、進捗（n / total）を返す。UI をブロックしない。
- 書き出しダイアログ（`apps/web`）: 形式（PNG 一括 zip / PDF）、ページ範囲、notes、panelNumbers、spread、dpi 上書き。
- 未生成コマが残っているときは警告を出すが、書き出しは止めない。

## モック
- フィクスチャと `docs/fixtures/art/*.png` を入力にする。

## 受け入れ条件
- [ ] フィクスチャから PDF が出て、Preview.app と Acrobat で開ける
- [ ] 指示メモページの日本語が文字化けしない
- [ ] 20 ページで 10 秒以内（300dpi）
- [ ] `spread: true` で右綴じの並びが正しい（奇数ページ左）
- [ ] 書き出し中に UI がブロックされず、進捗が出る
