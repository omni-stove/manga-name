# @manga/web

Vite + React 19 + TanStack Router（file-based）の Web アプリ。仕様は `docs/workstreams/WS-06-app-shell.md`。

```sh
pnpm --filter @manga/web dev
pnpm --filter @manga/web typecheck
pnpm --filter @manga/web test
```

## ルート

| パス | ファイル | 画面 |
|---|---|---|
| `/` | `src/routes/index.tsx` | プロジェクト一覧 |
| `/p/$projectId` | `src/routes/p.$projectId.index.tsx` | ページ一覧。生成状況（未生成 / 一部 / 全部） |
| `/p/$projectId/pages/$pageId` | `src/routes/p.$projectId_.pages.$pageId.tsx` | エディタ。キャンバスとインスペクタのプレースホルダ |
| `/p/$projectId/characters` | `src/routes/p.$projectId.characters.tsx` | キャラクター一覧 |
| `/p/$projectId/settings` | `src/routes/p.$projectId.settings.tsx` | プロジェクト設定 |
| `/settings` | `src/routes/settings.tsx` | アプリ設定 |

`src/routes/p.$projectId.tsx` はプロジェクト配下のタブを持つレイアウトで、エディタだけは `_` 付きのファイル名でその外に置く。
`src/routeTree.gen.ts` は `@tanstack/router-plugin` が `dev` と `build` で生成する。手で編集しない。

## ProjectStore

`src/store/project-store.ts` の `createProjectStore(project, { saveProject })` が `docs/03-data-model.md` の `ProjectStore` を Zustand + Immer で実装する。

- 変更はすべて `applyPatch(patch, { source, label })` で入れる。結果が `ProjectSchema` を通らない patch は throw し、状態を変えない。
- `user` と `ai` の変更は履歴に積み、Undo / Redo できる（既定 200 ステップ）。`remote` は履歴に積まない。
- 変更は 500ms debounce で `saveProject` に流す。保存状態は `store.state` の `saveStatus` に出る。React からは `useStore(store.state, selector)` で読む。

## 仮データ

ProjectStore と StorageAdapter が配線されるまで、各画面は `src/placeholder.ts` からフィクスチャ 1 件を読む。

## テスト

in-source（`import.meta.vitest`）。`src/router.tsx` で各ルートをメモリ履歴で描画して見出しを検証する。
