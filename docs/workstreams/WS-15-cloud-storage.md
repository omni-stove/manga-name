# WS-15 cloud-storage

Phase 3 / 開発中の依存: DOC のみ / 統合時: WS-06, WS-13, WS-14 / パッケージ: `packages/storage`

## 目的
`StorageAdapter` のクラウド実装と、ローカルとクラウドの同期。

## 公開 API
```ts
export class CloudStorageAdapter implements StorageAdapter {
  constructor(opts: { baseUrl: string; getToken(): Promise<string | null>; local: StorageAdapter });
}
export type SyncState = 'synced' | 'pending' | 'offline' | 'conflict';
export function useSyncState(): SyncState;   // apps/web 向け
```

## 方針
- ローカル優先。書き込みは常に `local` に即時、クラウドへは debounce 2 秒でバックグラウンド送信。
- 読み込みはローカルがあればローカル、なければクラウド。起動時にクラウドの `updated_at` と比較して新しい方を採用。
- 競合（`PUT` が 409）: Phase 3 は「クラウド版を別名で保存して両方残す」。自動マージは Phase 4（WS-19）。
- アセットは `putAsset` でローカル保存後、署名 URL でアップロード。`ref` は `r2:<key>` に書き換え、ローカルにはキャッシュとして残す。生成画像は件数が多いので、アップロードは採用中（`artId`）を優先し、履歴は後回しにする。
- オフライン検知は `navigator.onLine` と失敗リトライ（指数バックオフ、上限 5 分）。

## モック
- `msw` で WS-13 のエンドポイントをモック。`local` は `MemoryStorageAdapter`。

## 受け入れ条件
- [ ] オフラインで編集、オンライン復帰で自動送信される
- [ ] 2 つのブラウザで同じプロジェクトを開き、片方の保存がもう片方のリロードで見える。生成画像も見える
- [ ] 409 で両方のデータが残る
- [ ] 同期状態がツールバーに表示される
