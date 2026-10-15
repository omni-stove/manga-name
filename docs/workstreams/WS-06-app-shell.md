# WS-06 app-shell

Phase 1 / 開発中の依存: DOC のみ / パッケージ: `apps/web`, `packages/storage`

## 目的
Web アプリの骨格。ルーティング、store、ストレージアダプタ（インメモリと IndexedDB）、ページ一覧、各パッケージを配線する枠。統合担当がここで Phase 1 をまとめる。

## ルート（TanStack Router, file-based）
```
/                               プロジェクト一覧
/p/$projectId                   エピソードとページのサムネイル一覧。ページ単位の生成状況（未生成 / 一部 / 全部）を表示
/p/$projectId/pages/$pageId     エディタ（キャンバス + インスペクタ）
/p/$projectId/characters        キャラクター一覧と編集
/p/$projectId/settings          direction、pageSize、dpi、style
/settings                       アプリ設定（ストレージ切替、AI プロキシの URL とアクセストークン、テーマ）
```

## store
`03-data-model.md` の `ProjectStore` を Zustand + Immer で実装。
- `applyPatch` は `fast-json-patch` 等で適用し、履歴に積む。Undo / Redo は履歴ベース。
- `source: 'remote'` の patch は履歴に積まない（Phase 4 用）。
- 変更は 500ms debounce で `StorageAdapter.saveProject` に流す。

## packages/storage
```ts
export interface StorageAdapter { ... }   // 03-data-model.md の通り
export function createMemoryStorage(): StorageAdapter;
export function createIndexedDbStorage(): StorageAdapter;   // idb を使用。アセットも Blob で保存
export function createStorage(kind: 'memory' | 'indexeddb'): StorageAdapter;
```
`createMemoryStorage` は他 WS のモックに使われるので最初に commit する。

## 配線
- `EditorCanvas` と各 Inspector の `onChange(patch)` を受け、path を Project root 基準に変換して `applyPatch`。
- ツールバー: ツール切替、レイヤー表示切替、Undo / Redo、保存状態表示、「書き出し」（WS-07 / WS-08 が中身を入れる）。
- JSON のエクスポート / インポート（ファイルダウンロードとドロップ）。アセットは含めない。
- 生成の配線は WS-07。ここでは `ImageProvider` を DI する口（`createImageProvider()`。設定が無ければ Fake）だけ用意する。

## モック
- 統合前は `EditorCanvas` と Inspector の位置にプレースホルダを置き、フィクスチャをロードして JSON を表示するだけで可。

## 受け入れ条件
- [ ] プロジェクト作成、ページ追加（テンプレート選択）、削除、並べ替え、キャラクター追加ができる
- [ ] リロードしても IndexedDB から復元される。アセットも復元される
- [ ] Undo / Redo が 100 ステップ以上効く
- [ ] JSON エクスポートが `parseProject` を通る。インポートでフィクスチャを読める
- [ ] 統合後、フィクスチャのページがキャンバスに出る
